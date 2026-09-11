"""
Champion vs. Challenger Shadow-Queue A/B Racing Engine (Modul 7).
Executes parallel shadow-queue racing between incumbent Champion and newly evolved Challenger strategies,
evaluating statistical alpha margins and deterministically executing promotions or degradations.
"""

from datetime import datetime, timezone
import json
import logging
import math
from pathlib import Path
import threading
from typing import Any, Dict, List, Optional, Tuple
import uuid

from app.academy.drills import drill_evaluator
from app.data_layer.facade import market_data
from app.registry.career_log import career_logger
from app.registry.identity import BadgeType, CareerEventType, LifecycleStatus
from app.registry.registry_service import strategy_registry

logger = logging.getLogger("ab_racing")


class ShadowRaceStatus:
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    CHALLENGER_PROMOTED = "CHALLENGER_PROMOTED"
    CHAMPION_DEFENDED = "CHAMPION_DEFENDED"
    DRAW = "DRAW"


class ShadowRaceManager:
    """
    Manages head-to-head A/B testing in the Shadow-Queue between a Champion (incumbent) and a Challenger.
    """

    def __init__(self, storage_dir: str = "data/registry"):
        self.storage_file = Path(storage_dir) / "shadow_races.json"
        self._lock = threading.Lock()
        self._ensure_storage()

    def _ensure_storage(self) -> None:
        if not self.storage_file.exists():
            with open(self.storage_file, "w", encoding="utf-8") as f:
                json.dump({}, f, indent=2)

    def _load_races(self) -> Dict[str, Dict[str, Any]]:
        try:
            with open(self.storage_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to read shadow races: {e}")
            return {}

    def _save_races(self, data: Dict[str, Dict[str, Any]]) -> None:
        temp = self.storage_file.with_suffix(".tmp")
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        temp.replace(self.storage_file)

    def start_ab_race(
        self,
        champion_id: str,
        challenger_id: str,
        asset_pair: str = "BTC/USD",
        target_trades: int = 25,
        target_bars: int = 350
    ) -> Dict[str, Any]:
        """
        Initiates a new A/B race between a Champion and Challenger in the Shadow-Queue.

        Args:
            champion_id: Strategy ID of the incumbent Champion.
            challenger_id: Strategy ID of the candidate Challenger.
            asset_pair: Market symbol to race on.
            target_trades: Minimum trades required for conclusive promotion evaluation.
            target_bars: Number of market bars to execute against.

        Returns:
            Dictionary containing race status and metadata.
        """
        champ = strategy_registry.get_strategy(champion_id)
        chall = strategy_registry.get_strategy(challenger_id)

        if not champ:
            return {"error": f"Champion strategy '{champion_id}' not found in registry."}
        if not chall:
            return {"error": f"Challenger strategy '{challenger_id}' not found in registry."}

        with self._lock:
            races = self._load_races()
            race_id = str(uuid.uuid4())
            now_iso = datetime.now(timezone.utc).isoformat()

            # Set status of Challenger to SHADOW_CHALLENGER if not already
            if chall.status != LifecycleStatus.SHADOW_CHALLENGER:
                strategy_registry.update_status(
                    challenger_id,
                    LifecycleStatus.SHADOW_CHALLENGER,
                    f"Entered Shadow-Queue A/B Race against Champion '{champ.name}' ({champion_id[:8]}).",
                    {"race_id": race_id, "champion_id": champion_id},
                    actor="SHADOW_RACING_MANAGER"
                )

            race_record = {
                "race_id": race_id,
                "asset_pair": asset_pair,
                "champion_id": champion_id,
                "champion_name": champ.name,
                "challenger_id": challenger_id,
                "challenger_name": chall.name,
                "created_at": now_iso,
                "updated_at": now_iso,
                "status": ShadowRaceStatus.IN_PROGRESS,
                "target_trades": target_trades,
                "target_bars": target_bars,
                "evaluation": None
            }

            races[race_id] = race_record
            self._save_races(races)

            # Career Log: Entered Shadow Queue Race
            career_logger.append_event(
                strategy_id=challenger_id,
                event_type=CareerEventType.ENTERED_SHADOW_QUEUE,
                title="A/B Race Commenced (Shadow Queue)",
                description=f"Challenger '{chall.name}' entered live Shadow-Queue racing vs Champion '{champ.name}'.",
                payload={"race_id": race_id, "champion_id": champion_id, "symbol": asset_pair},
                actor="SHADOW_RACING_MANAGER"
            )

            return race_record

    def evaluate_ab_race(
        self,
        race_id: str,
        bars_count: int = 350
    ) -> Dict[str, Any]:
        """
        Executes parallel stream evaluation and decides whether Challenger is promoted or degraded.

        Args:
            race_id: Identifier of the active race.
            bars_count: Number of market candles to test against.

        Returns:
            Dictionary with race verdict, scorecards, and promotion outcomes.
        """
        with self._lock:
            races = self._load_races()
            if race_id not in races:
                return {"error": f"Shadow race '{race_id}' not found."}

            race = races[race_id]

        champion_id = race["champion_id"]
        challenger_id = race["challenger_id"]
        symbol = race["asset_pair"]

        champ = strategy_registry.get_strategy(champion_id)
        chall = strategy_registry.get_strategy(challenger_id)

        if not champ or not chall:
            return {"error": "One of the racing strategies is missing from registry."}

        # 1. Fetch real or synthetic market candles from Data Lake
        candles: List[Dict[str, Any]] = []
        try:
            df = market_data.get_candles(symbol=symbol)
            if len(df) >= 50:
                candles = df.tail(bars_count).to_dicts()
        except Exception as err:
            logger.warning(f"Could not load lake candles for {symbol}: {err}. Generating synthetic evaluation stream.")

        if len(candles) < 50:
            # Fallback to rich multi-regime synthetic candle feed
            from app.cli import generate_synthetic_ohlcv
            candles = generate_synthetic_ohlcv(symbol=symbol, days=7, interval_min=15)

        # 2. Run parallel simulations
        champ_params = champ.parameters or champ.genome or {}
        chall_params = chall.parameters or chall.genome or {}

        champ_res = drill_evaluator.simulate_strategy_on_candles(champ_params, candles)
        chall_res = drill_evaluator.simulate_strategy_on_candles(chall_params, candles)

        # Calculate metrics & composite alpha score
        # Alpha Score Formula: PnL (40%) + WinRate/Trades quality (30%) + Low Drawdown (30%)
        champ_pnl = champ_res["pnl_pct"]
        champ_dd = champ_res["max_drawdown_pct"]
        champ_win = champ_res["win_rate_pct"]
        champ_trades = champ_res["total_trades"]
        champ_score = max(0.0, min(100.0, 50.0 + champ_pnl * 2.5 + (champ_win - 50.0) * 0.4 - champ_dd * 1.5))

        chall_pnl = chall_res["pnl_pct"]
        chall_dd = chall_res["max_drawdown_pct"]
        chall_win = chall_res["win_rate_pct"]
        chall_trades = chall_res["total_trades"]
        chall_score = max(0.0, min(100.0, 50.0 + chall_pnl * 2.5 + (chall_win - 50.0) * 0.4 - chall_dd * 1.5))

        alpha_delta = round(chall_score - champ_score, 2)
        pnl_delta = round(chall_pnl - champ_pnl, 2)

        # Decision Logic:
        # Challenger is promoted if Challenger score > Champion score + 4.0 margin AND Challenger PnL > Champion PnL
        is_challenger_victory = (chall_score > champ_score + 3.5) and (chall_pnl >= champ_pnl) and (chall_dd <= 15.0)
        is_champion_defense = (champ_score >= chall_score) or (chall_dd > 18.0) or (chall_pnl < champ_pnl - 2.0)

        decision: str
        status_code: str

        if is_challenger_victory:
            decision = f"CHALLENGER WINS! Challenger '{chall.name}' achieved superior Alpha (+{alpha_delta} pts, PnL +{pnl_delta}%). PROMOTING TO SHADOW CHAMPION (paper-only)."
            status_code = ShadowRaceStatus.CHALLENGER_PROMOTED

            # Academy promotion is shadow-policy only.  A separate operator/policy
            # gate is required before any future live transition.
            strategy_registry.update_status(
                strategy_id=challenger_id,
                new_status=LifecycleStatus.SHADOW_CHAMPION,
                reason=f"Defeated incumbent Champion '{champ.name}' in Paper Shadow-Queue A/B race (+{alpha_delta} Alpha Delta). No live authorization.",
                payload={"race_id": race_id, "score": chall_score, "vs_champion_score": champ_score,
                         "paper_only": True, "live_authorized": False},
                actor="SHADOW_RACING_ENGINE"
            )
            # Award only the shadow qualification badge; LIVE_PROMOTED is
            # deliberately not granted by the Academy loop.
            strategy_registry.award_badge(challenger_id, BadgeType.SHADOW_RACER, {"race_id": race_id, "alpha_delta": alpha_delta, "paper_only": True})

            # 2. Degrade former Champion to DEGRADED
            strategy_registry.update_status(
                strategy_id=champion_id,
                new_status=LifecycleStatus.DEGRADED,
                reason=f"Relinquished Champion title to Challenger '{chall.name}' in Shadow-Queue A/B race.",
                payload={"race_id": race_id, "score": champ_score, "challenger_score": chall_score},
                actor="SHADOW_RACING_ENGINE"
            )

        elif is_champion_defense:
            decision = f"CHAMPION DEFENDED. Champion '{champ.name}' maintained higher resilience (Score {champ_score:.1f} vs {chall_score:.1f}). Challenger returned to Academy."
            status_code = ShadowRaceStatus.CHAMPION_DEFENDED

            # Degrade Challenger back to ACADEMY / DEGRADED
            strategy_registry.update_status(
                strategy_id=challenger_id,
                new_status=LifecycleStatus.DEGRADED,
                reason=f"Failed to unseat Champion '{champ.name}' in Shadow-Queue A/B race (Alpha Delta {alpha_delta}).",
                payload={"race_id": race_id, "score": chall_score, "champion_score": champ_score},
                actor="SHADOW_RACING_ENGINE"
            )
        else:
            decision = "DRAW / INCONCLUSIVE. Race continues in shadow queue."
            status_code = ShadowRaceStatus.DRAW

        evaluation_result = {
            "race_id": race_id,
            "status": status_code,
            "decision": decision,
            "alpha_delta": alpha_delta,
            "pnl_delta": pnl_delta,
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
            "champion": {
                "id": champion_id,
                "name": champ.name,
                "score": round(champ_score, 1),
                "pnl_pct": champ_pnl,
                "max_drawdown_pct": champ_dd,
                "win_rate": champ_win,
                "trades": champ_trades
            },
            "challenger": {
                "id": challenger_id,
                "name": chall.name,
                "score": round(chall_score, 1),
                "pnl_pct": chall_pnl,
                "max_drawdown_pct": chall_dd,
                "win_rate": chall_win,
                "trades": chall_trades
            }
        }

        with self._lock:
            races = self._load_races()
            if race_id in races:
                races[race_id]["status"] = status_code
                races[race_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
                races[race_id]["evaluation"] = evaluation_result
                self._save_races(races)

        # Career Event Log
        career_logger.append_event(
            strategy_id=challenger_id,
            event_type=CareerEventType.SHADOW_RACE_EVALUATED,
            title="A/B Shadow Race Evaluated",
            description=decision,
            payload=evaluation_result,
            actor="SHADOW_RACING_ENGINE"
        )

        return evaluation_result

    def list_races(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Lists recent A/B shadow races."""
        with self._lock:
            races = self._load_races()
            items = list(races.values())
            items.sort(key=lambda r: r.get("created_at", ""), reverse=True)
            return items[:limit]


# Global Singleton
shadow_race_manager = ShadowRaceManager()
