# 05-wiring-map.md — Code Wiring Map & Swarm Execution Digest

## Swarm Execution Digest

This deliverable was produced in parallel across 7 agent roles to construct the complete Risk Overlay and Learning Loop architecture:

| Agent Role | Subsystem | Delivered Artifacts |
|---|---|---|
| **Agent-0** | Contracts & Types | `docs/pseudocode/00-types.md` — Unified TypeScript & Python data definitions for `DataApproval`, `OverlayVerdict`, `PlaybookScorecard`, and `ExecutionEvent` extensions. |
| **Agent-1** | Data Approval | `docs/pseudocode/01-data-approved.md`, `server/dataApproval.ts` — D1–D8 checks, fail-closed snapshot evaluation, and REST endpoint. |
| **Agent-2** | Risk Overlay | `docs/pseudocode/02-risk-overlay.md`, `server/riskOverlay.ts` — R0–R8 narrowing gates, daily loss circuit breaker (-3%), and M8 judge alignment. |
| **Agent-3** | Playbook Screener | `docs/pseudocode/03-screener.md`, `server/playbookScreener.ts` — Generic candidate modules, scorecard weight scaling, and hysteresis. |
| **Agent-4** | Learning Loop | `docs/pseudocode/04-learn-from-journal.md`, `scripts/learn_from_journal.py` — Idempotent log parsing, EWMA IC attribution, and atomic scorecard updates. |
| **Agent-5** | Fixtures & Tests | `tests/fixtures/risk-overlay/` (6 JSON fixtures), `tests/test_risk_overlay_fixtures.py` — Windows-compatible test suite verifying acceptances A, B, and C. |
| **Agent-6** | Integration & Wiring | `docs/pseudocode/05-wiring-map.md` — 12 concrete integration points mapping new modules directly into existing `main` codebase. |

---

## 12 Concrete Wiring Points in Existing Code

The following table maps exact code modification points in the `main` branch. Peter only needs to hook in local snapshot sources (Tick stream, DuckDB Lake query, and JSONL log tail).

### Wiring Point 1: Metadata Extensions in `server/eventLog.ts`
- **File:** `server/eventLog.ts`
- **Hook Location:** `export interface ExecutionEvent`
- **Modification:** Add optional metadata schema extensions:
  ```ts
  export interface ExecutionEvent {
    id: string;
    timestamp: string;
    level: EventLevel;
    kind: EventKind;
    message: string;
    strategyId?: string;
    symbol?: string;
    executionMode?: "paper" | "live";
    metadata?: {
      module_id?: string;
      regime_at_entry?: string;
      data_approved?: boolean | null;
      overlay_codes?: string[];
      horizon_bars?: number;
      proposal_source?: "screener" | "human" | "genetic" | "hold" | "unknown";
      [key: string]: unknown;
    };
  }
  ```

---

### Wiring Point 2: Ticker Snapshot Builder in `server/krakenCliStream.ts`
- **File:** `server/krakenCliStream.ts`
- **Hook Location:** `export function getLatestTickerSnapshot(symbol: string)`
- **Modification:** Construct the `tick` sub-object of `DataApprovalSnapshot`:
  ```ts
  const tick = getLatestKrakenPrice(symbol);
  return {
    lastPrice: tick.price,
    bid: tick.bid,
    ask: tick.ask,
    timestampMs: tick.timestampMs,
    source: tick.isWebSocket ? "websocket" : "rest",
    isSynthetic: false,
  };
  ```

---

### Wiring Point 3: Lake Density & Freshness Query in `server/lake.ts`
- **File:** `server/lake.ts`
- **Hook Location:** `export async function getLakeSnapshot(symbol: string)`
- **Modification:** Execute DuckDB query on 1m Parquet partition:
  ```ts
  const row = await duckdb.query(`
    SELECT min(open_time) as first_bar, max(open_time) as last_bar, count(*) as row_count 
    FROM 'data/lake/1m/${symbol}/*.parquet'
    WHERE open_time >= NOW() - INTERVAL '12 hours'
  `);
  return {
    firstBarUtc: row.first_bar,
    lastBarUtc: row.last_bar,
    totalRowsInWindow: row.row_count,
    expectedRowsInWindow: 720, // 12 hours * 60 bars
    brokerTag: "kraken",
    isReadable: true,
  };
  ```

---

### Wiring Point 4: Data Approval Service in `server/dataApproval.ts`
- **File:** `server/dataApproval.ts` (New module)
- **Hook Location:** Exposed function `approveSymbol(snapshot)` and REST route:
  ```ts
  app.get("/api/data-approval", (req, res) => {
    const symbol = String(req.query.symbol || "BTC/USD");
    const snapshot = buildDataSnapshot(symbol); // Hooks Point 2 & 3
    const approval = approveSymbol(snapshot);
    res.json(approval);
  });
  ```

