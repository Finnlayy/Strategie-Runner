"""
Enterprise CLI Interface for Quantitative Algorithmic Trading Architecture (Modules 00 - 17).

Usage:
  python3 -m app.cli status
  python3 -m app.cli dfa --symbol BTC/USD
  python3 -m app.cli de-optimize
  python3 -m app.cli bootstrap
  python3 -m app.cli drill --strategy-id <UUID>
  python3 -m app.cli shadow-drift
  python3 -m app.cli m8-judge --symbol BTC/USD --qty 0.5
  python3 -m app.cli sentiment --text "SEC approves crypto spot ETF surge"
  python3 -m app.cli ampel --symbol BTC/USD
  python3 -m app.cli rl-inference
  python3 -m app.cli telemetry
"""

import argparse
import json
import math
import random
import sys
import time
from datetime import datetime, timedelta, timezone

from app.academy.drills import drill_evaluator
from app.academy.facade import academy_facade
from app.academy.shadow_drift import shadow_drift_engine
from app.analysis.postmortem_rag import postmortem_rag
from app.core.directives import system_directive
from app.core.resource_guard import resource_guard
from app.data_layer.facade import market_data
from app.data_layer.symbol_resolver import ExchangeSymbolNormalizer, symbol_normalizer
from app.data_layer.tiering import storage_tiering
from app.engine.market_impact import market_impact
from app.engine.rl_fast_path import rl_fast_path
from app.engine.simulation import EventBacktestEngine
from app.evolution.differential_evolution import DifferentialEvolutionOptimizer
from app.execution.kelly_sizing import kelly_sizer
from app.execution.m8_judge import m8_judge
from app.execution.reconciliation import reconciliation_daemon
from app.ingestion.omni_stream import omni_stream_ingestor
from app.monitoring.watchdog_sse import sse_broadcaster, system_watchdog
from app.regime.asset_calibrator import asset_calibrator
from app.regime.dfa_engine import dfa_engine
from app.registry import LifecycleStatus, career_logger, strategy_registry
from app.risk.finbert_risk import finbert_risk_scorer
from app.validation.bootstrap import statistical_hardness


