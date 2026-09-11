"""Small Jules Academy state contract used by the paper learning loop.

The source Jules prompt pack is not present in this checkout, so this is an
explicit minimal bridge state, not a claim to be its canonical curriculum.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping


@dataclass
class AcademyState:
    curriculum: Dict[str, Any] = field(default_factory=lambda: {"version": "runner-bridge-1", "tracks": []})
    drills: List[Dict[str, Any]] = field(default_factory=list)
    career: List[Dict[str, Any]] = field(default_factory=list)
    promotion_gate: Dict[str, Any] = field(default_factory=lambda: {
        "paper_only": True, "parity_required": True, "live_authorized": False,
    })

    def record_drill(self, drill_id: str, result: Mapping[str, Any]) -> None:
        self.drills.append({"drill_id": str(drill_id), "result": dict(result), "paper_only": True})

    def record_career_event(self, event: Mapping[str, Any]) -> None:
        self.career.append(dict(event))

    def evaluate_promotion(self, *, parity_ok: bool, drills_passed: bool, score: float = 0.0) -> Dict[str, Any]:
        """Return a shadow decision; this method cannot return a live grant."""
        if not parity_ok:
            return {"decision": "BLOCK", "status": "ACADEMY", "reason": "GBH-06 parity required",
                    "live_authorized": False}
        if not drills_passed:
            return {"decision": "BLOCK", "status": "ACADEMY", "reason": "drill gate not passed",
                    "live_authorized": False}
        return {"decision": "PROMOTE_SHADOW", "status": "SHADOW_CHAMPION", "score": float(score),
                "paper_only": True, "live_authorized": False}


__all__ = ["AcademyState"]
