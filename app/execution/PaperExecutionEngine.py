"""
=========================================================
Datei:      app/execution/PaperExecutionEngine.py
Zweck:      Simulation von Tick-Liquidationen (Paper Trading)
Knoten:     Jaune
=========================================================
"""
from typing import Dict, Any
from app.execution.M8StateEngine import M8StateEngine

async def process_paper_tick(state_engine: M8StateEngine, current_tick_price: float, position: Dict[str, Any]) -> bool:
    instance_id = position["instance_id"]
    liq_price = position["estimated_liquidation_price"]
    direction = position["direction"]

    is_liquidated = False
    if direction == "LONG" and current_tick_price <= liq_price:
        is_liquidated = True
    elif direction == "SHORT" and current_tick_price >= liq_price:
        is_liquidated = True

    if is_liquidated:
        state_engine.states[instance_id].current_budget_usd = 0.0
        state_engine.states[instance_id].status = "QUARANTINED"

    return is_liquidated
