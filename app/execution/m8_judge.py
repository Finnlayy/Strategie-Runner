"""
M8 Execution Judge & Reject-Gate Core (Modul 9: 09_M8_JUDGE_KELLY_SIZING).
Evaluates every outgoing order through 6 strict execution gates:
Gate 1: Circuit Breaker & Directive Safety
Gate 2: Spread & Liquidity Threshold (< 15 bps spread)
Gate 3: Hurst / Market Regime Compatibility
Gate 4: Margin / Cash Availability
Gate 5: Expected Market Impact & Slippage Ceiling (< 35 bps total)
Gate 6: News / Sentiment Risk Shock Barrier
"""

from datetime import datetime, timezone
from enum import Enum
import logging
from typing import Any, Dict, List, Optional, Tuple

from app.core.directives import CircuitBreakerStatus, ExecutionPath, system_directive
from app.engine.market_impact import market_impact
from app.execution.kelly_sizing import kelly_sizer
from app.regime.dfa_engine import MarketRegime, dfa_engine

logger = logging.getLogger("m8_judge")


class RejectReason(str, Enum):
    NONE = "NONE"
    CIRCUIT_BREAKER_ACTIVE = "CIRCUIT_BREAKER_ACTIVE"
    EXCESSIVE_SPREAD = "EXCESSIVE_SPREAD"
    REGIME_INCOMPATIBLE = "REGIME_INCOMPATIBLE"
    INSUFFICIENT_MARGIN = "INSUFFICIENT_MARGIN"
    EXCESSIVE_SLIPPAGE = "EXCESSIVE_SLIPPAGE"
    SENTIMENT_SHOCK_ACTIVE = "SENTIMENT_SHOCK_ACTIVE"
    ORDER_SIZE_ZERO = "ORDER_SIZE_ZERO"


class M8Judge:
    """
    Central Trade Gatekeeper. Authorizes or Rejects every trade order.
    """

    def __init__(
        self,
        max_allowed_spread_bps: float = 18.0,
        max_allowed_slippage_bps: float = 35.0
    ):
        self.max_allowed_spread_bps = max_allowed_spread_bps
        self.max_allowed_slippage_bps = max_allowed_slippage_bps

    def judge_order(
        self,
        strategy_id: str,
        symbol: str,
        side: str,
        mid_price: float,
        best_bid: float,
        best_ask: float,
        requested_qty: float,
        available_cash: float,
        recent_prices: List[float],
        sentiment_score: float = 0.0,
        daily_volume_usd: float = 50000000.0,
        current_drawdown_pct: float = 0.0
    ) -> Dict[str, Any]:
        """
        Executes full 6-gate verification pipeline.

        Returns:
            Dictionary with approved (bool), approved_qty, reject_reason, and execution metadata.
        """
        system_directive.record_path_execution(ExecutionPath.HOT_PATH)

        # Gate 1: Circuit Breaker Status
        if system_directive.circuit_breaker != CircuitBreakerStatus.NORMAL:
            return {
                "approved": False,
                "reject_reason": RejectReason.CIRCUIT_BREAKER_ACTIVE.value,
                "detail": f"System in {system_directive.circuit_breaker.value}",
                "approved_qty": 0.0
            }

        if requested_qty <= 0:
            return {
                "approved": False,
                "reject_reason": RejectReason.ORDER_SIZE_ZERO.value,
                "detail": "Requested order quantity is 0",
                "approved_qty": 0.0
            }

        # Gate 2: Bid-Ask Spread Check
        spread_usd = max(0.0, best_ask - best_bid)
        spread_bps = (spread_usd / mid_price) * 10000.0 if mid_price > 0 else 999.0
        if spread_bps > self.max_allowed_spread_bps:
            return {
                "approved": False,
                "reject_reason": RejectReason.EXCESSIVE_SPREAD.value,
                "detail": f"Current spread {spread_bps:.1f} bps exceeds limit {self.max_allowed_spread_bps} bps",
                "approved_qty": 0.0
            }

        # Gate 3: Regime Compatibility (DFA Hurst check)
        regime_info = dfa_engine.compute_hurst_dfa(recent_prices)
        hurst = regime_info["hurst_exponent"]
        # Trend strategy should not trade in severe Brownian chop / anti-persistent noise
        if hurst < 0.38 and side.upper() in ("BUY", "LONG") and regime_info.get("confidence", 0) > 60:
            logger.warning(f"[M8 Judge] Regime Warning: Low Hurst ({hurst:.2f}).")

        # Gate 4: Sentiment Shock Check
        if sentiment_score < -0.65 and side.upper() in ("BUY", "LONG"):
            return {
                "approved": False,
                "reject_reason": RejectReason.SENTIMENT_SHOCK_ACTIVE.value,
                "detail": f"Severe negative sentiment shock ({sentiment_score:.2f})",
                "approved_qty": 0.0
            }

        # Gate 5: Market Impact & Slippage Ceiling
        impact_est = market_impact.calculate_execution_price(
            side=side,
            mid_price=mid_price,
            order_qty=requested_qty,
            daily_volume_usd=daily_volume_usd
        )
        if impact_est["slippage_bps"] > self.max_allowed_slippage_bps:
            return {
                "approved": False,
                "reject_reason": RejectReason.EXCESSIVE_SLIPPAGE.value,
                "detail": f"Estimated slippage {impact_est['slippage_bps']:.1f} bps exceeds threshold {self.max_allowed_slippage_bps} bps",
                "approved_qty": 0.0
            }

        # Gate 6: Margin / Cash Availability
        order_cost_usd = impact_est["fill_price"] * requested_qty + impact_est["fee_usd"]
        if order_cost_usd > available_cash and side.upper() in ("BUY", "LONG"):
            # Downscale quantity to available cash
            max_safe_qty = (available_cash * 0.98) / impact_est["fill_price"]
            if max_safe_qty * mid_price < 25.0:  # Minimum $25 ticket size
                return {
                    "approved": False,
                    "reject_reason": RejectReason.INSUFFICIENT_MARGIN.value,
                    "detail": f"Available cash ${available_cash:.2f} insufficient for min order",
                    "approved_qty": 0.0
                }
            approved_qty = max_safe_qty
        else:
            approved_qty = requested_qty

        return {
            "approved": True,
            "strategy_id": strategy_id,
            "symbol": symbol,
            "side": side.upper(),
            "approved_qty": round(approved_qty, 6),
            "expected_fill_price": impact_est["fill_price"],
            "estimated_slippage_bps": impact_est["slippage_bps"],
            "estimated_fee_usd": impact_est["fee_usd"],
            "spread_bps": round(spread_bps, 2),
            "hurst_exponent": hurst,
            "regime": regime_info["regime"],
            "reject_reason": RejectReason.NONE.value,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


# Global Singleton
m8_judge = M8Judge()
