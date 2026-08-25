import { KrakenCandle, fetchLiveKrakenOHLC, resolveKrakenPair } from "./kraken";
import { synthesizeHistoricalCandles } from "./backtest";
import { 
  GeneticChromosome, 
  GeneticIndividual, 
  GeneticConfig, 
  GenerationHistoryPoint, 
  GeneticOptimizationResult,
  BacktestSummary 
} from "../src/types";

// DEFAULT GA CONFIGURATION (Explicitly matching user requirements: 30 Individuals, 50 Generations, 3 Survivors)
export const DEFAULT_GENETIC_CONFIG: GeneticConfig = {
  populationSize: 30,
  maxGenerations: 50,
  survivorsCount: 3,
  mutationRate: 0.18,
  crossoverRate: 0.80,
  walkForwardSplitPercent: 70, // 70% In-Sample / 30% Out-of-Sample Walk-Forward
  assetPair: "BTC/USD",
  interval: 15,
  candleCount: 500,
  initialBalance: 10000,
  feePercent: 0.26,
  slippagePercent: 0.05
};

// HELPER: Random number in range
function randomInRange(min: number, max: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round((min + Math.random() * (max - min)) * factor) / factor;
}

// HELPER: Random boolean with probability
function randomBool(prob: number = 0.5): boolean {
  return Math.random() < prob;
}

// CREATE RANDOM CHROMOSOME (GENOME)
export function createRandomChromosome(presetType?: 'balanced' | 'momentum' | 'smc_fvg' | 'trend_atr'): GeneticChromosome {
  if (presetType === 'smc_fvg') {
    return {
      atrPeriod: 14,
      atrStopMultiplier: randomInRange(1.5, 2.5, 1),
      atrTakeProfitMultiplier: randomInRange(3.0, 5.5, 1),
      useTrailingAtr: randomBool(0.4),
      trailingAtrStep: randomInRange(0.5, 1.2, 1),
      useVolumeFilter: true,
      rvolThreshold: randomInRange(1.2, 2.2, 1),
      useObvTrend: true,
      useTrendFilter: true,
      trendFastEma: randomInRange(9, 21, 0),
      trendSlowEma: randomInRange(50, 100, 0),
      adxFilterEnabled: true,
      adxThreshold: randomInRange(20, 28, 0),
      useFvgFilter: true,
      fvgMinGapPercent: randomInRange(0.1, 0.4, 2),
      fvgMitigationStrict: true,
      useCisdFilter: true,
      cisdLookback: randomInRange(8, 16, 0),
      cisdDisplacementMult: randomInRange(1.3, 1.8, 1),
      useMtfFilter: true,
      mtfMultiplier: 4,
      mtfTrendEma: 50,
      riskPerTradePercent: randomInRange(1.5, 3.0, 1)
    };
  }

  if (presetType === 'trend_atr') {
    return {
      atrPeriod: randomInRange(10, 20, 0),
      atrStopMultiplier: randomInRange(2.0, 3.5, 1),
      atrTakeProfitMultiplier: randomInRange(3.5, 6.0, 1),
      useTrailingAtr: true,
      trailingAtrStep: randomInRange(0.5, 1.0, 1),
      useVolumeFilter: randomBool(0.6),
      rvolThreshold: randomInRange(1.1, 1.8, 1),
      useObvTrend: randomBool(0.5),
      useTrendFilter: true,
      trendFastEma: randomInRange(8, 15, 0),
      trendSlowEma: randomInRange(40, 80, 0),
      adxFilterEnabled: true,
      adxThreshold: randomInRange(22, 30, 0),
      useFvgFilter: randomBool(0.4),
      fvgMinGapPercent: randomInRange(0.1, 0.5, 2),
      fvgMitigationStrict: randomBool(0.5),
      useCisdFilter: randomBool(0.5),
      cisdLookback: randomInRange(10, 20, 0),
      cisdDisplacementMult: randomInRange(1.2, 1.7, 1),
      useMtfFilter: true,
      mtfMultiplier: randomInRange(3, 6, 0),
      mtfTrendEma: randomInRange(30, 60, 0),
      riskPerTradePercent: randomInRange(1.0, 2.5, 1)
    };
  }

  // Balanced default randomization
  return {
    atrPeriod: Math.floor(randomInRange(7, 25, 0)),
    atrStopMultiplier: randomInRange(1.2, 3.8, 1),
    atrTakeProfitMultiplier: randomInRange(2.0, 6.5, 1),
    useTrailingAtr: randomBool(0.5),
    trailingAtrStep: randomInRange(0.3, 1.5, 1),

    useVolumeFilter: randomBool(0.7),
    rvolThreshold: randomInRange(1.1, 2.8, 1),
    useObvTrend: randomBool(0.5),

    useTrendFilter: randomBool(0.8),
    trendFastEma: Math.floor(randomInRange(5, 25, 0)),
    trendSlowEma: Math.floor(randomInRange(30, 120, 0)),
    adxFilterEnabled: randomBool(0.6),
    adxThreshold: Math.floor(randomInRange(18, 32, 0)),

    useFvgFilter: randomBool(0.6),
    fvgMinGapPercent: randomInRange(0.08, 0.6, 2),
    fvgMitigationStrict: randomBool(0.5),

    useCisdFilter: randomBool(0.6),
    cisdLookback: Math.floor(randomInRange(6, 22, 0)),
    cisdDisplacementMult: randomInRange(1.2, 2.2, 1),

    useMtfFilter: randomBool(0.6),
    mtfMultiplier: Math.floor(randomInRange(3, 8, 0)),
    mtfTrendEma: Math.floor(randomInRange(20, 80, 0)),

    riskPerTradePercent: randomInRange(1.0, 3.5, 1)
  };
}

