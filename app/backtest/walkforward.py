"""Walk-forward validation, parameter optimisation and cost stress tests.

The workflow follows QuantJourney's research protocol:

1. split the bar history into rolling/expanding train and out-of-sample folds
   with an explicit purge gap;
2. refit strategy parameters on each train window using grid search;
3. evaluate the selected parameters on the untouched OOS window;
4. stitch the OOS segments into one equity path and report transfer
   diagnostics (efficiency, overfit ratio, Sharpe decay, rank stability);
5. deflate the selected Sharpe for multiple testing using the QJ statistics
   module (Bailey & López de Prado).

All statistics use the QuantJourney implementations when installed, with
transparent fallbacks otherwise.
"""

from __future__ import annotations

import math
import time
from dataclasses import replace
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from app.backtest.config import (
    BacktestConfig,
    BacktestError,
    OptimizeSpec,
    StressSpec,
    WalkForwardSpec,
    _expand_grid,
)
from app.backtest.data import CandlePanel
from app.backtest.engine import EngineOutcome, fold_metrics, resolve_metric_series, run_engine
from app.backtest.metrics import drawdown_series, performance_metrics, trade_statistics
from app.backtest.qj_runtime import qj_runtime_info

OBJECTIVE_KEYS = {
    "sharpe": "sharpeRatio",
    "sortino": "sortinoRatio",
    "calmar": "calmarRatio",
    "total_return": "totalReturnPercent",
    "cagr": "cagrPercent",
    "profit_factor": "profitFactor",
}


def _score(metrics: Mapping[str, Any], objective: str) -> float:
    key = OBJECTIVE_KEYS.get(objective, "sharpeRatio")
    value = metrics.get(key)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return -1e9
    if not math.isfinite(number):
        return -1e9
    # Penalise strategies that never hold a position so the optimiser cannot
    # "win" by taking no risk at all.
    exposure = metrics.get("exposurePercent")
    if exposure is None or float(exposure or 0.0) <= 0.0:
        return number - 1e4
    return number


def _slice_positions(panel: CandlePanel, start: int, end: int) -> CandlePanel:
    """Inclusive-start, exclusive-end positional slice."""

    if start < 0 or end > panel.n_bars or start >= end:
        raise BacktestError(f"invalid fold slice [{start}, {end}) for {panel.n_bars} bars")
    start_ts = panel.index[start]
    end_ts = panel.index[end - 1]
    sliced = panel.slice(start=start_ts, end=end_ts)
    if sliced.n_bars < 2:
        raise BacktestError("fold slice has fewer than two bars")
    return sliced


def _fold_metrics_block(outcome: EngineOutcome) -> dict[str, Any]:
    block = fold_metrics(outcome)
    block["sharpe"] = block.get("sharpeRatio")
    block["annReturn"] = block.get("cagrPercent")
    block["annualVolatility"] = block.get("annualizedVolatilityPercent")
    block["maxDrawdown"] = block.get("maxDrawdownPercent")
    return block


def _equity_from_returns(returns: pd.Series, initial_capital: float) -> pd.Series:
    returns = returns.fillna(0.0).astype(float)
    return initial_capital * (1.0 + returns).cumprod()


def _stitch_oos_returns(folds: Sequence[Mapping[str, Any]]) -> pd.Series:
    pieces: list[pd.Series] = []
    for fold in folds:
        series = fold.get("_oos_returns")
        if series is None or len(series) == 0:
            continue
        pieces.append(series)
    if not pieces:
        return pd.Series(dtype=float)
    stitched = pd.concat(pieces)
    stitched = stitched[~stitched.index.duplicated(keep="first")].sort_index()
    return stitched


