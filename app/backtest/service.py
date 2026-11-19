"""Backtest service: orchestration, persistence and run history.

This is the single entry point used by the HTTP router, the CLI bridge, the
MCP server and tests.  Runs are persisted under ``data/backtest_runs`` (or
``QJ_BACKTEST_RUNS_DIR``) as auditable research packets.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from app.backtest.config import (
    BacktestConfig,
    BacktestError,
    OptimizeSpec,
    StressSpec,
    WalkForwardSpec,
)
from app.backtest.data import resolve_panel
from app.backtest.engine import result_payload, run_engine
from app.backtest.report import ARTIFACT_NAMES, sanitize, write_artifacts
from app.backtest.walkforward import run_optimization, run_stress, run_walk_forward

_RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{5,95}$")
_LOCK = threading.RLock()

_KIND_PREFIX = {"backtest": "bt", "walkforward": "wf", "optimization": "opt", "stress": "stress"}


def runs_dir() -> Path:
    configured = os.getenv("QJ_BACKTEST_RUNS_DIR", "data/backtest_runs")
    path = Path(configured)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _new_run_id(kind: str, fingerprint: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    prefix = _KIND_PREFIX.get(kind, "run")
    return f"qj-{prefix}-{stamp}-{fingerprint[:6]}-{uuid.uuid4().hex[:4]}"


def _validate_run_id(run_id: str) -> str:
    if not _RUN_ID_PATTERN.match(str(run_id or "")):
        raise BacktestError("invalid run id")
    return str(run_id)


def _run_dir(run_id: str) -> Path:
    return runs_dir() / _validate_run_id(run_id)


def _write_run(
    *,
    run_id: str,
    kind: str,
    result: Mapping[str, Any],
    summary: Mapping[str, Any],
    weights: Any = None,
    folds: Sequence[Mapping[str, Any]] | None = None,
    trials: Sequence[Mapping[str, Any]] | None = None,
    stress: Sequence[Mapping[str, Any]] | None = None,
    payload: Mapping[str, Any] | None = None,
    provenance: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    directory = _run_dir(run_id)
    with _LOCK:
        manifest = write_artifacts(
            directory,
            result=result,
            summary=summary,
            weights=weights,
            folds=folds,
            trials=trials,
            stress=stress,
            payload=payload,
            provenance=provenance,
        )
    return manifest


def _envelope(
    *,
    run_id: str,
    kind: str,
    result: Mapping[str, Any],
    config: BacktestConfig | None,
    warnings: Iterable[str] | None,
    engine: str | None,
    metrics: Mapping[str, Any] | None = None,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    analytics = result.get("analytics", {}) or {}
    metric_block = metrics or analytics.get("metrics") or {}
    summary = {
        "runId": run_id,
        "kind": kind,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "strategyId": result.get("strategyId"),
        "strategyName": result.get("strategyName"),
        "assetPair": result.get("assetPair"),
        "symbols": result.get("symbols"),
        "interval": result.get("interval"),
        "periodLabel": result.get("periodLabel"),
        "startTime": result.get("startTime"),
        "endTime": result.get("endTime"),
        "totalCandles": result.get("totalCandles"),
        "engine": engine or result.get("engine"),
        "metrics": {
            key: metric_block.get(key)
            for key in (
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
                "oosSharpe",
                "efficiency",
                "overfitRatio",
                "deflatedSharpe",
            )
            if metric_block.get(key) is not None
        },
        "warnings": list(warnings or result.get("warnings") or []),
        "config": config.to_dict() if config else None,
    }
    if extra:
        summary.update(sanitize(extra))
    return summary


def _public_result(result: Mapping[str, Any], run_id: str, manifest: Mapping[str, Any]) -> dict[str, Any]:
    payload = dict(result)
    payload["id"] = run_id
    payload["runId"] = run_id
    payload["artifacts"] = [
        {
            "name": name,
            "bytes": info.get("bytes"),
            "mediaType": info.get("mediaType"),
            "url": f"/api/backtest/runs/{run_id}/artifact/{name}",
        }
        for name, info in (manifest.get("artifacts") or {}).items()
    ]
    return sanitize(payload)


# ---------------------------------------------------------------------------
# Run entry points
# ---------------------------------------------------------------------------


def run_backtest(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Run a single portfolio backtest and persist its research packet."""

    config = BacktestConfig.from_payload(payload)
    panel = resolve_panel(config)
    run_id = _new_run_id("backtest", config.fingerprint())
    outcome = run_engine(config, panel, include_trades=True)
    result = result_payload(outcome)
    result["id"] = run_id
    summary = _envelope(
        run_id=run_id,
        kind="backtest",
        result=result,
        config=config,
        warnings=outcome.warnings,
        engine=outcome.engine_meta.get("engine"),
    )
    manifest: dict[str, Any] = {"artifacts": {}}
    if config.persist:
        manifest = _write_run(
            run_id=run_id,
            kind="backtest",
            result=result,
            summary=summary,
            weights=outcome.weights,
            payload={**result, "runId": run_id, "kind": "backtest"},
            provenance={
                "fingerprint": config.fingerprint(),
                "engine": outcome.engine_meta,
                "strategy": outcome.strategy.diagnostics,
                "data": result.get("analytics", {}).get("data"),
            },
        )
    return {
        **_public_result(result, run_id, manifest),
        "runId": run_id,
        "kind": "backtest",
        "summaryEnvelope": summary,
    }


