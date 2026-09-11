"""Boundary contracts shared by the quant, perception and academy adapters.

These are intentionally small dataclasses rather than pydantic models.  The
Runner has a stdlib-only orchestrator path and should fail closed even when an
optional Sigma/Jules installation is absent.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import math
from typing import Any, ClassVar, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

SCHEMA_VERSION = "fusion-contracts/1"


class ContractError(ValueError):
    """Raised when an external payload violates a fusion contract."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _finite(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _clean_symbol(value: Any) -> str:
    symbol = str(value or "").strip().upper()
    if not symbol or len(symbol) > 40:
        raise ContractError("symbol must be a non-empty string of at most 40 characters")
    return symbol


def canonical_hash(value: Mapping[str, Any]) -> str:
    """Hash a JSON-compatible mapping using a deterministic representation."""
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class ContractMixin:
    schema_version: ClassVar[str] = SCHEMA_VERSION

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out.setdefault("schema_version", self.schema_version)
        return out

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


@dataclass
class BlindPatternPacket(ContractMixin):
    """Symbol/timeframe/price-free perception output.

    `geometry_features` may contain ratios, directions and categorical pattern
    labels only.  It must never contain raw OHLC, timestamps, a symbol or a
    timeframe.  This is checked both on construction and deserialisation.
    """

    pattern_id: str
    confidence: float
    geometry_features: Dict[str, Any] = field(default_factory=dict)
    closed_bar_only: bool = True
    symbol_agnostic: bool = True
    source: str = "fable_blind"
    as_of_bar: Optional[int] = None
    packet_hash: str = ""
    schema_version: str = SCHEMA_VERSION

    _FORBIDDEN: ClassVar[Tuple[str, ...]] = (
        "symbol", "ticker", "asset", "timeframe", "tf", "timestamp", "datetime",
        "price", "open", "high", "low", "close", "vwap", "absolute_price",
        "future", "next_bar", "lookahead", "look_ahead", "predicted",
    )

    def __post_init__(self) -> None:
        self.pattern_id = str(self.pattern_id or "").strip()
        if not self.pattern_id or len(self.pattern_id) > 100:
            raise ContractError("pattern_id is required")
        if not _finite(self.confidence) or not 0 <= float(self.confidence) <= 1:
            raise ContractError("confidence must be in [0, 1]")
        if not self.closed_bar_only:
            raise ContractError("blind patterns require closed_bar_only=true")
        if not self.symbol_agnostic:
            raise ContractError("blind patterns must be symbol_agnostic=true")
        if self.as_of_bar is not None and (not isinstance(self.as_of_bar, int) or self.as_of_bar < 0):
            raise ContractError("as_of_bar must be a non-negative integer")
        self.geometry_features = _validate_blind_mapping(self.geometry_features, self._FORBIDDEN)
        if not self.packet_hash:
            self.packet_hash = canonical_hash({
                "pattern_id": self.pattern_id,
                "confidence": float(self.confidence),
                "geometry_features": self.geometry_features,
                "closed_bar_only": True,
                "symbol_agnostic": True,
            })

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "BlindPatternPacket":
        return cls(**{k: payload[k] for k in (
            "pattern_id", "confidence", "geometry_features", "closed_bar_only", "symbol_agnostic",
            "source", "as_of_bar", "packet_hash", "schema_version",
        ) if k in payload})


@dataclass
class QuantRequest(ContractMixin):
    symbol: str
    prices: List[float] = field(default_factory=list)
    timeframe: Optional[str] = None
    parameters: Dict[str, Any] = field(default_factory=dict)
    as_of_bar: Optional[int] = None
    closed_candle_only: bool = True
    execution_mode: str = "paper"
    requested_qty: float = 0.0
    blind_pattern: Optional[BlindPatternPacket] = None
    request_id: str = ""
    created_at: str = field(default_factory=_now)
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        self.symbol = _clean_symbol(self.symbol)
        if self.timeframe is not None and (not str(self.timeframe).strip() or len(str(self.timeframe)) > 20):
            raise ContractError("timeframe must be a short optional string")
        self.prices = [float(x) for x in self.prices]
        if any(not _finite(x) or float(x) <= 0 for x in self.prices):
            raise ContractError("prices must contain finite positive values")
        if not self.closed_candle_only:
            raise ContractError("look-ahead guard: only closed candles are accepted")
        if str(self.execution_mode).lower() != "paper":
            raise ContractError("AI/quant adapters are paper-only; execution_mode must be 'paper'")
        if not _finite(self.requested_qty) or float(self.requested_qty) < 0:
            raise ContractError("requested_qty must be finite and non-negative")
        if self.as_of_bar is not None and (not isinstance(self.as_of_bar, int) or self.as_of_bar < 0):
            raise ContractError("as_of_bar must be a non-negative integer")
        if self.blind_pattern is not None and not isinstance(self.blind_pattern, BlindPatternPacket):
            self.blind_pattern = BlindPatternPacket.from_dict(self.blind_pattern)
        if not self.request_id:
            self.request_id = canonical_hash({"symbol": self.symbol, "prices": self.prices,
                                              "parameters": self.parameters, "as_of_bar": self.as_of_bar})[:24]

    def to_dict(self) -> Dict[str, Any]:
        out = super().to_dict()
        if self.blind_pattern is not None:
            out["blind_pattern"] = self.blind_pattern.to_dict()
        return out

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "QuantRequest":
        data = dict(payload)
        if isinstance(data.get("blind_pattern"), Mapping):
            data["blind_pattern"] = BlindPatternPacket.from_dict(data["blind_pattern"])
        return cls(**{k: data[k] for k in (
            "symbol", "prices", "timeframe", "parameters", "as_of_bar", "closed_candle_only", "execution_mode",
            "requested_qty", "blind_pattern", "request_id", "created_at", "schema_version",
        ) if k in data})


