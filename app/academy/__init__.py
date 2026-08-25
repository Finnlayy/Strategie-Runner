"""
Academy & Champion vs. Challenger A/B Racing Engine (Modul 7).
"""

from app.academy.hurst import calculate_hurst_exponent, classify_market_regime
from app.academy.drills import DrillEvaluator, drill_evaluator, DrillScenarioType
from app.academy.ab_racing import ShadowRaceManager, shadow_race_manager
from app.academy.facade import AcademyRegistryFacade, academy_facade

__all__ = [
    "calculate_hurst_exponent",
    "classify_market_regime",
    "DrillEvaluator",
    "drill_evaluator",
    "DrillScenarioType",
    "ShadowRaceManager",
    "shadow_race_manager",
    "AcademyRegistryFacade",
    "academy_facade",
]
