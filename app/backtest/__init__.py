"""QuantJourney Backtester integration for the Strategie-Runner workflow.

The package wraps the open-source ``quantjourney-bt`` engine
(https://github.com/QuantJourneyOrg/quantjourney-bt) and exposes the complete
research workflow to the rest of the application:

* market-data normalisation (Kraken payloads, CSV, DuckDB lake, sample data)
* signal research with ``quantjourney_ti`` indicators and a strategy registry
* portfolio construction, rebalancing and transaction-cost accounting
* performance analytics, trade ledger and benchmark attribution
* walk-forward validation, parameter optimisation and cost stress tests
* persistent run artifacts (``summary.json``, ``metrics.csv``, dashboard)

Heavy scientific dependencies (pandas / quantjourney-bt) are optional at
import time so the rest of the application keeps working in minimal
environments.  Import :mod:`app.backtest.service` only where a backtest is
actually executed, or use the CLI bridge ``python -m app.backtest.cli``.
"""

from __future__ import annotations

__all__ = [
    "BacktestConfig",
    "BacktestError",
    "capabilities",
    "run_backtest",
]

_PACKAGE_VERSION = "1.0.0"


def __getattr__(name: str):  # pragma: no cover - thin lazy-import shim
    if name in {"BacktestConfig", "BacktestError"}:
        from app.backtest.config import BacktestConfig, BacktestError

        return {"BacktestConfig": BacktestConfig, "BacktestError": BacktestError}[name]
    if name == "capabilities":
        from app.backtest.qj_runtime import capabilities

        return capabilities
    if name == "run_backtest":
        from app.backtest.service import run_backtest

        return run_backtest
    raise AttributeError(name)
