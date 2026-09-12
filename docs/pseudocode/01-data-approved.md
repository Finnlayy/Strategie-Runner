# 01-data-approved.md — Layer-0 Data Approval Gate Architecture

This document specifies the **Data Approval Gate** (`approveSymbol`), which acts as the mandatory Layer-0 gate for every strategy execution cycle.

---

## 1. Architectural Rules & Invariants

1. **Gate First:** No new entry (`BUY`/`SELL` open) may be proposed or executed unless `approveSymbol()` returns `approved: true`.
2. **Fail-Closed:** Missing snapshots, stale ticks, missing Lake rows, or unreadable Parquet partitions immediately evaluate to `approved: false`.
3. **Reduce/Close Exception:** If `approved: false`, existing paper positions **may still be reduced or closed**, but never increased or opened.
4. **Symbol & Timestamp Granularity:** Data approval is computed per `(symbol, timestamp)`. An unapproved stale tick on `ETH/USD` does not block `BTC/USD`.
5. **Pure Snapshot Input:** `approveSymbol()` reads no disk files or databases directly. It receives a `DataApprovalSnapshot` object, ensuring pure testability and symbol independence.

---

## 2. Check Specification (D1–D8)

| ID | Check Name | Evaluation Logic | Threshold (Default) | Fail Code |
|---|---|---|---|---|
| **D1** | Stream Tick Freshness | `nowUtcMs - tick.timestampMs <= maxTickAgeMs` | `<= 20,000 ms` (20s) | `DATA_STALE_TICK` |
| **D2** | Real Exchange Tick | `tick.isSynthetic !== true && tick.lastPrice > 0` | Real WS / REST feed | `DATA_SYNTHETIC_TICK` |
| **D3** | Lake Readability | `lake.isReadable === true && lake.totalRowsInWindow > 0` | DuckDB Parquet readable | `DATA_LAKE_UNREADABLE` |
| **D4** | Lake Freshness | `nowUtcMs - parseUtc(lake.lastBarUtc) <= maxLakeStaleMs` | `<= 180,000 ms` (3m) | `DATA_LAKE_STALE` |
| **D5** | Lake Density | `lake.totalRowsInWindow / lake.expectedRowsInWindow >= minDensity` | `>= 0.95` (95% density in 12h window) | `DATA_LAKE_SPARSE` |
| **D6** | Broker Origin | `lake.brokerTag === "kraken"` (no synthetic/GBM partitions) | Real exchange partition | `DATA_SYNTHETIC_LAKE` |
| **D7** | Symbol Status | `pairStatus.isOnline === true && pairStatus.isHalting === false` | Active online pair | `DATA_SYMBOL_HALTED` |
| **D8** | Clock Skew | `abs(exchangeClockDeltaMs) <= maxClockSkewMs` | `< 2,000 ms` (2s) | `DATA_CLOCK_SKEW` |

*Note on D5 (Lake Density): Public Kraken OHLC provides 720 1m candles (~12h). Density evaluates available slots within this rolling 12h span, not an assumed 90-day window.*

---

## 3. Pseudocode Implementation (`approveSymbol`)

