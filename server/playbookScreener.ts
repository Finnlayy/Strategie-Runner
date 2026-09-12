/**
 * Stub implementation for Playbook Screener service.
 * Signatures defined according to docs/pseudocode/00-types.md and 03-screener.md.
 * To be wired by local operator against market indicators and playbook scorecard SoT.
 */

import { DataApproval } from "./dataApproval";
import { Side } from "./riskOverlay";

export interface ScorecardRow {
  moduleId: string;
  regime: string;
  n: number;
  icEwma: number;
  weight: number;
  vetoRate: number;
  expectancyPaper: number;
  proxyShare: number;
}

export interface PlaybookScorecard {
  asOf: string;
  minSamples: number;
  rows: ScorecardRow[];
}

export interface ScreenerProposal {
  symbol: string;
  selectedModuleId: string | null;
  proposedSide: Side;
  thesis: string;
  score: number;
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

export function proposeModule(
  symbol: string,
  dataApproval: DataApproval,
  physicsSnapshot: unknown,
  scorecard: PlaybookScorecard
): ScreenerProposal {
  throw new Error("not wired: PlaybookScreener requires market physics snapshot and scorecard memory");
}
