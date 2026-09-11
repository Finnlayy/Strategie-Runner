"""
Tests fuer die ALPHA/SIGMA-Orchestrator-Engine (Modul 19).

Zwei Testfamilien, absichtlich getrennt:

  1. Test*  — muessen gruen sein. Sie sichern die Mechanik der Kammern:
     Sigma-Mathematik (Runner-Paritaet), Gates, Caps, Journal, Hook-Registry.

  2. TestGrokBotHooks — als @unittest.expectedFailure markierte Faelle.
     Sie pruefen die VERSPROCHENEN Endzustaende der Grok-Bot-Uebernahme
     (GBH-01..GBH-10). Die Engine laeuft bis dahin mit dokumentiertem
     Heuristik-Fallback, deshalb sind diese Tests rot — und das ist der
     vereinbarte Zustand: rot + markiert + abarbeitbar, nicht gruen + leer.
     Sobald der Grok-Bot einen Hook per
         POST /api/orchestrator/hooks/{GBH-xx}/resolution {status:"IMPLEMENTED"}
     liefert und die passende Implementierung standhaelt, schlaegt der
     betreffende Fall auf "unexpected pass" um und kann von expectedFailure
     befreit werden.

Ausfuehren:  python3 tests/test_alpha_sigma_orchestrator.py   (nur Standardbibliothek)
             npm run test:orchestrator
"""

import json
import math
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.orchestrator.alpha_sigma_engine import (  # noqa: E402
    AlphaSigmaOrchestrator,
    AlphaVote,
    GROK_BOT_HOOKS,
    OrchestratorConfig,
    PortfolioState,
    REGIME_SOURCE_MATRIX,
    RejectReason,
    Regime,
    Verdict,
    hook_worklist,
    set_hook_state,
    sigma_atr,
    sigma_hurst_rs,
    sigma_indicators,
    sigma_parity_report,
    sigma_sma,
    sigma_stdev,
    set_hook_state,
    sigma_zone_score,
)

HERE = Path(__file__).resolve().parent


def make_cfg(tmp: str, **over) -> OrchestratorConfig:
    base = dict(
        state_file=f"{tmp}/ors_state.json",
        journal_file=f"{tmp}/decisions.jsonl",
        hook_state_file=f"{tmp}/hook_state.json",
    )
    base.update(over)
    return OrchestratorConfig(**base)


def new_orchestrator(**over) -> AlphaSigmaOrchestrator:
    tmp = tempfile.mkdtemp()
    cfg = make_cfg(tmp, **over)
    o = AlphaSigmaOrchestrator(cfg)
    o.state.portfolio.equity_usd = 10_000.0
    o.state.portfolio.available_cash_usd = 10_000.0
    o.state.portfolio.best_equity_usd = 10_000.0
    return o


def trend_series(n: int = 140, start: float = 64_000.0) -> list:
    """Deterministische Trendreihe mit Rauschen — gleicher Quelltext wie im Paritaets-Fixtur-Run."""
    import random

    random.seed(11)
    out, x = [], start
    for i in range(n):
        x *= 1 + (0.0022 if 40 < i < 110 else -0.001) + random.uniform(-0.004, 0.004)
        out.append(round(x, 2))
    return out


def meanrev_series(n: int = 200, base: float = 100.0) -> list:
    """Anti-peristente Zickzack-Reihe -> kleiner Hurst, saubere Mean-Reversion-Lage."""
    out, x = [], base
    for i in range(n):
        x *= 1 + (0.006 if i % 2 == 0 else -0.0062)
        out.append(round(x, 6))
    return out


# ---------------------------------------------------------------------------
# 1. SIGMA-Mathematik: Runner-Paritaet (GBH-06 Nachweisseite)
# ---------------------------------------------------------------------------

# Referenzwerte, erzeugt mit den Funktionen des Sigma-Runner-Skripts
# (data/strategy-manifest.json, Strategie "New Trading Strategy"/Sigma BTCUSDT
# Runner Strategy) auf derselben Preisreihe. Wer die Runner-Formeln aendert,
# muss diese Fixtur nachziehen — sonst ist die Paritaet gebrochen.
PARITY_FIXTURE = {
    "price": 67762.47,
    "basis": 68837.486,
    "sigma": 539.5107283400413,
    "z_score": -1.9925757608335182,
    "atr": 164.14642857142982,
    "ema_fast": 68688.03648932661,
    "ema_slow": 68443.6262822727,
    "breakout_upper": 69791.94,
    "breakout_lower": 67955.9,
    "hurst": 0.7017385301652939,
    "support_score": 3.961008681273257,
    "resistance_score": 2.45437392571961,
}


