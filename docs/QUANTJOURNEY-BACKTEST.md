# QuantJourney Backtesting Workflow

This document describes how `QuantJourneyOrg/quantjourney-bt` is integrated into
Strategie Runner as the primary research engine, while the legacy TypeScript
simulator remains available as a fallback.

The integration covers the complete workflow:

```
data ingestion → indicators/signals → target weights → allocation
→ policy rebalancing → costs & slippage → portfolio NAV
→ metrics / charts / reports → walk-forward validation
→ parameter optimisation → cost stress → persisted research packets
```

## 1. Installation

The QuantJourney engine is Python-only and requires **Python ≥ 3.11** (it depends
on modern pandas/numpy).

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt          # core server + MCP dependencies
pip install -r requirements-backtest.txt # pandas, quantjourney-bt, quantjourney-ti, matplotlib
```

`requirements-backtest.txt` includes the core file, so one install is enough for
a research machine. The core requirements stay pandas-only so the standard
Windows/macOS dev setup keeps working.

Environment variables:

| Variable | Purpose |
| --- | --- |
| `PYTHON_BIN` | Python interpreter used by the TypeScript bridge (default `python3`). Point it at the venv that has `quantjourney-bt`. |
| `QJ_BACKTEST_RUNS_DIR` | Directory for persisted runs (default `data/backtest_runs`). |

Without `quantjourney-bt`, `GET /api/backtest/engines` reports
`qjAvailable: false`, the UI shows the native-fallback badge, and
`POST /api/backtest/run` uses the legacy simulator.

## 2. Python package layout

| Module | Responsibility |
| --- | --- |
| `app/backtest/__init__.py` | Import-guarded shim (`BacktestConfig`, `BacktestError`, `run_backtest`, `capabilities`). |
| `qj_runtime.py` | Detects `quantjourney_bt` / `quantjourney_ti`, versions, model catalogue and feature flags. |
| `config.py` | Validated `BacktestConfig`, `WalkForwardSpec`, `OptimizeSpec`, `StressSpec`; alias normalisation and grid expansion. |
| `data.py` | `CandlePanel`, payload/CSV/data-lake/sample loaders, tz-safe slicing. |
| `indicators.py` | `quantjourney_ti` wrapper with a pandas fallback. |
| `strategies.py` | 14-model signal registry, rule DSL, allocation, volatility targeting, hard stops, one-bar execution delay. |
| `engine.py` | QuantJourney `Backtester` adapter, native fallback, trade-ledger reconstruction, equity curve, metrics envelope. |
| `metrics.py` | Performance, benchmark-relative and trade statistics; drawdown series. |
| `walkforward.py` | Bar-based walk-forward folds with purge, per-fold refit, stitched OOS curve, DSR and verdicts; optimisation and cost stress. |
| `report.py` | Artifact writer (`summary.json`, `metrics.csv`, `equity_curve.csv`, `trades.csv`, `weights.csv`, `folds.csv`, `dashboard.html`, `manifest.json`, `result.json`, `payload.json`). |
| `service.py` | Orchestration, run IDs, persistence, history, comparison, deletion. |
| `cli.py` | JSON bridge used by TypeScript, MCP and shell automation. |
| `api.py` | FastAPI router mounted at `/api/qj-backtest`. |

## 3. HTTP API

The TypeScript server exposes the workflow under `/api/backtest`:

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/backtest/engines` | Capability envelope: versions, models, features, run count. |
| `POST` | `/api/backtest/run` | Portfolio backtest. Sends `engine: "quantjourney"` by default; `"native"` forces the legacy simulator. |
| `POST` | `/api/backtest/walkforward` | Walk-forward validation. |
| `POST` | `/api/backtest/optimize` | Full-sample grid optimisation. |
| `POST` | `/api/backtest/stress` | Fee/slippage cost stress. |
| `GET` | `/api/backtest/runs?limit=25&kind=backtest` | Run history summaries. |
| `GET` | `/api/backtest/runs/:id?includeResult=true` | Run summary + reloadable payload. |
| `GET` | `/api/backtest/runs/:id/artifact/:name` | Serve an allow-listed artifact (`dashboard.html`, `summary.json`, `metrics.csv`, ...). |
| `DELETE` | `/api/backtest/runs/:id` | Delete a run and its artifacts. |
| `POST` | `/api/backtest/compare` | Compare 2–8 runs (`{"runIds": [...]}`). |

