"""Portfolio engine: rebalancing, costs, NAV reconstruction and trades.

The primary path uses the QuantJourney components:

* ``backtester.portfolio.rebalance.RebalanceEngine`` for policy-driven weight
  drift and rebalancing,
* ``backtester.portfolio.weight_cost.solve_recursive_weight_costs`` for
  self-financing, post-cost NAV accounting,
* ``backtester.portfolio.portf_data.PortfolioData`` +
  ``PortfolioCalculations`` for portfolio analytics.

A deterministic native implementation mirrors the same contracts when the
distribution is not installed, so the API and UI never break.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Mapping

import numpy as np
import pandas as pd

from app.backtest.config import BacktestConfig, RebalanceSpec
from app.backtest.data import CandlePanel
from app.backtest.metrics import (
    benchmark_metrics,
    drawdown_series,
    max_drawdown,
    performance_metrics,
    trade_statistics,
)
from app.backtest.qj_runtime import qj_runtime_info
from app.backtest.strategies import StrategyBuild, build_target_weights

COST_MODEL_NAME = "fixed-bps (fee + slippage)"


@dataclass
class EngineOutcome:
    """Raw engine output consumed by reports and walk-forward folds."""

    config: BacktestConfig
    panel: CandlePanel
    strategy: StrategyBuild
    weights: pd.DataFrame
    target_weights: pd.DataFrame
    rebalance_flags: pd.Series
    gross_returns: pd.Series
    net_returns: pd.Series
    gross_nav: pd.Series
    net_nav: pd.Series
    costs: pd.Series
    benchmark_returns: pd.Series
    benchmark_nav: pd.Series
    trades: list[dict[str, Any]]
    metrics: dict[str, Any]
    trade_stats: dict[str, Any]
    warnings: list[str] = field(default_factory=list)
    rebalance_stats: dict[str, Any] = field(default_factory=dict)
    portfolio_data: Any = None
    calculator: Any = None
    engine_meta: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Rebalance policy
# ---------------------------------------------------------------------------


def _bar_schedule(index: pd.DatetimeIndex, spec: RebalanceSpec, interval_minutes: int) -> pd.DatetimeIndex | None:
    """Map a calendar-ish frequency onto explicit bar timestamps."""

    n = len(index)
    if n == 0:
        return index
    bars_per_day = max(1.0, 24 * 60 / max(1, interval_minutes))
    step: int | None = spec.every_bars
    if step is None:
        if spec.frequency == "D":
            step = max(1, int(round(bars_per_day)))
        elif spec.frequency == "W":
            step = max(1, int(round(7 * bars_per_day)))
        elif spec.frequency == "BME":
            step = max(1, int(round(30 * bars_per_day)))
        elif spec.frequency == "BQE":
            step = max(1, int(round(91 * bars_per_day)))
        elif spec.frequency == "BYE":
            step = max(1, int(round(365 * bars_per_day)))
        elif spec.frequency == "bar":
            step = 1
    if step is not None:
        return index[::step]
    return None


def build_qj_policy(config: BacktestConfig, index: pd.DatetimeIndex):
    """Build a QuantJourney ``RebalancePolicy`` for the panel index."""

    from backtester.portfolio.rebalance import RebalancePolicy

    spec = config.rebalance
    calendar = spec.calendar_dates
    calendar_dates: list[Any] | None = None
    if calendar:
        calendar_dates = [pd.Timestamp(item, tz="UTC") for item in calendar]
    elif spec.frequency in {"NONE", "signal"}:
        calendar_dates = []
    else:
        scheduled = _bar_schedule(index, spec, config.interval_minutes)
        if scheduled is not None:
            calendar_dates = list(scheduled)

    frequency: str | None = "D"
    if calendar_dates is not None:
        frequency = None
    elif config.interval_minutes < 1_440:
        # QJ calendar frequencies are calendar-day based; intraday panels use
        # explicit bar timestamps instead.
        scheduled = _bar_schedule(index, spec, config.interval_minutes)
        calendar_dates = list(scheduled) if scheduled is not None else []
        frequency = None
    elif spec.frequency == "bar":
        frequency = "D"
    elif spec.frequency == "NONE":
        frequency = None
    elif spec.frequency == "signal":
        frequency = None
    else:
        frequency = spec.frequency

    return RebalancePolicy(
        frequency=frequency,
        calendar_dates=calendar_dates,
        drift_threshold=spec.drift_threshold,
        rebalance_on_signal_change=spec.on_signal_change or spec.frequency == "signal",
        signal_change_threshold=spec.signal_change_threshold,
        max_drawdown_trigger=spec.max_drawdown_trigger,
        max_drawdown_action=spec.max_drawdown_action,
        max_annual_turnover=spec.max_annual_turnover,
        min_trade_size=spec.min_trade_weight,
        partial_rebalance=spec.partial,
    )


def describe_policy(spec: RebalanceSpec) -> str:
    parts = [f"frequency={spec.frequency}"]
    if spec.every_bars:
        parts.append(f"every={spec.every_bars} bars")
    if spec.drift_threshold:
        parts.append(f"drift={spec.drift_threshold:.1%}")
    if spec.on_signal_change:
        parts.append("signal-change")
    if spec.max_drawdown_trigger:
        parts.append(f"drawdown-breaker={spec.max_drawdown_trigger:.0%}")
    if spec.max_annual_turnover:
        parts.append(f"turnover-cap={spec.max_annual_turnover:.1f}x")
    return ", ".join(parts)


# ---------------------------------------------------------------------------
# Native fallback accounting
# ---------------------------------------------------------------------------


def _native_flags(target: pd.DataFrame, spec: RebalanceSpec) -> pd.Series:
    index = target.index
    flags = pd.Series(False, index=index)
    if spec.frequency == "bar" or spec.every_bars == 1:
        flags[:] = True
    else:
        scheduled = _bar_schedule(index, spec, 1) if spec.frequency in {"D", "W", "BME", "BQE", "BYE"} else None
        if scheduled is not None and len(scheduled):
            flags.loc[flags.index.isin(scheduled)] = True
        if spec.frequency in {"NONE", "signal"} and not spec.drift_threshold and not spec.max_drawdown_trigger:
            flags.iloc[0] = True
    if spec.on_signal_change:
        changed = target.diff().abs().max(axis=1).fillna(0.0) > spec.signal_change_threshold
        flags = flags | changed
    if spec.calendar_dates:
        wanted = pd.DatetimeIndex([pd.Timestamp(item, tz="UTC") for item in spec.calendar_dates])
        flags = flags | pd.Series(index.isin(wanted), index=index)
    return flags


def _native_accounting(
    target: pd.DataFrame,
    returns: pd.DataFrame,
    spec: RebalanceSpec,
    cost_rate: float,
) -> tuple[pd.DataFrame, pd.Series, pd.Series, pd.Series]:
    flags = _native_flags(target, spec)
    index = target.index
    symbols = list(target.columns)
    actual = pd.DataFrame(0.0, index=index, columns=symbols)
    nav_values = np.ones(len(index), dtype=float)
    gross_values = np.zeros(len(index), dtype=float)
    cost_values = np.zeros(len(index), dtype=float)
    current = np.zeros(len(symbols), dtype=float)
    nav = 1.0
    peak = 1.0
    for position in range(len(index)):
        row_returns = returns.iloc[position].to_numpy(dtype=float)
        gross = float(current @ row_returns)
        target_row = target.iloc[position].to_numpy(dtype=float)
        turnover = float(np.abs(target_row - current).sum())
        forced = False
        if spec.drift_threshold is not None:
            forced = forced or bool(np.abs(target_row - current).max() > spec.drift_threshold)
        if spec.max_drawdown_trigger is not None and peak > 0 and nav / peak - 1.0 <= spec.max_drawdown_trigger:
            forced = True
        if flags.iloc[position] or forced or position == 0:
            turnover = float(np.abs(target_row - current).sum())
            cost = turnover * cost_rate
            current = target_row
            nav *= 1.0 + gross - cost
        else:
            nav *= 1.0 + gross
            if nav > 0:
                current = current * (1.0 + row_returns) / (1.0 + gross)
        actual.iloc[position] = current
        nav_values[position] = nav
        gross_values[position] = gross
        cost_values[position] = turnover * cost_rate
        peak = max(peak, nav)
    return (
        actual,
        pd.Series(nav_values, index=index, name="nav"),
        pd.Series(gross_values, index=index, name="gross_return"),
        pd.Series(cost_values, index=index, name="cost"),
    )


# ---------------------------------------------------------------------------
# Trade ledger
# ---------------------------------------------------------------------------


def build_trade_ledger(
    target_weights: pd.DataFrame,
    rebalance_flags: pd.Series,
    close: pd.DataFrame,
    net_nav: pd.Series,
    *,
    fee_bps: float,
    slippage_bps: float,
    max_trades: int = 5000,
) -> list[dict[str, Any]]:
    """Reconstruct round-trip position episodes from target weights.

    A trade opens when a symbol moves from flat to a position and closes when
    it returns to flat (or flips sign).  Partial rebalance trims stay inside
    the open episode and are folded into its realised PnL, which keeps the
    ledger readable while remaining faithful to the accounting.
    """

    if target_weights.empty or close.empty:
        return []
    fee_rate = (max(0.0, fee_bps) + max(0.0, slippage_bps)) / 10_000.0
    nav = net_nav.reindex(target_weights.index).ffill().fillna(0.0)
    prices = close.reindex(target_weights.index).ffill()
    flags = rebalance_flags.reindex(target_weights.index).fillna(False).astype(bool)
    weight_changes = target_weights.diff().abs().max(axis=1).fillna(0.0)
    trade_bars = flags | (weight_changes > 1e-9)
    trades: list[dict[str, Any]] = []
    episodes: dict[str, dict[str, Any] | None] = {symbol: None for symbol in target_weights.columns}
    current_quantities: dict[str, float] = {symbol: 0.0 for symbol in target_weights.columns}

    def open_episode(symbol: str, price: float, timestamp: Any, position: int, direction: float, qty: float) -> dict[str, Any]:
        fee = abs(qty * price) * fee_rate
        return {
            "symbol": symbol,
            "direction": direction,
            "qty": qty,
            "entry_time": pd.Timestamp(timestamp).isoformat(),
            "entry_bar": position,
            "avg_entry": price,
            "peak_qty": abs(qty),
            "first_notional": abs(qty * price),
            "buy_qty": abs(qty) if direction > 0 else 0.0,
            "sell_qty": abs(qty) if direction < 0 else 0.0,
            "avg_exit": price,
            "exit_qty": 0.0,
            "fees": fee,
            "realized": 0.0,
        }

    def close_trade(episode: dict[str, Any], timestamp: Any, position: int, status: str = "closed") -> dict[str, Any]:
        pnl = float(episode["realized"]) - float(episode["fees"])
        notional = max(float(episode["first_notional"]), 1e-9)
        return {
            "id": f"T{len(trades) + 1:05d}",
            "symbol": episode["symbol"],
            "type": "buy" if episode["direction"] > 0 else "sell",
            "side": "long" if episode["direction"] > 0 else "short",
            "entryTime": episode["entry_time"],
            "exitTime": pd.Timestamp(timestamp).isoformat() if status == "closed" else None,
            "entryPrice": round(float(episode["avg_entry"]), 8),
            "exitPrice": round(float(episode["avg_exit"]), 8) if status == "closed" else None,
            "amount": round(float(episode["peak_qty"]), 10),
            "totalValue": round(notional, 2),
            "fee": round(float(episode["fees"]), 4),
            "pnl": round(pnl, 4),
            "pnlPercent": round(pnl / notional * 100.0, 4),
            "reason": "signal_exit" if status == "closed" else "open_position",
            "status": status,
            "holdingBars": int(position - int(episode["entry_bar"])),
        }

    for position, timestamp in enumerate(target_weights.index):
        if not bool(trade_bars.iloc[position]):
            continue
        nav_value = float(nav.iloc[position])
        for symbol in target_weights.columns:
            price = float(prices[symbol].iloc[position]) if pd.notna(prices[symbol].iloc[position]) else np.nan
            if not math.isfinite(price) or price <= 0:
                continue
            weight = float(target_weights[symbol].iloc[position])
            target_qty = weight * nav_value / price
            delta = target_qty - current_quantities[symbol]
            if abs(delta * price) < 1e-6:
                current_quantities[symbol] = target_qty
                continue
            episode = episodes[symbol]
            if episode is None:
                if abs(target_qty) < 1e-12:
                    current_quantities[symbol] = 0.0
                    continue
                episode = open_episode(symbol, price, timestamp, position, 1.0 if target_qty > 0 else -1.0, target_qty)
                episodes[symbol] = episode
                current_quantities[symbol] = target_qty
                continue

            same_direction = (delta > 0) == (episode["direction"] > 0)
            if same_direction:
                added = abs(delta)
                new_qty = episode["qty"] + delta
                episode["avg_entry"] = (
                    episode["avg_entry"] * abs(episode["qty"]) + price * added
                ) / max(abs(new_qty), 1e-12)
                episode["qty"] = new_qty
                episode["fees"] += abs(delta * price) * fee_rate
                episode["peak_qty"] = max(float(episode["peak_qty"]), abs(new_qty))
                if episode["direction"] > 0:
                    episode["buy_qty"] += added
                else:
                    episode["sell_qty"] += added
                current_quantities[symbol] = new_qty
                continue

            # Reducing or flipping the position.
            close_qty = min(abs(delta), abs(episode["qty"]))
            total_exit_qty = float(episode["exit_qty"]) + close_qty
            episode["avg_exit"] = (
                float(episode["avg_exit"]) * float(episode["exit_qty"]) + price * close_qty
            ) / max(total_exit_qty, 1e-12)
            episode["exit_qty"] = total_exit_qty
            episode["realized"] += (price - float(episode["avg_entry"])) * episode["direction"] * close_qty
            episode["fees"] += abs(close_qty * price) * fee_rate
            remaining = abs(delta) - close_qty
            new_qty = episode["qty"] + episode["direction"] * (-close_qty)
            if abs(new_qty) <= 1e-12:
                episode["qty"] = 0.0
                trades.append(close_trade(episode, timestamp, position))
                episodes[symbol] = None
                new_qty = 0.0
            else:
                episode["qty"] = new_qty
            if remaining > 1e-12:
                direction = 1.0 if target_qty > 0 else -1.0
                remainder_qty = direction * remaining
                episodes[symbol] = open_episode(
                    symbol, price, timestamp, position, direction, remainder_qty
                )
                new_qty = remainder_qty
            current_quantities[symbol] = new_qty
            if len(trades) >= max_trades:
                return trades

    last_position = len(target_weights) - 1
    for symbol, episode in episodes.items():
        if episode is None or abs(episode["qty"]) <= 1e-12:
            continue
        last_price = float(prices[symbol].dropna().iloc[-1]) if prices[symbol].notna().any() else float(episode["avg_entry"])
        episode["realized"] += (
            last_price - float(episode["avg_entry"])
        ) * episode["direction"] * abs(episode["qty"])
        episode["avg_exit"] = last_price
        trades.append(close_trade(episode, target_weights.index[last_position], last_position, status="open"))
    trades.sort(key=lambda item: (item["entryTime"], item["id"]))
    return trades


# ---------------------------------------------------------------------------
# Benchmark and analytics helpers
# ---------------------------------------------------------------------------


def benchmark_returns_for(config: BacktestConfig, panel: CandlePanel, warnings: list[str]) -> tuple[pd.Series, str]:
    symbols = panel.symbols
    if config.benchmark_mode in {"flat", "none"}:
        return pd.Series(0.0, index=panel.index, name="benchmark"), "cash"
    target_symbol = config.benchmark_symbol
    if config.benchmark_mode == "asset" and target_symbol:
        normalized = target_symbol.upper()
        if normalized in panel.close.columns:
            series = panel.close[normalized].pct_change(fill_method=None).fillna(0.0)
            return series.rename("benchmark"), normalized
        warnings.append(
            f"benchmark symbol {target_symbol} is not in the data panel; using equal-weight universe instead"
        )
    if len(symbols) == 1:
        series = panel.close[symbols[0]].pct_change(fill_method=None).fillna(0.0)
        return series.rename("benchmark"), f"{symbols[0]} buy & hold"
    series = panel.returns.mean(axis=1).fillna(0.0)
    return series.rename("benchmark"), "equal-weight universe"


def _contribution(actual_weights: pd.DataFrame, returns: pd.DataFrame) -> dict[str, Any]:
    aligned = actual_weights.reindex(columns=returns.columns).fillna(0.0)
    contributions = (aligned * returns.reindex(actual_weights.index).fillna(0.0)).sum(axis=0)
    total = float(contributions.sum())
    payload: dict[str, Any] = {}
    for symbol, value in contributions.sort_values(ascending=False).items():
        payload[symbol] = {
            "contributionPercent": float(value * 100),
            "sharePercent": float(value / total * 100) if total else None,
            "averageWeightPercent": float(aligned[symbol].abs().mean() * 100),
            "exposureSharePercent": float(aligned[symbol].abs().mean() / max(1e-12, aligned.abs().mean().sum()) * 100),
        }
    return payload


def _default_warnings(config: BacktestConfig, panel: CandlePanel) -> list[str]:
    warnings: list[str] = []
    if not qj_runtime_info()["available"]:
        warnings.append("quantjourney-bt is not installed; native accounting fallback was used")
    if panel.n_bars < 100:
        warnings.append(f"short sample: only {panel.n_bars} bars")
    span_days = (panel.index[-1] - panel.index[0]).total_seconds() / 86_400 if panel.n_bars > 1 else 0
    if span_days < 90:
        warnings.append(
            f"sample spans {span_days:.0f} calendar days; annualised statistics extrapolate a short window"
        )
    if config.rebalance.frequency == "signal" and not config.rebalance.on_signal_change:
        warnings.append("rebalance frequency 'signal' implicitly enables the signal-change trigger")
    if config.fee_bps == 0 and config.slippage_bps == 0:
        warnings.append("zero transaction costs configured; results are gross of fees")
    return warnings


# ---------------------------------------------------------------------------
# Main engine
# ---------------------------------------------------------------------------


def run_engine(
    config: BacktestConfig,
    panel: CandlePanel,
    *,
    strategy_params: Mapping[str, Any] | None = None,
    include_trades: bool = True,
    keep_portfolio_data: bool = True,
) -> EngineOutcome:
    """Run one full portfolio backtest and return every derived series."""

    if strategy_params:
        config = config.with_overrides(strategy_params=strategy_params)
    benchmark_panel = panel
    trading_panel = panel.select(config.symbols) if set(panel.symbols) != set(config.symbols) else panel
    panel = trading_panel
    build = build_target_weights(
        panel,
        config.strategy,
        config.allocation,
        hard_stop_percent=config.hard_stop_percent if config.hard_stop_enabled else None,
    )
    target_weights = build.weights
    returns = panel.returns
    cost_rate = (config.fee_bps + config.slippage_bps) / 10_000.0
    warnings = _default_warnings(config, panel)
    rebalance_stats: dict[str, Any] = {}
    portfolio_data = None
    calculator = None

    if qj_runtime_info()["available"]:
        from backtester.portfolio.portf_calc import PortfolioCalculations
        from backtester.portfolio.portf_data import PortfolioData
        from backtester.portfolio.rebalance import RebalanceEngine
        from backtester.portfolio.weight_cost import FixedBpsWeightCostModel, solve_recursive_weight_costs

        policy = build_qj_policy(config, target_weights.index)
        engine = RebalanceEngine(policy, periods_per_year=config.resolved_periods_per_year, warn_unsupported=False)
        actual_weights, rebalance_flags = engine.run(target_weights, returns)
        rebalance_stats = dict(getattr(engine, "stats", {}) or {})
        gross_returns = engine.portfolio_returns.reindex(target_weights.index).fillna(0.0).astype(float)
        gross_nav = config.initial_capital * (1.0 + gross_returns).cumprod()
        cost_model = FixedBpsWeightCostModel(total_bps=config.fee_bps + config.slippage_bps)
        try:
            net_nav, net_returns, breakdown = solve_recursive_weight_costs(
                actual_weights=actual_weights,
                prices=panel.close,
                gross_returns=gross_returns,
                initial_capital=config.initial_capital,
                rebalance_flags=rebalance_flags,
                cost_model=cost_model,
            )
            costs = breakdown.total_cost_pct.reindex(actual_weights.index).fillna(0.0)
            net_returns = net_returns.reindex(actual_weights.index).astype(float)
        except Exception as exc:  # pragma: no cover - defensive cost fallback
            warnings.append(f"recursive cost solver failed, using turnover approximation: {exc}")
            turnover = actual_weights.diff().abs().sum(axis=1).fillna(0.0) * cost_rate
            costs = turnover
            net_returns = (gross_returns - turnover).clip(lower=-1.0)
            net_nav = config.initial_capital * (1.0 + net_returns).cumprod()
        if len(rebalance_flags) and rebalance_flags.dtype != bool:
            rebalance_flags = rebalance_flags.fillna(False).astype(bool)

        portfolio_data = PortfolioData(
            instruments=_build_instrument_data(panel, build.signals),
            net_asset_value=net_nav,
            weights=actual_weights,
            returns=net_returns,
            cash=_cash_series(net_nav, actual_weights),
            periods_per_year=config.resolved_periods_per_year,
        )
        calculator = PortfolioCalculations(portfolio_data)
        engine_meta = {
            "engine": "quantjourney-bt",
            "version": qj_runtime_info()["qj_backtester"],
            "mode": "weights",
            "rebalanceEngine": "RebalanceEngine",
            "metricFrequency": None,
            "costSolver": "solve_recursive_weight_costs",
            "costModel": COST_MODEL_NAME,
            "policy": describe_policy(config.rebalance),
            "periodsPerYear": config.resolved_periods_per_year,
        }
    else:
        actual_weights, nav_relative, gross_returns, costs = _native_accounting(
            target_weights, returns, config.rebalance, cost_rate
        )
        net_nav = nav_relative * config.initial_capital
        gross_nav = config.initial_capital * (1.0 + gross_returns).cumprod()
        net_returns = net_nav.pct_change(fill_method=None).fillna(0.0)
        rebalance_flags = _native_flags(target_weights, config.rebalance)
        engine_meta = {
            "engine": "native-fallback",
            "version": None,
            "mode": "weights",
            "rebalanceEngine": "native",
            "costSolver": "turnover approximation",
            "costModel": COST_MODEL_NAME,
            "policy": describe_policy(config.rebalance),
            "periodsPerYear": config.resolved_periods_per_year,
        }

    actual_weights = actual_weights.reindex(target_weights.index).fillna(0.0).astype(float)
    net_returns = net_returns.reindex(target_weights.index).fillna(0.0).astype(float)
    net_nav = net_nav.reindex(target_weights.index).ffill().fillna(config.initial_capital)
    gross_returns = gross_returns.reindex(target_weights.index).fillna(0.0).astype(float)
    costs = costs.reindex(target_weights.index).fillna(0.0).astype(float)
    gross_nav = gross_nav.reindex(target_weights.index).ffill().fillna(config.initial_capital)

    metric_nav, metric_returns, metric_ppy, metric_frequency = resolve_metric_series(
        net_nav, net_returns, config.interval_minutes
    )
    metric_calculator = calculator
    if metric_frequency == "daily" and calculator is not None:
        try:
            from backtester.portfolio.portf_calc import PortfolioCalculations
            from backtester.portfolio.portf_data import PortfolioData

            daily_weights = actual_weights.resample("1D").last().reindex(metric_nav.index).ffill().fillna(0.0)
            daily_portfolio = PortfolioData(
                instruments=portfolio_data.instruments,
                net_asset_value=metric_nav,
                weights=daily_weights,
                returns=metric_returns,
                periods_per_year=metric_ppy,
            )
            metric_calculator = PortfolioCalculations(daily_portfolio)
            calculator = metric_calculator
        except Exception:
            metric_calculator = calculator
    metrics = performance_metrics(
        metric_nav,
        metric_returns,
        periods_per_year=metric_ppy,
        weights=actual_weights if metric_frequency == "bar" else None,
        qj_calculator=metric_calculator,
    )
    metrics["metricFrequency"] = metric_frequency
    metrics["metricPeriodsPerYear"] = metric_ppy
    trades = (
        build_trade_ledger(
            target_weights,
            rebalance_flags,
            panel.close,
            net_nav,
            fee_bps=config.fee_bps,
            slippage_bps=config.slippage_bps,
        )
        if include_trades
        else []
    )
    trade_stats = trade_statistics(trades, initial_capital=config.initial_capital)
    if not include_trades:
        trade_stats = {
            **trade_stats,
            "totalTrades": _estimate_trade_episodes(target_weights),
            "tradeCountMode": "estimated",
        }
        metrics["totalTrades"] = trade_stats["totalTrades"]
        metrics["tradeCountMode"] = "estimated"
    benchmark_returns, benchmark_name = benchmark_returns_for(config, benchmark_panel, warnings)
    benchmark_nav = config.initial_capital * (1.0 + benchmark_returns).cumprod()
    metric_benchmark = benchmark_returns
    if metric_frequency == "daily":
        metric_benchmark = (1.0 + benchmark_returns).resample("1D").prod() - 1.0
        metric_benchmark = metric_benchmark.reindex(metric_nav.index).fillna(0.0)
    relative = benchmark_metrics(metric_returns, metric_benchmark, periods_per_year=metric_ppy)
    metrics.update(relative)
    metrics.update(
        {
            "grossReturnPercent": float(gross_nav.iloc[-1] / gross_nav.iloc[0] - 1.0) * 100 if len(gross_nav) else 0.0,
            "netReturnPercent": float(net_nav.iloc[-1] / net_nav.iloc[0] - 1.0) * 100 if len(net_nav) else 0.0,
            "totalCostsUSD": float((costs * net_nav).sum()),
            "costDragPercent": float(costs.sum() * 100),
            "rebalanceCount": int(rebalance_flags.sum()) if len(rebalance_flags) else 0,
            "benchmarkName": benchmark_name,
            **{key: value for key, value in trade_stats.items()},
        }
    )
    metrics["averageGrossExposurePercent"] = float(actual_weights.abs().sum(axis=1).mean() * 100)
    metrics["exposurePercent"] = metrics.get("averageGrossExposurePercent")
    metrics["contribution"] = _contribution(actual_weights, returns)

    if metrics.get("totalTrades") == 0 and float(actual_weights.abs().to_numpy().sum()) == 0.0:
        warnings.append("strategy never held a position; check signal parameters and warm-up length")

    outcome = EngineOutcome(
        config=config,
        panel=panel,
        strategy=build,
        weights=actual_weights,
        target_weights=target_weights,
        rebalance_flags=rebalance_flags.astype(bool),
        gross_returns=gross_returns,
        net_returns=net_returns,
        gross_nav=gross_nav,
        net_nav=net_nav,
        costs=costs,
        benchmark_returns=benchmark_returns,
        benchmark_nav=benchmark_nav,
        trades=trades,
        metrics=metrics,
        trade_stats=trade_stats,
        warnings=warnings,
        rebalance_stats=rebalance_stats,
        portfolio_data=portfolio_data if keep_portfolio_data else None,
        calculator=calculator if keep_portfolio_data else None,
        engine_meta=engine_meta,
    )
    return outcome


def _estimate_trade_episodes(target_weights: pd.DataFrame) -> int:
    """Count flat -> position -> flat episodes without a full ledger."""

    episodes = 0
    for symbol in target_weights.columns:
        active = (target_weights[symbol].abs() > 1e-9).to_numpy()
        if not active.any():
            continue
        starts = active & ~np.concatenate([[False], active[:-1]])
        episodes += int(starts.sum())
    return episodes


def resolve_metric_series(
    net_nav: pd.Series, net_returns: pd.Series, interval_minutes: int
) -> tuple[pd.Series, pd.Series, int, str]:
    """Use daily returns for conventional annualisation on intraday panels."""

    if interval_minutes < 1_440 and len(net_nav) >= 48:
        daily_nav = net_nav.resample("1D").last().dropna()
        if len(daily_nav) >= 8:
            daily_returns = daily_nav.pct_change(fill_method=None).fillna(0.0)
            return daily_nav, daily_returns, 365, "daily"
    if interval_minutes >= 1_440:
        periods = max(1, int(round(365 * 1_440 / interval_minutes)))
        return net_nav, net_returns, periods, "bar"
    return net_nav, net_returns, max(1, int(round(365 * 24 * 60 / interval_minutes))), "bar"


def _build_instrument_data(panel: CandlePanel, signals: pd.DataFrame):
    from backtester.portfolio.instr_data import InstrumentData

    symbols = panel.symbols
    index = panel.index
    price_frames = {}
    for field_name in ("open", "high", "low", "close", "volume"):
        price_frames[field_name] = getattr(panel, field_name)
    price_frames["adj_close"] = panel.close
    prices = pd.concat(price_frames, axis=1)
    prices.columns = prices.columns.swaplevel(0, 1)
    prices = prices.sort_index(axis=1)

    metrics_columns = pd.MultiIndex.from_product(
        [symbols, ["returns", "volatility", "drawdown"]], names=["instrument", "metric"]
    )
    returns = panel.returns
    drawdown = returns.apply(lambda column: (1 + column).cumprod() / (1 + column).cumprod().cummax() - 1)
    volatility = returns.rolling(20, min_periods=2).std(ddof=0)
    metrics = pd.DataFrame(index=index, columns=metrics_columns, dtype=float)
    for symbol in symbols:
        metrics[(symbol, "returns")] = returns[symbol]
        metrics[(symbol, "volatility")] = volatility[symbol]
        metrics[(symbol, "drawdown")] = drawdown[symbol]

    parameter_columns = pd.MultiIndex.from_product(
        [symbols, ["eligibility", "is_trading_day", "active"]], names=["instrument", "parameter"]
    )
    parameters = pd.DataFrame(index=index, columns=parameter_columns, dtype=object)
    for symbol in symbols:
        parameters[(symbol, "eligibility")] = panel.close[symbol].notna()
        parameters[(symbol, "is_trading_day")] = True
        parameters[(symbol, "active")] = True

    strategy_columns = pd.MultiIndex.from_product(
        [["qj_backtest"], ["signal"], symbols], names=["strategy", "field", "instrument"]
    )
    strategies = pd.DataFrame(index=index, columns=strategy_columns, dtype=float)
    for symbol in symbols:
        strategies[("qj_backtest", "signal", symbol)] = signals[symbol] if symbol in signals else 0.0

    return InstrumentData(
        group_data=pd.Series({symbol: "UNIVERSE" for symbol in symbols}),
        group_order=symbols,
        strategies=strategies,
        prices=prices,
        metrics=metrics,
        parameters=parameters,
        _skip_validation=True,
    )


def _cash_series(nav: pd.Series, weights: pd.DataFrame) -> pd.Series:
    gross = weights.abs().sum(axis=1).reindex(nav.index).fillna(0.0)
    return (nav * (1.0 - gross.clip(upper=1.0))).rename("cash")


def equity_curve(
    outcome: EngineOutcome,
    *,
    max_points: int = 1200,
) -> list[dict[str, Any]]:
    """Build the frontend equity curve, downsampled for transport size."""

    nav = outcome.net_nav
    benchmark_nav = outcome.benchmark_nav
    drawdown = drawdown_series(nav)
    weights = outcome.weights
    primary = outcome.panel.symbols[0]
    price = outcome.panel.close[primary]
    cash = nav * (1.0 - weights.abs().sum(axis=1).clip(upper=1.0)).reindex(nav.index).fillna(0.0)
    holdings = nav - cash
    action_times: dict[str, str] = {}
    for trade in outcome.trades:
        exit_time = trade.get("exitTime")
        if exit_time:
            action_times[pd.Timestamp(exit_time).isoformat()] = "sell" if trade.get("side") == "long" else "buy"
        entry_time = trade.get("entryTime")
        if entry_time:
            action_times.setdefault(
                pd.Timestamp(entry_time).isoformat(), "buy" if trade.get("side") == "long" else "sell"
            )

    step = max(1, len(nav) // max_points)
    positions = list(range(0, len(nav), step))
    if positions[-1] != len(nav) - 1:
        positions.append(len(nav) - 1)
    points: list[dict[str, Any]] = []
    for position in positions:
        timestamp = nav.index[position]
        iso = pd.Timestamp(timestamp).isoformat()
        point = {
            "timestamp": iso,
            "time": pd.Timestamp(timestamp).strftime("%m-%d %H:%M") if outcome.config.interval_minutes < 1440 else pd.Timestamp(timestamp).strftime("%Y-%m-%d"),
            "price": round(float(price.iloc[position]), 6),
            "equity": round(float(nav.iloc[position]), 2),
            "benchmarkEquity": round(float(benchmark_nav.iloc[position]), 2),
            "drawdown": round(float(drawdown.iloc[position]) * 100, 4),
            "cash": round(float(cash.iloc[position]), 2),
            "assetHoldings": round(float(holdings.iloc[position]), 2),
        }
        action = action_times.get(iso)
        if action:
            point["action"] = action
            point["tradePrice"] = point["price"]
        points.append(point)
    return points


def legacy_summary(outcome: EngineOutcome) -> dict[str, Any]:
    """Map rich analytics onto the UI's historical ``BacktestSummary`` shape."""

    metrics = outcome.metrics
    net_nav = outcome.net_nav
    return {
        "initialBalance": round(float(outcome.config.initial_capital), 2),
        "finalBalance": round(float(net_nav.iloc[-1]), 2),
        "totalReturnUSD": round(float(net_nav.iloc[-1] - outcome.config.initial_capital), 2),
        "totalReturnPercent": round(float(metrics.get("totalReturnPercent") or 0.0), 4),
        "benchmarkReturnPercent": round(float(metrics.get("benchmarkReturnPercent") or 0.0), 4),
        "alpha": round(float(metrics.get("alphaPercent") or 0.0), 4),
        "maxDrawdownPercent": round(float(metrics.get("maxDrawdownPercent") or 0.0), 4),
        "maxDrawdownUSD": round(float(metrics.get("maxDrawdownUSD") or 0.0), 2),
        "sharpeRatio": round(float(metrics.get("sharpeRatio") or 0.0), 4),
        "sortinoRatio": round(float(metrics.get("sortinoRatio") or 0.0), 4),
        "calmarRatio": round(float(metrics.get("calmarRatio") or 0.0), 4),
        "profitFactor": round(float(metrics.get("profitFactor") or 0.0), 4),
        "winRate": round(float(metrics.get("winRate") or 0.0), 4),
        "totalTrades": int(metrics.get("totalTrades") or 0),
        "winningTrades": int(metrics.get("winningTrades") or 0),
        "losingTrades": int(metrics.get("losingTrades") or 0),
        "averageTradeReturn": round(float(metrics.get("averageTradeReturnPercent") or 0.0), 4),
        "bestTradeUSD": round(float(metrics.get("bestTradeUSD") or 0.0), 2),
        "worstTradeUSD": round(float(metrics.get("worstTradeUSD") or 0.0), 2),
        "avgHoldCandles": round(float(metrics.get("averageHoldBars") or 0.0), 2),
        "totalFeesPaid": round(float(metrics.get("totalFeesUSD") or 0.0), 2),
        "annualizedVolatilityPercent": round(float(metrics.get("annualizedVolatilityPercent") or 0.0), 4),
        "exposurePercent": round(float(metrics.get("exposurePercent") or 0.0), 4),
        "beta": round(float(metrics.get("beta") or 0.0), 4),
        "informationRatio": round(float(metrics.get("informationRatio") or 0.0), 4),
        "var95Percent": round(float(metrics.get("var95Percent") or 0.0), 4),
        "cvar95Percent": round(float(metrics.get("cvar95Percent") or 0.0), 4),
    }


