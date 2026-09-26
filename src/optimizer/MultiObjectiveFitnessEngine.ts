/* =========================================================
   Datei:      src/optimizer/MultiObjectiveFitnessEngine.ts
   Zweck:      Multi-Objective Fitness Evaluator (DSR, Fees, Sample, Complexity)
   Knoten:     Jaune (Carrera-Engine) / Optimizer
   ========================================================= */

export interface BacktestMetrics {
  totalTrades: number;
  grossPnlUsd: number;
  totalFeesUsd: number;
  netPnlUsd: number;
  annualizedNetReturnPct: number;
  netSharpeRatio: number;
  deflatedSharpeRatioNet: number;
  activeRuleCount: number;
  evaluationDays: number;
}

export interface FitnessResult {
  fitnessScore: number;
  isValidCandidate: boolean;
  rejectionReason?: string;
  samplePenalty: number;
  complexityPenalty: number;
}

export class MultiObjectiveFitnessEngine {
  private readonly minTradesAbsolute: number;
  private readonly minTradesTarget: number;
  private readonly maxAllowedRules: number;

  constructor(minTradesAbsolute: number = 30, minTradesTarget: number = 80, maxAllowedRules: number = 6) {
    this.minTradesAbsolute = minTradesAbsolute;
    this.minTradesTarget = minTradesTarget;
    this.maxAllowedRules = maxAllowedRules;
  }

  public evaluateFitness(metrics: BacktestMetrics): FitnessResult {
    // 1. HARD GUARDRAIL: Trade Starvation Guard (N >= 30)
    if (metrics.totalTrades < this.minTradesAbsolute) {
      return {
        fitnessScore: 0.0,
        isValidCandidate: false,
        rejectionReason: `🚨 [TRADE STARVATION] Nur ${metrics.totalTrades} Trades in ${metrics.evaluationDays} Tagen. Mindestens ${this.minTradesAbsolute} erforderlich!`,
        samplePenalty: 0.0,
        complexityPenalty: 1.0
      };
    }

    // 2. HARD GUARDRAIL: Net Profitabilität (Fee Resistance)
    if (metrics.netPnlUsd <= 0) {
      return {
        fitnessScore: 0.0,
        isValidCandidate: false,
        rejectionReason: `💸 [FEE DRAG DEATH] Netto-P&L ist negativ ($${metrics.netPnlUsd.toFixed(2)} USD nach $${metrics.totalFeesUsd.toFixed(2)} USD Gebühren).`,
        samplePenalty: 1.0,
        complexityPenalty: 1.0
      };
    }

    // 3. Trade Density Penalty P_sample
    let samplePenalty = 1.0;
    if (metrics.totalTrades < this.minTradesTarget) {
      const nominator = metrics.totalTrades - this.minTradesAbsolute;
      const denominator = this.minTradesTarget - this.minTradesAbsolute;
      samplePenalty = Math.pow(nominator / denominator, 2);
    }

    // 4. Parameter Complexity Penalty P_complexity
    let complexityPenalty = 1.0;
    if (metrics.activeRuleCount > this.maxAllowedRules) {
      const excessRules = metrics.activeRuleCount - this.maxAllowedRules;
      complexityPenalty = Math.exp(-0.15 * excessRules);
    }

    // 5. Multi-Objective Score = DSR_net * ln(1 + Annual_Net_Return) * P_sample * P_complexity
    const netReturnFactor = Math.log(1 + Math.max(0, metrics.annualizedNetReturnPct));
    const rawFitness = metrics.deflatedSharpeRatioNet * netReturnFactor * samplePenalty * complexityPenalty;

    const finalScore = Math.max(0.0, rawFitness);
    const isValid = finalScore > 0.35 && metrics.deflatedSharpeRatioNet >= 0.95;

    return {
      fitnessScore: Number(finalScore.toFixed(4)),
      isValidCandidate: isValid,
      samplePenalty: Number(samplePenalty.toFixed(4)),
      complexityPenalty: Number(complexityPenalty.toFixed(4)),
      rejectionReason: isValid ? undefined : `⚠️ Fitness-Score (${finalScore.toFixed(4)}) oder DSR (${metrics.deflatedSharpeRatioNet.toFixed(2)}) unter Schwellenwert.`
    };
  }
}