class TestSigmaIndicators(unittest.TestCase):
    def setUp(self):
        self.prices = trend_series()
        self.ind = sigma_indicators(self.prices)

    def test_runner_parity_z_atr_hurst(self):
        for key in ("basis", "sigma", "z_score", "atr", "hurst", "ema_fast", "ema_slow",
                    "breakout_upper", "breakout_lower", "support_score", "resistance_score"):
            self.assertIn(key, self.ind, key)
            self.assertAlmostEqual(self.ind["raw"][key], PARITY_FIXTURE[key], places=6, msg=key)

    def test_sma_stdev_population_definition(self):
        a = [1.0, 2.0, 3.0, 4.0]
        self.assertAlmostEqual(sigma_sma(a, 4), 2.5)
        self.assertAlmostEqual(sigma_stdev(a, 4), math.sqrt(1.25))   # Division durch n, nicht n-1
        self.assertAlmostEqual(sigma_atr(a, 3), (1.0 + 1.0 + 1.0) / 3)

    def test_hurst_bounds_and_short_series(self):
        self.assertTrue(math.isnan(sigma_hurst_rs([1.0, 1.001] * 5, 100)))
        h = sigma_hurst_rs(meanrev_series(240, 100.0), 200)
        self.assertLess(h, 0.55)

    def test_zone_score_zero_without_structure(self):
        mono = [100.0 + i for i in range(80)]
        self.assertEqual(sigma_zone_score(mono, 60, "support", 1.0), 0.0)

    def test_empty_series_not_ok(self):
        self.assertFalse(sigma_indicators([]).get("ok"))

    def test_parity_report_flags_drift(self):
        o = new_orchestrator()
        o.ingest("BTC/USD", prices=self.prices)
        rep = sigma_parity_report(o, "BTC/USD", self.prices, runner={**PARITY_FIXTURE, "hurst": 0.10})
        self.assertFalse(rep["parity_ok"])
        self.assertEqual(rep["delta"]["hurst"]["status"], "drift")

    def test_parity_report_without_runner_values_is_not_proven(self):
        o = new_orchestrator()
        o.ingest("BTC/USD", prices=self.prices)
        rep = sigma_parity_report(o, "BTC/USD", self.prices, runner=None)
        self.assertFalse(rep["parity_ok"])
        self.assertIn("GBH-06", rep["reason"])

    def test_regime_labels_from_hurst(self):
        o = new_orchestrator()
        o.ingest("BTC/USD", prices=self.prices)
        snap = o.sigma.snapshot("BTC/USD")
        self.assertIn(snap.regime, {r.value for r in Regime})
        self.assertGreater(snap.bars, 100)


# ---------------------------------------------------------------------------
# 2. ALPHA-Kammer: Antragslage
# ---------------------------------------------------------------------------

class TestAlphaChamber(unittest.TestCase):
    def setUp(self):
        self.o = new_orchestrator()
        self.o.ingest("BTC/USD", prices=trend_series())

    def test_vote_normalization(self):
        v = AlphaVote(source=" Grok_Trader ", symbol="btc/usd", direction=5, strength=9,
                      confidence=-3).normalized()
        self.assertEqual(v.source, "grok_trader")
        self.assertEqual(v.symbol, "BTC/USD")
        self.assertEqual(v.direction, 1)
        self.assertEqual(v.strength, 1.0)
        self.assertEqual(v.confidence, 0.0)

    def test_directionless_votes_are_dropped(self):
        out = self.o.submit_votes([{"source": "grok_trader", "symbol": "BTC/USD", "direction": 0, "strength": 0.9}])
        self.assertFalse(out[0]["recorded"])

    def test_only_latest_vote_per_source_counts(self):
        for _ in range(4):
            self.o.submit_votes([{"source": "grok_trader", "symbol": "BTC/USD", "direction": 1, "strength": 0.9}])
        self.assertEqual(len(self.o.alpha._votes["BTC/USD"]), 1)

    def test_aging_reduces_and_staleness_excludes(self):
        self.o.submit_votes([{"source": "grok_trader", "symbol": "BTC/USD", "direction": 1,
                              "strength": 0.8, "confidence": 0.8, "bar_index": 0}])
        now = self.o.sigma.bar_for("BTC/USD")
        fresh = self.o.alpha.score("BTC/USD", now)
        aged = self.o.alpha.score("BTC/USD", now + int(self.cfg_alpha_half_life(self.o)))
        self.assertLess(abs(aged.score), abs(fresh.score) + 1e-9)
        dead = self.o.alpha.score("BTC/USD", now + self.o.cfg.alpha_max_age_bars + 5)
        self.assertIn("grok_trader", dead.stale_sources)
        self.assertEqual(dead.score, 0.0)

    @staticmethod
    def cfg_alpha_half_life(o):
        return max(1, int(o.cfg.alpha_half_life_bars))

    def test_regime_matrix_blocks_incompatible_source(self):
        now = self.o.sigma.bar_for("BTC/USD")
        self.o.submit_votes([{"source": "sigma_mean_reversion", "symbol": "BTC/USD", "direction": 1,
                              "strength": 0.9, "bar_index": now}])
        sc = self.o.alpha.score("BTC/USD", now, regime=Regime.MOMENTUM_TREND)
        self.assertIn("sigma_mean_reversion", sc.blocked_by_regime)
        self.assertEqual(sc.score, 0.0)

    def test_conflicting_votes_lower_agreement(self):
        self.o.submit_votes([
            {"source": "grok_trader", "symbol": "BTC/USD", "direction": 1, "strength": 0.9, "confidence": 0.9},
            {"source": "sigma_momentum", "symbol": "BTC/USD", "direction": -1, "strength": 0.9, "confidence": 0.9},
        ])
        sc = self.o.alpha.score("BTC/USD", self.o.sigma.bar_for("BTC/USD"), regime=None)
        self.assertLess(sc.agreement, 0.5)

    def test_ic_adaptation_moves_weights(self):
        src = "grok_trader"
        before = self.o.alpha.score("BTC/USD", 0).score
        self.o.submit_votes([{"source": src, "symbol": "BTC/USD", "direction": 1, "strength": 0.7,
                              "confidence": 0.7, "horizon_bars": 1}])
        self.o.alpha.observe_outcome("BTC/USD", self.o.sigma.bar_for("BTC/USD") + 1, 0.02)   # Quelle hatte recht
        self.assertGreater(self.o.alpha._ic[src], 0.0)
        self.assertGreaterEqual(abs(self.o.alpha.score("BTC/USD", 0).score), 0.0)
        self.assertIsInstance(before, float)


