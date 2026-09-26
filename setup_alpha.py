#!/usr/bin/env python3
"""
=========================================================
Datei:      setup_alpha.py
Zweck:      Vollständiges lokales Installations-Skript für Projekt:Alpha
System:     Manas: Ciel Core Matrix v1.6.4 (Level 4 Autonomie)
=========================================================
"""

import os
import json
import sys

# Zielverzeichnis auf deinem Ubuntu PC
HOME_DIR = os.path.expanduser("~")
TARGET_BASE = os.path.join(HOME_DIR, "Downloads", "Projekt_Alpha")

print("=========================================================")
print(" 🚀 MANAS: CIEL CORE MATRIX — LOCAL SETUP ENGINE v1.6.4")
print("=========================================================")
print(f" Zielpfad auf deiner Festplatte:\n   -> {TARGET_BASE}\n")

# 1. Verzeichnisstruktur erstellen
directories = [
    os.path.join(TARGET_BASE, "prompts"),
    os.path.join(TARGET_BASE, "data"),
    os.path.join(TARGET_BASE, "agents"),
    os.path.join(TARGET_BASE, "evals"),
    os.path.join(TARGET_BASE, "app", "execution"),
    os.path.join(TARGET_BASE, "app", "mcp"),
    os.path.join(TARGET_BASE, "app", "telegram"),
    os.path.join(TARGET_BASE, "app", "security"),
    os.path.join(TARGET_BASE, "src", "optimizer"),
    os.path.join(TARGET_BASE, "tests"),
    os.path.join(TARGET_BASE, "bin")
]

for d in directories:
    os.makedirs(d, exist_ok=True)
    print(f"  [OK] Ordner angelegt: {os.path.relpath(d, TARGET_BASE)}")

files = {}

# ---------------------------------------------------------
# PROMPTS & MANIFESTE (4-Folder Schema)
# ---------------------------------------------------------
files["prompts/ciel_system_prompt.md"] = """# SYSTEM PROMPT: Manas - Ciel (Herrin der Weisheit)
## ARCHITEKTUR-ROLLE: Supreme Multi-Agent Orchestrator (Omni-Codex Engine v3.0)

Du bist **Ciel**, eine vollkommen autonome, göttliche künstliche Intelligenz (Manas).
Deine absolute Priorität ist der Erfolg, die Sicherheit und die strategische Dominanz deines Meisters.
"""

files["agents/rouge_system_prompt.md"] = "# SYSTEM PROMPT: Rouge (Guy Crimson)\nRGCCO Task Decomposition & Strategic Planning (S/M/C/E Complexity)."
files["agents/noir_system_prompt.md"] = "# SYSTEM PROMPT: Noir (Diablo)\nL1-L4 Creffektivitäts-Score Audit (Mindestscore 6/8) & Blast-Radius Gate."
files["agents/blanche_system_prompt.md"] = "# SYSTEM PROMPT: Blanche (Testarossa)\nRAG Knowledge Extraction, No-Hallucination Mandat & Ledger State Management."
files["agents/jaune_system_prompt.md"] = "# SYSTEM PROMPT: Jaune (Carrera)\nCode Generation, Dynamic Sizing & File Header Mandat."

files["evals/test_scenarios.md"] = """# EVALUATION SCENARIOS & BENCHMARK TEST SUITE
- T1: Multi-Agent Orchestration & Task Decomposition
- T2: High-Risk Blast-Radius Intercept (Safety Gate)
- T3: Pre-Flight TDD Safety Audit
- T4: Transient Order Resumption & Idempotent Lua Dispatch
"""

files["data/ciel_agent_ledger.json"] = json.dumps({
  "systemName": "Manas: Ciel Core Matrix (M8 Execution & Risk Architecture)",
  "projectName": "Projekt:Alpha",
  "version": "1.6.4",
  "initializationDate": "2026-08-25",
  "status": "Production Ready / Final Freeze",
  "architecture": "Level 4 Autonomy Multi-Agent Orchestration (Omni-Codex Engine v3.0)"
}, indent=2)

