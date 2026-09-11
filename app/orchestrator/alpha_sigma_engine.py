"""
ORCHESTRATOR ENGINE — ALPHA/SIGMA-ZWEIKAMMERSYSTEM (Modul 19: 19_ORCHESTRATOR_ALPHA_SIGMA).

Grundprinzip dieser Engine (bewusst asynchron zur LLM-Schicht):

    ALPHA  = Antragskammer.  Erzeugt gerichtete, gewichtete Edge-Vorschlaege
             (Grok-Agenten-Votes, Momentum-/Mean-Reversion-Signale der Sigma-
             Strategien, Ampel-Struktur, RL-Fast-Path). Alles hier DARF nur
             beantragen. Alpha hat kein Exec-Recht.

    SIGMA  = Bewilligungskammer.  Schaetzt Volatilitaetszustand, Regime und
             Bandbreite (EWMA/GARCH-z, z-Score-Baender, ATR, Hurst/DFA) und
             skaliert/verweigert jede Anforderung hart: Zielvol-Skalierung,
             Drawdown-Daempfer, Exposure-/Leverage-Caps, Cooldown, Circuit
             Breaker, Regime-Kompatibilitaet der Quelle.

    ARBITRATION = Deterministische Klammer.  Alpha beantragt, Sigma verfuegt.
             Bei Konflikt gewinnt IMMER Sigma. Das Ergebnis ist ein
             OrderIntent mit Reason-Codes und Journal-Eintrag — identisch,
             gleich gueltig, ob ein Mensch, ein Heuristik-Fallback oder ein
             Grok-Agent den Antrag gestellt hat.

Warum so gebaut: ein LLM (Grok) darf die Risiko-Kante nicht verschieben.
Der Bot liefert Antraege und gewinnt/verliert an den Sigma-Gates. Dadurch
bleibt die Live-Kapitalrechnung frei von Modelllaunen, waehrend der Bot die
gesamte Signalseite (und die in GROK_BOT_HOOKS markierten Stufen) übernehmen kann.

Alle fuer den Grok-Bot vorgesehenen Uebernahmepunkte sind im Code mit
    # >>> GROK-BOT [GBH-xx] >>>
markiert und machine-readable in GROK_BOT_HOOKS exportiert (GET /api/orchestrator/hooks).
    # <<< GROK-BOT [GBH-xx] <<<

Standardbibliothek zuerst: numpy/scipy sind optional (DFA/M8 nur bei
Verfuegbarkeit), damit der Takt auch ohne ML-Toolchain laeuft.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
import json
import math
import os
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from app.core.directives import CircuitBreakerStatus, ExecutionPath, system_directive

# Optionale, schwere Nachbarn — der Orchestrator darf nie an ihnen scheitern.
try:  # pragma: no cover - umgebungsabhaengig
    from app.regime.dfa_engine import dfa_engine as _DFA_ENGINE  # type: ignore

    _HAVE_DFA = True
except Exception:  # pragma: no cover
    _DFA_ENGINE = None
    _HAVE_DFA = False


# ---------------------------------------------------------------------------
# 0. KONFIGURATION
# ---------------------------------------------------------------------------

@dataclass
class OrchestratorConfig:
    """Alle Grenzen sind hier, nicht im Prompt. Der Bot kann sie vorschlagen, nicht setzen."""

    # ALPHA
    alpha_half_life_bars: float = 12.0
    alpha_max_age_bars: int = 96
    alpha_min_agreement: float = 0.35          # Streuung der Quellen muss sich eindeutig richten
    alpha_min_score: float = 0.18              # Schwelle fuer einen Antrag
    alpha_source_weights: Dict[str, float] = field(default_factory=lambda: {
        "grok_trader": 1.00,
        "grok_debate_bull": 0.55,
        "grok_debate_bear": 0.55,
        "grok_sentiment": 0.45,
        "grok_news_triage": 0.25,
        "sigma_momentum": 0.75,
        "sigma_mean_reversion": 0.70,
        "ampel_structure": 0.40,
        "rl_fast_path": 0.35,
        "manifest_champion": 0.60,
    })
    alpha_weight_adaptation: bool = True
    alpha_ic_ewma_lambda: float = 0.90

    # SIGMA
    sigma_ewma_lambda: float = 0.94
    sigma_garch: Tuple[float, float, float] = (1e-6, 0.08, 0.90)   # (omega, alpha, beta)
    sigma_z_lookback: int = 20                 # == meanReversionLookback der Sigma-Runner
    sigma_atr_lookback: int = 14
    sigma_target_annual_vol: float = 0.20
    sigma_max_asset_annual_vol_gate: float = 2.20
    sigma_hard_stop_atr_mult: float = 2.2        # == stopAtr
    sigma_target_atr_mult: float = 2.2           # == targetAtr
    sigma_max_hold_bars: int = 12                # == maxHoldBars
    sigma_cooldown_bars: int = 1                 # == cooldownBars
    sigma_fast_ema: int = 20
    sigma_slow_ema: int = 50
    sigma_breakout_lookback: int = 20
    sigma_hurst_lookback: int = 100
    sigma_hurst_trend_gate: float = 0.55
    sigma_hurst_meanrev_gate: float = 0.45
    sigma_mos_lookback: int = 60
    sigma_mos_threshold: float = 7.5
    sigma_mos_only_strong: bool = True
    sigma_max_alloc_pct: float = 0.25
    sigma_max_risk_per_trade_pct: float = 0.02
    sigma_max_gross_exposure_pct: float = 0.60
    sigma_max_per_symbol_exposure_pct: float = 0.35
    sigma_max_leverage: float = 1.0
    sigma_dd_dampener_start_pct: float = 5.0
    sigma_dd_dampener_floor: float = 0.20
    sigma_min_ticket_usd: float = 25.0
    sigma_max_spread_bps: float = 18.0
    sigma_max_slippage_bps: float = 35.0
    sigma_min_hurst_for_momentum: float = 0.52
    sigma_max_hurst_for_meanrev: float = 0.48

    # Takt / Betrieb
    decision_ttl_bars: int = 3
    journal_file: str = "data/orchestrator/decisions.jsonl"
    hook_state_file: str = "data/orchestrator/hook_state.json"
    state_file: str = "data/orchestrator/ors_state.json"


DEFAULT_CONFIG = OrchestratorConfig()


def _env_overrides(cfg: OrchestratorConfig) -> OrchestratorConfig:
    """ORS_* ENV-Overrides — damit der Grok-Bot Grenzen kalibrieren kann, ohne Code zu ändern."""
    mapping = {
        "ORS_ALPHA_MIN_SCORE": "alpha_min_score",
        "ORS_ALPHA_MIN_AGREEMENT": "alpha_min_agreement",
        "ORS_ALPHA_HALF_LIFE": "alpha_half_life_bars",
        "ORS_SIGMA_TARGET_VOL": "sigma_target_annual_vol",
        "ORS_SIGMA_MAX_ALLOC_PCT": "sigma_max_alloc_pct",
        "ORS_SIGMA_MAX_RISK_PCT": "sigma_max_risk_per_trade_pct",
        "ORS_SIGMA_MAX_GROSS_EXPOSURE_PCT": "sigma_max_gross_exposure_pct",
        "ORS_SIGMA_MAX_LEVERAGE": "sigma_max_leverage",
        "ORS_SIGMA_EWMA_LAMBDA": "sigma_ewma_lambda",
        "ORS_SIGMA_HARD_STOP_ATR": "sigma_hard_stop_atr_mult",
        "ORS_SIGMA_TARGET_ATR": "sigma_target_atr_mult",
        "ORS_SIGMA_COOLDOWN_BARS": "sigma_cooldown_bars",
        "ORS_SIGMA_MOS_THRESHOLD": "sigma_mos_threshold",
        "ORS_SIGMA_HURST_TREND_GATE": "sigma_hurst_trend_gate",
        "ORS_SIGMA_HURST_MEANREV_GATE": "sigma_hurst_meanrev_gate",
    }
    for env_key, attr in mapping.items():
        raw = os.getenv(env_key)
        if raw in (None, ""):
            continue
        try:
            cur = getattr(cfg, attr)
            setattr(cfg, attr, type(cur)(float(raw)) if not isinstance(cur, int) else int(float(raw)))
        except (TypeError, ValueError):
            continue
    return cfg


# ---------------------------------------------------------------------------
# 1. Enums & Vertraege
# ---------------------------------------------------------------------------

class Regime(str, Enum):
    MEAN_REVERTING = "MEAN_REVERTING"
    BROWNIAN_CHOP = "BROWNIAN_CHOP"
    MOMENTUM_TREND = "MOMENTUM_TREND"
    SUPER_EXPONENTIAL = "SUPER_EXPONENTIAL"
    UNKNOWN = "UNKNOWN"


class IntentAction(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"
    FLATTEN = "FLATTEN"
    HOLD = "HOLD"


class Verdict(str, Enum):
    APPROVED = "APPROVED"                 # OrderIntent wird ausgegeben
    SIZED_DOWN = "SIZED_DOWN"             # genehmigt, aber von Sigma verkleinert
    REJECTED = "REJECTED"                 # Antrag abgelehnt (Reason-Codes)
    NO_INTENT = "NO_INTENT"               # Alpha unter Schwelle — nichts zu tun


class RejectReason(str, Enum):
    NONE = "NONE"
    ALPHA_BELOW_THRESHOLD = "ALPHA_BELOW_THRESHOLD"
    ALPHA_DISAGREEMENT = "ALPHA_DISAGREEMENT"
    ALPHA_STALE = "ALPHA_STALE"
    REGIME_INCOMPATIBLE = "REGIME_INCOMPATIBLE"
    VOLATILITY_GATE = "VOLATILITY_GATE"
    SPREAD_TOO_WIDE = "SPREAD_TOO_WIDE"
    SLIPPAGE_CEILING = "SLIPPAGE_CEILING"
    EXPOSURE_CAP = "EXPOSURE_CAP"
    PER_SYMBOL_CAP = "PER_SYMBOL_CAP"
    LEVERAGE_CAP = "LEVERAGE_CAP"
    RISK_BUDGET_ZERO = "RISK_BUDGET_ZERO"
    COOLDOWN_ACTIVE = "COOLDOWN_ACTIVE"
    CIRCUIT_BREAKER = "CIRCUIT_BREAKER"
    DIRECTIVE_MODE_BLOCKED = "DIRECTIVE_MODE_BLOCKED"
    INSUFFICIENT_CASH = "INSUFFICIENT_CASH"
    MIN_TICKET_UNMET = "MIN_TICKET_UNMET"
    SIGMA_STATE_MISSING = "SIGMA_STATE_MISSING"
    MOS_ZONE_UNCONFIRMED = "MOS_ZONE_UNCONFIRMED"
    STRUCTURE_RANDOM_WALK = "STRUCTURE_RANDOM_WALK"
    PARITY_BROKEN = "PARITY_BROKEN"
    HOOK_UNCLAIMED_BLOCKING = "HOOK_UNCLAIMED_BLOCKING"


# Regime-Kompatibilitaet: welche Alpha-Quelle darf in welchem Regime handeln?
# absent => Antrag wird abgelehnt (Regime-Kante).
# >>> GROK-BOT [GBH-03] >>>
#   Aufgabe: Matrix aus Out-of-Sample-Daten nachfuehren/kalibrieren (pro Asset),
#   statt dieser festen Heuristik. Contract: returns dict[source] = [regimes],
#   einreichbar via POST /api/orchestrator/hooks/GBH-03/resolution.
REGIME_SOURCE_MATRIX: Dict[str, Tuple[Regime, ...]] = {
    "sigma_momentum": (Regime.MOMENTUM_TREND, Regime.SUPER_EXPONENTIAL),
    "grok_trader": (Regime.MOMENTUM_TREND, Regime.SUPER_EXPONENTIAL, Regime.MEAN_REVERTING),
    "grok_debate_bull": (Regime.MOMENTUM_TREND, Regime.SUPER_EXPONENTIAL, Regime.MEAN_REVERTING),
    "grok_debate_bear": (Regime.MOMENTUM_TREND, Regime.SUPER_EXPONENTIAL, Regime.MEAN_REVERTING),
    "grok_sentiment": (Regime.MOMENTUM_TREND, Regime.SUPER_EXPONENTIAL),
    "grok_news_triage": (Regime.MOMENTUM_TREND, Regime.SUPER_EXPONENTIAL, Regime.MEAN_REVERTING),
    "sigma_mean_reversion": (Regime.MEAN_REVERTING,),
    "ampel_structure": (Regime.MEAN_REVERTING, Regime.MOMENTUM_TREND),
    "rl_fast_path": (Regime.MOMENTUM_TREND, Regime.MEAN_REVERTING),
    "manifest_champion": (Regime.MOMENTUM_TREND, Regime.MEAN_REVERTING, Regime.SUPER_EXPONENTIAL),
}
# <<< GROK-BOT [GBH-03] <<<


@dataclass
class AlphaVote:
    """Ein gerichteter Edge-Antrag. strength in [0,1], direction in {-1,0,+1}."""

    source: str
    symbol: str
    direction: int
    strength: float
    confidence: float = 0.5
    horizon_bars: int = 8
    rationale: str = ""
    bar_index: int = 0
    ts: str = ""
    meta: Dict[str, Any] = field(default_factory=dict)

    def normalized(self) -> "AlphaVote":
        d = -1 if self.direction < 0 else (1 if self.direction > 0 else 0)
        return AlphaVote(
            source=str(self.source).lower().strip(),
            symbol=str(self.symbol).upper().split(" ")[0],
            direction=d,
            strength=max(0.0, min(1.0, float(self.strength or 0.0))),
            confidence=max(0.0, min(1.0, float(self.confidence or 0.0))),
            horizon_bars=max(1, int(self.horizon_bars or 1)),
            rationale=str(self.rationale or "")[:500],
            bar_index=int(self.bar_index or 0),
            ts=self.ts or datetime.now(timezone.utc).isoformat(),
            meta=dict(self.meta or {}),
        )


@dataclass
class AlphaScore:
    symbol: str
    score: float                 # [-1, +1] gewichteter, gealterter Netto-Edge
    direction: int               # abgeleitete Richtung (0 bei Unentschieden)
    agreement: float             # 0..1 Gleichlauf der Quellen
    magnitude: float             # 0..1 Durchschnittsstaerke
    effective_sources: int
    contributors: List[Dict[str, Any]] = field(default_factory=list)
    stale_sources: List[str] = field(default_factory=list)
    blocked_by_regime: List[str] = field(default_factory=list)
    as_of_bar: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SigmaState:
    """Volatilitaets- und Regime-Lage eines Symbols — die Single Source of Risk."""

    symbol: str
    price: float
    bars: int
    ewma_vol_bps: float
    garch_vol_bps: float
    realized_vol_ann: float
    z_score: float
    basis: float
    atr: float
    hurst: float
    regime: str
    structure: Optional[Dict[str, Any]] = None      # Ampel/VR/Ljung-Box, falls verfuegbar
    risk_flags: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PortfolioState:
    """Externe Sicht auf Equity/Positionen — Sigma braucht Gedächtnis, kein Raten."""

    equity_usd: float = 0.0
    available_cash_usd: float = 0.0
    gross_exposure_pct: float = 0.0
    per_symbol_exposure_pct: Dict[str, float] = field(default_factory=dict)
    drawdown_pct: float = 0.0
    open_position: Optional[Dict[str, Any]] = None   # {side, qty, entry_price, bars_in_trade}
    last_action_bar: int = -10_000                   # letzter Aktions-Bar (global, Legacy)
    last_action_bars: Dict[str, int] = field(default_factory=dict)   # je Symbol — eigener Takt
    best_equity_usd: float = 0.0


@dataclass
class OrderIntent:
    """Das Einzige, was den Orchestrator verlässt und an den Executor darf."""

    symbol: str
    action: str
    qty: float
    notional_usd: float
    allocation_pct: float
    limit_price_hint: float
    stop_price: Optional[float]
    target_price: Optional[float]
    max_hold_bars: int
    ttl_bars: int
    verdict: str
    reason_codes: List[str]
    alpha_score: float
    alpha_agreement: float
    regime: str
    vol_bps: float
    sizing_trace: Dict[str, Any] = field(default_factory=dict)
    pending_hooks: List[str] = field(default_factory=list)
    ts: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# 2. ALPHA-SYSTEM (Antragskammer)
# ---------------------------------------------------------------------------

class AlphaSubsystem:
    """
    Sammelt AlphaVotes pro Symbol, altert sie exponentiell (Half-Life in Bars),
    gewichtet sie nach Regime-Zulaessigkeit und historischer Trefferquote (IC).
    >>> GROK-BOT [GBH-01]/[GBH-02] >>> uebernehmen Quelle-Prompts und Gewichtung.
    <<< GROK-BOT [GBH-01]/[GBH-02] <<<
    """

    def __init__(self, config: OrchestratorConfig, state: "OrchestratorState"):
        self.cfg = config
        self.state = state
        # Wird vom Orchestrator gesetzt: Votes ohne bar_index bekommen den aktuellen
        # Sigma-Takt, sonst würden externe Anträge sofort als veraltet verworfen.
        self.bar_lookup: Optional[Callable[[str], int]] = None
        self._votes: Dict[str, List[AlphaVote]] = {}
        # IC pro Quelle: exponentielle Korrelation aus Vote-Richtung vs. Realised Return
        self._ic: Dict[str, float] = {}
        self._ic_n: Dict[str, int] = {}
        self._outcome_buf: Dict[str, List[Tuple[int, Dict[str, float]]]] = {}

    # -- Eingang -------------------------------------------------------------
    def record_vote(self, vote: AlphaVote) -> Dict[str, Any]:
        v = vote.normalized()
        if v.bar_index <= 0 and self.bar_lookup is not None:
            v.bar_index = int(self.bar_lookup(v.symbol) or 0)
        if v.direction == 0 or v.strength <= 0.0:
            return {"recorded": False, "reason": "vote ohne richtung/staerke ignoriert"}
        bucket = self._votes.setdefault(v.symbol, [])
        bucket.append(v)
        # Kappen: pro Quelle nur der letzte, aktuelle Vote zaehlt (kein Doppelzaehlen).
        latest_per_source: Dict[str, AlphaVote] = {}
        for old in bucket:
            latest_per_source[old.source] = old
        self._votes[v.symbol] = list(latest_per_source.values())[-16:]
        # Outcome-Beobachtung vorbereiten: nach horizon_bars wird IC aktualisiert.
        self._outcome_buf.setdefault(v.symbol, []).append((v.bar_index + max(1, v.horizon_bars), {
            "source": v.source, "direction": float(v.direction), "strength": v.strength
        }))
        return {"recorded": True, "source": v.source, "symbol": v.symbol, "bar": v.bar_index}

    def record_votes(self, votes: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [self.record_vote(AlphaVote(**{k: val for k, val in v.items() if k in AlphaVote.__dataclass_fields__}))
                for v in (votes or [])]

    # -- Alterung & Outcome --------------------------------------------------
    def observe_outcome(self, symbol: str, bar_index: int, forward_return: float) -> None:
        """
        Reift ausstehende Votes zu IC: korreliert Richtungs-Vorschlag mit dem
        tatsaechlichen Ertrag ueber den Horizont. Das ist das einzige
        Lernsignal, das der Orchestrator akzeptiert (kein Supervised Fit im Loop).
        """
        due = [e for e in self._outcome_buf.get(symbol, []) if e[0] <= bar_index]
        if not due:
            return
        self._outcome_buf[symbol] = [e for e in self._outcome_buf.get(symbol, []) if e[0] > bar_index]
        lam = self.cfg.alpha_ic_ewma_lambda
        for _, entry in due:
            src = entry["source"]
            hit = entry["direction"] * forward_return          # >0 = Quelle hatte recht
            scaled = max(-1.0, min(1.0, hit * 40.0))            # ~2.5% Move = voelliger Treffer
            prev = self._ic.get(src, 0.0)
            self._ic[src] = lam * prev + (1 - lam) * scaled
            self._ic_n[src] = self._ic_n.get(src, 0) + 1
        # >>> GROK-BOT [GBH-02] >>>
        # Ersetzbar durch : adaptive Gewichtung als Bayes-Update/Bandit,
        # Regime-konditionierte IC, Kosten-bereinigte (nach Slippage) IC.
        # Solange nicht claimed, bleibt die EWMA-Heuristik oben massgeblich.
        # <<< GROK-BOT [GBH-02] <<<

    # -- Aggregation ---------------------------------------------------------
    def score(self, symbol: str, bar_index: int, regime: Optional[Regime] = None) -> AlphaScore:
        votes = self._votes.get(symbol.upper(), [])
        contributors: List[Dict[str, Any]] = []
        stale: List[str] = []
        blocked: List[str] = []
        pos_w = neg_w = 0.0
        total_w = 0.0
        strengths: List[float] = []

        for v in votes:
            age = max(0, bar_index - v.bar_index)
            if age > self.cfg.alpha_max_age_bars:
                stale.append(v.source)
                continue
            decay = 0.5 ** (age / max(1e-6, self.cfg.alpha_half_life_bars))
            allowed_src = REGIME_SOURCE_MATRIX.get(v.source)
            if regime is not None and allowed_src is not None and regime not in allowed_src:
                blocked.append(v.source)
                continue
            weight = self.cfg.alpha_source_weights.get(v.source, 0.35) * decay
            if self.cfg.alpha_weight_adaptation:
                ic = self._ic.get(v.source, 0.0)
                weight *= max(0.35, min(1.6, 1.0 + ic))     # IC-skaliert, geklemmt
            w = weight * v.strength * max(0.25, v.confidence)
            total_w += w
            strengths.append(v.strength)
            if v.direction > 0:
                pos_w += w
            elif v.direction < 0:
                neg_w += w
            contributors.append({
                "source": v.source, "direction": v.direction, "strength": round(v.strength, 4),
                "confidence": round(v.confidence, 4), "age_bars": age, "decay": round(decay, 4),
                "weight": round(w, 5), "ic": round(self._ic.get(v.source, 0.0), 4),
            })

        net = (pos_w - neg_w) / total_w if total_w > 0 else 0.0
        agreement = (1.0 - 2.0 * min(pos_w, neg_w) / total_w) if total_w > 0 else 0.0
        magnitude = sum(strengths) / len(strengths) if strengths else 0.0
        direction = 1 if net > 0.12 else (-1 if net < -0.12 else 0)
        return AlphaScore(
            symbol=symbol.upper(),
            score=round(net, 5),
            direction=direction,
            agreement=round(agreement, 4),
            magnitude=round(magnitude, 4),
            effective_sources=len(contributors),
            contributors=sorted(contributors, key=lambda c: -abs(c["weight"])),
            stale_sources=stale,
            blocked_by_regime=blocked,
            as_of_bar=bar_index,
        )

    def snapshot(self) -> Dict[str, Any]:
        return {
            "weights": dict(self.cfg.alpha_source_weights),
            "information_coefficient": {k: round(v, 4) for k, v in self._ic.items()},
            "ic_observations": dict(self._ic_n),
            "open_votes": {s: len(v) for s, v in self._votes.items()},
        }

    def reset(self, symbol: Optional[str] = None) -> None:
        if symbol is None:
            self._votes.clear()
            self._outcome_buf.clear()
        else:
            self._votes.pop(symbol.upper(), None)
            self._outcome_buf.pop(symbol.upper(), None)


# ---------------------------------------------------------------------------
# 3. SIGMA-SYSTEM (Bewilligungskammer)
# ---------------------------------------------------------------------------

class SigmaSubsystem:
    """
    Schaetzt Volatilitaet und Regime aus der Kursreihe und uebersetzt das in
    harte Gates. Bewusst numerisch simpel und nachpruefbar (Stdlib), damit der
    Wert im Journal mit dem Wert im Strategie-Skript (Sigma_*-Familie)
    vergleichbar bleibt.
    """

    def __init__(self, config: OrchestratorConfig, state: "OrchestratorState"):
        self.cfg = config
        self.state = state
        self._series: Dict[str, List[float]] = {}
        self._ewma_var: Dict[str, float] = {}
        self._garch: Dict[str, Tuple[float, float]] = {}      # (sigma2_{t}, r_{t-1})
        self._bar: Dict[str, int] = {}

    # -- Marktdaten ----------------------------------------------------------
    @property
    def bar_index(self) -> int:
        return max(self._bar.values()) if self._bar else 0

    def bar_for(self, symbol: str) -> int:
        return self._bar.get(symbol.upper(), 0)

    def update(self, symbol: str, prices: Optional[List[float]] = None, price: Optional[float] = None) -> SigmaState:
        sym = symbol.upper()
        series = self._series.setdefault(sym, [])
        if prices:
            series[:] = [float(x) for x in prices if _is_finite(x)][-1024:]
            self._bar[sym] = len(series) - 1
        elif _is_finite(price):
            if not series or series[-1] != float(price):
                series.append(float(price))
                self._bar[sym] += 1
            series[:] = series[-1024:]
        return self.snapshot(sym)

    def snapshot(self, symbol: str) -> SigmaState:
        sym = symbol.upper()
        series = self._series.get(sym, [])
        price = series[-1] if series else 0.0
        n = len(series)
        if n < 5:
            return SigmaState(sym, price, n, 0.0, 0.0, 0.0, 0.0, price, 0.0, 0.5,
                              Regime.UNKNOWN.value, risk_flags=["insufficient_history"])

        rets = [math.log(series[i] / series[i - 1]) if series[i - 1] > 0 and series[i] > 0 else 0.0
                for i in range(1, n)]
        ewma_vol = self._ewma_vol(rets)
        garch_vol = self._garch_vol(rets, sym)
        realized = (garch_vol or ewma_vol) * math.sqrt(365.0 * 24.0 * 4.0)   # 15m-Bars annualisiert
        basis, z = self._zscore(series)
        atr = self._atr(series)
        structure: Optional[Dict[str, Any]] = None
        if len(series) >= 12:
            # Eine Realitaet pro Takt: Hurst/Regime/Zonen stammen aus der
            # runner-identischen Rechnung, nicht aus einer zweiten Schaetzung.
            ind = sigma_indicators(series, None, self.cfg)
            hurst = float(ind.get("hurst", 0.5))
            regime = SigmaSubsystem._regime_from_h(hurst)
            structure = {
                "z_score": ind.get("z_score"), "hurst": hurst,
                "random_walk": ind.get("random_walk"), "trend_regime": ind.get("trend_regime"),
                "mean_reversion_regime": ind.get("mean_reversion_regime"),
                "support_score": ind.get("support_score"), "resistance_score": ind.get("resistance_score"),
                "mos_gate_required": True, "signals": ind.get("signals"),
            }
        else:
            hurst, regime = self._regime(series)
        flags: List[str] = []
        if realized > self.cfg.sigma_max_asset_annual_vol_gate:
            flags.append("vol_above_gate")
        if atr <= 0:
            flags.append("atr_degenerate")
        if z > 2.5 or z < -2.5:
            flags.append("z_band_extension")
        return SigmaState(
            symbol=sym, price=round(price, 8), bars=n,
            ewma_vol_bps=round(ewma_vol * 1e4, 3),
            garch_vol_bps=round(garch_vol * 1e4, 3),
            realized_vol_ann=round(realized, 4),
            z_score=round(z, 4), basis=round(basis, 8), atr=round(atr, 8),
            hurst=round(hurst, 4), regime=regime.value, risk_flags=flags,
            structure=structure,
        )

    def _ewma_vol(self, rets: List[float]) -> float:
        lam = self.cfg.sigma_ewma_lambda
        var = 0.0
        for r in rets:
            var = lam * var + (1 - lam) * r * r
        return math.sqrt(max(0.0, var))

    def _garch_vol(self, rets: List[float], sym: str) -> float:
        """GARCH(1,1)-light, rekursiv — identische Form wie app/academy/drills.py."""
        omega, a, b = self.cfg.sigma_garch
        s2, prev = self._garch.get(sym, (max(omega, (rets[0] if rets else 0.0) ** 2), 0.0))
        for r in rets:
            s2 = omega + a * (prev ** 2) + b * s2
            prev = r
        self._garch[sym] = (s2, prev)
        return math.sqrt(max(1e-12, s2))

    def _zscore(self, series: List[float]) -> Tuple[float, float]:
        w = min(self.cfg.sigma_z_lookback, len(series))
        win = series[-w:]
        basis = sum(win) / len(win)
        var = sum((x - basis) ** 2 for x in win) / len(win)
        sd = math.sqrt(var)
        return basis, ((series[-1] - basis) / sd if sd > 0 else 0.0)

    @staticmethod
    def _atr(series: List[float], lookback: int = 0) -> float:
        n = lookback or 14
        if len(series) < 2:
            return 0.0
        diffs = [abs(series[i] - series[i - 1]) for i in range(max(1, len(series) - n), len(series))]
        return sum(diffs) / len(diffs) if diffs else 0.0

    def _regime(self, series: List[float]) -> Tuple[float, Regime]:
        """
        Hurst/DFA. Mit numpy: exakte DFA aus app.regime.dfa_engine. Ohne numpy:
        R/S-Schaetzung als Stdlib-Fallback (gleiche Schwellen, geringere Genauigkeit).
        >>> GROK-BOT [GBH-04] >>>
        Genauer Weg: code_interpreter auf dem xAI-Server laesst die DFA exakt
        berechnen (numpy/polars vorhanden) und liefert das Ergebnis als Vote-Meta
        zurueck — dann dieses Fallback nur noch als Notfallpfad behandeln.
        <<< GROK-BOT [GBH-04] <<<
        """
        if _HAVE_DFA:
            try:
                res = _DFA_ENGINE.compute_hurst_dfa(series[-256:])
                h = float(res.get("hurst_exponent", 0.5))
                regime_str = str(res.get("regime", Regime.BROWNIAN_CHOP.value))
                try:
                    return h, Regime(regime_str)
                except ValueError:
                    return h, self._regime_from_h(h)
            except Exception:
                pass
        h = self._hurst_rs(series)
        return h, self._regime_from_h(h)

    @staticmethod
    def _hurst_rs(series: List[float]) -> float:
        if len(series) < 30:
            return 0.5
        rets = [math.log(series[i] / series[i - 1]) if series[i] > 0 and series[i - 1] > 0 else 0.0
                for i in range(1, len(series))]
        n = min(len(rets), 128)
        w = rets[-n:]
        mean = sum(w) / n
        cum = hi = lo = 0.0
        ss = 0.0
        for x in w:
            cum += x - mean
            hi, lo = max(hi, cum), min(lo, cum)
            ss += (x - mean) ** 2
        sd = math.sqrt(ss / n)
        rs = (hi - lo) / sd if sd > 0 else 0.0
        if rs <= 0:
            return 0.5
        return max(0.05, min(0.99, math.log(rs) / math.log(n)))

    @staticmethod
    def _regime_from_h(h: float) -> Regime:
        if h < 0.45:
            return Regime.MEAN_REVERTING
        if h <= 0.55:
            return Regime.BROWNIAN_CHOP
        if h <= 0.75:
            return Regime.MOMENTUM_TREND
        return Regime.SUPER_EXPONENTIAL

    # -- Bewilligung ---------------------------------------------------------
    def gate(self, score: AlphaScore, sig: SigmaState, pf: PortfolioState,
             requested_alloc: Optional[float], spread_bps: Optional[float],
             est_slippage_bps: Optional[float]) -> Dict[str, Any]:
        """
       返回列表: (verdict, reasons, sizing_trace, approved_alloc_pct).
        Alle Kappen sind multiplikativ und reihenfolge-fixiert — dadurch ist die
        Entscheidung reproduzierbar und im Journal nachvollziehbar.
        """
        reasons: List[str] = []
        trace: Dict[str, Any] = {}
        alloc = requested_alloc if requested_alloc is not None else self.cfg.sigma_max_alloc_pct
        alloc = max(0.0, min(alloc, self.cfg.sigma_max_alloc_pct))
        trace["requested_alloc_pct"] = round(alloc, 6)

        if sig.bars < 5:
            return {"verdict": Verdict.REJECTED, "reasons": [RejectReason.SIGMA_STATE_MISSING.value],
                    "alloc_pct": 0.0, "qty": 0.0, "sizing_trace": trace}

        # 1) Directive / Circuit Breaker
        if system_directive.circuit_breaker != CircuitBreakerStatus.NORMAL:
            reasons.append(RejectReason.CIRCUIT_BREAKER.value)
        if system_directive.mode.value in ("DRY_RUN", "EMERGENCY_HALT"):
            reasons.append(RejectReason.DIRECTIVE_MODE_BLOCKED.value)

        # 2) Regime-Kompatibilitaet der besten Quelle
        if sig.regime == Regime.BROWNIAN_CHOP.value and score.direction != 0:
            # Chop: nur Glattstellen erlaubt
            reasons.append(RejectReason.REGIME_INCOMPATIBLE.value)
            trace["regime_note"] = "BROWNIAN_CHOP — neue Richtungsantraege gesperrt"

        # 2b) MOS-Preiszone (Runner-Parallele): Long braucht Support, Short Resistance.
        st = sig.structure or {}
        if self.cfg.sigma_mos_only_strong and st.get("mos_gate_required"):
            need = "support_score" if score.direction > 0 else "resistance_score"
            have = float(st.get(need) or 0.0)
            if have < self.cfg.sigma_mos_threshold:
                reasons.append(RejectReason.MOS_ZONE_UNCONFIRMED.value)
                trace["mos"] = {"field": need, "value": round(have, 3), "need": self.cfg.sigma_mos_threshold}
        if st.get("random_walk") and score.direction != 0:
            reasons.append(RejectReason.STRUCTURE_RANDOM_WALK.value)
        if st.get("parity_ok") is False:
            # [GBH-06] Paritaet nicht belegt => keine neue Position (Block-Marker unten).
            reasons.append(RejectReason.PARITY_BROKEN.value)

        # 3) Volatilitaets-Ziel (Sigma-Kern): Zielvol / reale Vol
        vol_scalar = min(1.0, self.cfg.sigma_target_annual_vol / max(0.05, sig.realized_vol_ann or 0.05))
        trace["volatility_scalar"] = round(vol_scalar, 4)
        alloc *= vol_scalar
        if sig.realized_vol_ann > self.cfg.sigma_max_asset_annual_vol_gate:
            reasons.append(RejectReason.VOLATILITY_GATE.value)

        # 4) Drawdown-Daempfer
        dd = max(0.0, pf.drawdown_pct or 0.0)
        damp = 1.0
        if dd > self.cfg.sigma_dd_dampener_start_pct:
            damp = max(self.cfg.sigma_dd_dampener_floor, 1.0 - (dd - self.cfg.sigma_dd_dampener_start_pct) / 20.0)
        trace["drawdown_dampener"] = round(damp, 4)
        alloc *= damp

        # 5) Exposure-Caps
        headroom = self.cfg.sigma_max_gross_exposure_pct - max(0.0, pf.gross_exposure_pct)
        if headroom <= 0:
            reasons.append(RejectReason.EXPOSURE_CAP.value)
        alloc = min(alloc, max(0.0, headroom))
        sym_cap = max(0.0, self.cfg.sigma_max_per_symbol_exposure_pct - float(pf.per_symbol_exposure_pct.get(sig.symbol, 0.0) or 0.0))
        if alloc > sym_cap > 0:
            trace["per_symbol_cap_binding"] = True
            alloc = sym_cap
        elif sym_cap <= 0 and score.direction > 0:
            reasons.append(RejectReason.PER_SYMBOL_CAP.value)
        if self.cfg.sigma_max_leverage < 1.0:
            alloc = min(alloc, self.cfg.sigma_max_leverage)

        # 6) Risiko-Budget: Stopabstand in ATR -> max. Einheiten
        stop_mult = self.cfg.sigma_hard_stop_atr_mult
        stop_dist = max(sig.price * 0.005, sig.atr * stop_mult)
        risk_budget_usd = (pf.equity_usd or alloc * sig.price) * self.cfg.sigma_max_risk_per_trade_pct * damp
        qty_by_risk = risk_budget_usd / stop_dist if stop_dist > 0 else 0.0
        notional_cap = (pf.equity_usd * alloc) if pf.equity_usd > 0 else alloc * max(1.0, sig.price)
        qty_by_alloc = notional_cap / sig.price if sig.price > 0 else 0.0
        qty = max(0.0, min(qty_by_risk, qty_by_alloc))
        alloc_final = round((qty * sig.price) / pf.equity_usd, 6) if pf.equity_usd > 0 else round(alloc, 6)
        trace.update({
            "risk_budget_usd": round(risk_budget_usd, 2), "stop_distance": round(stop_dist, 8),
            "qty_by_risk": round(qty_by_risk, 8), "qty_by_alloc": round(qty_by_alloc, 8),
        })
        if qty <= 0 or qty * sig.price < self.cfg.sigma_min_ticket_usd:
            reasons.append(RejectReason.RISK_BUDGET_ZERO.value if qty <= 0 else RejectReason.MIN_TICKET_UNMET.value)

        # 7) Cash-Check fuer Longs
        if score.direction > 0 and pf.available_cash_usd > 0 and qty * sig.price > pf.available_cash_usd * 0.98:
            capped = (pf.available_cash_usd * 0.98) / sig.price if sig.price > 0 else 0.0
            if capped * sig.price < self.cfg.sigma_min_ticket_usd:
                reasons.append(RejectReason.INSUFFICIENT_CASH.value)
            else:
                qty, alloc_final = capped, round((capped * sig.price) / pf.equity_usd, 6) if pf.equity_usd > 0 else alloc_final
                trace["cash_capped"] = True

        # 8) Mikrostruktur
        if spread_bps is not None and spread_bps > self.cfg.sigma_max_spread_bps:
            reasons.append(RejectReason.SPREAD_TOO_WIDE.value)
        if est_slippage_bps is not None and est_slippage_bps > self.cfg.sigma_max_slippage_bps:
            reasons.append(RejectReason.SLIPPAGE_CEILING.value)

        # 9) Cooldown — pro Symbol, gegen dessen eigenen Takt. Ein Takt, der
        # zuruecklaeuft (Re-Ingest/Reset), bestraft die neue Serie nicht mit Cooldown.
        if sig.symbol in pf.last_action_bars:
            stored: Any = pf.last_action_bars[sig.symbol]
        elif not pf.last_action_bars:
            stored = pf.last_action_bar          # Legacy-Zustand aus aelteren Snapschuesse
        else:
            stored = -1                          # fuer dieses Symbol noch keine Aktion
        cur_bar = self.bar_for(sig.symbol)
        try:
            stored_i = int(stored if stored is not None else -10_000)
        except (TypeError, ValueError):
            stored_i = -10_000
        if stored_i < 0 or cur_bar < stored_i:
            bars_since = self.cfg.sigma_cooldown_bars
        else:
            bars_since = cur_bar - stored_i
        if score.direction != 0 and bars_since < self.cfg.sigma_cooldown_bars:
            reasons.append(RejectReason.COOLDOWN_ACTIVE.value)
            trace["cooldown_bars_left"] = self.cfg.sigma_cooldown_bars - bars_since
            trace["cooldown_source_bar"] = stored_i

        unique = list(dict.fromkeys(reasons))
        verdict = Verdict.APPROVED if not unique else Verdict.REJECTED
        if not unique and abs(alloc_final - (requested_alloc or alloc_final)) > 1e-9 and requested_alloc is not None:
            verdict = Verdict.SIZED_DOWN
        return {
            "verdict": verdict, "reasons": unique or [RejectReason.NONE.value],
            "alloc_pct": round(alloc_final, 6) if verdict is not Verdict.REJECTED else 0.0,
            "qty": round(qty, 8) if verdict is not Verdict.REJECTED else 0.0,
            "leverage_applied": 1.0,
            "sizing_trace": trace,
        }

    def telemetry(self) -> Dict[str, Any]:
        return {"series_len": {k: len(v) for k, v in self._series.items()}, "bars": dict(self._bar)}


# ---------------------------------------------------------------------------
# 4. ORCHESTRATOR-STATE (Expositions-Gedaechtnis + Journal)
# ---------------------------------------------------------------------------

class OrchestratorState:
    def __init__(self, config: OrchestratorConfig):
        self.cfg = config
        self.portfolio = PortfolioState()
        self.last_intent: Optional[OrderIntent] = None
        self.decisions: List[Dict[str, Any]] = []
        self.hook_state: Dict[str, Any] = {}
        self._load_hooks()

    def apply_fill(self, symbol: str, action: str, qty: float, price: float) -> None:
        pf = self.portfolio
        notional = qty * price
        if action == IntentAction.LONG.value:
            pf.available_cash_usd = max(0.0, pf.available_cash_usd - notional)
            pf.gross_exposure_pct += (notional / pf.equity_usd) if pf.equity_usd else 0.0
            pf.per_symbol_exposure_pct[symbol] = pf.per_symbol_exposure_pct.get(symbol, 0.0) + (notional / pf.equity_usd if pf.equity_usd else 0.0)
            pf.open_position = {"side": "LONG", "qty": qty, "entry_price": price, "bars_in_trade": 0}
        elif action == IntentAction.SHORT.value:
            pf.gross_exposure_pct += (notional / pf.equity_usd) if pf.equity_usd else 0.0
            pf.per_symbol_exposure_pct[symbol] = pf.per_symbol_exposure_pct.get(symbol, 0.0) + (notional / pf.equity_usd if pf.equity_usd else 0.0)
            pf.open_position = {"side": "SHORT", "qty": qty, "entry_price": price, "bars_in_trade": 0}
        else:  # FLATTEN / HOLD
            pos = pf.open_position or {}
            if pos.get("side") == "LONG":
                pf.available_cash_usd += notional
            if pos.get("side"):
                pf.per_symbol_exposure_pct[symbol] = max(0.0, pf.per_symbol_exposure_pct.get(symbol, 0.0) - (notional / pf.equity_usd if pf.equity_usd else 0.0))
            pf.open_position = None
        pf.last_action_bar = max(0, pf.last_action_bar)

    def update_equity(self, equity_usd: float) -> None:
        pf = self.portfolio
        pf.equity_usd = equity_usd
        pf.best_equity_usd = max(pf.best_equity_usd or equity_usd, equity_usd)
        pf.drawdown_pct = round(((pf.best_equity_usd - equity_usd) / pf.best_equity_usd) * 100.0, 3) if pf.best_equity_usd else 0.0

    def journal(self, decision: Dict[str, Any]) -> None:
        self.decisions.append(decision)
        if len(self.decisions) > 400:
            self.decisions = self.decisions[-400:]
        try:
            p = Path(self.cfg.journal_file)
            p.parent.mkdir(parents=True, exist_ok=True)
            with p.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(decision, ensure_ascii=False, default=str) + "\n")
        except OSError:
            pass  # Journal darf den Takt nie blockieren

    def _load_hooks(self) -> None:
        try:
            self.hook_state = json.loads(Path(self.cfg.hook_state_file).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.hook_state = {}

    def save_hooks(self) -> None:
        try:
            p = Path(self.cfg.hook_state_file)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(self.hook_state, indent=2, sort_keys=True), encoding="utf-8")
        except OSError:
            pass


# ---------------------------------------------------------------------------
# 5. GROK-BOT-HOOKS (machine-lesbare Uebernahme-Liste)
# ---------------------------------------------------------------------------

# status: PLACEHOLDER = Engine laeuft mit Heuristik, Bot soll ersetzen.
#         CLAIMED     = Bot arbeitet daran.        IMPLEMENTED = Bot hat geliefert.
# `fallback` ist IMMER funktionsfaehig — der Orchestrator ist ohne Bot betriebsbereit.
GROK_BOT_HOOKS: List[Dict[str, Any]] = [
    {
        "id": "GBH-01", "subsystem": "ALPHA", "status": "PLACEHOLDER", "blocking": False,
        "title": "Agenten-Antrags-Prompts",
        "purpose": "Ersetzt die statischen Rollen-Prompts der Antragskammer durch Grok-Agenten-Delegierung (Fundamentals/Sentiment/News/Technical als strukturierte AlphaVotes).",
        "input_contract": {"symbol": "str", "sigma_state": "SigmaState", "recent_posts": "list[dict]?"},
        "output_contract": {"votes": "[{source, direction:-1|0|1, strength:0..1, confidence:0..1, horizon_bars:int, rationale:<=500}]"},
        "file": "server/grokOrchestrator.ts", "test": "tests/test_alpha_sigma_orchestrator.py::TestGrokBotHooks::test_GBH_01",
        "fallback": "votes aus /api/ai/trade-signal + Sigma-Strategie-Heuristik",
    },
    {
        "id": "GBH-02", "subsystem": "ALPHA", "status": "PLACEHOLDER", "blocking": False,
        "title": "Adaptive Quellen-Gewichtung (IC-Lerner)",
        "purpose": "Ersetzt die EWMA-IC-Heuristik durch Bayes-Update/Bandit mit Kostenbereinigung und Regime-Konditionalitaet.",
        "input_contract": {"ic_history": "dict[source][float]", "fees_bps": "float", "regime": "str"},
        "output_contract": {"weights": "dict[source][0..1.6]"},
        "file": "app/orchestrator/alpha_sigma_engine.py::AlphaSubsystem.observe_outcome",
        "test": "tests/test_alpha_sigma_orchestrator.py::TestGrokBotHooks::test_GBH_02",
        "fallback": "exponentielle IC mit Klemme [0.35, 1.6]",
    },
    {
        "id": "GBH-03", "subsystem": "SIGMA", "status": "PLACEHOLDER", "blocking": False,
        "title": "Regime-Quellen-Matrix kalibrieren",
        "purpose": "REGIME_SOURCE_MATRIX assetweise aus Out-of-Sample-Daten nachfuehren statt global fix.",
        "input_contract": {"asset": "str", "windows": "list[[start,end]]"},
        "output_contract": {"matrix": "dict[source][list[Regime]]", "confidence": "float"},
        "file": "app/orchestrator/alpha_sigma_engine.py::REGIME_SOURCE_MATRIX",
        "test": "tests/test_alpha_sigma_orchestrator.py::TestGrokBotHooks::test_GBH_03",
        "fallback": "globale feste Matrix (Hurst-Schwellen 0.45/0.55/0.75)",
    },
    {
        "id": "GBH-04", "subsystem": "SIGMA", "status": "PLACEHOLDER", "blocking": False,
        "title": "Exakte DFA/Hurst via code_interpreter",
        "purpose": "Hurst-Berechnung aus der Stdlib-R/S-Fallback auf die exakte DFA heben (xAI-Sandbox mit numpy), Ergebnis als Vote-Meta einspielen.",
        "input_contract": {"series": "list[float]", "scales": "int"},
        "output_contract": {"hurst": "float", "r_squared": "float", "regime": "str"},
        "file": "server/grokOrchestrator.ts::sigmaHurstViaCodeInterpreter",
        "test": "tests/test_alpha_sigma_orchestrator.py::TestGrokBotHooks::test_GBH_04",
        "fallback": "R/S-Schaetzung; DFA wenn numpy installiert ist",
    },
    {
        "id": "GBH-05", "subsystem": "ALPHA", "status": "PLACEHOLDER", "blocking": False,
        "title": "x_search Handle-Listen pflegen",
        "purpose": "allowed/excluded Handles je Asset aus Performance-Daten nachziehen (Quellen mit niedriger Praezision ausschliessen).",
        "input_contract": {"source_stats": "dict[handle][hit_rate]"},
        "output_contract": {"allowed": "list[str]<=20", "excluded": "list[str]<=20"},
        "file": "server/grokEngine.ts::runSentimentScreen", "test": "tests/test_alpha_sigma_orchestrator.py::TestGrokBotHooks::test_GBH_05",
        "fallback": "manuelle Liste / leer",
    },
    {
        "id": "GBH-06", "subsystem": "ARBITRATION", "status": "PLACEHOLDER", "blocking": True,
        "title": "Sigma-Paritaet zum Strategie-Code verifizieren",
        "purpose": "Belegen, dass z-Score/ATR/Hurst des Orchestrators die gleichen Zahlen liefert wie die Sigma_*-Runner-Skripte (sonst entscheidet eine andere Realitaet als die, die handelt).",
        "input_contract": {"price": "float", "prices": "list[float]", "parameters": "dict"},
        "output_contract": {"parity_delta_z": "float", "parity_delta_atr": "float", "max_abs_delta": "float"},
        "file": "app/orchestrator/alpha_sigma_engine.py::sigma_indicators",
        "test": "tests/test_alpha_sigma_orchestrator.py::TestSigmaIndicators::test_runner_parity_z_atr_hurst",
        "fallback": "Toleranz 1e-6; Abweichungen > 2% lassen Antraege scheitern (blocking)",
    },
    {
        "id": "GBH-07", "subsystem": "SIGMA", "status": "PLACEHOLDER", "blocking": False,
        "title": "Drawdown-Eskalationsleiter",
        "purpose": "Stufen (Daempfer -> nur FLATTEN -> Breaker trip) konfigurierbar machen inkl. Recovery-Kriterien.",
        "input_contract": {"drawdown_pct": "float", "bars_in_dd": "int"},
        "output_contract": {"stage": "0..3", "action": "str"},
        "file": "app/orchestrator/alpha_sigma_engine.py::SigmaSubsystem.gate",
        "test": "tests/test_alpha_sigma_orchestrator.py::TestGrokBotHooks::test_GBH_07",
        "fallback": "linearer Daempener ab 5% DD, Floor 0.2",
    },
    {
        "id": "GBH-08", "subsystem": "ALPHA", "status": "PLACEHOLDER", "blocking": False,
        "title": "Look-Ahead-Bias Kadenzen",
        "purpose": "PiT-/Anonymisierungs-Fenster fuer die Neubewertung der Alphaquellen automatisiert nachziehen (Alpha-Decay Kontrolle).",
        "input_contract": {"model": "str", "window": "[start,end]"},
        "output_contract": {"cadence_hours": "float", "anonymize": "bool"},
        "file": "server/grokEngine.ts::assessLookAheadBias",
        "test": "tests/test_alpha_sigma_orchestrator.py::TestGrokBotHooks::test_GBH_08",
        "fallback": "auto-Modus: anonymisieren bei Kontamination > 0",
    },
    {
        "id": "GBH-09", "subsystem": "ARBITRATION", "status": "PLACEHOLDER", "blocking": False,
        "title": "Nachtorientierte Neujustierung (Batch)",
        "purpose": "Kalibrierung der ORS_*-Grenzen pro Asset nachts per Batch API einreichen und als Vorschlag hinterlegen (Mensch/Regelwerk entscheidet, nicht das Modell).",
        "input_contract": {"decisions_24h": "list[dict]"},
        "output_contract": {"proposed_overrides": "dict[str,float]", "rationale": "str"},
        "file": "server/grokEngine.ts::submitBatch", "test": "tests/test_alpha_sigma_orchestrator.py::TestGrokBotHooks::test_GBH_09",
        "fallback": "keine automatischen Overrides",
    },
    {
        "id": "GBH-10", "subsystem": "ARBITRATION", "status": "PLACEHOLDER", "blocking": False,
        "title": "Champion/Challenger-Promotion",
        "purpose": "Promotion/Relegationspolitik (A/B-Shadow-Races) an die Registry koppeln und Alpha-Gewichte je Lebenszyklus setzen.",
        "input_contract": {"strategy_id": "str", "race": "dict"},
        "output_contract": {"decision": "PROMOTE|DEFEND|RELEGATE", "alpha_weight": "float"},
        "file": "app/academy/ab_racing.py", "test": "tests/test_alpha_sigma_orchestrator.py::TestGrokBotHooks::test_GBH_10",
        "fallback": "Gewicht manifest_champion=0.60 fix",
    },
]


def hook_worklist(state: OrchestratorState) -> Dict[str, Any]:
    """Aktueller Uebernahme-Stand — der Bot liest das und arbeitet die Liste ab."""
    out = []
    for h in GROK_BOT_HOOKS:
        rec = dict(h)
        st = state.hook_state.get(h["id"]) or {}
        rec["status"] = st.get("status", h["status"])
        rec["owner"] = st.get("owner", "heuristik")
        rec["note"] = st.get("note", "")
        rec["updated_at"] = st.get("updated_at")
        out.append(rec)
    open_items = [h for h in out if h["status"] != "IMPLEMENTED"]
    return {
        "total": len(out), "open": len(open_items), "blocking_open": sum(1 for h in open_items if h["blocking"]),
        "hooks": out,
        "protocol": {
            "claim": "POST /api/orchestrator/hooks/{id}/claim",
            "resolve": "POST /api/orchestrator/hooks/{id}/resolution",
            "rule": "Der Bot liefert Vorschlaege und Payloads; harte Risiko-Kappen bleiben in der Engine.",
        },
    }


def set_hook_state(state: OrchestratorState, hook_id: str, status: str, owner: str = "grok-bot",
                   note: str = "", payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    known = {h["id"] for h in GROK_BOT_HOOKS}
    if hook_id not in known:
        raise KeyError(f"Unbekannter Hook '{hook_id}'. Bekannt: {', '.join(sorted(known))}")
    if status not in {"PLACEHOLDER", "CLAIMED", "IMPLEMENTED"}:
        raise ValueError("status muss PLACEHOLDER|CLAIMED|IMPLEMENTED sein")
    state.hook_state[hook_id] = {
        "status": status, "owner": owner, "note": str(note)[:500],
        "payload": payload or {}, "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    state.save_hooks()
    return state.hook_state[hook_id]


# ---------------------------------------------------------------------------
# 6. ARBITRATION (Zwei-Kammer-Klammer)
# ---------------------------------------------------------------------------

class AlphaSigmaOrchestrator:
    """
    Oeffentlicher Eingang. Ein Zyklus:
      prices -> SIGMA-Snapshot -> ALPHA-Score (gealtert, IC-gewaehlt, regime-gefiltert)
             -> Antragsbildung -> SIGMA-Gate -> OrderIntent -> Journal
    """

    def __init__(self, config: Optional[OrchestratorConfig] = None, hydrate: bool = True):
        self.cfg = config or _env_overrides(OrchestratorConfig())
        self.state = OrchestratorState(self.cfg)
        self.alpha = AlphaSubsystem(self.cfg, self.state)
        self.sigma = SigmaSubsystem(self.cfg, self.state)
        self.alpha.bar_lookup = self.sigma.bar_for
        self.parity_cache: Dict[str, bool] = {}
        # SigmaQuantBridge is an adapter around this engine's authoritative math;
        # importing lazily avoids a module cycle and keeps the legacy chamber intact.
        from app.quant.sigma_bridge import SigmaQuantBridge
        self.quant_bridge = SigmaQuantBridge()
        if hydrate:
            self.hydrate()

    # -- Persistenz ----------------------------------------------------------
    # Der TS-Bridge startet pro Aufruf einen Python-Prozess; ohne Snapshot waere
    # der Orchestrator-zustand nach jedem tick weg. Ausserdem: Restart-safe.
    def snapshot(self) -> Dict[str, Any]:
        return {
            "schema": 1,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "sigma": {
                "series": {k: list(v)[-1024:] for k, v in self.sigma._series.items()},
                "bar": dict(self.sigma._bar),
                "ewma_var": dict(self.sigma._ewma_var),
                "garch": {k: [v[0], v[1]] for k, v in self.sigma._garch.items()},
            },
            "alpha": {
                "votes": {s: [asdict(v) for v in vs] for s, vs in self.alpha._votes.items()},
                "ic": dict(self.alpha._ic), "ic_n": dict(self.alpha._ic_n),
                "outcome_buf": {s: [[int(b), dict(m)] for b, m in lst] for s, lst in self.alpha._outcome_buf.items()},
            },
            "portfolio": asdict(self.state.portfolio),
            "parity": dict(self.parity_cache),
            "hook_state": dict(self.state.hook_state),
            "decisions": self.state.decisions[-50:],
        }

    def hydrate(self) -> None:
        try:
            raw = json.loads(Path(self.cfg.state_file).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if not isinstance(raw, dict) or raw.get("schema") != 1:
            return
        try:
            sig = raw.get("sigma") or {}
            self.sigma._series.update({k: [float(x) for x in (v or [])][-1024:] for k, v in (sig.get("series") or {}).items()})
            self.sigma._bar.update({k: int(v) for k, v in (sig.get("bar") or {}).items()})
            self.sigma._ewma_var.update({k: float(v) for k, v in (sig.get("ewma_var") or {}).items()})
            self.sigma._garch.update({k: (float(v[0]), float(v[1])) for k, v in (sig.get("garch") or {}).items()
                                     if isinstance(v, (list, tuple)) and len(v) == 2})
            alp = raw.get("alpha") or {}
            fields = set(AlphaVote.__dataclass_fields__)
            self.alpha._votes.update({
                s: [AlphaVote(**{k: val for k, val in v.items() if k in fields}) for v in (vs or [])]
                for s, vs in (alp.get("votes") or {}).items()
            })
            self.alpha._ic.update({k: float(v) for k, v in (alp.get("ic") or {}).items()})
            self.alpha._ic_n.update({k: int(v) for k, v in (alp.get("ic_n") or {}).items()})
            self.alpha._outcome_buf.update({
                s: [(int(b), dict(m)) for b, m in (lst or [])] for s, lst in (alp.get("outcome_buf") or {}).items()
            })
            for k, v in (raw.get("portfolio") or {}).items():
                if hasattr(self.state.portfolio, k):
                    setattr(self.state.portfolio, k, v)
            self.parity_cache.update({k: bool(v) for k, v in (raw.get("parity") or {}).items()})
            self.state.hook_state.update(raw.get("hook_state") or {})
            self.state.decisions = list(raw.get("decisions") or [])[-50:]
        except (TypeError, ValueError, KeyError):
            return

    def persist(self) -> None:
        try:
            p = Path(self.cfg.state_file)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(self.snapshot(), ensure_ascii=False, default=str), encoding="utf-8")
        except OSError:
            pass

    # -- Datenzugang ---------------------------------------------------------
    def ingest(self, symbol: str, prices: Optional[List[float]] = None, price: Optional[float] = None,
               equity_usd: Optional[float] = None, available_cash_usd: Optional[float] = None) -> SigmaState:
        if _is_finite(equity_usd):
            self.state.update_equity(float(equity_usd))
        if _is_finite(available_cash_usd):
            self.state.portfolio.available_cash_usd = float(available_cash_usd)
        state = self.sigma.update(symbol, prices=prices, price=price)
        self.persist()
        return state

    def submit_votes(self, votes: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out = self.alpha.record_votes(votes)
        self.persist()
        return out

    def derive_runner_votes(self, symbol: str, prices: Optional[List[float]] = None,
                            params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Erzeugt AlphaVotes direkt aus der Runner-Mathematik (sigma_momentum /
        sigma_mean_reversion / ampel_structure). Damit beantragt der Orchestrator
        genau das, was die Sigma-Runner-Skripte tun wuerden — keine zweite
        Signalfantasie. Der Grok-Bot kann zusaetzliche Quellen einspielen (GBH-01).
        """
        sym = symbol.upper()
        series = [float(x) for x in (prices or self.sigma._series.get(sym, [])) if _is_finite(x)]
        ind = sigma_indicators(series, params, self.cfg)
        if not ind.get("ok"):
            return {"derived": 0, "indicators": ind, "votes": []}
        bar = self.sigma.bar_for(sym)
        atr = ind.get("atr") or 0.0
        price = ind.get("price") or 0.0
        votes: List[Dict[str, Any]] = []
        sig = ind["signals"]
        if sig["trend_long"] or sig["mr_long"]:
            votes.append({
                "source": "sigma_momentum" if sig["trend_long"] else "sigma_mean_reversion",
                "symbol": sym, "direction": 1, "bar_index": bar,
                "strength": 0.55 + min(0.35, abs(ind["z_score"]) / 6.0),
                "confidence": 0.75 if sig["trend_long"] else 0.6,
                "horizon_bars": self.cfg.sigma_max_hold_bars,
                "rationale": ("trend: ema_fast>ema_slow & price>breakout_upper" if sig["trend_long"]
                              else "meanrev: basis-kreuzung, z=%.2f" % ind["z_score"]),
                "meta": {"hurst": ind["hurst"], "z": ind["z_score"], "mos_support": ind["support_score"]},
            })
        if sig["trend_short"] or sig["mr_short"]:
            votes.append({
                "source": "sigma_momentum" if sig["trend_short"] else "sigma_mean_reversion",
                "symbol": sym, "direction": -1, "bar_index": bar,
                "strength": 0.55 + min(0.35, abs(ind["z_score"]) / 6.0),
                "confidence": 0.7 if sig["trend_short"] else 0.55,
                "horizon_bars": self.cfg.sigma_max_hold_bars,
                "rationale": ("trend-short: ema_fast<ema_slow & price<breakout_lower" if sig["trend_short"]
                              else "meanrev-short: basis-kreuzung, z=%.2f" % ind["z_score"]),
                "meta": {"hurst": ind["hurst"], "z": ind["z_score"], "mos_resistance": ind["resistance_score"]},
            })
        if ind["trend_regime"] or ind["mean_reversion_regime"]:
            # Struktur-Vote ist ein Tiebreak, kein Widerspruch: wenn der Runner ein
            # Entry-Signal liefert, zeigt die Struktur in dieselbe Richtung (und mit
            # gleicher Staerke-Skala). Ohne Entry-Signal bleibt sie bewusst schwach.
            long_side = sig["trend_long"] or sig["mr_long"]
            short_side = sig["trend_short"] or sig["mr_short"]
            if long_side or short_side:
                struct_dir = 1 if long_side else -1
                struct_strength = min(1.0, 0.5 + abs(ind["z_score"]) / 6.0)
                struct_note = "bestaetigt runner-entry"
            else:
                cheap = (ind["mean_reversion_regime"] and _is_finite(ind["basis"]) and price <= ind["basis"]) or \
                    (ind["trend_regime"] and price >= (ind["ema_fast"] or price))
                struct_dir = 1 if cheap else -1
                struct_strength = min(0.3, abs(ind["hurst"] - 0.5) * 0.6)
                struct_note = "nur regime-tiebreak"
            votes.append({
                "source": "ampel_structure", "symbol": sym, "direction": struct_dir,
                "strength": struct_strength, "confidence": 0.5, "horizon_bars": 12, "bar_index": bar,
                "rationale": "%s: hurst=%.3f, atr=%.6g, z=%.2f" % (struct_note, ind["hurst"], atr, ind["z_score"]),
                "meta": {"mos_support": ind["support_score"], "mos_resistance": ind["resistance_score"]},
            })
        accepted = self.alpha.record_votes(votes) if votes else []
        self.persist()
        return {"derived": len([a for a in accepted if a.get("recorded")]), "indicators": ind,
                "votes": votes, "accepted": accepted}

    def submit_grok_signal(self, symbol: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalisiert ein Grok-Handelssignal (trade-signal-Schema) in AlphaVotes.
        Der Bot entscheidet RICHTUNG/STAERKE — Menge/Hebel/Exposure entscheidet Sigma.
        """
        sym = symbol.upper()
        action = str(payload.get("action", "HOLD")).upper()
        direction = 1 if action == "BUY" else (-1 if action == "SELL" else 0)
        votes: List[Dict[str, Any]] = []
        if direction != 0:
            votes.append({
                "source": "grok_trader", "symbol": sym, "direction": direction,
                "strength": max(0.0, min(1.0, float(payload.get("confidence_score") or 0.0))),
                "confidence": max(0.0, min(1.0, float(payload.get("confidence_score") or 0.0))),
                "horizon_bars": int(payload.get("time_horizon_bars") or 8),
                "rationale": str(payload.get("rationale") or "")[:500],
                "bar_index": self.sigma.bar_for(sym),
                "meta": {
                    "requested_alloc_pct": payload.get("allocation_percentage"),
                    "stop_loss_pct": payload.get("stop_loss_pct"),
                    "take_profit_pct": payload.get("take_profit_pct"),
                    "model": payload.get("modelUsed"),
                },
            })
        for src, key in (("grok_debate_bull", "bull_conviction"), ("grok_debate_bear", "bear_conviction"),
                        ("grok_sentiment", "sentiment_score")):
            if payload.get(key) is None:
                continue
            val = float(payload[key])
            votes.append({
                "source": src, "symbol": sym,
                "direction": (1 if val >= 0 else -1) if src != "grok_debate_bear" else (-1 if val >= 0 else 1),
                "strength": abs(val) if src == "grok_sentiment" else min(1.0, abs(val)),
                "confidence": min(1.0, abs(val) + 0.2),
                "horizon_bars": 8, "bar_index": self.sigma.bar_for(sym), "rationale": "abgeleitet aus Grok-Signal",
            })
        accepted = self.alpha.record_votes(votes) if votes else []
        self.persist()
        return {"votes_submitted": len([a for a in accepted if a.get("recorded")], ), "detail": accepted,
                "ignored_reason": None if votes else "HOLD ohne richtungsweisende Meta"}

    # -- Zyklus --------------------------------------------------------------
    def decide(self, symbol: str, *, allow_entries: bool = True, spread_bps: Optional[float] = None,
               est_slippage_bps: Optional[float] = None, auto_sigma_from: Optional[List[float]] = None) -> Dict[str, Any]:
        sym = symbol.upper()
        if auto_sigma_from:
            self.sigma.update(sym, prices=auto_sigma_from)
        sig = self.sigma.snapshot(sym)
        if sig.structure is not None:
            sig.structure["parity_ok"] = self.parity_cache.get(sym)
        bar = self.sigma.bar_for(sym)
        regime = Regime(sig.regime) if sig.regime in {r.value for r in Regime} else Regime.UNKNOWN
        score = self.alpha.score(sym, bar, regime if regime is not Regime.UNKNOWN else None)

        # Phase B contract path: the SIGMA chamber receives a QuantVerdict from
        # the adapter.  It wraps the same indicator implementation, so this is
        # not a second physics engine.  A missing/off backend is fail-closed.
        from app.contracts import QuantRequest
        quant_series = list(self.sigma._series.get(sym, []))
        quant_request = QuantRequest(symbol=sym, prices=quant_series,
                                     parameters={}, as_of_bar=bar,
                                     execution_mode="paper")
        quant_result = self.quant_bridge.evaluate(quant_request)
        quant_unavailable = quant_result.verdict.status == "UNAVAILABLE"

        # Outcome-Reifung zuerst: IC lernt aus dem, was vor dem Horizont lag.
        if sig.bars >= 2:
            series = self.sigma._series.get(sym, [])
            horizon = max(1, min(8, len(series) - 1))
            if len(series) > horizon:
                fwd = math.log(series[-1] / series[-1 - horizon]) if series[-1 - horizon] > 0 else 0.0
                self.alpha.observe_outcome(sym, bar, fwd)

        blocking_open = [h["id"] for h in GROK_BOT_HOOKS
                         if h["blocking"] and (self.state.hook_state.get(h["id"]) or {}).get("status", h["status"]) != "IMPLEMENTED"]
        pending = [h["id"] for h in GROK_BOT_HOOKS
                   if (self.state.hook_state.get(h["id"]) or {}).get("status", h["status"]) != "IMPLEMENTED"]

        base: Dict[str, Any] = {
            "schema": "ors-decision/1",
            "symbol": sym, "bar": bar, "alpha": score.to_dict(), "sigma": sig.to_dict(),
            "quant": quant_result.to_dict(),
            "portfolio": {
                "equity_usd": round(self.state.portfolio.equity_usd, 2),
                "available_cash_usd": round(self.state.portfolio.available_cash_usd, 2),
                "gross_exposure_pct": round(self.state.portfolio.gross_exposure_pct, 4),
                "drawdown_pct": round(self.state.portfolio.drawdown_pct, 3),
                "open_position": self.state.portfolio.open_position,
            },
            "pending_hooks": pending,
            "ts": datetime.now(timezone.utc).isoformat(),
        }

        # Position Management hat Vorrang vor neuen Antraegen (Exit-first).
        pos = self.state.portfolio.open_position
        if pos and pos.get("side") in ("LONG", "SHORT"):
            stop = pos.get("stop_price") or (sig.price - self.cfg.sigma_hard_stop_atr_mult * sig.atr if pos["side"] == "LONG"
                                             else sig.price + self.cfg.sigma_hard_stop_atr_mult * sig.atr)
            hit_stop = sig.price <= stop if pos["side"] == "LONG" else sig.price >= stop
            if hit_stop:
                intent = OrderIntent(
                    symbol=sym, action=IntentAction.FLATTEN.value, qty=float(pos.get("qty") or 0.0),
                    notional_usd=round(float(pos.get("qty") or 0.0) * sig.price, 2), allocation_pct=0.0,
                    limit_price_hint=round(sig.price, 8), stop_price=None, target_price=None,
                    max_hold_bars=1, ttl_bars=self.cfg.decision_ttl_bars, verdict=Verdict.APPROVED.value,
                    reason_codes=["STOP_LOSS_TRIGGERED"], alpha_score=score.score, alpha_agreement=score.agreement,
                    regime=sig.regime, vol_bps=sig.garch_vol_bps or sig.ewma_vol_bps,
                    sizing_trace={"exit": "sigma_atr_stop", "stop_price": round(stop, 8)},
                    pending_hooks=pending, ts=base["ts"],
                )
                return self._finish(base, intent)

        if quant_unavailable:
            unavailable_reasons = ["QUANT_BACKEND_UNAVAILABLE"]
            if sig.bars < 5:
                unavailable_reasons.insert(0, RejectReason.SIGMA_STATE_MISSING.value)
            base.update({"verdict": Verdict.REJECTED.value,
                         "reason_codes": unavailable_reasons, "intent": None,
                         "quant_fail_closed": True})
            self.state.journal(base)
            self.persist()
            return base

        if score.direction == 0 or abs(score.score) < self.cfg.alpha_min_score:
            base.update({"verdict": Verdict.NO_INTENT.value, "reason_codes": [RejectReason.ALPHA_BELOW_THRESHOLD.value],
                         "intent": None, "threshold": self.cfg.alpha_min_score})
            self.state.journal(base)
            self.persist()
            return base
        if score.agreement < self.cfg.alpha_min_agreement:
            base.update({"verdict": Verdict.REJECTED.value, "reason_codes": [RejectReason.ALPHA_DISAGREEMENT.value],
                         "intent": None, "agreement_min": self.cfg.alpha_min_agreement})
            self.state.journal(base)
            self.persist()
            return base
        if not allow_entries:
            base.update({"verdict": Verdict.REJECTED.value, "reason_codes": [RejectReason.DIRECTIVE_MODE_BLOCKED.value], "intent": None})
            self.state.journal(base)
            self.persist()
            return base
        if blocking_open:
            # [GBH-06] blocking-Hooks laegen die Antragskammer still, bis die
            # Sigma-Paritaet belegt ist. Arbeitsliste: /api/orchestrator/hooks
            base.update({"verdict": Verdict.REJECTED.value, "reason_codes": [RejectReason.HOOK_UNCLAIMED_BLOCKING.value],
                         "intent": None, "blocking_hooks": blocking_open})
            self.state.journal(base)
            self.persist()
            return base

        requested = None
        for v in self.alpha._votes.get(sym, []):
            if v.source == "grok_trader":
                ra = (v.meta or {}).get("requested_alloc_pct")
                if _is_finite(ra):
                    requested = float(ra)
                break

        gate = self.sigma.gate(score, sig, self.state.portfolio, requested, spread_bps, est_slippage_bps)
        qty = float(gate.get("qty") or 0.0)
        alloc = float(gate.get("alloc_pct") or 0.0)
        if gate["verdict"] is Verdict.REJECTED or qty <= 0:
            base.update({"verdict": Verdict.REJECTED.value, "reason_codes": gate["reasons"],
                         "intent": None, "sizing_trace": gate["sizing_trace"]})
            self.state.journal(base)
            self.persist()
            return base

        long_side = score.direction > 0
        stop = sig.price - self.cfg.sigma_hard_stop_atr_mult * sig.atr if long_side else sig.price + self.cfg.sigma_hard_stop_atr_mult * sig.atr
        target = sig.price + self.cfg.sigma_target_atr_mult * sig.atr if long_side else sig.price - self.cfg.sigma_target_atr_mult * sig.atr
        intent = OrderIntent(
            symbol=sym, action=IntentAction.LONG.value if long_side else IntentAction.SHORT.value,
            qty=round(qty, 8), notional_usd=round(qty * sig.price, 2), allocation_pct=round(alloc, 6),
            limit_price_hint=round(sig.price, 8), stop_price=round(stop, 8), target_price=round(target, 8),
            max_hold_bars=self.cfg.sigma_max_hold_bars, ttl_bars=self.cfg.decision_ttl_bars,
            verdict=gate["verdict"].value, reason_codes=gate["reasons"], alpha_score=score.score,
            alpha_agreement=score.agreement, regime=sig.regime, vol_bps=sig.garch_vol_bps or sig.ewma_vol_bps,
            sizing_trace=gate["sizing_trace"], pending_hooks=pending, ts=base["ts"],
        )
        return self._finish(base, intent)

    def _finish(self, base: Dict[str, Any], intent: OrderIntent) -> Dict[str, Any]:
        base.update({"verdict": intent.verdict, "reason_codes": intent.reason_codes, "intent": intent.to_dict()})
        self.state.last_intent = intent
        self.state.journal(base)
        return base

    # -- Betrieb -------------------------------------------------------------
    def confirm_fill(self, symbol: str, action: str, qty: float, price: float) -> Dict[str, Any]:
        self.state.apply_fill(symbol.upper(), action.upper(), float(qty), float(price))
        bar_now = self.sigma.bar_for(symbol)
        self.state.portfolio.last_action_bar = bar_now
        self.state.portfolio.last_action_bars[symbol.upper()] = bar_now
        self.persist()
        return {"confirmed": True, "portfolio": asdict(self.state.portfolio)}

    def reset(self, symbol: Optional[str] = None) -> Dict[str, Any]:
        """Harte Rueckbau-Funktion fuer Alpha/Sigma-Gedaechtnis (Portfolio/Cash bleiben beim Broker)."""
        self.alpha.reset(symbol)
        if symbol is None:
            self.sigma._series.clear(); self.sigma._bar.clear(); self.sigma._garch.clear(); self.sigma._ewma_var.clear()
        else:
            sym = symbol.upper()
            self.sigma._series.pop(sym, None); self.sigma._bar.pop(sym, None)
            self.sigma._garch.pop(sym, None); self.sigma._ewma_var.pop(sym, None)
        self.persist()
        return {"reset": symbol or "ALL"}

    def check_parity(self, symbol: str, runner: Optional[Dict[str, Any]] = None,
                     params: Optional[Dict[str, Any]] = None, mark_hook: bool = True,
                     prices: Optional[List[float]] = None) -> Dict[str, Any]:
        """
        GBH-06: Runner-Zahlen dagegenhalten und das Ergebnis als Gate-Harz verwenden.

        `mark_hook=False` ist der reine Selbstvergleich (Spiegel der Bruecke): er
        prueft die Rechenpfade, aber er BELEGT nichts — ein Nachweis fuer den
        blockierenden Hook darf nur aus Zahlen des laufenden Runners kommen.
        Sonst würde sich die Engine ihre eigene Paritaet bescheinigen.
        """
        sym = symbol.upper()
        # Frische Preise im Request spaechen gegen ueber den gespeicherten Stand —
        # noetig fuer den Spiegel-Selbstvergleich ohne Seiteneffekt auf den Takt.
        series = [float(x) for x in prices if _is_finite(x)] if prices else list(self.sigma._series.get(sym, []))
        already = bool(self.parity_cache.get(sym)) or \
            (self.state.hook_state.get("GBH-06") or {}).get("status") == "IMPLEMENTED"
        if runner is None and already:
            # Ein Takt ohne frische Runner-Zahlen widerruft einen bestehenden Nachweis nicht.
            return {"parity_ok": True, "mode": "cached_evidence", "worst_delta": None,
                    "reason": "Paritaet bereits belegt (hook_state/parity_cache); keine neuen runner-werte uebermittelt",
                    "engine": self.indicators(sym, params), "hook": "GBH-06"}
        rep = sigma_parity_report(self, sym, list(series), runner=runner, params=params)
        if not mark_hook:
            rep["evidence"] = False
            rep["hook_status"] = (self.state.hook_state.get("GBH-06") or {}).get("status", "PLACEHOLDER")
            rep["note"] = "spiegel-vergleich ohne nachweiswirkung (mark_hook=false)"
            return rep
        self.parity_cache[sym] = bool(rep.get("parity_ok"))
        if rep.get("parity_ok") and self.state.hook_state.get("GBH-06", {}).get("status") != "IMPLEMENTED":
            set_hook_state(self.state, "GBH-06", "IMPLEMENTED", owner="parity-check",
                           note=f"delta={rep.get('worst_delta')} unter Toleranz {rep.get('tolerance_pct')}")
        self.persist()
        return rep

    def indicators(self, symbol: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return sigma_indicators(self.sigma._series.get(symbol.upper(), []), params, self.cfg)

    def status(self, symbol: Optional[str] = None) -> Dict[str, Any]:
        return {
            "config": {k: (list(v) if isinstance(v, tuple) else v) for k, v in asdict(self.cfg).items()
                       if k != "alpha_source_weights"},
            "alpha": self.alpha.snapshot(),
            "sigma": {"telemetry": self.sigma.telemetry(), "dfa_engine_available": _HAVE_DFA},
            "quant_backend": self.quant_bridge.status(),
            "portfolio": {
                "equity_usd": round(self.state.portfolio.equity_usd, 2),
                "available_cash_usd": round(self.state.portfolio.available_cash_usd, 2),
                "gross_exposure_pct": round(self.state.portfolio.gross_exposure_pct, 4),
                "per_symbol_exposure_pct": {k: round(v, 4) for k, v in self.state.portfolio.per_symbol_exposure_pct.items()},
                "drawdown_pct": round(self.state.portfolio.drawdown_pct, 3),
                "open_position": self.state.portfolio.open_position,
            },
            "regime_matrix": {k: [r.value for r in v] for k, v in REGIME_SOURCE_MATRIX.items()},
            "parity": dict(self.parity_cache),
            "directives": system_directive.get_system_telemetry(),
            "symbols": [symbol.upper()] if symbol else sorted(self.sigma._series.keys()),
            "last_decision": self.state.decisions[-1] if self.state.decisions else None,
            "recent_decisions": [
                {
                    "ts": d.get("ts"), "symbol": d.get("symbol"), "bar": d.get("bar"),
                    "verdict": d.get("verdict"), "reason_codes": d.get("reason_codes"),
                    "alpha_score": (d.get("alpha") or {}).get("score"),
                    "alpha_agreement": (d.get("alpha") or {}).get("agreement"),
                    "regime": (d.get("sigma") or {}).get("regime"),
                    "intent": (d.get("intent") or None) and {
                        "action": d["intent"].get("action"), "qty": d["intent"].get("qty"),
                        "notional_usd": d["intent"].get("notional_usd"),
                        "allocation_pct": d["intent"].get("allocation_pct"),
                        "stop_price": d["intent"].get("stop_price"), "target_price": d["intent"].get("target_price"),
                    },
                }
                for d in reversed(self.state.decisions[-12:])
            ],
            "decisions_24h": len([d for d in self.state.decisions if _is_today(d.get("ts"))]),
            "hooks": {"open": sum(1 for h in GROK_BOT_HOOKS
                                 if (self.state.hook_state.get(h["id"]) or {}).get("status", h["status"]) != "IMPLEMENTED"),
                      "total": len(GROK_BOT_HOOKS)},
        }


# ---------------------------------------------------------------------------
# 7. SIGMA-PARITAET ZUM RUNNER (GBH-06)
# ---------------------------------------------------------------------------
#
# Die handelnden Skripte (data/strategy-manifest.json, Strategie-Familie
# "Sigma_*") kennen genau diese Formeln. Der Orchestrator MUSS dieselben
# Zahlen sehen, sonst entscheidet eine andere Realitaet als die, welche
# ausfuehrt. Diese Funktionen sind deshalb bewusste 1:1-Nachbauten.
# >>> GROK-BOT [GBH-06] >>>
#   Der Bot ersetzt diese Nachbauten NICHT, sondern belegt die Paritaet
#   laufend (test unten) und meldet Abweichungen > 2 % als Incident.
#   Solange GBH-06 nicht IMPLEMENTED gemeldet ist, bleiben Antraege blocked.
# <<< GROK-BOT [GBH-06] <<<

def sigma_sma(a: List[float], n: int) -> float:
    n = max(2, min(int(n), len(a)))
    if len(a) < n:
        return float("nan")
    return sum(a[-n:]) / n


def sigma_ema(a: List[float], n: int) -> float:
    n = max(2, int(n))
    if len(a) < n:
        return float("nan")
    e = sum(a[:n]) / n
    k = 2.0 / (n + 1)
    for x in a[n:]:
        e = x * k + e * (1 - k)
    return e


def sigma_stdev(a: List[float], n: int) -> float:
    """Populations-Stdev ueber das letzte Fenster — identisch zu `stdev()` im Runner."""
    n = max(2, min(int(n), len(a)))
    if len(a) < n:
        return float("nan")
    m = sigma_sma(a, n)
    return math.sqrt(sum((x - m) ** 2 for x in a[-n:]) / n)


def sigma_atr(a: List[float], n: int) -> float:
    """atrProxy(): Mittelwert der |Differenzen| im Fenster (preisbasiert, kein OHLCV)."""
    n = max(2, min(int(n), len(a)))
    if len(a) < n + 1:
        return float("nan")
    d = [abs(a[i] - a[i - 1]) for i in range(len(a) - n, len(a))]
    return sum(d) / len(d)


def sigma_hurst_rs(a: List[float], n: int) -> float:
    """hurstRs() aus dem Runner — R/S ueber Log-Renditen, Klemme [0, 1]."""
    r = [math.log(a[i] / a[i - 1]) for i in range(1, len(a)) if a[i] > 0 and a[i - 1] > 0]
    n = min(int(n), len(r))
    if n < 20:
        return float("nan")
    w = r[-n:]
    mean = sum(w) / n
    cum = hi = lo = 0.0
    ss = 0.0
    for x in w:
        cum += x - mean
        hi, lo = max(hi, cum), min(lo, cum)
        ss += (x - mean) ** 2
    sd = math.sqrt(ss / n)
    rs = (hi - lo) / sd if sd > 0 else 0.0
    if rs <= 0:
        return 0.5
    return max(0.0, min(1.0, math.log(rs) / math.log(n)))


def sigma_zone_score(a: List[float], lookback: int, side: str, atr_value: float) -> float:
    """priceZoneScore(): Preis-Zonen-/MOS-Proxy als Pivot-Reaktions-Score (0..10)."""
    n = min(int(lookback), len(a) - 2)
    if n < 10:
        return 0.0
    w = a[-n:]
    last = w[-1]
    tol = max((atr_value if _is_finite(atr_value) else 0.0) * 1.5, last * 0.001)
    score = touches = 0.0
    for i in range(2, len(w) - 2):
        local = (w[i] <= w[i - 1] and w[i] <= w[i + 1]) if side == "support" else (w[i] >= w[i - 1] and w[i] >= w[i + 1])
        if not local:
            continue
        dist = abs(last - w[i])
        if dist <= tol:
            touches += 1
            score += max(0.0, 1.0 - dist / tol)
    return min(10.0, touches * 1.4 + score * 1.2)


def sigma_indicators(prices: List[float], params: Optional[Dict[str, Any]] = None,
                     cfg: Optional[OrchestratorConfig] = None) -> Dict[str, Any]:
    """Alle Runner-Indikatoren auf einmal — die Quelle fuer Paritaetstests und Auto-Votes."""
    cfg = cfg or DEFAULT_CONFIG
    p = params or {}
    series = [float(x) for x in (prices or []) if _is_finite(x)]
    if not series:
        return {"ok": False, "reason": "keine preise"}
    atr_look = int(p.get("atrLookback", cfg.sigma_atr_lookback))
    mr_look = int(p.get("meanReversionLookback", cfg.sigma_z_lookback))
    fast_p = int(p.get("fastEma", cfg.sigma_fast_ema))
    slow_p = int(p.get("slowEma", cfg.sigma_slow_ema))
    brk = int(p.get("breakoutLookback", cfg.sigma_breakout_lookback))
    hurst_look = int(p.get("hurstLookback", cfg.sigma_hurst_lookback))
    mos_look = int(p.get("mosLookback", cfg.sigma_mos_lookback))

    price = series[-1]
    atr = sigma_atr(series, atr_look)
    basis = sigma_sma(series, mr_look)
    sd = sigma_stdev(series, mr_look)
    z = (price - basis) / sd if _is_finite(sd) and sd > 0 else 0.0
    fast = sigma_ema(series, fast_p)
    slow = sigma_ema(series, slow_p)
    prev = series[-2] if len(series) >= 2 else price
    window = series[-brk - 1:-1]
    upper = max(window) if window else float("nan")
    lower = min(window) if window else float("nan")
    h = sigma_hurst_rs(series, hurst_look)
    if not _is_finite(h):
        h = SigmaSubsystem._hurst_rs(series)          # Fallback, nie NaN im Takt
    trend_gate = float(p.get("hurstTrend", cfg.sigma_hurst_trend_gate))
    mean_gate = float(p.get("hurstMeanReversion", cfg.sigma_hurst_meanrev_gate))
    trend_regime = h > trend_gate
    mean_regime = h < mean_gate
    support = sigma_zone_score(series, mos_look, "support", atr)
    resistance = sigma_zone_score(series, mos_look, "resistance", atr)
    raw = {
        "basis": basis, "sigma": sd, "z_score": z, "atr": atr, "hurst": h,
        "ema_fast": fast, "ema_slow": slow, "breakout_upper": upper, "breakout_lower": lower,
        "support_score": support, "resistance_score": resistance, "price": price,
    }
    return {
        "ok": True,
        "price": round(price, 8), "bars": len(series),
        "basis": None if not _is_finite(basis) else round(basis, 8),
        "sigma": None if not _is_finite(sd) else round(sd, 8),
        "z_score": round(z, 6), "atr": None if not _is_finite(atr) else round(atr, 8),
        "ema_fast": None if not _is_finite(fast) else round(fast, 8),
        "ema_slow": None if not _is_finite(slow) else round(slow, 8),
        "breakout_upper": None if not _is_finite(upper) else round(upper, 8),
        "breakout_lower": None if not _is_finite(lower) else round(lower, 8),
        "hurst": round(h, 6),
        "trend_regime": bool(trend_regime), "mean_reversion_regime": bool(mean_regime),
        "random_walk": bool(not trend_regime and not mean_regime),
        "support_score": round(support, 6), "resistance_score": round(resistance, 6),
        "raw": {k: (None if not _is_finite(v) else float(v)) for k, v in raw.items()},
        "signals": {
            "trend_long": bool(trend_regime and _is_finite(fast) and _is_finite(slow) and fast > slow and price > upper),
            "trend_short": bool(trend_regime and _is_finite(fast) and _is_finite(slow) and fast < slow and price < lower),
            "mr_long": bool(mean_regime and prev <= basis and price > basis and z < 1.5),
            "mr_short": bool(mean_regime and prev >= basis and price < basis and z > -1.5),
        },
    }


def sigma_parity_report(orch: "AlphaSigmaOrchestrator", symbol: str, prices: List[float],
                        runner: Optional[Dict[str, Any]] = None, params: Optional[Dict[str, Any]] = None,
                        tolerance_pct: float = 0.02) -> Dict[str, Any]:
    """
    Vergleich Engine-Indikatoren gegen die vom Runner gemeldeten Werte.
    `runner` ist das, was der Bot/das Skript als eigene Berechnung zurueckgibt
    (POST /api/orchestrator/parity). Ohne Runner-Werte gilt Paritaet als
    "nicht belegt" — genau das soll GBH-06 durch den Bot erledigen.
    """
    eng = sigma_indicators(prices, params, orch.cfg)
    if not eng.get("ok"):
        return {"parity_ok": False, "reason": "zu wenige daten", "engine": eng, "delta": {}}
    if not runner:
        return {
            "parity_ok": False, "reason": "keine runner-werte uebermittelt (GBH-06 offen)",
            "engine": eng, "delta": {},
            "expected_runner_keys": ["basis", "sigma", "z_score", "atr", "hurst",
                                     "ema_fast", "ema_slow", "breakout_upper", "breakout_lower",
                                     "support_score", "resistance_score"],
        }
    delta: Dict[str, Dict[str, float]] = {}
    worst = 0.0
    eng_cmp = dict(eng.get("raw") or {}) or eng
    for key in ("basis", "sigma", "z_score", "atr", "hurst", "ema_fast", "ema_slow",
                "breakout_upper", "breakout_lower", "support_score", "resistance_score"):
        a, b = eng_cmp.get(key, eng.get(key)), runner.get(key)
        if not _is_finite(a) or not _is_finite(b):
            delta[key] = {"engine": a, "runner": b, "rel": None, "status": "unavailable"}
            continue
        denom = max(abs(float(a)), 1e-9)
        rel = abs(float(a) - float(b)) / denom
        # absolute Toleranz fuer z/Hurst (kleine Nenner)
        if key in ("z_score", "hurst"):
            rel = abs(float(a) - float(b))
        delta[key] = {"engine": a, "runner": b, "rel": round(rel, 6),
                      "status": "ok" if rel <= (tolerance_pct if key not in ("z_score", "hurst") else 0.05) else "drift"}
        worst = max(worst, rel)
    return {"parity_ok": worst <= tolerance_pct or all(v["status"] in ("ok", "unavailable") for v in delta.values()),
            "worst_delta": round(worst, 6), "delta": delta, "engine": eng,
            "tolerance_pct": tolerance_pct,
            "hook": "GBH-06"}


def _is_finite(v: Any) -> bool:
    try:
        return v is not None and math.isfinite(float(v))
    except (TypeError, ValueError):
        return False


def _is_today(ts: Any) -> bool:
    try:
        return str(ts)[:10] == datetime.now(timezone.utc).isoformat()[:10]
    except Exception:
        return False


# Global Singleton — der Orchestrator ist ein einzelner Takt pro Prozess.
alpha_sigma_orchestrator = AlphaSigmaOrchestrator()