# ---------------------------------------------------------------------------
# 3. SIGMA-Kammer: Gates & Sizing
# ---------------------------------------------------------------------------

class TestSigmaGates(unittest.TestCase):
    def setUp(self):
        self.o = new_orchestrator()
        self.prices = trend_series()
        self.o.ingest("BTC/USD", prices=self.prices)
        self.sig = self.o.sigma.snapshot("BTC/USD")

    def _score(self, direction=1, agreement=0.9):
        from app.orchestrator.alpha_sigma_engine import AlphaScore

        return AlphaScore(symbol="BTC/USD", score=0.6 * direction, direction=direction,
                          agreement=agreement, magnitude=0.7, effective_sources=2, as_of_bar=5)

    def _bare(self, sig):
        """Sigma-Snapshot ohne Struktur-Gates — fuer Isolation eines einzelnen Gates."""
        import copy

        clone = copy.copy(sig)
        clone.structure = None
        return clone

    def test_vol_target_scales_size_down(self):
        g1 = self.o.sigma.gate(self._score(), self._bare(self.sig), self.o.state.portfolio, 0.25, None, None)
        high_vol = self._bare(self.o.sigma.snapshot("BTC/USD"))
        high_vol.realized_vol_ann = 1.9
        g2 = self.o.sigma.gate(self._score(), high_vol, self.o.state.portfolio, 0.25, None, None)
        self.assertGreater(g1["alloc_pct"], 0.0)
        self.assertLess(g2["alloc_pct"], g1["alloc_pct"])

    def test_structure_gate_blocks_mos_unconfirmed(self):
        g = self.o.sigma.gate(self._score(direction=1), self.sig, self.o.state.portfolio, 0.25, None, None)
        self.assertIn(RejectReason.MOS_ZONE_UNCONFIRMED.value, g["reasons"])

    def test_gross_exposure_cap_blocks(self):
        pf = PortfolioState(equity_usd=10_000, available_cash_usd=10_000, gross_exposure_pct=0.9)
        g = self.o.sigma.gate(self._score(), self.sig, pf, 0.25, None, None)
        self.assertIn(RejectReason.EXPOSURE_CAP.value, g["reasons"])

    def test_spread_and_slippage_gates(self):
        wide = self.o.sigma.gate(self._score(), self.sig, self.o.state.portfolio, 0.25, 60.0, None)
        self.assertIn(RejectReason.SPREAD_TOO_WIDE.value, wide["reasons"])
        slip = self.o.sigma.gate(self._score(), self.sig, self.o.state.portfolio, 0.25, None, 90.0)
        self.assertIn(RejectReason.SLIPPAGE_CEILING.value, slip["reasons"])

    def test_drawdown_dampener_reduces_alloc(self):
        flat = self.o.sigma.gate(self._score(), self.sig, self.o.state.portfolio, 0.25, None, None)
        dd_pf = PortfolioState(equity_usd=9_000, available_cash_usd=9_000, drawdown_pct=18.0)
        dd = self.o.sigma.gate(self._score(), self.sig, dd_pf, 0.25, None, None)
        self.assertLess(dd["sizing_trace"]["drawdown_dampener"],
                        flat["sizing_trace"]["drawdown_dampener"])

    def test_cash_can_never_be_overshot(self):
        pf = PortfolioState(equity_usd=10_000, available_cash_usd=100.0)
        g = self.o.sigma.gate(self._score(), self.sig, pf, 0.25, None, None)
        if g["verdict"] is not Verdict.REJECTED:
            self.assertLessEqual(g["qty"] * self.sig.price, 100.0 * 1.0001)

    def test_min_ticket_rejects_dust(self):
        tiny = self.o.cfg.sigma_min_ticket_usd * 0.5
        pf = PortfolioState(equity_usd=20.0, available_cash_usd=20.0)
        g = self.o.sigma.gate(self._score(), self.sig, pf, 0.25, None, None)
        self.assertIn(RejectReason.MIN_TICKET_UNMET.value, g["reasons"])
        self.assertLess(tiny, 1e9)

    def test_missing_state_rejects(self):
        o2 = new_orchestrator()
        o2.ingest("XRP/USD", prices=[1.0, 1.01])
        g = o2.sigma.gate(self._score(), o2.sigma.snapshot("XRP/USD"), o2.state.portfolio, 0.25, None, None)
        self.assertEqual(g["reasons"], [RejectReason.SIGMA_STATE_MISSING.value])

    def test_circuit_breaker_blocks(self):
        from app.core.directives import CircuitBreakerStatus, SystemOperationalMode, system_directive

        try:
            system_directive.trip_circuit_breaker(CircuitBreakerStatus.TRIPPED_DRAWDOWN, "test: orchestrator gate")
            g = self.o.sigma.gate(self._score(), self.sig, self.o.state.portfolio, 0.25, None, None)
            self.assertIn(RejectReason.CIRCUIT_BREAKER.value, g["reasons"])
            self.assertIn(RejectReason.DIRECTIVE_MODE_BLOCKED.value, g["reasons"])  # EMERGENCY_HALT
        finally:
            system_directive.reset_circuit_breaker("test-suite")
            system_directive._mode = SystemOperationalMode.SHADOW_ACTIVE
        ok = self.o.sigma.gate(self._score(), self.sig, self.o.state.portfolio, 0.25, None, None)
        self.assertNotIn(RejectReason.CIRCUIT_BREAKER.value, ok["reasons"])