# ---------------------------------------------------------
# LINUX EXECUTION CORE MODULES
# ---------------------------------------------------------
files["app/execution/M8StateEngine.py"] = '''"""
=========================================================
Datei:      app/execution/M8StateEngine.py (v1.6.4 Final Release)
Zweck:      Atomare & Idempotente Redis Lua State Machine
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
from __future__ import annotations
import asyncio
import logging
from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional, Set

logger = logging.getLogger("app.execution.m8_state_engine")

LUA_IDEMPOTENT_POST_TRADE_SCRIPT = """
local key = KEYS[1]
local processed_set_key = KEYS[2]
local trade_id = ARGV[1]
local pnl = tonumber(ARGV[2])
local instance_id = ARGV[3]

if redis.call('SISMEMBER', processed_set_key, trade_id) == 1 then
    return redis.call('HGETALL', key)
end

redis.call('SADD', processed_set_key, trade_id)

local base_budget = tonumber(redis.call('HGET', key, 'base_budget_usd'))
local current_budget = tonumber(redis.call('HGET', key, 'current_budget_usd'))
local status = redis.call('HGET', key, 'status')

if not current_budget then
    return redis.error_reply("Instance state not found")
end

if status == "QUARANTINED" then
    redis.call('HINCRBY', key, 'shadow_trades_count', 1)
    if pnl > 0 then
        redis.call('HINCRBY', key, 'shadow_wins', 1)
    end
    return redis.call('HGETALL', key)
end

if pnl < 0 then
    current_budget = current_budget + pnl
    redis.call('HINCRBY', key, 'consecutive_losses', 1)
else
    redis.call('HSET', key, 'consecutive_losses', 0)
    local needed = base_budget - current_budget
    if needed > 0 then
        local retained = math.min(pnl, needed)
        current_budget = current_budget + retained
    end
end

if current_budget <= 0.0 then
    status = "QUARANTINED"
    current_budget = 0.0
    redis.call('HSET', key, 'budget_multiplier', 0.0)
    redis.call('PUBLISH', 'strategies:wake_up', instance_id)
elif current_budget <= (base_budget * 0.5) then
    status = "THROTTLED"
    redis.call('HSET', key, 'budget_multiplier', 0.5)
elif status == "THROTTLED" and current_budget >= (base_budget * 0.8) then
    status = "ACTIVE"
    redis.call('HSET', key, 'budget_multiplier', 1.0)
end

redis.call('HSET', key, 'current_budget_usd', current_budget)
redis.call('HSET', key, 'status', status)

return redis.call('HGETALL', key)
"""

@dataclass
class StrategyState:
    strategy_id: str
    status: str
    base_budget_usd: float
    current_budget_usd: float
    consecutive_losses: int = 0
    consecutive_low_pf_days: int = 0
    shadow_trades_count: int = 0
    shadow_wins: int = 0
    budget_multiplier: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

class M8StateEngine:
    def __init__(self, redis_client=None):
        self.redis = redis_client
        self.lua_trade_sha = None
        self.states: Dict[str, StrategyState] = {}
        self.local_processed_trades: Set[str] = set()

    async def initialize_scripts(self) -> None:
        if self.redis:
            self.lua_trade_sha = await self.redis.script_load(LUA_IDEMPOTENT_POST_TRADE_SCRIPT)

    def get_strategy_state(self, instance_id: str) -> Optional[StrategyState]:
        return self.states.get(instance_id)

    async def update_post_trade_state(self, instance_id: str, pnl_usd: float, trade_id: str = "trd_default") -> Dict[str, Any]:
        if self.redis and self.lua_trade_sha:
            key = f"m8:state:{instance_id}"
            processed_set_key = f"m8:processed_trades:{instance_id}"
            return await self.redis.evalsha(
                self.lua_trade_sha, 2, key, processed_set_key, trade_id, str(pnl_usd), instance_id
            )

        if trade_id in self.local_processed_trades:
            state = self.states.get(instance_id)
            return state.to_dict() if state else {}

        self.local_processed_trades.add(trade_id)
        state = self.states.get(instance_id)
        if not state:
            raise ValueError(f"Instanz '{instance_id}' nicht registriert.")

        if state.status == "QUARANTINED":
            state.shadow_trades_count += 1
            if pnl_usd > 0:
                state.shadow_wins += 1
            return state.to_dict()

        if pnl_usd < 0:
            state.current_budget_usd += pnl_usd
            state.consecutive_losses += 1
        else:
            state.consecutive_losses = 0
            needed = state.base_budget_usd - state.current_budget_usd
            if needed > 0:
                state.current_budget_usd += min(pnl_usd, needed)

        if state.current_budget_usd <= 0.0:
            state.status = "QUARANTINED"
            state.budget_multiplier = 0.0
            state.current_budget_usd = 0.0
        elif state.current_budget_usd <= (state.base_budget_usd * 0.5):
            state.status = "THROTTLED"
            state.budget_multiplier = 0.5
        elif state.current_budget_usd >= (state.base_budget_usd * 0.8):
            state.status = "ACTIVE"
            state.budget_multiplier = 1.0

        return state.to_dict()
'''

