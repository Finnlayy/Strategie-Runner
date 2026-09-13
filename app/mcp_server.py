"""Model Context Protocol server for the Python quantitative engine.

The Python SDK (package ``mcp``) exposes the deterministic research, registry,
risk, and Alpha/SIGMA orchestrator functions over stdio.  It intentionally does
not offer live-order placement: paper-only and advisory paths belong in MCP,
while exchange capital controls remain in the normal application/API layer.

Run:
    python -m app.mcp_server

Install dependencies first:
    python -m pip install -r requirements.txt
"""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import datetime
from decimal import Decimal
from enum import Enum
import json
import sys
from typing import Any, Optional

try:
    try:
        # MCP Python SDK 2.x renamed FastMCP to MCPServer.
        from mcp.server.mcpserver import MCPServer as FastMCP
    except ImportError:  # SDK 1.x
        from mcp.server.fastmcp import FastMCP
    from mcp.types import ToolAnnotations
except ModuleNotFoundError as exc:  # pragma: no cover - operator-facing dependency guard
    if exc.name == "mcp":
        print(
            "The Python MCP SDK is not installed. Run `python -m pip install -r requirements.txt`.",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc
    raise


mcp = FastMCP(
    name="strategie-runner-python",
    instructions=(
        "Deterministic quantitative research tools for Strategie-Runner. "
        "Prefer closed-price data, paper-only verdicts, and explicit risk gates. "
        "These tools do not place live exchange orders."
    ),
)

READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
READ_ONLY_NETWORK = ToolAnnotations(readOnlyHint=True, openWorldHint=True)
LOCAL_MUTATION = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)
DESTRUCTIVE_LOCAL = ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=True, openWorldHint=False)


def json_safe(value: Any) -> Any:
    """Convert project dataclasses/Pydantic models/polars values to JSON-compatible data."""
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    if is_dataclass(value):
        return json_safe(asdict(value))
    if hasattr(value, "model_dump"):
        try:
            return json_safe(value.model_dump())
        except TypeError:
            return json_safe(value.model_dump())
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "to_list"):
        return json_safe(value.to_list())
    if hasattr(value, "to_dicts"):
        return json_safe(value.to_dicts())
    if hasattr(value, "__dict__"):
        return json_safe(vars(value))
    return str(value)


def dumps(value: Any) -> str:
    return json.dumps(json_safe(value), indent=2, ensure_ascii=False, default=str)


def _prices(symbol: str, seed_if_missing: bool, days: int) -> list[float]:
    """Load closes from the lake, optionally seeding deterministic synthetic OHLCV."""
    from app.cli import generate_synthetic_ohlcv
    from app.data_layer.facade import market_data

    frame = market_data.get_candles(symbol=symbol)
    if len(frame) == 0:
        if not seed_if_missing:
            raise ValueError(
                f"No market data stored for {symbol}. Call seed_synthetic_ohlcv first or set seed_if_missing=true."
            )
        candles = generate_synthetic_ohlcv(symbol=symbol, days=max(1, int(days)))
        market_data.ingest_candles(candles, symbol=symbol)
        frame = market_data.get_candles(symbol=symbol)
    return [float(x) for x in frame["close"].to_list()]


def _orchestrator():
    from app.orchestrator.alpha_sigma_engine import AlphaSigmaOrchestrator

    return AlphaSigmaOrchestrator()


# ---------------------------------------------------------------------------
# System, symbols, and market data
# ---------------------------------------------------------------------------


@mcp.tool(
    name="system_status",
    title="System status",
    description="Operational directive, resource guard, storage tiering, watchdog, and registered-strategy count.",
    annotations=READ_ONLY,
)
def system_status() -> dict[str, Any]:
    from app.core.directives import system_directive
    from app.core.resource_guard import resource_guard
    from app.data_layer.tiering import storage_tiering
    from app.monitoring.watchdog_sse import system_watchdog
    from app.registry import strategy_registry

    return json_safe(
        {
            "directive": system_directive.get_system_telemetry(),
            "resource_guard": resource_guard.evaluate_load_shedding(0.0),
            "watchdog": system_watchdog.get_watchdog_status(),
            "storage_tiering": storage_tiering.get_tiering_status(),
            "strategies_registered": len(strategy_registry.list_strategies()),
            "timestamp": datetime.now().isoformat(),
        }
    )