def _wf_statistics_from_qj(
    *,
    fold_logits: Sequence[float],
    fold_dsr: Sequence[float],
    trial_sharpes: Sequence[float],
    observed_sr: float,
    n_obs: int,
    oos_sharpe: float,
    efficiency: float | None,
    overfit_ratio: float | None,
    sharpe_decay: float | None,
    n_folds: int,
) -> dict[str, Any]:
    info = qj_runtime_info()
    stats: dict[str, Any] = {
        "deflatedSharpe": None,
        "deflatedSharpeReason": "quantjourney-bt not installed" if not info["available"] else None,
        "rankStabilityFailureRate": None,
        "rankStabilityReason": None,
        "verdicts": [],
    }
    if not info["available"]:
        return stats
    try:
        from backtester.walkforward.statistics.deflated_sharpe import deflated_sharpe
        from backtester.walkforward.statistics.interpretation import interpret_metrics
        from backtester.walkforward.statistics.pbo import (
            selected_trial_rank_logit,
            walk_forward_top_k_rank_failure_rate,
        )
    except Exception as exc:  # pragma: no cover - optional imports
        stats["deflatedSharpeReason"] = f"QJ statistics unavailable: {exc}"
        return stats

    if trial_sharpes and len(trial_sharpes) > 1:
        try:
            stats["deflatedSharpe"] = float(
                deflated_sharpe(
                    trial_sharpes=list(trial_sharpes),
                    observed_sr=observed_sr,
                    n_obs=max(2, n_obs),
                )
            )
            stats["deflatedSharpeMethod"] = "pooled walk-forward trials (per-period Sharpe)"
        except Exception as exc:
            stats["deflatedSharpeReason"] = str(exc)
    elif fold_dsr:
        stats["deflatedSharpe"] = float(np.mean(fold_dsr))
        stats["deflatedSharpeMethod"] = "mean per-fold DSR"
    else:
        stats["deflatedSharpeReason"] = stats["deflatedSharpeReason"] or "no completed trials"

    if fold_logits:
        try:
            stats["rankStabilityFailureRate"] = float(walk_forward_top_k_rank_failure_rate(list(fold_logits)))
        except Exception as exc:
            stats["rankStabilityReason"] = str(exc)
    else:
        stats["rankStabilityReason"] = "top-K OOS re-checks unavailable (single trial per fold)"

    try:
        verdicts = interpret_metrics(
            {
                "overfit_ratio": overfit_ratio,
                "efficiency": efficiency,
                "sharpe_decay": sharpe_decay,
                "deflated_sharpe": stats.get("deflatedSharpe"),
                "composite_sharpe": oos_sharpe,
                "n_folds": n_folds,
            }
        )
        stats["verdicts"] = [
            {
                "name": verdict.name,
                "value": verdict.value,
                "signal": getattr(verdict.signal, "value", verdict.signal),
                "description": verdict.description,
            }
            for verdict in verdicts
        ]
    except Exception as exc:  # pragma: no cover - defensive
        stats["verdictReason"] = str(exc)
    return stats


