"""
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
