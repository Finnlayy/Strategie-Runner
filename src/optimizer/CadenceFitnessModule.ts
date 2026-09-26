/* =========================================================
   Datei:      src/optimizer/CadenceFitnessModule.ts
   Zweck:      Cadence Bandpass Module (3-6 Trades/Tag Zielkorridor)
   Knoten:     Jaune (Carrera-Engine) / Optimizer Stack
   ========================================================= */

export interface CadenceMetrics {
  totalTrades: number;
  evaluationDays: number;
  tradeTimestamps: number[]; // Epoch ms der Trades für Rhythmus-Analyse
}

export interface CadenceEvaluation {
  tradesPerDay: number;
  cadenceScore: number;
  isWithinTargetRange: boolean;
  rhythmCv: number;
  rejectionReason?: string;
}

export class CadenceFitnessModule {
  private readonly minTargetRate: number;
  private readonly maxTargetRate: number;
  private readonly idealTargetRate: number;

  constructor(minTargetRate: number = 3.0, maxTargetRate: number = 6.0) {
    this.minTargetRate = minTargetRate;
    this.maxTargetRate = maxTargetRate;
    this.idealTargetRate = (minTargetRate + maxTargetRate) / 2.0;
  }

  public evaluateCadence(metrics: CadenceMetrics): CadenceEvaluation {
    if (metrics.evaluationDays <= 0 || metrics.totalTrades === 0) {
      return {
        tradesPerDay: 0,
        cadenceScore: 0.0,
        isWithinTargetRange: false,
        rhythmCv: 0.0,
        rejectionReason: "Keine Trades oder ungültiger Auswertungszeitraum."
      };
    }

    const tradesPerDay = metrics.totalTrades / metrics.evaluationDays;
    
    // Gauß'sche Kadenz-Penalty um idealTargetRate (4.5)
    const sigma = 1.25;
    const diff = tradesPerDay - this.idealTargetRate;
    const cadenceScore = Math.exp(- (diff * diff) / (2 * sigma * sigma));

    // Inter-Arrival Time Variationskoeffizient CV_delta_t
    let rhythmCv = 1.0;
    if (metrics.tradeTimestamps.length >= 3) {
      const intervals: number[] = [];
      for (let i = 1; i < metrics.tradeTimestamps.length; i++) {
        intervals.push((metrics.tradeTimestamps[i] - metrics.tradeTimestamps[i - 1]) / 1000.0);
      }
      
      const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((sum, val) => sum + Math.pow(val - meanInterval, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      rhythmCv = meanInterval > 0 ? stdDev / meanInterval : 1.0;
    }

    const isWithinRange = tradesPerDay >= this.minTargetRate && tradesPerDay <= this.maxTargetRate;
    let reason: string | undefined = undefined;

    if (tradesPerDay < this.minTargetRate) {
      reason = `⚠️ [CADENCE DEFECTION] Frequenz zu niedrig (${tradesPerDay.toFixed(2)} Trades/Tag vs. Ziel 3.0-6.0). Over-Filtering droht!`;
    } else if (tradesPerDay > this.maxTargetRate) {
      reason = `⚠️ [CADENCE EXCESS] Frequenz zu hoch (${tradesPerDay.toFixed(2)} Trades/Tag vs. Ziel 3.0-6.0). Over-Trading droht!`;
    }

    return {
      tradesPerDay: Number(tradesPerDay.toFixed(2)),
      cadenceScore: Number(cadenceScore.toFixed(4)),
      isWithinTargetRange: isWithinRange,
      rhythmCv: Number(rhythmCv.toFixed(2)),
      rejectionReason: reason
    };
  }
}
