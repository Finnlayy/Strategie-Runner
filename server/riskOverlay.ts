/**
 * Stub implementation for Risk Overlay Engine (Gates R0-R8).
 * Signatures defined according to docs/pseudocode/00-types.md and 02-risk-overlay.md.
 * To be wired by local operator against M8 Judge and Orchestrator cycle.
 */

import { DataApproval } from "./dataApproval";

export type Side = "buy" | "sell" | "flat";
export type ExecutionMode = "paper" | "live";

export interface GateResult {
  id: string;
  pass: boolean;
  note?: string;
}

export interface OverlayVerdict {
  symbol: string;
  moduleId: string | null;
  side: Side;
  sizeIn: number;
  sizeOut: number;
  allowOpen: boolean;
  allowReduce: boolean;
  gates: GateResult[];
  dataApproval: DataApproval;
}

export interface OverlayContext {
  symbol: string;
  moduleId: string | null;
  proposedSide: Side;
  proposedSize: number;
  executionMode: ExecutionMode;
  isAiLiveOrdersAllowed: boolean;
  dataApproval: DataApproval;
  regime: "MEAN_REVERTING" | "BROWNIAN_CHOP" | "MOMENTUM_TREND" | "SUPER_EXPONENTIAL" | "UNKNOWN";
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
  orderBook: {
    bestBid: number;
    bestAsk: number;
    spreadBps: number;
  } | null;
  lastModuleExecutionBar: number;
  currentBarIndex: number;
  cooldownBarsRequired: number;
}

export function applyOverlay(ctx: OverlayContext): OverlayVerdict {
  throw new Error("not wired: RiskOverlay requires active M8 execution judge and portfolio context input");
}
