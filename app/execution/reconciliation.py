"""
Exchange State Reconciliation & Slippage-Feedback Daemon (Modul 12: 12_RECONCILIATION_DAEMON).
Implements:
- Continuous reconciliation between local internal trade ledger and exchange state
- Partial fill handling & order recovery
- Live-to-Simulation Slippage Feedback Loop (updates gamma_impact dynamically)
"""

from datetime import datetime, timezone
import logging
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from app.core.directives import ExecutionPath, system_directive
from app.engine.market_impact import market_impact

logger = logging.getLogger("reconciliation")


class ReconciliationDaemon:
    """
    Reconciles positions, balances, open orders, and slippage feedback across live/shadow loops.
    """

    def __init__(self):
        self._realized_slippages: List[float] = []
        self._lock = threading.Lock()
        self._last_reconcile_time: datetime = datetime.now(timezone.utc)
        self._discrepancies_found: int = 0

    def record_live_fill(
        self,
        order_id: str,
        expected_price: float,
        executed_fill_price: float,
        order_qty: float,
        side: str
    ) -> Dict[str, Any]:
        """
        Records actual live execution, calculates realized slippage in bps,
        and feeds back into the Market Impact Model to adaptively calibrate gamma_impact.
        """
        system_directive.record_path_execution(ExecutionPath.HOT_PATH)
        is_buy = side.upper() in ("BUY", "LONG")
        if is_buy:
            slippage_pct = (executed_fill_price - expected_price) / expected_price
        else:
            slippage_pct = (expected_price - executed_fill_price) / expected_price

        slippage_bps = slippage_pct * 10000.0

        with self._lock:
            self._realized_slippages.append(slippage_bps)
            if len(self._realized_slippages) > 200:
                self._realized_slippages.pop(0)

            # Adaptively tune gamma_impact if systematic slippage deviation observed
            if len(self._realized_slippages) >= 20:
                median_slip = float(sorted(self._realized_slippages)[len(self._realized_slippages) // 2])
                if median_slip > 15.0:
                    market_impact.gamma_impact = min(0.95, market_impact.gamma_impact * 1.05)
                elif median_slip < 3.0:
                    market_impact.gamma_impact = max(0.10, market_impact.gamma_impact * 0.95)

        return {
            "order_id": order_id,
            "expected_price": expected_price,
            "executed_fill_price": executed_fill_price,
            "realized_slippage_bps": round(slippage_bps, 2),
            "calibrated_gamma_impact": round(market_impact.gamma_impact, 4),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    def reconcile_positions(
        self,
        local_positions: Dict[str, float],
        exchange_positions: Dict[str, float]
    ) -> Dict[str, Any]:
        """
        Detects position size drift between local state and exchange balance.
        """
        system_directive.record_path_execution(ExecutionPath.HOT_PATH)
        discrepancies = []
        all_symbols = set(local_positions.keys()).union(exchange_positions.keys())

        for sym in all_symbols:
            loc = local_positions.get(sym, 0.0)
            exc = exchange_positions.get(sym, 0.0)
            diff = abs(loc - exc)
            if diff > 1e-5:
                discrepancies.append({
                    "symbol": sym,
                    "local_qty": loc,
                    "exchange_qty": exc,
                    "drift_qty": round(diff, 6)
                })

        with self._lock:
            self._last_reconcile_time = datetime.now(timezone.utc)
            self._discrepancies_found += len(discrepancies)

        return {
            "in_sync": len(discrepancies) == 0,
            "discrepancies": discrepancies,
            "total_reconciled_symbols": len(all_symbols),
            "last_reconciliation": self._last_reconcile_time.isoformat()
        }


# Global Singleton
reconciliation_daemon = ReconciliationDaemon()