@mcp.tool(
    name="resolve_symbol",
    title="Resolve trading symbol",
    description="Normalize an arbitrary ticker to UI, lake, Kraken spot, and Kraken futures symbols.",
    annotations=READ_ONLY,
)
def resolve_symbol(raw_symbol: str = "btc usd") -> dict[str, Any]:
    from app.data_layer.symbol_resolver import ExchangeSymbolNormalizer

    return json_safe(ExchangeSymbolNormalizer.resolve_all(raw_symbol))


@mcp.tool(
    name="seed_synthetic_ohlcv",
    title="Seed synthetic OHLCV",
    description="Generate and ingest synthetic OHLCV candles into the local DuckDB/Parquet data lake.",
    annotations=LOCAL_MUTATION,
)
def seed_synthetic_ohlcv(symbol: str = "BTC/USD", days: int = 3) -> dict[str, Any]:
    from app.cli import generate_synthetic_ohlcv
    from app.data_layer.facade import market_data

    symbol = symbol.upper()
    candles = generate_synthetic_ohlcv(symbol=symbol, days=max(1, min(30, int(days))))
    written = market_data.ingest_candles(candles, symbol=symbol)
    return {"symbol": symbol, "candles": len(candles), "files_written": written}


@mcp.tool(
    name="dfa_hurst",
    title="DFA Hurst regime",
    description="Compute Detrended Fluctuation Analysis/Hurst regime. Uses stored data, or seeds synthetic data when requested.",
    annotations=ToolAnnotations(readOnlyHint=False, openWorldHint=False),
)
def dfa_hurst(symbol: str = "BTC/USD", seed_if_missing: bool = True, days: int = 5) -> dict[str, Any]:
    from app.regime.dfa_engine import dfa_engine

    symbol = symbol.upper()
    closes = _prices(symbol, seed_if_missing, days)
    result = dfa_engine.compute_hurst_dfa(closes)
    result["symbol"] = symbol
    result["sample_size"] = len(closes)
    return json_safe(result)


@mcp.tool(
    name="asset_ampel",
    title="Asset Ampelsystem",
    description="Run the asset traffic-light/calibration test (variance ratio, Ljung-Box, ARCH-style evidence).",
    annotations=ToolAnnotations(readOnlyHint=False, openWorldHint=False),
)
def asset_ampel(symbol: str = "BTC/USD", seed_if_missing: bool = True, days: int = 5) -> dict[str, Any]:
    from app.regime.asset_calibrator import asset_calibrator

    symbol = symbol.upper()
    closes = _prices(symbol, seed_if_missing, days)
    return json_safe(asset_calibrator.evaluate_asset_ampel(symbol, closes))


@mcp.tool(
    name="sigma_indicators",
    title="Sigma indicators",
    description="Calculate runner-identical z-score, ATR, Hurst, EMAs, breakout bands, MOS scores, and signal flags.",
    annotations=READ_ONLY,
)
def sigma_indicators(
    prices: list[float],
    fast_ema: Optional[int] = None,
    slow_ema: Optional[int] = None,
    mean_reversion_lookback: Optional[int] = None,
    atr_lookback: Optional[int] = None,
) -> dict[str, Any]:
    from app.orchestrator.alpha_sigma_engine import sigma_indicators

    params = {
        key: value
        for key, value in {
            "fastEma": fast_ema,
            "slowEma": slow_ema,
            "meanReversionLookback": mean_reversion_lookback,
            "atrLookback": atr_lookback,
        }.items()
        if value is not None
    }
    return json_safe(sigma_indicators(prices, params or None))