```typescript
import { DataApproval, DataApprovalSnapshot, LakeMetrics } from "./00-types";

// Configuration Constants (Kalibrierbar via ENV / Config)
const CONFIG = {
  MAX_TICK_AGE_MS: 20_000,      // D1: 20 seconds
  MAX_LAKE_STALE_MS: 180_000,   // D4: 3 minutes
  MIN_LAKE_DENSITY: 0.95,       // D5: 95% 1m slots filled
  MAX_CLOCK_SKEW_MS: 2_000,     // D8: 2 seconds
};

/**
 * Evaluates Layer-0 Data Approval for a given symbol snapshot.
 * Symbol-agnostic, fail-closed, snapshot-driven.
 */
export function approveSymbol(snapshot: DataApprovalSnapshot): DataApproval {
  const codes: string[] = [];
  const symbol = snapshot.symbol.toUpperCase();
  const nowMs = snapshot.nowUtcMs;

  // Initial Lake Metrics defaults
  let tickAgeMs: number | null = null;
  let lakeMetrics: LakeMetrics = {
    first: snapshot.lake?.firstBarUtc ?? null,
    last: snapshot.lake?.lastBarUtc ?? null,
    effectiveRows: snapshot.lake?.totalRowsInWindow ?? 0,
    density: 0.0,
    broker: "unknown",
  };

  // --- D1 & D2: Stream Tick Verification ---
  if (!snapshot.tick) {
    codes.push("DATA_STALE_TICK");
  } else {
    tickAgeMs = Math.max(0, nowMs - snapshot.tick.timestampMs);
    if (tickAgeMs > CONFIG.MAX_TICK_AGE_MS) {
      codes.push("DATA_STALE_TICK");
    }
    if (snapshot.tick.isSynthetic || snapshot.tick.lastPrice <= 0) {
      codes.push("DATA_SYNTHETIC_TICK");
    }
  }

  // --- D3, D4, D5, D6: Data Lake Verification ---
  if (!snapshot.lake || !snapshot.lake.isReadable || snapshot.lake.totalRowsInWindow <= 0) {
    codes.push("DATA_LAKE_UNREADABLE");
  } else {
    const expected = Math.max(1, snapshot.lake.expectedRowsInWindow);
    const actual = snapshot.lake.totalRowsInWindow;
    const density = Math.min(1.0, actual / expected);
    lakeMetrics.density = Math.round(density * 1000) / 1000;

    // D4: Lake Freshness
    if (!snapshot.lake.lastBarUtc) {
      codes.push("DATA_LAKE_STALE");
    } else {
      const lastBarMs = Date.parse(snapshot.lake.lastBarUtc);
      if (isNaN(lastBarMs) || (nowMs - lastBarMs) > CONFIG.MAX_LAKE_STALE_MS) {
        codes.push("DATA_LAKE_STALE");
      }
    }

    // D5: Lake Density
    if (density < CONFIG.MIN_LAKE_DENSITY) {
      codes.push("DATA_LAKE_SPARSE");
    }

    // D6: Real Broker Partition
    const brokerTag = snapshot.lake.brokerTag.toLowerCase();
    if (brokerTag !== "kraken") {
      lakeMetrics.broker = brokerTag === "synthetic" ? "synthetic" : "unknown";
      codes.push("DATA_SYNTHETIC_LAKE");
    } else {
      lakeMetrics.broker = "kraken";
    }
  }

  // --- D7: Exchange Symbol Status ---
  if (!snapshot.pairStatus || !snapshot.pairStatus.isOnline || snapshot.pairStatus.isHalting) {
    codes.push("DATA_SYMBOL_HALTED");
  }

  // --- D8: Server vs Exchange Clock Skew ---
  if (snapshot.exchangeClockDeltaMs === null || Math.abs(snapshot.exchangeClockDeltaMs) > CONFIG.MAX_CLOCK_SKEW_MS) {
    codes.push("DATA_CLOCK_SKEW");
  }

  // Final Verdict: Approved iff codes array is empty
  const approved = codes.length === 0;

  return {
    symbol,
    approved,
    asOf: new Date(nowMs).toISOString(),
    codes,
    tickAgeMs,
    lake: lakeMetrics,
  };
}
```

---

## 4. Single-Line Justifications for Parameter Choices

- **D1 (20s):** Chosen to align with existing REST fallback trigger in `server/krakenCliStream.ts` for zero latency mismatch.
- **D4 (3m):** Permits up to 3 missing 1m bars during API polling or DuckDB buffer flushing before flagging stale.
- **D5 (0.95):** Allows up to 5% dropped bars over rolling 12h public OHLC window while rejecting corrupted datasets.
- **D8 (2000ms):** Exchange UTC skew tolerance aligned with standard WebSocket timestamp jitter.