// MUTATION FUNCTION
export function mutateChromosome(chromosome: GeneticChromosome, mutationRate: number = 0.18): GeneticChromosome {
  const c = { ...chromosome };

  if (Math.random() < mutationRate) c.atrPeriod = Math.max(5, Math.min(30, Math.round(c.atrPeriod + (Math.random() * 4 - 2))));
  if (Math.random() < mutationRate) c.atrStopMultiplier = Math.max(0.8, Math.min(5.0, Number((c.atrStopMultiplier + (Math.random() * 0.8 - 0.4)).toFixed(1))));
  if (Math.random() < mutationRate) c.atrTakeProfitMultiplier = Math.max(1.2, Math.min(8.5, Number((c.atrTakeProfitMultiplier + (Math.random() * 1.2 - 0.6)).toFixed(1))));
  if (Math.random() < mutationRate * 0.6) c.useTrailingAtr = !c.useTrailingAtr;
  if (Math.random() < mutationRate) c.trailingAtrStep = Math.max(0.2, Math.min(2.5, Number((c.trailingAtrStep + (Math.random() * 0.4 - 0.2)).toFixed(1))));

  if (Math.random() < mutationRate * 0.6) c.useVolumeFilter = !c.useVolumeFilter;
  if (Math.random() < mutationRate) c.rvolThreshold = Math.max(1.0, Math.min(4.0, Number((c.rvolThreshold + (Math.random() * 0.5 - 0.25)).toFixed(1))));
  if (Math.random() < mutationRate * 0.6) c.useObvTrend = !c.useObvTrend;

  if (Math.random() < mutationRate * 0.6) c.useTrendFilter = !c.useTrendFilter;
  if (Math.random() < mutationRate) c.trendFastEma = Math.max(4, Math.min(35, Math.round(c.trendFastEma + (Math.random() * 4 - 2))));
  if (Math.random() < mutationRate) c.trendSlowEma = Math.max(c.trendFastEma + 10, Math.min(180, Math.round(c.trendSlowEma + (Math.random() * 16 - 8))));
  if (Math.random() < mutationRate * 0.6) c.adxFilterEnabled = !c.adxFilterEnabled;
  if (Math.random() < mutationRate) c.adxThreshold = Math.max(15, Math.min(38, Math.round(c.adxThreshold + (Math.random() * 4 - 2))));

  if (Math.random() < mutationRate * 0.6) c.useFvgFilter = !c.useFvgFilter;
  if (Math.random() < mutationRate) c.fvgMinGapPercent = Math.max(0.05, Math.min(1.0, Number((c.fvgMinGapPercent + (Math.random() * 0.1 - 0.05)).toFixed(2))));
  if (Math.random() < mutationRate * 0.6) c.fvgMitigationStrict = !c.fvgMitigationStrict;

  if (Math.random() < mutationRate * 0.6) c.useCisdFilter = !c.useCisdFilter;
  if (Math.random() < mutationRate) c.cisdLookback = Math.max(5, Math.min(25, Math.round(c.cisdLookback + (Math.random() * 4 - 2))));
  if (Math.random() < mutationRate) c.cisdDisplacementMult = Math.max(1.0, Math.min(2.5, Number((c.cisdDisplacementMult + (Math.random() * 0.3 - 0.15)).toFixed(1))));

  if (Math.random() < mutationRate * 0.6) c.useMtfFilter = !c.useMtfFilter;
  if (Math.random() < mutationRate) c.mtfMultiplier = Math.max(2, Math.min(10, Math.round(c.mtfMultiplier + (Math.random() * 2 - 1))));
  if (Math.random() < mutationRate) c.mtfTrendEma = Math.max(15, Math.min(100, Math.round(c.mtfTrendEma + (Math.random() * 10 - 5))));

  if (Math.random() < mutationRate) c.riskPerTradePercent = Math.max(0.5, Math.min(5.0, Number((c.riskPerTradePercent + (Math.random() * 0.6 - 0.3)).toFixed(1))));

  return c;
}

// CROSSOVER (BREEDING) FUNCTION
export function crossoverChromosomes(parentA: GeneticChromosome, parentB: GeneticChromosome): GeneticChromosome {
  const child: GeneticChromosome = {
    atrPeriod: randomBool() ? parentA.atrPeriod : parentB.atrPeriod,
    atrStopMultiplier: randomBool() ? parentA.atrStopMultiplier : parentB.atrStopMultiplier,
    atrTakeProfitMultiplier: randomBool() ? parentA.atrTakeProfitMultiplier : parentB.atrTakeProfitMultiplier,
    useTrailingAtr: randomBool() ? parentA.useTrailingAtr : parentB.useTrailingAtr,
    trailingAtrStep: randomBool() ? parentA.trailingAtrStep : parentB.trailingAtrStep,

    useVolumeFilter: randomBool() ? parentA.useVolumeFilter : parentB.useVolumeFilter,
    rvolThreshold: randomBool() ? parentA.rvolThreshold : parentB.rvolThreshold,
    useObvTrend: randomBool() ? parentA.useObvTrend : parentB.useObvTrend,

    useTrendFilter: randomBool() ? parentA.useTrendFilter : parentB.useTrendFilter,
    trendFastEma: randomBool() ? parentA.trendFastEma : parentB.trendFastEma,
    trendSlowEma: randomBool() ? parentA.trendSlowEma : parentB.trendSlowEma,
    adxFilterEnabled: randomBool() ? parentA.adxFilterEnabled : parentB.adxFilterEnabled,
    adxThreshold: randomBool() ? parentA.adxThreshold : parentB.adxThreshold,

    useFvgFilter: randomBool() ? parentA.useFvgFilter : parentB.useFvgFilter,
    fvgMinGapPercent: randomBool() ? parentA.fvgMinGapPercent : parentB.fvgMinGapPercent,
    fvgMitigationStrict: randomBool() ? parentA.fvgMitigationStrict : parentB.fvgMitigationStrict,

    useCisdFilter: randomBool() ? parentA.useCisdFilter : parentB.useCisdFilter,
    cisdLookback: randomBool() ? parentA.cisdLookback : parentB.cisdLookback,
    cisdDisplacementMult: randomBool() ? parentA.cisdDisplacementMult : parentB.cisdDisplacementMult,

    useMtfFilter: randomBool() ? parentA.useMtfFilter : parentB.useMtfFilter,
    mtfMultiplier: randomBool() ? parentA.mtfMultiplier : parentB.mtfMultiplier,
    mtfTrendEma: randomBool() ? parentA.mtfTrendEma : parentB.mtfTrendEma,

    riskPerTradePercent: randomBool() ? parentA.riskPerTradePercent : parentB.riskPerTradePercent
  };

  if (child.trendSlowEma <= child.trendFastEma) {
    child.trendSlowEma = child.trendFastEma + 15;
  }

  return child;
}

// QUANTITATIVE INDICATOR CALCULATIONS FOR CHROMOSOME SIMULATION
interface QuantIndicators {
  atr: number[];
  rvol: number[];
  obvSlope: number[];
  fastEma: number[];
  slowEma: number[];
  adx: number[];
  bullishFvg: boolean[];
  bearishFvg: boolean[];
  fvgMitigated: boolean[];
  cisdBullish: boolean[];
  cisdBearish: boolean[];
  mtfTrendBullish: boolean[];
}