# ---------------------------------------------------------------------------
# Risk and validation primitives
# ---------------------------------------------------------------------------


@mcp.tool(
    name="sentiment_score",
    title="Score news sentiment",
    description="Deterministic/local FinBERT-style news and risk sentiment scoring with circuit-breaker output.",
    annotations=READ_ONLY,
)
def sentiment_score(text: str) -> dict[str, Any]:
    from app.risk.finbert_risk import finbert_risk_scorer

    if not text.strip():
        raise ValueError("text must not be empty")
    return json_safe(finbert_risk_scorer.score_text(text))


@mcp.tool(
    name="statistical_bootstrap",
    title="Statistical bootstrap validation",
    description="Run stationary block bootstrap and deflated Sharpe/selection-bias validation.",
    annotations=READ_ONLY,
)
def statistical_bootstrap(trials: int = 200) -> dict[str, Any]:
    import random

    from app.validation.bootstrap import statistical_hardness

    trials = max(20, min(2000, int(trials)))
    returns = [random.gauss(0.0008, 0.012) for _ in range(500)]
    trial_sharpes = [random.gauss(1.2, 0.4) for _ in range(35)]
    return json_safe(statistical_hardness.run_full_validation(returns, n_bootstrap=trials, num_trials=len(trial_sharpes)))


@mcp.tool(
    name="m8_judge",
    title="M8 order judge and Kelly sizing",
    description="Evaluate a hypothetical order through the M8 reject gates and fractional Kelly/volatility sizing.",
    annotations=READ_ONLY,
)
def m8_judge(
    symbol: str = "BTC/USD",
    qty: float = 0.5,
    side: str = "BUY",
    mid_price: float = 50_000.0,
    available_cash: float = 100_000.0,
    win_rate: float = 0.60,
    win_loss_ratio: float = 1.8,
    target_vol: float = 0.15,
) -> dict[str, Any]:
    import random

    from app.execution.kelly_sizing import kelly_sizer
    from app.execution.m8_judge import m8_judge

    side = side.upper()
    if side not in {"BUY", "SELL"}:
        raise ValueError("side must be BUY or SELL")
    gate = m8_judge.judge_order(
        strategy_id="mcp-advisory",
        symbol=symbol.upper(),
        side=side,
        mid_price=float(mid_price),
        best_bid=float(mid_price) - 5.0,
        best_ask=float(mid_price) + 5.0,
        requested_qty=float(qty),
        available_cash=float(available_cash),
        recent_prices=[float(mid_price) + random.gauss(0, 50) for _ in range(50)],
        sentiment_score=0.1,
        daily_volume_usd=50_000_000.0,
        current_drawdown_pct=3.2,
    )
    sizing = kelly_sizer.calculate_allocation(
        win_rate=float(win_rate),
        win_loss_ratio=float(win_loss_ratio),
        portfolio_equity=float(available_cash),
        target_volatility=float(target_vol),
        current_asset_volatility=0.024,
    )
    return json_safe({"m8_verdict": gate, "kelly_sizing": sizing, "symbol": symbol.upper()})


@mcp.tool(
    name="reconciliation_audit",
    title="Reconciliation audit",
    description="Compare expected and actual positions and report drift/reconciliation actions.",
    annotations=READ_ONLY,
)
def reconciliation_audit(expected_btc: float = 1.5, expected_eth: float = 20.0,
                         actual_btc: float = 1.5, actual_eth: float = 19.9) -> dict[str, Any]:
    from app.execution.reconciliation import reconciliation_daemon

    result = reconciliation_daemon.reconcile_positions(
        {"BTC/USD": float(expected_btc), "ETH/USD": float(expected_eth)},
        {"BTC/USD": float(actual_btc), "ETH/USD": float(actual_eth)},
    )
    return json_safe(result)


