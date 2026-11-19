"""Performance analytics for the QuantJourney backtesting workflow.

Primary statistics come from ``quantjourney_bt.portfolio.portf_calc`` when the
distribution is installed.  Every metric has a deterministic local fallback so
reports remain complete in minimal environments.
"""

from __future__ import annotations

import math
from typing import Any, Sequence

import numpy as np
import pandas as pd

from app.backtest.qj_runtime import qj_available


def drawdown_series(nav: pd.Series) -> pd.Series:
    nav = nav.astype(float)
    peak = nav.cummax()
    return (nav / peak - 1.0).fillna(0.0)


def max_drawdown(nav: pd.Series) -> tuple[float, str | None, str | None]:
    dd = drawdown_series(nav)
    if dd.empty:
        return 0.0, None, None
    trough = dd.idxmin()
    peak = nav.loc[:trough].idxmax() if trough is not None else None
    return float(dd.min()), _iso(peak), _iso(trough)


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return pd.Timestamp(value).isoformat()
    except Exception:
        return str(value)


def _safe(value: Any, default: float | None = None) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(number) or math.isinf(number):
        return default
    return number


def performance_metrics(
    net_nav: pd.Series,
    returns: pd.Series,
    *,
    periods_per_year: int,
    weights: pd.DataFrame | None = None,
    risk_free_rate: float = 0.0,
    qj_calculator: Any | None = None,
) -> dict[str, Any]:
    """Compute the metric block shared by runs, folds and trials."""

    returns = returns.astype(float).fillna(0.0)
    nav = net_nav.astype(float).dropna()
    if nav.empty:
        return {}
    initial = float(nav.iloc[0])
    final = float(nav.iloc[-1])
    total_return = final / initial - 1.0 if initial else 0.0
    periods = max(len(returns) - 1, 1)
    years = periods / max(1, periods_per_year)
    annualization_horizon = max(years, 1.0)
    cagr_annualized = years >= 1.0
    cagr = (
        (final / initial) ** (1 / annualization_horizon) - 1
        if initial > 0 and final > 0
        else np.nan
    )

    std = float(returns.std(ddof=1)) if len(returns) > 2 else 0.0
    annual_vol = std * math.sqrt(periods_per_year)
    excess = returns - risk_free_rate / periods_per_year
    sharpe = float(excess.mean() / std * math.sqrt(periods_per_year)) if std > 0 else 0.0
    downside = excess[excess < 0]
    downside_std = float(np.sqrt((downside**2).mean())) if len(downside) else 0.0
    sortino = float(excess.mean() / downside_std * math.sqrt(periods_per_year)) if downside_std > 0 else 0.0
    mdd, peak_ts, trough_ts = max_drawdown(nav)
    calmar = float(cagr / abs(mdd)) if mdd < 0 and math.isfinite(cagr) else 0.0
    ulcer = float(np.sqrt((drawdown_series(nav) ** 2).mean())) if len(nav) else 0.0
    recovery = float(total_return / abs(mdd)) if mdd < 0 else 0.0

    var95 = float(np.quantile(returns, 0.05)) if len(returns) > 10 else 0.0
    tail = returns[returns <= var95]
    cvar95 = float(tail.mean()) if len(tail) else var95
    bar_win_rate = float((returns > 0).mean() * 100) if len(returns) else 0.0

    if qj_calculator is not None:
        sharpe_qj = _safe(qj_calculator.compute_sharpe_ratio(), None)
        sortino_qj = _safe(qj_calculator.compute_sortino_ratio(), None)
        mdd_qj = _safe(qj_calculator.compute_max_drawdown(), None)
        annual_qj = _safe(qj_calculator.compute_annualized_return(), None)
        if sharpe_qj is not None:
            sharpe = sharpe_qj
        if sortino_qj is not None:
            sortino = sortino_qj
        if mdd_qj is not None:
            mdd = mdd_qj
        if annual_qj is not None and math.isfinite(annual_qj) and cagr_annualized:
            cagr = annual_qj

    if math.isfinite(cagr):
        calmar = float(cagr / abs(mdd)) if mdd < 0 else 0.0

    turnover = None
    avg_gross = None
    if weights is not None and len(weights) > 1:
        gross_change = weights.diff().abs().sum(axis=1).fillna(0.0)
        turnover = float(gross_change.sum())
        avg_gross = float(weights.abs().sum(axis=1).mean())
    elif qj_calculator is not None:
        turnover_info = qj_calculator.compute_advanced_turnover()
        turnover = _safe(turnover_info.get("total_turnover_ratio"), None)

    metrics = {
        "initialCapital": initial,
        "finalCapital": final,
        "totalReturnUSD": final - initial,
        "totalReturnPercent": total_return * 100,
        "cagrPercent": (cagr * 100) if math.isfinite(cagr) else None,
        "annualizedVolatilityPercent": annual_vol * 100,
        "sharpeRatio": sharpe,
        "sortinoRatio": sortino,
        "calmarRatio": calmar,
        "maxDrawdownPercent": abs(mdd) * 100,
        "maxDrawdownUSD": abs(mdd) * initial,
        "maxDrawdownPeak": peak_ts,
        "maxDrawdownTrough": trough_ts,
        "ulcerIndex": ulcer,
        "recoveryFactor": recovery,
        "var95Percent": var95 * 100,
        "cvar95Percent": cvar95 * 100,
        "barWinRatePercent": bar_win_rate,
        "skewness": float(returns.skew()) if len(returns) > 3 else 0.0,
        "kurtosis": float(returns.kurtosis()) if len(returns) > 3 else 0.0,
        "bestBarPercent": float(returns.max() * 100) if len(returns) else 0.0,
        "worstBarPercent": float(returns.min() * 100) if len(returns) else 0.0,
        "turnoverRatio": turnover,
        "averageGrossExposurePercent": (avg_gross * 100) if avg_gross is not None else None,
        "periodsPerYear": periods_per_year,
        "observations": int(len(returns)),
        "calendarYears": years,
        "cagrAnnualized": cagr_annualized,
        "annualizationNote": (
            None
            if cagr_annualized
            else "sample shorter than one year: CAGR and Calmar use the total-return horizon instead of extrapolating"
        ),
    }
    return metrics