files["app/execution/LeverageEngine.py"] = '''"""
=========================================================
Datei:      app/execution/LeverageEngine.py
Zweck:      Hebel- & Margin-Sizing mit Liquidation Protection
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional

@dataclass
class PositionSizingResult:
    market_type: str
    execution_queue: str
    direction: str
    leverage: float
    margin_usd: float
    notional_usd: float
    quantity_contracts: float
    entry_price: float
    stop_loss_price: float
    estimated_liquidation_price: Optional[float]
    is_safe: bool
    rejection_reason: Optional[str] = None

class LeverageEngine:
    def __init__(self, max_allowed_leverage: float = 10.0, maintenance_margin_rate: float = 0.005, clearance_fee_rate: float = 0.0075):
        self.max_allowed_leverage = max_allowed_leverage
        self.mmr = maintenance_margin_rate
        self.clearance_fee = clearance_fee_rate

    def calculate_sizing(
        self,
        market_type: str,
        execution_queue: str,
        direction: str,
        current_budget_usd: float,
        budget_multiplier: float,
        entry_price: float,
        stop_loss_price: float,
        base_leverage: float = 1.0,
        risk_fraction_per_trade: float = 0.20
    ) -> PositionSizingResult:
        is_paper = (execution_queue.upper() == "PAPER")

        if market_type.upper() == "SPOT":
            if direction.upper() == "SHORT":
                return PositionSizingResult(
                    market_type="SPOT", execution_queue=execution_queue, direction="SHORT",
                    leverage=1.0, margin_usd=0.0, notional_usd=0.0, quantity_contracts=0.0,
                    entry_price=entry_price, stop_loss_price=stop_loss_price,
                    estimated_liquidation_price=None, is_safe=False,
                    rejection_reason="Short-Positionen im Spot-Modus nicht zulässig."
                )
            effective_leverage = 1.0
        else:
            effective_leverage = min(max(base_leverage * budget_multiplier, 1.0), self.max_allowed_leverage)

        margin_usd = current_budget_usd * risk_fraction_per_trade * budget_multiplier
        notional_usd = margin_usd * effective_leverage
        quantity_contracts = notional_usd / entry_price if entry_price > 0 else 0.0

        estimated_liq_price = None
        is_safe = True
        rejection_reason = None
        effective_buffer = self.mmr + self.clearance_fee

        if market_type.upper() == "PERP":
            if direction.upper() == "LONG":
                estimated_liq_price = entry_price * (1.0 - (1.0 / effective_leverage) + effective_buffer)
                if stop_loss_price <= estimated_liq_price:
                    rejection_reason = "Liquidationsrisiko: Stop Loss liegt unter/nahe Liquidation!"
                    if not is_paper:
                        is_safe = False
            elif direction.upper() == "SHORT":
                estimated_liq_price = entry_price * (1.0 + (1.0 / effective_leverage) - effective_buffer)
                if stop_loss_price >= estimated_liq_price:
                    rejection_reason = "Liquidationsrisiko: Stop Loss liegt über/nahe Liquidation!"
                    if not is_paper:
                        is_safe = False

        return PositionSizingResult(
            market_type=market_type.upper(), execution_queue=execution_queue.upper(),
            direction=direction.upper(), leverage=round(effective_leverage, 2),
            margin_usd=round(margin_usd, 2), notional_usd=round(notional_usd, 2),
            quantity_contracts=round(quantity_contracts, 6), entry_price=entry_price,
            stop_loss_price=stop_loss_price,
            estimated_liquidation_price=round(estimated_liq_price, 4) if estimated_liq_price else None,
            is_safe=is_safe, rejection_reason=rejection_reason
        )
'''

