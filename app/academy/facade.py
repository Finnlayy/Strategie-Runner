"""
Academy & Strategy Registry Facade (Modul 6 & 7).
Provides high-level programmatic interfaces for CLI, testing, and API routes.
"""

from typing import Any, Dict, List, Optional

from app.academy.ab_racing import shadow_race_manager
from app.academy.drills import drill_evaluator
from app.academy.hurst import calculate_hurst_exponent, classify_market_regime
from app.registry.career_log import career_logger
from app.registry.identity import LifecycleStatus
from app.registry.registry_service import strategy_registry


class AcademyRegistryFacade:
    """Unified Facade for Strategy Registry & Auto-Loop Academy Drills."""

    @staticmethod
    def get_overview_summary() -> Dict[str, Any]:
        """Returns consolidated dashboard summary across registry, drills, and shadow races."""
        strategies = strategy_registry.list_strategies(limit=100)
        recent_events = career_logger.get_all_recent_events(limit=25)
        recent_races = shadow_race_manager.list_races(limit=10)

        # Group by status
        by_status: Dict[str, int] = {}
        for s in strategies:
            st = s.status.value
            by_status[st] = by_status.get(st, 0) + 1

        total_badges = sum(len(s.badges) for s in strategies)

        return {
            "total_strategies": len(strategies),
            "strategies_by_status": by_status,
            "total_badges_awarded": total_badges,
            "active_shadow_races": len([r for r in recent_races if r.get("status") == "IN_PROGRESS"]),
            "recent_career_events": [e.model_dump() for e in recent_events],
            "strategies": [s.model_dump() for s in strategies],
            "recent_races": recent_races
        }

    @staticmethod
    def run_strategy_drills(strategy_id: str, symbol: str = "BTC/USD") -> Dict[str, Any]:
        """Runs the synthetic stress drill battery for a given strategy."""
        return drill_evaluator.run_all_drills_for_strategy(strategy_id, symbol=symbol)

    @staticmethod
    def start_shadow_race(champion_id: str, challenger_id: str, symbol: str = "BTC/USD") -> Dict[str, Any]:
        """Starts an A/B race in the shadow queue between champion and challenger."""
        return shadow_race_manager.start_ab_race(champion_id, challenger_id, asset_pair=symbol)

    @staticmethod
    def evaluate_shadow_race(race_id: str) -> Dict[str, Any]:
        """Evaluates an active shadow race and executes promotion/degradation."""
        return shadow_race_manager.evaluate_ab_race(race_id)

    @staticmethod
    def analyze_regime(prices: List[float]) -> Dict[str, Any]:
        """Analyzes market regime using Hurst exponent."""
        return classify_market_regime(prices)


# Global Singleton
academy_facade = AcademyRegistryFacade()
