/**
 * Stub implementation for Layer-0 Data Approval service.
 * Signatures defined according to docs/pseudocode/00-types.md and 01-data-approved.md.
 * To be wired by local operator against live streams / DuckDB Lake queries.
 */

export interface LakeMetrics {
  first: string | null;
  last: string | null;
  effectiveRows: number;
  density: number;
  broker: "kraken" | "synthetic" | "unknown";
}

export interface DataApproval {
  symbol: string;
  approved: boolean;
  asOf: string;
  codes: string[];
  tickAgeMs: number | null;
  lake: LakeMetrics;
}

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
    brokerTag: string;
    isReadable: boolean;
  } | null;
  pairStatus: {
    isOnline: boolean;
    isHalting: boolean;
    minOrderVolume: number;
  } | null;
  exchangeClockDeltaMs: number | null;
}

export function approveSymbol(snapshot: DataApprovalSnapshot): DataApproval {
  throw new Error("not wired: DataApproval requires live tick and DuckDB lake snapshot input");
}