def benchmark_metrics(
    strategy_returns: pd.Series,
    benchmark_returns: pd.Series,
    *,
    periods_per_year: int,
) -> dict[str, Any]:
    """Alpha/beta and relative performance against the benchmark."""

    aligned = pd.concat(
        [strategy_returns.rename("strategy"), benchmark_returns.rename("benchmark")], axis=1
    ).dropna()
    if len(aligned) < 3:
        return {
            "alphaPercent": None,
            "beta": None,
            "correlation": None,
            "informationRatio": None,
            "benchmarkReturnPercent": _compound(benchmark_returns) * 100,
        }
    cov = float(aligned["strategy"].cov(aligned["benchmark"]))
    variance = float(aligned["benchmark"].var(ddof=1))
    beta = cov / variance if variance > 0 else 0.0
    active = aligned["strategy"] - aligned["benchmark"]
    tracking_error = float(active.std(ddof=1))
    effective_periods = periods_per_year if len(aligned) >= periods_per_year else len(aligned)
    alpha_bar = float(aligned["strategy"].mean() - beta * aligned["benchmark"].mean())
    alpha_annual = alpha_bar * effective_periods
    information_ratio = (
        float(active.mean() / tracking_error * math.sqrt(effective_periods)) if tracking_error > 0 else 0.0
    )
    correlation = float(aligned["strategy"].corr(aligned["benchmark"])) if variance > 0 else 0.0
    return {
        "alphaPercent": alpha_annual * 100,
        "beta": beta,
        "correlation": correlation,
        "informationRatio": information_ratio,
        "trackingErrorPercent": tracking_error * math.sqrt(effective_periods) * 100,
        "benchmarkReturnPercent": _compound(benchmark_returns) * 100,
    }


def _compound(returns: pd.Series) -> float:
    returns = returns.astype(float).fillna(0.0)
    if returns.empty:
        return 0.0
    return float((1 + returns).prod() - 1)


def trade_statistics(trades: Sequence[dict[str, Any]], *, initial_capital: float) -> dict[str, Any]:
    closed = [trade for trade in trades if str(trade.get("status")) == "closed"]
    wins = [trade for trade in closed if float(trade.get("pnl", 0.0)) > 0]
    losses = [trade for trade in closed if float(trade.get("pnl", 0.0)) <= 0]
    gross_profit = sum(float(trade.get("pnl", 0.0)) for trade in wins)
    gross_loss = abs(sum(float(trade.get("pnl", 0.0)) for trade in losses))
    total_fees = sum(float(trade.get("fee", 0.0)) for trade in trades)
    average = float(np.mean([float(t.get("pnl", 0.0)) for t in closed])) if closed else 0.0
    average_percent = (
        float(np.mean([float(t.get("pnlPercent", 0.0)) for t in closed])) if closed else 0.0
    )
    hold = [float(t.get("holdingBars") or 0) for t in closed]
    return {
        "totalTrades": len(closed),
        "openTrades": len([trade for trade in trades if str(trade.get("status")) == "open"]),
        "winningTrades": len(wins),
        "losingTrades": len(losses),
        "winRate": (len(wins) / len(closed) * 100) if closed else 0.0,
        "profitFactor": (gross_profit / gross_loss) if gross_loss > 0 else (gross_profit if gross_profit else 0.0),
        "averageTradeUSD": average,
        "averageTradeReturnPercent": average_percent,
        "bestTradeUSD": max((float(t.get("pnl", 0.0)) for t in closed), default=0.0),
        "worstTradeUSD": min((float(t.get("pnl", 0.0)) for t in closed), default=0.0),
        "averageHoldBars": float(np.mean(hold)) if hold else 0.0,
        "totalFeesUSD": total_fees,
        "expectancyUSD": average,
        "expectancyPercentOfCapital": (average / initial_capital * 100) if initial_capital else 0.0,
    }
