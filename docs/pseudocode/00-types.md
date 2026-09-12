# 00-types.md — Risk-Overlay & Closed Learning Loop Type Definitions

This document defines the core data contracts and types for:
1. **Data Approval** (Layer 0 input validation)
2. **Risk Overlay & Verdicts** (Multi-layer risk gates)
3. **Playbook Scorecard & Screener** (Module weights and proposal signals)
4. **Execution Event Metadata Extensions** (Additive schema for journal logs)

---

## 1. Data Approval Types

```ts
/**
 * Lake metrics returned by DuckDB / Parquet query layer.
 */
export interface LakeMetrics {
  first: string | null;            // ISO UTC timestamp of earliest 1m bar
  last: string | null;             // ISO UTC timestamp of latest 1m bar
  effectiveRows: number;           // Total rows in evaluated window
  density: number;                 // 0.0 to 1.0 (fraction of expected 1m slots filled)
  broker: "kraken" | "synthetic" | "unknown";
}

/**
 * Symbol-level Data Approval result.
 * Data approval is strictly per (symbol, timestamp).
 */
export interface DataApproval {
  symbol: string;                  // e.g. "BTC/USD"
  approved: boolean;              // true iff ALL D1-D8 checks pass
  asOf: string;                    // ISO UTC timestamp
  codes: string[];                 // Array of fail codes (empty if approved)
  tickAgeMs: number | null;        // Age of latest stream/REST tick in ms
  lake: LakeMetrics;
}

/**
 * Market Data Snapshot supplied to approveSymbol().
 * Pure input snapshot — functions do not read disk directly.
 */
export interface DataApprovalSnapshot {
  symbol: string;
  nowUtcMs: number;
  tick: {
    lastPrice: number;
    bid: number;
    ask: number;
    timestampMs: number;
    source: "websocket" | "rest";
    isSynthetic?: boolean;
  } | null;
  lake: {
    firstBarUtc: string | null;
    lastBarUtc: string | null;
    totalRowsInWindow: number;
    expectedRowsInWindow: number;
    brokerTag: string;             // "kraken" | "synthetic" | etc.
    isReadable: boolean;
  } | null;
  pairStatus: {
    isOnline: boolean;
    isHalting: boolean;
    minOrderVolume: number;
  } | null;
  exchangeClockDeltaMs: number | null;
}
```

---

## 2. Risk Overlay Types

```ts
export type Side = "buy" | "sell" | "flat";
export type ExecutionMode = "paper" | "live";

/**
 * Result of an individual Risk Gate evaluation.
 */
export interface GateResult {
  id: string;                      // e.g. "R0_DATA_APPROVAL", "R5_DAILY_LOSS"
  pass: boolean;                   // true if gate passed or is inactive
  note?: string;                   // Optional explanation or metrics
}

/**
 * Overlay Verdict emitted by applyOverlay().
 * Guaranteed invariant: sizeOut <= sizeIn, allowOpen can only be narrowed to false.
 */
export interface OverlayVerdict {
  symbol: string;
  moduleId: string | null;         // Selected playbook module ID
  side: Side;
  sizeIn: number;                  // Input quantity requested
  sizeOut: number;                 // Output quantity (<= sizeIn)
  allowOpen: boolean;              // True if new entry position is allowed
  allowReduce: boolean;            // True if position reduction/close is allowed
  gates: GateResult[];             // Results of R0-R8 gates
  dataApproval: DataApproval;      // Snapshot of Layer-0 approval
}

/**
 * Full Context supplied to applyOverlay().
 */
export interface OverlayContext {
  symbol: string;
  moduleId: string | null;
  proposedSide: Side;
  proposedSize: number;
  executionMode: ExecutionMode;
  isAiLiveOrdersAllowed: boolean; // ENV: AI_LIVE_ORDERS === true
  
  // Market & Account State Snapshots
  dataApproval: DataApproval;
  regime: "MEAN_REVERTING" | "BROWNIAN_CHOP" | "MOMENTUM_TREND" | "SUPER_EXPONENTIAL" | "UNKNOWN";
  
  // Portfolio & Account Metrics
  portfolio: {
    initialPaperBalanceUsd: number;
    equityUsd: number;
    availableCashUsd: number;
    realizedDailyPnlUsd: number;
    unrealizedDailyPnlUsd: number;
    symbolGrossExposureUsd: number;
    totalGrossExposureUsd: number;
    openPosition: {
      side: Side;
      qty: number;
      entryPrice: number;
    } | null;
  };
  
  // Microstructure
  orderBook: {
    bestBid: number;
    bestAsk: number;
    spreadBps: number;
  } | null;
  
  // Cooldown State
  lastModuleExecutionBar: number;
  currentBarIndex: number;
  cooldownBarsRequired: number;
}
```

