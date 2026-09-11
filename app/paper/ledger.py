"""Append-only durable ledger for Sigma PaperIntents.

The ledger is intentionally independent of exchange clients.  It records
intent/parity evidence and can be replayed by Night-Train; it cannot place an
order and rejects any non-paper intent.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from threading import RLock
from typing import Any, Dict, Iterable, Iterator, Mapping, Optional

from app.contracts import PaperIntent, canonical_hash


class PaperLedgerError(ValueError):
    pass


class DurablePaperLedger:
    def __init__(self, path: str = "data/paper/paper_intents.jsonl"):
        self.path = Path(path)
        self._lock = RLock()

    def append(self, intent: PaperIntent | Mapping[str, Any], *, metadata: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        if not isinstance(intent, PaperIntent):
            intent = PaperIntent.from_dict(intent)
        if intent.execution_mode != "paper":
            raise PaperLedgerError("paper ledger refuses non-paper intents")
        with self._lock:
            previous = self._last_hash()
            record = {
                "schema": "paper-ledger/1",
                "sequence": self._count() + 1,
                "recorded_at": datetime.now(timezone.utc).isoformat(),
                "prev_hash": previous,
                "intent": intent.to_dict(),
                "metadata": dict(metadata or {}),
            }
            record["record_hash"] = canonical_hash(record)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, sort_keys=True, ensure_ascii=False) + "\n")
            return record

    def records(self) -> Iterator[Dict[str, Any]]:
        if not self.path.exists():
            return iter(())
        def _iterate() -> Iterator[Dict[str, Any]]:
            with self.path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if line.strip():
                        yield json.loads(line)
        return _iterate()

    def verify(self) -> Dict[str, Any]:
        previous = ""
        count = 0
        errors = []
        for count, record in enumerate(self.records(), 1):
            expected = record.get("record_hash")
            body = dict(record)
            body.pop("record_hash", None)
            if record.get("prev_hash", "") != previous:
                errors.append(f"sequence {count}: prev_hash mismatch")
            if canonical_hash(body) != expected:
                errors.append(f"sequence {count}: record_hash mismatch")
            try:
                PaperIntent.from_dict(record["intent"])
            except Exception as exc:
                errors.append(f"sequence {count}: invalid intent ({exc})")
            previous = str(expected or "")
        return {"ok": not errors, "records": count, "errors": errors, "head_hash": previous}

    def replay(self, limit: int = 1000) -> list[PaperIntent]:
        limit = int(limit)
        if limit <= 0:
            return []
        output = []
        for record in list(self.records())[-limit:]:
            output.append(PaperIntent.from_dict(record["intent"]))
        return output

    def _last_hash(self) -> str:
        last = ""
        for record in self.records():
            last = str(record.get("record_hash") or "")
        return last

    def _count(self) -> int:
        return sum(1 for _ in self.records())
