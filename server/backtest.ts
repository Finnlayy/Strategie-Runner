import { fetchLiveKrakenOHLC, KrakenCandle, resolveKrakenPair } from "./kraken";

export interface BacktestParams {
  strategyId: string;
  strategyName?: string;
  assetPair: string;
  interval: number; // Kraken interval: 1, 5, 15, 30, 60, 240, 1440
  candleCount: number; // e.g. 100, 250, 500, 720
  initialBalance: number; // e.g. 10000 USD
  feePercent: number; // e.g. 0.26%
  slippagePercent: number; // e.g. 0.05%
  hardStopEnabled: boolean;
  hardStopPercent: number;
  parameters?: Record<string, any>;
  code?: string;
}

export interface BacktestTrade {
  id: string;
  type: 'buy' | 'sell';
  entryTime: string;
  exitTime?: string;
  entryPrice: number;
  exitPrice?: number;
  amount: number;
  totalValue: number;
  fee: number;
  pnl: number;
  pnlPercent: number;
  reason: string;
  status: 'closed' | 'open';
}

export interface BacktestEquityPoint {
  timestamp: string;
  time: string;
  price: number;
  equity: number;
  benchmarkEquity: number;
  drawdown: number;
  cash: number;
  assetHoldings: number;
  action?: 'buy' | 'sell' | 'stop-loss';
  tradePrice?: number;
}

export interface BacktestSummary {
  initialBalance: number;
  finalBalance: number;
  totalReturnUSD: number;
  totalReturnPercent: number;
  benchmarkReturnPercent: number;
  alpha: number;
  maxDrawdownPercent: number;
  maxDrawdownUSD: number;
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageTradeReturn: number;
  bestTradeUSD: number;
  worstTradeUSD: number;
  avgHoldCandles: number;
  totalFeesPaid: number;
}

export interface BacktestResult {
  id: string;
  strategyId: string;
  strategyName: string;
  assetPair: string;
  interval: number;
  periodLabel: string;
  startTime: string;
  endTime: string;
  totalCandles: number;
  summary: BacktestSummary;
  equityCurve: BacktestEquityPoint[];
  trades: BacktestTrade[];
}

// Indicator Helpers
function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const k = 2 / (period + 1);
  const emaValues: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    const val = prices[i] * k + emaValues[i - 1] * (1 - k);
    emaValues.push(val);
  }
  return emaValues;
}

function calculateSMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      const slice = prices.slice(0, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / slice.length);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

function calculateRSI(prices: number[], period: number = 14): number[] {
  if (prices.length < 2) return prices.map(() => 50);
  const rsiValues: number[] = [50];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    if (i <= period) {
      avgGain = (avgGain * (i - 1) + gain) / i;
      avgLoss = (avgLoss * (i - 1) + loss) / i;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) {
      rsiValues.push(100);
    } else {
      const rs = avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      rsiValues.push(Number(rsi.toFixed(2)));
    }
  }

  return rsiValues;
}

/**
 * High-fidelity fallback candle synthesizer if Kraken API is offline or rate-limited.
 */
export function synthesizeHistoricalCandles(
  pair: string, 
  interval: number, 
  count: number = 200, 
  basePrice: number = 92500
): KrakenCandle[] {
  const candles: KrakenCandle[] = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const stepSec = interval * 60; // interval in seconds
  const startSec = nowSec - (count * stepSec);

  let current = basePrice;
  // Seed random walk with mean reversion and cyclical volatility
  for (let i = 0; i < count; i++) {
    const time = startSec + (i * stepSec);
    const progress = i / count;
    
    // Cyclical wave + random walk
    const wave = Math.sin(progress * Math.PI * 4) * (basePrice * 0.02);
    const trend = (progress - 0.5) * (basePrice * 0.04);
    const randNoise = (Math.random() - 0.495) * (basePrice * 0.015);
    
    const open = current;
    current = Math.max(basePrice * 0.4, open + wave * 0.1 + trend * 0.05 + randNoise);
    const close = current;
    
    const spread = Math.abs(close - open) + (basePrice * 0.005 * Math.random());
    const high = Math.max(open, close) + spread * Math.random();
    const low = Math.min(open, close) - spread * Math.random();
    const volume = Number((Math.random() * 50 + 10).toFixed(4));

    candles.push({
      time,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      vwap: Number(((open + high + low + close) / 4).toFixed(2)),
      volume,
      count: Math.floor(Math.random() * 200 + 30),
      timestamp: new Date(time * 1000).toISOString()
    });
  }

  return candles;
}