def run_walk_forward(
    config: BacktestConfig,
    panel: CandlePanel,
    spec: WalkForwardSpec,
    *,
    run_id: str,
) -> dict[str, Any]:
    """Execute bar-based walk-forward validation with optional refit."""

    started = time.time()
    train, test, step, purge = spec.resolved_geometry(config, panel.n_bars)
    grid = _expand_grid(spec.param_grid, spec.max_trials) if spec.param_grid else []
    if not grid:
        grid = [{}]
    if not spec.refit:
        grid = [{}]

    folds: list[dict[str, Any]] = []
    fold_logits: list[float] = []
    fold_dsr: list[float] = []
    trial_sharpes: list[float] = []
    fold_index = 0
    start = 0
    base_nav = config.initial_capital
    while True:
        train_end = start + train
        test_start = train_end + purge
        test_end = test_start + test
        if test_end > panel.n_bars:
            break
        expanding_start = 0 if spec.scheme == "expanding" else start
        train_panel = _slice_positions(panel, expanding_start, train_end)
        test_panel = _slice_positions(panel, test_start, test_end)
        fold_record: dict[str, Any] = {
            "fold": fold_index,
            "trainStart": train_panel.start,
            "trainEnd": train_panel.end,
            "testStart": test_panel.start,
            "testEnd": test_panel.end,
            "trainBars": train_panel.n_bars,
            "testBars": test_panel.n_bars,
            "status": "ok",
        }
        try:
            trials: list[dict[str, Any]] = []
            best_params: dict[str, Any] = {}
            best_outcome: EngineOutcome | None = None
            best_score = -1e18
            for params in grid:
                candidate = config.with_overrides(strategy_params=params)
                outcome = run_engine(
                    candidate,
                    train_panel,
                    include_trades=False,
                    keep_portfolio_data=False,
                )
                score = _score(outcome.metrics, spec.objective)
                trials.append({"params": params, "score": score, "metrics": _fold_metrics_block(outcome)})
                if score > best_score:
                    best_score = score
                    best_params = params
                    best_outcome = outcome
            trials.sort(key=lambda item: item["score"], reverse=True)
            if best_outcome is None:
                raise BacktestError("no trial produced a valid outcome")

            oos_config = config.with_overrides(strategy_params=best_params)
            oos_outcome = run_engine(
                oos_config,
                test_panel,
                include_trades=True,
                keep_portfolio_data=False,
            )
            fold_record.update(
                {
                    "bestParams": best_params,
                    "inSample": _fold_metrics_block(best_outcome),
                    "outOfSample": _fold_metrics_block(oos_outcome),
                    "trials": len(trials),
                    "topTrials": [
                        {"params": trial["params"], "score": trial["score"]} for trial in trials[:3]
                    ],
                    "_oos_returns": oos_outcome.net_returns,
                    "_oos_benchmark": oos_outcome.benchmark_returns,
                    "_oos_trades": oos_outcome.trades,
                }
            )
            is_sharpe = float(best_outcome.metrics.get("sharpeRatio") or 0.0)
            oos_sharpe = float(oos_outcome.metrics.get("sharpeRatio") or 0.0)
            fold_record["efficiency"] = (oos_sharpe / is_sharpe) if is_sharpe > 0 else None
            fold_record["overfitRatio"] = (is_sharpe / oos_sharpe) if oos_sharpe > 0 else None

            # Top-K OOS re-check for rank stability (QJ diagnostic).
            runner_ups = trials[1 : 1 + min(3, max(0, len(trials) - 1))]
            candidate_values: list[float] = []
            selected_value: float | None = None
            if runner_ups:
                for trial in runner_ups:
                    runner_outcome = run_engine(
                        config.with_overrides(strategy_params=trial["params"]),
                        test_panel,
                        include_trades=False,
                        keep_portfolio_data=False,
                    )
                    value = _score(runner_outcome.metrics, spec.objective)
                    candidate_values.append(value)
                    if trial["params"] == best_params:
                        selected_value = value
                selected_value = _score(oos_outcome.metrics, spec.objective)
                candidate_values.append(selected_value)
                try:
                    from backtester.walkforward.statistics.pbo import selected_trial_rank_logit

                    logit = selected_trial_rank_logit(selected_value, candidate_values)
                    if logit is not None:
                        fold_logits.append(float(logit))
                        fold_record["rankStabilityLogit"] = float(logit)
                except Exception:
                    pass

            if len(trials) > 1:
                try:
                    from backtester.walkforward.statistics.deflated_sharpe import deflated_sharpe

                    ppy = config.resolved_periods_per_year
                    sharpes = [
                        float(trial["metrics"].get("sharpeRatio") or 0.0) / math.sqrt(ppy)
                        for trial in trials
                        if trial["metrics"].get("sharpeRatio") is not None
                    ]
                    trial_sharpes.extend(sharpes)
                    dsr = deflated_sharpe(
                        trial_sharpes=sharpes,
                        observed_sr=float(oos_outcome.metrics.get("sharpeRatio") or 0.0) / math.sqrt(ppy),
                        n_obs=max(2, len(oos_outcome.net_returns)),
                        skewness=float(oos_outcome.net_returns.skew()) if len(oos_outcome.net_returns) > 3 else 0.0,
                        kurtosis=float(oos_outcome.net_returns.kurtosis() + 3.0) if len(oos_outcome.net_returns) > 3 else 3.0,
                    )
                    fold_dsr.append(dsr)
                    fold_record["deflatedSharpe"] = dsr
                except Exception:
                    pass
            base_nav *= 1.0 + float(oos_outcome.metrics.get("totalReturnPercent") or 0.0) / 100.0
            fold_record["stitchedNav"] = base_nav
        except Exception as exc:
            fold_record.update({"status": "failed", "error": str(exc)})
        folds.append(fold_record)
        fold_index += 1
        start += step

    completed = [fold for fold in folds if fold.get("status") == "ok"]
    if not completed:
        raise BacktestError("walk-forward produced no valid folds; reduce the train/test windows")

    oos_returns = _stitch_oos_returns(completed)
    oos_nav = _equity_from_returns(oos_returns, config.initial_capital)
    metric_nav, metric_returns, metric_ppy, metric_frequency = resolve_metric_series(
        oos_nav, oos_returns, config.interval_minutes
    )
    oos_metrics = performance_metrics(
        metric_nav,
        metric_returns,
        periods_per_year=metric_ppy,
    )
    oos_metrics["metricFrequency"] = metric_frequency
    oos_trades: list[dict[str, Any]] = []
    benchmark_pieces: list[pd.Series] = []
    for fold in completed:
        oos_trades.extend(fold.get("_oos_trades", []) or [])
        bench = fold.get("_oos_benchmark")
        if bench is not None and len(bench):
            benchmark_pieces.append(bench)
    oos_metrics.update(trade_statistics(oos_trades, initial_capital=config.initial_capital))

    is_sharpes = [float((fold["inSample"] or {}).get("sharpeRatio") or 0.0) for fold in completed]
    oos_sharpes = [float((fold["outOfSample"] or {}).get("sharpeRatio") or 0.0) for fold in completed]
    mean_is = float(np.mean(is_sharpes)) if is_sharpes else 0.0
    mean_oos = float(np.mean(oos_sharpes)) if oos_sharpes else 0.0
    efficiency = (mean_oos / mean_is) if mean_is > 0 else None
    overfit_ratio = (mean_is / mean_oos) if mean_oos > 0 else None
    fold_positions = np.arange(len(oos_sharpes), dtype=float)
    sharpe_decay = (
        float(np.polyfit(fold_positions, np.asarray(oos_sharpes), 1)[0]) if len(oos_sharpes) >= 2 else 0.0
    )
    consistency = float(
        np.mean([float((fold["outOfSample"] or {}).get("totalReturnPercent") or 0.0) > 0 for fold in completed]) * 100
    )
    observed_per_period = float(oos_metrics.get("sharpeRatio") or 0.0) / math.sqrt(config.resolved_periods_per_year)
    stats = _wf_statistics_from_qj(
        fold_logits=fold_logits,
        fold_dsr=fold_dsr,
        trial_sharpes=trial_sharpes,
        observed_sr=observed_per_period,
        n_obs=len(oos_returns),
        oos_sharpe=float(oos_metrics.get("sharpeRatio") or 0.0),
        efficiency=efficiency,
        overfit_ratio=overfit_ratio,
        sharpe_decay=sharpe_decay,
        n_folds=len(completed),
    )

    warnings: list[str] = []
    if len(completed) < 5:
        warnings.append(f"only {len(completed)} folds completed; walk-forward verdicts are indicative")
    if grid and spec.param_grid:
        warnings.append(
            f"parameters refit per fold from a grid of {len(grid)} combinations; in-sample selection bias is measured by DSR"
        )
    elif spec.param_grid:
        warnings.append("refit disabled; the same parameters were used in every fold")
    if purge == 0:
        warnings.append("no purge gap configured between train and test windows")
    if any(fold.get("status") == "failed" for fold in folds):
        warnings.append(f"{sum(1 for fold in folds if fold.get('status') == 'failed')} folds failed")

    benchmark_nav = None
    if benchmark_pieces:
        stitched_benchmark = pd.concat(benchmark_pieces)
        stitched_benchmark = stitched_benchmark[~stitched_benchmark.index.duplicated(keep="first")].sort_index()
        benchmark_nav = _equity_from_returns(stitched_benchmark.reindex(oos_nav.index).fillna(0.0), config.initial_capital)
    oos_drawdowns = drawdown_series(oos_nav)
    equity_rows = []
    for timestamp, value in oos_nav.items():
        equity_rows.append(
            {
                "timestamp": pd.Timestamp(timestamp).isoformat(),
                "time": pd.Timestamp(timestamp).strftime("%Y-%m-%d"),
                "price": round(float(value), 2),
                "equity": round(float(value), 2),
                "benchmarkEquity": round(float(benchmark_nav.loc[timestamp]), 2) if benchmark_nav is not None else round(float(config.initial_capital), 2),
                "drawdown": round(float(oos_drawdowns.loc[timestamp]) * 100, 4),
                "cash": 0.0,
                "assetHoldings": round(float(value), 2),
            }
        )

    def strip_private(fold: Mapping[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in fold.items() if not str(key).startswith("_")}

    clean_folds = [strip_private(fold) for fold in folds]
    return {
        "runId": run_id,
        "kind": "walkforward",
        "strategyId": config.strategy_id,
        "strategyName": config.strategy_name,
        "assetPair": " / ".join(panel.symbols),
        "symbols": panel.symbols,
        "interval": config.interval_minutes,
        "periodLabel": f"{panel.start} → {panel.end}",
        "startTime": panel.start,
        "endTime": panel.end,
        "totalCandles": panel.n_bars,
        "engine": "quantjourney-bt" if qj_runtime_info()["available"] else "native-fallback",
        "spec": spec.to_dict(),
        "geometry": {
            "scheme": spec.scheme,
            "trainBars": train,
            "testBars": test,
            "stepBars": step,
            "purgeBars": purge,
            "folds": len(completed),
            "gridSize": len(grid),
        },
        "folds": clean_folds,
        "summary": {
            "nFolds": len(completed),
            "failedFolds": len(folds) - len(completed),
            "oosSharpe": oos_metrics.get("sharpeRatio"),
            "oosCagrPercent": oos_metrics.get("cagrPercent"),
            "oosTotalReturnPercent": oos_metrics.get("totalReturnPercent"),
            "oosMaxDrawdownPercent": oos_metrics.get("maxDrawdownPercent"),
            "inSampleSharpe": mean_is,
            "meanOosSharpe": mean_oos,
            "efficiency": efficiency,
            "overfitRatio": overfit_ratio,
            "sharpeDecayPerFold": sharpe_decay,
            "consistencyPercent": consistency,
            "bestParams": completed[-1].get("bestParams") if completed else {},
            "deflatedSharpe": stats.get("deflatedSharpe"),
            "deflatedSharpeMethod": stats.get("deflatedSharpeMethod"),
            "deflatedSharpeReason": stats.get("deflatedSharpeReason"),
            "rankStabilityFailureRate": stats.get("rankStabilityFailureRate"),
            "rankStabilityReason": stats.get("rankStabilityReason"),
            "objective": spec.objective,
            "warnings": warnings,
            "verdicts": stats.get("verdicts", []),
            "elapsedSeconds": round(time.time() - started, 2),
            "oosMetrics": {key: oos_metrics.get(key) for key in OBJECTIVE_KEYS.values()},
            "data": {
                "source": panel.source,
                "symbols": panel.symbols,
                "bars": panel.n_bars,
                "start": panel.start,
                "end": panel.end,
                "intervalMinutes": panel.interval_minutes,
            },
            "strategy": {
                "model": config.strategy.model,
                "params": config.strategy.params,
            },
        },
        "equityCurve": equity_rows,
        "analytics": {
            "engine": {
                "engine": "quantjourney-bt" if qj_runtime_info()["available"] else "native-fallback",
                "version": qj_runtime_info().get("qj_backtester"),
                "mode": "walk-forward",
            },
            "metrics": oos_metrics,
            "tradeStats": {},
            "warnings": warnings,
            "data": {
                "source": panel.source,
                "symbols": panel.symbols,
                "bars": panel.n_bars,
                "start": panel.start,
                "end": panel.end,
                "intervalMinutes": panel.interval_minutes,
            },
            "strategy": {"model": config.strategy.model, "params": config.strategy.params},
        },
        "warnings": warnings,
    }


def run_optimization(
    config: BacktestConfig,
    panel: CandlePanel,
    spec: OptimizeSpec,
    *,
    run_id: str,
) -> dict[str, Any]:
    """Full-sample grid search with multiple-testing diagnostics."""

    started = time.time()
    grid = spec.expand()
    if not grid:
        raise BacktestError("optimisation grid is empty")
    baseline = run_engine(config, panel, include_trades=False, keep_portfolio_data=False)
    trials: list[dict[str, Any]] = []
    best_params: dict[str, Any] = {}
    best_outcome: EngineOutcome = baseline
    best_score = -1e18
    for params in grid:
        try:
            outcome = run_engine(
                config.with_overrides(strategy_params=params),
                panel,
                include_trades=False,
                keep_portfolio_data=False,
            )
        except Exception as exc:
            trials.append({"params": params, "status": "failed", "error": str(exc), "score": -1e9})
            continue
        score = _score(outcome.metrics, spec.objective)
        trials.append(
            {
                "params": params,
                "score": score,
                "status": "ok",
                "metrics": _fold_metrics_block(outcome),
                "sharpeRatio": outcome.metrics.get("sharpeRatio"),
                "totalReturnPercent": outcome.metrics.get("totalReturnPercent"),
                "cagrPercent": outcome.metrics.get("cagrPercent"),
                "maxDrawdownPercent": outcome.metrics.get("maxDrawdownPercent"),
                "totalTrades": outcome.metrics.get("totalTrades"),
                "profitFactor": outcome.metrics.get("profitFactor"),
                "annualizedVolatilityPercent": outcome.metrics.get("annualizedVolatilityPercent"),
            }
        )
        if score > best_score:
            best_score = score
            best_params = params
            best_outcome = outcome

    trials.sort(key=lambda item: item.get("score", -1e9), reverse=True)
    for rank, trial in enumerate(trials, start=1):
        trial["rank"] = rank
    completed = [trial for trial in trials if trial.get("status") == "ok"]

    deflated = None
    deflated_method = None
    deflated_reason = None
    if qj_runtime_info()["available"] and len(completed) > 1:
        try:
            from backtester.walkforward.statistics.deflated_sharpe import deflated_sharpe

            ppy = config.resolved_periods_per_year
            sharpes = [
                float(trial["sharpeRatio"] or 0.0) / math.sqrt(ppy)
                for trial in completed
                if trial.get("sharpeRatio") is not None
            ]
            deflated = float(
                deflated_sharpe(
                    trial_sharpes=sharpes,
                    observed_sr=float(best_outcome.metrics.get("sharpeRatio") or 0.0) / math.sqrt(ppy),
                    n_obs=max(2, len(best_outcome.net_returns)),
                    skewness=float(best_outcome.net_returns.skew()) if len(best_outcome.net_returns) > 3 else 0.0,
                    kurtosis=float(best_outcome.net_returns.kurtosis() + 3.0) if len(best_outcome.net_returns) > 3 else 3.0,
                )
            )
            deflated_method = "deflated Sharpe over all completed grid trials"
        except Exception as exc:
            deflated_reason = str(exc)
    elif not qj_runtime_info()["available"]:
        deflated_reason = "quantjourney-bt not installed"

    warnings = [
        "full-sample optimisation is in-sample by construction; validate the winner with walk-forward before deployment",
    ]
    if len(completed) < len(grid):
        warnings.append(f"{len(grid) - len(completed)} trials failed and were excluded")
    if deflated is not None and deflated < 0.8:
        warnings.append("deflated Sharpe < 0.80: the selected Sharpe is likely a false positive after multiple testing")

    best_result = None
    if best_params or completed:
        detailed = run_engine(
            config.with_overrides(strategy_params=best_params),
            panel,
            include_trades=True,
            keep_portfolio_data=False,
        )
        from app.backtest.engine import result_payload

        best_result = result_payload(detailed)
        best_result["id"] = run_id
        best_result["analytics"]["optimization"] = {
            "objective": spec.objective,
            "trials": len(completed),
            "gridSize": len(grid),
            "bestParams": best_params,
            "deflatedSharpe": deflated,
            "deflatedSharpeMethod": deflated_method,
            "deflatedSharpeReason": deflated_reason,
        }

    top_trials = [
        {
            "rank": trial.get("rank"),
            "params": trial.get("params"),
            "score": trial.get("score"),
            "sharpeRatio": trial.get("sharpeRatio"),
            "totalReturnPercent": trial.get("totalReturnPercent"),
            "cagrPercent": trial.get("cagrPercent"),
            "maxDrawdownPercent": trial.get("maxDrawdownPercent"),
            "totalTrades": trial.get("totalTrades"),
            "profitFactor": trial.get("profitFactor"),
            "annualizedVolatilityPercent": trial.get("annualizedVolatilityPercent"),
        }
        for trial in completed[:60]
    ]
    return {
        "runId": run_id,
        "kind": "optimization",
        "strategyId": config.strategy_id,
        "strategyName": config.strategy_name,
        "assetPair": " / ".join(panel.symbols),
        "symbols": panel.symbols,
        "interval": config.interval_minutes,
        "periodLabel": f"{panel.start} → {panel.end}",
        "startTime": panel.start,
        "endTime": panel.end,
        "totalCandles": panel.n_bars,
        "engine": best_result.get("engine") if best_result else None,
        "spec": spec.to_dict(),
        "summary": {
            "objective": spec.objective,
            "gridSize": len(grid),
            "completedTrials": len(completed),
            "failedTrials": len(grid) - len(completed),
            "bestParams": best_params,
            "bestScore": best_score if best_score > -1e17 else None,
            "bestMetrics": _fold_metrics_block(best_outcome),
            "deflatedSharpe": deflated,
            "deflatedSharpeMethod": deflated_method,
            "deflatedSharpeReason": deflated_reason,
            "baselineMetrics": _fold_metrics_block(baseline),
            "warnings": warnings,
            "elapsedSeconds": round(time.time() - started, 2),
            "data": {
                "source": panel.source,
                "symbols": panel.symbols,
                "bars": panel.n_bars,
                "start": panel.start,
                "end": panel.end,
                "intervalMinutes": panel.interval_minutes,
            },
            "strategy": {"model": config.strategy.model, "params": config.strategy.params},
        },
        "trials": top_trials,
        "bestResult": best_result,
        "warnings": warnings,
    }


def run_stress(
    config: BacktestConfig,
    panel: CandlePanel,
    spec: StressSpec,
    *,
    run_id: str,
) -> dict[str, Any]:
    """Re-run the strategy across fee/slippage grids to expose cost fragility."""

    started = time.time()
    rows: list[dict[str, Any]] = []
    for fee in spec.fee_bps:
        for slippage in spec.slippage_bps:
            try:
                outcome = run_engine(
                    replace(config, fee_bps=float(fee), slippage_bps=float(slippage)),
                    panel,
                    include_trades=False,
                    keep_portfolio_data=False,
                )
                rows.append(
                    {
                        "feeBps": float(fee),
                        "slippageBps": float(slippage),
                        "totalBps": float(fee) + float(slippage),
                        "totalReturnPercent": outcome.metrics.get("totalReturnPercent"),
                        "cagrPercent": outcome.metrics.get("cagrPercent"),
                        "sharpeRatio": outcome.metrics.get("sharpeRatio"),
                        "maxDrawdownPercent": outcome.metrics.get("maxDrawdownPercent"),
                        "totalCostsUSD": outcome.metrics.get("totalCostsUSD"),
                        "totalTrades": outcome.metrics.get("totalTrades"),
                        "status": "ok",
                    }
                )
            except Exception as exc:
                rows.append(
                    {
                        "feeBps": float(fee),
                        "slippageBps": float(slippage),
                        "totalBps": float(fee) + float(slippage),
                        "status": "failed",
                        "error": str(exc),
                    }
                )
    usable = [row for row in rows if row.get("status") == "ok"]
    usable.sort(key=lambda row: row["totalBps"])
    breakeven = None
    for row in usable:
        if float(row.get("totalReturnPercent") or 0.0) > 0:
            breakeven = row["totalBps"]
        else:
            break
    zero_cost = next((row for row in usable if row["totalBps"] == 0), usable[0] if usable else None)
    highest = usable[-1] if usable else None
    return {
        "runId": run_id,
        "kind": "stress",
        "strategyId": config.strategy_id,
        "strategyName": config.strategy_name,
        "assetPair": " / ".join(panel.symbols),
        "symbols": panel.symbols,
        "interval": config.interval_minutes,
        "periodLabel": f"{panel.start} → {panel.end}",
        "startTime": panel.start,
        "endTime": panel.end,
        "totalCandles": panel.n_bars,
        "engine": "quantjourney-bt" if qj_runtime_info()["available"] else "native-fallback",
        "spec": spec.to_dict(),
        "summary": {
            "scenarios": len(usable),
            "breakevenBps": breakeven,
            "zeroCostReturnPercent": zero_cost.get("totalReturnPercent") if zero_cost else None,
            "highestCostReturnPercent": highest.get("totalReturnPercent") if highest else None,
            "returnDecayPercent": (
                float(zero_cost.get("totalReturnPercent") or 0.0) - float(highest.get("totalReturnPercent") or 0.0)
                if zero_cost and highest
                else None
            ),
            "warnings": [],
            "elapsedSeconds": round(time.time() - started, 2),
            "data": {
                "source": panel.source,
                "symbols": panel.symbols,
                "bars": panel.n_bars,
                "start": panel.start,
                "end": panel.end,
                "intervalMinutes": panel.interval_minutes,
            },
            "strategy": {"model": config.strategy.model, "params": config.strategy.params},
        },
        "scenarios": rows,
        "warnings": [],
    }
