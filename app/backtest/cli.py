"""JSON CLI bridge for the QuantJourney backtesting workflow.

The TypeScript server, shell operators and CI all drive the engine through
this module so there is exactly one execution path::

    python -m app.backtest.cli engines
    python -m app.backtest.cli run --request request.json
    echo '{"source":"sample","symbols":["BTC/USD"]}' | python -m app.backtest.cli run --request -
    python -m app.backtest.cli walkforward --request request.json
    python -m app.backtest.cli optimize --request request.json
    python -m app.backtest.cli list --limit 10
    python -m app.backtest.cli show qj-bt-...

Results are emitted as one JSON document on stdout; progress and logging go to
stderr so the caller can parse stdout safely.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Mapping

from app.backtest.config import BacktestError


def _read_request(path: str) -> dict[str, Any]:
    if path == "-":
        raw = sys.stdin.read()
    else:
        candidate = Path(path)
        if not candidate.exists():
            raise BacktestError(f"request file not found: {candidate}")
        raw = candidate.read_text(encoding="utf-8")
    raw = raw.strip()
    if not raw:
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise BacktestError(f"invalid JSON request: {exc}") from exc
    if not isinstance(payload, dict):
        raise BacktestError("request JSON must be an object")
    return payload


def _parse_json_object(value: str | None, name: str) -> dict[str, Any]:
    if not value:
        return {}
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as exc:
        raise BacktestError(f"{name} is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise BacktestError(f"{name} must be a JSON object")
    return payload


def _merge(base: Mapping[str, Any], extra: Mapping[str, Any]) -> dict[str, Any]:
    payload = dict(base)
    payload.update({key: value for key, value in extra.items() if value is not None})
    return payload


def _apply_common_overrides(args: argparse.Namespace, payload: dict[str, Any]) -> dict[str, Any]:
    overrides: dict[str, Any] = {}
    if args.symbols:
        overrides["symbols"] = [item.strip() for item in args.symbols.split(",") if item.strip()]
    if args.interval:
        overrides["intervalMinutes"] = args.interval
    if args.bars:
        overrides["sampleBars"] = args.bars
    if args.capital is not None:
        overrides["initialCapital"] = args.capital
    if args.fee_bps is not None:
        overrides["feeBps"] = args.fee_bps
    if args.slippage_bps is not None:
        overrides["slippageBps"] = args.slippage_bps
    if args.strategy:
        overrides["strategy"] = {"model": args.strategy, "params": _parse_json_object(args.params, "--params")}
    elif args.params:
        strategy = dict(payload.get("strategy") or {})
        strategy.setdefault("model", "sma_cross")
        strategy["params"] = {**dict(strategy.get("params") or {}), **_parse_json_object(args.params, "--params")}
        overrides["strategy"] = strategy
    if args.source:
        overrides["source"] = args.source
    if args.data_file:
        overrides["dataFile"] = args.data_file
        overrides.setdefault("source", "csv")
    if args.start:
        overrides["start"] = args.start
    if args.end:
        overrides["end"] = args.end
    if args.benchmark:
        overrides["benchmarkSymbol"] = args.benchmark
    if getattr(args, "no_persist", False):
        overrides["persist"] = False
    if getattr(args, "candles_file", None):
        overrides["candles"] = _read_request(args.candles_file)
        overrides["source"] = "payload"
    return _merge(payload, overrides)


def _emit(payload: Any, *, pretty: bool) -> None:
    sys.stdout.write(json.dumps(payload, indent=2 if pretty else None, default=str))
    sys.stdout.write("\n")
    sys.stdout.flush()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.backtest.cli",
        description="QuantJourney backtesting workflow (JSON bridge).",
    )
    parser.add_argument("--pretty", action="store_true", help="pretty-print JSON output")
    parser.add_argument("--verbose", action="store_true", help="verbose engine logging on stderr")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_common(sub: argparse.ArgumentParser) -> None:
        sub.add_argument("--request", default=None, help="JSON request file or '-' for stdin")
        sub.add_argument("--symbols", default=None, help="comma separated symbols, e.g. BTC/USD,ETH/USD")
        sub.add_argument("--interval", type=int, default=None, help="bar interval in minutes")
        sub.add_argument("--bars", type=int, default=None, help="sample bar count")
        sub.add_argument("--capital", type=float, default=None, help="initial capital")
        sub.add_argument("--fee-bps", type=float, default=None, dest="fee_bps")
        sub.add_argument("--slippage-bps", type=float, default=None, dest="slippage_bps")
        sub.add_argument("--strategy", default=None, help="strategy model id")
        sub.add_argument("--params", default=None, help="strategy parameters as JSON")
        sub.add_argument("--source", default=None, choices=["payload", "sample", "csv", "duckdb"])
        sub.add_argument("--data-file", default=None, dest="data_file")
        sub.add_argument("--candles-file", default=None, dest="candles_file", help="JSON file with candles payload")
        sub.add_argument("--start", default=None)
        sub.add_argument("--end", default=None)
        sub.add_argument("--benchmark", default=None)
        sub.add_argument("--no-persist", action="store_true", dest="no_persist")

    engines = subparsers.add_parser("engines", help="engine capabilities and model registry")
    engines.add_argument("--request", default=None, help=argparse.SUPPRESS)

    run = subparsers.add_parser("run", help="run a portfolio backtest")
    add_common(run)

    wf = subparsers.add_parser("walkforward", help="walk-forward validation")
    add_common(wf)
    wf.add_argument("--walk-forward", default=None, dest="walk_forward", help="walk-forward config JSON")
    wf.add_argument("--train-bars", type=int, default=None, dest="train_bars")
    wf.add_argument("--test-bars", type=int, default=None, dest="test_bars")
    wf.add_argument("--step-bars", type=int, default=None, dest="step_bars")
    wf.add_argument("--purge-bars", type=int, default=None, dest="purge_bars")
    wf.add_argument("--scheme", default=None, choices=["rolling", "expanding"])
    wf.add_argument("--objective", default=None)
    wf.add_argument("--grid", default=None, help="parameter grid JSON")
    wf.add_argument("--max-trials", type=int, default=None, dest="max_trials")

    opt = subparsers.add_parser("optimize", help="grid-search parameter optimisation")
    add_common(opt)
    opt.add_argument("--objective", default=None)
    opt.add_argument("--grid", default=None, help="parameter grid JSON")
    opt.add_argument("--max-trials", type=int, default=None, dest="max_trials")

    stress = subparsers.add_parser("stress", help="transaction-cost stress test")
    add_common(stress)
    stress.add_argument("--fee-grid", default=None, dest="fee_grid", help="fee bps values JSON")
    stress.add_argument("--slippage-grid", default=None, dest="slippage_grid", help="slippage bps values JSON")

    list_cmd = subparsers.add_parser("list", help="list persisted runs")
    list_cmd.add_argument("--limit", type=int, default=50)
    list_cmd.add_argument("--kind", default=None, choices=["backtest", "walkforward", "optimization", "stress"])

    show = subparsers.add_parser("show", help="show a persisted run")
    show.add_argument("run_id")
    show.add_argument("--summary-only", action="store_true", dest="summary_only")

    compare = subparsers.add_parser("compare", help="compare persisted runs")
    compare.add_argument("run_ids", nargs="+")

    delete = subparsers.add_parser("delete", help="delete a persisted run")
    delete.add_argument("run_id")

    return parser


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.WARNING
    logging.basicConfig(stream=sys.stderr, level=level, format="[%(levelname)s] %(name)s: %(message)s")
    for name in ("backtester", "quantjourney", "matplotlib"):
        logging.getLogger(name).setLevel(logging.ERROR if not verbose else logging.INFO)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    # Allow global flags before or after the subcommand.
    argv = list(sys.argv[1:] if argv is None else argv)
    pretty = False
    verbose = False
    for flag in ("--pretty", "--verbose"):
        if flag in argv:
            argv.remove(flag)
            pretty = pretty or flag == "--pretty"
            verbose = verbose or flag == "--verbose"
    args = parser.parse_args(argv)
    _configure_logging(verbose)
    os.environ.setdefault("QJ_LOG_LEVEL", "ERROR")

    try:
        from app.backtest import service

        if args.command == "engines":
            _emit(service.capabilities(), pretty=pretty)
            return 0

        payload: dict[str, Any] = {}
        if getattr(args, "request", None):
            payload = _read_request(args.request)
        if args.command in {"run", "walkforward", "optimize", "stress"}:
            payload = _apply_common_overrides(args, payload)

        if args.command == "run":
            result = service.run_backtest(payload)
            _emit(result, pretty=pretty)
            return 0

        if args.command == "walkforward":
            wf_config = dict(payload.get("walkForward") or {})
            wf_config.update(_parse_json_object(getattr(args, "walk_forward", None), "--walk-forward"))
            for key in ("train_bars", "test_bars", "step_bars", "purge_bars", "scheme", "objective", "max_trials"):
                value = getattr(args, key, None)
                if value is not None:
                    camel = "".join(part.capitalize() if index else part for index, part in enumerate(key.split("_")))
                    wf_config[camel] = value
            grid = _parse_json_object(getattr(args, "grid", None), "--grid")
            if grid:
                wf_config["paramGrid"] = grid
            payload["walkForward"] = wf_config
            result = service.run_walk_forward_request(payload)
            _emit(result, pretty=pretty)
            return 0

        if args.command == "optimize":
            opt_config = dict(payload.get("optimization") or {})
            if getattr(args, "objective", None):
                opt_config["objective"] = args.objective
            grid = _parse_json_object(getattr(args, "grid", None), "--grid")
            if grid:
                opt_config["paramGrid"] = grid
            if getattr(args, "max_trials", None):
                opt_config["maxTrials"] = args.max_trials
            payload["optimization"] = opt_config
            result = service.run_optimization_request(payload)
            _emit(result, pretty=pretty)
            return 0

        if args.command == "stress":
            stress_config = dict(payload.get("stress") or {})
            if getattr(args, "fee_grid", None):
                stress_config["feeBpsGrid"] = json.loads(args.fee_grid)
            if getattr(args, "slippage_grid", None):
                stress_config["slippageBpsGrid"] = json.loads(args.slippage_grid)
            payload["stress"] = stress_config
            result = service.run_stress_request(payload)
            _emit(result, pretty=pretty)
            return 0

        if args.command == "list":
            _emit({"runs": service.list_runs(limit=args.limit, kind=args.kind)}, pretty=pretty)
            return 0

        if args.command == "show":
            _emit(service.get_run(args.run_id, include_result=not args.summary_only), pretty=pretty)
            return 0

        if args.command == "compare":
            _emit(service.compare_runs(args.run_ids), pretty=pretty)
            return 0

        if args.command == "delete":
            _emit(service.delete_run(args.run_id), pretty=pretty)
            return 0

        parser.error(f"unknown command {args.command}")
        return 2
    except BacktestError as exc:
        _emit({"ok": False, "error": str(exc), "errorType": "BacktestError"}, pretty=True)
        return 1
    except Exception as exc:  # pragma: no cover - operator-facing guard
        if args.command != "engines":
            logging.getLogger("app.backtest.cli").exception("backtest command failed")
        _emit({"ok": False, "error": str(exc), "errorType": type(exc).__name__}, pretty=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