---

## 3. Playbook Scorecard & Screener Types

```ts
/**
 * Single performance attribution row in Playbook Memory.
 */
export interface ScorecardRow {
  moduleId: string;                // e.g. "mean_reversion_rsi", "momentum_breakout"
  regime: string;                  // e.g. "range", "trend", "chop"
  n: number;                       // Total observed trades
  icEwma: number;                  // EWMA Information Coefficient (-1.0 to +1.0)
  weight: number;                  // Clamped multiplier in [0.35, 1.6]
  vetoRate: number;                // Fraction of proposals vetoed by Risk Overlay (0.0 to 1.0)
  expectancyPaper: number;         // Average PnL in USD per trade
  proxyShare: number;              // Fraction of historical trades using strategyId as proxy
}

/**
 * Scorecard SoT persisted in data/memory/playbook_scorecard.json
 */
export interface PlaybookScorecard {
  asOf: string;                    // ISO UTC timestamp of last update
  minSamples: number;              // Minimum samples before weight scales away from 1.0 (default: 30)
  rows: ScorecardRow[];
}

/**
 * Screener Proposal output.
 */
export interface ScreenerProposal {
  symbol: string;
  selectedModuleId: string | null; // Selected module ID or null for Hold
  proposedSide: Side;
  thesis: string;                  // Human or LLM-generated commentary
  score: number;                   // Final composite score
  candidates: {
    moduleId: string;
    physicsScore: number;
    scorecardWeight: number;
    vetoPenalty: number;
    compositeScore: number;
    eligible: boolean;
    rejectReason?: string;
  }[];
  asOf: string;
}
```

---

## 4. Execution Event Metadata Schema Extensions

Events in `data/paper/execution_logs.jsonl` follow `ExecutionEvent`. The `metadata` record is extended additively with the following optional fields:

```ts
export interface EventMetadataExtensions {
  /**
   * Specific Playbook module key (e.g. "mean_reversion_rsi").
   * Fallback for historical logs: strategyId with proxy=true.
   */
  module_id?: string;

  /**
   * Layer-1 Regime state at entry (e.g. "MEAN_REVERTING", "MOMENTUM_TREND").
   */
  regime_at_entry?: string;

  /**
   * Layer-0 Data Approval flag at execution time.
   */
  data_approved?: boolean | null;

  /**
   * List of Risk Overlay gate codes evaluated during decision cycle.
   */
  overlay_codes?: string[];

  /**
   * Holding horizon in bars evaluated for IC attribution.
   */
  horizon_bars?: number;

  /**
   * Source of proposal: "screener" | "human" | "genetic" | "hold" | "unknown".
   */
  proposal_source?: "screener" | "human" | "genetic" | "hold" | "unknown";
}
```

---

## 5. Enum Codes Reference

### Data Approval Codes (D1–D8)
- `DATA_STALE_TICK`: Tick age exceeds 20,000 ms threshold.
- `DATA_SYNTHETIC_TICK`: Tick generated synthetically or failed monotonicity test.
- `DATA_LAKE_UNREADABLE`: DuckDB / Parquet query failed or returned empty set.
- `DATA_LAKE_STALE`: Latest 1m bar is more than 3 minutes behind Current UTC.
- `DATA_LAKE_SPARSE`: 1m bar density in evaluated window is below 95%.
- `DATA_SYNTHETIC_LAKE`: Partition contains synthetic broker tag or GBM seed.
- `DATA_SYMBOL_HALTED`: Asset pair is unlisted or halted on exchange.
- `DATA_CLOCK_SKEW`: Server clock vs exchange clock skew exceeds 2,000 ms.

### Risk Overlay Gate Codes (R0–R8)
- `RISK_DATA`: Layer-0 `data_approved` is false.
- `RISK_REGIME`: Proposed module is incompatible with current regime.
- `RISK_REGIME_FLIP`: Active regime flipped against open position side.
- `RISK_COOLDOWN`: Minimum cooldown bars between executions not met.
- `RISK_CAP`: Quantity exceeds cash, position, or leverage cap.
- `RISK_DAILY_LOSS`: Daily paper PnL drawdown exceeds -3.0% circuit breaker.
- `RISK_EXPOSURE`: Single symbol or correlation cluster exposure cap exceeded.
- `RISK_SPREAD`: Bid-ask spread exceeds 18 bps threshold.
- `RISK_LIVE_GATE`: Live order requested while `AI_LIVE_ORDERS` is false.