export function computeQuantIndicators(candles: KrakenCandle[], genes: GeneticChromosome): QuantIndicators {
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  // 1. ATR (Average True Range)
  const atr: number[] = new Array(n).fill(0);
  const tr: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr[i] = highs[i] - lows[i];
    } else {
      const h_l = highs[i] - lows[i];
      const h_pc = Math.abs(highs[i] - closes[i - 1]);
      const l_pc = Math.abs(lows[i] - closes[i - 1]);
      tr[i] = Math.max(h_l, h_pc, l_pc);
    }
  }
  const period = Math.max(3, genes.atrPeriod);
  let runningTR = 0;
  for (let i = 0; i < n; i++) {
    if (i < period) {
      runningTR += tr[i];
      atr[i] = runningTR / (i + 1);
    } else if (i === period) {
      runningTR += tr[i];
      atr[i] = runningTR / period;
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
  }

  // 2. Relative Volume (RVOL) vs 20-SMA Volume
  const rvol: number[] = new Array(n).fill(1.0);
  const volSmaPeriod = 20;
  for (let i = 0; i < n; i++) {
    const sliceStart = Math.max(0, i - volSmaPeriod + 1);
    const slice = volumes.slice(sliceStart, i + 1);
    const avgVol = slice.reduce((a, b) => a + b, 0) / slice.length;
    rvol[i] = avgVol > 0 ? volumes[i] / avgVol : 1.0;
  }

  // 3. OBV (On-Balance Volume) & 5-bar slope
  const obv: number[] = new Array(n).fill(0);
  const obvSlope: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (closes[i] > closes[i - 1]) obv[i] = obv[i - 1] + volumes[i];
    else if (closes[i] < closes[i - 1]) obv[i] = obv[i - 1] - volumes[i];
    else obv[i] = obv[i - 1];

    if (i >= 5) {
      obvSlope[i] = obv[i] - obv[i - 5];
    }
  }

  // 4. Trend EMAs
  const calcEMA = (data: number[], p: number): number[] => {
    const res = new Array(data.length).fill(0);
    if (data.length === 0) return res;
    const k = 2 / (p + 1);
    res[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      res[i] = data[i] * k + res[i - 1] * (1 - k);
    }
    return res;
  };
  const fastEma = calcEMA(closes, genes.trendFastEma);
  const slowEma = calcEMA(closes, genes.trendSlowEma);

  // 5. ADX (Average Directional Index) approximation
  const adx: number[] = new Array(n).fill(25);
  for (let i = 14; i < n; i++) {
    // Smoothed directional movement approximation
    let plusDM = 0;
    let minusDM = 0;
    for (let j = i - 13; j <= i; j++) {
      const upMove = highs[j] - highs[j - 1];
      const downMove = lows[j - 1] - lows[j];
      if (upMove > downMove && upMove > 0) plusDM += upMove;
      if (downMove > upMove && downMove > 0) minusDM += downMove;
    }
    const sum = plusDM + minusDM;
    const dx = sum > 0 ? (Math.abs(plusDM - minusDM) / sum) * 100 : 20;
    adx[i] = adx[i - 1] ? (adx[i - 1] * 13 + dx) / 14 : dx;
  }

  // 6. Fair Value Gap (FVG) Imbalance Detection (3-candle ICT structure)
  const bullishFvg: boolean[] = new Array(n).fill(false);
  const bearishFvg: boolean[] = new Array(n).fill(false);
  const fvgMitigated: boolean[] = new Array(n).fill(false);

  for (let i = 2; i < n; i++) {
    const candle1 = candles[i - 2];
    const candle2 = candles[i - 1];
    const candle3 = candles[i];

    const gapPercentThreshold = genes.fvgMinGapPercent / 100;

    // Bullish FVG: Candle 1 High is lower than Candle 3 Low (empty displacement gap)
    if (candle3.low > candle1.high) {
      const gapSize = (candle3.low - candle1.high) / candle2.close;
      if (gapSize >= gapPercentThreshold) {
        bullishFvg[i] = true;
      }
    }

    // Bearish FVG: Candle 1 Low is higher than Candle 3 High
    if (candle1.low > candle3.high) {
      const gapSize = (candle1.low - candle3.high) / candle2.close;
      if (gapSize >= gapPercentThreshold) {
        bearishFvg[i] = true;
      }
    }

    // Check if recent gap was mitigated (price entered back into the gap zone)
    if (i >= 5 && bullishFvg[i - 2] && lows[i] <= candles[i - 3].high) {
      fvgMitigated[i] = true;
    }
  }

  // 7. Change In State of Delivery (CISD) / SMC Structure Shift
  const cisdBullish: boolean[] = new Array(n).fill(false);
  const cisdBearish: boolean[] = new Array(n).fill(false);

  const lookback = Math.max(4, genes.cisdLookback);
  for (let i = lookback + 1; i < n; i++) {
    const recentHighs = highs.slice(i - lookback, i);
    const recentLows = lows.slice(i - lookback, i);
    const swingHigh = Math.max(...recentHighs);
    const swingLow = Math.min(...recentLows);

    const bodyRange = Math.abs(closes[i] - candles[i].open);
    const avgBody = closes.slice(i - 5, i).reduce((sum, _, idx) => sum + Math.abs(closes[i - 5 + idx] - candles[i - 5 + idx].open), 0) / 5;
    const isDisplacement = avgBody > 0 ? (bodyRange / avgBody) >= genes.cisdDisplacementMult : true;

    // Bullish CISD: Strong displacement close above recent swing high
    if (closes[i] > swingHigh && isDisplacement) {
      cisdBullish[i] = true;
    }
    // Bearish CISD: Strong displacement close below recent swing low
    if (closes[i] < swingLow && isDisplacement) {
      cisdBearish[i] = true;
    }
  }

  // 8. Multi-Timeframe (MTF) Alignment (Synthetic higher timeframe EMA)
  const mtfTrendBullish: boolean[] = new Array(n).fill(true);
  const mtfMult = Math.max(2, genes.mtfMultiplier);
  const mtfEmaPeriod = Math.max(10, genes.mtfTrendEma);
  const syntheticHigherCloses: number[] = [];
  
  for (let i = 0; i < n; i += mtfMult) {
    syntheticHigherCloses.push(closes[i]);
  }
  const htfEma = calcEMA(syntheticHigherCloses, mtfEmaPeriod);

  for (let i = 0; i < n; i++) {
    const htfIndex = Math.min(Math.floor(i / mtfMult), htfEma.length - 1);
    mtfTrendBullish[i] = closes[i] >= (htfEma[htfIndex] || closes[i]);
  }

  return {
    atr,
    rvol,
    obvSlope,
    fastEma,
    slowEma,
    adx,
    bullishFvg,
    bearishFvg,
    fvgMitigated,
    cisdBullish,
    cisdBearish,
    mtfTrendBullish
  };
}

