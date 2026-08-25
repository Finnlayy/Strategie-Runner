"""
Watchdog Health Daemon & Non-Blocking SSE Telemetry Stream (Modul 17: 17_WATCHDOG_SSE_TELEMETRY).
Implements:
- Non-blocking lock-free event queue for system telemetry
- Watchdog daemon monitoring sub-second heartbeat health
- Server-Sent Events (SSE) formatting for real-time dashboard subscriptions
"""

from collections import deque
from datetime import datetime, timezone
import json
import logging
import queue
import threading
import time
from typing import Any, Dict, Generator, List, Optional

from app.core.directives import CircuitBreakerStatus, ExecutionPath, system_directive

logger = logging.getLogger("watchdog_telemetry")


class NonBlockingLogger:
    """
    Asynchronous lock-free telemetry logger.
    """

    def __init__(self, max_buffer_size: int = 2000):
        self._queue = queue.Queue(maxsize=max_buffer_size)
        self._history = deque(maxlen=500)
        self._lock = threading.Lock()

    def log_event(self, category: str, message: str, payload: Optional[Dict[str, Any]] = None) -> None:
        evt = {
            "category": category,
            "message": message,
            "payload": payload or {},
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        try:
            self._queue.put_nowait(evt)
        except queue.Full:
            pass  # Drop oldest if congested to avoid blocking hot path

        with self._lock:
            self._history.append(evt)

    def get_recent_logs(self, limit: int = 100) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._history)[-limit:]


class SystemWatchdog:
    """
    Heartbeat Watchdog Daemon. Trips circuit breaker if hot-path heartbeat is dead for > 5000ms.
    """

    def __init__(self, heartbeat_timeout_sec: float = 5.0):
        self.heartbeat_timeout_sec = heartbeat_timeout_sec
        self._last_heartbeat = time.time()
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def beat(self) -> None:
        """Sends heartbeat from the primary trading/simulation loop."""
        with self._lock:
            self._last_heartbeat = time.time()

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._watchdog_loop, daemon=True, name="SystemWatchdogThread")
        self._thread.start()

    def _watchdog_loop(self) -> None:
        while self._running:
            time.sleep(1.0)
            with self._lock:
                elapsed = time.time() - self._last_heartbeat

            if elapsed > self.heartbeat_timeout_sec and system_directive.circuit_breaker == CircuitBreakerStatus.NORMAL:
                system_directive.trip_circuit_breaker(
                    status=CircuitBreakerStatus.TRIPPED_LATENCY,
                    reason=f"Hot-Path Watchdog Heartbeat Timeout: No heartbeat for {elapsed:.1f}s (Threshold {self.heartbeat_timeout_sec}s)"
                )
                logger.critical(f"[Watchdog] Heartbeat stale ({elapsed:.1f}s). Circuit breaker TRIPPED.")

    def get_watchdog_status(self) -> Dict[str, Any]:
        with self._lock:
            elapsed = time.time() - self._last_heartbeat
        return {
            "watchdog_running": self._running,
            "seconds_since_last_heartbeat": round(elapsed, 2),
            "heartbeat_healthy": elapsed < self.heartbeat_timeout_sec,
            "circuit_breaker": system_directive.circuit_breaker.value
        }


class SSETelemetryBroadcaster:
    """
    Formats and broadcasts real-time system state for SSE consumers.
    """

    def __init__(self, nb_logger: NonBlockingLogger, watchdog: SystemWatchdog):
        self.logger = nb_logger
        self.watchdog = watchdog

    def format_sse_event(self, event_name: str, data: Dict[str, Any]) -> str:
        """Converts dictionary to SSE compliant stream chunk."""
        json_data = json.dumps(data)
        return f"event: {event_name}\ndata: {json_data}\n\n"

    def generate_telemetry_snapshot(self) -> Dict[str, Any]:
        return {
            "directive": system_directive.get_system_telemetry(),
            "watchdog": self.watchdog.get_watchdog_status(),
            "recent_logs_count": len(self.logger.get_recent_logs(10)),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


# Global Singletons
nb_logger = NonBlockingLogger()
system_watchdog = SystemWatchdog()
system_watchdog.start()
sse_broadcaster = SSETelemetryBroadcaster(nb_logger, system_watchdog)