# ---------------------------------------------------------------------------
# 4. Arbitrierung, Hooks, Journal
# ---------------------------------------------------------------------------

class TestArbitration(unittest.TestCase):
    def test_blocking_hook_freezes_entries(self):
        o = new_orchestrator()
        o.ingest("BTC/USD", prices=trend_series())
        o.submit_votes([{"source": "grok_trader", "symbol": "BTC/USD", "direction": 1,
                         "strength": 0.95, "confidence": 0.95, "bar_index": o.sigma.bar_for("BTC/USD")}])
        d = o.decide("BTC/USD")
        self.assertEqual(d["verdict"], Verdict.REJECTED.value)
        self.assertIn(RejectReason.HOOK_UNCLAIMED_BLOCKING.value, d["reason_codes"])
        self.assertIn("GBH-06", d["blocking_hooks"])
        self.assertIsNone(d.get("intent"))

    def test_mos_zone_gate_must_be_confirmed_for_longs(self):
        o = new_orchestrator()
        o.ingest("BTC/USD", prices=trend_series())
        bar = o.sigma.bar_for("BTC/USD")
        o.submit_votes([{"source": "grok_trader", "symbol": "BTC/USD", "direction": 1, "strength": 0.9,
                         "confidence": 0.9, "bar_index": bar}])
        o.check_parity("BTC/USD", PARITY_FIXTURE)
        d = o.decide("BTC/USD")
        self.assertEqual(d["verdict"], Verdict.REJECTED.value)
        self.assertIn(RejectReason.MOS_ZONE_UNCONFIRMED.value, d["reason_codes"])

    def test_parity_evidence_unblocks_and_marks_hook(self):
        o = new_orchestrator(sigma_mos_only_strong=False)
        prices = trend_series()
        o.ingest("BTC/USD", prices=prices)
        o.submit_votes([{"source": "grok_trader", "symbol": "BTC/USD", "direction": 1,
                         "strength": 0.95, "confidence": 0.95, "bar_index": o.sigma.bar_for("BTC/USD")}])
        o.cfg.sigma_mos_only_strong = False
        rep = o.check_parity("BTC/USD", PARITY_FIXTURE)
        self.assertTrue(rep["parity_ok"])
        self.assertEqual(o.state.hook_state["GBH-06"]["status"], "IMPLEMENTED")
        d = o.decide("BTC/USD")
        self.assertNotIn(RejectReason.HOOK_UNCLAIMED_BLOCKING.value, d.get("reason_codes") or [])
        self.assertIn(d["verdict"], (Verdict.APPROVED.value, Verdict.SIZED_DOWN.value))
        intent = d["intent"]
        self.assertLessEqual(intent["allocation_pct"], o.cfg.sigma_max_alloc_pct + 1e-9)
        self.assertLess(intent["stop_price"], intent["limit_price_hint"])       # Long: Stop darunter
        self.assertGreater(intent["target_price"], intent["limit_price_hint"])  # Long: Ziel darüber

    def test_decide_without_market_data_does_not_crash(self):
        """Duennes Datenfundament darf keinen KeyError erzeugen, sondern nur eine Ablehnung."""
        o = new_orchestrator()
        set_hook_state(o.state, "GBH-06", "IMPLEMENTED", owner="test", note="Paritaet hier irrelevant")
        o.submit_votes([{"source": "grok_trader", "symbol": "ADA/USD", "direction": 1,
                         "strength": 0.9, "confidence": 0.9}])
        o.submit_grok_signal("ADA/USD", {"action": "BUY", "confidence_score": 0.9})
        d = o.decide("ADA/USD")
        self.assertEqual(d["verdict"], Verdict.REJECTED.value)
        self.assertIn(RejectReason.SIGMA_STATE_MISSING.value, d["reason_codes"])
        self.assertIsNone(d.get("intent"))

    def test_no_intent_below_threshold(self):
        o = new_orchestrator()
        o.ingest("BTC/USD", prices=trend_series())
        d = o.decide("BTC/USD")
        self.assertEqual(d["verdict"], Verdict.NO_INTENT.value)
        self.assertEqual(d["reason_codes"], [RejectReason.ALPHA_BELOW_THRESHOLD.value])

    def test_disagreement_is_rejected_not_silently_sized(self):
        o = new_orchestrator()
        o.ingest("BTC/USD", prices=trend_series())
        bar = o.sigma.bar_for("BTC/USD")
        o.submit_votes([
            {"source": "grok_trader", "symbol": "BTC/USD", "direction": 1, "strength": 0.9, "confidence": 0.9, "bar_index": bar},
            {"source": "sigma_momentum", "symbol": "BTC/USD", "direction": -1, "strength": 0.9, "confidence": 0.9, "bar_index": bar},
        ])
        d = o.decide("BTC/USD")
        self.assertIn(d["verdict"], (Verdict.REJECTED.value, Verdict.NO_INTENT.value))

    def test_exit_first_on_stop_hit(self):
        o = new_orchestrator()
        o.ingest("BTC/USD", prices=trend_series())
        sig = o.sigma.snapshot("BTC/USD")
        o.state.portfolio.open_position = {"side": "LONG", "qty": 0.5, "entry_price": sig.price * 1.05,
                                           "stop_price": sig.price * 1.01, "bars_in_trade": 3}
        d = o.decide("BTC/USD")
        self.assertEqual(d["verdict"], Verdict.APPROVED.value)
        self.assertEqual(d["intent"]["action"], "FLATTEN")
        self.assertIn("STOP_LOSS_TRIGGERED", d["intent"]["reason_codes"])

    def test_grok_signal_is_normalized_into_votes(self):
        o = new_orchestrator()
        o.ingest("XRP/USD", prices=[2.0 - i * 0.002 for i in range(160)])
        out = o.submit_grok_signal("XRP/USD", {
            "action": "SELL", "confidence_score": 0.8, "allocation_percentage": 0.9,
            "bull_conviction": 0.2, "bear_conviction": 0.9, "sentiment_score": -0.6,
            "rationale": "Test", "stop_loss_pct": 2.0, "time_horizon_bars": 6,
        })
        self.assertGreaterEqual(out["votes_submitted"], 2)
        votes = o.alpha._votes["XRP/USD"]
        trader = [v for v in votes if v.source == "grok_trader"][0]
        self.assertEqual(trader.direction, -1)
        self.assertAlmostEqual(trader.meta["requested_alloc_pct"], 0.9)
        # Die angefragte Menge darf bleiben, aber Sigma kappt — Pruefung im naechsten Test.
        d = o.decide("XRP/USD")
        intent = d.get("intent") or {}
        if intent:
            self.assertLessEqual(intent["allocation_pct"], o.cfg.sigma_max_alloc_pct + 1e-9)

    def test_hold_signal_produces_no_vote(self):
        o = new_orchestrator()
        out = o.submit_grok_signal("BTC/USD", {"action": "HOLD", "confidence_score": 0.9})
        self.assertEqual(out["votes_submitted"], 0)

    def test_proven_parity_survives_a_cycle_without_runner_values(self):
        """Ein Takt ohne frische Runner-Zahlen darf einen bestehenden Nachweis nicht widerrufen."""
        o = new_orchestrator()
        o.ingest("BTC/USD", prices=trend_series())
        self.assertFalse(o.check_parity("BTC/USD", None)["parity_ok"])       # erst: nicht belegt
        self.assertTrue(o.check_parity("BTC/USD", PARITY_FIXTURE)["parity_ok"])
        rep = o.check_parity("BTC/USD", None)
        self.assertTrue(rep["parity_ok"])
        self.assertEqual(rep["mode"], "cached_evidence")

    def test_structure_vote_confirms_runner_entry_direction(self):
        """Der Tiebreak der Antragskammer widerspricht dem Runner-Signal nicht."""
        o = new_orchestrator()
        import json as _json
        import random as _rnd
        _rnd.seed(5)
        prices, x = [], 100.0
        for i in range(220):
            x = 100 + (2.5 if i % 2 else 0) + 0.006 * i + (0.9 if i > 205 else 0)
            prices.append(round(x, 6))
        res = o.derive_runner_votes("BTC/USD", prices=prices)
        dirs = {v["source"]: v["direction"] for v in res["votes"]}
        self.assertTrue(res["derived"])
        if "sigma_mean_reversion" in dirs and "ampel_structure" in dirs:
            self.assertEqual(dirs["sigma_mean_reversion"], dirs["ampel_structure"])

    def test_cooldown_is_per_symbol_and_clock_restart_tolerant(self):
        o = new_orchestrator()
        set_hook_state(o.state, "GBH-06", "IMPLEMENTED", note="test")
        o.cfg.sigma_mos_only_strong = False
        o.ingest("BTC/USD", prices=trend_series())
        o.ingest("ETH/USD", prices=trend_series(140, 3000.0))
        votes = [{"source": "grok_trader", "symbol": s, "direction": 1, "strength": 0.9,
                  "confidence": 0.9, "bar_index": o.sigma.bar_for(s)} for s in ("BTC/USD", "ETH/USD")]
        o.submit_votes(votes)
        d1 = o.decide("BTC/USD")
        assert d1.get("intent"), d1.get("reason_codes")
        o.confirm_fill("BTC/USD", d1["intent"]["action"], d1["intent"]["qty"], d1["intent"]["limit_price_hint"])
        # BTC ist im Cooldown, ETH nicht — Kappen wirken je Symbol, nicht global.
        dbtc = o.decide("BTC/USD")
        deth = o.decide("ETH/USD")
        self.assertIn(RejectReason.COOLDOWN_ACTIVE.value, dbtc["reason_codes"])
        self.assertNotIn(RejectReason.COOLDOWN_ACTIVE.value, deth.get("reason_codes") or [])
        # series neu eingespielt (Takt laeuft zurueck) -> kein Straf-Cooldown
        o.reset("BTC/USD")
        o.ingest("BTC/USD", prices=trend_series(60))
        o.cfg.sigma_cooldown_bars = 5
        d3 = o.decide("BTC/USD")
        self.assertNotIn(RejectReason.COOLDOWN_ACTIVE.value, d3.get("reason_codes") or [])

    def test_mirror_check_never_books_the_hook(self):
        """Ein Selbstvergleich ohne Runner-Beleg darf GBH-06 nicht erfuellen."""
        o = new_orchestrator()
        o.ingest("BTC/USD", prices=trend_series())
        o.submit_votes([{"source": "grok_trader", "symbol": "BTC/USD", "direction": 1, "strength": 0.95,
                         "confidence": 0.95, "bar_index": o.sigma.bar_for("BTC/USD")}])
        rep = o.check_parity("BTC/USD", PARITY_FIXTURE, mark_hook=False)
        self.assertTrue(rep["parity_ok"])
        self.assertFalse(rep["evidence"])
        self.assertNotIn("GBH-06", o.state.hook_state)
        self.assertIsNone(o.parity_cache.get("BTC/USD"))
        d = o.decide("BTC/USD")
        self.assertIn(RejectReason.HOOK_UNCLAIMED_BLOCKING.value, d["reason_codes"])

    def test_journal_is_written_with_schema(self):
        o = new_orchestrator()
        o.ingest("BTC/USD", prices=trend_series())
        o.decide("BTC/USD")
        lines = Path(o.cfg.journal_file).read_text(encoding="utf-8").strip().splitlines()
        self.assertTrue(lines)
        rec = json.loads(lines[-1])
        self.assertEqual(rec["schema"], "ors-decision/1")
        self.assertIn("verdict", rec)

    def test_state_survives_process_restart(self):
        o = new_orchestrator()
        prices = trend_series()
        o.ingest("BTC/USD", prices=prices)
        o.submit_votes([{"source": "grok_trader", "symbol": "BTC/USD", "direction": 1, "strength": 0.8,
                         "confidence": 0.8, "bar_index": o.sigma.bar_for("BTC/USD")}])
        o.persist()
        o2 = AlphaSigmaOrchestrator(o.cfg)
        self.assertEqual(o2.sigma.snapshot("BTC/USD").bars, len(prices))
        self.assertEqual(len(o2.alpha._votes.get("BTC/USD", [])), 1)

    def test_env_overrides_are_typed(self):
        from app.orchestrator.alpha_sigma_engine import _env_overrides

        os.environ["ORS_SIGMA_MAX_ALLOC_PCT"] = "0.10"
        os.environ["ORS_SIGMA_COOLDOWN_BARS"] = "3"
        os.environ["ORS_ALPHA_MIN_SCORE"] = "garkeinwert"
        try:
            cfg = _env_overrides(OrchestratorConfig())
            self.assertAlmostEqual(cfg.sigma_max_alloc_pct, 0.10, places=6)
            self.assertEqual(cfg.sigma_cooldown_bars, 3)
            self.assertAlmostEqual(cfg.alpha_min_score, OrchestratorConfig().alpha_min_score, places=9)
        finally:
            for k in ("ORS_SIGMA_MAX_ALLOC_PCT", "ORS_SIGMA_COOLDOWN_BARS", "ORS_ALPHA_MIN_SCORE"):
                del os.environ[k]

    def test_reset_clears_memory(self):
        o = new_orchestrator()
        o.ingest("BTC/USD", prices=trend_series())
        o.reset("BTC/USD")
        self.assertEqual(o.sigma.snapshot("BTC/USD").bars, 0)


