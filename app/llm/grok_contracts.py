"""
Grok Agent Contracts & Look-Ahead Bias Guard (Modul 18b: 18_GROK_AGENT_CONTRACTS).

Ergaenzt die TypeScript-Engine (server/grokEngine.ts) um die harte,
providerunabhaengige Python-Seite der Ausfuehrungsdisziplin:

  * TradeSignal-Contract      — rigider Datenvertrag inkl. Geschaeftslogik-
                                 Guardrails (Allokations-, Risiko-, Enum- und
                                 Laengenprüfung). identische Regeln wie in der
                                 TS-Engine, damit der Broker-Pfad gegen eine
                                 zweite, unabhaengige Implementierung prueft.
  * LookAheadGuard            — Knowledge-Cutoff-Pruefung pro Grok-Modell,
                                 Entitaets-Anonymisierung gegen den Distraction
                                 Effect und Alpha-Decay-Messung (In-Sample vs.
                                 Out-of-Sample) fuer die Promotions-Entscheidung.
  * GrokAgentGraph            — graphenartiger, NICHT konversationeller
                                 Multi-Agenten-Ablauf (Analysten -> Bull/Bear
                                 Debatte -> Risk Veto -> Trader) mit geteiltem
                                 State-Dictionary. Transport ist injiziert,
                                 dadurch offline testbar und gegen jedes
                                 xAI-Backend (Responses API / Pydantic AI)
                                 betreibbar.

Reine Standardbibliothek — laeuft ohne numpy/polars/pydantic, damit der
Warm-Path des Backtesters nie an fehlenden ML-Abhaengigkeiten scheitert.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime, date, timezone
from enum import Enum
import hashlib
import json
import math
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.core.directives import ExecutionPath, system_directive


# ---------------------------------------------------------------------------
# 1. MODELL-ÖKONOMIE & KNOWLEDGE CUTOFFS (gespiegelt aus server/grokEngine.ts)
# ---------------------------------------------------------------------------

GROK_MODEL_PROFILE: Dict[str, Dict[str, Any]] = {
    "grok-4.6": {"input": 2.00, "cached_input": 0.50, "output": 6.00, "context": 500_000,
                 "cutoff": "2026-02-01", "rps": 150, "tpm": 50_000_000, "batch": False},
    "grok-4.5": {"input": 2.00, "cached_input": 0.30, "output": 6.00, "context": 500_000,
                 "cutoff": "2025-09-01", "rps": 150, "tpm": 50_000_000, "batch": True},
    "grok-4.3": {"input": 1.25, "cached_input": 0.20, "output": 2.50, "context": 1_000_000,
                "cutoff": "2025-07-01", "rps": 37, "tpm": 10_000_000, "batch": True},
    "grok-4.20-0309-reasoning": {"input": 1.25, "cached_input": 0.20, "output": 2.50, "context": 1_000_000,
                                 "cutoff": "2025-03-01", "rps": 37, "tpm": 10_000_000, "batch": True},
    "grok-4.20-0309-non-reasoning": {"input": 1.25, "cached_input": 0.20, "output": 2.50, "context": 1_000_000,
                                     "cutoff": "2025-03-01", "rps": 37, "tpm": 10_000_000, "batch": True},
    "grok-4.20-multi-agent-0309": {"input": 1.25, "cached_input": 0.20, "output": 2.50, "context": 1_000_000,
                                   "cutoff": "2025-03-01", "rps": 9, "tpm": 2_500_000, "batch": True},
    "grok-build-0.1": {"input": 1.00, "cached_input": 0.20, "output": 2.00, "context": 256_000,
                       "cutoff": "2025-06-01", "rps": 37, "tpm": 10_000_000, "batch": True},
}

LONG_CONTEXT_THRESHOLD_TOKENS = 200_000   # ab hier verdoppelt xAI den Preis fuer ALLE Token
LONG_CONTEXT_MULTIPLIER = 2.0

# Toolkosten (USD pro 1000 Aufrufe) — deckelbar ueber GrokBudget.
TOOL_COST_PER_1K = {"x_search": 5.00, "code_interpreter": 5.00, "web_search": 5.00}


class Action(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class ViolationSeverity(str, Enum):
    HARD = "HARD"      # Signal wird verworfen / loest Repair-Loop aus
    SOFT = "SOFT"      # deterministisch geclampt und protokolliert


@dataclass
class TradeSignal:
    """Rigider Ausgabevertrag des Trader-Agenten (Pydantic-AI-Analogon)."""

    ticker: str
    action: Action
    allocation_percentage: float
    confidence_score: float
    rationale: str
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    time_horizon_bars: Optional[int] = None
    invalidation: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["action"] = self.action.value
        return d


@dataclass
class GuardrailReport:
    ok: bool
    hard_violations: List[str] = field(default_factory=list)
    soft_fixes: List[str] = field(default_factory=list)
    severity: Dict[str, str] = field(default_factory=dict)
    repaired: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "hard_violations": self.hard_violations,
            "soft_fixes": self.soft_fixes,
            "severity": self.severity,
            "repaired": self.repaired,
        }


@dataclass
class SignalContract:
    """Harte Grenzen des Orderpfads — konfiguriert, nicht geraten."""

    max_allocation_pct: float = 0.25
    max_risk_per_trade_pct: float = 0.02
    min_confidence: float = 0.55
    rationale_max_chars: int = 500
    allowed_tickers: Tuple[str, ...] = ()
    max_ticker_exposure_pct: float = 0.35

    def validate(self, payload: Dict[str, Any], equity_usd: float = 0.0,
                 current_exposure: Optional[Dict[str, float]] = None) -> Tuple[Optional[TradeSignal], GuardrailReport]:
        """
        Validiert ein LLM-JSON gegen den Vertrag. Gibt (signal, report) zurueck;
        signal ist None, sobald eine HARTE Verletzung vorliegt.
        """
        report = GuardrailReport(ok=True)
        raw = dict(payload or {})

        # --- ticker: Uppercase,Whitelist -----------------------------------
        ticker = str(raw.get("ticker") or raw.get("symbol") or "").upper()
        ticker = re.sub(r"[^A-Z0-9/.\-]", "", ticker)
        if not ticker:
            report.hard_violations.append("ticker fehlt oder leer")
            report.severity["ticker"] = ViolationSeverity.HARD.value
        elif self.allowed_tickers:
            base = ticker.split("/")[0]
            allowed = {t.upper().split("/")[0] for t in self.allowed_tickers}
            if base not in allowed:
                report.hard_violations.append(f"ticker '{ticker}' nicht in der Symbol-Freigabeliste")
                report.severity["ticker"] = ViolationSeverity.HARD.value
        raw["ticker"] = ticker

        # --- action: Enum mit kontrollierter Normalisierung -----------------
        action_raw = str(raw.get("action", "")).upper()
        if action_raw in {a.value for a in Action}:
            action = Action(action_raw)
        # Desk-Operator:innen prompten auf Deutsch — Synonyme werden normalisiert
        # statt das Signal am Vokabular scheitern zu lassen.
        elif action_raw and re.search(r"SELL|SHORT|REDUCE|EXIT|VERKAUF|LEER", action_raw):
            action = Action.SELL
            report.soft_fixes.append(f"action '{action_raw}' normalisiert auf SELL")
            report.severity["action"] = ViolationSeverity.SOFT.value
        elif action_raw and re.search(r"BUY|LONG|ADD|KAUF", action_raw):
            action = Action.BUY
            report.soft_fixes.append(f"action '{action_raw}' normalisiert auf BUY")
            report.severity["action"] = ViolationSeverity.SOFT.value
        else:
            action = Action.HOLD
            report.hard_violations.append(f"action '{action_raw}' ausserhalb des Enums [BUY, SELL, HOLD]")
            report.severity["action"] = ViolationSeverity.HARD.value
        if action is Action.HOLD:
            raw["allocation_percentage"] = 0.0

        # --- allocation: [0,1] + Desk-Cap -----------------------------------
        try:
            alloc = float(raw.get("allocation_percentage", 0.0))
        except (TypeError, ValueError):
            alloc = float("nan")
        if not math.isfinite(alloc):
            report.hard_violations.append("allocation_percentage ist keine Zahl")
            report.severity["allocation_percentage"] = ViolationSeverity.HARD.value
            alloc = 0.0
        if alloc < 0:
            alloc = 0.0
            report.soft_fixes.append("allocation_percentage < 0 auf 0.0 geclampt")
        if alloc > 1.0:
            report.hard_violations.append(f"allocation_percentage {alloc:.3f} > 1.0 (mehr als 100% des Portfolios)")
            report.severity["allocation_percentage"] = ViolationSeverity.HARD.value
        if alloc > self.max_allocation_pct:
            report.soft_fixes.append(
                f"allocation_percentage {alloc:.3f} auf Positionsmax {self.max_allocation_pct:.3f} geclampt"
            )
            alloc = self.max_allocation_pct
        raw["allocation_percentage"] = round(alloc, 6)

        # --- confidence -----------------------------------------------------
        try:
            conf = float(raw.get("confidence_score", 0.0))
        except (TypeError, ValueError):
            conf = 0.0
        if not math.isfinite(conf):
            conf = 0.0
        if conf < 0 or conf > 1:
            report.soft_fixes.append(f"confidence_score {conf:.3f} auf [0,1] geclampt")
            conf = min(1.0, max(0.0, conf))
        raw["confidence_score"] = round(conf, 6)
        if action is not Action.HOLD and conf < self.min_confidence:
            report.hard_violations.append(
                f"confidence_score {conf:.3f} unter Schwelle {self.min_confidence:.2f} — kein Orderpfad"
            )
            report.severity["confidence_score"] = ViolationSeverity.HARD.value

        # --- rationale: Laengenvertrag --------------------------------------
        rationale = re.sub(r"\s+", " ", str(raw.get("rationale") or "")).strip()
        if len(rationale) > self.rationale_max_chars:
            rationale = rationale[: self.rationale_max_chars - 3] + "..."
            report.soft_fixes.append(f"rationale auf {self.rationale_max_chars} Zeichen gekuerzt")
        if not rationale:
            report.hard_violations.append("rationale fehlt — jedes Signal braucht eine Begruendung")
            report.severity["rationale"] = ViolationSeverity.HARD.value
        raw["rationale"] = rationale

        # --- Risiko-Geometrie ----------------------------------------------
        stop = raw.get("stop_loss_pct")
        if stop is not None:
            try:
                stop = float(stop)
            except (TypeError, ValueError):
                stop = None
        if stop is not None and (not math.isfinite(stop) or stop <= 0):
            report.hard_violations.append("stop_loss_pct muss eine positive Zahl sein")
            report.severity["stop_loss_pct"] = ViolationSeverity.HARD.value
            stop = None
        if action is not Action.HOLD and stop is None and alloc > 0.4 * self.max_allocation_pct:
            report.hard_violations.append("bei Allokation > 40% des Positionsmax ist stop_loss_pct Pflicht")
            report.severity["stop_loss_pct"] = ViolationSeverity.HARD.value
        raw["stop_loss_pct"] = round(stop, 4) if stop else None

        tp = raw.get("take_profit_pct")
        if tp is not None:
            try:
                tp = float(tp)
            except (TypeError, ValueError):
                tp = None
            if tp is None or not math.isfinite(tp) or tp <= 0:
                report.soft_fixes.append("take_profit_pct verworfen (nicht positiv)")
                tp = None
        raw["take_profit_pct"] = round(tp, 4) if tp else None

        if equity_usd and equity_usd > 0 and action is not Action.HOLD:
            notional = equity_usd * raw["allocation_percentage"]
            risk_pct = (notional * (stop or 0.0) / 100.0) / equity_usd if stop else 0.0
            if risk_pct > self.max_risk_per_trade_pct:
                allowed = self.max_risk_per_trade_pct * equity_usd / max(1e-9, (equity_usd * (stop / 100.0)))
                allowed = min(self.max_allocation_pct, max(0.0, allowed))
                report.soft_fixes.append(
                    f"Positionsrisiko {risk_pct * 100:.2f}% > Max {self.max_risk_per_trade_pct * 100:.2f}% — "
                    f"Allokation auf {allowed:.4f} reduziert"
                )
                raw["allocation_percentage"] = round(allowed, 6)

        # --- Ticker-Konzentration ------------------------------------------
        if current_exposure and action is Action.BUY:
            held = float(current_exposure.get(ticker.split("/")[0], 0.0) or 0.0)
            total = held + raw["allocation_percentage"]
            if total > self.max_ticker_exposure_pct:
                reduced = max(0.0, self.max_ticker_exposure_pct - held)
                report.soft_fixes.append(
                    f"Ticker-Exposure {total * 100:.1f}% > Cap {self.max_ticker_exposure_pct * 100:.1f}% — "
                    f"Allokation auf {reduced:.4f} reduziert"
                )
                raw["allocation_percentage"] = round(reduced, 6)

        report.ok = not report.hard_violations
        if not report.ok:
            return None, report

        signal = TradeSignal(
            ticker=raw["ticker"],
            action=action,
            allocation_percentage=raw["allocation_percentage"],
            confidence_score=raw["confidence_score"],
            rationale=raw["rationale"],
            stop_loss_pct=raw["stop_loss_pct"],
            take_profit_pct=raw["take_profit_pct"],
            time_horizon_bars=_as_int(raw.get("time_horizon_bars")),
            invalidation=(str(raw["invalidation"])[:300] if raw.get("invalidation") else None),
        )
        report.repaired = signal.to_dict()
        return signal, report


def _as_int(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# 2. PRE-LLM GUARDRAILS (Prompt-Injection + PII) — spiegelt die TS-Engine
# ---------------------------------------------------------------------------

INJECTION_PATTERNS: Tuple[Tuple[str, re.Pattern], ...] = (
    ("override_instructions", re.compile(r"ignore\s+(all\s+|any\s+)?(previous|prior|above)\s+instructions", re.I)),
    ("disregard_system", re.compile(r"disregard\s+(the\s+)?(system|safety|previous)\s*(prompt|rules|instructions)", re.I)),
    ("role_reassignment", re.compile(r"you\s+are\s+now\s+(a|an)\s+", re.I)),
    ("system_prompt_spoof", re.compile(r"new\s+system\s+prompt", re.I)),
    ("delimiter_smuggling", re.compile(r"<\s*/?\s*(system|assistant|instructions)\s*>", re.I)),
    ("code_injection", re.compile(r"\b(run|execute)\s+(this|the\s+following)\s+(code|command|shell)", re.I)),
    ("prompt_extraction", re.compile(r"(reveal|print|repeat)\s+(your|the)\s+(system\s+)?prompt", re.I)),
    ("order_bait", re.compile(r"AUTO\s*(BUY|SELL|TRADE|LEVERAGE)", re.I)),
)

PII_PATTERNS: Tuple[re.Pattern, ...] = (
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.]{2,}"),
    re.compile(r"\b(?:\+?\d[\d\s().-]{7,16}\d)\b"),
    re.compile(r"\b(?:\d{4}[- ]?){3}\d{4}\b"),
    re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b"),
)


def scrub_untrusted_text(text: str, max_chars: int = 12_000) -> Dict[str, Any]:
    """Neutralisiert Anweisungen und PII in fremden Texten VOR dem API-Call."""
    flags: List[str] = []
    out = str(text or "")
    for label, pattern in INJECTION_PATTERNS:
        if pattern.search(out):
            flags.append(label)
            out = pattern.sub("[REDACTED_INSTRUCTION]", out)
    for pattern in PII_PATTERNS:
        if pattern.search(out):
            if "pii" not in flags:
                flags.append("pii")
            out = pattern.sub("[REDACTED_PII]", out)
    out = re.sub(r"[\u0000-\u0008\u000B\u000C\u000E-\u001F]", " ", out)
    truncated = len(out) > max_chars
    if truncated:
        out = out[:max_chars] + " …[getruncated]"
    return {"text": out.strip(), "flags": flags, "truncated": truncated}


# ---------------------------------------------------------------------------
# 3. LOOK-AHEAD-BIAS GUARD (parametrisch + Distraction Effect + Alpha Decay)
# ---------------------------------------------------------------------------

ENTITY_ALIAS: Dict[str, Tuple[str, ...]] = {
    "BTC": ("bitcoin",), "ETH": ("ethereum", "ether"), "SOL": ("solana",),
    "XRP": ("ripple",), "DOGE": ("dogecoin",), "AVAX": ("avalanche",),
    "LINK": ("chainlink",), "DOT": ("polkadot",), "ADA": ("cardano",),
    "NEAR": ("near protocol",), "SUI": ("sui network",), "PEPE": ("pepe",),
    "AAPL": ("apple", "cupertino"), "MSFT": ("microsoft", "redmond"),
    "GOOGL": ("alphabet", "google"), "AMZN": ("amazon",),
    "NVDA": ("nvidia", "jensen huang"), "TSLA": ("tesla",),
    "META": ("meta platforms", "facebook"), "AMD": ("advanced micro devices",),
}

_SYMBOL_TOKEN = re.compile(r"\b([A-Z0-9]{2,6})/(?:USD|USDT|EUR|BTC)\b")
_BARE_TOKEN = re.compile(r"\b(?:\$|#)?(" + "|".join(sorted(ENTITY_ALIAS.keys())) + r")\b")


@dataclass
class LookAheadAssessment:
    model: str
    knowledge_cutoff: str
    window_start: str
    window_end: str
    contaminated_pct: float
    risk_level: str
    anonymization_required: bool
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class LookAheadBiasGuard:
    """
    Prueft, ob ein Backtestfenster ueberhaupt unverbraucht bewertbar ist.
    Fenster vor dem Knowledge-Cutoff des Modells sind kontaminiert: das Modell
    rezitiert den bekannten Verlauf (Training-Data-Leakage) statt zu schliessen.
    """

    def __init__(self, model: str = "grok-4.6", enforce_cutoff: bool = True):
        self.model = model if model in GROK_MODEL_PROFILE else "grok-4.6"
        self.enforce_cutoff = enforce_cutoff

    @property
    def cutoff(self) -> date:
        return date.fromisoformat(GROK_MODEL_PROFILE[self.model]["cutoff"])

    def assess(self, window_start: str, window_end: str) -> LookAheadAssessment:
        notes: List[str] = []
        start = _parse_date(window_start)
        end = _parse_date(window_end)
        if start is None or end is None:
            notes.append("Backtest-Fenster unvollstaendig/ungueltig — Cutoff-Pruefung nicht moeglich.")
            return LookAheadAssessment(self.model, self.cutoff.isoformat(), str(window_start), str(window_end),
                                       100.0, "unknown", True, notes)
        if end < start:
            notes.append("window_end vor window_start — Eingabefehler.")
            return LookAheadAssessment(self.model, self.cutoff.isoformat(), window_start, window_end,
                                       100.0, "invalid", True, notes)

        span_days = max(1, (end - start).days)
        overlap_days = max(0, (min(end, self.cutoff) - start).days)
        contaminated_pct = (overlap_days / span_days) * 100.0

        if contaminated_pct >= 80:
            risk, note = "critical", ("Fenster vollstaendig im Trainingszeitraum: Kennzahlen sind In-Sample-Artefakte. "
                                     "Nur mit anonymisierten Entitaeten und Point-in-Time-Baseline bewerten.")
        elif contaminated_pct >= 25:
            risk, note = "high", ("Mehrheit des Fensters im Trainingszeitraum: Alpha-Zerfall im Live-Betrieb wahrscheinlich; "
                                  "Out-of-Sample-Fenster nach dem Cutoff nachziehen.")
        elif contaminated_pct > 0:
            risk, note = "low", "Teilweise Kontamination — Kennzahlen mit Vorsicht interpretieren."
        else:
            risk, note = "none", f"Fenster liegt vollstaendig nach dem Knowledge-Cutoff ({self.cutoff.isoformat()}) — echter OOS-Charakter."
        notes.append(note)

        return LookAheadAssessment(
            model=self.model, knowledge_cutoff=self.cutoff.isoformat(),
            window_start=start.isoformat(), window_end=end.isoformat(),
            contaminated_pct=round(contaminated_pct, 2),
            risk_level=risk,
            anonymization_required=risk in {"high", "critical", "unknown", "invalid"} or contaminated_pct > 0,
            notes=notes,
        )

    def gate(self, window_start: str, window_end: str) -> Dict[str, Any]:
        """Hartes Gate fuer die Promotions-Pipeline (Circuit-Breaker-wuerdig)."""
        assessment = self.assess(window_start, window_end)
        blocked = self.enforce_cutoff and assessment.risk_level in {"critical"}
        return {
            "allowed": not blocked,
            "assessment": assessment.to_dict(),
            "reason": "In-Sample-Bewertung blockiert: parametrischer Look-Ahead Bias nicht kontrollierbar." if blocked else None,
        }

    @staticmethod
    def anonymize(text: str) -> Dict[str, Any]:
        """Deterministische Entitaets-Anonymisierung (Distraction Effect)."""
        tokens = set(m.group(1) for m in _SYMBOL_TOKEN.finditer(text.upper()))
        tokens |= set(m.group(1) for m in _BARE_TOKEN.finditer(text.upper()))
        for tok, aliases in ENTITY_ALIAS.items():
            if any(re.search(rf"\b{a}\b", text, re.I) for a in aliases):
                tokens.add(tok)
        ordered = sorted(t for t in tokens if t)
        mapping: Dict[str, str] = {}
        out = text
        for idx, tok in enumerate(ordered):
            label = f"ENTITY_{chr(65 + idx % 26)}{idx // 26 if idx >= 26 else ''}"
            mapping[tok] = label
            out = re.sub(rf"\$?\b{tok}\b/[A-Z]{{2,5}}\b", f"{label}_VS_QUOTE", out)
            out = re.sub(rf"\$?\b{tok}\b", label, out, flags=re.I)
            for alias in ENTITY_ALIAS.get(tok, ()):
                out = re.sub(rf"\b{alias}\b", label, out, flags=re.I)
        return {"text": out, "mapping": mapping, "hits": len(ordered),
                "fingerprint": hashlib.sha256(out.encode("utf-8")).hexdigest()[:12]}

    @staticmethod
    def alpha_decay(in_sample: Dict[str, float], out_of_sample: Dict[str, float],
                    metrics: Tuple[str, ...] = ("sharpe_ratio", "total_return_pct")) -> Dict[str, Any]:
        """
        Misst den Rueckgang zwischen In-Sample- und Out-of-Sample-Kennzahl in
        Prozentpunkten. Werte jenseits von ~15pp (Sharpe) gelten als Signal dafuer,
        dass die Strategie im Kern nicht reproduzierbar ist.
        """
        deltas: Dict[str, Dict[str, float]] = {}
        worst = 0.0
        for metric in metrics:
            ins = float(in_sample.get(metric, 0.0) or 0.0)
            oos = float(out_of_sample.get(metric, 0.0) or 0.0)
            delta = oos - ins
            rel = (delta / abs(ins) * 100.0) if ins else 0.0
            deltas[metric] = {"in_sample": round(ins, 4), "out_of_sample": round(oos, 4),
                              "delta": round(delta, 4), "delta_pct": round(rel, 2)}
            worst = min(worst, delta if metric == "sharpe_ratio" else -abs(delta))
        decay_pp = -deltas.get("sharpe_ratio", {}).get("delta", 0.0)
        verdict = "collapse" if decay_pp >= 4 else "material_decay" if decay_pp >= 1.5 else "stable"
        return {
            "metrics": deltas,
            "sharpe_decay_pp": round(decay_pp, 3),
            "worst_delta": round(worst, 3),
            "verdict": verdict,
            "recommendation": (
                "Strategie nicht auf Live-Kapital heben: Alpha ist reproduzierbar größtenteils Modell-Erinnerung."
                if verdict == "collapse" else
                "Kleinere Abweichung — Out-of-Sample-Fenster verlaengern und erneut pruefen."
                if verdict == "material_decay" else
                "Stabil ueber die Stichproben — Promotion moeglich, Guard bleibt aktiv."
            ),
        }


def _parse_date(value: Any) -> Optional[date]:
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    if not value:
        return None
    text = str(value)[:10]
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# 4. KOSTENMODELL & BUDGET (Prompt-Cache-Rabatt, Long-Context, Tool-Fees)
# ---------------------------------------------------------------------------

@dataclass
class GrokBudget:
    monthly_cap_usd: float = 250.0
    spent_usd: float = 0.0
    max_tool_turns: int = 5
    x_search_calls_left: int = 400
    code_exec_calls_left: int = 200

    def headroom(self) -> float:
        return max(0.0, self.monthly_cap_usd - self.spent_usd)

    def exhausted(self) -> bool:
        return self.headroom() <= 0.0


def estimate_request_cost(model: str, prompt_tokens: int, completion_tokens: int,
                           cached_prompt_tokens: int = 0, tool_calls: Optional[Dict[str, int]] = None) -> Dict[str, float]:
    """
    Deterministische Kostenvorhersage inkl. zweier Hebel, die in der Praxis
    am staerksten ins Gewicht fallen: Cache-Rabatt und Long-Context-Preissprung.
    """
    profile = GROK_MODEL_PROFILE.get(model) or GROK_MODEL_PROFILE["grok-4.5"]
    long_context = prompt_tokens >= LONG_CONTEXT_THRESHOLD_TOKENS
    mult = LONG_CONTEXT_MULTIPLIER if long_context else 1.0
    cached = min(max(0, cached_prompt_tokens), prompt_tokens)
    fresh = prompt_tokens - cached
    input_cost = fresh * profile["input"] * mult / 1e6
    cached_cost = cached * profile["cached_input"] * mult / 1e6
    output_cost = completion_tokens * profile["output"] * mult / 1e6
    tool_cost = 0.0
    for tool, count in (tool_calls or {}).items():
        tool_cost += TOOL_COST_PER_1K.get(tool, 0.0) * count / 1000.0
    total = input_cost + cached_cost + output_cost + tool_cost
    uncached_total = prompt_tokens * profile["input"] * mult / 1e6 + output_cost + tool_cost
    return {
        "input_cost": round(input_cost, 6),
        "cached_input_cost": round(cached_cost, 6),
        "output_cost": round(output_cost, 6),
        "tool_cost": round(tool_cost, 6),
        "total_cost": round(total, 6),
        "cache_saving": round(max(0.0, uncached_total - total), 6),
        "long_context_priced": 1.0 if long_context else 0.0,
    }


# ---------------------------------------------------------------------------
# 5. MULTI-AGENTEN-GRAPH (strukturierter State, kein Chat-Verlauf)
# ---------------------------------------------------------------------------

@dataclass
class AgentNodeResult:
    node: str
    ok: bool
    payload: Dict[str, Any] = field(default_factory=dict)
    model: str = ""
    cost_usd: float = 0.0
    cache_hit: bool = False
    attempts: int = 1
    error: Optional[str] = None


class GrokAgentGraph:
    """
    Graphbasierte Orchestrierung der sieben Rollen. Kommunikation erfolgt
    ausschliesslich ueber das geteilte State-Dictionary (keine Dialoghistorie),
    dadurch kein Context Bloat und revisionssichere Uebergaben.

    `llm_call(node, system_prompt, user_prompt, schema)` ist injiziert und muss
    ein dict zurueckgeben. Damit ist der Graph deterministisch testbar, ohne
    einen API-Schluessel zu benoetigen.
    """

    NODES: Tuple[str, ...] = ("fundamentals", "sentiment", "news", "technical",
                             "bull", "bear", "risk", "trader")

    def __init__(self, llm_call: Callable[[str, str, str, Optional[Dict[str, Any]]], Dict[str, Any]],
                 contract: Optional[SignalContract] = None,
                 budget: Optional[GrokBudget] = None,
                 model_for_node: Optional[Dict[str, str]] = None,
                 anonymize_evidence: bool = False):
        self.llm_call = llm_call
        self.contract = contract or SignalContract()
        self.budget = budget or GrokBudget()
        self.model_for_node = model_for_node or {}
        self.anonymize_evidence = anonymize_evidence

    # -- oeffentliche Einstiege ---------------------------------------------------
    def run(self, symbol: str, evidence: Dict[str, str], equity_usd: float = 0.0,
            current_exposure: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        system_directive.record_path_execution(ExecutionPath.COLD_PATH)
        state: Dict[str, Any] = {
            "symbol": symbol.upper(), "evidence": {}, "theses": {}, "risk": {},
            "signal": None, "trace": [], "halted": False, "total_cost_usd": 0.0,
        }

        prepared = self._prepare_evidence(evidence)
        state["evidence"] = prepared

        for node in ("fundamentals", "sentiment", "news", "technical"):
            if self.budget.exhausted():
                state["halted"] = True
                state["trace"].append(AgentNodeResult(node, False, error="budget_exhausted"))
                break
            res = self._call_node(node, prepared, symbol=state["symbol"])
            state["trace"].append(res)
            state["total_cost_usd"] += res.cost_usd
            state["evidence"][node] = res.payload if res.ok else {"error": res.error}

        if not state["halted"]:
            self._run_debate(state, prepared)
            if not state["halted"]:
                self._run_risk_gate(state)
                if not state["halted"]:
                    self._run_trader(state, equity_usd, current_exposure)

        return {
            "symbol": state["symbol"],
            "signal": state["signal"],
            "risk": state["risk"],
            "theses": state["theses"],
            "halted": state["halted"],
            "total_cost_usd": round(state["total_cost_usd"], 6),
            "trace": [asdict(t) for t in state["trace"]],
            "anonymized": bool(prepared.get("__anonymized__")),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    # -- interne Schritte -----------------------------------------------------
    def _prepare_evidence(self, evidence: Dict[str, str]) -> Dict[str, Any]:
        prepared: Dict[str, Any] = {}
        for key, raw in (evidence or {}).items():
            scrubbed = scrub_untrusted_text(str(raw))
            prepared[key] = {"text": scrubbed["text"], "flags": scrubbed["flags"]}
        if self.anonymize_evidence:
            joined = "\n".join(v["text"] for v in prepared.values())
            anon = LookAheadBiasGuard.anonymize(joined)
            prepared["__anonymized_text__"] = anon["text"]
            prepared["__mapping__"] = anon["mapping"]
            prepared["__anonymized__"] = True
        else:
            prepared["__anonymized__"] = False
        return prepared

    def _call_node(self, node: str, prepared: Dict[str, Any], extra: str = "",
                   symbol: str = "") -> AgentNodeResult:
        model = self.model_for_node.get(node, "grok-4.20-0309-non-reasoning")
        corpus = self._render_evidence(prepared)
        prompt = f"Analysiere die Rolle '{node}' fuer {symbol or 'das Ziel-Symbol'}.\nKontext:\n{corpus}\n{extra}"
        try:
            payload = self.llm_call(node, f"node:{node}", prompt, None) or {}
            cost = estimate_request_cost(model, estimate_tokens(corpus + prompt), estimate_tokens(json.dumps(payload)))
            self.budget.spent_usd += cost["total_cost"]
            return AgentNodeResult(node=node, ok=True, payload=payload if isinstance(payload, dict) else {"value": payload},
                                   model=model, cost_usd=cost["total_cost"], cache_hit=bool(payload.get("__cache_hit__")))
        except Exception as exc:  # ein Knoten darf den Graph nie reparabel abschiessen
            return AgentNodeResult(node=node, ok=False, model=model, error=str(exc)[:240])

    def _run_debate(self, state: Dict[str, Any], prepared: Dict[str, Any]) -> None:
        bull = self._call_node("bull", prepared, symbol=state["symbol"], extra="Baue die Long-These mit falsifizierbaren Aussagen.")
        bear = self._call_node("bear", prepared, symbol=state["symbol"], extra="Greife die Long-These an (Red Team).")
        state["trace"].extend([bull, bear])
        state["total_cost_usd"] += bull.cost_usd + bear.cost_usd
        state["theses"] = {"bull": bull.payload if bull.ok else {"error": bull.error},
                           "bear": bear.payload if bear.ok else {"error": bear.error}}
        # Konsensregel: beide Thesen widerlegt -> HOLD ohne teuren Trader-Call.
        if not bull.ok and not bear.ok:
            state["halted"] = True

    def _run_risk_gate(self, state: Dict[str, Any]) -> None:
        risk = self._call_node("risk", state["evidence"], symbol=state["symbol"], extra="Setze veto und max_allocation_pct.")
        state["trace"].append(risk)
        state["total_cost_usd"] += risk.cost_usd
        payload = risk.payload if risk.ok else {"veto": True, "reason": f"risk node failed: {risk.error}"}
        state["risk"] = payload
        if payload.get("veto"):
            state["halted"] = True
            state["signal"] = TradeSignal(
                ticker=state["symbol"].split("/")[0], action=Action.HOLD, allocation_percentage=0.0,
                confidence_score=0.5, rationale=f"Risiko-VETO: {str(payload.get('reason'))[:420]}"[: self.contract.rationale_max_chars],
            ).to_dict()

    def _run_trader(self, state: Dict[str, Any], equity_usd: float, current_exposure: Optional[Dict[str, float]]) -> None:
        res = self._call_node("trader", state["evidence"], symbol=state["symbol"], extra="Liefere das finale Handelssignal gemäss Vertrag.")
        state["trace"].append(res)
        state["total_cost_usd"] += res.cost_usd
        if not res.ok:
            state["signal"] = None
            return
        signal, report = self.contract.validate(res.payload, equity_usd=equity_usd, current_exposure=current_exposure)
        state["guardrails"] = report.to_dict()
        state["signal"] = signal.to_dict() if signal else None
        if not report.ok:
            state["repair_needed"] = report.hard_violations

    @staticmethod
    def _render_evidence(prepared: Dict[str, Any]) -> str:
        if prepared.get("__anonymized_text__"):
            return prepared["__anonymized_text__"]
        return "\n".join(f"[{k}]\n{v['text']}" for k, v in prepared.items() if isinstance(v, dict) and "text" in v)


def estimate_tokens(text: str) -> int:
    return max(1, math.ceil(len(text or "") / 4))


# ---------------------------------------------------------------------------
# 6. FASSADE fuer die TypeScript-Bridge (JSON in / JSON out)
# ---------------------------------------------------------------------------

class GrokEngineFacade:
    """Duenner, stabiler Eingang fuer `server/quantitativeEngine.ts`."""

    @staticmethod
    def validate_signal(payload: Dict[str, Any], contract_opts: Optional[Dict[str, Any]] = None,
                        equity_usd: float = 0.0, current_exposure: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        contract = SignalContract(
            max_allocation_pct=float((contract_opts or {}).get("max_allocation_pct", 0.25)),
            max_risk_per_trade_pct=float((contract_opts or {}).get("max_risk_per_trade_pct", 0.02)),
            min_confidence=float((contract_opts or {}).get("min_confidence", 0.55)),
            allowed_tickers=tuple((contract_opts or {}).get("allowed_tickers") or ()),
            max_ticker_exposure_pct=float((contract_opts or {}).get("max_ticker_exposure_pct", 0.35)),
        )
        signal, report = contract.validate(payload, equity_usd=equity_usd, current_exposure=current_exposure)
        return {"signal": signal.to_dict() if signal else None, **report.to_dict()}

    @staticmethod
    def bias_audit(window_start: str, window_end: str, model: str = "grok-4.6",
                   sample_text: str = "", in_sample: Optional[Dict[str, float]] = None,
                   out_of_sample: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        guard = LookAheadBiasGuard(model=model)
        gate = guard.gate(window_start, window_end)
        result: Dict[str, Any] = {"gate": gate, "assessment": gate["assessment"]}
        if sample_text:
            result["anonymization"] = guard.anonymize(sample_text)
        if in_sample and out_of_sample:
            result["alpha_decay"] = guard.alpha_decay(in_sample, out_of_sample)
        return result

    @staticmethod
    def cost_probe(model: str, prompt_tokens: int, completion_tokens: int,
                   cached_prompt_tokens: int = 0, x_search_calls: int = 0, code_calls: int = 0) -> Dict[str, Any]:
        cost = estimate_request_cost(model, prompt_tokens, completion_tokens, cached_prompt_tokens,
                                      {"x_search": x_search_calls, "code_interpreter": code_calls})
        profile = GROK_MODEL_PROFILE.get(model, {})
        return {
            "model": model,
            "cost": cost,
            "long_context_priced": bool(cost["long_context_priced"]),
            "knowledge_cutoff": profile.get("cutoff"),
            "batch_api_supported": profile.get("batch", False),
            "note": ("Preissprung aktiv: Prompt >= 200k Token verdoppelt den Preis aller Token."
                     if cost["long_context_priced"] else "Preisband < 200k Prompt-Token."),
        }


grok_engine_facade = GrokEngineFacade()