### Example

```bash
curl -X POST http://localhost:3000/api/backtest/run \
  -H 'Content-Type: application/json' \
  -d '{
    "engine": "quantjourney",
    "strategyName": "BTC/ETH SMA",
    "symbols": ["BTC/USD", "ETH/USD"],
    "intervalMinutes": 60,
    "candleCount": 720,
    "feeBps": 26,
    "slippageBps": 5,
    "strategy": {"model": "sma_cross", "params": {"fast": 20, "slow": 60}},
    "allocation": {"method": "equal_weight", "maxPositionSize": 1.0},
    "rebalance": {"frequency": "signal", "onSignalChange": true}
  }'
```

Candles are fetched from Kraken on the server. If Kraken is unreachable, the
engine falls back to the bundled deterministic sample and emits a warning; the
response always states which source was used in `analytics.data.source`.

The request body accepts either a nested strategy object (`{model, params}`) or
UI-style `parameters`; the server infers MACD/RSI/Bollinger/SMA models from the
seeded strategy templates.

## 4. CLI bridge

All calls emit a single JSON object on stdout and exit non-zero with
`{"ok": false, "error": ...}` on failure.

```bash
python -m app.backtest.cli engines
python -m app.backtest.cli run --request request.json
python -m app.backtest.cli walkforward --request wf.json
python -m app.backtest.cli optimize --request opt.json
python -m app.backtest.cli stress --request stress.json
python -m app.backtest.cli list --limit 10
python -m app.backtest.cli show <run-id> --summary-only
python -m app.backtest.cli compare <run-a> <run-b>
python -m app.backtest.cli delete <run-id>
```

`--request -` reads the payload from stdin. Common overrides
(`--source`, `--symbols`, `--interval`, `--bars`, `--no-persist`) apply to the
compute commands only.

## 5. MCP tools

`app/mcp_server.py` exposes the workflow to MCP clients:

- `qj_backtest_capabilities`
- `qj_run_backtest`
- `qj_walk_forward`
- `qj_optimize`
- `qj_cost_stress`
- `qj_backtest_runs`
- `qj_backtest_report`
- `qj_backtest_compare`

## 6. UI

- **Strategy Backtesting** (`BacktestingPanel.tsx`) gains a `Backtest Engine`
  selector (`QuantJourney BT` / `Native Simulator`), a `QJ Studio` shortcut, an
  engine badge, an analytics strip (Sortino, Calmar, CAGR, exposure, turnover,
  costs), research warnings and direct links to the dashboard/summary artifacts.
- **QJ Backtest Studio** (`src/components/quant/QJBacktestStudio.tsx`) is the
  full research workspace:
  - universe selection (up to 12 pairs) and interval/capital/cost configuration;
  - model-specific parameter editors driven by the capability envelope;
  - allocation, max position, long/short, volatility target and drift bands;
  - walk-forward configuration (rolling/expanding, train/test/step/purge,
    objective, JSON parameter grid, refit toggle);
  - optimisation and cost-stress grids;
  - tabs for results (metrics, equity/drawdown charts, trade blotter, symbol
    contribution, assumptions), walk-forward (verdicts, fold table, stitched OOS
    equity), optimisation (best parameters, sortable trials, DSR), cost stress
    (breakeven, decay, sensitivity chart) and run history (load, delete, compare,
    open research dashboard).