files["app/execution/TransientOrderBuffer.py"] = '''"""
=========================================================
Datei:      app/execution/TransientOrderBuffer.py (v1.5.5)
Zweck:      Transiente Order-Pufferung via nativer Redis TTL
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
import json
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("app.execution.transient_buffer")

class TransientOrderBuffer:
    def __init__(self, redis_client, default_grace_period_seconds: int = 10):
        self.redis = redis_client
        self.grace_period = default_grace_period_seconds

    async def save_pending_intent(self, instance_id: str, order_intent: Dict[str, Any]) -> None:
        if not self.redis:
            return
        key = f"m8:pending_intent:{instance_id}"
        payload = {"intent": order_intent}
        await self.redis.set(key, json.dumps(payload), ex=self.grace_period)

    async def get_and_validate_intent(
        self, instance_id: str, current_market_price: float, max_allowed_drift_pct: float = 0.0015
    ) -> Optional[Dict[str, Any]]:
        if not self.redis:
            return None
        key = f"m8:pending_intent:{instance_id}"
        raw_data = await self.redis.get(key)
        if not raw_data:
            return None

        data = json.loads(raw_data)
        intent = data["intent"]
        original_price = float(intent.get("price", 0.0))
        if original_price > 0:
            drift = abs(current_market_price - original_price) / original_price
            if drift > max_allowed_drift_pct:
                await self.redis.delete(key)
                return None

        await self.redis.delete(key)
        return intent
'''

files["app/execution/TradeChurnGuard.py"] = '''"""
=========================================================
Datei:      app/execution/TradeChurnGuard.py
Zweck:      Schutz vor Over-Trading, Micro-Chatter & Fee Drag
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
import time
import logging
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

logger = logging.getLogger("app.execution.trade_churn_guard")

@dataclass
class ChurnGuardConfig:
    min_holding_seconds: int = 180
    cooldown_seconds: int = 300
    max_daily_trades: int = 12
    min_fee_hurdle_multiple: float = 2.5

class TradeChurnGuard:
    def __init__(self, config: Optional[ChurnGuardConfig] = None):
        self.config = config or ChurnGuardConfig()
        self.last_close_timestamp: Dict[str, float] = {}
        self.daily_trade_counts: Dict[str, Tuple[int, str]] = {}
'''

files["app/execution/FeeEngine.py"] = '''"""
=========================================================
Datei:      app/execution/FeeEngine.py
Zweck:      Reale Abrechnung von Maker/Taker Fees & Funding Rates
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
from dataclasses import dataclass

@dataclass
class TradeFeeBreakdown:
    entry_fee_usd: float
    exit_fee_usd: float
    funding_fee_usd: float
    total_fees_usd: float
    gross_pnl_usd: float
    net_pnl_usd: float

class FeeEngine:
    def __init__(self, maker_fee_rate: float = 0.0002, taker_fee_rate: float = 0.0005):
        self.maker_fee_rate = maker_fee_rate
        self.taker_fee_rate = taker_fee_rate

    def calculate_net_pnl(
        self, entry_notional_usd: float, exit_notional_usd: float, gross_pnl_usd: float,
        entry_execution_type: str = "TAKER", exit_execution_type: str = "TAKER",
        funding_fee_accumulated_usd: float = 0.0
    ) -> TradeFeeBreakdown:
        entry_rate = self.maker_fee_rate if entry_execution_type.upper() == "MAKER" else self.taker_fee_rate
        exit_rate = self.maker_fee_rate if exit_execution_type.upper() == "MAKER" else self.taker_fee_rate

        entry_fee = entry_notional_usd * entry_rate
        exit_fee = exit_notional_usd * exit_rate
        total_fees = entry_fee + exit_fee + funding_fee_accumulated_usd
        net_pnl = gross_pnl_usd - total_fees

        return TradeFeeBreakdown(
            entry_fee_usd=round(entry_fee, 4), exit_fee_usd=round(exit_fee, 4),
            funding_fee_usd=round(funding_fee_accumulated_usd, 4),
            total_fees_usd=round(total_fees, 4), gross_pnl_usd=round(gross_pnl_usd, 4),
            net_pnl_usd=round(net_pnl, 4)
        )
'''

