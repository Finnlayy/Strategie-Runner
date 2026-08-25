"""
Fractional Kelly & Volatility Targeting Position Sizer (Modul 9: 09_M8_JUDGE_KELLY_SIZING).
Implements:
- Continuous Fractional Kelly Sizing: f* = c * ((p * b - q) / b)
- Volatility Targeting (Target Volatility, e.g. 15% annualized, ATR normalized)
- Maximum Exposure & Drawdown Leverage Dampening Gates
"""

import math
from typing import Any, Dict, Optional


class KellySizingEngine:
    """
    Computes mathematically rigorous position sizing using Fractional Kelly and Volatility Targeting.
    """

    def __init__(
        self,
        fraction: float = 0.5,             # Half-Kelly for risk aversion
        target_annual_vol: float = 0.20,   # Target 20% annualized portfolio vol
        max_leverage: float = 1.0,         # Max portfolio exposure (1x spot)
        max_single_trade_pct: float = 0.25 # Max 25% allocation on a single trade
    ):
        self.fraction = fraction
        self.target_annual_vol = target_annual_vol
        self.max_leverage = max_leverage
        self.max_single_trade_pct = max_single_trade_pct

    def compute_fractional_kelly(
        self,
        win_rate: float,
        payoff_ratio: float
    ) -> float:
        """
        Calculates raw Kelly criterion fraction f* scaled by fraction multiplier:
        f* = c * ( (p * b - (1 - p)) / b )
        where p = win_rate, b = payoff_ratio (avg_win / avg_loss).
        """
        p = max(0.01, min(0.99, win_rate))
        b = max(0.1, payoff_ratio)
        q = 1.0 - p

        raw_kelly = (p * b - q) / b
        if raw_kelly <= 0:
            return 0.0

        fractional_kelly = self.fraction * raw_kelly
        return max(0.0, min(self.max_single_trade_pct, fractional_kelly))

    def compute_position_size(
        self,
        capital_usd: float,
        current_price: float,
        atr: float,
        win_rate: float = 0.55,
        payoff_ratio: float = 1.8,
        asset_annual_vol: float = 0.65,
        current_drawdown_pct: float = 0.0
    ) -> Dict[str, Any]:
        """
        Computes optimal target allocation USD and units.

        Combines:
        1. Fractional Kelly bound
        2. Volatility Targeting factor: target_vol / asset_vol
        3. Drawdown dampening: scales down size if in drawdown
        4. ATR unit risk sizing

        Returns:
            Dictionary with target units, target USD, kelly fraction, and gate approvals.
        """
        if capital_usd <= 0 or current_price <= 0:
            return {
                "target_qty": 0.0,
                "target_usd": 0.0,
                "allocation_pct": 0.0,
                "kelly_fraction": 0.0,
                "dampener": 0.0
            }

        # 1. Fractional Kelly
        f_kelly = self.compute_fractional_kelly(win_rate, payoff_ratio)

        # 2. Volatility Target Factor
        vol_scalar = min(1.0, self.target_annual_vol / max(0.05, asset_annual_vol))

        # 3. Drawdown Dampening (If DD > 5%, linearly scale down risk)
        dd_dampener = 1.0
        if current_drawdown_pct > 5.0:
            dd_dampener = max(0.2, 1.0 - (current_drawdown_pct - 5.0) / 20.0)

        # Composite target allocation percentage of capital
        target_allocation_pct = min(self.max_single_trade_pct, f_kelly * vol_scalar * dd_dampener)
        target_usd = capital_usd * target_allocation_pct

        # ATR Risk Sizing check (risk 1.5% of equity per trade over 2*ATR)
        risk_budget_usd = capital_usd * 0.015 * dd_dampener
        atr_stop_distance = max(current_price * 0.005, atr * 2.0)
        atr_max_qty = risk_budget_usd / atr_stop_distance if atr_stop_distance > 0 else 0.0

        # Safe units
        units_by_capital = target_usd / current_price
        final_units = min(units_by_capital, atr_max_qty)
        final_usd = final_units * current_price

        return {
            "target_qty": round(final_units, 6),
            "target_usd": round(final_usd, 2),
            "allocation_pct": round((final_usd / capital_usd) * 100.0, 2) if capital_usd > 0 else 0.0,
            "kelly_fraction": round(f_kelly, 4),
            "volatility_scalar": round(vol_scalar, 4),
            "drawdown_dampener": round(dd_dampener, 4),
            "max_single_trade_pct": round(self.max_single_trade_pct * 100.0, 1)
        }


# Global Singleton
kelly_sizer = KellySizingEngine()
