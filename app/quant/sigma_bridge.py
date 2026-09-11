"""Sigma Quant adapter for Strategie-Runner.

The bridge owns no new physics.  It delegates to the already authoritative
Runner/Sigma indicator implementation or to an explicitly configured Sigma
module.  Selecting ``sigma`` while that implementation is unavailable returns
an unavailable, fail-closed verdict; it never silently calls an LLM or emits a
live order.
"""
from __future__ import annotations

from dataclasses import dataclass
import importlib
import os
from typing import Any, Callable, Dict, Mapping, Optional

from app.contracts import (
    BlindPatternPacket,
    PaperIntent,
    QuantRequest,
    QuantVerdict,
    RegimePacket,
    canonical_hash,
)


class SigmaUnavailable(RuntimeError):
    """Raised only by strict callers; normal evaluate() returns fail-closed."""


@dataclass
class BridgeResult:
    request: QuantRequest
    regime: RegimePacket
    verdict: QuantVerdict
    backend_status: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "request": self.request.to_dict(),
            "regime": self.regime.to_dict(),
            "verdict": self.verdict.to_dict(),
            "backend_status": dict(self.backend_status),
        }

    def __getitem__(self, key: str) -> Any:
        return self.to_dict()[key]


_VALID_BACKENDS = {"sigma", "legacy", "off"}


def configured_backend() -> str:
    value = os.getenv("QUANT_BACKEND", "sigma").strip().lower() or "sigma"
    return value if value in _VALID_BACKENDS else "sigma"


def _load_external_sigma() -> Optional[Callable[..., Any]]:
    """Load an opt-in Sigma adapter without importing optional user code by default."""
    module_name = os.getenv("SIGMA_QUANT_MODULE", "").strip()
    if not module_name:
        return None
    try:
        module = importlib.import_module(module_name)
    except Exception:
        return None
    for name in ("evaluate", "quantify", "sigma_evaluate"):
        fn = getattr(module, name, None)
        if callable(fn):
            return fn
    return None


def quant_backend_status() -> Dict[str, Any]:
    selected = configured_backend()
    external = _load_external_sigma()
    # The local adapter is the existing runner math, not a second implementation.
    local = _local_indicator_fn() is not None
    return {
        "selected": selected,
        "available": False if selected == "off" else ((external is not None or local) if selected == "sigma" else local),
        "external_configured": bool(os.getenv("SIGMA_QUANT_MODULE", "").strip()),
        "local_runner_adapter": local,
        "fail_closed_when_missing": selected == "sigma",
        "paper_only": True,
    }


def _local_indicator_fn() -> Optional[Callable[..., Any]]:
    try:
        from app.orchestrator.alpha_sigma_engine import sigma_indicators
        return sigma_indicators
    except Exception:
        return None


def _regime_from_hurst(hurst: Any) -> str:
    try:
        h = float(hurst)
    except (TypeError, ValueError):
        return "UNKNOWN"
    if h < 0.45:
        return "MEAN_REVERTING"
    if h <= 0.55:
        return "BROWNIAN_CHOP"
    if h <= 0.75:
        return "MOMENTUM_TREND"
    return "SUPER_EXPONENTIAL"