@mcp.tool(
    name="postmortem_query",
    title="Post-mortem knowledge query",
    description="Query similar incidents from the deterministic post-mortem/RAG knowledge base.",
    annotations=READ_ONLY,
)
def postmortem_query(query_text: str = "severe slippage and liquidation cascade", top_k: int = 3) -> dict[str, Any]:
    from app.analysis.postmortem_rag import postmortem_rag

    return json_safe(postmortem_rag.query_similar_incidents(query_text=query_text, top_k=max(1, min(10, int(top_k)))))


@mcp.tool(
    name="rl_fast_path",
    title="RL fast-path inference",
    description="Run the lightweight, deterministic sub-2ms RL policy network for a supplied feature vector.",
    annotations=READ_ONLY,
)
def rl_fast_path(features: Optional[list[float]] = None) -> dict[str, Any]:
    from app.engine.rl_fast_path import rl_fast_path

    state = features or [0.015, 0.48, 1.25, 0.003, 0.05, 0.82]
    if len(state) < 3:
        raise ValueError("Provide at least three feature values")
    return json_safe(rl_fast_path.predict_action(state))


# ---------------------------------------------------------------------------
# Registry and academy
# ---------------------------------------------------------------------------


@mcp.tool(
    name="registry_overview",
    title="Registry overview",
    description="Summary of strategy identities, status counts, badges, races, and recent career events.",
    annotations=READ_ONLY,
)
def registry_overview() -> dict[str, Any]:
    from app.academy.facade import academy_facade

    return json_safe(academy_facade.get_overview_summary())


@mcp.tool(
    name="list_registry_strategies",
    title="List registry strategies",
    description="List strategy identities, optionally filtered by lifecycle status and asset pair.",
    annotations=READ_ONLY,
)
def list_registry_strategies(status: Optional[str] = None, asset_pair: Optional[str] = None,
                             limit: int = 100) -> list[dict[str, Any]]:
    from app.registry import LifecycleStatus, strategy_registry

    status_filter = LifecycleStatus(status.upper()) if status else None
    result = strategy_registry.list_strategies(
        status=status_filter,
        asset_pair=asset_pair.upper() if asset_pair else None,
        limit=max(1, min(500, int(limit))),
    )
    return json_safe([item.model_dump() for item in result])


@mcp.tool(
    name="get_career_book",
    title="Get strategy career book",
    description="Read identity, verified badges, append-only career timeline, and integrity status.",
    annotations=READ_ONLY,
)
def get_career_book(strategy_id: str) -> dict[str, Any]:
    from app.registry import strategy_registry

    result = strategy_registry.get_career_book(strategy_id)
    if "error" in result:
        raise ValueError(result["error"])
    return json_safe(result)


@mcp.tool(
    name="register_strategy",
    title="Register strategy identity",
    description="Register a new Academy-stage strategy identity in the local immutable career registry.",
    annotations=LOCAL_MUTATION,
)
def register_strategy(
    name: str,
    parameters: dict[str, Any],
    asset_pair: str = "BTC/USD",
    timeframe: str = "15m",
    generation: int = 1,
    genome: Optional[dict[str, Any]] = None,
    code_snippet: Optional[str] = None,
    initial_status: str = "ACADEMY",
) -> dict[str, Any]:
    from app.registry import LifecycleStatus, strategy_registry

    identity = strategy_registry.register_strategy(
        name=name.strip(),
        parameters=parameters,
        genome=genome,
        generation=max(1, int(generation)),
        parent_ids=[],
        asset_pair=asset_pair.upper(),
        timeframe=timeframe,
        code_snippet=code_snippet,
        initial_status=LifecycleStatus(initial_status.upper()),
    )
    return json_safe(identity.model_dump())


@mcp.tool(
    name="run_strategy_drills",
    title="Run Academy stress drills",
    description="Run the mandatory synthetic extreme-market stress drill battery for a registered strategy.",
    annotations=LOCAL_MUTATION,
)
def run_strategy_drills(strategy_id: str, symbol: str = "BTC/USD") -> dict[str, Any]:
    from app.academy.facade import academy_facade

    return json_safe(academy_facade.run_strategy_drills(strategy_id, symbol=symbol.upper()))


