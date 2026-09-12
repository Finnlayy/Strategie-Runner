# 03-screener.md — Playbook Screener Architecture

This document specifies the **Playbook Screener** (`propose`), which evaluates strategy modules against current market physics and historical scorecard performance to select a single winning module proposal (or `Hold`).

---

## 1. Core Principles & Design Rules

1. **Generic Module vs. Symbol Instance:**
   - Playbook modules (e.g. `mean_reversion_rsi`, `momentum_breakout`, `grid_neutral`, `dca_accumulator`) are **symbol-agnostic algorithms**.
   - A symbol (e.g. `BTC/USD` or `SOL/USD`) is passed as an **instance parameter**. Never hardcode symbol names into module logic.
2. **Scorecard Feedback Loop:**
   - Screener queries `data/memory/playbook_scorecard.json` for historical performance weights keyed by `(moduleId, regime)`.
   - Modules with strong EWMA Information Coefficient (IC) receive higher weights (up to `1.6`), while weak or frequently vetoed modules receive lower weights (down to `0.35`).
3. **Determinist Selection & LLM Restriction:**
   - Module selection (`selectedModuleId`), side (`buy`/`sell`/`flat`), and base size are strictly computed by deterministic TypeScript/Python code.
   - LLMs / Grok produce **thesis comments and commentary only**. They cannot set `selectedModuleId` or override risk caps.

---

## 2. Playbook Library Inventory

The screener evaluates candidate modules from the open playbook library:

| Module ID | Primary Regime | Archetype / Physics Signal |
|---|---|---|
| `mean_reversion_rsi` | `MEAN_REVERTING` | Z-score extension + RSI oversold/overbought |
| `momentum_breakout` | `MOMENTUM_TREND` | EMA fast/slow crossover + Donchian channel breakout |
| `volatility_expansion` | `SUPER_EXPONENTIAL` | ATR expansion + Bollinger band squeeze breakout |
| `microstructure_spread` | `MEAN_REVERTING` | Order book imbalance + spread mean reversion |
| `grid_neutral` | `BROWNIAN_CHOP` | Grid order ladder within defined support/resistance range |
| `dca_accumulator` | `MEAN_REVERTING` | Periodic dollar-cost averaging into support zones |
| `reverse_dca_exit` | `MOMENTUM_TREND` | Systematic scaling out into resistance extension |
| `pyramid_trend` | `MOMENTUM_TREND` | Winner-scaling on confirmed trend continuation |
| `cluster_exit` | `ALL` | Correlation cluster risk-reduction exit |

---

## 3. Score Formula

For each candidate module $m$ in regime $r$:

$$\text{CompositeScore}(m, r) = \text{PhysicsScore}(m) \times \text{ScorecardWeight}(m, r) \times (1 - \text{VetoPenalty}(m, r))$$

Where:
- $\text{PhysicsScore}(m) \in [0.0, 1.0]$: Quantitative indicator alignment.
- $\text{ScorecardWeight}(m, r) \in [0.35, 1.6]$: EWMA IC weight from `playbook_scorecard.json` (defaults to `1.0` if samples $n < 30$).
- $\text{VetoPenalty}(m, r) = \text{vetoRate}(m, r) \times 0.50$: Penalty factor reducing score if Risk Overlay frequently vetoes the module in this regime.

---

## 4. Pseudocode Implementation (`propose`)

