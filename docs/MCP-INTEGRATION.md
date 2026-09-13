# Model Context Protocol (MCP) integration

This repository contains two local stdio MCP servers, each using the official SDK:

- **TypeScript SDK**: <https://github.com/modelcontextprotocol/typescript-sdk>
  - npm package: `@modelcontextprotocol/sdk`
  - Entry point: `server/mcp/server.ts`
  - Proxies the running Express/Vite application through its existing REST API.
- **Python SDK**: <https://github.com/modelcontextprotocol/python-sdk>
  - PyPI package: `mcp`
  - Entry point: `app/mcp_server.py`
  - Exposes the deterministic Python quantitative, registry, Academy, and Alpha/SIGMA modules directly.

The MCP client configuration is in `.mcp.json`. The previously configured Pionex server remains enabled.

## Why two servers?

The two runtimes already have distinct responsibilities:

- Node/TypeScript owns the UI backend, persistent strategy manifest, Kraken routing, paper/live queues, logs, and HTTP API.
- Python owns the quantitative research stack (DFA/Hurst, statistical validation, M8/Kelly, registry, Academy, Sigma bridge, and the Alpha/SIGMA orchestrator).

The TypeScript MCP server deliberately does **not** import `server.ts`, because importing that module starts timers and the web server. It calls the REST API so the normal server remains the single source of truth for trading-desk state.

The Python MCP server imports Python modules lazily per tool call, so the server can still start when optional scientific dependencies are being installed.

## Setup

Install Node dependencies:

```bash
npm install
```

Install Python dependencies. On locked-down Linux distributions, use a virtual environment:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
```

The standard build also attempts `python3 -m pip install -r requirements.txt` and falls back to `--break-system-packages` where required.

Start the Node application when using the TypeScript MCP server:

```bash
npm run dev
```

Start servers manually if desired:

```bash
npm run mcp:ts
npm run mcp:python
```

Built/bundled production MCP server:

```bash
npm run build
npm run mcp:ts:built
```

The Python code supports both MCP Python SDK 1.x (`FastMCP`) and 2.x (`MCPServer`) through a compatibility import.

## MCP client configuration

`.mcp.json` registers:

- `strategie-runner-ts`: `npx tsx server/mcp/server.ts`
- `strategie-runner-python`: `python3 -m app.mcp_server`
- `pionex-trade-mcp`: the existing external Pionex server

TypeScript server environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `STRATEGIE_RUNNER_URL` | `http://localhost:3000` | REST API base URL used by the MCP server. |
| `MCP_HTTP_TIMEOUT_MS` | `20000` | Per-tool HTTP timeout. |
| `MCP_ENABLE_LIVE_TRADING` | `false` | Must be `true` before MCP can start a runner in live mode. |

Python server safety variables include:

- `QUANT_BACKEND=sigma`
- `AI_LIVE_ORDERS=false`

## TypeScript tools

### Read and analyze

- `server_info`
- `health_check`
- `list_strategies`
- `get_strategy_manifest`
- `get_market_data`
- `get_desk_logs`
- `get_queue_matrix`
- `get_kraken_status`
- `get_orchestrator_status`
- `list_orchestrator_hooks`
- `calculate_sigma_indicators`
- `evaluate_quant_paper`
- `run_backtest`
- `run_orchestrator_cycle`

### Mutating or action-oriented

- `create_strategy` creates an **inactive** strategy.
- `start_strategy` starts or stops runners.
- `emergency_cancel_all` halts runners and requests exchange cancellation when credentials exist.

### Resources and prompts

Resources:

- `strategie-runner://health`
- `strategie-runner://strategies`
- `strategie-runner://orchestrator/hooks`

Prompt:

- `investigate_strategy`

## Python tools

### System and market data

- `system_status`
- `resolve_symbol`
- `seed_synthetic_ohlcv`
- `dfa_hurst`
- `asset_ampel`
- `sigma_indicators`

### Risk, validation, and research

- `sentiment_score`
- `statistical_bootstrap`
- `m8_judge`
- `reconciliation_audit`
- `postmortem_query`
- `rl_fast_path`

### Registry and Academy

- `registry_overview`
- `list_registry_strategies`
- `get_career_book`
- `register_strategy`
- `run_strategy_drills`
- `start_shadow_race`
- `evaluate_shadow_race`

### Sigma and Alpha/SIGMA orchestration

- `quant_backend_status`
- `evaluate_sigma_quant`
- `night_train`
- `orchestrator_status`
- `orchestrator_hooks`
- `orchestrator_ingest`
- `orchestrator_decide`
- `orchestrator_reset`

Resources:

- `strategie-runner-python://quant-backend`
- `strategie-runner-python://registry/overview`

Prompt:

- `quant_review`

## Safety model

MCP is not a shortcut around existing execution controls.

- Paper mode is the default.
- The Sigma bridge and Python quant evaluation are paper-only.
- The Python MCP server does not expose live order placement.
- Starting a live TypeScript runner requires both:
  1. `MCP_ENABLE_LIVE_TRADING=true` for the MCP process, and
  2. `mode="live"` plus `confirm_live=true` in the tool call.
- The normal backend still independently enforces Kraken credentials, strategy queue mode, Sigma caps, and environment gates.
- Orchestrator dispatch is advisory by default. `run_orchestrator_cycle` requires an explicit dispatch confirmation and the backend's `ORS_ALLOW_DISPATCH` / live-dispatch environment gates.
- `emergency_cancel_all` is risk-reducing but destructive to active runners, so it requires `confirm=true`.
- `orchestrator_reset` clears local chamber memory and requires `confirm=true`; it never changes broker holdings.

## Smoke test

Run a real stdio handshake, tool/resource discovery, and safe tool invocation:

```bash
# TypeScript server; Python is skipped if its SDK is missing.
npm run test:mcp

# Check both with a local virtualenv:
PYTHON=.venv/bin/python npm run test:mcp
```

The smoke test uses the TypeScript SDK as an MCP client against both local servers. It calls:

- TypeScript: `server_info`
- Python: `sigma_indicators`

Manual inspector commands:

```bash
npx @modelcontextprotocol/inspector npx tsx server/mcp/server.ts
npx @modelcontextprotocol/inspector python3 -m app.mcp_server
```

All stdio protocol messages and tool results use stdout. Operational logs are written to stderr so they cannot corrupt JSON-RPC frames.