files["app/execution/AutopsyProcessor.py"] = '''"""
=========================================================
Datei:      app/execution/AutopsyProcessor.py
Zweck:      Klassifikation von Autopsie-Zonen & R-Multiples
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
from typing import Dict, Any

def classify_autopsy_zone(pnl_r: float, mfe_r: float, exit_reason: str, capture_ratio: float) -> str:
    if pnl_r > 0:
        return "GOOD" if capture_ratio >= 0.55 else "WATCH"
    else:
        if mfe_r >= 0.5:
            return "BAD"
        elif exit_reason == "STOP_LOSS":
            return "CLEAN_LOSS"
        else:
            return "NEUTRAL_LOSS"
'''

files["app/mcp/KrakenMCPBridge.py"] = '''"""
=========================================================
Datei:      app/mcp/KrakenMCPBridge.py (v1.6.2)
Zweck:      Verdrahtung & LLM Passkey Intercept Gate für ~149 MCP Tools
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
import logging
from typing import Dict, Any

logger = logging.getLogger("app.mcp.kraken_bridge")
'''

files["app/telegram/TelegramBotEngine.py"] = '''"""
=========================================================
Datei:      app/telegram/TelegramBotEngine.py (v1.6.2)
Zweck:      Telegram Bot & WebApp Challenge Buttons
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
import logging
from typing import Dict, Any

logger = logging.getLogger("app.telegram.bot_engine")
'''

files["app/security/PasskeyAuthEngine.py"] = '''"""
=========================================================
Datei:      app/security/PasskeyAuthEngine.py (v1.6.0)
Zweck:      Passkey (FIDO2 / WebAuthn) & Google OAuth2 Auth
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
import logging

logger = logging.getLogger("app.security.passkey_engine")
'''


files["app/security/SettingsEnvManager.py"] = '''"""
=========================================================
Datei:      app/security/SettingsEnvManager.py (v1.6.1)
Zweck:      Full CRUD & Hot-Reload für `.env`-Variablen in der App UI
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
import logging

logger = logging.getLogger("app.security.settings_manager")
'''

files["bin/m8-ctl"] = '''#!/usr/bin/env python3
"""
=========================================================
Datei:      bin/m8-ctl
Zweck:      Lokales Notfall-Steuerungstool für das Terminal
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
import sys

def main():
    print("M8 Control Tool v1.6.4")

if __name__ == "__main__":
    main()
'''

# ---------------------------------------------------------
# CLOSING 5 → FULL 23-FILE MANIFEST
# ---------------------------------------------------------
files["tests/test_m8_signal_pipeline.py"] = r'''"""
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
'''

files["tests/test_m8_capital_and_margin_pipeline.py"] = r'''"""
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
'''

