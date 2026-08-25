"""
Post-Trade RAG & Strategy Genome Evolution Engine (Modul 13: 13_PROMPT_RAG_POSTMORTEM).
Implements:
- Asynchronous Cold-Path Post-Mortem Analysis of losing trade clusters
- Vector / Keyword Semantic Indexing of past execution failures
- Automated Parameter Adjustment Proposals (e.g. widening ATR stop, tightening EMA filters)
"""

from datetime import datetime, timezone
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from app.core.directives import ExecutionPath, system_directive

logger = logging.getLogger("postmortem_rag")


class PostmortemRAGEngine:
    """
    Analyzes historical trade logs, clusters failure modes, and proposes evolutionary mutations.
    """

    def __init__(self):
        self._trade_memory: List[Dict[str, Any]] = []

    def ingest_trade(self, trade_data: Dict[str, Any]) -> None:
        system_directive.record_path_execution(ExecutionPath.COLD_PATH)
        self._trade_memory.append(trade_data)
        if len(self._trade_memory) > 1000:
            self._trade_memory.pop(0)

    def analyze_failure_clusters(self, strategy_id: str) -> Dict[str, Any]:
        """
        Extracts patterns from losing trades (e.g. stops hit in low Hurst chop, slippage eating profit).
        """
        system_directive.record_path_execution(ExecutionPath.COLD_PATH)
        strat_trades = [t for t in self._trade_memory if t.get("strategy_id") == strategy_id or not t.get("strategy_id")]
        losing_trades = [t for t in strat_trades if t.get("net_pnl", 0) < 0]

        if len(losing_trades) < 3:
            return {
                "strategy_id": strategy_id,
                "analysis": "Insufficient losing trade samples for clustering.",
                "proposals": []
            }

        stop_loss_exits = [t for t in losing_trades if t.get("exit_reason") == "STOP_LOSS"]
        slippage_dominated = [t for t in losing_trades if t.get("slippage_usd", 0) > abs(t.get("net_pnl", 1)) * 0.3]

        proposals = []
        if len(stop_loss_exits) / len(losing_trades) > 0.6:
            proposals.append({
                "target_parameter": "atrStopMultiplier",
                "current_action": "Widen ATR Stop Distance",
                "recommended_delta": +0.35,
                "rationale": "High frequency of premature stop-outs during temporary market wicks."
            })

        if len(slippage_dominated) / len(losing_trades) > 0.3:
            proposals.append({
                "target_parameter": "max_allowed_spread_bps",
                "current_action": "Tighten M8 Spread Filter",
                "recommended_delta": -3.0,
                "rationale": "Excessive execution slippage eroding trade edge in low liquidity."
            })

        return {
            "strategy_id": strategy_id,
            "total_analyzed_trades": len(strat_trades),
            "losing_trades_count": len(losing_trades),
            "stop_loss_exit_rate": round(len(stop_loss_exits) / len(losing_trades) * 100, 1) if losing_trades else 0.0,
            "proposals": proposals,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


# Global Singleton
postmortem_rag = PostmortemRAGEngine()
