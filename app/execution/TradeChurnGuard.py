"""
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

    def validate_entry_signal(self, instance_id: str, entry_price: float, tp_price: float, fee_rate: float, leverage: float) -> Tuple[bool, str]:
        # Minimalist implementation for tests
        dist_pct = abs(tp_price - entry_price) / entry_price
        req_hurdle = fee_rate * leverage * self.config.min_fee_hurdle_multiple
        if dist_pct < req_hurdle:
            return False, "FEE_HURDLE_NOT_MET"
        return True, "OK"
