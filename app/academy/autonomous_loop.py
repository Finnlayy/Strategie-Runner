"""Paper-only Jules Academy autonomous loop.

This is a deterministic orchestration shell: Scout (Sigma + blind perception),
Propose (structured paper intent), Judge (contract/gates), Postmortem and
Registry event.  No LLM, exchange, or paid API is called here.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Sequence

from app.contracts import AcademyEvent, BlindPatternPacket, QuantRequest
from app.paper.ledger import DurablePaperLedger
from app.perception import blind_geometry_from_candles, detect_blind_patterns
from app.quant.sigma_bridge import SigmaQuantBridge


class AutonomousLearningLoop:
    def __init__(self, *, bridge: Optional[SigmaQuantBridge] = None,
                 ledger: Optional[DurablePaperLedger] = None,
                 events_path: str = "data/academy/academy_events.jsonl"):
        self.bridge = bridge or SigmaQuantBridge()
        self.ledger = ledger or DurablePaperLedger()
        self.events_path = Path(events_path)

    def run_once(self, symbol: str, prices: Sequence[float], *, parameters: Optional[Mapping[str, Any]] = None,
                 geometry: Optional[Sequence[Mapping[str, Any]]] = None,
                 candles: Optional[Sequence[Mapping[str, Any]]] = None,
                 strategy_id: Optional[str] = None) -> Dict[str, Any]:
        blind: Optional[BlindPatternPacket] = None
        if candles is not None:
            blind = detect_blind_patterns(blind_geometry_from_candles(candles), as_of_bar=max(0, len(candles) - 1))
        elif geometry is not None:
            blind = detect_blind_patterns(geometry, as_of_bar=max(0, len(prices) - 1))
        request = QuantRequest(symbol=symbol, prices=list(prices), parameters=dict(parameters or {}),
                               as_of_bar=max(0, len(prices) - 1) if prices else None, blind_pattern=blind)
        result = self.bridge.evaluate(request)
        events = []
        if result.verdict.paper_intent is not None:
            record = self.ledger.append(result.verdict.paper_intent, metadata={
                "loop": "jules-autonomous", "verdict": result.verdict.status,
                "regime": result.regime.regime, "blind_pattern_id": blind.pattern_id if blind else None,
            })
            events.append(self._emit(AcademyEvent("PAPER_INTENT_RECORDED", {
                "intent_id": result.verdict.paper_intent.intent_id, "ledger_hash": record["record_hash"],
                "verdict": result.verdict.to_dict(),
            }, strategy_id=strategy_id)))
        else:
            events.append(self._emit(AcademyEvent("QUANT_FAIL_CLOSED", {
                "reasons": result.verdict.reasons, "backend_status": result.backend_status,
            }, strategy_id=strategy_id)))
        events.append(self._emit(AcademyEvent("POSTMORTEM_PENDING", {
            "request_id": request.request_id, "paper_only": True,
        }, strategy_id=strategy_id)))
        return {"request": request.to_dict(), "result": result.to_dict(), "events": [e.to_dict() for e in events]}

    def _emit(self, event: AcademyEvent) -> AcademyEvent:
        self.events_path.parent.mkdir(parents=True, exist_ok=True)
        with self.events_path.open("a", encoding="utf-8") as handle:
            handle.write(event.to_json() + "\n")
        return event
