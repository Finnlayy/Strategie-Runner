"""Academy package with optional heavy drill imports kept lazy.

The Jules contract/loop must be runnable in a stdlib-only worker.  UI/drill
modules may use numpy/pydantic when installed, but importing the package itself
must not make the contract bridge unavailable.
"""

__all__ = [
    "calculate_hurst_exponent", "classify_market_regime", "DrillEvaluator",
    "drill_evaluator", "DrillScenarioType", "ShadowRaceManager",
    "shadow_race_manager", "AcademyRegistryFacade", "academy_facade",
    "AutonomousLearningLoop", "NightTrainJob", "run_night_train", "AcademyState",
]


def __getattr__(name):
    if name in {"calculate_hurst_exponent", "classify_market_regime"}:
        from app.academy.hurst import calculate_hurst_exponent, classify_market_regime
        return {"calculate_hurst_exponent": calculate_hurst_exponent,
                "classify_market_regime": classify_market_regime}[name]
    if name in {"DrillEvaluator", "drill_evaluator", "DrillScenarioType"}:
        from app.academy.drills import DrillEvaluator, drill_evaluator, DrillScenarioType
        return {"DrillEvaluator": DrillEvaluator, "drill_evaluator": drill_evaluator,
                "DrillScenarioType": DrillScenarioType}[name]
    if name in {"ShadowRaceManager", "shadow_race_manager"}:
        from app.academy.ab_racing import ShadowRaceManager, shadow_race_manager
        return {"ShadowRaceManager": ShadowRaceManager, "shadow_race_manager": shadow_race_manager}[name]
    if name in {"AcademyRegistryFacade", "academy_facade"}:
        from app.academy.facade import AcademyRegistryFacade, academy_facade
        return {"AcademyRegistryFacade": AcademyRegistryFacade, "academy_facade": academy_facade}[name]
    if name == "AcademyState":
        from app.academy.state import AcademyState
        return AcademyState
    if name == "AutonomousLearningLoop":
        from app.academy.autonomous_loop import AutonomousLearningLoop
        return AutonomousLearningLoop
    if name in {"NightTrainJob", "run_night_train"}:
        from app.academy.night_train import NightTrainJob, run_night_train
        return {"NightTrainJob": NightTrainJob, "run_night_train": run_night_train}[name]
    raise AttributeError(name)