@mcp.tool(
    name="start_shadow_race",
    title="Start shadow A/B race",
    description="Start a paper shadow-queue champion/challenger race.",
    annotations=LOCAL_MUTATION,
)
def start_shadow_race(champion_id: str, challenger_id: str, symbol: str = "BTC/USD") -> dict[str, Any]:
    from app.academy.facade import academy_facade

    return json_safe(academy_facade.start_shadow_race(champion_id, challenger_id, symbol.upper()))


@mcp.tool(
    name="evaluate_shadow_race",
    title="Evaluate shadow A/B race",
    description="Evaluate a shadow race and apply the configured promotion/degradation decision.",
    annotations=LOCAL_MUTATION,
)
def evaluate_shadow_race(race_id: str) -> dict[str, Any]:
    from app.academy.facade import academy_facade

    return json_safe(academy_facade.evaluate_shadow_race(race_id))


# ---------------------------------------------------------------------------
# Sigma bridge, Night-Train, and Alpha/SIGMA orchestrator
# ---------------------------------------------------------------------------


@mcp.tool(
    name="quant_backend_status",
    title="Quant backend status",
    description="Inspect selected Sigma/legacy/off backend, availability, and paper-only fail-closed state.",
    annotations=READ_ONLY,
)
def quant_backend_status() -> dict[str, Any]:
    from app.quant.sigma_bridge import quant_backend_status

    return json_safe(quant_backend_status())


@mcp.tool(
    name="evaluate_sigma_quant",
    title="Evaluate Sigma quant request",
    description="Paper-only Sigma bridge evaluation from closed prices; returns regime, verdict, and a PaperIntent.",
    annotations=READ_ONLY,
)
def evaluate_sigma_quant(
    symbol: str,
    prices: list[float],
    requested_qty: float = 0.0,
    parameters: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    from app.quant.sigma_bridge import SigmaQuantBridge

    if len(prices) < 40:
        raise ValueError("Provide at least 40 closed prices")
    payload = {
        "symbol": symbol.upper(),
        "prices": [float(x) for x in prices],
        "requested_qty": float(requested_qty),
        "parameters": parameters or {},
        "execution_mode": "paper",
    }
    return json_safe(SigmaQuantBridge().evaluate_payload(payload))


@mcp.tool(
    name="night_train",
    title="Run Jules Night-Train replay",
    description="Replay the durable paper journal in capped dry-run mode; non-dry-run requires explicit confirmation.",
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False),
)
def night_train(ledger_path: str = "data/paper/paper_intents.jsonl", max_records: int = 500,
                dry_run: bool = True, confirm_write: bool = False) -> dict[str, Any]:
    from app.academy.night_train import run_night_train

    if not dry_run and not confirm_write:
        raise ValueError("dry_run=false requires confirm_write=true")
    return json_safe(
        run_night_train(
            ledger_path=ledger_path,
            dry_run=dry_run,
            max_records=max(1, min(5000, int(max_records))),
            max_cost_usd=0.0,
        )
    )


@mcp.tool(
    name="orchestrator_status",
    title="Alpha/SIGMA orchestrator status",
    description="Read chamber snapshots, portfolio memory, recent decisions, directives, and hook counts.",
    annotations=READ_ONLY,
)
def orchestrator_status(symbol: Optional[str] = None) -> dict[str, Any]:
    return json_safe(_orchestrator().status(symbol.upper() if symbol else None))


@mcp.tool(
    name="orchestrator_hooks",
    title="Orchestrator Grok-bot hooks",
    description="List the machine-readable Grok-bot takeover hooks, blocking status, owners, and fallbacks.",
    annotations=READ_ONLY,
)
def orchestrator_hooks() -> dict[str, Any]:
    from app.orchestrator.alpha_sigma_engine import hook_worklist

    orchestrator = _orchestrator()
    return json_safe(hook_worklist(orchestrator.state))


