"""Harvest-aware Sigma quant adapter for SIGMA_QUANT_MODULE.

Points at ``SIGMA_HARVEST_ROOT`` (Windows: D:\\GrokTrading\\harvests\\sigma).
Physics stay in the Runner ``sigma_indicators`` implementation (no second engine).
The harvest tree is required to exist so fail-closed fires when the USB/SoT
copy is missing; optional harvest imports are best-effort metadata only.
Never places live orders.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, Mapping

from app.orchestrator.alpha_sigma_engine import sigma_indicators


def harvest_root() -> Path:
    raw = (os.getenv("SIGMA_HARVEST_ROOT") or "").strip().strip('"')
    if raw:
        return Path(raw)
    # Default local SoT layout
    return Path(r"D:\GrokTrading\harvests\sigma")


def harvest_status() -> Dict[str, Any]:
    root = harvest_root()
    markers = ["AGENTS.md", "README.md", "app", "sigma", "requirements.txt"]
    present = {m: (root / m).exists() for m in markers}
    return {
        "root": str(root),
        "exists": root.is_dir(),
        "markers": present,
        "marker_hits": sum(1 for v in present.values() if v),
    }


def evaluate(payload: Mapping[str, Any]) -> Dict[str, Any]:
    """External Sigma entrypoint expected by ``SigmaQuantBridge``."""
    if not isinstance(payload, Mapping):
        return {"ok": False, "reason": "PAYLOAD_NOT_MAPPING"}
    mode = str(payload.get("execution_mode") or "paper").lower()
    if mode not in {"paper", "sim", "simulate"}:
        return {"ok": False, "reason": "LIVE_REJECTED", "execution_mode": mode}

    status = harvest_status()
    if not status["exists"] or status["marker_hits"] < 2:
        return {"ok": False, "reason": "SIGMA_HARVEST_MISSING", "harvest": status}

    prices = list(payload.get("prices") or [])
    parameters = dict(payload.get("parameters") or {})
    raw = sigma_indicators(prices, parameters)
    if not isinstance(raw, Mapping):
        return {"ok": False, "reason": "INDICATOR_NON_MAPPING"}
    out = dict(raw)
    out.setdefault("ok", True)
    out["backend"] = "sigma_harvest_adapter"
    out["paper_only"] = True
    out["harvest"] = status
    out["symbol"] = payload.get("symbol")
    # Do not invent signals beyond indicator outputs.
    return out


def quantify(payload: Mapping[str, Any]) -> Dict[str, Any]:
    return evaluate(payload)


def sigma_evaluate(payload: Mapping[str, Any]) -> Dict[str, Any]:
    return evaluate(payload)