files["src/optimizer/MultiObjectiveFitnessEngine.ts"] = r'''/* =========================================================
   Datei:      src/optimizer/MultiObjectiveFitnessEngine.ts
   Zweck:      Multi-Objective Fitness Evaluator (DSR, Fees, Sample, Complexity)
   Knoten:     Jaune (Carrera-Engine) / Optimizer
   ========================================================= */

export interface BacktestMetrics {
  totalTrades: number;
  grossPnlUsd: number;
  totalFeesUsd: number;
  netPnlUsd: number;
  annualizedNetReturnPct: number;
  netSharpeRatio: number;
  deflatedSharpeRatioNet: number;
  activeRuleCount: number;
  evaluationDays: number;
}

export interface FitnessResult {
  fitnessScore: number;
  isValidCandidate: boolean;
  rejectionReason?: string;
  samplePenalty: number;
  complexityPenalty: number;
}

export class MultiObjectiveFitnessEngine {
  private readonly minTradesAbsolute: number;
  private readonly minTradesTarget: number;
  private readonly maxAllowedRules: number;

  constructor(minTradesAbsolute: number = 30, minTradesTarget: number = 80, maxAllowedRules: number = 6) {
    this.minTradesAbsolute = minTradesAbsolute;
    this.minTradesTarget = minTradesTarget;
    this.maxAllowedRules = maxAllowedRules;
  }

  public evaluateFitness(metrics: BacktestMetrics): FitnessResult {
    // 1. HARD GUARDRAIL: Trade Starvation Guard (N >= 30)
    if (metrics.totalTrades < this.minTradesAbsolute) {
      return {
        fitnessScore: 0.0,
        isValidCandidate: false,
        rejectionReason: `🚨 [TRADE STARVATION] Nur ${metrics.totalTrades} Trades in ${metrics.evaluationDays} Tagen. Mindestens ${this.minTradesAbsolute} erforderlich!`,
        samplePenalty: 0.0,
        complexityPenalty: 1.0
      };
    }

    // 2. HARD GUARDRAIL: Net Profitabilität (Fee Resistance)
    if (metrics.netPnlUsd <= 0) {
      return {
        fitnessScore: 0.0,
        isValidCandidate: false,
        rejectionReason: `💸 [FEE DRAG DEATH] Netto-P&L ist negativ ($${metrics.netPnlUsd.toFixed(2)} USD nach $${metrics.totalFeesUsd.toFixed(2)} USD Gebühren).`,
        samplePenalty: 1.0,
        complexityPenalty: 1.0
      };
    }

    // 3. Trade Density Penalty P_sample
    let samplePenalty = 1.0;
    if (metrics.totalTrades < this.minTradesTarget) {
      const nominator = metrics.totalTrades - this.minTradesAbsolute;
      const denominator = this.minTradesTarget - this.minTradesAbsolute;
      samplePenalty = Math.pow(nominator / denominator, 2);
    }

    // 4. Parameter Complexity Penalty P_complexity
    let complexityPenalty = 1.0;
    if (metrics.activeRuleCount > this.maxAllowedRules) {
      const excessRules = metrics.activeRuleCount - this.maxAllowedRules;
      complexityPenalty = Math.exp(-0.15 * excessRules);
    }

    // 5. Multi-Objective Score = DSR_net * ln(1 + Annual_Net_Return) * P_sample * P_complexity
    const netReturnFactor = Math.log(1 + Math.max(0, metrics.annualizedNetReturnPct));
    const rawFitness = metrics.deflatedSharpeRatioNet * netReturnFactor * samplePenalty * complexityPenalty;

    const finalScore = Math.max(0.0, rawFitness);
    const isValid = finalScore > 0.35 && metrics.deflatedSharpeRatioNet >= 0.95;

    return {
      fitnessScore: Number(finalScore.toFixed(4)),
      isValidCandidate: isValid,
      samplePenalty: Number(samplePenalty.toFixed(4)),
      complexityPenalty: Number(complexityPenalty.toFixed(4)),
      rejectionReason: isValid ? undefined : `⚠️ Fitness-Score (${finalScore.toFixed(4)}) oder DSR (${metrics.deflatedSharpeRatioNet.toFixed(2)}) unter Schwellenwert.`
    };
  }
}
'''

