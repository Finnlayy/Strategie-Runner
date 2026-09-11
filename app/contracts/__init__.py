"""Stable, JSON-serialisable contracts for the Sigma/Jules/Fable fusion.

The contracts deliberately use only the standard library.  They are boundary
objects, not trading models: every object is paper-only and can be round-tripped
through JSON without losing its schema version or provenance.
"""
from .harvests import (
    AcademyEvent,
    BlindPatternPacket,
    ContractError,
    NightTrainReport,
    PaperIntent,
    QuantRequest,
    QuantVerdict,
    RegimePacket,
    canonical_hash,
)

__all__ = [
    "AcademyEvent", "BlindPatternPacket", "ContractError", "NightTrainReport",
    "PaperIntent", "QuantRequest", "QuantVerdict", "RegimePacket", "canonical_hash",
]
