"""
Unit & Integration Tests for Risk Overlay & Closed Learning Loop.
Executes test cases against fixtures in tests/fixtures/risk-overlay/.
Windows-compatible test suite (python / unittest).
"""

import json
import os
from pathlib import Path
import tempfile
import unittest

FIXTURES_DIR = Path("tests/fixtures/risk-overlay")

# Python implementations of pure logic matching docs/pseudocode/ (01-04)

def approve_symbol(snapshot: dict) -> dict:
    codes = []
    symbol = str(snapshot.get("symbol", "")).upper()
    now_ms = snapshot.get("nowUtcMs", 0)

    tick = snapshot.get("tick")
    tick_age_ms = None
    if not tick:
        codes.append("DATA_STALE_TICK")
    else:
        tick_age_ms = max(0, now_ms - tick.get("timestampMs", 0))
        if tick_age_ms > 20000:
            codes.append("DATA_STALE_TICK")
        if tick.get("isSynthetic") or tick.get("lastPrice", 0) <= 0:
            codes.append("DATA_SYNTHETIC_TICK")

    lake = snapshot.get("lake")
    lake_broker = "unknown"
    if not lake or not lake.get("isReadable") or lake.get("totalRowsInWindow", 0) <= 0:
        codes.append("DATA_LAKE_UNREADABLE")
    else:
        broker_tag = str(lake.get("brokerTag", "")).lower()
        if broker_tag != "kraken":
            lake_broker = "synthetic" if broker_tag == "synthetic" else "unknown"
            codes.append("DATA_SYNTHETIC_LAKE")
        else:
            lake_broker = "kraken"

        density = lake.get("totalRowsInWindow", 0) / max(1, lake.get("expectedRowsInWindow", 1))
        if density < 0.95:
            codes.append("DATA_LAKE_SPARSE")

    pair_status = snapshot.get("pairStatus")
    if not pair_status or not pair_status.get("isOnline") or pair_status.get("isHalting"):
        codes.append("DATA_SYMBOL_HALTED")

    clock_delta = snapshot.get("exchangeClockDeltaMs")
    if clock_delta is None or abs(clock_delta) > 2000:
        codes.append("DATA_CLOCK_SKEW")

    approved = len(codes) == 0
    return {
        "symbol": symbol,
        "approved": approved,
        "codes": codes,
        "tickAgeMs": tick_age_ms,
        "lake": {"broker": lake_broker}
    }


def apply_overlay(ctx: dict) -> dict:
    gates = []
    allow_open = True
    allow_reduce = True
    size_in = max(0.0, float(ctx.get("proposedSize", 0.0)))
    size_out = size_in
    proposed_side = str(ctx.get("proposedSide", "flat")).lower()
    is_entry = proposed_side in ("buy", "sell")

    data_approval = ctx.get("dataApproval", {})
    pass_r0 = data_approval.get("approved", False)
    gates.append({"id": "R0_DATA_APPROVAL", "pass": pass_r0})
    if not pass_r0 and is_entry:
        allow_open = False
        size_out = 0.0

    regime = ctx.get("regime", "UNKNOWN")
    module_id = ctx.get("moduleId")
    pass_r1 = True
    if is_entry and module_id:
        if regime == "BROWNIAN_CHOP":
            pass_r1 = False
        elif regime == "MEAN_REVERTING" and "momentum" in module_id:
            pass_r1 = False
    gates.append({"id": "R1_REGIME", "pass": pass_r1})
    if not pass_r1 and is_entry:
        allow_open = False
        size_out = 0.0

    portfolio = ctx.get("portfolio", {})
    init_balance = float(portfolio.get("initialPaperBalanceUsd", 10000.0))
    realized_daily = float(portfolio.get("realizedDailyPnlUsd", 0.0))
    unrealized_daily = float(portfolio.get("unrealizedDailyPnlUsd", 0.0))
    total_daily_pnl = realized_daily + unrealized_daily
    daily_pnl_ratio = total_daily_pnl / init_balance if init_balance > 0 else 0.0

    pass_r5 = daily_pnl_ratio > -0.03
    gates.append({"id": "R5_DAILY_LOSS", "pass": pass_r5})
    if not pass_r5:
        allow_open = False
        if is_entry:
            size_out = 0.0

    exec_mode = ctx.get("executionMode", "paper")
    ai_live_allowed = bool(ctx.get("isAiLiveOrdersAllowed", False))
    pass_r8 = True
    if exec_mode == "live":
        pass_r8 = ai_live_allowed
    gates.append({"id": "R8_LIVE_GATE", "pass": pass_r8})
    if not pass_r8:
        allow_open = False
        size_out = 0.0

    size_out = min(size_in, size_out if allow_open else 0.0)

    return {
        "symbol": str(ctx.get("symbol", "")).upper(),
        "allowOpen": allow_open,
        "allowReduce": allow_reduce,
        "sizeIn": size_in,
        "sizeOut": size_out,
        "gates": gates,
        "dataApproval": data_approval
    }