class TestHookRegistry(unittest.TestCase):
    REQUIRED = {"id", "subsystem", "status", "blocking", "title", "purpose",
                "input_contract", "output_contract", "file", "fallback"}

    def test_registry_shape_and_ids(self):
        ids = [h["id"] for h in GROK_BOT_HOOKS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(h.startswith("GBH-") for h in ids))
        self.assertIn("GBH-06", ids)
        for h in GROK_BOT_HOOKS:
            self.assertTrue(self.REQUIRED.issubset(h.keys()), h["id"])
            self.assertIn(h["subsystem"], {"ALPHA", "SIGMA", "ARBITRATION"})
            self.assertIn(h["status"], {"PLACEHOLDER", "CLAIMED", "IMPLEMENTED"})
            self.assertTrue(h["fallback"], f"{h['id']} ohne fallback ist verboten")

    def test_at_most_one_blocking_hook(self):
        blocking = [h for h in GROK_BOT_HOOKS if h["blocking"]]
        self.assertTrue(0 < len(blocking) <= 1, "genau eine Stufe darf den Takt anhalten (Paritaet)")

    def test_referenced_files_exist(self):
        for h in GROK_BOT_HOOKS:
            f = h["file"].split("::")[0]
            self.assertTrue((ROOT / f).exists(), f"{h['id']} zeigt auf fehlende Datei {f}")

    def test_referenced_tests_exist(self):
        src = (HERE / "test_alpha_sigma_orchestrator.py").read_text(encoding="utf-8")
        for h in GROK_BOT_HOOKS:
            tail = h["test"].split("::")[-1]
            self.assertIn(tail, src, f"{h['id']} verweist auf unbekannten Test {tail}")

    def test_unknown_hook_rejected(self):
        o = new_orchestrator()
        with self.assertRaises(KeyError):
            set_hook_state(o.state, "GBH-99", "CLAIMED")
        with self.assertRaises(ValueError):
            set_hook_state(o.state, "GBH-01", "DONE")

    def test_worklist_merges_state(self):
        o = new_orchestrator()
        set_hook_state(o.state, "GBH-01", "CLAIMED", owner="grok-bot", note="prompt-entwurf laeuft")
        wl = hook_worklist(o.state)
        rec = [h for h in wl["hooks"] if h["id"] == "GBH-01"][0]
        self.assertEqual(rec["status"], "CLAIMED")
        self.assertEqual(rec["owner"], "grok-bot")
        self.assertEqual(wl["protocol"]["resolve"], "POST /api/orchestrator/hooks/{id}/resolution")
        self.assertGreaterEqual(wl["open"], 1)

    def test_regime_matrix_is_complete_for_all_sources(self):
        for src in REGIME_SOURCE_MATRIX:
            self.assertTrue(REGIME_SOURCE_MATRIX[src], src)
            for r in REGIME_SOURCE_MATRIX[src]:
                self.assertIsInstance(r, Regime)


