"""Runtime discovery for the QuantJourney Backtester toolchain.

The application works with or without the ``quantjourney-bt`` distribution
installed.  When it is available the portfolio accounting, rebalancing,
walk-forward statistics and indicator library come from QuantJourney; when it
is missing a deterministic native fallback keeps the workflow functional and
the capability response tells the operator exactly what is degraded.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

REQUIRED_PACKAGES = ("pandas", "numpy")
QJ_PACKAGES = ("quantjourney_ti", "backtester")


@lru_cache(maxsize=1)
def qj_runtime_info() -> dict[str, Any]:
    """Detect optional dependencies and versions without raising."""

    info: dict[str, Any] = {
        "python": None,
        "pandas": None,
        "numpy": None,
        "qj_ti": None,
        "qj_backtester": None,
        "available": False,
        "ti_available": False,
        "missing": [],
    }
    try:
        import platform

        info["python"] = platform.python_version()
    except Exception:  # pragma: no cover - platform always exists
        pass

    for module_name, key in (("pandas", "pandas"), ("numpy", "numpy")):
        try:
            module = __import__(module_name)
            info[key] = getattr(module, "__version__", "unknown")
        except Exception:
            info["missing"].append(module_name)

    try:
        import quantjourney_ti

        info["qj_ti"] = getattr(quantjourney_ti, "__version__", "unknown")
        info["ti_available"] = True
    except Exception:
        info["missing"].append("quantjourney_ti")

    try:
        import backtester

        info["qj_backtester"] = getattr(backtester, "__version__", "unknown")
        info["available"] = True
    except Exception:
        info["missing"].append("quantjourney-bt")

    info["available"] = bool(info["available"] and info["pandas"] and info["numpy"])
    return info


def qj_available() -> bool:
    """True when the QuantJourney engine can be used."""

    return bool(qj_runtime_info()["available"])


def ti_available() -> bool:
    return bool(qj_runtime_info()["ti_available"])


def require_qj() -> None:
    """Raise a helpful error when the QJ engine is required but absent."""

    info = qj_runtime_info()
    if not info["available"]:
        missing = ", ".join(info["missing"]) or "quantjourney-bt"
        raise RuntimeError(
            "The QuantJourney backtester is not installed. "
            f"Missing: {missing}. Run `python -m pip install -r requirements.txt` "
            "(or `pip install quantjourney-bt`) to enable the full engine."
        )


def capabilities() -> dict[str, Any]:
    """Capability envelope consumed by the UI, CLI and MCP clients."""

    from app.backtest.strategies import MODELS

    info = qj_runtime_info()
    return {
        "engine": "quantjourney-bt" if info["available"] else "native-fallback",
        "qjAvailable": info["available"],
        "tiAvailable": info["ti_available"],
        "versions": {
            "quantjourneyBt": info["qj_backtester"],
            "quantjourneyTi": info["qj_ti"],
            "pandas": info["pandas"],
            "numpy": info["numpy"],
            "python": info["python"],
        },
        "missing": info["missing"],
        "models": MODELS,
        "features": {
            "weightsMode": True,
            "transactionCosts": True,
            "rebalancePolicies": True,
            "walkForward": True,
            "optimization": True,
            "costStress": True,
            "dashboardReport": True,
            "deflatedSharpe": info["available"],
            "rankStability": info["available"],
        },
    }