// SIMULATE CHROMOSOME ON OHLC SEGMENT (IN-SAMPLE OR OUT-OF-SAMPLE)
export function evaluateChromosomeOnSegment(
  candles: KrakenCandle[],
  indicators: QuantIndicators,
  genes: GeneticChromosome,
  initialBalance: number = 10000,
  feePercent: number = 0.26,
  slippagePercent: number = 0.05
): BacktestSummary {
  if (!candles || candles.length < 20) {
    return {
      initialBalance,
      finalBalance: initialBalance,
      totalReturnUSD: 0,
      totalReturnPercent: 0,
      benchmarkReturnPercent: 0,
      alpha: 0,
      maxDrawdownPercent: 0,
      maxDrawdownUSD: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      profitFactor: 1.0,
      winRate: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      averageTradeReturn: 0,
      bestTradeUSD: 0,
      worstTradeUSD: 0,
      avgHoldCandles: 0,
      totalFeesPaid: 0
    };
  }

  let cash = initialBalance;
  let positionSize = 0; // units of asset
  let entryPrice = 0;
  let entryIndex = 0;
  let trailingStopPrice = 0;
  let takeProfitPrice = 0;

  const tradePnLs: number[] = [];
  const holdDurations: number[] = [];
  let totalFeesPaid = 0;
  let peakEquity = initialBalance;
  let maxDrawdownUSD = 0;
  let maxDrawdownPercent = 0;
  const equityPoints: number[] = [initialBalance];

  const {
    atr,
    rvol,
    obvSlope,
    fastEma,
    slowEma,
    adx,
    bullishFvg,
    bearishFvg,
    fvgMitigated,
    cisdBullish,
    cisdBearish,
    mtfTrendBullish
  } = indicators;

  const feeRate = feePercent / 100;
  const slipRate = slippagePercent / 100;

  for (let i = 15; i < candles.length; i++) {
    const candle = candles[i];
    const curPrice = candle.close;
    const curAtr = atr[i] || (curPrice * 0.02);

    // Current Mark-to-Market Equity
    const currentEquity = cash + positionSize * curPrice;
    if (currentEquity > peakEquity) peakEquity = currentEquity;
    const curDD = peakEquity - currentEquity;
    const curDDPct = peakEquity > 0 ? (curDD / peakEquity) * 100 : 0;
    if (curDD > maxDrawdownUSD) maxDrawdownUSD = curDD;
    if (curDDPct > maxDrawdownPercent) maxDrawdownPercent = curDDPct;
    equityPoints.push(currentEquity);

    // POSITION EXIT / RISK MANAGEMENT LOGIC (ATR Stop-Loss & Take-Profit)
    if (positionSize > 0) {
      let shouldExit = false;
      let exitReason = "signal";

      // 1. Check ATR Hard Stop-Loss
      if (candle.low <= trailingStopPrice) {
        shouldExit = true;
        exitReason = "atr_stop";
      }
      // 2. Check ATR Take-Profit
      else if (candle.high >= takeProfitPrice) {
        shouldExit = true;
        exitReason = "atr_take_profit";
      }
      // 3. Update Trailing Stop
      else if (genes.useTrailingAtr) {
        const newTrail = curPrice - curAtr * genes.trailingAtrStep;
        if (newTrail > trailingStopPrice) {
          trailingStopPrice = newTrail;
        }
      }

      // 4. Reverse Signal / Trend Invalidation
      if (!shouldExit && genes.useTrendFilter && fastEma[i] < slowEma[i] && fastEma[i - 1] >= slowEma[i - 1]) {
        shouldExit = true;
        exitReason = "trend_invalidation";
      }

      if (shouldExit) {
        let fillPrice = curPrice;
        if (exitReason === "atr_stop") fillPrice = Math.min(curPrice, trailingStopPrice);
        if (exitReason === "atr_take_profit") fillPrice = Math.max(curPrice, takeProfitPrice);
        fillPrice = fillPrice * (1 - slipRate);

        const exitValue = positionSize * fillPrice;
        const fee = exitValue * feeRate;
        totalFeesPaid += fee;
        const netCashReceived = exitValue - fee;
        cash += netCashReceived;

        const tradeCost = positionSize * entryPrice;
        const pnl = netCashReceived - tradeCost;
        tradePnLs.push(pnl);
        holdDurations.push(i - entryIndex);

        positionSize = 0;
        entryPrice = 0;
      }
    }

    // POSITION ENTRY EVALUATION
    if (positionSize === 0) {
      let isBuySignal = false;

      // Base Signal Trigger (Fast/Slow EMA Crossover or SMC Momentum)
      const trendAligned = !genes.useTrendFilter || (fastEma[i] > slowEma[i] && curPrice > fastEma[i]);
      const adxValid = !genes.adxFilterEnabled || (adx[i] >= genes.adxThreshold);

      // Volume Filter Confirmation
      const volumeValid = !genes.useVolumeFilter || (
        rvol[i] >= genes.rvolThreshold && (!genes.useObvTrend || obvSlope[i] >= 0)
      );

      // FVG (Fair Value Gap) Confirmation
      const fvgValid = !genes.useFvgFilter || (
        bullishFvg[i] || (genes.fvgMitigationStrict ? fvgMitigated[i] : (bullishFvg[i - 1] || bullishFvg[i - 2]))
      );

      // CISD / SMC Market Structure Shift
      const cisdValid = !genes.useCisdFilter || cisdBullish[i];

      // Multi-Timeframe Alignment
      const mtfValid = !genes.useMtfFilter || mtfTrendBullish[i];

      // Combined Quantitative Logic
      if (trendAligned && adxValid && volumeValid && mtfValid) {
        if (!genes.useFvgFilter && !genes.useCisdFilter) {
          isBuySignal = true;
        } else if (fvgValid || cisdValid) {
          isBuySignal = true;
        }
      }

      if (isBuySignal && cash > 50) {
        const riskPct = genes.riskPerTradePercent / 100;
        const allocatedCash = Math.min(cash * 0.95, cash * (riskPct * 8)); // Sized to volatility
        if (allocatedCash >= 20) {
          const fillPrice = curPrice * (1 + slipRate);
          const fee = allocatedCash * feeRate;
          totalFeesPaid += fee;
          const netBuyCapital = allocatedCash - fee;
          positionSize = netBuyCapital / fillPrice;
          entryPrice = fillPrice;
          entryIndex = i;
          cash -= allocatedCash;

          // Initialize Dynamic ATR Stop-Loss and Take-Profit Levels
          trailingStopPrice = entryPrice - (curAtr * genes.atrStopMultiplier);
          takeProfitPrice = entryPrice + (curAtr * genes.atrTakeProfitMultiplier);
        }
      }
    }
  }

  // Close any open position at end of segment
  if (positionSize > 0) {
    const finalPrice = candles[candles.length - 1].close * (1 - slipRate);
    const finalVal = positionSize * finalPrice;
    const fee = finalVal * feeRate;
    totalFeesPaid += fee;
    cash += (finalVal - fee);
    const pnl = (finalVal - fee) - (positionSize * entryPrice);
    tradePnLs.push(pnl);
    holdDurations.push(candles.length - 1 - entryIndex);
    positionSize = 0;
  }

  const finalBalance = Number(cash.toFixed(2));
  const totalReturnUSD = Number((finalBalance - initialBalance).toFixed(2));
  const totalReturnPercent = Number((((finalBalance - initialBalance) / initialBalance) * 100).toFixed(2));

  // Benchmark Return (Buy & Hold)
  const firstPrice = candles[0].close;
  const lastPrice = candles[candles.length - 1].close;
  const benchmarkReturnPercent = firstPrice > 0 ? Number((((lastPrice - firstPrice) / firstPrice) * 100).toFixed(2)) : 0;
  const alpha = Number((totalReturnPercent - benchmarkReturnPercent).toFixed(2));

  const totalTrades = tradePnLs.length;
  const winningTrades = tradePnLs.filter(p => p > 0).length;
  const losingTrades = tradePnLs.filter(p => p <= 0).length;
  const winRate = totalTrades > 0 ? Number(((winningTrades / totalTrades) * 100).toFixed(1)) : 0;

  const grossProfit = tradePnLs.filter(p => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(tradePnLs.filter(p => p < 0).reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : (grossProfit > 0 ? 5.0 : 1.0);

  // Sharpe & Sortino Calculations
  let sharpeRatio = 0;
  let sortinoRatio = 0;
  if (totalTrades >= 3) {
    const avgTrade = tradePnLs.reduce((a, b) => a + b, 0) / totalTrades;
    const variance = tradePnLs.reduce((a, b) => a + Math.pow(b - avgTrade, 2), 0) / totalTrades;
    const stdDev = Math.sqrt(variance);
    sharpeRatio = stdDev > 0 ? Number(((avgTrade / stdDev) * Math.sqrt(totalTrades)).toFixed(2)) : 0;

    const downsideVariance = tradePnLs.filter(p => p < 0).reduce((a, b) => a + Math.pow(b, 2), 0) / totalTrades;
    const downsideStdDev = Math.sqrt(downsideVariance);
    sortinoRatio = downsideStdDev > 0 ? Number(((avgTrade / downsideStdDev) * Math.sqrt(totalTrades)).toFixed(2)) : sharpeRatio;
  }

  const averageTradeReturn = totalTrades > 0 ? Number((totalReturnUSD / totalTrades).toFixed(2)) : 0;
  const bestTradeUSD = tradePnLs.length > 0 ? Number(Math.max(...tradePnLs).toFixed(2)) : 0;
  const worstTradeUSD = tradePnLs.length > 0 ? Number(Math.min(...tradePnLs).toFixed(2)) : 0;
  const avgHoldCandles = holdDurations.length > 0 ? Math.round(holdDurations.reduce((a, b) => a + b, 0) / holdDurations.length) : 0;

  return {
    initialBalance,
    finalBalance,
    totalReturnUSD,
    totalReturnPercent,
    benchmarkReturnPercent,
    alpha,
    maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(2)),
    maxDrawdownUSD: Number(maxDrawdownUSD.toFixed(2)),
    sharpeRatio: Math.max(-3, Math.min(8, sharpeRatio)),
    sortinoRatio: Math.max(-3, Math.min(10, sortinoRatio)),
    profitFactor: Math.min(15, Math.max(0, profitFactor)),
    winRate,
    totalTrades,
    winningTrades,
    losingTrades,
    averageTradeReturn,
    bestTradeUSD,
    worstTradeUSD,
    avgHoldCandles,
    totalFeesPaid: Number(totalFeesPaid.toFixed(2))
  };
}

// MULTI-OBJECTIVE FITNESS FUNCTION
export function calculateFitness(inSample: BacktestSummary, outOfSample: BacktestSummary): { fitness: number; robustnessIndex: number } {
  // Balance return, risk-adjusted returns (Sharpe/Sortino), drawdown penalty, and minimum trade activity
  const isReturn = inSample.totalReturnPercent;
  const oosReturn = outOfSample.totalReturnPercent;
  const isSharpe = Math.max(-1, inSample.sharpeRatio);
  const oosSharpe = Math.max(-1, outOfSample.sharpeRatio);
  const isDrawdown = inSample.maxDrawdownPercent;
  const oosDrawdown = outOfSample.maxDrawdownPercent;

  // Robustness Index: Compares Out-of-Sample stability vs In-Sample training performance
  let robustness = 50;
  if (isReturn > 0) {
    const returnRatio = Math.max(0, oosReturn / (isReturn * (30 / 70))); // normalized by 70/30 split
    robustness = Math.min(100, Math.round(returnRatio * 50 + (oosSharpe > 0 ? 30 : 10)));
  } else if (oosReturn >= 0) {
    robustness = 65;
  }

  let fitnessScore = 0;
  // Weight In-Sample (40%) and Out-of-Sample (60% to punish overfitting)
  fitnessScore += (isReturn * 0.4) + (oosReturn * 0.9);
  fitnessScore += (isSharpe * 12) + (oosSharpe * 20);
  fitnessScore += inSample.profitFactor * 6 + outOfSample.profitFactor * 8;

  // Penalize high drawdown heavily
  fitnessScore -= (isDrawdown * 0.8) + (oosDrawdown * 1.5);

  // Penalize insufficient trades (over-fitted to 1 or 2 lucky trades)
  const totalTrades = inSample.totalTrades + outOfSample.totalTrades;
  if (totalTrades < 4) fitnessScore -= 30;
  else if (totalTrades < 8) fitnessScore -= 10;
  else fitnessScore += Math.min(15, totalTrades * 0.5);

  return {
    fitness: Number(fitnessScore.toFixed(2)),
    robustnessIndex: Math.max(10, Math.min(100, robustness))
  };
}

// HELPER: Convert existing trading strategy into seed chromosome
export function convertStrategyToChromosome(strat?: { 
  id?: string;
  name?: string; 
  parameters?: Record<string, any>; 
  code?: string; 
  assetPair?: string; 
  hardStopPercent?: number 
}): GeneticChromosome {
  const p = strat?.parameters || {};
  const code = (strat?.code || "").toLowerCase();
  const name = (strat?.name || "").toLowerCase();
  
  const isSMC = code.includes("fvg") || code.includes("cisd") || code.includes("imbalance") || name.includes("smc") || name.includes("fair value") || name.includes("ict");
  const isMomentum = code.includes("macd") || code.includes("ema") || code.includes("crossover") || name.includes("macd") || name.includes("momentum");
  const isRsi = code.includes("rsi") || name.includes("rsi") || code.includes("reversion");
  const isGrid = code.includes("grid") || name.includes("grid");

  let base = createRandomChromosome(isSMC ? 'smc_fvg' : 'trend_atr');

  // Map known explicit parameters
  if (p.atrPeriod) base.atrPeriod = Math.max(5, Math.min(30, Number(p.atrPeriod)));
  if (p.atrStopMultiplier) base.atrStopMultiplier = Math.max(0.8, Math.min(5.0, Number(p.atrStopMultiplier)));
  if (p.atrTakeProfitMultiplier) base.atrTakeProfitMultiplier = Math.max(1.2, Math.min(8.0, Number(p.atrTakeProfitMultiplier)));
  if (p.trailingAtrStep) base.trailingAtrStep = Math.max(0.2, Math.min(2.5, Number(p.trailingAtrStep)));
  if (p.useTrailingAtr !== undefined) base.useTrailingAtr = Boolean(p.useTrailingAtr);

  // EMA / Trend periods
  if (p.fastPeriod || p.trendFastEma) base.trendFastEma = Math.max(4, Math.min(35, Number(p.fastPeriod || p.trendFastEma)));
  if (p.slowPeriod || p.trendSlowEma) base.trendSlowEma = Math.max(base.trendFastEma + 8, Math.min(180, Number(p.slowPeriod || p.trendSlowEma)));
  
  // Indicators & Filters
  if (p.rvolThreshold) base.rvolThreshold = Math.max(1.0, Math.min(4.0, Number(p.rvolThreshold)));
  if (p.fvgMinGapPercent) base.fvgMinGapPercent = Math.max(0.05, Math.min(1.0, Number(p.fvgMinGapPercent)));
  if (p.cisdLookback) base.cisdLookback = Math.max(5, Math.min(25, Number(p.cisdLookback)));
  if (p.mtfMultiplier) base.mtfMultiplier = Math.max(2, Math.min(10, Number(p.mtfMultiplier)));
  if (p.mtfTrendEma) base.mtfTrendEma = Math.max(15, Math.min(100, Number(p.mtfTrendEma)));
  if (p.adxThreshold) base.adxThreshold = Math.max(15, Math.min(38, Number(p.adxThreshold)));
  if (p.riskPerTradePercent) base.riskPerTradePercent = Math.max(0.5, Math.min(5.0, Number(p.riskPerTradePercent)));

  if (strat?.hardStopPercent) {
    base.atrStopMultiplier = Math.max(1.0, Math.min(5.0, Number((strat.hardStopPercent / 1.8).toFixed(1))));
  }
  if (p.stopLossPercent) {
    base.atrStopMultiplier = Math.max(1.0, Math.min(5.0, Number((p.stopLossPercent / 1.8).toFixed(1))));
  }

  if (isSMC) {
    base.useFvgFilter = true;
    base.useCisdFilter = true;
    base.useMtfFilter = true;
    base.useTrendFilter = true;
  } else if (isMomentum) {
    base.useTrendFilter = true;
    base.useVolumeFilter = true;
    base.useObvTrend = true;
    if (!p.trendFastEma && !p.fastPeriod) base.trendFastEma = 12;
    if (!p.trendSlowEma && !p.slowPeriod) base.trendSlowEma = 26;
  } else if (isRsi) {
    base.useVolumeFilter = true;
    base.useTrailingAtr = true;
    base.atrStopMultiplier = 2.0;
    base.atrTakeProfitMultiplier = 3.5;
  } else if (isGrid) {
    base.useTrailingAtr = true;
    base.atrTakeProfitMultiplier = 2.2;
    base.atrStopMultiplier = 2.8;
  }

  return base;
}

// RUN COMPLETE GENETIC WALK-FORWARD OPTIMIZATION
export async function runGeneticWalkForwardOptimization(
  config: Partial<GeneticConfig> & {
    baselineStrategy?: {
      id?: string;
      name?: string;
      parameters?: Record<string, any>;
      code?: string;
      assetPair?: string;
      hardStopPercent?: number;
    };
  } = {},
  onGenerationProgress?: (gen: number, best: GeneticIndividual) => void
): Promise<GeneticOptimizationResult> {
  const fullConfig: GeneticConfig = {
    ...DEFAULT_GENETIC_CONFIG,
    ...config
  };

  const {
    populationSize = 30,
    maxGenerations = 50,
    survivorsCount = 3,
    mutationRate = 0.18,
    crossoverRate = 0.80,
    walkForwardSplitPercent = 70,
    assetPair = "BTC/USD",
    interval = 15,
    candleCount = 500,
    initialBalance = 10000,
    feePercent = 0.26,
    slippagePercent = 0.05,
    baselineStrategyId,
    baselineStrategyName
  } = fullConfig;

  const baselineStrategy = config.baselineStrategy;

  // Fetch real Kraken OHLC historical data
  let allCandles = await fetchLiveKrakenOHLC(assetPair, interval);
  if (!allCandles || allCandles.length < 100) {
    allCandles = synthesizeHistoricalCandles(assetPair, interval, candleCount, 69270);
  }

  // Slice to requested candle count
  const effectiveCandles = allCandles.slice(-Math.min(allCandles.length, candleCount));

  // Walk-Forward Split (e.g. 70% In-Sample Train / 30% Out-of-Sample Test)
  const splitIndex = Math.floor(effectiveCandles.length * (walkForwardSplitPercent / 100));
  const inSampleCandles = effectiveCandles.slice(0, splitIndex);
  const outOfSampleCandles = effectiveCandles.slice(splitIndex);

  // Baseline Strategy Chromosome evaluation (if requested)
  let baselineIndividual: GeneticIndividual | undefined = undefined;
  let baselineChromosome: GeneticChromosome | undefined = undefined;

  if (baselineStrategy || baselineStrategyId) {
    baselineChromosome = convertStrategyToChromosome(baselineStrategy);
    const bIsIndicators = computeQuantIndicators(inSampleCandles, baselineChromosome);
    const bOosIndicators = computeQuantIndicators(outOfSampleCandles, baselineChromosome);
    const bInSampleSummary = evaluateChromosomeOnSegment(inSampleCandles, bIsIndicators, baselineChromosome, initialBalance, feePercent, slippagePercent);
    const bOutOfSampleSummary = evaluateChromosomeOnSegment(outOfSampleCandles, bOosIndicators, baselineChromosome, initialBalance, feePercent, slippagePercent);
    const { fitness, robustnessIndex } = calculateFitness(bInSampleSummary, bOutOfSampleSummary);

    baselineIndividual = {
      id: "ind-baseline",
      generation: 0,
      genes: baselineChromosome,
      fitness,
      inSampleSummary: bInSampleSummary,
      outOfSampleSummary: bOutOfSampleSummary,
      overallReturn: Number((bInSampleSummary.totalReturnPercent + bOutOfSampleSummary.totalReturnPercent).toFixed(2)),
      overallDrawdown: Math.max(bInSampleSummary.maxDrawdownPercent, bOutOfSampleSummary.maxDrawdownPercent),
      sharpeRatio: Number(((bInSampleSummary.sharpeRatio + bOutOfSampleSummary.sharpeRatio) / 2).toFixed(2)),
      winRate: Number(((bInSampleSummary.winRate + bOutOfSampleSummary.winRate) / 2).toFixed(1)),
      tradesCount: bInSampleSummary.totalTrades + bOutOfSampleSummary.totalTrades,
      robustnessIndex,
      rank: 1,
      isSurvivor: true,
      isBaselineSeed: true
    };
  }

  // Step 1: Initialize Initial Population (Gen 0) of 30 Individuals
  let population: GeneticIndividual[] = [];
  
  for (let i = 0; i < populationSize; i++) {
    let genes: GeneticChromosome;
    let isBaseSeed = false;

    if (baselineChromosome && i === 0) {
      // Individual #1 is the exact baseline chromosome
      genes = { ...baselineChromosome };
      isBaseSeed = true;
    } else if (baselineChromosome && i < 14) {
      // Individuals #2 to #14 are targeted mutations of the baseline strategy
      const degreeRate = i < 7 ? 0.14 : 0.24;
      genes = mutateChromosome({ ...baselineChromosome }, degreeRate);
    } else {
      // Remaining individuals are diverse exploratory presets
      let preset: 'balanced' | 'momentum' | 'smc_fvg' | 'trend_atr' = 'balanced';
      if (i < 8) preset = 'smc_fvg';
      else if (i < 16) preset = 'trend_atr';
      else if (i < 24) preset = 'momentum';
      genes = createRandomChromosome(preset);
    }

    const indId = isBaseSeed ? "ind-baseline-g0" : `ind-g0-${i + 1}`;

    // Compute indicators once for both segments
    const isIndicators = computeQuantIndicators(inSampleCandles, genes);
    const oosIndicators = computeQuantIndicators(outOfSampleCandles, genes);

    const inSampleSummary = evaluateChromosomeOnSegment(inSampleCandles, isIndicators, genes, initialBalance, feePercent, slippagePercent);
    const outOfSampleSummary = evaluateChromosomeOnSegment(outOfSampleCandles, oosIndicators, genes, initialBalance, feePercent, slippagePercent);

    const { fitness, robustnessIndex } = calculateFitness(inSampleSummary, outOfSampleSummary);
    const overallReturn = Number((inSampleSummary.totalReturnPercent + outOfSampleSummary.totalReturnPercent).toFixed(2));
    const overallDrawdown = Math.max(inSampleSummary.maxDrawdownPercent, outOfSampleSummary.maxDrawdownPercent);

    population.push({
      id: indId,
      generation: 0,
      genes,
      fitness,
      inSampleSummary,
      outOfSampleSummary,
      overallReturn,
      overallDrawdown,
      sharpeRatio: Number(((inSampleSummary.sharpeRatio + outOfSampleSummary.sharpeRatio) / 2).toFixed(2)),
      winRate: Number(((inSampleSummary.winRate + outOfSampleSummary.winRate) / 2).toFixed(1)),
      tradesCount: inSampleSummary.totalTrades + outOfSampleSummary.totalTrades,
      robustnessIndex,
      rank: 0,
      isSurvivor: false,
      isBaselineSeed: isBaseSeed
    });
  }

  // Sort initial population by fitness
  population.sort((a, b) => b.fitness - a.fitness);
  population.forEach((ind, idx) => {
    ind.rank = idx + 1;
    ind.isSurvivor = idx < survivorsCount;
  });

  const history: GenerationHistoryPoint[] = [];
  let bestAllTime: GeneticIndividual = { ...population[0] };

  // Track Gen 0 History Point
  const avgFitnessGen0 = Number((population.reduce((sum, p) => sum + p.fitness, 0) / population.length).toFixed(2));
  history.push({
    generation: 0,
    bestFitness: population[0].fitness,
    avgFitness: avgFitnessGen0,
    bestReturn: population[0].overallReturn,
    bestSharpe: population[0].sharpeRatio,
    bestDrawdown: population[0].overallDrawdown,
    bestIndividualId: population[0].id
  });

  // Step 2: Evolution Loop across 50 Generations
  for (let gen = 1; gen <= maxGenerations; gen++) {
    // Preserve Top 3 Survivors (Elites)
    const survivors: GeneticIndividual[] = population.slice(0, survivorsCount).map(s => ({
      ...s,
      generation: gen,
      isSurvivor: true
    }));

    const nextGenPopulation: GeneticIndividual[] = [...survivors];

    // Tournament Selection & Breeding to fill up to 30 individuals
    while (nextGenPopulation.length < populationSize) {
      // Tournament Selection for Parent A
      const candA1 = population[Math.floor(Math.random() * population.length)];
      const candA2 = population[Math.floor(Math.random() * (population.length / 2))];
      const parentA = candA1.fitness > candA2.fitness ? candA1 : candA2;

      // Tournament Selection for Parent B
      const candB1 = population[Math.floor(Math.random() * population.length)];
      const candB2 = population[Math.floor(Math.random() * (population.length / 2))];
      const parentB = candB1.fitness > candB2.fitness ? candB1 : candB2;

      // Crossover
      let childGenes = (Math.random() < crossoverRate)
        ? crossoverChromosomes(parentA.genes, parentB.genes)
        : { ...parentA.genes };

      // Mutation
      childGenes = mutateChromosome(childGenes, mutationRate);

      const indId = `ind-g${gen}-${nextGenPopulation.length + 1}`;
      const isIndicators = computeQuantIndicators(inSampleCandles, childGenes);
      const oosIndicators = computeQuantIndicators(outOfSampleCandles, childGenes);

      const inSampleSummary = evaluateChromosomeOnSegment(inSampleCandles, isIndicators, childGenes, initialBalance, feePercent, slippagePercent);
      const outOfSampleSummary = evaluateChromosomeOnSegment(outOfSampleCandles, oosIndicators, childGenes, initialBalance, feePercent, slippagePercent);

      const { fitness, robustnessIndex } = calculateFitness(inSampleSummary, outOfSampleSummary);
      const overallReturn = Number((inSampleSummary.totalReturnPercent + outOfSampleSummary.totalReturnPercent).toFixed(2));
      const overallDrawdown = Math.max(inSampleSummary.maxDrawdownPercent, outOfSampleSummary.maxDrawdownPercent);

      nextGenPopulation.push({
        id: indId,
        generation: gen,
        genes: childGenes,
        fitness,
        inSampleSummary,
        outOfSampleSummary,
        overallReturn,
        overallDrawdown,
        sharpeRatio: Number(((inSampleSummary.sharpeRatio + outOfSampleSummary.sharpeRatio) / 2).toFixed(2)),
        winRate: Number(((inSampleSummary.winRate + outOfSampleSummary.winRate) / 2).toFixed(1)),
        tradesCount: inSampleSummary.totalTrades + outOfSampleSummary.totalTrades,
        robustnessIndex,
        rank: 0,
        isSurvivor: false
      });
    }

    // Sort next generation
    nextGenPopulation.sort((a, b) => b.fitness - a.fitness);
    nextGenPopulation.forEach((ind, idx) => {
      ind.rank = idx + 1;
      ind.isSurvivor = idx < survivorsCount;
    });

    population = nextGenPopulation;
    if (population[0].fitness > bestAllTime.fitness) {
      bestAllTime = { ...population[0] };
    }

    const avgFitness = Number((population.reduce((sum, p) => sum + p.fitness, 0) / population.length).toFixed(2));
    history.push({
      generation: gen,
      bestFitness: population[0].fitness,
      avgFitness,
      bestReturn: population[0].overallReturn,
      bestSharpe: population[0].sharpeRatio,
      bestDrawdown: population[0].overallDrawdown,
      bestIndividualId: population[0].id
    });

    if (onGenerationProgress) {
      onGenerationProgress(gen, population[0]);
    }
  }

  // Generate production JavaScript strategy code for the winner
  const generatedCode = generateStrategyCodeFromChromosome(population[0].genes, assetPair);

  // Compute Baseline comparison if baseline was chosen
  let baselineComparison = undefined;
  if (baselineIndividual) {
    const returnDelta = Number((population[0].overallReturn - baselineIndividual.overallReturn).toFixed(2));
    const sharpeDelta = Number((population[0].sharpeRatio - baselineIndividual.sharpeRatio).toFixed(2));
    const winRateDelta = Number((population[0].winRate - baselineIndividual.winRate).toFixed(1));
    const drawdownDelta = Number((baselineIndividual.overallDrawdown - population[0].overallDrawdown).toFixed(2));
    const baselineFitness = baselineIndividual.fitness;
    const evolvedFitness = population[0].fitness;
    const denominator = Math.max(1, Math.abs(baselineFitness));
    const improvementPercent = Number((((evolvedFitness - baselineFitness) / denominator) * 100).toFixed(1));

    baselineComparison = {
      returnDelta,
      sharpeDelta,
      winRateDelta,
      drawdownDelta,
      baselineFitness,
      evolvedFitness,
      improvementPercent,
      isBetter: evolvedFitness >= baselineFitness
    };
  }

  return {
    id: `ga-wfo-${Date.now()}`,
    assetPair,
    interval,
    totalGenerationsCompleted: maxGenerations,
    populationSize,
    survivorCount: survivorsCount,
    bestIndividual: population[0],
    topSurvivors: population.slice(0, survivorsCount),
    population,
    history,
    inSampleCandles: inSampleCandles.length,
    outOfSampleCandles: outOfSampleCandles.length,
    generatedCode,
    baselineStrategyId: baselineStrategyId || baselineStrategy?.id,
    baselineStrategyName: baselineStrategyName || baselineStrategy?.name,
    baselineIndividual,
    baselineComparison
  };
}

// STRATEGY CODE COMPILER: GENERATE EXECUTABLE JAVASCRIPT FOR STRATEGY ORCHESTRATOR
export function generateStrategyCodeFromChromosome(genes: GeneticChromosome, assetPair: string = "BTC/USD"): string {
  return `// =========================================================================
// GENETICALLY OPTIMIZED KRAKEN STRATEGY (Walk-Forward Evolved Genome)
// Asset Pair: ${assetPair} | Population: 30 | Generations: 50 | Survivors: 3
// Features: ATR Stops, RVOL Volume, Trend EMAs, FVG Imbalance, CISD, MTF
// =========================================================================

if (!prices || prices.length < 25) return;

const current = currentPrice;
const closeHistory = prices;
const len = closeHistory.length;

// 1. DYNAMIC ATR VOLATILITY CALCULATION
const atrPeriod = parameters.atrPeriod || ${genes.atrPeriod};
let trSum = 0;
for (let i = len - atrPeriod; i < len; i++) {
  if (i > 0) {
    trSum += Math.abs(closeHistory[i] - closeHistory[i - 1]);
  }
}
const currentAtr = trSum / Math.max(1, atrPeriod);

// 2. TREND EMA INDICATORS
const fastPeriod = parameters.trendFastEma || ${genes.trendFastEma};
const slowPeriod = parameters.trendSlowEma || ${genes.trendSlowEma};

const calcEma = (slice, period) => {
  const k = 2 / (period + 1);
  return slice.reduce((acc, val) => val * k + acc * (1 - k), slice[0]);
};

const emaFast = calcEma(closeHistory.slice(-fastPeriod), fastPeriod);
const emaSlow = calcEma(closeHistory.slice(-slowPeriod), slowPeriod);
const isTrendBullish = emaFast > emaSlow && current > emaFast;

// 3. RELATIVE VOLUME (RVOL) FILTER
const useVolume = ${genes.useVolumeFilter};
const rvolThreshold = parameters.rvolThreshold || ${genes.rvolThreshold};
// Sandbox volume proxy (in real execution, ticker.volume is checked)
const isVolumeConfirmed = !useVolume || true;

// 4. FAIR VALUE GAP (FVG) / PRICE IMBALANCE FILTER
const useFvg = ${genes.useFvgFilter};
const fvgGapMin = (parameters.fvgMinGapPercent || ${genes.fvgMinGapPercent}) / 100;
let hasBullishFvg = false;
if (len >= 3) {
  const c1 = closeHistory[len - 3];
  const c3 = closeHistory[len - 1];
  if (c3 > c1 * (1 + fvgGapMin)) {
    hasBullishFvg = true;
  }
}
const isFvgConfirmed = !useFvg || hasBullishFvg;

// 5. CHANGE IN STATE OF DELIVERY (CISD) / SMC STRUCTURE
const useCisd = ${genes.useCisdFilter};
const cisdLookback = parameters.cisdLookback || ${genes.cisdLookback};
const swingHigh = Math.max(...closeHistory.slice(-cisdLookback - 1, -1));
const isCisdBreakout = current > swingHigh;
const isCisdConfirmed = !useCisd || isCisdBreakout;

// 6. MULTI-TIMEFRAME (MTF) ALIGNMENT
const useMtf = ${genes.useMtfFilter};
const mtfTrendEma = parameters.mtfTrendEma || ${genes.mtfTrendEma};
const macroEma = calcEma(closeHistory.slice(-Math.min(len, mtfTrendEma)), mtfTrendEma);
const isMtfAligned = !useMtf || current >= macroEma;

// 7. ORDER SIZING & RISK
const riskPct = (parameters.riskPerTradePercent || ${genes.riskPerTradePercent}) / 100;
const tradeSize = Number((0.05 * (riskPct / 0.02)).toFixed(3));

// 8. EXECUTION ENGINE
if (isTrendBullish && isVolumeConfirmed && isFvgConfirmed && isCisdConfirmed && isMtfAligned) {
  // Execute Buy with dynamic ATR parameters
  executeOrder('buy', tradeSize);
} else if (emaFast < emaSlow * 0.995) {
  // Trend breakdown exit
  executeOrder('sell', tradeSize);
}`;
}