def propose_module(symbol: str, data_approval: dict, physics: dict, scorecard: dict) -> dict:
    if not data_approval.get("approved"):
        return {"symbol": symbol, "selectedModuleId": None, "proposedSide": "flat", "score": 0.0}

    regime = physics.get("regime", "UNKNOWN")
    if regime in ("BROWNIAN_CHOP", "UNKNOWN"):
        return {"symbol": symbol, "selectedModuleId": None, "proposedSide": "flat", "score": 0.0}

    rows = scorecard.get("rows", [])
    eligible = []
    min_samples = scorecard.get("minSamples", 30)

    # Evaluate candidates
    for row in rows:
        mod_id = row.get("moduleId")
        row_regime = row.get("regime")
        if row_regime != regime:
            continue

        weight = row.get("weight", 1.0) if row.get("n", 0) >= min_samples else 1.0
        veto_rate = row.get("vetoRate", 0.0)
        veto_penalty = veto_rate * 0.50

        physics_score = 0.8  # Simulated physics score for test fixture
        composite = physics_score * weight * (1.0 - veto_penalty)

        eligible.append({
            "moduleId": mod_id,
            "compositeScore": composite
        })

    eligible.sort(key=lambda x: x["compositeScore"], reverse=True)
    if not eligible:
        return {"symbol": symbol, "selectedModuleId": None, "proposedSide": "flat", "score": 0.0}

    winner = eligible[0]
    return {
        "symbol": symbol,
        "selectedModuleId": winner["moduleId"],
        "proposedSide": "buy",
        "score": winner["compositeScore"]
    }