## 7. Research methodology

- **Execution model** – target weights are shifted one bar before execution to
  avoid look-ahead. Costs use the QuantJourney `solve_recursive_weight_costs`
  solver with a fixed-bps weight cost model. Our `EngineOutcome.costs` are
  NAV fractions; USD costs are reported from `breakdown.total_cost_pct × NAV`.
- **Rebalancing** – `frequency: "signal"` rebalances when target weights change
  (plus an optional drift band). Calendar frequencies are mapped to explicit bar
  timestamps for intraday panels (e.g. `D` on 1h bars → every 24 bars) and to QJ
  calendar flags for daily+ panels. `NONE` only trades on signal changes.
- **Metrics** – NAV is always resampled to daily before annualisation, so an
  hourly sample is not annualised with 8,760 periods. Sub-one-year samples use
  the actual calendar horizon for CAGR/Calmar and emit an extrapolation warning.
  Calmar is `CAGR / |max drawdown|`.
- **Trade ledger** – round trips are reconstructed from target-weight changes and
  rebalance flags (`open_episode` / `close_trade`), not from drifting weights.
  When trades are intentionally omitted (`include_trades=False`), the optimiser
  estimates episodes for scoring and marks `tradeCountMode: "estimated"`.
- **Walk-forward** – folds are bar-based with an explicit purge gap; each fold
  refits on its training window. The OOS curve stitches the test windows. The
  engine reports efficiency (`OOS/IS Sharpe`), overfit ratio, Sharpe decay,
  consistency, rank-stability failure rate and a deflated Sharpe ratio. The
  canonical CSCV PBO is not implemented; use `selected_trial_rank_logit` and
  `walk_forward_top_k_rank_failure_rate` alongside the verdict traffic lights.
- **DSR** – computed over the search space actually explored. It can be
  astronomically small when a large grid is searched on a short sample; that is
  informative, not a bug.
- **Optimiser scoring** – missing-exposure runs are penalised rather than
  runs with zero reconstructed trades, so `include_trades=False` does not zero
  every score.

## 8. Persistence and artifacts

Every run is written to `data/backtest_runs/<run-id>/` (or
`QJ_BACKTEST_RUNS_DIR`). Run IDs look like
`qj-bt-20261119-150716-9dd014-da66` / `qj-wf-…` / `qj-opt-…` / `qj-stress-…`.

Artifacts:

- `summary.json` – transport-friendly summary envelope (metrics, config, warnings)
- `result.json` – engine result (compact for WF/opt/stress)
- `payload.json` – full reloadable payload for every kind
- `metrics.csv`, `equity_curve.csv`, `trades.csv`, `weights.csv`, `folds.csv`
- `dashboard.html` – self-contained inline-SVG research dashboard
- `manifest.json` – file inventory and byte sizes

The artifact route enforces an allow-list and a strict run-ID pattern.

## 9. Tests

```bash
python -m unittest tests.test_qj_backtest -v
python -m pytest tests -q
```

Unit tests run without QuantJourney installed. The workflow tests (run,
persistence, walk-forward, optimisation, stress, artifact allow-list) are skipped
when `quantjourney-bt` is missing and otherwise exercise the real engine on the
bundled sample.

## 10. Known limitations

- `quantjourney-bt` requires Python ≥ 3.11; the legacy simulator and the core
  server still run on older interpreters.
- Live candle ingestion depends on Kraken reachability; offline environments use
  the deterministic sample and surface a warning.
- Walk-forward on very short samples (a few hundred hourly bars) produces few
  folds and highly noisy OOS metrics; prefer 5,000+ bars for production research.
- The QJ cloud data API and yfinance sources require network/credentials; the
  integrated adapter defaults to payload/sample/local CSV/Parquet/data lake.
- Canonical CSCV PBO is not part of the upstream engine; the DSR and rank
  stability diagnostics are the supported multiple-testing safeguards.