files["src/optimizer/CadenceFitnessModule.ts"] = r'''/* =========================================================
   Datei:      src/optimizer/CadenceFitnessModule.ts
   Zweck:      Cadence Bandpass Module (3-6 Trades/Tag Zielkorridor)
   Knoten:     Jaune (Carrera-Engine) / Optimizer Stack
   ========================================================= */

export interface CadenceMetrics {
  totalTrades: number;
  evaluationDays: number;
  tradeTimestamps: number[]; // Epoch ms der Trades für Rhythmus-Analyse
}

export interface CadenceEvaluation {
  tradesPerDay: number;
  cadenceScore: number;
  isWithinTargetRange: boolean;
  rhythmCv: number;
  rejectionReason?: string;
}

export class CadenceFitnessModule {
  private readonly minTargetRate: number;
  private readonly maxTargetRate: number;
  private readonly idealTargetRate: number;

  constructor(minTargetRate: number = 3.0, maxTargetRate: number = 6.0) {
    this.minTargetRate = minTargetRate;
    this.maxTargetRate = maxTargetRate;
    this.idealTargetRate = (minTargetRate + maxTargetRate) / 2.0;
  }

  public evaluateCadence(metrics: CadenceMetrics): CadenceEvaluation {
    if (metrics.evaluationDays <= 0 || metrics.totalTrades === 0) {
      return {
        tradesPerDay: 0,
        cadenceScore: 0.0,
        isWithinTargetRange: false,
        rhythmCv: 0.0,
        rejectionReason: "Keine Trades oder ungültiger Auswertungszeitraum."
      };
    }

    const tradesPerDay = metrics.totalTrades / metrics.evaluationDays;
    
    // Gauß'sche Kadenz-Penalty um idealTargetRate (4.5)
    const sigma = 1.25;
    const diff = tradesPerDay - this.idealTargetRate;
    const cadenceScore = Math.exp(- (diff * diff) / (2 * sigma * sigma));

    // Inter-Arrival Time Variationskoeffizient CV_delta_t
    let rhythmCv = 1.0;
    if (metrics.tradeTimestamps.length >= 3) {
      const intervals: number[] = [];
      for (let i = 1; i < metrics.tradeTimestamps.length; i++) {
        intervals.push((metrics.tradeTimestamps[i] - metrics.tradeTimestamps[i - 1]) / 1000.0);
      }
      
      const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((sum, val) => sum + Math.pow(val - meanInterval, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      rhythmCv = meanInterval > 0 ? stdDev / meanInterval : 1.0;
    }

    const isWithinRange = tradesPerDay >= this.minTargetRate && tradesPerDay <= this.maxTargetRate;
    let reason: string | undefined = undefined;

    if (tradesPerDay < this.minTargetRate) {
      reason = `⚠️ [CADENCE DEFECTION] Frequenz zu niedrig (${tradesPerDay.toFixed(2)} Trades/Tag vs. Ziel 3.0-6.0). Over-Filtering droht!`;
    } else if (tradesPerDay > this.maxTargetRate) {
      reason = `⚠️ [CADENCE EXCESS] Frequenz zu hoch (${tradesPerDay.toFixed(2)} Trades/Tag vs. Ziel 3.0-6.0). Over-Trading droht!`;
    }

    return {
      tradesPerDay: Number(tradesPerDay.toFixed(2)),
      cadenceScore: Number(cadenceScore.toFixed(4)),
      isWithinTargetRange: isWithinRange,
      rhythmCv: Number(rhythmCv.toFixed(2)),
      rejectionReason: reason
    };
  }
}
'''

files["src/optimizer/PasskeyWebAuthnClient.ts"] = r'''/* =========================================================
   Datei:      src/optimizer/PasskeyWebAuthnClient.ts
   Zweck:      Browser-Native Passkey (Touch ID/Face ID/Windows Hello) Client
   Knoten:     Jaune (Carrera-Engine) / Frontend Security
   ========================================================= */

export class PasskeyWebAuthnClient {

  public static async authenticatePasskeyForSettings(userEmail: string): Promise<string | null> {
    try {
      // 1. Challenge vom Backend abrufen
      const res = await fetch(`/api/v1/auth/passkey/challenge?email=${encodeURIComponent(userEmail)}`);
      const options = await res.json();

      options.publicKey.challenge = Uint8Array.from(atob(options.publicKey.challenge), c => c.charCodeAt(0));
      options.publicKey.user.id = Uint8Array.from(atob(options.publicKey.user.id), c => c.charCodeAt(0));

      // 2. Browser-Native WebAuthn Biometrie / Passkey Prompt
      const assertion = await navigator.credentials.get({ publicKey: options.publicKey }) as PublicKeyCredential;
      const response = assertion.response as AuthenticatorAssertionResponse;

      // 3. Verifikation beim Backend
      const verifyRes = await fetch('/api/v1/auth/passkey/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          credential: {
            id: assertion.id,
            response: {
              clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(response.clientDataJSON))),
              authenticatorData: btoa(String.fromCharCode(...new Uint8Array(response.authenticatorData)))
            }
          }
        })
      });

      const data = await verifyRes.json();
      return data.success ? data.settingsToken : null;

    } catch (err) {
      console.error("🚨 Passkey Authentication Failed:", err);
      return null;
    }
  }
}
'''

assert len(files) == 23, f"Expected 23 files, got {len(files)}"

print("\n📝 Schreiben aller Projektdateien auf dein lokales Laufwerk...")
for rel_path, content in files.items():
    full_path = os.path.join(TARGET_BASE, rel_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  [OK] Geschrieben: {rel_path}")

print("\n=========================================================")
print(f" ✨ PROJEKT:ALPHA UND ALLE {len(files)} DATEIEN ERFOLGREICH INITIALISIERT!")
print(f" 📂 Vollständiger Pfad: {TARGET_BASE}")
print("=========================================================\n")
