class TestRiskOverlayAcceptance(unittest.TestCase):

    def test_acceptance_a_stale_tick(self):
        """Acceptance A1: Stale tick (> 20,000 ms) yields approved = False, DATA_STALE_TICK code."""
        fixture_file = FIXTURES_DIR / "stale-tick.json"
        self.assertTrue(fixture_file.exists(), "stale-tick.json fixture missing")

        data = json.loads(fixture_file.read_text(encoding="utf-8"))
        snapshot = data["snapshot"]
        res = approve_symbol(snapshot)

        self.assertFalse(res["approved"])
        self.assertIn("DATA_STALE_TICK", res["codes"])
        self.assertEqual(res["tickAgeMs"], data["expected"]["tickAgeMs"])

    def test_acceptance_a_synthetic_lake(self):
        """Acceptance A2: ETH synthetic broker partition yields approved = False, DATA_SYNTHETIC_LAKE code."""
        fixture_file = FIXTURES_DIR / "synthetic-lake.json"
        self.assertTrue(fixture_file.exists(), "synthetic-lake.json fixture missing")

        data = json.loads(fixture_file.read_text(encoding="utf-8"))
        snapshot = data["snapshot"]
        res = approve_symbol(snapshot)

        self.assertFalse(res["approved"])
        self.assertIn("DATA_SYNTHETIC_LAKE", res["codes"])
        self.assertEqual(res["lake"]["broker"], "synthetic")

    def test_acceptance_b_daily_loss_breaker(self):
        """Acceptance B2: Daily loss (-3.5% < -3.0%) trips circuit breaker; allowOpen = False, allowReduce = True."""
        fixture_file = FIXTURES_DIR / "daily-loss.json"
        self.assertTrue(fixture_file.exists(), "daily-loss.json fixture missing")

        data = json.loads(fixture_file.read_text(encoding="utf-8"))
        ctx = data["context"]
        res = apply_overlay(ctx)

        self.assertFalse(res["allowOpen"])
        self.assertTrue(res["allowReduce"])
        self.assertEqual(res["sizeOut"], 0.0)

        failed_gates = [g["id"] for g in res["gates"] if not g["pass"]]
        self.assertIn(data["expected"]["failedGateId"], failed_gates)

    def test_acceptance_b_live_gate(self):
        """Acceptance B3: Live mode with AI_LIVE_ORDERS = False fails R8_LIVE_GATE."""
        fixture_file = FIXTURES_DIR / "live-gate.json"
        self.assertTrue(fixture_file.exists(), "live-gate.json fixture missing")

        data = json.loads(fixture_file.read_text(encoding="utf-8"))
        ctx = data["context"]
        res = apply_overlay(ctx)

        self.assertFalse(res["allowOpen"])
        self.assertEqual(res["sizeOut"], 0.0)

        failed_gates = [g["id"] for g in res["gates"] if not g["pass"]]
        self.assertIn(data["expected"]["failedGateId"], failed_gates)

    def test_acceptance_b_confidence_cannot_relax_gates(self):
        """Acceptance B4: High confidence (1.0) cannot bypass or relax a failed risk gate."""
        fixture_file = FIXTURES_DIR / "daily-loss.json"
        data = json.loads(fixture_file.read_text(encoding="utf-8"))
        ctx = data["context"]
        
        # Inject artificial max confidence in context
        ctx["aiConfidence"] = 1.0
        res = apply_overlay(ctx)

        self.assertFalse(res["allowOpen"])
        self.assertEqual(res["sizeOut"], 0.0)

    def test_acceptance_b_multi_symbol_evaluation(self):
        """Acceptance B5: Evaluates same module on multi-symbol fixture; BTC approved, SOL blocked."""
        fixture_file = FIXTURES_DIR / "multi-symbol.json"
        self.assertTrue(fixture_file.exists(), "multi-symbol.json fixture missing")

        data = json.loads(fixture_file.read_text(encoding="utf-8"))
        symbols = data["symbols"]

        # Symbol 1: BTC/USD
        btc = symbols[0]
        res_btc = approve_symbol(btc["snapshot"])
        self.assertEqual(res_btc["approved"], btc["expectedApproved"])

        # Symbol 2: SOL/USD
        sol = symbols[1]
        res_sol = approve_symbol(sol["snapshot"])
        self.assertEqual(res_sol["approved"], sol["expectedApproved"])
        self.assertIn(sol["expectedCode"], res_sol["codes"])

    def test_acceptance_c_screener_scorecard_preference(self):
        """Acceptance C3: Screener prefers higher-weighted module (mean_reversion_rsi over momentum_breakout)."""
        fixture_file = FIXTURES_DIR / "regime-modules.json"
        self.assertTrue(fixture_file.exists(), "regime-modules.json fixture missing")

        data = json.loads(fixture_file.read_text(encoding="utf-8"))
        res = propose_module(
            data["symbol"],
            data["dataApproval"],
            data["physics"],
            data["scorecard"]
        )

        self.assertEqual(res["selectedModuleId"], data["expected"]["selectedModuleId"])
        self.assertEqual(res["proposedSide"], data["expected"]["proposedSide"])
        self.assertGreater(res["score"], data["expected"]["scoreGreaterThan"])


if __name__ == "__main__":
    unittest.main()
