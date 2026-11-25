"""Strategy Arena: head-to-head bot competition on one shared market panel.

The design is deliberately analogous to a live trading-bot broadcast:

* one market, one cost model, one execution assumption for every entrant;
* each bot is a rule set drawn from the strategy registry;
* the scoreboard is realised **R** over closed trades only;
* the exit ladder takes a third off at 1R, 2R and 3R, moving the stop to
  break-even after TP1 and to TP1 after TP2;
* every bot carries an explainable "what am I waiting for" signal check and a
  replay of its last completed trade.

Nothing here places orders.  The arena is a deterministic research replay built
on the same QuantJourney engine used by the single-strategy backtester.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Sequence

import pandas as pd

from app.backtest.config import BacktestConfig, BacktestError, StrategySpec
from app.backtest.data import CandlePanel
from app.backtest.engine import run_engine
from app.backtest.indicators import bollinger, ema, macd, realized_volatility, rsi, rolling_high, rolling_low, sma


ARENA_BOTS: tuple[dict[str, Any], ...] = (
    {
        "id": "trend-rider",
        "name": "Trend Rider",
        "tagline": "Rides the structure",
        "family": "trend",
        "model": "ema_cross",
        "params": {"fast": 12, "slow": 48},
        "color": "#34d399",
        "rule": "Long when EMA(12) crosses above EMA(48); exit when it crosses back below.",
    },
    {
        "id": "range-breaker",
        "name": "Range Breaker",
        "tagline": "Buys the break",
        "family": "breakout",
        "model": "donchian_breakout",
        "params": {"entry_window": 55, "exit_window": 20},
        "color": "#60a5fa",
        "rule": "Enter long on a new 55-bar high; exit on a new 20-bar low.",
    },
    {
        "id": "wick-hunter",
        "name": "Wick Hunter",
        "tagline": "Fades the stretch",
        "family": "mean_reversion",
        "model": "bollinger_reversion",
        "params": {"period": 20, "num_std": 2.2},
        "color": "#f472b6",
        "rule": "Buy a close below the lower Bollinger band (2.2σ); exit at the middle band.",
    },
    {
        "id": "rsi-snapback",
        "name": "RSI Snapback",
        "tagline": "Waits for exhaustion",
        "family": "mean_reversion",
        "model": "rsi_reversion",
        "params": {"period": 14, "oversold": 30, "exit_level": 55},
        "color": "#fbbf24",
        "rule": "Enter long when RSI(14) drops below 30; exit once RSI recovers above 55.",
    },
    {
        "id": "nova-ai",
        "name": "Nova AI",
        "tagline": "Momentum with confirmation",
        "family": "trend",
        "model": "macd_trend",
        "params": {"fast": 12, "slow": 26, "signal": 9},
        "color": "#a78bfa",
        "rule": "Hold long while the MACD line is above its signal line; exit on the reverse cross.",
    },
    {
        "id": "core-sentinel",
        "name": "Core Sentinel",
        "tagline": "Risk-managed core",
        "family": "risk",
        "model": "vol_target_trend",
        "params": {"fast": 20, "slow": 60, "target_vol": 0.18, "vol_window": 30},
        "color": "#22d3ee",
        "rule": "Trend exposure when SMA(20) > SMA(60), scaled to an 18% volatility target.",
    },
)

ARENA_NOTES: tuple[dict[str, str], ...] = (
    {
        "id": "why-r",
        "title": "Why the score is R, not %",
        "body": "A $40 stop and a $400 stop should not be compared by percentage return. R normalises every closed trade by the risk that was on the table when it opened, so position size stops flattering the leaderboard.",
    },
    {
        "id": "ladder",
        "title": "The three-stage exit ladder",
        "body": "Each trade scales out a third at 1R, 2R and 3R. After TP1 the stop moves to break-even; after TP2 it moves to TP1. Unrealised profit is never allowed to become a loss.",
    },
    {
        "id": "waiting",
        "title": "Waiting is a position",
        "body": "Most bots are flat most of the time. The analysis card shows the exact condition each rule is waiting for on the latest candle, so 'no trade' is an explained decision rather than an empty row.",
    },
    {
        "id": "closed-only",
        "title": "Closed trades only",
        "body": "Open positions are shown for context but excluded from the score. A trade only counts once the ladder or the signal has fully closed it.",
    },
    {
        "id": "same-rules",
        "title": "Same rules for every bot",
        "body": "Every entrant sees the same candles, fees, slippage, one-bar execution delay and risk budget. The only difference is the rule set.",
    },
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _round(value: Any, digits: int = 4) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return round(number, digits)


def _downsample(series: pd.Series, points: int) -> pd.Series:
    if len(series) <= points:
        return series
    step = max(1, len(series) // points)
    sampled = series.iloc[::step]
    if sampled.index[-1] != series.index[-1]:
        sampled = pd.concat([sampled, series.iloc[[-1]]])
    return sampled


def _time_label(index: Any, position: int) -> str:
    stamp = pd.Timestamp(index[position])
    if stamp.minute or stamp.hour:
        return stamp.strftime("%m-%d %H:%M")
    return stamp.strftime("%m-%d")


def _price_series(panel: CandlePanel, points: int = 420) -> list[dict[str, Any]]:
    close = panel.close[panel.symbols[0]]
    sampled = _downsample(close, points)
    rows: list[dict[str, Any]] = []
    for timestamp, value in sampled.items():
        stamp = pd.Timestamp(timestamp)
        rows.append(
            {
                "timestamp": stamp.isoformat(),
                "ts": int(stamp.timestamp() * 1000),
                "time": stamp.strftime("%m-%d %H:%M") if stamp.minute or stamp.hour else stamp.strftime("%m-%d"),
                "price": _round(value, 6),
            }
        )
    return rows


def _fee_r(trade: Mapping[str, Any], risk_amount: float) -> float:
    if risk_amount <= 0:
        return 0.0
    fee = abs(float(trade.get("fee") or 0.0))
    return fee / risk_amount


def _simulate_ladder(
    panel: CandlePanel,
    trade: Mapping[str, Any],
    risk_percent: float,
    targets: Sequence[float],
) -> dict[str, Any]:
    """Replay one closed trade through the 1R/2R/3R scale-out ladder."""

    symbol = str(trade.get("symbol") or panel.symbols[0])
    if symbol not in panel.close.columns:
        symbol = panel.symbols[0]
    entry = float(trade.get("entryPrice") or 0.0)
    exit_price = float(trade.get("exitPrice") or 0.0)
    amount = abs(float(trade.get("amount") or 0.0))
    direction = -1.0 if str(trade.get("side") or trade.get("type") or "").lower() in {"short", "sell"} else 1.0
    risk_amount = entry * amount * risk_percent / 100.0
    risk_distance = entry * risk_percent / 100.0

    fallback_r = None
    if risk_amount > 0:
        fallback_r = float(trade.get("pnl") or 0.0) / risk_amount

    empty = {
        "rMultiple": _round(fallback_r, 3) if fallback_r is not None else 0.0,
        "grossR": _round(fallback_r, 3) if fallback_r is not None else 0.0,
        "feeR": 0.0,
        "riskAmount": _round(risk_amount, 2),
        "riskDistance": _round(risk_distance, 6),
        "exitReason": str(trade.get("reason") or "signal_exit"),
        "ladder": [],
        "simulated": False,
    }
    if risk_distance <= 0 or entry <= 0 or amount <= 0:
        return empty

    try:
        entry_time = pd.Timestamp(trade.get("entryTime"))
        exit_time = pd.Timestamp(trade.get("exitTime"))
    except Exception:
        return empty
    index = panel.index
    entry_pos = int(index.get_indexer([entry_time])[0])
    exit_pos = int(index.get_indexer([exit_time])[0])
    if entry_pos < 0 or exit_pos < 0 or exit_pos <= entry_pos:
        return empty

    high = panel.high[symbol].to_numpy(dtype=float)
    low = panel.low[symbol].to_numpy(dtype=float)
    close = panel.close[symbol].to_numpy(dtype=float)
    n = len(index)
    exit_pos = min(exit_pos, n - 1)

    take_profits = [entry + direction * k * risk_distance for k in targets]
    fraction = 1.0 / max(1, len(targets))
    remaining = 1.0
    realised = 0.0
    hit = [False] * len(targets)
    ladder: list[dict[str, Any]] = [
        {
            "target": f"TP{index_ + 1}",
            "rMultiple": float(target),
            "fraction": round(fraction, 4),
            "price": _round(price, 6),
            "hit": False,
            "time": None,
        }
        for index_, (target, price) in enumerate(zip(targets, take_profits))
    ]
    stop_price = entry - direction * risk_distance
    initial_stop = stop_price
    exit_reason = "signal"

    for position in range(entry_pos + 1, exit_pos + 1):
        bar_high = high[position]
        bar_low = low[position]
        stamp = pd.Timestamp(index[position])

        if direction > 0:
            stop_touched = bar_low <= stop_price
            target_prices = take_profits
            target_touched = [bar_high >= price for price in target_prices]
        else:
            stop_touched = bar_high >= stop_price
            target_prices = take_profits
            target_touched = [bar_low <= price for price in target_prices]

        # Conservative intra-bar assumption: the stop is checked before targets.
        if stop_touched:
            realised += remaining * ((stop_price - entry) * direction / risk_distance)
            if abs(stop_price - initial_stop) < 1e-12:
                exit_reason = "stop"
            else:
                exit_reason = "breakeven" if abs(stop_price - entry) < 1e-9 else "trail"
            remaining = 0.0
            break

        for level, touched in enumerate(target_touched):
            if hit[level] or remaining <= 0:
                continue
            # A later target cannot fill without the earlier ones filling too.
            if not touched:
                break
            portion = remaining if level == len(targets) - 1 else min(fraction, remaining)
            realised += portion * targets[level]
            remaining = max(0.0, remaining - portion)
            hit[level] = True
            ladder[level]["hit"] = True
            ladder[level]["time"] = stamp.isoformat()
            if level == 0:
                stop_price = entry
            elif level == 1:
                stop_price = take_profits[0]
            if remaining <= 0:
                exit_reason = f"tp{level + 1}"
                break
        if remaining <= 0:
            break

    if remaining > 0:
        fill = exit_price if exit_price > 0 else float(close[exit_pos])
        realised += remaining * ((fill - entry) * direction / risk_distance)
        if exit_reason == "signal":
            exit_reason = str(trade.get("reason") or "signal_exit")

    if all(hit) and remaining <= 0:
        exit_reason = f"tp{len(targets)}"
    fee_r = _fee_r(trade, risk_amount)
    net = realised - fee_r
    return {
        "rMultiple": _round(net, 3),
        "grossR": _round(realised, 3),
        "feeR": _round(fee_r, 3),
        "riskAmount": _round(risk_amount, 2),
        "riskDistance": _round(risk_distance, 6),
        "exitReason": exit_reason,
        "ladder": ladder,
        "simulated": True,
    }


# ---------------------------------------------------------------------------
# signal explainability
# ---------------------------------------------------------------------------


def _fmt_price(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "—"
    if number >= 1000:
        return f"{number:,.0f}"
    if number >= 10:
        return f"{number:,.2f}"
    return f"{number:,.4f}"


def _signal_context(panel: CandlePanel, spec: StrategySpec, weights: pd.Series) -> dict[str, Any]:
    model = spec.model
    params = dict(spec.params or {})
    close = panel.close[panel.symbols[0]]
    latest_price = close.iloc[-1]
    position = float(weights.reindex(close.index).fillna(0.0).iloc[-1]) if len(weights) else 0.0
    checks: list[dict[str, Any]] = []

    def check(label: str, value: str, status: str = "info") -> None:
        checks.append({"label": label, "value": value, "status": status})

    state = "long" if position > 0 else "short" if position < 0 else "waiting"
    detail = "Flat and scanning the latest candle."

    def average(kind: str, period: int) -> pd.Series:
        return sma(close, period) if kind == "sma" else ema(close, period)

    if model in {"sma_cross", "ema_cross", "vol_target_trend"}:
        kind = "sma" if model != "ema_cross" else "ema"
        fast_period = int(params.get("fast") or 20)
        slow_period = int(params.get("slow") or 60)
        fast = average(kind, fast_period)
        slow = average(kind, slow_period)
        fast_last, slow_last = float(fast.iloc[-1]), float(slow.iloc[-1])
        check(f"{kind.upper()}({fast_period})", _fmt_price(fast_last))
        check(f"{kind.upper()}({slow_period})", _fmt_price(slow_last))
        bullish = fast_last > slow_last
        check("Trend filter", "bullish" if bullish else "bearish", "pass" if bullish else "fail")
        if model == "vol_target_trend":
            target = float(params.get("target_vol") or 0.18) * 100
            window = int(params.get("vol_window") or 30)
            vol = realized_volatility(close, window=window, periods_per_year=365)
            vol_last = float(vol.iloc[-1]) * 100 if len(vol) else 0.0
            check(f"Realised vol ({window})", f"{vol_last:.1f}%")
            check("Vol target", f"{target:.0f}%")
            detail = (
                f"Fast average is {'above' if bullish else 'below'} the slow average, so exposure is "
                f"{'scaled to' if bullish else 'held off from'} the {target:.0f}% volatility target."
            )
        else:
            detail = (
                f"Fast {kind.upper()} is {'above' if bullish else 'below'} the slow average — "
                + ("the long trigger is active." if bullish else "waiting for an upward cross.")
            )
        if position > 0:
            state = "long"
        elif position < 0:
            state = "short"
        elif bullish:
            state = "ready"
        else:
            state = "waiting"
    elif model == "macd_trend":
        fast = int(params.get("fast") or 12)
        slow = int(params.get("slow") or 26)
        signal_period = int(params.get("signal") or 9)
        frame = macd(close, fast_period=fast, slow_period=slow, signal_period=signal_period)
        line = float(frame["macd"].iloc[-1])
        signal_line = float(frame["signal"].iloc[-1])
        histogram = float(frame["histogram"].iloc[-1])
        check("MACD line", _fmt_price(line))
        check("Signal line", _fmt_price(signal_line))
        check("Histogram", f"{histogram:+.4f}", "pass" if histogram >= 0 else "fail")
        bullish = line > signal_line
        detail = (
            "MACD is above its signal line — momentum confirmation is active."
            if bullish
            else "MACD is below its signal line — waiting for a bullish cross."
        )
        state = "long" if position > 0 else ("ready" if bullish else "waiting")
    elif model == "rsi_reversion":
        period = int(params.get("period") or 14)
        oversold = float(params.get("oversold") or 30)
        exit_level = float(params.get("exit_level") or 55)
        series = rsi(close, period)
        value = float(series.iloc[-1])
        check(f"RSI({period})", f"{value:.1f}")
        check("Entry threshold", f"≤ {oversold:.0f}", "pass" if value <= oversold else "fail")
        check("Exit threshold", f"≥ {exit_level:.0f}", "pass" if value >= exit_level else "fail")
        if position > 0:
            detail = f"Long while RSI recovers toward {exit_level:.0f}; currently {value:.1f}."
            state = "long"
        elif value <= oversold:
            detail = f"RSI is {value:.1f}, below the {oversold:.0f} oversold line — entry trigger is armed."
            state = "ready"
        else:
            detail = f"RSI is {value:.1f}; needs to fall to {oversold:.0f} before the bot acts."
            state = "waiting"
    elif model == "bollinger_reversion":
        period = int(params.get("period") or 20)
        num_std = float(params.get("num_std") or 2.0)
        bands = bollinger(close, period=period, num_std=num_std)
        mid = float(bands["middle"].iloc[-1])
        lower = float(bands["lower"].iloc[-1])
        upper = float(bands["upper"].iloc[-1])
        z = (latest_price - mid) / max(upper - mid, 1e-12)
        check("Middle band", _fmt_price(mid))
        check("Lower band", _fmt_price(lower))
        check("Distance from mid", f"{z:+.2f}σ", "pass" if latest_price <= lower else "fail")
        if position > 0:
            detail = f"Long and looking for a reversion to the middle band at {_fmt_price(mid)}."
            state = "long"
        elif latest_price <= lower:
            detail = "Price closed below the lower band — the fade trigger is active."
            state = "ready"
        else:
            detail = f"Price is inside the bands; needs {_fmt_price(lower)} to trigger the fade."
            state = "waiting"
    elif model == "donchian_breakout":
        entry_window = int(params.get("entry_window") or 55)
        exit_window = int(params.get("exit_window") or 20)
        upper = rolling_high(close, entry_window).iloc[-2] if len(close) > 1 else close.iloc[-1]
        lower = rolling_low(close, exit_window).iloc[-2] if len(close) > 1 else close.iloc[-1]
        check(f"{entry_window}-bar high", _fmt_price(upper))
        check(f"{exit_window}-bar low", _fmt_price(lower))
        check("Breakout", "above" if latest_price > upper else "inside range", "pass" if latest_price > upper else "fail")
        if position > 0:
            detail = f"Long; exit triggers below the {exit_window}-bar low at {_fmt_price(lower)}."
            state = "long"
        elif latest_price > upper:
            detail = f"Price is above the {entry_window}-bar high at {_fmt_price(upper)} — breakout trigger active."
            state = "ready"
        else:
            detail = f"Price is inside the range; breakout level is {_fmt_price(upper)}."
            state = "waiting"
    else:
        check("Latest weight", f"{position:+.1%}")
        detail = "Signal engine active; the latest target weight determines participation."

    label = {
        "long": "LONG",
        "short": "SHORT",
        "ready": "TRIGGER ARMED",
        "waiting": "WAITING",
    }.get(state, state.upper())
    return {
        "state": state,
        "label": label,
        "detail": detail,
        "checks": checks,
        "lastPrice": _round(latest_price, 6),
        "lastWeight": _round(position, 4),
    }


# ---------------------------------------------------------------------------
# public entry point
# ---------------------------------------------------------------------------


def run_arena(
    config: BacktestConfig,
    panel: CandlePanel,
    *,
    bots: Iterable[Mapping[str, Any]] | None = None,
    risk_percent: float = 2.0,
    targets: Sequence[float] = (1.0, 2.0, 3.0),
    max_trades: int = 24,
) -> dict[str, Any]:
    """Run every arena bot on the same panel and build the scoreboard."""

    if not 0 < risk_percent <= 25:
        raise BacktestError("arena riskPercent must be in (0, 25]")
    selected = list(bots or ARENA_BOTS)
    if not selected:
        raise BacktestError("arena requires at least one bot")
    if len(selected) > 12:
        raise BacktestError("arena supports at most 12 bots")

    entries: list[dict[str, Any]] = []
    warnings: list[str] = []
    for bot in selected:
        model = str(bot.get("model") or "sma_cross")
        params = dict(bot.get("params") or {})
        strategy = StrategySpec(model=model, params=params)
        bot_config = replace(
            config,
            strategy=strategy,
            strategy_id=str(bot.get("id") or model),
            strategy_name=str(bot.get("name") or model),
            hard_stop_enabled=True,
            hard_stop_percent=risk_percent,
            persist=False,
            tags=(),
        )
        outcome = run_engine(bot_config, panel, include_trades=True)
        warnings.extend(f"{bot_config.strategy_name}: {item}" for item in outcome.warnings)

        weights = outcome.weights.iloc[-1] if len(outcome.weights) else pd.Series(dtype=float)
        open_position = next((trade for trade in outcome.trades if trade.get("status") == "open"), None)
        closed: list[dict[str, Any]] = []
        for trade in outcome.trades:
            if trade.get("status") != "closed" or trade.get("exitPrice") is None:
                continue
            ladder = _simulate_ladder(panel, trade, risk_percent, targets)
            entry_ts = int(pd.Timestamp(trade.get("entryTime")).timestamp() * 1000)
            exit_ts = int(pd.Timestamp(trade.get("exitTime")).timestamp() * 1000)
            closed.append(
                {
                    **{key: trade.get(key) for key in (
                        "id",
                        "symbol",
                        "side",
                        "entryTime",
                        "exitTime",
                        "entryPrice",
                        "exitPrice",
                        "amount",
                        "totalValue",
                        "fee",
                        "pnl",
                        "pnlPercent",
                        "reason",
                        "holdingBars",
                    )},
                    "entryTs": entry_ts,
                    "exitTs": exit_ts,
                    **ladder,
                }
            )

        total_r = sum(float(item.get("rMultiple") or 0.0) for item in closed)
        wins = sum(1 for item in closed if float(item.get("rMultiple") or 0.0) > 0.05)
        losses = sum(1 for item in closed if float(item.get("rMultiple") or 0.0) < -0.05)
        breakeven = len(closed) - wins - losses
        gross_win = sum(float(item["rMultiple"]) for item in closed if float(item.get("rMultiple") or 0) > 0)
        gross_loss = abs(sum(float(item["rMultiple"]) for item in closed if float(item.get("rMultiple") or 0) < 0))
        metrics = outcome.metrics or {}
        nav = _downsample(outcome.net_nav, 80)
        equity_curve = [
            {"time": _time_label(nav.index, position), "equity": _round(value, 2)}
            for position, value in enumerate(nav.to_numpy(dtype=float))
        ]
        last_trade = closed[-1] if closed else None
        signal = _signal_context(panel, strategy, weights)
        entries.append(
            {
                "id": str(bot.get("id") or model),
                "name": str(bot.get("name") or model),
                "tagline": str(bot.get("tagline") or ""),
                "family": str(bot.get("family") or ""),
                "model": model,
                "params": params,
                "color": str(bot.get("color") or "#34d399"),
                "rule": str(bot.get("rule") or "Rule set from the strategy registry."),
                "scoreR": _round(total_r, 2),
                "avgR": _round(total_r / len(closed), 2) if closed else 0.0,
                "wins": wins,
                "losses": losses,
                "breakeven": breakeven,
                "winRate": _round(wins / len(closed) * 100, 1) if closed else 0.0,
                "profitFactorR": _round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
                "totalTrades": len(closed),
                "openTrades": sum(1 for trade in outcome.trades if trade.get("status") == "open"),
                "totalReturnPercent": _round(metrics.get("totalReturnPercent"), 2),
                "maxDrawdownPercent": _round(metrics.get("maxDrawdownPercent"), 2),
                "sharpeRatio": _round(metrics.get("sharpeRatio"), 2),
                "exposurePercent": _round(metrics.get("exposurePercent"), 1),
                "equityCurve": equity_curve,
                "trades": [
                    item for item in closed[-max_trades:]
                ],
                "lastTrade": last_trade,
                "openPosition": (
                    {
                        **{key: open_position.get(key) for key in (
                            "id",
                            "symbol",
                            "side",
                            "entryTime",
                            "entryPrice",
                            "amount",
                            "pnl",
                            "pnlPercent",
                            "holdingBars",
                        )},
                        "riskAmount": _round(
                            float(open_position.get("entryPrice") or 0)
                            * abs(float(open_position.get("amount") or 0))
                            * risk_percent
                            / 100.0,
                            2,
                        ),
                    }
                    if open_position
                    else None
                ),
                "signal": signal,
                "status": "in-position" if open_position else "scanning",
            }
        )

    entries.sort(key=lambda item: (float(item["scoreR"] or 0), float(item["totalReturnPercent"] or 0)), reverse=True)
    for rank, entry in enumerate(entries, start=1):
        entry["rank"] = rank

    tape: list[dict[str, Any]] = []
    for entry in entries:
        for trade in entry["trades"]:
            tape.append(
                {
                    "botId": entry["id"],
                    "botName": entry["name"],
                    "color": entry["color"],
                    "symbol": trade.get("symbol"),
                    "side": trade.get("side"),
                    "entryTime": trade.get("entryTime"),
                    "exitTime": trade.get("exitTime"),
                    "entryPrice": trade.get("entryPrice"),
                    "exitPrice": trade.get("exitPrice"),
                    "rMultiple": trade.get("rMultiple"),
                    "exitReason": trade.get("exitReason"),
                }
            )
    tape.sort(key=lambda item: str(item.get("exitTime") or ""), reverse=True)

    close = panel.close[panel.symbols[0]]
    period_start, period_end = panel.index[0], panel.index[-1]
    period_label = (
        f"{pd.Timestamp(period_start).strftime('%d %b %Y %H:%M')} → "
        f"{pd.Timestamp(period_end).strftime('%d %b %Y %H:%M')} UTC"
    )
    return {
        "kind": "arena",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "symbols": list(panel.symbols),
        "assetPair": panel.symbols[0],
        "interval": config.interval_minutes,
        "periodLabel": period_label,
        "totalCandles": int(len(panel.index)),
        "source": panel.source,
        "engine": {
            "engine": "quantjourney-bt",
            "mode": "weights",
            "execution": "one-bar delay",
            "costModel": "fixed bps (fee + slippage)",
            "feeBps": config.fee_bps,
            "slippageBps": config.slippage_bps,
        },
        "scoring": {
            "metric": "realised R",
            "basis": "closed trades only",
            "riskPercent": risk_percent,
            "ladder": list(targets),
            "ladderSizing": "equal thirds; stop → break-even after TP1, → TP1 after TP2",
        },
        "priceSeries": _price_series(panel),
        "bots": entries,
        "leaderboard": [
            {
                "rank": entry["rank"],
                "id": entry["id"],
                "name": entry["name"],
                "color": entry["color"],
                "scoreR": entry["scoreR"],
                "wins": entry["wins"],
                "losses": entry["losses"],
                "winRate": entry["winRate"],
                "trades": entry["totalTrades"],
            }
            for entry in entries
        ],
        "tradeTape": tape[:40],
        "notes": list(ARENA_NOTES),
        "warnings": warnings,
        "assumptions": {
            "dataSource": panel.source,
            "initialCapital": config.initial_capital,
            "riskPercent": risk_percent,
            "feeBps": config.fee_bps,
            "slippageBps": config.slippage_bps,
            "fillTiming": "one-bar execution delay",
            "lastPrice": _round(close.iloc[-1], 6),
        },
        "elapsedSeconds": None,
    }