def run_walk_forward_request(payload: Mapping[str, Any]) -> dict[str, Any]:
    config = BacktestConfig.from_payload(payload)
    spec = WalkForwardSpec.from_payload(payload.get("walkForward") or payload.get("walkforward") or payload)
    panel = resolve_panel(config)
    run_id = _new_run_id("walkforward", config.fingerprint())
    result = run_walk_forward(config, panel, spec, run_id=run_id)
    folds = result.get("folds", [])
    fold_rows = [
        {
            "fold": fold.get("fold"),
            "trainStart": fold.get("trainStart"),
            "trainEnd": fold.get("trainEnd"),
            "testStart": fold.get("testStart"),
            "testEnd": fold.get("testEnd"),
            "trainBars": fold.get("trainBars"),
            "testBars": fold.get("testBars"),
            "status": fold.get("status"),
            "bestParams": json.dumps(fold.get("bestParams") or {}),
            "isSharpe": (fold.get("inSample") or {}).get("sharpeRatio"),
            "isReturnPercent": (fold.get("inSample") or {}).get("totalReturnPercent"),
            "oosSharpe": (fold.get("outOfSample") or {}).get("sharpeRatio"),
            "oosReturnPercent": (fold.get("outOfSample") or {}).get("totalReturnPercent"),
            "oosMaxDrawdownPercent": (fold.get("outOfSample") or {}).get("maxDrawdownPercent"),
            "efficiency": fold.get("efficiency"),
        }
        for fold in folds
    ]
    summary = _envelope(
        run_id=run_id,
        kind="walkforward",
        result=result,
        config=config,
        warnings=result.get("warnings"),
        engine=result.get("engine"),
        metrics=result.get("summary", {}).get("oosMetrics"),
        extra={
            "walkForward": {
                key: value
                for key, value in (result.get("summary") or {}).items()
                if key not in {"warnings", "oosMetrics", "data", "strategy"}
            }
        },
    )
    manifest: dict[str, Any] = {"artifacts": {}}
    if config.persist:
        artifact_result = {
            **result,
            "analytics": {
                **result.get("analytics", {}),
                "metrics": {
                    **(result.get("summary", {}).get("oosMetrics") or {}),
                    "totalReturnPercent": result.get("summary", {}).get("oosTotalReturnPercent"),
                    "maxDrawdownPercent": result.get("summary", {}).get("oosMaxDrawdownPercent"),
                    "sharpeRatio": result.get("summary", {}).get("oosSharpe"),
                    "cagrPercent": result.get("summary", {}).get("oosCagrPercent"),
                },
            },
        }
        manifest = _write_run(
            run_id=run_id,
            kind="walkforward",
            result=artifact_result,
            summary=summary,
            folds=fold_rows,
            payload=result,
            provenance={"fingerprint": config.fingerprint(), "geometry": result.get("geometry")},
        )
    return {
        **_public_result(result, run_id, manifest),
        "runId": run_id,
        "kind": "walkforward",
        "summaryEnvelope": summary,
    }