/**
 * Core Backtesting Simulation Engine
 */
export async function runBacktestSimulation(
  params: BacktestParams,
  liveCandles?: KrakenCandle[]
): Promise<BacktestResult> {
  const {
    strategyId,
    strategyName = "Strategy Backtest",
    assetPair,
    interval = 15,
    candleCount = 300,
    initialBalance = 10000,
    feePercent = 0.26,
    slippagePercent = 0.05,
    hardStopEnabled = true,
    hardStopPercent = 5.0,
    parameters = {},
    code = ""
  } = params;

  // 1. Obtain Candle Series
  let candles = liveCandles;
  if (!candles || candles.length < 20) {
    const fetched = await fetchLiveKrakenOHLC(assetPair, interval);
    if (fetched && fetched.length >= 20) {
      candles = fetched.slice(-candleCount);
    }
  }

  // Fallback if needed
  if (!candles || candles.length < 20) {
    let estimatedPrice = 90000;
    if (assetPair.startsWith("ETH")) estimatedPrice = 2700;
    else if (assetPair.startsWith("SOL")) estimatedPrice = 180;
    else if (assetPair.startsWith("XRP")) estimatedPrice = 2.4;
    else if (assetPair.startsWith("ADA")) estimatedPrice = 0.8;
    else if (assetPair.startsWith("DOGE")) estimatedPrice = 0.25;

    candles = synthesizeHistoricalCandles(assetPair, interval, candleCount, estimatedPrice);
  }

  const prices = candles.map(c => c.close);
  const totalCandles = candles.length;
  const initialPrice = prices[0] || 1;
  const benchmarkInitialHoldings = initialBalance / initialPrice;

  // 2. Precalculate Standard Indicators
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macdLine = ema12.map((val, idx) => val - ema26[idx]);
  const signalLine = calculateEMA(macdLine, 9);
  const rsi = calculateRSI(prices, parameters.rsiPeriod || parameters.period || 14);
  const smaFast = calculateSMA(prices, 10);
  const smaSlow = calculateSMA(prices, 30);

  // 3. Execution Simulation State
  let cash = initialBalance;
  let assetAmount = 0;
  let positionCostBasis = 0;
  let openTrade: BacktestTrade | null = null;
  let peakEquity = initialBalance;
  let maxDrawdownUSD = 0;
  let maxDrawdownPercent = 0;
  let totalFeesPaid = 0;
  let winningTradesCount = 0;
  let losingTradesCount = 0;
  let grossProfitUSD = 0;
  let grossLossUSD = 0;
  let holdCandlesTotal = 0;

  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];

  const defaultTradeSize = parameters.tradeAmount || parameters.amount || (initialBalance * 0.15 / initialPrice);

  for (let i = 0; i < totalCandles; i++) {
    const candle = candles[i];
    const currentPrice = candle.close;
    const candleTime = candle.timestamp;
    const timeLabel = new Date(candle.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });

    let action: 'buy' | 'sell' | 'stop-loss' | undefined = undefined;
    let orderPrice = currentPrice;

    // Check Hard Stop Cutoff on Open Long Position
    if (hardStopEnabled && assetAmount > 0 && openTrade) {
      const entryPrice = openTrade.entryPrice;
      const drawdownSinceEntry = ((entryPrice - candle.low) / entryPrice) * 100;
      
      if (drawdownSinceEntry >= hardStopPercent) {
        // Emergency Stop Loss Triggered!
        action = 'stop-loss';
        const stopPrice = entryPrice * (1 - (hardStopPercent / 100));
        orderPrice = Math.max(candle.low, stopPrice);
      }
    }

    // If no emergency stop, evaluate Strategy Signals
    if (!action && i >= 15) {
      const codeLower = (code || "").toLowerCase();
      const nameLower = strategyName.toLowerCase();

      let signal: 'buy' | 'sell' | null = null;

      // Evaluation based on strategy script or archetype
      if (codeLower.includes("macd") || nameLower.includes("macd") || strategyId.includes("macd")) {
        const curMacd = macdLine[i];
        const prevMacd = macdLine[i - 1];
        const curSig = signalLine[i];
        const prevSig = signalLine[i - 1];

        if (curMacd > curSig && prevMacd <= prevSig) {
          signal = 'buy';
        } else if (curMacd < curSig && prevMacd >= prevSig) {
          signal = 'sell';
        }
      } else if (codeLower.includes("rsi") || nameLower.includes("rsi") || strategyId.includes("rsi")) {
        const curRsi = rsi[i];
        const prevRsi = rsi[i - 1];
        const oversold = Number(parameters.oversold) || 30;
        const overbought = Number(parameters.overbought) || 70;

        if (curRsi < oversold || (prevRsi < oversold && curRsi >= oversold)) {
          signal = 'buy';
        } else if (curRsi > overbought || (prevRsi > overbought && curRsi <= overbought)) {
          signal = 'sell';
        }
      } else if (codeLower.includes("grid") || nameLower.includes("grid") || strategyId.includes("grid")) {
        const levels = Number(parameters.gridLevels) || 4;
        const spacing = (Number(parameters.gridSpacingPercent) || 1.5) / 100;
        const baseline = smaFast[i] || currentPrice;
        
        if (currentPrice < baseline * (1 - spacing)) {
          signal = 'buy';
        } else if (currentPrice > baseline * (1 + spacing)) {
          signal = 'sell';
        }
      } else if (codeLower.includes("breakout") || nameLower.includes("breakout")) {
        const threshold = (Number(parameters.threshold) || 1.0) / 100;
        if (currentPrice > smaFast[i] * (1 + threshold) && smaFast[i] > smaSlow[i]) {
          signal = 'buy';
        } else if (currentPrice < smaFast[i] * (1 - threshold)) {
          signal = 'sell';
        }
      } else {
        // Generic Adaptive Momentum & Trend Cross
        const f = smaFast[i];
        const s = smaSlow[i];
        const pf = smaFast[i - 1];
        const ps = smaSlow[i - 1];

        if (f > s && pf <= ps) {
          signal = 'buy';
        } else if (f < s && pf >= ps) {
          signal = 'sell';
        }
      }

      if (signal === 'buy' && cash > 50) {
        action = 'buy';
      } else if (signal === 'sell' && assetAmount > 0) {
        action = 'sell';
      }
    }

    // Execute Orders with Slippage & Fees
    if (action === 'buy') {
      const executionPrice = orderPrice * (1 + (slippagePercent / 100));
      const targetAllocation = Math.min(cash * 0.35, cash - 10); // Allocate up to 35% of free cash
      const buyAmount = targetAllocation / executionPrice;

      if (buyAmount > 0.0001 && targetAllocation >= 20) {
        const tradeCost = targetAllocation;
        const fee = tradeCost * (feePercent / 100);
        totalFeesPaid += fee;
        cash -= (tradeCost + fee);
        assetAmount += buyAmount;
        positionCostBasis += tradeCost;

        openTrade = {
          id: `bt-trade-${trades.length + 1}`,
          type: 'buy',
          entryTime: candleTime,
          entryPrice: Number(executionPrice.toFixed(2)),
          amount: Number(buyAmount.toFixed(6)),
          totalValue: Number(tradeCost.toFixed(2)),
          fee: Number(fee.toFixed(2)),
          pnl: 0,
          pnlPercent: 0,
          reason: 'Strategy Long Entry Signal',
          status: 'open'
        };
      }
    } else if (action === 'sell' || action === 'stop-loss') {
      if (assetAmount > 0) {
        const sellAmount = assetAmount;
        const executionPrice = orderPrice * (1 - (slippagePercent / 100));
        const grossReturn = sellAmount * executionPrice;
        const fee = grossReturn * (feePercent / 100);
        const netReturn = grossReturn - fee;
        totalFeesPaid += fee;

        const tradePnL = Number((netReturn - positionCostBasis).toFixed(2));
        const tradePnLPercent = positionCostBasis > 0 ? Number(((tradePnL / positionCostBasis) * 100).toFixed(2)) : 0;

        cash += netReturn;
        assetAmount = 0;
        positionCostBasis = 0;

        if (tradePnL >= 0) {
          winningTradesCount += 1;
          grossProfitUSD += tradePnL;
        } else {
          losingTradesCount += 1;
          grossLossUSD += Math.abs(tradePnL);
        }

        const closedTrade: BacktestTrade = {
          id: openTrade?.id || `bt-trade-${trades.length + 1}`,
          type: 'sell',
          entryTime: openTrade?.entryTime || candleTime,
          exitTime: candleTime,
          entryPrice: openTrade?.entryPrice || Number(executionPrice.toFixed(2)),
          exitPrice: Number(executionPrice.toFixed(2)),
          amount: Number(sellAmount.toFixed(6)),
          totalValue: Number(grossReturn.toFixed(2)),
          fee: Number((fee + (openTrade?.fee || 0)).toFixed(2)),
          pnl: tradePnL,
          pnlPercent: tradePnLPercent,
          reason: action === 'stop-loss' ? `Emergency Hard Stop Triggered (-${hardStopPercent}%)` : 'Strategy Take-Profit / Rebalance Signal',
          status: 'closed'
        };

        trades.unshift(closedTrade);
        openTrade = null;
      }
    }

    // Compute Mark-to-Market Portfolio Equity
    const currentHoldingsValue = assetAmount * currentPrice;
    const currentTotalEquity = Number((cash + currentHoldingsValue).toFixed(2));
    const benchmarkEquity = Number((benchmarkInitialHoldings * currentPrice).toFixed(2));

    if (currentTotalEquity > peakEquity) {
      peakEquity = currentTotalEquity;
    }

    const currentDrawdownUSD = Math.max(0, peakEquity - currentTotalEquity);
    const currentDrawdownPercent = peakEquity > 0 ? (currentDrawdownUSD / peakEquity) * 100 : 0;

    if (currentDrawdownPercent > maxDrawdownPercent) {
      maxDrawdownPercent = Number(currentDrawdownPercent.toFixed(2));
      maxDrawdownUSD = Number(currentDrawdownUSD.toFixed(2));
    }

    equityCurve.push({
      timestamp: candleTime,
      time: timeLabel,
      price: currentPrice,
      equity: currentTotalEquity,
      benchmarkEquity,
      drawdown: Number(currentDrawdownPercent.toFixed(2)),
      cash: Number(cash.toFixed(2)),
      assetHoldings: Number(assetAmount.toFixed(6)),
      action,
      tradePrice: action ? Number(orderPrice.toFixed(2)) : undefined
    });
  }

  // 4. Summarize Quantitative Performance Statistics
  const finalEquity = equityCurve[equityCurve.length - 1]?.equity || initialBalance;
  const finalBenchmark = equityCurve[equityCurve.length - 1]?.benchmarkEquity || initialBalance;

  const totalReturnUSD = Number((finalEquity - initialBalance).toFixed(2));
  const totalReturnPercent = Number((((finalEquity - initialBalance) / initialBalance) * 100).toFixed(2));
  const benchmarkReturnPercent = Number((((finalBenchmark - initialBalance) / initialBalance) * 100).toFixed(2));
  const alpha = Number((totalReturnPercent - benchmarkReturnPercent).toFixed(2));

  const closedTrades = trades.filter(t => t.status === 'closed');
  const totalTrades = closedTrades.length;
  winningTradesCount = closedTrades.filter(t => t.pnl > 0).length;
  losingTradesCount = closedTrades.filter(t => t.pnl <= 0).length;
  const winRate = totalTrades > 0 ? Number(((winningTradesCount / totalTrades) * 100).toFixed(1)) : 0;
  const profitFactor = grossLossUSD > 0 ? Number((grossProfitUSD / grossLossUSD).toFixed(2)) : (grossProfitUSD > 0 ? 99.9 : 1.0);

  // Periodic Returns for Sharpe Calculation
  const returns: number[] = [];
  for (let k = 1; k < equityCurve.length; k++) {
    const prev = equityCurve[k - 1].equity;
    const cur = equityCurve[k].equity;
    returns.push(prev > 0 ? (cur - prev) / prev : 0);
  }

  const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / (returns.length - 1) : 0.0001;
  const stdDev = Math.sqrt(variance);

  // Downside variance for Sortino
  const downsideReturns = returns.filter(r => r < 0);
  const downsideVariance = downsideReturns.length > 1 ? downsideReturns.reduce((a, b) => a + Math.pow(b, 2), 0) / downsideReturns.length : 0.0001;
  const downsideStdDev = Math.sqrt(downsideVariance);

  // Annualize factor based on interval (minutes)
  const periodsPerYear = (365 * 24 * 60) / Math.max(1, interval);
  const annualFactor = Math.sqrt(Math.min(periodsPerYear, 50000));

  const sharpeRatio = stdDev > 0 ? Number(((meanReturn / stdDev) * annualFactor).toFixed(2)) : 0;
  const sortinoRatio = downsideStdDev > 0 ? Number(((meanReturn / downsideStdDev) * annualFactor).toFixed(2)) : 0;

  const tradePnLs = trades.map(t => t.pnl);
  const bestTradeUSD = tradePnLs.length > 0 ? Math.max(...tradePnLs) : 0;
  const worstTradeUSD = tradePnLs.length > 0 ? Math.min(...tradePnLs) : 0;
  const averageTradeReturn = tradePnLs.length > 0 ? Number((tradePnLs.reduce((a, b) => a + b, 0) / tradePnLs.length).toFixed(2)) : 0;

  const summary: BacktestSummary = {
    initialBalance,
    finalBalance: finalEquity,
    totalReturnUSD,
    totalReturnPercent,
    benchmarkReturnPercent,
    alpha,
    maxDrawdownPercent,
    maxDrawdownUSD,
    sharpeRatio: Math.min(Math.max(sharpeRatio, -10), 15),
    sortinoRatio: Math.min(Math.max(sortinoRatio, -10), 20),
    profitFactor,
    winRate,
    totalTrades,
    winningTrades: winningTradesCount,
    losingTrades: losingTradesCount,
    averageTradeReturn,
    bestTradeUSD,
    worstTradeUSD,
    avgHoldCandles: Math.floor(totalCandles / Math.max(1, totalTrades)),
    totalFeesPaid: Number(totalFeesPaid.toFixed(2))
  };

  const periodLabel = `${totalCandles} candles (${interval}m interval)`;
  const startTime = candles[0]?.timestamp || new Date().toISOString();
  const endTime = candles[candles.length - 1]?.timestamp || new Date().toISOString();

  return {
    id: "bt-" + Math.random().toString(36).substr(2, 9),
    strategyId,
    strategyName,
    assetPair,
    interval,
    periodLabel,
    startTime,
    endTime,
    totalCandles,
    summary,
    equityCurve,
    trades
  };
}
