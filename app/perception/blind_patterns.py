"""Closed-candle, symbol-agnostic Fable/Neo perception.

There are two deliberately separate boundaries:

* ``blind_geometry_from_candles`` is the ingestion adapter.  It consumes local
  OHLC candles and immediately removes prices, timestamps and identity.
* ``detect_blind_patterns``/``rna_smart`` only accept the resulting geometry.
  They cannot accidentally learn a symbol, timeframe or absolute price.

No function in this module emits an order or a broker side effect.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, Sequence
import math

from app.contracts import BlindPatternPacket, ContractError


class BlindLeakageError(ContractError):
    """Raised when identity, absolute price or future-bar data reaches perception."""


_FORBIDDEN = {"symbol", "ticker", "asset", "timeframe", "tf", "timestamp", "datetime",
              "price", "open", "high", "low", "close", "vwap", "absolute_price", "future",
              "next_bar", "lookahead", "look_ahead", "predicted"}


def _num(value: Any, field: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise BlindLeakageError(f"{field} must be numeric") from exc
    if not math.isfinite(result):
        raise BlindLeakageError(f"{field} must be finite")
    return result


def validate_blind_geometry(geometry: Mapping[str, Any]) -> Dict[str, Any]:
    """Validate a geometry-only payload and return a defensive copy."""
    if not isinstance(geometry, Mapping):
        raise BlindLeakageError("blind geometry must be a mapping")
    out: Dict[str, Any] = {}
    for key, value in geometry.items():
        low = str(key).lower()
        if low in _FORBIDDEN or any(token in low for token in ("symbol", "timeframe", "timestamp", "price", "future", "lookahead")):
            raise BlindLeakageError(f"leakage guard rejected geometry field '{key}'")
        if isinstance(value, Mapping):
            out[str(key)] = validate_blind_geometry(value)
        elif isinstance(value, (list, tuple)):
            out[str(key)] = [validate_blind_geometry(x) if isinstance(x, Mapping) else x for x in value]
        elif isinstance(value, bool) or isinstance(value, str) or value is None:
            out[str(key)] = value
        elif isinstance(value, (int, float)) and math.isfinite(float(value)):
            out[str(key)] = value
        else:
            raise BlindLeakageError(f"unsupported blind geometry field '{key}'")
    return out


def blind_geometry_from_candles(candles: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """Convert closed OHLC candles to normalized geometry without identity.

    Raw OHLC values are used only inside this adapter.  The returned records
    contain ratios and direction, so they are safe to pass to the blind pattern
    detector.  A candle explicitly marked open is rejected; no implicit final
    candle is ever used.
    """
    if not candles:
        raise BlindLeakageError("at least one closed candle is required")
    result: List[Dict[str, Any]] = []
    for index, candle in enumerate(candles):
        if not isinstance(candle, Mapping):
            raise BlindLeakageError(f"candle {index} is not a mapping")
        for key in ("is_closed", "closed", "bar_closed"):
            if key in candle and candle[key] is not True:
                raise BlindLeakageError(f"candle {index} is not closed")
        if any(str(k).lower() in {"future", "next_bar", "lookahead", "look_ahead"} for k in candle):
            raise BlindLeakageError(f"future/look-ahead field on candle {index}")
        try:
            op = _num(candle["open"], "open")
            hi = _num(candle["high"], "high")
            lo = _num(candle["low"], "low")
            cl = _num(candle["close"], "close")
        except KeyError as exc:
            raise BlindLeakageError(f"candle {index} missing OHLC field") from exc
        if min(op, hi, lo, cl) <= 0 or hi < max(op, cl) or lo > min(op, cl) or hi < lo:
            raise BlindLeakageError(f"invalid OHLC geometry on candle {index}")
        span = max(hi - lo, 1e-12)
        body = abs(cl - op)
        result.append({
            "direction": 1 if cl > op else (-1 if cl < op else 0),
            "body_ratio": body / span,
            "range_ratio": span / max(abs(op), 1e-12),
            "upper_wick_ratio": (hi - max(op, cl)) / span,
            "lower_wick_ratio": (min(op, cl) - lo) / span,
            "body_position": ((op + cl) / 2.0 - lo) / span,
            "closed": True,
        })
    return result


def _pattern_features(geometry: Sequence[Mapping[str, Any]]) -> Dict[str, Any]:
    if not geometry:
        return {"bars": 0, "directional_bias": 0.0, "body_mean": 0.0, "wick_balance": 0.0,
                "range_mean": 0.0, "compression": True}
    rows = [validate_blind_geometry(x) for x in geometry]
    if any(row.get("closed") is False for row in rows):
        raise BlindLeakageError("detector accepts closed bars only")
    directions = [float(row.get("direction", 0)) for row in rows]
    bodies = [max(0.0, min(1.0, float(row.get("body_ratio", 0)))) for row in rows]
    ranges = [max(0.0, float(row.get("range_ratio", 0))) for row in rows]
    upper = [max(0.0, float(row.get("upper_wick_ratio", 0))) for row in rows]
    lower = [max(0.0, float(row.get("lower_wick_ratio", 0))) for row in rows]
    mean_range = sum(ranges) / len(ranges)
    first_range = sum(ranges[: max(1, len(ranges) // 2)]) / max(1, len(ranges) // 2)
    last_range = sum(ranges[len(ranges) // 2:]) / max(1, len(ranges) - len(ranges) // 2)
    return {
        "bars": len(rows),
        "directional_bias": sum(directions) / len(directions),
        "body_mean": sum(bodies) / len(bodies),
        "wick_balance": (sum(lower) - sum(upper)) / len(rows),
        "range_mean": mean_range,
        "compression": bool(last_range < first_range * 0.75) if first_range else True,
        "closed": True,
    }


def detect_blind_patterns(geometry: Sequence[Mapping[str, Any]], *, as_of_bar: int | None = None) -> BlindPatternPacket:
    """A deterministic, conservative ``rna_smart``-style geometry vote."""
    features = _pattern_features(geometry)
    bias = float(features["directional_bias"])
    body = float(features["body_mean"])
    if features["bars"] < 3:
        pattern_id, confidence = "INSUFFICIENT_GEOMETRY", 0.0
    elif abs(bias) >= 0.6 and body >= 0.35:
        pattern_id, confidence = ("BLIND_TREND_UP" if bias > 0 else "BLIND_TREND_DOWN"), min(1.0, 0.55 + abs(bias) * 0.35)
    elif features["compression"]:
        pattern_id, confidence = "BLIND_COMPRESSION", 0.5
    elif abs(float(features["wick_balance"])) >= 0.2:
        pattern_id, confidence = ("BLIND_REJECTION_UP" if features["wick_balance"] > 0 else "BLIND_REJECTION_DOWN"), 0.55
    else:
        pattern_id, confidence = "BLIND_CHOP", 0.35
    return BlindPatternPacket(pattern_id=pattern_id, confidence=confidence,
                              geometry_features=features, as_of_bar=as_of_bar)


def rna_smart(geometry: Sequence[Mapping[str, Any]], *, as_of_bar: int | None = None) -> BlindPatternPacket:
    """Named adapter matching the Fable/Neo harvest terminology."""
    return detect_blind_patterns(geometry, as_of_bar=as_of_bar)


def build_blind_pattern_packet(geometry_features: Mapping[str, Any], *, pattern_id: str = "BLIND_GEOMETRY",
                               confidence: float = 0.0, as_of_bar: int | None = None) -> BlindPatternPacket:
    """Build a packet from already blind geometry; raw OHLC is intentionally rejected."""
    return BlindPatternPacket(pattern_id=pattern_id, confidence=confidence,
                              geometry_features=validate_blind_geometry(geometry_features),
                              as_of_bar=as_of_bar)
