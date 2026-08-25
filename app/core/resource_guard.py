"""
Resource Guard & Load Shedding Engine (Modul 11: 11_RESOURCE_GUARD_SHEDDING).
Implements:
- Volatility-based adaptive polling and compute throttling
- OS-level process priority management (nice levels)
- Dynamic Load Shedding during CPU/Memory spikes
"""

from datetime import datetime, timezone
import logging
import os
import time
from typing import Any, Dict, Optional

from app.core.directives import ExecutionPath, system_directive

logger = logging.getLogger("resource_guard")


class ResourceGuard:
    """
    Monitors system resource utilization and throttles background cold-path tasks
    during high-volatility live trading surges.
    """

    def __init__(self, high_vol_threshold: float = 0.85):
        self.high_vol_threshold = high_vol_threshold
        self._current_load_shedding = False

    def check_and_adjust_priority(self, is_hot_path_active: bool = True) -> None:
        """
        Sets process priority to high responsiveness for hot-path trading threads.
        """
        try:
            # Attempt to set nice value if permitted
            if hasattr(os, "nice"):
                current_nice = os.nice(0)
                if is_hot_path_active and current_nice > 0:
                    os.nice(-1)
        except (OSError, PermissionError):
            pass

    def get_adaptive_polling_interval_ms(self, annualized_volatility: float) -> int:
        """
        Calculates adaptive polling frequency:
        - Calm market (vol < 30%): 2500ms
        - Moderate market (30% <= vol < 70%): 1000ms
        - High volatility surge (vol >= 70%): 250ms hot-loop
        """
        if annualized_volatility < 0.30:
            return 2500
        elif annualized_volatility < 0.70:
            return 1000
        else:
            return 250

    def evaluate_load_shedding(self, recent_latency_ms: float) -> Dict[str, Any]:
        """
        If hot-path tick processing latency exceeds 50ms, initiates load shedding:
        suspends cold-path genetic optimization and background cloud sync.
        """
        if recent_latency_ms > 50.0:
            self._current_load_shedding = True
            logger.warning(f"[ResourceGuard] High tick latency ({recent_latency_ms:.1f}ms). Load shedding ACTIVATED.")
        else:
            self._current_load_shedding = False

        return {
            "load_shedding_active": self._current_load_shedding,
            "recent_latency_ms": round(recent_latency_ms, 2),
            "cold_path_allowed": not self._current_load_shedding,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


# Global Singleton
resource_guard = ResourceGuard()
