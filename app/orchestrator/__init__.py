"""
ALPHA/SIGMA-Orchestrator (Modul 19): Zwei-Kammer-Engine fuer autonome Grok-Agenten.

ALPHA (Antragskammer) sammelt gerichtete Edge-Vorschlaege, SIGMA (Bewilligungskammer)
skaliert und verweigert nach Volatilitaet, Regime und harten Kappen, die Arbitrierung
erzeugt daraus ein deterministisches Urteil mit Reason-Codes. Der Grok-Bot uebernimmt
die in GROK_BOT_HOOKS markierten Stufen (GBH-01..10); die Risiko-Kante bleibt hier.

Kein numpy-Zwang: DFA/Regime-Nachbarn werden optional importiert, der Takt laeuft auch
ohne ML-Toolchain. Detail: docs/ORCHESTRATOR-ALPHA-SIGMA.md
"""

from app.orchestrator.alpha_sigma_engine import (
    AlphaSigmaOrchestrator,
    AlphaVote,
    GROK_BOT_HOOKS,
    OrchestratorConfig,
    Regime,
    RejectReason,
    Verdict,
    alpha_sigma_orchestrator,
    hook_worklist,
    set_hook_state,
    sigma_indicators,
    sigma_parity_report,
)

__all__ = [
    "AlphaSigmaOrchestrator",
    "AlphaVote",
    "GROK_BOT_HOOKS",
    "OrchestratorConfig",
    "Regime",
    "RejectReason",
    "Verdict",
    "alpha_sigma_orchestrator",
    "hook_worklist",
    "set_hook_state",
    "sigma_indicators",
    "sigma_parity_report",
]