def result_payload(outcome: EngineOutcome) -> dict[str, Any]:
    """Assemble the complete, JSON-safe result envelope."""

    from app.backtest.report import sanitize

    metrics = sanitize(outcome.metrics)
    legacy = legacy_summary(outcome)
    equity = equity_curve(outcome)
    trades = sanitize(outcome.trades)
    period_label = _period_label(outcome.panel)
    level = "high" if (metrics.get("sharpeRatio") or 0) > 1 and (metrics.get("maxDrawdownPercent") or 100) < 25 else (
        "moderate" if (metrics.get("totalReturnPercent") or 0) > 0 else "low"
    )
    analytics = {
        "engine": outcome.engine_meta,
        "metrics": metrics,
        "tradeStats": sanitize(outcome.trade_stats),
        "rebalance": {
            "policy": outcome.engine_meta.get("policy"),
            "count": int(outcome.rebalance_flags.sum()),
            "stats": sanitize(outcome.rebalance_stats),
        },
        "contribution": metrics.get("contribution", {}),
        "data": {
            "source": outcome.panel.source,
            "symbols": outcome.panel.symbols,
            "bars": outcome.panel.n_bars,
            "start": outcome.panel.start,
            "end": outcome.panel.end,
            "intervalMinutes": outcome.panel.interval_minutes,
            "benchmark": metrics.get("benchmarkName"),
        },
        "strategy": {
            "model": outcome.strategy.model,
            "params": sanitize(outcome.strategy.params),
            "diagnostics": sanitize(outcome.strategy.diagnostics),
        },
        "quality": {
            "warnings": outcome.warnings,
            "rating": level,
            "confidence": "high" if outcome.panel.n_bars >= 500 and not outcome.warnings else "medium",
        },
        "assumptions": {
            "fillTiming": "one-bar execution delay",
            "costModel": COST_MODEL_NAME,
            "feeBps": outcome.config.fee_bps,
            "slippageBps": outcome.config.slippage_bps,
            "periodsPerYear": outcome.config.resolved_periods_per_year,
            "hardStopPercent": outcome.config.hard_stop_percent if outcome.config.hard_stop_enabled else None,
        },
    }
    return {
        "id": None,
        "strategyId": outcome.config.strategy_id,
        "strategyName": outcome.config.strategy_name,
        "assetPair": " / ".join(outcome.panel.symbols),
        "symbols": outcome.panel.symbols,
        "interval": outcome.panel.interval_minutes,
        "periodLabel": period_label,
        "startTime": outcome.panel.start,
        "endTime": outcome.panel.end,
        "totalCandles": outcome.panel.n_bars,
        "summary": legacy,
        "equityCurve": equity,
        "trades": trades,
        "analytics": analytics,
        "engine": outcome.engine_meta.get("engine"),
        "warnings": outcome.warnings,
    }


def _period_label(panel: CandlePanel) -> str:
    start = pd.Timestamp(panel.index[0])
    end = pd.Timestamp(panel.index[-1])
    if panel.interval_minutes >= 1440:
        return f"{start.date()} → {end.date()} ({panel.n_bars} bars)"
    return f"{start.strftime('%Y-%m-%d %H:%M')} → {end.strftime('%Y-%m-%d %H:%M')} UTC ({panel.n_bars} bars)"


def fold_metrics(outcome: EngineOutcome) -> dict[str, Any]:
    """Compact metric block used inside walk-forward folds."""

    metrics = outcome.metrics
    keys = (
        "totalReturnPercent",
        "cagrPercent",
        "sharpeRatio",
        "sortinoRatio",
        "calmarRatio",
        "maxDrawdownPercent",
        "annualizedVolatilityPercent",
        "winRate",
        "profitFactor",
        "totalTrades",
        "averageTradeReturnPercent",
        "turnoverRatio",
        "exposurePercent",
    )
    return {key: metrics.get(key) for key in keys}