@mcp.tool(
    name="orchestrator_ingest",
    title="Ingest orchestrator market state",
    description="Ingest closed prices or one price plus equity/cash context into the persistent Alpha/SIGMA state.",
    annotations=LOCAL_MUTATION,
)
def orchestrator_ingest(
    symbol: str,
    prices: Optional[list[float]] = None,
    price: Optional[float] = None,
    equity_usd: Optional[float] = None,
    available_cash_usd: Optional[float] = None,
) -> dict[str, Any]:
    if not prices and price is None:
        raise ValueError("Provide either prices or price")
    state = _orchestrator().ingest(
        symbol.upper(),
        prices=[float(x) for x in prices] if prices is not None else None,
        price=float(price) if price is not None else None,
        equity_usd=float(equity_usd) if equity_usd is not None else None,
        available_cash_usd=float(available_cash_usd) if available_cash_usd is not None else None,
    )
    return json_safe(state.to_dict())


@mcp.tool(
    name="orchestrator_decide",
    title="Run Alpha/SIGMA decision",
    description="Run a deterministic advisory decision cycle. It returns an intent or reject reasons and never dispatches an order.",
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False),
)
def orchestrator_decide(
    symbol: str,
    prices: Optional[list[float]] = None,
    allow_entries: bool = True,
    spread_bps: Optional[float] = None,
    slippage_bps: Optional[float] = None,
) -> dict[str, Any]:
    orchestrator = _orchestrator()
    result = orchestrator.decide(
        symbol.upper(),
        allow_entries=bool(allow_entries),
        spread_bps=float(spread_bps) if spread_bps is not None else None,
        est_slippage_bps=float(slippage_bps) if slippage_bps is not None else None,
        auto_sigma_from=[float(x) for x in prices] if prices is not None else None,
    )
    orchestrator.persist()
    return json_safe(result)


@mcp.tool(
    name="orchestrator_reset",
    title="Reset orchestrator memory",
    description="Clear Alpha/SIGMA in-memory/persisted state for one symbol or all symbols. Broker holdings are not changed.",
    annotations=DESTRUCTIVE_LOCAL,
)
def orchestrator_reset(symbol: Optional[str] = None, confirm: bool = False) -> dict[str, Any]:
    if not confirm:
        raise ValueError("confirm=true is required to reset orchestrator memory")
    return json_safe(_orchestrator().reset(symbol.upper() if symbol else None))


# ---------------------------------------------------------------------------
# Resources and prompt templates
# ---------------------------------------------------------------------------


@mcp.resource(
    "strategie-runner-python://quant-backend",
    name="quant_backend",
    title="Quant backend status",
    description="Selected Sigma/legacy/off quant backend and fail-closed state",
    mime_type="application/json",
)
def quant_backend_resource() -> str:
    from app.quant.sigma_bridge import quant_backend_status

    return dumps(quant_backend_status())


@mcp.resource(
    "strategie-runner-python://registry/overview",
    name="registry_overview",
    title="Registry overview",
    description="Strategy registry overview",
    mime_type="application/json",
)
def registry_overview_resource() -> str:
    from app.academy.facade import academy_facade

    return dumps(academy_facade.get_overview_summary())


@mcp.prompt(
    name="quant_review",
    title="Quant review",
    description="Create a cautious paper-first quantitative review workflow.",
)
def quant_review(symbol: str = "BTC/USD", question: str = "Assess regime, risk gates, and whether an advisory entry is justified.") -> list[dict[str, Any]]:
    return [
        {
            "role": "user",
            "content": {
                "type": "text",
                "text": (
                    f"Review {symbol.upper()} for Strategie-Runner.\n"
                    f"Question: {question}\n"
                    "Use closed-price data and the Sigma/Alpha-SIGMA tools. Report regime, Hurst/z/ATR, "
                    "M8 or allocation constraints, reject reasons, and confidence. This is advisory only; "
                    "do not claim a live order was filled."
                ),
            },
        }
    ]


if __name__ == "__main__":
    mcp.run(transport="stdio")