```typescript
import { DataApproval, PlaybookScorecard, ScreenerProposal, Side } from "./00-types";

interface MarketPhysicsSnapshot {
  symbol: string;
  regime: "MEAN_REVERTING" | "BROWNIAN_CHOP" | "MOMENTUM_TREND" | "SUPER_EXPONENTIAL" | "UNKNOWN";
  zScore: number;
  rsi14: number;
  emaFast: number;
  emaSlow: number;
  atrBps: number;
  breakoutUpper: number;
  breakoutLower: number;
  currentPrice: number;
}

const HYSTERESIS_MARGIN = 0.08; // 8% score advantage needed to switch active module

/**
 * Proposes a single winning playbook module or Hold for a given symbol.
 * Pure function, symbol-agnostic, deterministic.
 */
export function propose(
  symbol: string,
  dataApproval: DataApproval,
  physics: MarketPhysicsSnapshot,
  scorecard: PlaybookScorecard,
  currentActiveModuleId: string | null = null
): ScreenerProposal {
  const asOf = new Date().toISOString();
  const sym = symbol.toUpperCase();

  // Rule 1: Layer-0 Data Approval Guard
  if (!dataApproval.approved) {
    return {
      symbol: sym,
      selectedModuleId: null,
      proposedSide: "flat",
      thesis: `Hold: Symbol data not approved (${dataApproval.codes.join(", ")})`,
      score: 0.0,
      candidates: [],
      asOf,
    };
  }

  // Rule 2: Regime Chop Guard
  if (physics.regime === "BROWNIAN_CHOP" || physics.regime === "UNKNOWN") {
    return {
      symbol: sym,
      selectedModuleId: null,
      proposedSide: "flat",
      thesis: `Hold: Market in ${physics.regime} regime; directional entries blocked`,
      score: 0.0,
      candidates: [],
      asOf,
    };
  }

  // Evaluate All Candidate Modules
  const candidates: ScreenerProposal["candidates"] = [];

  // Helper to lookup scorecard row
  const getScorecardRow = (modId: string) => {
    return scorecard.rows.find((r) => r.moduleId === modId && r.regime === physics.regime);
  };

  // --- Candidate 1: Mean Reversion RSI ---
  {
    const modId = "mean_reversion_rsi";
    const scRow = getScorecardRow(modId);
    const scWeight = scRow && scRow.n >= scorecard.minSamples ? scRow.weight : 1.0;
    const vetoRate = scRow ? scRow.vetoRate : 0.0;

    let physicsScore = 0.0;
    let proposedSide: Side = "flat";

    if (physics.regime === "MEAN_REVERTING") {
      if (physics.rsi14 < 30 && physics.zScore < -1.5) {
        physicsScore = Math.min(1.0, (30 - physics.rsi14) / 15 + Math.abs(physics.zScore + 1.5) / 2);
        proposedSide = "buy";
      } else if (physics.rsi14 > 70 && physics.zScore > 1.5) {
        physicsScore = Math.min(1.0, (physics.rsi14 - 70) / 15 + (physics.zScore - 1.5) / 2);
        proposedSide = "sell";
      }
    }

    const vetoPenalty = vetoRate * 0.50;
    const compositeScore = physicsScore * scWeight * (1 - vetoPenalty);

    candidates.push({
      moduleId: modId,
      physicsScore: Math.round(physicsScore * 1000) / 1000,
      scorecardWeight: scWeight,
      vetoPenalty: Math.round(vetoPenalty * 1000) / 1000,
      compositeScore: Math.round(compositeScore * 1000) / 1000,
      eligible: physicsScore > 0.25,
      rejectReason: physicsScore <= 0.25 ? "Physics score below minimum 0.25" : undefined,
    });
  }

  // --- Candidate 2: Momentum Breakout ---
  {
    const modId = "momentum_breakout";
    const scRow = getScorecardRow(modId);
    const scWeight = scRow && scRow.n >= scorecard.minSamples ? scRow.weight : 1.0;
    const vetoRate = scRow ? scRow.vetoRate : 0.0;

    let physicsScore = 0.0;
    let proposedSide: Side = "flat";

    if (physics.regime === "MOMENTUM_TREND" || physics.regime === "SUPER_EXPONENTIAL") {
      if (physics.emaFast > physics.emaSlow && physics.currentPrice > physics.breakoutUpper) {
        physicsScore = Math.min(1.0, 0.5 + (physics.currentPrice - physics.breakoutUpper) / physics.currentPrice * 50);
        proposedSide = "buy";
      } else if (physics.emaFast < physics.emaSlow && physics.currentPrice < physics.breakoutLower) {
        physicsScore = Math.min(1.0, 0.5 + (physics.breakoutLower - physics.currentPrice) / physics.currentPrice * 50);
        proposedSide = "sell";
      }
    }

    const vetoPenalty = vetoRate * 0.50;
    const compositeScore = physicsScore * scWeight * (1 - vetoPenalty);

    candidates.push({
      moduleId: modId,
      physicsScore: Math.round(physicsScore * 1000) / 1000,
      scorecardWeight: scWeight,
      vetoPenalty: Math.round(vetoPenalty * 1000) / 1000,
      compositeScore: Math.round(compositeScore * 1000) / 1000,
      eligible: physicsScore > 0.25,
      rejectReason: physicsScore <= 0.25 ? "Physics score below minimum 0.25" : undefined,
    });
  }

  // Sort eligible candidates by composite score descending
  const eligible = candidates.filter((c) => c.eligible).sort((a, b) => b.compositeScore - a.compositeScore);

  if (eligible.length === 0) {
    return {
      symbol: sym,
      selectedModuleId: null,
      proposedSide: "flat",
      thesis: `Hold: No playbook candidates met minimum physics threshold in ${physics.regime}`,
      score: 0.0,
      candidates,
      asOf,
    };
  }

  let winner = eligible[0];

  // Apply Hysteresis: If current active module is eligible and close in score, retain it
  if (currentActiveModuleId && winner.moduleId !== currentActiveModuleId) {
    const activeCand = eligible.find((c) => c.moduleId === currentActiveModuleId);
    if (activeCand && (winner.compositeScore - activeCand.compositeScore) < HYSTERESIS_MARGIN) {
      winner = activeCand; // Retain active module to prevent churning
    }
  }

  const proposedSide: Side = physics.zScore < 0 || physics.rsi14 < 50 ? "buy" : "sell";

  return {
    symbol: sym,
    selectedModuleId: winner.moduleId,
    proposedSide,
    thesis: `Selected ${winner.moduleId} in ${physics.regime} (Score: ${winner.compositeScore}, Weight: ${winner.scorecardWeight})`,
    score: winner.compositeScore,
    candidates,
    asOf,
  };
}
```

---

## 5. Single-Line Justification for Hysteresis Choice

- **Hysteresis Margin (0.08):** Requires a candidate module to exceed the currently active module by at least 8% score margin to prevent rapid flip-flopping across execution bars.
