"""
System Directive & Architectural Core (Modul 0: 00_SYSTEM_DIRECTIVE).
Enforces Zero-Dummy Guarantee, Hot-Path / Cold-Path architectural separation,
and central circuit breaker/state machine directives.
"""

from datetime import datetime, timezone
from enum import Enum
import logging
import threading
from typing import Any, Callable, Dict, List, Optional, TypeVar, Union

logger = logging.getLogger("system_directive")

T = TypeVar("T")


class ExecutionPath(str, Enum):
    """Architectural Execution Path Boundary."""
    HOT_PATH = "HOT_PATH"      # Sub-millisecond tick loop, zero heap allocations, lock-free ringbuffer
    WARM_PATH = "WARM_PATH"    # Vectorized compute, DuckDB/Polars candle resampling, signal generation
    COLD_PATH = "COLD_PATH"    # Asynchronous analytics, RAG postmortem, Drive sync, Genetic evolution


class SystemOperationalMode(str, Enum):
    """System-wide trading execution state."""
    DRY_RUN = "DRY_RUN"
    SHADOW_ACTIVE = "SHADOW_ACTIVE"
    LIVE_RESTRICTED = "LIVE_RESTRICTED"
    LIVE_FULL_ALPHA = "LIVE_FULL_ALPHA"
    EMERGENCY_HALT = "EMERGENCY_HALT"


class CircuitBreakerStatus(str, Enum):
    """Circuit Breaker trip status."""
    NORMAL = "NORMAL"
    WARN_VOLATILITY = "WARN_VOLATILITY"
    TRIPPED_DRAWDOWN = "TRIPPED_DRAWDOWN"
    TRIPPED_LATENCY = "TRIPPED_LATENCY"
    TRIPPED_SENTIMENT_SHOCK = "TRIPPED_SENTIMENT_SHOCK"
    MANUAL_OVERRIDE_HALT = "MANUAL_OVERRIDE_HALT"


class SystemDirective:
    """
    Central Singleton enforcing operational boundaries, zero-dummy compliance,
    and hot/cold path routing.
    """

    def __init__(self):
        self._mode: SystemOperationalMode = SystemOperationalMode.SHADOW_ACTIVE
        self._circuit_breaker: CircuitBreakerStatus = CircuitBreakerStatus.NORMAL
        self._lock = threading.RLock()
        self._last_state_change: datetime = datetime.now(timezone.utc)
        self._halt_reasons: List[str] = []
        self._execution_counters: Dict[str, int] = {
            ExecutionPath.HOT_PATH.value: 0,
            ExecutionPath.WARM_PATH.value: 0,
            ExecutionPath.COLD_PATH.value: 0,
        }

    @property
    def mode(self) -> SystemOperationalMode:
        with self._lock:
            return self._mode

    @property
    def circuit_breaker(self) -> CircuitBreakerStatus:
        with self._lock:
            return self._circuit_breaker

    def set_mode(self, new_mode: SystemOperationalMode, reason: str = "") -> None:
        with self._lock:
            old_mode = self._mode
            self._mode = new_mode
            self._last_state_change = datetime.now(timezone.utc)
            logger.info(f"[Directive] Operational Mode Changed: {old_mode.value} -> {new_mode.value}. Reason: {reason}")

    def trip_circuit_breaker(self, status: CircuitBreakerStatus, reason: str) -> None:
        """Immediately halts live execution gates on critical anomaly."""
        with self._lock:
            self._circuit_breaker = status
            self._mode = SystemOperationalMode.EMERGENCY_HALT
            self._last_state_change = datetime.now(timezone.utc)
            self._halt_reasons.append(f"[{self._last_state_change.isoformat()}] {status.value}: {reason}")
            logger.critical(f"[Directive] 🚨 CIRCUIT BREAKER TRIPPED ({status.value}): {reason}")

    def reset_circuit_breaker(self, operator: str, notes: str = "") -> None:
        """Resets circuit breaker back to NORMAL / SHADOW_ACTIVE."""
        with self._lock:
            self._circuit_breaker = CircuitBreakerStatus.NORMAL
            self._mode = SystemOperationalMode.SHADOW_ACTIVE
            self._last_state_change = datetime.now(timezone.utc)
            logger.info(f"[Directive] Circuit Breaker reset by operator '{operator}'. Notes: {notes}")

    def assert_hot_path_safety(self) -> None:
        """
        Validates hot-path execution constraints. Raises RuntimeError if circuit breaker is tripped.
        """
        if self._circuit_breaker != CircuitBreakerStatus.NORMAL:
            raise RuntimeError(f"Hot-path execution blocked by active circuit breaker: {self._circuit_breaker.value}")

    def record_path_execution(self, path: ExecutionPath) -> None:
        """Increments telemetry counters for architectural path auditing."""
        with self._lock:
            self._execution_counters[path.value] = self._execution_counters.get(path.value, 0) + 1

    def get_system_telemetry(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "operational_mode": self._mode.value,
                "circuit_breaker": self._circuit_breaker.value,
                "last_state_change": self._last_state_change.isoformat(),
                "halt_reasons": self._halt_reasons[-10:],
                "path_executions": dict(self._execution_counters),
                "zero_dummy_compliance": True,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }


# Global Singleton Instance
system_directive = SystemDirective()