def run_optimization_request(payload: Mapping[str, Any]) -> dict[str, Any]:
    config = BacktestConfig.from_payload(payload)
    spec = OptimizeSpec.from_payload(payload.get("optimization") or payload.get("optimize") or payload)
    panel = resolve_panel(config)
    run_id = _new_run_id("optimization", config.fingerprint())
    result = run_optimization(config, panel, spec, run_id=run_id)
    summary = _envelope(
        run_id=run_id,
        kind="optimization",
        result=result.get("bestResult") or result,
        config=config,
        warnings=result.get("warnings"),
        engine=result.get("engine"),
        metrics=(result.get("summary") or {}).get("bestMetrics"),
        extra={
            "optimization": {
                key: value
                for key, value in (result.get("summary") or {}).items()
                if key not in {"warnings", "bestMetrics", "data", "strategy", "baselineMetrics"}
            }
        },
    )
    manifest: dict[str, Any] = {"artifacts": {}}
    if config.persist:
        artifact_result = result.get("bestResult") or {
            "strategyName": result.get("strategyName"),
            "assetPair": result.get("assetPair"),
            "periodLabel": result.get("periodLabel"),
            "engine": result.get("engine"),
            "analytics": {"metrics": (result.get("summary") or {}).get("bestMetrics") or {}, "data": result.get("summary", {}).get("data")},
            "equityCurve": [],
            "trades": [],
            "warnings": result.get("warnings"),
        }
        manifest = _write_run(
            run_id=run_id,
            kind="optimization",
            result=artifact_result,
            summary=summary,
            trials=result.get("trials") or [],
            payload=result,
            provenance={
                "fingerprint": config.fingerprint(),
                "objective": spec.objective,
                "gridSize": (result.get("summary") or {}).get("gridSize"),
            },
        )
    return {
        **_public_result(result, run_id, manifest),
        "runId": run_id,
        "kind": "optimization",
        "summaryEnvelope": summary,
    }


def run_stress_request(payload: Mapping[str, Any]) -> dict[str, Any]:
    config = BacktestConfig.from_payload(payload)
    spec = StressSpec.from_payload(payload.get("stress") or payload)
    panel = resolve_panel(config)
    run_id = _new_run_id("stress", config.fingerprint())
    result = run_stress(config, panel, spec, run_id=run_id)
    summary = _envelope(
        run_id=run_id,
        kind="stress",
        result=result,
        config=config,
        warnings=[],
        engine=result.get("engine"),
        metrics={},
        extra={"stress": result.get("summary")},
    )
    manifest: dict[str, Any] = {"artifacts": {}}
    if config.persist:
        artifact_result = {
            "strategyName": result.get("strategyName"),
            "assetPair": result.get("assetPair"),
            "periodLabel": result.get("periodLabel"),
            "engine": result.get("engine"),
            "analytics": {"metrics": {}, "data": result.get("summary", {}).get("data")},
            "equityCurve": [],
            "trades": [],
            "warnings": [],
        }
        manifest = _write_run(
            run_id=run_id,
            kind="stress",
            result=artifact_result,
            summary=summary,
            stress=result.get("scenarios") or [],
            payload=result,
            provenance={"fingerprint": config.fingerprint()},
        )
    return {
        **_public_result(result, run_id, manifest),
        "runId": run_id,
        "kind": "stress",
        "summaryEnvelope": summary,
    }


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------