---

### Wiring Point 5: Risk Overlay Engine in `server/riskOverlay.ts`
- **File:** `server/riskOverlay.ts` (New module)
- **Hook Location:** Exposed function `applyOverlay(ctx)` and REST route:
  ```ts
  app.post("/api/risk-overlay/eval", (req, res) => {
    const ctx: OverlayContext = req.body;
    const verdict = applyOverlay(ctx);
    res.json(verdict);
  });
  ```

---

### Wiring Point 6: Playbook Screener in `server/playbookScreener.ts`
- **File:** `server/playbookScreener.ts` (New module)
- **Hook Location:** Exposed function `proposeModule()` and REST route:
  ```ts
  app.post("/api/screener/propose", (req, res) => {
    const { symbol, physicsSnapshot } = req.body;
    const approval = approveSymbol(buildDataSnapshot(symbol));
    const scorecard = loadPlaybookScorecard();
    const proposal = propose(symbol, approval, physicsSnapshot, scorecard);
    res.json(proposal);
  });
  ```

---

### Wiring Point 7: Pre-Open Gate in `server/orchestratorEngine.ts`
- **File:** `server/orchestratorEngine.ts`
- **Hook Location:** `public decide(symbol: string)` before order generation
- **Modification:** Insert Data Approval & Risk Overlay calls before `decide()` emits an `OrderIntent`:
  ```ts
  // 1. Data Approval Check
  const approval = approveSymbol(this.getSnapshot(symbol));
  if (!approval.approved) {
    return { verdict: "REJECTED", reason_codes: ["RISK_DATA"], approval };
  }
  // 2. Risk Overlay Evaluation
  const verdict = applyOverlay(buildOverlayContext(symbol, approval));
  if (!verdict.allowOpen || verdict.sizeOut === 0) {
    return { verdict: "REJECTED", reason_codes: verdict.gates.filter(g => !g.pass).map(g => g.id) };
  }
  ```

---

### Wiring Point 8: Grok AI Commentary Restriction in `server/grokOrchestrator.ts`
- **File:** `server/grokOrchestrator.ts`
- **Hook Location:** `export async function generateGrokTradeAnalysis()`
- **Modification:** Ensure Grok reads the Screener proposal and produces `rationale`/`thesis` only, without modifying `selectedModuleId` or `sizeOut`.

---

### Wiring Point 9: M8 Gate Alignment in `app/execution/m8_judge.py`
- **File:** `app/execution/m8_judge.py`
- **Hook Location:** `M8Judge.judge_order()`
- **Modification:** Map gate checks (spread, regime, daily loss) to return matching `OverlayVerdict` reason codes (`EXCESSIVE_SPREAD` -> `RISK_SPREAD`, `CIRCUIT_BREAKER_ACTIVE` -> `RISK_DAILY_LOSS`).

---

### Wiring Point 10: Night-Train Attribution Cron in `scripts/learn_from_journal.py`
- **File:** `scripts/learn_from_journal.py`
- **Hook Location:** Execution entry point
- **Modification:** Trigger nightly or post-session via `python scripts/learn_from_journal.py` with `LEARN_APPLY=1` to update `data/memory/playbook_scorecard.json`.

---

### Wiring Point 11: UI Data Approval Badge in `src/components/DataLakePanel.tsx`
- **File:** `src/components/DataLakePanel.tsx`
- **Hook Location:** Top panel header next to cached span
- **Modification:** Fetch `GET /api/data-approval?symbol=...` and display green `APPROVED` badge or red `BLOCKED [DATA_STALE_TICK]` badge with tooltip showing codes.

---

### Wiring Point 12: System Logs Filter Chips in `src/components/SystemLogsPanel.tsx`
- **File:** `src/components/SystemLogsPanel.tsx`
- **Hook Location:** Log filter bar
- **Modification:** Add filter chips for `kind=system` and overlay codes (`RISK_DATA`, `RISK_DAILY_LOSS`, `RISK_SPREAD`) to allow operators to audit gate rejections in real time.

---

## Instructions for Local Hookup (Peter's Steps)

1. **Tick Source:** Connect `krakenCliStream` live price memory into `buildDataSnapshot()`.
2. **Lake Query:** Hook DuckDB 1m Parquet count query into `getLakeSnapshot()`.
3. **JSONL Tail:** Schedule `scripts/learn_from_journal.py` to process `data/paper/execution_logs.jsonl` on bar close or nightly cron.
