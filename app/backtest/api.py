"""FastAPI router exposing the QuantJourney backtesting workflow.

Mounted by :mod:`app.api` when FastAPI is installed.  The TypeScript server
uses the same service through the JSON CLI bridge, so both transports share
one implementation and one run store.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import JSONResponse, Response

from app.backtest.config import BacktestError

router = APIRouter(prefix="/api/qj-backtest", tags=["quantjourney-backtest"])


def _service():
    from app.backtest import service

    return service


def _handle(callable_):
    try:
        return callable_()
    except BacktestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - operator-facing guard
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/engines")
def engines() -> dict[str, Any]:
    return _handle(lambda: _service().capabilities())


@router.post("/run")
def run(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return _handle(lambda: _service().run_backtest(payload))


@router.post("/walkforward")
def walkforward(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return _handle(lambda: _service().run_walk_forward_request(payload))


@router.post("/optimize")
def optimize(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return _handle(lambda: _service().run_optimization_request(payload))


@router.post("/stress")
def stress(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return _handle(lambda: _service().run_stress_request(payload))


@router.get("/runs")
def runs(limit: int = Query(default=50, ge=1, le=500), kind: str | None = None) -> dict[str, Any]:
    return _handle(lambda: {"runs": _service().list_runs(limit=limit, kind=kind)})


@router.get("/runs/{run_id}")
def run_detail(run_id: str, include_result: bool = True) -> dict[str, Any]:
    return _handle(lambda: _service().get_run(run_id, include_result=include_result))


@router.get("/runs/{run_id}/artifact/{name}")
def artifact(run_id: str, name: str) -> Response:
    content, media = _handle(lambda: _service().get_artifact(run_id, name))
    headers = {"Content-Disposition": f'inline; filename="{name}"'}
    return Response(content=content, media_type=media, headers=headers)


@router.delete("/runs/{run_id}")
def delete(run_id: str) -> dict[str, Any]:
    return _handle(lambda: _service().delete_run(run_id))


@router.post("/compare")
def compare(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    run_ids = payload.get("runIds") or payload.get("run_ids") or []
    return _handle(lambda: _service().compare_runs(run_ids))


@router.get("/health")
def health() -> JSONResponse:
    payload = _handle(lambda: _service().capabilities())
    return JSONResponse(
        {
            "status": "healthy",
            "engine": payload.get("engine"),
            "qjAvailable": payload.get("qjAvailable"),
            "runCount": payload.get("runCount"),
        }
    )
