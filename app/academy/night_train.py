"""Budget-capped, paper-only Jules Night-Train job."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.contracts import AcademyEvent, NightTrainReport
from app.paper.ledger import DurablePaperLedger


class NightTrainJob:
    def __init__(self, *, ledger: Optional[DurablePaperLedger] = None,
                 max_records: int = 500, max_cost_usd: float = 0.0):
        self.ledger = ledger or DurablePaperLedger()
        self.max_records = max(0, int(max_records))
        self.max_cost_usd = max(0.0, float(max_cost_usd))

    def run(self, *, dry_run: bool = True, has_data: Optional[bool] = None) -> NightTrainReport:
        started = datetime.now(timezone.utc).isoformat()
        records = list(self.ledger.records())[: self.max_records]
        data_available = bool(records) if has_data is None else bool(has_data and records)
        budget = {"max_records": self.max_records, "processed_records": 0,
                  "max_cost_usd": self.max_cost_usd, "estimated_cost_usd": 0.0,
                  "paid_api_calls": 0}
        if not data_available:
            return NightTrainReport(status="SKIPPED", dry_run=dry_run, errors=["NO_PAPER_DATA"],
                                    budget=budget, fail_closed=True, started_at=started,
                                    completed_at=datetime.now(timezone.utc).isoformat())
        events = []
        drills = []
        policies = []
        for record in records:
            intent = record.get("intent", {})
            budget["processed_records"] += 1
            events.append(AcademyEvent("PAPER_REPLAY", {
                "intent_id": intent.get("intent_id"), "action": intent.get("action"),
                "parity_hash": intent.get("parity_hash"), "dry_run": dry_run,
            }))
            policies.append({"intent_id": intent.get("intent_id"), "promotion": "SHADOW_ONLY",
                             "live_authorized": False, "reason": "promotion_never_implies_live"})
        return NightTrainReport(status="DRY_RUN" if dry_run else "COMPLETED", dry_run=dry_run,
                                events=events, drills=drills, policy_evaluations=policies,
                                budget=budget, fail_closed=False, started_at=started,
                                completed_at=datetime.now(timezone.utc).isoformat())


def run_night_train(*, ledger_path: str = "data/paper/paper_intents.jsonl", dry_run: bool = True,
                    max_records: int = 500, max_cost_usd: float = 0.0) -> Dict[str, Any]:
    return NightTrainJob(ledger=DurablePaperLedger(ledger_path), max_records=max_records,
                         max_cost_usd=max_cost_usd).run(dry_run=dry_run).to_dict()