@dataclass
class RegimePacket(ContractMixin):
    symbol: str
    regime: str
    confidence: float
    features: Dict[str, Any] = field(default_factory=dict)
    as_of_bar: Optional[int] = None
    closed_candle_only: bool = True
    source: str = "sigma"
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        self.symbol = _clean_symbol(self.symbol)
        self.regime = str(self.regime or "UNKNOWN").upper()
        if not _finite(self.confidence) or not 0 <= float(self.confidence) <= 1:
            raise ContractError("regime confidence must be in [0, 1]")
        if not self.closed_candle_only:
            raise ContractError("regime packet must be closed-candle-only")
        if self.as_of_bar is not None and (not isinstance(self.as_of_bar, int) or self.as_of_bar < 0):
            raise ContractError("as_of_bar must be a non-negative integer")

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "RegimePacket":
        return cls(**{k: payload[k] for k in (
            "symbol", "regime", "confidence", "features", "as_of_bar", "closed_candle_only", "source", "schema_version",
        ) if k in payload})


@dataclass
class PaperIntent(ContractMixin):
    """Durable, paper-only intent.  It is not an executable broker order."""

    symbol: str
    action: str
    qty: float
    price_hint: float
    source: str = "sigma"
    reason_codes: List[str] = field(default_factory=list)
    request_id: str = ""
    intent_id: str = ""
    execution_mode: str = "paper"
    paper_only: bool = True
    parity_hash: str = ""
    created_at: str = field(default_factory=_now)
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        self.symbol = _clean_symbol(self.symbol)
        self.action = str(self.action or "HOLD").upper()
        if self.action not in {"BUY", "SELL", "HOLD", "FLATTEN", "LONG", "SHORT"}:
            raise ContractError("unsupported paper action")
        if not _finite(self.qty) or float(self.qty) < 0:
            raise ContractError("qty must be finite and non-negative")
        if not _finite(self.price_hint) or float(self.price_hint) < 0:
            raise ContractError("price_hint must be finite and non-negative")
        if str(self.execution_mode).lower() != "paper" or not self.paper_only:
            raise ContractError("PaperIntent cannot be live")
        if not self.intent_id:
            self.intent_id = "pi_" + canonical_hash({
                "symbol": self.symbol, "action": self.action, "qty": float(self.qty),
                "price_hint": float(self.price_hint), "request_id": self.request_id,
                "parity_hash": self.parity_hash,
            })[:24]

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "PaperIntent":
        return cls(**{k: payload[k] for k in (
            "symbol", "action", "qty", "price_hint", "source", "reason_codes", "request_id",
            "intent_id", "execution_mode", "paper_only", "parity_hash", "created_at", "schema_version",
        ) if k in payload})


@dataclass
class QuantVerdict(ContractMixin):
    symbol: str
    status: str
    score: float
    regime: RegimePacket
    backend: str
    reasons: List[str] = field(default_factory=list)
    features: Dict[str, Any] = field(default_factory=dict)
    paper_intent: Optional[PaperIntent] = None
    fail_closed: bool = False
    request_id: str = ""
    evaluated_at: str = field(default_factory=_now)
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        self.symbol = _clean_symbol(self.symbol)
        self.status = str(self.status or "UNAVAILABLE").upper()
        if self.status not in {"APPROVED", "REJECTED", "UNAVAILABLE", "NO_SIGNAL"}:
            raise ContractError("invalid quant verdict status")
        if not _finite(self.score) or not -1 <= float(self.score) <= 1:
            raise ContractError("quant score must be in [-1, 1]")
        if not isinstance(self.regime, RegimePacket):
            self.regime = RegimePacket.from_dict(self.regime)
        if self.paper_intent is not None and not isinstance(self.paper_intent, PaperIntent):
            self.paper_intent = PaperIntent.from_dict(self.paper_intent)
        if self.status == "UNAVAILABLE" and not self.fail_closed:
            raise ContractError("unavailable verdicts must be fail_closed")

    def to_dict(self) -> Dict[str, Any]:
        out = super().to_dict()
        out["regime"] = self.regime.to_dict()
        if self.paper_intent is not None:
            out["paper_intent"] = self.paper_intent.to_dict()
        return out

    @property
    def verdict(self) -> str:
        """Semantic alias used by callers that call the status a verdict."""
        return self.status

    @property
    def usable(self) -> bool:
        return self.status in {"APPROVED", "NO_SIGNAL"} and not self.fail_closed

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "QuantVerdict":
        data = dict(payload)
        if isinstance(data.get("regime"), Mapping):
            data["regime"] = RegimePacket.from_dict(data["regime"])
        if isinstance(data.get("paper_intent"), Mapping):
            data["paper_intent"] = PaperIntent.from_dict(data["paper_intent"])
        return cls(**{k: data[k] for k in (
            "symbol", "status", "score", "regime", "backend", "reasons", "features", "paper_intent",
            "fail_closed", "request_id", "evaluated_at", "schema_version",
        ) if k in data})