# ---------------------------------------------------------------------------
# 5. BEWUSST ROT — Grok-Bot-Uebernahme (GBH-01..GBH-10)
#    Jeder Fall prueft den Zustand NACH der Uebernahme. Er ist erfolgreich,
#    sobald der Bot liefert; bis dahin *expectedFailure* = dokumentiert rot und gewollt.
# ---------------------------------------------------------------------------

class TestGrokBotHooks(unittest.TestCase):
    """Uebernahme-Verprechen. Rot ist hier der Soll-Zustand, siehe Modul-Doku §6."""

    def setUp(self):
        self.o = new_orchestrator()
        self.prices = trend_series()
        self.o.ingest("BTC/USD", prices=self.prices)

    def _claimed(self, hook_id: str) -> bool:
        st = self.o.state.hook_state.get(hook_id) or {}
        return st.get("status") == "IMPLEMENTED" or hook_id == "GBH-06" and self.o.parity_cache.get("BTC/USD")

    @unittest.expectedFailure
    def test_GBH_01(self):
        """Grok-Bot [GBH-01] liefert echte Agenten-Antraege statt Heuristik-Fallback.

        Erwartet nach Uebernahme: server/grokOrchestrator.ts::grokAlphaVotes erzeugt
        votes >= 1 aus strukturiertem Output UND die Resolution ist registriert.
        """
        self.assertTrue(self._claimed("GBH-01"), "GBH-01 noch nicht geliefert")

    @unittest.expectedFailure
    def test_GBH_02(self):
        """Grok-Bot [GBH-02] adaptive Gewichtung: IC-Lerner schlaegt die fixe Heuristik.

        Erwartet: Ausgerufene Quelle mit historisch schlechter IC faellt unter 0.5
        und die Gewichte kommen aus einer gelernten Policy (nicht aus der Konstante).
        """
        self.assertTrue(self._claimed("GBH-02"))
        self.assertLess(self.o.cfg.alpha_source_weights["grok_news_triage"], 0.5)

    @unittest.expectedFailure
    def test_GBH_03(self):
        """Grok-Bot [GBH-03] asset-spezifische Regime-Matrix (nicht mehr global fix)."""
        self.assertTrue(self._claimed("GBH-03"))
        self.assertIn("BTC/USD", REGIME_SOURCE_MATRIX.get("__asset__", {}))

    @unittest.expectedFailure
    def test_GBH_04(self):
        """Grok-Bot [GBH-04] exakte DFA aus der code_interpreter liegt vor und naeher an 0.5-R/S."""
        self.assertTrue(self._claimed("GBH-04"))
        probe = json.loads((ROOT / "data/orchestrator/hurst_probe.json").read_text(encoding="utf-8"))
        self.assertTrue(probe["ok"])

    @unittest.expectedFailure
    def test_GBH_05(self):
        """Grok-Bot [GBH-05] x_search-Handles aus Trefferstatistik gepflegt."""
        self.assertTrue(self._claimed("GBH-05"))

    def test_GBH_06_parity_must_be_proven_by_bot(self):
        """Der Paritaetsnachweis selbst ist NICHT rot: die Engine erzwingt ihn."""
        rep = self.o.check_parity("BTC/USD", PARITY_FIXTURE)
        self.assertTrue(rep["parity_ok"])
        self.assertLessEqual(rep["worst_delta"], rep["tolerance_pct"])

    @unittest.expectedFailure
    def test_GBH_07(self):
        """Grok-Bot [GBH-07] Eskalationsleiter (Daempfer -> nur FLATTEN -> Breaker) mit Recovery."""
        self.assertTrue(self._claimed("GBH-07"))
        self.o.state.portfolio.drawdown_pct = 24.0
        d = self.o.decide("BTC/USD")
        self.assertIn(d["verdict"], (Verdict.REJECTED.value,))
        self.assertIn("DD_ESCALATION_STAGE_2", d["reason_codes"])

    @unittest.expectedFailure
    def test_GBH_08(self):
        """Grok-Bot [GBH-08] Look-Ahead-Kadenz ist hinterlegt und wird nachgehalten."""
        self.assertTrue(self._claimed("GBH-08"))
        self.assertIn("cadence_hours", self.o.state.hook_state["GBH-08"]["payload"])

    @unittest.expectedFailure
    def test_GBH_09(self):
        """Grok-Bot [GBH-09] Nachtbatch liefert Override-Vorschlaege, die als Vorschlag landen."""
        self.assertTrue(self._claimed("GBH-09"))
        self.assertEqual(self.o.state.hook_state["GBH-09"]["payload"]["applied_by_gates_only"], True)

    @unittest.expectedFailure
    def test_GBH_10(self):
        """Grok-Bot [GBH-10] Champion/Challenger-Promotion steuert das Alpha-Gewicht."""
        self.assertTrue(self._claimed("GBH-10"))
        self.assertIn("manifest_champion", self.o.state.hook_state["GBH-10"]["payload"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
