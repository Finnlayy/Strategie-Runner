"""
Immutable Career Log Manager (Modul 6).
Handles append-only JSONL event sourcing with SHA-256 cryptographic hash-chain verification.
"""

from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import threading
from typing import Dict, List, Optional, Tuple

from app.registry.identity import CareerEvent, CareerEventType

logger = logging.getLogger("career_log")


class CareerLogManager:
    """
    Manages append-only JSON-Lines logs recording every lifecycle transition of quantitative strategies.
    Ensures tamper-evident verification through consecutive SHA-256 event chaining.
    """

    def __init__(self, base_dir: str = "data/registry"):
        """
        Initializes the Career Log Manager.

        Args:
            base_dir: Base directory where registry JSONL logs reside.
        """
        self.base_dir = Path(base_dir)
        self.global_log_file = self.base_dir / "career_events.jsonl"
        self.strategies_dir = self.base_dir / "strategies"
        self._lock = threading.Lock()
        
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.strategies_dir.mkdir(parents=True, exist_ok=True)

    def _get_strategy_log_path(self, strategy_id: str) -> Path:
        """Returns the isolated JSONL file path for a specific strategy."""
        return self.strategies_dir / f"{strategy_id}.jsonl"

    def _get_last_event_hash(self, strategy_id: str) -> Optional[str]:
        """
        Reads the most recent event hash from the strategy's dedicated log file.

        Args:
            strategy_id: Unique strategy identifier.

        Returns:
            Previous event hash or None if no prior events exist.
        """
        strat_path = self._get_strategy_log_path(strategy_id)
        if not strat_path.exists():
            return None

        last_line = ""
        try:
            with open(strat_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        last_line = line.strip()
            if last_line:
                parsed = json.loads(last_line)
                return parsed.get("hash_curr")
        except Exception as e:
            logger.warning(f"Error reading last hash for strategy {strategy_id}: {e}")
        return None

    def append_event(
        self,
        strategy_id: str,
        event_type: CareerEventType,
        title: str,
        description: str,
        payload: Optional[Dict] = None,
        actor: str = "SYSTEM_ORCHESTRATOR"
    ) -> CareerEvent:
        """
        Appends an immutable lifecycle event to both the strategy-specific log and global registry journal.

        Args:
            strategy_id: Unique strategy identifier.
            event_type: Enum value representing the lifecycle event.
            title: Human-readable short title.
            description: Detailed description of event context.
            payload: Supplementary metrics, parameters or validation proofs.
            actor: Subsystem or agent executing the change.

        Returns:
            The created and hash-sealed CareerEvent.
        """
        with self._lock:
            prev_hash = self._get_last_event_hash(strategy_id)
            
            event = CareerEvent(
                strategy_id=strategy_id,
                event_type=event_type,
                title=title,
                description=description,
                actor=actor,
                payload=payload or {},
                hash_prev=prev_hash
            )
            event.hash_curr = event.compute_hash()

            serialized = json.dumps(event.model_dump(), sort_keys=True) + "\n"

            # 1. Write to strategy-specific JSONL
            strat_path = self._get_strategy_log_path(strategy_id)
            with open(strat_path, "a", encoding="utf-8") as f:
                f.write(serialized)

            # 2. Write to global journal
            with open(self.global_log_file, "a", encoding="utf-8") as f:
                f.write(serialized)

            return event

    def get_events(self, strategy_id: str) -> List[CareerEvent]:
        """
        Retrieves all chronological career events for a given strategy.

        Args:
            strategy_id: Unique strategy identifier.

        Returns:
            List of CareerEvent models ordered by occurrence.
        """
        strat_path = self._get_strategy_log_path(strategy_id)
        if not strat_path.exists():
            return []

        events: List[CareerEvent] = []
        with open(strat_path, "r", encoding="utf-8") as f:
            for line in f:
                line_str = line.strip()
                if line_str:
                    try:
                        data = json.loads(line_str)
                        events.append(CareerEvent.model_validate(data))
                    except Exception as err:
                        logger.error(f"Failed to parse career event line: {err}")
        return events

    def get_all_recent_events(self, limit: int = 100) -> List[CareerEvent]:
        """
        Retrieves the most recent global career events across all strategies.

        Args:
            limit: Maximum number of events to return.

        Returns:
            List of CareerEvent models sorted newest first.
        """
        if not self.global_log_file.exists():
            return []

        events: List[CareerEvent] = []
        with open(self.global_log_file, "r", encoding="utf-8") as f:
            for line in f:
                line_str = line.strip()
                if line_str:
                    try:
                        data = json.loads(line_str)
                        events.append(CareerEvent.model_validate(data))
                    except Exception as err:
                        logger.error(f"Failed to parse global career event: {err}")

        # Return latest first
        return sorted(events, key=lambda x: x.timestamp, reverse=True)[:limit]

    def verify_log_integrity(self, strategy_id: str) -> Tuple[bool, Optional[str]]:
        """
        Cryptographically verifies the hash-chain integrity of a strategy's career log.

        Args:
            strategy_id: Unique strategy identifier.

        Returns:
            Tuple of (is_valid: bool, error_details: Optional[str]).
        """
        events = self.get_events(strategy_id)
        if not events:
            return True, "No events recorded."

        expected_prev_hash: Optional[str] = None
        for idx, ev in enumerate(events):
            if ev.hash_prev != expected_prev_hash:
                return False, f"Hash chain broken at event #{idx} ({ev.event_id}): expected prev {expected_prev_hash}, got {ev.hash_prev}"
            
            recomputed = ev.compute_hash()
            if recomputed != ev.hash_curr:
                return False, f"Tampered hash detected at event #{idx} ({ev.event_id}): recomputed {recomputed}, recorded {ev.hash_curr}"

            expected_prev_hash = ev.hash_curr

        return True, f"Cryptographic integrity verified across {len(events)} career events."


# Global Singleton
career_logger = CareerLogManager()