@dataclass
class AcademyEvent(ContractMixin):
    event_type: str
    payload: Dict[str, Any] = field(default_factory=dict)
    strategy_id: Optional[str] = None
    event_id: str = ""
    paper_only: bool = True
    created_at: str = field(default_factory=_now)
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        self.event_type = str(self.event_type or "").strip().upper()
        if not self.event_type:
            raise ContractError("event_type is required")
        if not self.paper_only:
            raise ContractError("Academy events cannot authorize live execution")
        if not self.event_id:
            self.event_id = "ae_" + canonical_hash({"event_type": self.event_type, "payload": self.payload,
                                                      "strategy_id": self.strategy_id, "created_at": self.created_at})[:24]

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "AcademyEvent":
        return cls(**{k: payload[k] for k in (
            "event_type", "payload", "strategy_id", "event_id", "paper_only", "created_at", "schema_version",
        ) if k in payload})


@dataclass
class NightTrainReport(ContractMixin):
    status: str
    dry_run: bool
    events: List[AcademyEvent] = field(default_factory=list)
    drills: List[Dict[str, Any]] = field(default_factory=list)
    policy_evaluations: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    budget: Dict[str, Any] = field(default_factory=dict)
    fail_closed: bool = False
    report_id: str = ""
    started_at: str = field(default_factory=_now)
    completed_at: str = field(default_factory=_now)
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        self.status = str(self.status or "SKIPPED").upper()
        if self.status not in {"COMPLETED", "SKIPPED", "FAILED", "DRY_RUN"}:
            raise ContractError("invalid night-train status")
        self.events = [e if isinstance(e, AcademyEvent) else AcademyEvent.from_dict(e) for e in self.events]
        if self.status == "SKIPPED" and not self.fail_closed:
            raise ContractError("skipped night train must be fail_closed")
        if not self.report_id:
            self.report_id = "nt_" + canonical_hash({"status": self.status, "dry_run": self.dry_run,
                                                       "events": [e.to_dict() for e in self.events],
                                                       "started_at": self.started_at})[:24]

    def to_dict(self) -> Dict[str, Any]:
        out = super().to_dict()
        out["events"] = [e.to_dict() for e in self.events]
        return out

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "NightTrainReport":
        data = dict(payload)
        data["events"] = [AcademyEvent.from_dict(x) if isinstance(x, Mapping) else x for x in data.get("events", [])]
        return cls(**{k: data[k] for k in (
            "status", "dry_run", "events", "drills", "policy_evaluations", "errors", "budget", "fail_closed",
            "report_id", "started_at", "completed_at", "schema_version",
        ) if k in data})


def _validate_blind_mapping(value: Mapping[str, Any], forbidden: Iterable[str], prefix: str = "") -> Dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ContractError("geometry_features must be a mapping")
    forbidden_set = {str(k).lower() for k in forbidden}
    result: Dict[str, Any] = {}
    for key, item in value.items():
        key_s = str(key)
        low = key_s.lower()
        if low in forbidden_set or any(token in low for token in ("symbol", "timeframe", "timestamp", "price", "lookahead", "future")):
            raise ContractError(f"blind leakage guard rejected field: {prefix}{key_s}")
        if isinstance(item, Mapping):
            result[key_s] = _validate_blind_mapping(item, forbidden, prefix + key_s + ".")
        elif isinstance(item, (list, tuple)):
            result[key_s] = [_validate_blind_mapping(x, forbidden, prefix + key_s + ".") if isinstance(x, Mapping) else x for x in item]
        elif isinstance(item, (str, bool, int, float)) or item is None:
            if isinstance(item, float) and not math.isfinite(item):
                raise ContractError(f"non-finite blind feature: {key_s}")
            result[key_s] = item
        else:
            raise ContractError(f"unsupported blind feature type: {key_s}")
    return result