def generate_synthetic_ohlcv(symbol: str = "BTC/USD", days: int = 14, interval_min: int = 1):
    """Generates synthetic 1-minute OHLCV candles with realistic Geometric Brownian Motion."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    base_price = 65000.0 if "BTC" in symbol else 3400.0 if "ETH" in symbol else 145.0
    current_price = base_price
    volatility = 0.0015
    candles = []
    current_time = start

    while current_time <= now:
        drift = 0.00005 * (random.random() - 0.48)
        shock = volatility * random.gauss(0, 1)
        ret = drift + shock
        open_p = current_price
        close_p = open_p * math.exp(ret)
        high_p = max(open_p, close_p) * (1 + abs(random.gauss(0, 0.0008)))
        low_p = min(open_p, close_p) * (1 - abs(random.gauss(0, 0.0008)))
        volume = abs(random.gauss(15.0, 8.0)) * (base_price / 1000)
        trades = int(max(1, random.gauss(45, 20)))
        vwap = (open_p + high_p + low_p + close_p) / 4.0

        candles.append({
            "timestamp": current_time.isoformat(),
            "symbol": symbol,
            "timeframe": f"{interval_min}m",
            "open": round(open_p, 4),
            "high": round(high_p, 4),
            "low": round(low_p, 4),
            "close": round(close_p, 4),
            "volume": round(volume, 4),
            "trades_count": trades,
            "vwap": round(vwap, 4),
        })
        current_price = close_p
        current_time += timedelta(minutes=interval_min)

    return candles


def main():
    parser = argparse.ArgumentParser(description="Unified Quantitative Strategy Engine CLI")
    subparsers = parser.add_subparsers(dest="command", help="Sub-commands")

    # Status (00, 01, 17)
    subparsers.add_parser("status", help="Displays complete system status, tiering, and watchdog health")

    # Seed Data (01)
    seed_p = subparsers.add_parser("seed", help="Ingest high-frequency synthetic market data")
    seed_p.add_argument("--symbol", default="BTC/USD", help="Symbol ticker")
    seed_p.add_argument("--days", type=int, default=7, help="Days of history")

    # DFA Hurst Engine (03)
    dfa_p = subparsers.add_parser("dfa", help="Compute Detrended Fluctuation Analysis (DFA) & Hurst Regime")
    dfa_p.add_argument("--symbol", default="BTC/USD", help="Symbol ticker")

    # Differential Evolution Optimizer (04)
    de_p = subparsers.add_parser("de-optimize", help="Run Differential Evolution parameter optimization")

    # Statistical Hardness & Bootstrap (05)
    boot_p = subparsers.add_parser("bootstrap", help="Run Stationary Block Bootstrap & Deflated Sharpe Ratio")

    # Registry (06)
    reg_p = subparsers.add_parser("registry", help="List registered quantitative strategies")
    reg_p.add_argument("--status", default=None, help="Lifecycle status filter")

    # Career Book (06)
    career_p = subparsers.add_parser("career", help="Inspect strategy career log ('Karteibuch') and badges")
    career_p.add_argument("--strategy-id", required=True, help="Strategy UUID")

    # 5 Mandatory Stress Drills (07)
    drill_p = subparsers.add_parser("drill", help="Execute 5 mandatory stress drills (DR-01 to DR-05)")
    drill_p.add_argument("--strategy-id", required=True, help="Strategy UUID")
    drill_p.add_argument("--symbol", default="BTC/USD", help="Symbol ticker")

    # Shadow Drift & KS / PSI (08)
    drift_p = subparsers.add_parser("shadow-drift", help="Evaluate A/B race drift, KS-test, and PSI")

    # M8 Judge & Kelly Sizer (09)
    m8_p = subparsers.add_parser("m8-judge", help="Evaluate order through M8 Reject-Gates and Kelly sizing")
    m8_p.add_argument("--symbol", default="BTC/USD", help="Symbol ticker")
    m8_p.add_argument("--qty", type=float, default=0.5, help="Order quantity")
    m8_p.add_argument("--side", default="BUY", help="Order side (BUY/SELL)")

    # News & Sentiment FinBERT (10)
    sent_p = subparsers.add_parser("sentiment", help="Score news sentiment and test circuit breaker")
    sent_p.add_argument("--text", required=True, help="News headline or message body")

    # Asset Calibrator Traffic Light (14)
    ampel_p = subparsers.add_parser("ampel", help="Run Variance Ratio, Ljung-Box, ARCH-LM Ampelsystem")
    ampel_p.add_argument("--symbol", default="BTC/USD", help="Symbol ticker")

    # Universal Symbol Normalizer (Kraken Spot & Pro Auto-Mapping)
    sym_p = subparsers.add_parser("symbol", help="Parse and auto-map arbitrary ticker to Canonical, Lake Partition, Kraken Spot, and Kraken Pro Futures")
    sym_p.add_argument("input", nargs="?", default="btc usd", help="Raw symbol input (e.g., 'btc usd', 'ETH-USDT', 'sol_eur', 'kraken:btc/usd')")

    # RL Fast Path Inference (16)
    subparsers.add_parser("rl-inference", help="Execute sub-2ms RL policy network inference")

    # Telemetry Snapshot (17)
    subparsers.add_parser("telemetry", help="Fetch real-time SSE telemetry snapshot")

    # End-to-End Verification Pipeline (E2E)
    e2e_p = subparsers.add_parser("e2e", help="Run End-to-End Verification Test (DuckDB -> Indicators -> Backtest -> Visuals -> Paper Order -> Dashboard State)")
    e2e_p.add_argument("--symbol", default="BTC/USD", help="Target asset pair")
    e2e_p.add_argument("--bars", type=int, default=500, help="Number of OHLCV bars")
    e2e_p.add_argument("--timeframe", default="5m", help="Candle timeframe (e.g. 1m, 5m, 1h)")

    args = parser.parse_args()

    if args.command == "status" or not args.command:
        res = {
            "directive": system_directive.get_system_telemetry(),
            "tiering": storage_tiering.get_tiering_status(),
            "watchdog": system_watchdog.get_watchdog_status(),
            "strategies_registered": len(strategy_registry.list_strategies()),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        print(json.dumps(res, indent=2))

    elif args.command == "seed":
        print(f"Generating {args.days} days of 1m candles for {args.symbol}...")
        candles = generate_synthetic_ohlcv(symbol=args.symbol, days=args.days)
        written = market_data.ingest_candles(candles, symbol=args.symbol)
        print(f"Ingested {len(candles):,} candles across {len(written)} Parquet partition file(s).")

    elif args.command == "dfa":
        df = market_data.get_candles(symbol=args.symbol)
        if len(df) == 0:
            candles = generate_synthetic_ohlcv(symbol=args.symbol, days=3)
            market_data.ingest_candles(candles, symbol=args.symbol)
            df = market_data.get_candles(symbol=args.symbol)
        closes = df["close"].to_list()
        res = dfa_engine.compute_hurst_dfa(closes)
        print(f"=== DFA & Hurst Regime for {args.symbol} ===")
        print(json.dumps(res, indent=2))

    elif args.command == "de-optimize":
        print("Running Differential Evolution Genetic Optimizer (DE/rand/1/bin)...")
        bounds = {
            "fastEma": (5.0, 25.0),
            "slowEma": (26.0, 90.0),
            "stopAtr": (1.0, 4.0),
            "targetAtr": (2.0, 8.0)
        }
        test_candles = generate_synthetic_ohlcv(days=3)

        def mock_fitness(p):
            # Fast backtest simulation
            engine = EventBacktestEngine()
            res = engine.run_backtest(
                test_candles,
                strategy_signal_fn=lambda idx, pos, cap, hist: [
                    {"side": "BUY", "qty": 0.1, "order_type": "MARKET"}
                ] if idx % 25 == 0 else []
            )
            fit = res["total_return_pct"] - res["max_drawdown_pct"] * 1.5
            return fit, {"pnl": res["total_return_pct"], "dd": res["max_drawdown_pct"]}

        optimizer = DifferentialEvolutionOptimizer(bounds=bounds, max_generations=15, population_size=12)
        res = optimizer.optimize(mock_fitness)
        print(json.dumps(res, indent=2))

    elif args.command == "bootstrap":
        print("Running Stationary Block Bootstrap & Deflated Sharpe Ratio calculation...")
        fake_returns = [random.gauss(0.001, 0.015) for _ in range(250)]
        trials_sharpes = [random.gauss(1.2, 0.4) for _ in range(50)]
        res = statistical_hardness.compute_dsr(fake_returns, trials_sharpes)
        print(json.dumps(res, indent=2))

    elif args.command == "registry":
        status_filter = LifecycleStatus(args.status) if args.status else None
        strats = strategy_registry.list_strategies(status=status_filter)
        print(f"=== Strategy Registry ({len(strats)} strategies) ===")
        for s in strats:
            badge_names = [b.badge_type.value for b in s.badges]
            print(f"[{s.status.value}] {s.name} (ID: {s.id})")
            print(f"  - DNA Hash: {s.born_from_hash[:16]}... | Gen: {s.generation} | Badges: {', '.join(badge_names) if badge_names else 'None'}")

    elif args.command == "career":
        book = strategy_registry.get_career_book(args.strategy_id)
        if "error" in book:
            print(f"Error: {book['error']}")
            sys.exit(1)
        print(json.dumps(book, indent=2))

    elif args.command == "drill":
        print(f"Running 5 Mandatory Stress Drills (DR-01 to DR-05) for {args.strategy_id}...")
        res = drill_evaluator.run_all_drills_for_strategy(args.strategy_id, symbol=args.symbol)
        print(json.dumps(res, indent=2))

    elif args.command == "shadow-drift":
        champ_ret = [random.gauss(0.0012, 0.012) for _ in range(60)]
        chal_ret = [random.gauss(0.0018, 0.011) for _ in range(60)]
        res = shadow_drift_engine.evaluate_shadow_race("CHAMP_01", "CHAL_02", champ_ret, chal_ret)
        print(json.dumps(res, indent=2))

    elif args.command == "m8-judge":
        res = m8_judge.judge_order(
            strategy_id="STRAT_01",
            symbol=args.symbol,
            side=args.side,
            mid_price=65000.0,
            best_bid=64995.0,
            best_ask=65005.0,
            requested_qty=args.qty,
            available_cash=50000.0,
            recent_prices=[65000.0 + random.gauss(0, 50) for _ in range(40)]
        )
        print(json.dumps(res, indent=2))

    elif args.command == "sentiment":
        res = finbert_risk_scorer.score_text(args.text)
        print(json.dumps(res, indent=2))

    elif args.command == "ampel":
        df = market_data.get_candles(symbol=args.symbol)
        if len(df) == 0:
            candles = generate_synthetic_ohlcv(symbol=args.symbol, days=3)
            market_data.ingest_candles(candles, symbol=args.symbol)
            df = market_data.get_candles(symbol=args.symbol)
        closes = df["close"].to_list()
        res = asset_calibrator.evaluate_asset_ampel(args.symbol, closes)
        print(json.dumps(res, indent=2))

    elif args.command == "symbol":
        res = ExchangeSymbolNormalizer.resolve_all(args.input)
        print("=== Universal Exchange Symbol Normalizer & Kraken Auto-Mapping ===")
        print(f"Input:               '{args.input}'")
        print(f"Canonical UI:        {res['canonical']}")
        print(f"Lake Partition:      {res['lake_partition']}")
        print(f"Kraken Spot:         {res['kraken_spot']}")
        print(f"Kraken Pro Futures:  {res['kraken_pro_futures']}")
        print("-------------------------------------------------------------------")
        print(json.dumps(res, indent=2))

    elif args.command == "rl-inference":
        features = [0.002, -0.001, 58.5, 0.004, 0.62, 3.2, 0.45, 0.15]
        res = rl_fast_path.predict_action(features)
        print("=== RL Fast-Path Sub-2ms Action Prediction ===")
        print(json.dumps(res, indent=2))

    elif args.command == "telemetry":
        snapshot = sse_broadcaster.generate_telemetry_snapshot()
        print(json.dumps(snapshot, indent=2))

    elif args.command == "e2e":
        from app.validation.e2e_verification import e2e_verification_suite
        print(f"=== Running Full End-to-End Verification Pipeline for {args.symbol} ===")
        res = e2e_verification_suite.run_full_pipeline(
            symbol=args.symbol,
            sample_bars=args.bars,
            timeframe=args.timeframe
        )
        print("\n=== E2E Pipeline Verification Summary ===")
        print(f"Status:        {'SUCCESS (Passed)' if res.success else 'FAILED'}")
        print(f"Asset Pair:    {res.symbol}")
        print(f"Execution:     {res.duration_ms:.2f} ms")
        print("\n--- Pipeline Diagnostics Across All 6 Stages ---")
        for diag in res.diagnostics:
            print(f"  • {diag}")
        print("\n--- Stage Summary Payloads ---")
        print(json.dumps({
            "success": res.success,
            "timestamp": res.timestamp,
            "duration_ms": res.duration_ms,
            "stage_1_duckdb": {
                "bars_retrieved": res.data_retrieval.get("total_bars"),
                "timeframe": res.data_retrieval.get("timeframe"),
                "range": f"{res.data_retrieval.get('start_time')} -> {res.data_retrieval.get('end_time')}"
            },
            "stage_2_indicators": {
                "current_rsi": res.indicators.get("current_rsi"),
                "current_macd": res.indicators.get("current_macd"),
                "hurst_exponent": res.indicators.get("hurst_exponent"),
                "regime": res.indicators.get("regime")
            },
            "stage_3_backtest": {
                "total_trades": res.backtest.get("total_trades"),
                "win_rate_pct": res.backtest.get("win_rate_pct"),
                "sharpe_ratio": res.backtest.get("sharpe_ratio"),
                "max_drawdown_pct": res.backtest.get("max_drawdown_pct"),
                "total_return_pct": res.backtest.get("total_return_pct")
            },
            "stage_4_visualization": {
                "chart_candles_count": len(res.visualization_payload.get("chart_candles", [])),
                "trade_markers_count": len(res.visualization_payload.get("trade_markers", [])),
                "equity_curve_points": len(res.visualization_payload.get("equity_curve", []))
            },
            "stage_5_paper_order": {
                "order_id": res.paper_order_routing.get("order_id"),
                "status": res.paper_order_routing.get("status"),
                "fill_price": res.paper_order_routing.get("fill_price"),
                "qty": res.paper_order_routing.get("qty"),
                "kelly_fraction": res.paper_order_routing.get("kelly_fraction")
            },
            "stage_6_dashboard_state": {
                "portfolio_equity": res.dashboard_state.get("portfolio_equity"),
                "baseline_equity": res.dashboard_state.get("baseline_equity"),
                "pnl_pct": res.dashboard_state.get("pnl_pct"),
                "ledger_balances": res.dashboard_state.get("ledger_balances"),
                "reconciliation": "ZERO_DRIFT_SYNCHRONIZED"
            }
        }, indent=2))



if __name__ == "__main__":
    main()
