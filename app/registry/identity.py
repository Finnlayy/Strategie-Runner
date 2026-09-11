"""
Strategy Identity and Lifecycle Pydantic Data Models (Modul 6).
Provides immutable typing for Strategy Identifiers, Certificates, Badges, and Career Events.
"""

from datetime import datetime, timezone
from enum import Enum
import hashlib
import json
from typing import Any, Dict, List, Optional
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator


class LifecycleStatus(str, Enum):
    """Lifecycle status enumeration for strategies in the quantitative pipeline."""
    ACADEMY = "ACADEMY"
    DRILL_TESTING = "DRILL_TESTING"
    SHADOW_CHALLENGER = "SHADOW_CHALLENGER"
    SHADOW_CHAMPION = "SHADOW_CHAMPION"
    LIVE_CHAMPION = "LIVE_CHAMPION"  # explicit operator/policy transition only
    DEGRADED = "DEGRADED"
    RETIRED = "RETIRED"


class BadgeType(str, Enum):
    """Badge types recognized by the Strategy Registry."""
    BEAR_MARKET_SURVIVOR = "BEAR_MARKET_SURVIVOR"
    DSR_ELITE = "DSR_ELITE"
    FLASH_CRASH_TESTED = "FLASH_CRASH_TESTED"
    MEAN_REVERSION_MASTER = "MEAN_REVERSION_MASTER"
    TREND_SNIPER = "TREND_SNIPER"
    WFO_CHAMPION = "WFO_CHAMPION"
    SHADOW_RACER = "SHADOW_RACER"
    LIVE_PROMOTED = "LIVE_PROMOTED"
    BATTLE_TESTED_VETERAN = "BATTLE_TESTED_VETERAN"


class CareerEventType(str, Enum):
    """Immutable career lifecycle event types."""
    BORN = "BORN"
    PASSED_WFO = "PASSED_WFO"
    DSR_VALIDATED = "DSR_VALIDATED"
    DRILL_ATTEMPTED = "DRILL_ATTEMPTED"
    PASSED_DRILL = "PASSED_DRILL"
    FAILED_DRILL = "FAILED_DRILL"
    ACADEMY_GRADUATED = "ACADEMY_GRADUATED"
    ENTERED_SHADOW_QUEUE = "ENTERED_SHADOW_QUEUE"
    SHADOW_RACE_EVALUATED = "SHADOW_RACE_EVALUATED"
    PROMOTED_TO_SHADOW = "PROMOTED_TO_SHADOW"
    PROMOTED_TO_LIVE = "PROMOTED_TO_LIVE"  # never emitted by Academy shadow races
    DEGRADED_TO_ACADEMY = "DEGRADED_TO_ACADEMY"
    BADGE_AWARDED = "BADGE_AWARDED"
    METRICS_SNAPSHOT = "METRICS_SNAPSHOT"
    RETIRED = "RETIRED"


class BadgeCertificate(BaseModel):
    """
    Certified qualification badge awarded to a strategy upon meeting verifiable quantitative criteria.
    """
    model_config = ConfigDict(extra="ignore")

    badge_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    badge_type: BadgeType
    title: str
    description: str
    earned_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    evidence: Dict[str, Any] = Field(default_factory=dict)
    issuer: str = "STRATEGY_REGISTRY_V1"


class CareerEvent(BaseModel):
    """
    Append-only immutable record representing a distinct lifecycle event in a strategy's career.
    """
    model_config = ConfigDict(extra="ignore")

    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    strategy_id: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    event_type: CareerEventType
    title: str
    description: str
    actor: str = "SYSTEM_ORCHESTRATOR"
    payload: Dict[str, Any] = Field(default_factory=dict)
    hash_prev: Optional[str] = None
    hash_curr: str = ""

    def compute_hash(self) -> str:
        """
        Computes deterministic SHA-256 hash chaining over the event contents.

        Returns:
            Hexadecimal SHA-256 digest string.
        """
        raw_payload = json.dumps(self.payload, sort_keys=True)
        raw_str = f"{self.event_id}:{self.strategy_id}:{self.timestamp}:{self.event_type.value}:{self.hash_prev or ''}:{raw_payload}"
        return hashlib.sha256(raw_str.encode("utf-8")).hexdigest()


class StrategyIdentity(BaseModel):
    """
    Canonical Strategy Identity representation storing lineage, genome hash, credentials and career status.
    """
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    born_from_hash: str
    generation: int = 1
    parent_ids: List[str] = Field(default_factory=list)
    asset_pair: str = "BTC/USD"
    timeframe: str = "15m"
    status: LifecycleStatus = LifecycleStatus.ACADEMY
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    parameters: Dict[str, Any] = Field(default_factory=dict)
    genome: Optional[Dict[str, Any]] = None
    code_snippet: Optional[str] = None
    badges: List[BadgeCertificate] = Field(default_factory=list)
    metrics: Dict[str, Any] = Field(default_factory=dict)
    drills_passed: List[str] = Field(default_factory=list)
    shadow_race_record: Dict[str, int] = Field(default_factory=lambda: {"wins": 0, "losses": 0, "draws": 0})

    @staticmethod
    def generate_dna_hash(params: Dict[str, Any], genome: Optional[Dict[str, Any]] = None) -> str:
        """
        Generates canonical DNA hash from strategy configuration and chromosomal genes.

        Args:
            params: Strategy parameter dictionary.
            genome: Optional genetic chromosome dictionary.

        Returns:
            Deterministic 64-character hex SHA-256 hash.
        """
        data = {"parameters": params, "genome": genome or {}}
        canonical_json = json.dumps(data, sort_keys=True)
        return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