class SigmaQuantBridge:
    """Contract adapter used by the SIGMA chamber and night-train.

    ``local_sigma_available`` is injectable for tests and for deployments where
    the external Sigma tree is deliberately absent.  With ``backend='sigma'`` a
    missing implementation is always represented as ``UNAVAILABLE``.
    """

    def __init__(self, backend: Optional[str] = None, *, local_sigma_available: Optional[bool] = None,
                 sigma_callable: Optional[Callable[..., Any]] = None):
        self.backend = (backend or configured_backend()).lower()
        if self.backend not in _VALID_BACKENDS:
            raise ValueError(f"QUANT_BACKEND must be sigma|legacy|off, got {self.backend!r}")
        self._sigma_callable = sigma_callable
        self._local_available = local_sigma_available

    def status(self) -> Dict[str, Any]:
        status = quant_backend_status()
        status["selected"] = self.backend
        if self._local_available is not None:
            status["local_runner_adapter"] = self._local_available
            if self.backend == "sigma" and not self._sigma_callable:
                status["available"] = bool(self._local_available)
        return status

    def _available_callable(self) -> Optional[Callable[..., Any]]:
        if self._sigma_callable is not None:
            return self._sigma_callable
        if self.backend == "sigma":
            ext = _load_external_sigma()
            if ext is not None:
                return ext
        fn = _local_indicator_fn()
        if self._local_available is False:
            return None
        return fn

    @staticmethod
    def _unavailable(request: QuantRequest, reason: str, backend: str = "sigma") -> BridgeResult:
        regime = RegimePacket(symbol=request.symbol, regime="UNKNOWN", confidence=0.0,
                              features={}, as_of_bar=request.as_of_bar)
        verdict = QuantVerdict(symbol=request.symbol, status="UNAVAILABLE", score=0.0,
                               regime=regime, backend=backend, reasons=[reason],
                               fail_closed=True, request_id=request.request_id)
        return BridgeResult(request, regime, verdict, {
            "selected": backend, "available": False, "fail_closed": True, "paper_only": True,
        })

    def evaluate(self, request: QuantRequest, *, blind_pattern: Optional[BlindPatternPacket] = None) -> BridgeResult:
        if not isinstance(request, QuantRequest):
            request = QuantRequest.from_dict(request)  # type: ignore[arg-type]
        if blind_pattern is not None:
            request.blind_pattern = blind_pattern if isinstance(blind_pattern, BlindPatternPacket) else BlindPatternPacket.from_dict(blind_pattern)
        if self.backend == "off":
            return self._unavailable(request, "QUANT_BACKEND_OFF", "off")
        if self.backend == "sigma" and self._local_available is False and self._sigma_callable is None and not _load_external_sigma():
            return self._unavailable(request, "SIGMA_MODULE_UNAVAILABLE", "sigma")
        fn = self._available_callable()
        if fn is None:
            return self._unavailable(request, "SIGMA_MODULE_UNAVAILABLE" if self.backend == "sigma" else "LEGACY_ENGINE_UNAVAILABLE", self.backend)

        try:
            raw = fn(request.prices, request.parameters) if fn is _local_indicator_fn() else fn(request.to_dict())
            if not isinstance(raw, Mapping):
                raise TypeError("Sigma adapter must return a mapping")
        except Exception as exc:
            return self._unavailable(request, f"SIGMA_EVALUATION_FAILED:{type(exc).__name__}", self.backend)

        if not raw.get("ok", True):
            return self._unavailable(request, "SIGMA_INSUFFICIENT_DATA", self.backend)

        features = dict(raw.get("features") or {})
        features.update(dict(raw.get("raw") or {}))
        for key in ("z_score", "atr", "ema_fast", "ema_slow", "support_score", "resistance_score", "hurst"):
            if key in raw and key not in features:
                features[key] = raw[key]
        if request.blind_pattern is not None:
            # Only blind geometry is passed forward, never request identity or price.
            features["blind_pattern"] = request.blind_pattern.to_dict()

        hurst = raw.get("hurst", features.get("hurst", 0.5))
        regime = str(raw.get("regime") or _regime_from_hurst(hurst)).upper()
        if regime not in {"MEAN_REVERTING", "BROWNIAN_CHOP", "MOMENTUM_TREND", "SUPER_EXPONENTIAL", "UNKNOWN"}:
            regime = _regime_from_hurst(hurst)
        confidence = min(1.0, max(0.0, abs(float(hurst or 0.5) - 0.5) * 2.0))
        regime_packet = RegimePacket(symbol=request.symbol, regime=regime, confidence=confidence,
                                     features={"hurst": hurst, "bars": raw.get("bars", len(request.prices)),
                                               "closed_candle_only": True},
                                     as_of_bar=request.as_of_bar if request.as_of_bar is not None else max(0, len(request.prices) - 1))

        signals = raw.get("signals") or {}
        if signals.get("trend_long") or signals.get("mr_long"):
            score, action = 1.0, "BUY"
        elif signals.get("trend_short") or signals.get("mr_short"):
            score, action = -1.0, "SELL"
        else:
            # External Sigma adapters may expose a scalar score/direction rather
            # than the Runner signal map.  This is normalization, not new math.
            external_score = raw.get("score", raw.get("direction", 0.0))
            try:
                scalar = max(-1.0, min(1.0, float(external_score)))
            except (TypeError, ValueError):
                scalar = 0.0
            score, action = (scalar, "BUY" if scalar > 0 else "SELL" if scalar < 0 else "HOLD")
        reasons = [] if action != "HOLD" else ["NO_CLOSED_CANDLE_SIGNAL"]
        parity_hash = canonical_hash({"backend": self.backend, "features": features, "regime": regime})
        intent = PaperIntent(symbol=request.symbol, action=action, qty=request.requested_qty,
                             price_hint=float(raw.get("price") or (request.prices[-1] if request.prices else 0.0)),
                             source=f"{self.backend}_quant", reason_codes=reasons,
                             request_id=request.request_id, parity_hash=parity_hash)
        verdict = QuantVerdict(symbol=request.symbol, status="APPROVED" if action != "HOLD" else "NO_SIGNAL",
                               score=score, regime=regime_packet, backend=self.backend,
                               reasons=reasons, features=features, paper_intent=intent,
                               fail_closed=False, request_id=request.request_id)
        return BridgeResult(request, regime_packet, verdict, {
            "selected": self.backend, "available": True, "local_runner_adapter": fn is _local_indicator_fn(),
            "fail_closed": False, "paper_only": True,
        })

    def evaluate_payload(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        return self.evaluate(QuantRequest.from_dict(payload)).to_dict()
