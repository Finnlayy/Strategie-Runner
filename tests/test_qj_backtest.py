"""Tests for the QuantJourney backtesting workflow.

The unit tests run everywhere.  The integration tests are skipped when
``quantjourney-bt`` is not installed, so the standard CI image still passes
while a full research environment exercises the real engine.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from app.backtest.config import BacktestConfig, BacktestError, OptimizeSpec, StressSpec, WalkForwardSpec
from app.backtest.qj_runtime import qj_available
from app.backtest import service


def sample_payload(**overrides: object) -> dict:
    payload = {
        "strategyId": "unit-test",
        "strategyName": "Unit Test SMA",
        "symbols": ["BTC/USD", "ETH/USD"],
        "intervalMinutes": 60,
        "source": "sample",
        "sampleBars": 420,
        "initialCapital": 10_000,
        "feeBps": 26,
        "slippageBps": 5,
        "strategy": {"model": "sma_cross", "params": {"fast": 10, "slow": 30}},
        "allocation": {"method": "equal_weight"},
        "rebalance": {"frequency": "signal", "onSignalChange": True},
    }
    payload.update(overrides)
    return payload


class ConfigValidationTests(unittest.TestCase):
    def test_accepts_alias_fields(self) -> None:
        config = BacktestConfig.from_payload(
            {
                "source": "sample",
                "sampleBars": 300,
                "symbols": "btc/usd, eth/usd",
                "interval": "1h",
                "strategyModel": "sma_cross",
                "feeBps": 10,
                "slippageBps": 2,
            }
        )
        self.assertEqual(config.symbols, ("BTC/USD", "ETH/USD"))
        self.assertEqual(config.interval_minutes, 60)
        self.assertEqual(config.strategy.model, "sma_cross")
        self.assertEqual(config.fee_bps, 10)

    def test_rejects_unknown_model(self) -> None:
        with self.assertRaises(BacktestError):
            BacktestConfig.from_payload(
                {"source": "sample", "sampleBars": 300, "strategy": {"model": "not-a-model"}}
            )

    def test_rejects_short_sample(self) -> None:
        with self.assertRaises(BacktestError):
            BacktestConfig.from_payload({"source": "sample", "sampleBars": 10})

    def test_walk_forward_grid_expansion(self) -> None:
        spec = WalkForwardSpec.from_payload(
            {
                "trainBars": 200,
                "testBars": 80,
                "paramGrid": {"fast": [5, 10], "slow": [20, 40]},
                "maxTrials": 10,
            }
        )
        self.assertEqual(len(spec.param_grid), 2)
        self.assertEqual(spec.max_trials, 10)
        self.assertGreaterEqual(spec.train_bars, 1)

    def test_optimize_and_stress_validation(self) -> None:
        with self.assertRaises(BacktestError):
            OptimizeSpec.from_payload({"paramGrid": {}})
        stress = StressSpec.from_payload({"feeBpsGrid": [0, 10], "slippageBpsGrid": [0, 5]})
        self.assertEqual(len(stress.fee_bps), 2)
        self.assertEqual(len(stress.slippage_bps), 2)
        self.assertEqual(len(OptimizeSpec.from_payload({"paramGrid": {"fast": [5, 10]}}).expand()), 2)

    def test_capabilities_envelope(self) -> None:
        payload = service.capabilities()
        self.assertEqual(payload["engine"], "quantjourney-bt")
        self.assertIn("versions", payload)
        self.assertTrue(payload["models"])
        self.assertIn("weightsMode", payload["features"])


@unittest.skipUnless(qj_available(), "quantjourney-bt is not installed")
class BacktestWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory(prefix="qj-backtest-tests-")
        cls._previous_dir = os.environ.get("QJ_BACKTEST_RUNS_DIR")
        os.environ["QJ_BACKTEST_RUNS_DIR"] = cls._tmp.name

    @classmethod
    def tearDownClass(cls) -> None:
        if cls._previous_dir is None:
            os.environ.pop("QJ_BACKTEST_RUNS_DIR", None)
        else:
            os.environ["QJ_BACKTEST_RUNS_DIR"] = cls._previous_dir
        cls._tmp.cleanup()

    def test_run_contract(self) -> None:
        result = service.run_backtest(sample_payload())

        self.assertTrue(result["runId"].startswith("qj-bt-"))
        self.assertEqual(result["kind"], "backtest")
        self.assertEqual(result["symbols"], ["BTC/USD", "ETH/USD"])
        self.assertTrue(result["equityCurve"])
        self.assertIsInstance(result["trades"], list)
        self.assertEqual(len(result["artifacts"]), 9)

        metrics = result["analytics"]["metrics"]
        for key in (
            "totalReturnPercent",
            "cagrPercent",
            "sharpeRatio",
            "sortinoRatio",
            "calmarRatio",
            "maxDrawdownPercent",
            "winRate",
            "profitFactor",
            "totalTrades",
            "exposurePercent",
            "totalCostsUSD",
        ):
            self.assertIn(key, metrics)

        first = result["equityCurve"][0]
        self.assertEqual(
            set(first), {"timestamp", "time", "price", "equity", "benchmarkEquity", "drawdown", "cash", "assetHoldings"}
        )
        self.assertAlmostEqual(first["equity"], 10_000, delta=1e-6)

        if result["trades"]:
            trade = result["trades"][0]
            for key in ("id", "symbol", "entryPrice", "exitPrice", "pnl", "status"):
                self.assertIn(key, trade)

    def test_persistence_history_compare_and_delete(self) -> None:
        first = service.run_backtest(sample_payload())
        second = service.run_backtest(sample_payload(strategyName="Unit Test SMA v2"))

        loaded = service.get_run(first["runId"])
        self.assertEqual(loaded["summary"]["runId"], first["runId"])
        self.assertEqual(loaded["payload"]["kind"], "backtest")

        content, media_type = service.get_artifact(first["runId"], "summary.json")
        self.assertEqual(media_type, "application/json")
        self.assertEqual(json.loads(content.decode("utf-8"))["runId"], first["runId"])

        runs = service.list_runs(limit=10)
        run_ids = {run["runId"] for run in runs}
        self.assertIn(first["runId"], run_ids)
        self.assertIn(second["runId"], run_ids)

        comparison = service.compare_runs([first["runId"], second["runId"]])
        self.assertEqual(len(comparison["runs"]), 2)
        self.assertTrue(comparison["metrics"])
        self.assertIn("metric", comparison["metrics"][0])

        deleted = service.delete_run(second["runId"])
        self.assertTrue(deleted["deleted"])
        with self.assertRaises(BacktestError):
            service.get_run(second["runId"])

    def test_walk_forward_contract(self) -> None:
        payload = sample_payload(
            walkForward={
                "scheme": "rolling",
                "trainBars": 180,
                "testBars": 64,
                "stepBars": 64,
                "purgeBars": 5,
                "objective": "sharpe",
                "paramGrid": {"fast": [8, 12], "slow": [30, 50]},
                "maxTrials": 2,
                "refit": True,
            }
        )
        result = service.run_walk_forward_request(payload)
        self.assertTrue(result["runId"].startswith("qj-wf-"))
        self.assertGreaterEqual(result["summary"]["nFolds"], 1)
        self.assertEqual(len(result["folds"]), result["summary"]["nFolds"])
        self.assertTrue(result["equityCurve"])
        for key in ("oosSharpe", "oosTotalReturnPercent", "efficiency", "deflatedSharpe", "verdicts"):
            self.assertIn(key, result["summary"])

    def test_optimization_contract(self) -> None:
        payload = sample_payload(
            optimization={
                "objective": "sharpe",
                "paramGrid": {"fast": [8, 12], "slow": [30, 50]},
                "maxTrials": 4,
            }
        )
        result = service.run_optimization_request(payload)
        self.assertTrue(result["runId"].startswith("qj-opt-"))
        self.assertEqual(result["summary"]["completedTrials"], 4)
        self.assertTrue(result["trials"])
        self.assertIn("bestParams", result["summary"])
        self.assertIsNotNone(result["bestResult"])

    def test_stress_contract(self) -> None:
        payload = sample_payload(
            stress={"feeBpsGrid": [0, 26], "slippageBpsGrid": [0, 10]}
        )
        result = service.run_stress_request(payload)
        self.assertTrue(result["runId"].startswith("qj-stress-"))
        self.assertEqual(result["summary"]["scenarios"], len(result["scenarios"]))
        self.assertIsNotNone(result["summary"]["breakevenBps"])
        statuses = {scenario["status"] for scenario in result["scenarios"]}
        self.assertTrue(statuses <= {"ok", "failed"})

    def test_artifact_allowlist(self) -> None:
        result = service.run_backtest(sample_payload())
        with self.assertRaises(BacktestError):
            service.get_artifact(result["runId"], "../../etc/passwd")


if __name__ == "__main__":
    unittest.main()