def _read_summary(directory: Path) -> dict[str, Any] | None:
    summary_path = directory / "summary.json"
    if not summary_path.exists():
        return None
    try:
        payload = json.loads(summary_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    manifest_path = directory / "manifest.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            payload.setdefault("artifactCount", len(manifest.get("artifacts") or {}))
        except Exception:
            pass
    return payload


def list_runs(limit: int = 50, kind: str | None = None) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 500))
    rows: list[dict[str, Any]] = []
    with _LOCK:
        for directory in runs_dir().iterdir():
            if not directory.is_dir():
                continue
            summary = _read_summary(directory)
            if summary is None:
                continue
            if kind and summary.get("kind") != kind:
                continue
            rows.append(summary)
    rows.sort(key=lambda row: str(row.get("createdAt") or ""), reverse=True)
    return rows[:limit]


def get_run(run_id: str, *, include_result: bool = True) -> dict[str, Any]:
    directory = _run_dir(run_id)
    if not directory.exists():
        raise BacktestError(f"run {run_id} not found")
    summary = _read_summary(directory)
    if summary is None:
        raise BacktestError(f"run {run_id} has no summary")
    payload: dict[str, Any] = {"runId": run_id, "summary": summary}
    if include_result:
        payload_path = directory / "payload.json"
        result_path = directory / "result.json"
        if payload_path.exists():
            payload["payload"] = json.loads(payload_path.read_text(encoding="utf-8"))
        if result_path.exists():
            payload["result"] = json.loads(result_path.read_text(encoding="utf-8"))
    manifest_path = directory / "manifest.json"
    if manifest_path.exists():
        payload["manifest"] = json.loads(manifest_path.read_text(encoding="utf-8"))
    return payload


def get_artifact(run_id: str, name: str) -> tuple[bytes, str]:
    if name not in ARTIFACT_NAMES:
        raise BacktestError(f"unknown artifact {name!r}")
    path = _run_dir(run_id) / name
    if not path.exists():
        raise BacktestError(f"artifact {name!r} is not available for run {run_id}")
    media = "text/html" if name.endswith(".html") else ("application/json" if name.endswith(".json") else "text/csv")
    return path.read_bytes(), media


def delete_run(run_id: str) -> dict[str, Any]:
    directory = _run_dir(run_id)
    if not directory.exists():
        raise BacktestError(f"run {run_id} not found")
    with _LOCK:
        shutil.rmtree(directory)
    return {"runId": run_id, "deleted": True}


def compare_runs(run_ids: Sequence[str]) -> dict[str, Any]:
    if len(run_ids) < 2:
        raise BacktestError("compare requires at least two run ids")
    if len(run_ids) > 8:
        raise BacktestError("compare supports at most 8 runs")
    summaries: list[dict[str, Any]] = []
    for run_id in run_ids:
        payload = get_run(run_id, include_result=False)
        summaries.append(payload["summary"])
    metric_keys: list[str] = []
    for summary in summaries:
        for key in (summary.get("metrics") or {}):
            if key not in metric_keys:
                metric_keys.append(key)
    rows: list[dict[str, Any]] = []
    for key in metric_keys:
        values = [(summary.get("metrics") or {}).get(key) for summary in summaries]
        numeric = [(index, float(value)) for index, value in enumerate(values) if isinstance(value, (int, float))]
        best_index = None
        if numeric:
            lower_is_better = key in {"maxDrawdownPercent", "annualizedVolatilityPercent"}
            best_index = (min if lower_is_better else max)(numeric, key=lambda item: item[1])[0]
        rows.append(
            {
                "metric": key,
                "values": values,
                "bestRunId": summaries[best_index].get("runId") if best_index is not None else None,
            }
        )
    return {
        "runs": [
            {
                "runId": summary.get("runId"),
                "strategyName": summary.get("strategyName"),
                "assetPair": summary.get("assetPair"),
                "kind": summary.get("kind"),
                "engine": summary.get("engine"),
                "createdAt": summary.get("createdAt"),
                "metrics": summary.get("metrics"),
                "config": summary.get("config"),
            }
            for summary in summaries
        ],
        "metrics": rows,
    }


def capabilities() -> dict[str, Any]:
    from app.backtest.qj_runtime import capabilities as runtime_capabilities

    payload = runtime_capabilities()
    payload["runsDir"] = str(runs_dir())
    payload["runCount"] = len(list_runs(limit=500))
    return payload
