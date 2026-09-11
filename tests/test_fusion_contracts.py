"""Fusion adapter tests: contracts, blind leakage, fail-closed and Night-Train."""
import tempfile
import unittest
from pathlib import Path

from app.academy.autonomous_loop import AutonomousLearningLoop
from app.academy.night_train import NightTrainJob
from app.contracts import BlindPatternPacket, ContractError, PaperIntent, QuantRequest
from app.paper.ledger import DurablePaperLedger
from app.perception import BlindLeakageError, blind_geometry_from_candles, build_blind_pattern_packet
from app.quant.sigma_bridge import SigmaQuantBridge


class TestFusionContracts(unittest.TestCase):
    def test_round_trip(self):
        request = QuantRequest("ETH/USD", [100 + i for i in range(80)])
        self.assertEqual(QuantRequest.from_dict(request.to_dict()).to_dict(), request.to_dict())
        intent = PaperIntent("ETH/USD", "BUY", 0.2, 123.0, request_id=request.request_id)
        self.assertEqual(PaperIntent.from_dict(intent.to_dict()).to_dict(), intent.to_dict())

    def test_live_is_rejected(self):
        with self.assertRaises(ContractError):
            QuantRequest("BTC/USD", [100.0], execution_mode="live")
        with self.assertRaises(ContractError):
            PaperIntent("BTC/USD", "BUY", 1, 100, execution_mode="live")

    def test_blind_output_has_no_identity_or_price(self):
        packet = build_blind_pattern_packet({"body_ratio": 0.4, "wick_balance": -0.1})
        encoded = str(packet.geometry_features).lower()
        self.assertNotIn("symbol", encoded)
        self.assertNotIn("price", encoded)
        with self.assertRaises(BlindLeakageError):
            build_blind_pattern_packet({"symbol": "BTC/USD", "body_ratio": 0.2})

    def test_closed_candle_geometry(self):
        geometry = blind_geometry_from_candles([{"open": 10, "high": 12, "low": 9, "close": 11, "closed": True}])
        self.assertNotIn("open", geometry[0])
        with self.assertRaises(BlindLeakageError):
            blind_geometry_from_candles([{"open": 10, "high": 12, "low": 9, "close": 11, "closed": False}])

    def test_sigma_missing_is_fail_closed(self):
        request = QuantRequest("BTC/USD", [100 + i for i in range(80)])
        result = SigmaQuantBridge(backend="sigma", local_sigma_available=False).evaluate(request)
        self.assertEqual(result.verdict.status, "UNAVAILABLE")
        self.assertTrue(result.verdict.fail_closed)
        self.assertIsNone(result.verdict.paper_intent)

    def test_backend_off_and_legacy_are_explicit(self):
        request = QuantRequest("BTC/USD", [100 + i for i in range(80)])
        self.assertEqual(SigmaQuantBridge(backend="off").evaluate(request).verdict.status, "UNAVAILABLE")
        self.assertIn(SigmaQuantBridge(backend="legacy").evaluate(request).verdict.status, {"APPROVED", "NO_SIGNAL"})

    def test_ledger_parity_and_night_train_empty_is_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = DurablePaperLedger(str(Path(tmp) / "paper.jsonl"))
            report = NightTrainJob(ledger=ledger).run(dry_run=True)
            self.assertEqual(report.status, "SKIPPED")
            self.assertTrue(report.fail_closed)
            loop = AutonomousLearningLoop(ledger=ledger, events_path=str(Path(tmp) / "events.jsonl"))
            output = loop.run_once("BTC/USD", [100 + i for i in range(100)])
            self.assertIn(output["result"]["verdict"]["status"], {"APPROVED", "NO_SIGNAL"})
            self.assertTrue(ledger.verify()["ok"])
            self.assertFalse(NightTrainJob(ledger=ledger).run(dry_run=True).fail_closed)


if __name__ == "__main__":
    unittest.main(verbosity=2)
