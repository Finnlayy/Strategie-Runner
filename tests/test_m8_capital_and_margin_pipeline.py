"""
=========================================================
Datei:      tests/test_m8_capital_and_margin_pipeline.py
Zweck:      TDD Capital, Margin & Execution Math Test Suite
Knoten:     Jaune (Carrera-Engine) / Test Suite
=========================================================
"""
import pytest
import asyncio
import os
import tempfile
import pyarrow as pa
import pyarrow.parquet as pq
class TestMarginAndLiquidationMath:
    def test_isolated_margin_and_notional_calculation(self):
        """Prüft Isolated Margin & Notional Exposure."""
        from app.execution.LeverageEngine import LeverageEngine
        engine = LeverageEngine(max_allowed_leverage=10.0, maintenance_margin_rate=0.005)
        result = engine.calculate_sizing("PERP", "LIVE", "LONG", 50.0, 1.0, 100.0, 95.0, base_leverage=5.0, risk_fraction_per_trade=0.20)
        assert result.margin_usd == 10.0
        assert result.notional_usd == 50.0
        assert result.quantity_contracts == 0.5
    def test_long_liquidation_price_formula(self):
        """Liq_Long = Entry * (1.0 - 1/L + MMR + Fee)"""
        from app.execution.LeverageEngine import LeverageEngine
        engine = LeverageEngine(maintenance_margin_rate=0.005, clearance_fee_rate=0.0075)
        result = engine.calculate_sizing("PERP", "PAPER", "LONG", 50.0, 1.0, 50000.0, 47000.0, base_leverage=10.0)
        expected_liq = 50000.0 * (1.0 - 0.10 + 0.005 + 0.0075)
        assert abs(result.estimated_liquidation_price - expected_liq) < 0.01
    def test_short_liquidation_price_formula(self):
        """Liq_Short = Entry * (1.0 + 1/L - MMR - Fee)"""
        from app.execution.LeverageEngine import LeverageEngine
        engine = LeverageEngine(maintenance_margin_rate=0.005, clearance_fee_rate=0.0075)
        result = engine.calculate_sizing("PERP", "PAPER", "SHORT", 50.0, 1.0, 50000.0, 53000.0, base_leverage=10.0)
        expected_liq = 50000.0 * (1.0 + 0.10 - 0.005 - 0.0075)
        assert abs(result.estimated_liquidation_price - expected_liq) < 0.01
class TestVaultProfitSweeping:
    @pytest.mark.asyncio
    async def test_100_percent_profit_sweep_above_base_budget(self):
        """100% Profit Sweep oberhalb Base Budget."""
        from app.execution.M8StateEngine import M8StateEngine, StrategyState
        engine = M8StateEngine(redis_client=None)
        instance_id = "MEAN_REV_V3__BTC-USDT__15m__LIVE"
        engine.states[instance_id] = StrategyState(strategy_id=instance_id, status="ACTIVE", base_budget_usd=50.0, current_budget_usd=50.0)
        updated_state = await engine.update_post_trade_state(instance_id, pnl_usd=15.0, trade_id="trd_sweep_01")
        assert updated_state["current_budget_usd"] == 50.0
class TestPaperExecutionMatching:
    @pytest.mark.asyncio
    async def test_paper_tick_liquidation_destroys_budget(self):
        """Paper Liquidation vernichtet Budget auf $0.00."""
        from app.execution.PaperExecutionEngine import process_paper_tick
        from app.execution.M8StateEngine import M8StateEngine, StrategyState
        engine = M8StateEngine(redis_client=None)
        instance_id = "SCALPER__ETH-USDT__5m__PAPER"
        engine.states[instance_id] = StrategyState(strategy_id=instance_id, status="ACTIVE", base_budget_usd=50.0, current_budget_usd=40.0)
        position = {"instance_id": instance_id, "direction": "LONG", "entry_price": 3000.0, "estimated_liquidation_price": 2700.0}
        is_liquidated = await process_paper_tick(state_engine=engine, current_tick_price=2690.0, position=position)
        assert is_liquidated is True
        assert engine.states[instance_id].current_budget_usd == 0.0
        assert engine.states[instance_id].status == "QUARANTINED"
class TestRMultipleConversion:
    def test_r_multiple_and_capture_ratio_calculation(self):
        from app.execution.AutopsyProcessor import calculate_r_multiples
        metrics = calculate_r_multiples(pnl_pct=0.03, mfe_pct=0.04, mae_pct=-0.01, stop_distance_pct=0.02)
        assert abs(metrics["pnl_r"] - 1.5) < 1e-4
        assert abs(metrics["mfe_r"] - 2.0) < 1e-4
        assert abs(metrics["capture_ratio"] - 0.75) < 1e-4
    def test_r_multiple_zero_stop_distance_exception(self):
        from app.execution.AutopsyProcessor import calculate_r_multiples
        with pytest.raises(ValueError, match="stop_distance_pct muss > 0 sein"):
            calculate_r_multiples(pnl_pct=0.02, mfe_pct=0.03, mae_pct=-0.01, stop_distance_pct=0.0)
class TestAtomicParquetWriter:
    def test_write_parquet_atomically_replaces_file_safely(self):
        from app.execution.StorageUtils import write_parquet_atomically
        with tempfile.TemporaryDirectory() as tmpdir:
            target_file = os.path.join(tmpdir, "trade_path_001.parquet")
            table = pa.Table.from_batches([pa.RecordBatch.from_arrays([pa.array([1, 2]), pa.array([50000.0, 50100.0])], names=["tick_id", "price"])])
            write_parquet_atomically(target_file, table)
            assert os.path.exists(target_file)
            assert not os.path.exists(f"{target_file}.tmp")
