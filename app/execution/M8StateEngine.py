"""
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
