"""
Square-Root Market Impact & Slippage Calculation Model (Modul 2: 02_SIMULATION_SLIPPAGE).
Implements the Kyle-Obizhaeva & Almgren-Chriss non-linear square-root execution model:
Slippage = (Spread / 2) + sigma * gamma * sqrt(OrderSize / DailyVolume) + LatencyDrift
"""

import math
from typing import Any, Dict, Optional


class MarketImpactModel:
    """
    Computes deterministic execution price slippage, market impact, and taker fees
    for simulated and live-reconciled orders.
    """

    def __init__(
        self,
        base_fee_pct: float = 0.0026,       # Kraken Taker Fee: 26 bps (0.26%)
        gamma_impact: float = 0.314,       # Almgren-Chriss market impact coefficient
        default_half_spread_bps: float = 2.5 # Default Half-Spread: 2.5 bps
    ):
        self.base_fee_pct = base_fee_pct
        self.gamma_impact = gamma_impact
        self.default_half_spread_bps = default_half_spread_bps

    def calculate_execution_price(
        self,
        side: str,
        mid_price: float,
        order_qty: float,
        daily_volume_usd: float = 50000000.0,
        volatility_annualized: float = 0.65,
        half_spread_pct: Optional[float] = None,
        latency_drift_pct: float = 0.0
    ) -> Dict[str, Any]:
        """
        Calculates the real expected fill price factoring in:
        1. Half-spread cost
        2. Non-linear square-root market impact: sigma_daily * gamma * sqrt(order_value / daily_volume)
        3. Adverse latency price drift

        Args:
            side: "BUY" or "SELL" (or "long" / "short").
            mid_price: Current reference mid market price.
            order_qty: Quantity of asset to trade.
            daily_volume_usd: 24h market turnover volume in USD.
            volatility_annualized: Annualized volatility (e.g. 0.65 for crypto).
            half_spread_pct: Percentage half-spread cost (defaults to 2.5 bps).
            latency_drift_pct: Simulated latency adverse price drift.

        Returns:
            Dictionary with fill price, total slippage bps, impact price, and fees.
        """
        if mid_price <= 0 or order_qty <= 0:
            return {
                "fill_price": mid_price,
                "slippage_bps": 0.0,
                "slippage_usd": 0.0,
                "fee_usd": 0.0,
                "effective_cost_pct": 0.0
            }

        order_val_usd = order_qty * mid_price
        daily_vol_safe = max(daily_volume_usd, 1000000.0)

        # 1. Half Spread
        spread_cost_pct = half_spread_pct if half_spread_pct is not None else (self.default_half_spread_bps / 10000.0)

        # 2. Square-Root Temporary & Permanent Market Impact
        # Daily volatility = Annualized vol / sqrt(365)
        daily_volatility = volatility_annualized / math.sqrt(365.0)
        volume_participation = math.sqrt(min(1.0, order_val_usd / daily_vol_safe))
        impact_pct = self.gamma_impact * daily_volatility * volume_participation

        # 3. Total Price Slippage
        total_slippage_pct = spread_cost_pct + impact_pct + abs(latency_drift_pct)
        slippage_bps = total_slippage_pct * 10000.0

        is_buy = side.upper() in ("BUY", "LONG")
        if is_buy:
            fill_price = mid_price * (1.0 + total_slippage_pct)
        else:
            fill_price = mid_price * (1.0 - total_slippage_pct)

        gross_value = order_qty * fill_price
        fee_usd = gross_value * self.base_fee_pct
        slippage_usd = abs(fill_price - mid_price) * order_qty

        return {
            "side": side.upper(),
            "mid_price": round(mid_price, 6),
            "fill_price": round(fill_price, 6),
            "slippage_bps": round(slippage_bps, 2),
            "slippage_usd": round(slippage_usd, 4),
            "impact_pct": round(impact_pct * 100, 4),
            "fee_usd": round(fee_usd, 4),
            "total_execution_cost_usd": round(slippage_usd + fee_usd, 4),
            "effective_cost_pct": round((total_slippage_pct + self.base_fee_pct) * 100, 4)
        }


# Global Singleton
market_impact = MarketImpactModel()
