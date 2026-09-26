"""
=========================================================
Datei:      tests/test_m8_signal_pipeline.py
Zweck:      TDD Signal Pipeline Unit Test Suite
Knoten:     Jaune (Carrera-Engine) / Test Suite
=========================================================
"""

import pytest
import asyncio
import time
from typing import Dict, Any

@pytest.fixture
def sample_signal_payload() -> Dict[str, Any]:
    return {
        "event_id": "sig_test_001",
        "instance_id": "MEAN_REV_V3__BTC-USDT__15m__LIVE",
        "strategy_id": "MEAN_REV_V3",
        "genome_id": "gen_btc_15m_v1",
        "symbol": "BTC/USDT",
        "timeframe": "15m",
        "execution_queue": "LIVE",
        "market_type": "PERP",
        "direction": "LONG",
        "entry_price": 50000.0,
        "stop_loss_price": 49000.0,
        "take_profit_price": 52500.0,
        "proposed_at": "2026-08-25T12:00:00Z"
    }

class TestM8StateEnginePipeline:
    
    @pytest.mark.asyncio
    async def test_high_water_mark_budget_recovery_and_activation(self):
        """Prüft High-Water-Mark Budget-Recovery & Re-Aktivierung bei >= 80% Budget."""
        from app.execution.M8StateEngine import M8StateEngine, StrategyState
        
        engine = M8StateEngine(redis_client=None)
        engine.states["MEAN_REV_V3__BTC-USDT__15m__LIVE"] = StrategyState(
            strategy_id="MEAN_REV_V3__BTC-USDT__15m__LIVE",
            status="THROTTLED",
            base_budget_usd=50.0,
            current_budget_usd=25.0,
            budget_multiplier=0.5
        )

        updated_state = await engine.update_post_trade_state("MEAN_REV_V3__BTC-USDT__15m__LIVE", pnl_usd=20.0, trade_id="trd_001")
        
        assert updated_state["current_budget_usd"] == 45.0
        assert updated_state["status"] == "ACTIVE"
        assert updated_state["budget_multiplier"] == 1.0

    @pytest.mark.asyncio
    async def test_zero_trade_days_eod_pf_guard(self):
        """Prüft, dass Tage ohne Trades den low_pf_days Zähler NICHT erhöhen."""
        from app.execution.M8StateEngine import M8StateEngine, StrategyState
        
        engine = M8StateEngine(redis_client=None)
        engine.states["MEAN_REV_V3__BTC-USDT__15m__LIVE"] = StrategyState(
            strategy_id="MEAN_REV_V3__BTC-USDT__15m__LIVE",
            status="ACTIVE",
            base_budget_usd=50.0,
            current_budget_usd=50.0,
            consecutive_low_pf_days=2
        )

        updated_state = await engine.update_eod_profit_factor("MEAN_REV_V3__BTC-USDT__15m__LIVE", daily_pf=None, daily_trades_count=0)
        
        assert updated_state.consecutive_low_pf_days == 2
        assert updated_state.status == "ACTIVE"

class TestAutopsyZoneClassification:

    def test_bad_zone_priority_over_stop_loss(self):
        """MFE >= 0.5R muss zwingend als 'BAD' klassifiziert werden."""
        from app.execution.AutopsyProcessor import classify_autopsy_zone
        
        zone = classify_autopsy_zone(pnl_r=-1.0, mfe_r=0.85, exit_reason="STOP_LOSS", capture_ratio=0.0)
        assert zone == "BAD"

    def test_stop_slippage_calculation_uses_fill_vs_trigger(self):
        """Prüft Slippage-Berechnung Trigger vs. Fill Price."""
        from app.execution.AutopsyProcessor import calculate_stop_slippage
        
        has_slippage = calculate_stop_slippage(trigger_price=49000.0, fill_price=48800.0, exit_reason="STOP_LOSS", threshold_bps=15.0)
        assert has_slippage is True

class TestLeverageAndLiquidationEngine:

    def test_spot_market_short_and_leverage_clamping(self):
        """SPOT Märkte lassen keine Shorts und keinen Hebel zu."""
        from app.execution.LeverageEngine import LeverageEngine
        
        engine = LeverageEngine()
        result = engine.calculate_sizing("SPOT", "LIVE", "SHORT", 50.0, 1.0, 50000.0, 51000.0)
        assert result.is_safe is False

    def test_live_vs_paper_liquidation_guard_divergence(self):
        """LIVE geblockt, PAPER für Simulation erlaubt."""
        from app.execution.LeverageEngine import LeverageEngine
        
        engine = LeverageEngine()
        live_res = engine.calculate_sizing("PERP", "LIVE", "LONG", 50.0, 1.0, 50000.0, 44000.0, base_leverage=10.0)
        assert live_res.is_safe is False

        paper_res = engine.calculate_sizing("PERP", "PAPER", "LONG", 50.0, 1.0, 50000.0, 44000.0, base_leverage=10.0)
        assert paper_res.is_safe is True

class TestTradeChurnGuardAndFees:

    def test_fee_hurdle_rejection(self):
        """TP-Distance < 2.5x Fee muss abgelehnt werden."""
        from app.execution.TradeChurnGuard import TradeChurnGuard, ChurnGuardConfig
        
        guard = TradeChurnGuard(config=ChurnGuardConfig(min_fee_hurdle_multiple=2.5))
        is_valid, reason = guard.validate_entry_signal("TEST__15m__LIVE", 50000.0, 50020.0, 0.0005, 2.0)
        assert is_valid is False
        assert "FEE HURDLE REJECT" in reason

    def test_fee_engine_net_pnl_deduction(self):
        """Abzinsung von Maker/Taker Fees vom Brutto PnL."""
        from app.execution.FeeEngine import FeeEngine
        
        fee_engine = FeeEngine(maker_fee_rate=0.0002, taker_fee_rate=0.0005)
        breakdown = fee_engine.calculate_net_pnl(1000.0, 1050.0, 50.0, "TAKER", "MAKER", 0.50)
        assert breakdown.total_fees_usd == 1.21
        assert breakdown.net_pnl_usd == 48.79
