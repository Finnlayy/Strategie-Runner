import React, { useState, useEffect } from 'react';
import { 
  TradingStrategy, 
  BacktestResult, 
  BacktestTrade, 
  BacktestAIAnalysis,
  KrakenSymbolInfo 
} from '../types';
import { 
  Play, 
  RotateCcw, 
  Sparkles, 
  TrendingUp, 
  TrendingDown, 
  ShieldAlert, 
  DollarSign, 
  Percent, 
  BarChart3, 
  Activity, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  Layers, 
  Sliders, 
  Code2, 
  RefreshCw, 
  Zap, 
  Check, 
  ArrowUpRight, 
  ArrowDownRight,
  HelpCircle,
  Clock,
  Scale,
  Target
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Legend 
} from 'recharts';

interface BacktestingPanelProps {
  strategies: TradingStrategy[];
  selectedStrategy: TradingStrategy | null;
  onSelectStrategy: (strat: TradingStrategy) => void;
  onOpenOrchestrator: (strat: TradingStrategy) => void;
  onUpdateStrategyParams?: (stratId: string, params: Record<string, any>) => Promise<void>;
  symbols?: KrakenSymbolInfo[];
}

export const BacktestingPanel: React.FC<BacktestingPanelProps> = ({
  strategies,
  selectedStrategy,
  onSelectStrategy,
  onOpenOrchestrator,
  onUpdateStrategyParams,
  symbols = []
}) => {
  // Strategy Selection
  const [activeStratId, setActiveStratId] = useState<string>(selectedStrategy?.id || strategies[0]?.id || '');
  
  // Configuration State
  const [assetPair, setAssetPair] = useState<string>(selectedStrategy?.assetPair || 'BTC/USD');
  const [interval, setInterval] = useState<number>(15); // Kraken interval in minutes
  const [candleCount, setCandleCount] = useState<number>(300);
  const [initialBalance, setInitialBalance] = useState<number>(10000);
  const [feePercent, setFeePercent] = useState<number>(0.26); // Kraken default taker fee
  const [slippagePercent, setSlippagePercent] = useState<number>(0.05);
  const [hardStopEnabled, setHardStopEnabled] = useState<boolean>(true);
  const [hardStopPercent, setHardStopPercent] = useState<number>(5.0);

  // Execution & Results State
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [activeChartTab, setActiveChartTab] = useState<'equity' | 'drawdown' | 'price'>('equity');
  const [tradeFilter, setTradeFilter] = useState<'all' | 'wins' | 'losses' | 'stops'>('all');
  
  // AI Quant Analysis State
  const [isAnalyzingAI, setIsAnalyzingAI] = useState<boolean>(false);
  const [aiReport, setAiReport] = useState<BacktestAIAnalysis | null>(null);
  const [appliedParamsNotification, setAppliedParamsNotification] = useState<string | null>(null);
  const [isApplyingParams, setIsApplyingParams] = useState<boolean>(false);
  const [isParamsApplied, setIsParamsApplied] = useState<boolean>(false);

  // Synchronize when selected strategy changes externally
  useEffect(() => {
    if (selectedStrategy) {
      setActiveStratId(selectedStrategy.id);
      if (selectedStrategy.assetPair) setAssetPair(selectedStrategy.assetPair);
      if (selectedStrategy.hardStopPercent) setHardStopPercent(selectedStrategy.hardStopPercent);
      if (selectedStrategy.hardStopEnabled !== undefined) setHardStopEnabled(selectedStrategy.hardStopEnabled);
    }
  }, [selectedStrategy]);

  // Current active strategy object
  const currentStrategy = strategies.find(s => s.id === activeStratId) || selectedStrategy || strategies[0];

  // Run Backtest Simulation
  const handleRunBacktest = async () => {
    if (!currentStrategy) return;
    setIsLoading(true);
    setAiReport(null);

    try {
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: currentStrategy.id,
          strategyName: currentStrategy.name,
          assetPair,
          interval,
          candleCount,
          initialBalance,
          feePercent,
          slippagePercent,
          hardStopEnabled,
          hardStopPercent,
          parameters: currentStrategy.parameters || {},
          code: currentStrategy.code || ''
        })
      });

      if (!res.ok) {
        throw new Error(`Backtest error: ${res.statusText}`);
      }

      const data: BacktestResult = await res.json();
      setBacktestResult(data);
    } catch (err: any) {
      console.error("Backtest run failure:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Run AI Quant Report
  const handleRunAIAnalysis = async () => {
    if (!backtestResult) return;
    setIsAnalyzingAI(true);

    try {
      const res = await fetch('/api/backtest/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: backtestResult })
      });

      if (!res.ok) throw new Error("AI analysis request failed");
      const data: BacktestAIAnalysis = await res.json();
      setAiReport(data);
    } catch (err: any) {
      console.error("AI Analysis error:", err);
    } finally {
      setIsAnalyzingAI(false);
    }
  };

  // Apply AI parameters to current strategy
  const handleApplyAITweaks = async () => {
    if (!aiReport?.suggestedParameters || !currentStrategy || !onUpdateStrategyParams || isApplyingParams) return;
    setIsApplyingParams(true);
    try {
      await onUpdateStrategyParams(currentStrategy.id, {
        ...currentStrategy.parameters,
        ...aiReport.suggestedParameters
      });
      setIsParamsApplied(true);
      setAppliedParamsNotification("Applied AI parameter calibrations to strategy successfully!");
      setTimeout(() => setAppliedParamsNotification(null), 4000);
      setTimeout(() => setIsParamsApplied(false), 3000);
    } catch (err) {
      console.error("Failed to apply AI parameters:", err);
    } finally {
      setIsApplyingParams(false);
    }
  };

  // Export Backtest Results as JSON
  const handleExportJSON = () => {
    if (!backtestResult) return;
    const blob = new Blob([JSON.stringify(backtestResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest_${backtestResult.strategyName.replace(/\s+/g, '_')}_${assetPair.replace('/', '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export Blotter as CSV
  const handleExportCSV = () => {
    if (!backtestResult || backtestResult.trades.length === 0) return;
    const headers = ['Trade ID', 'Type', 'Entry Time', 'Exit Time', 'Entry Price', 'Exit Price', 'Amount', 'Total USD', 'Fee Paid', 'Net PnL', 'PnL %', 'Reason'];
    const rows = backtestResult.trades.map(t => [
      t.id,
      t.type,
      t.entryTime,
      t.exitTime || '',
      t.entryPrice,
      t.exitPrice || '',
      t.amount,
      t.totalValue,
      t.fee,
      t.pnl,
      t.pnlPercent,
      `"${t.reason}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trades_${backtestResult.strategyName.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter Trades (Only count trades as wins/losses if closed)
  const filteredTrades = backtestResult?.trades.filter(t => {
    if (tradeFilter === 'wins') return t.status === 'closed' && t.pnl > 0;
    if (tradeFilter === 'losses') return t.status === 'closed' && t.pnl < 0;
    if (tradeFilter === 'stops') return t.status === 'closed' && t.reason.toLowerCase().includes('stop');
    return true;
  }) || [];

  // Popular Pairs List
  const popularPairs = [
    'BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD', 
    'DOGE/USD', 'LINK/USD', 'AVAX/USD', 'SUI/USD', 'DOT/USD'
  ];

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-10">
      {/* 1. TOP HEADER & STRATEGY SELECTION BAR */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800 pb-4 mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400 shadow-inner">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base sm:text-lg font-mono font-bold text-white tracking-tight">
                  Quantitative Strategy Backtesting Engine
                </h2>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 bg-emerald-950/60 text-emerald-400 border border-emerald-800/50 rounded">
                  Kraken Historical OHLC
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5 font-mono">
                Simulate algorithmic trade execution with real candlestick order books, slippage, maker/taker fees, and emergency Hard Stops.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {currentStrategy && (
              <button
                onClick={() => onOpenOrchestrator(currentStrategy)}
                className="px-3 py-1.5 rounded border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-750 text-zinc-200 text-xs font-mono flex items-center space-x-1.5 transition-all"
                title="Open code in Strategy Orchestrator"
              >
                <Code2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Edit Strategy Code</span>
              </button>
            )}

            <button
              id="run-backtest-btn"
              onClick={handleRunBacktest}
              disabled={isLoading}
              className={`px-4 py-2 rounded font-mono font-bold text-xs flex items-center space-x-2 transition-all shadow-md ${
                isLoading
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 hover:text-black active:scale-[0.98]'
              }`}
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />
                  <span>Simulating Candles...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-zinc-950" />
                  <span>RUN BACKTEST</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* CONTROLS GRID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3 text-xs font-mono">
          {/* 1. Strategy Selector */}
          <div className="space-y-1">
            <label className="text-zinc-400 block text-[11px] font-semibold uppercase tracking-wider">
              Strategy Algorithm
            </label>
            <select
              value={activeStratId}
              onChange={(e) => {
                setActiveStratId(e.target.value);
                const match = strategies.find(s => s.id === e.target.value);
                if (match) onSelectStrategy(match);
              }}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500 transition-colors"
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.assetPair})
                </option>
              ))}
            </select>
          </div>

          {/* 2. Asset Pair */}
          <div className="space-y-1">
            <label className="text-zinc-400 block text-[11px] font-semibold uppercase tracking-wider">
              Asset Pair
            </label>
            <select
              value={assetPair}
              onChange={(e) => setAssetPair(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500 transition-colors"
            >
              {popularPairs.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* 3. Timeframe Interval */}
          <div className="space-y-1">
            <label className="text-zinc-400 block text-[11px] font-semibold uppercase tracking-wider">
              Candle Interval
            </label>
            <select
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500 transition-colors"
            >
              <option value={1}>1 Minute (Ultra Fast)</option>
              <option value={5}>5 Minutes (Scalp)</option>
              <option value={15}>15 Minutes (Standard)</option>
              <option value={30}>30 Minutes</option>
              <option value={60}>1 Hour (Swing)</option>
              <option value={240}>4 Hours (Macro)</option>
              <option value={1440}>1 Day (Daily)</option>
            </select>
          </div>

          {/* 4. Candle Sample Count */}
          <div className="space-y-1">
            <label className="text-zinc-400 block text-[11px] font-semibold uppercase tracking-wider">
              Sample Period
            </label>
            <select
              value={candleCount}
              onChange={(e) => setCandleCount(Number(e.target.value))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500 transition-colors"
            >
              <option value={100}>100 Candles (Fast Sprint)</option>
              <option value={200}>200 Candles (~2-3 days)</option>
              <option value={300}>300 Candles (~3-5 days)</option>
              <option value={500}>500 Candles (~1-2 weeks)</option>
              <option value={720}>720 Candles (Kraken Max API)</option>
            </select>
          </div>

          {/* 5. Initial Balance */}
          <div className="space-y-1">
            <label className="text-zinc-400 block text-[11px] font-semibold uppercase tracking-wider">
              Initial Capital (USD)
            </label>
            <div className="relative">
              <span className="absolute left-2.5 top-1.5 text-zinc-500">$</span>
              <input
                type="number"
                value={initialBalance}
                onChange={(e) => setInitialBalance(Math.max(100, Number(e.target.value)))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded pl-6 pr-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>

          {/* 6. Hard Stop Loss Cutoff */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-zinc-400 block text-[11px] font-semibold uppercase tracking-wider">
                Hard Stop Risk
              </label>
              <button
                type="button"
                onClick={() => setHardStopEnabled(!hardStopEnabled)}
                className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                  hardStopEnabled ? 'text-rose-400 bg-rose-950/60 border border-rose-800/40' : 'text-zinc-500 bg-zinc-800'
                }`}
              >
                {hardStopEnabled ? 'ACTIVE' : 'OFF'}
              </button>
            </div>
            <div className="flex items-center space-x-1.5">
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="50"
                disabled={!hardStopEnabled}
                value={hardStopPercent}
                onChange={(e) => setHardStopPercent(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500 disabled:opacity-40 transition-colors"
              />
              <span className="text-zinc-400 text-xs">%</span>
            </div>
          </div>
        </div>

        {/* Micro Config Extras (Fees, Slippage & Active Params) */}
        <div className="mt-3 pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-zinc-400">
          <div className="flex items-center space-x-4">
            <span className="flex items-center space-x-1">
              <Scale className="w-3.5 h-3.5 text-zinc-500" />
              <span>Kraken Fee: <strong className="text-zinc-200">{feePercent}%</strong></span>
            </span>
            <span>•</span>
            <span className="flex items-center space-x-1">
              <Sliders className="w-3.5 h-3.5 text-zinc-500" />
              <span>Slippage: <strong className="text-zinc-200">{slippagePercent}%</strong></span>
            </span>
            <span>•</span>
            <span className="text-zinc-500">
              Params: {JSON.stringify(currentStrategy?.parameters || {})}
            </span>
          </div>

          <div className="text-zinc-500 text-[10px]">
            Targeting Kraken execution environment with accurate tick-level simulated fills
          </div>
        </div>
      </div>

      {/* Notification Toast for AI applied params */}
      {appliedParamsNotification && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded-lg text-xs font-mono flex items-center space-x-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{appliedParamsNotification}</span>
        </div>
      )}

      {/* 2. RESULTS BODY */}
      {!backtestResult ? (
        <div className="bg-zinc-900/60 border border-zinc-800/80 border-dashed rounded-lg p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-zinc-800/80 flex items-center justify-center mx-auto text-zinc-500">
            <Activity className="w-6 h-6 text-zinc-400" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-sm font-mono font-bold text-zinc-200">No Active Backtest Simulation</h3>
            <p className="text-xs text-zinc-400 font-mono leading-relaxed">
              Select your strategy parameters above and click <span className="text-emerald-400 font-semibold">RUN BACKTEST</span> to compute Sharpe ratios, maximum drawdowns, equity trajectories, and AI diagnostics.
            </p>
          </div>
          <button
            onClick={handleRunBacktest}
            disabled={isLoading}
            className="inline-flex items-center space-x-2 px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-mono font-bold text-xs transition-all shadow"
          >
            <Play className="w-3.5 h-3.5 fill-zinc-950" />
            <span>Simulate Default Strategy (BTC/USD 15m)</span>
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* A. PERFORMANCE METRICS BENTO CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {/* 1. Net Strategy Return */}
            <div className="bg-zinc-900 border border-zinc-800 p-3.5 rounded-lg">
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">
                Net Profit / Return
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <div className={`text-xl font-mono font-bold ${
                  backtestResult.summary.totalReturnUSD >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {backtestResult.summary.totalReturnUSD >= 0 ? '+' : ''}${backtestResult.summary.totalReturnUSD.toLocaleString()}
                </div>
                <span className={`text-xs font-mono font-bold px-1.5 py-0.2 rounded ${
                  backtestResult.summary.totalReturnPercent >= 0 ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
                }`}>
                  {backtestResult.summary.totalReturnPercent >= 0 ? '+' : ''}{backtestResult.summary.totalReturnPercent}%
                </span>
              </div>
              <div className="text-[10px] font-mono text-zinc-500 mt-1 flex justify-between">
                <span>Final: ${backtestResult.summary.finalBalance.toLocaleString()}</span>
                <span className={backtestResult.summary.alpha >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  Alpha: {backtestResult.summary.alpha >= 0 ? '+' : ''}{backtestResult.summary.alpha}%
                </span>
              </div>
            </div>

            {/* 2. Benchmark Comparison */}
            <div className="bg-zinc-900 border border-zinc-800 p-3.5 rounded-lg">
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">
                Buy &amp; Hold Benchmark
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <div className={`text-xl font-mono font-bold ${
                  backtestResult.summary.benchmarkReturnPercent >= 0 ? 'text-zinc-200' : 'text-zinc-400'
                }`}>
                  {backtestResult.summary.benchmarkReturnPercent >= 0 ? '+' : ''}{backtestResult.summary.benchmarkReturnPercent}%
                </div>
                <span className="text-[10px] font-mono text-zinc-400 bg-zinc-800 px-1.5 py-0.2 rounded">
                  Passive
                </span>
              </div>
              <div className="text-[10px] font-mono text-zinc-500 mt-1">
                Asset: {backtestResult.assetPair}
              </div>
            </div>

            {/* 3. Max Drawdown */}
            <div className="bg-zinc-900 border border-zinc-800 p-3.5 rounded-lg">
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">
                Max Drawdown
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-xl font-mono font-bold text-rose-400">
                  -{backtestResult.summary.maxDrawdownPercent}%
                </div>
                <span className="text-[10px] font-mono text-rose-400/80 bg-rose-950/60 border border-rose-900/40 px-1.5 py-0.2 rounded">
                  -${backtestResult.summary.maxDrawdownUSD}
                </span>
              </div>
              <div className="text-[10px] font-mono text-zinc-500 mt-1">
                Risk Bound: {backtestResult.summary.maxDrawdownPercent < 8 ? 'Low Risk' : backtestResult.summary.maxDrawdownPercent < 15 ? 'Moderate' : 'High Drawdown'}
              </div>
            </div>

            {/* 4. Win Rate & Trades */}
            <div className="bg-zinc-900 border border-zinc-800 p-3.5 rounded-lg">
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">
                Win Rate
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-xl font-mono font-bold text-white">
                  {backtestResult.summary.winRate}%
                </div>
                <span className="text-[10px] font-mono text-zinc-400">
                  {backtestResult.summary.winningTrades}W / {backtestResult.summary.losingTrades}L
                </span>
              </div>
              <div className="text-[10px] font-mono text-zinc-500 mt-1">
                Total Trades: {backtestResult.summary.totalTrades}
              </div>
            </div>

            {/* 5. Sharpe & Sortino */}
            <div className="bg-zinc-900 border border-zinc-800 p-3.5 rounded-lg">
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">
                Sharpe Ratio
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <div className={`text-xl font-mono font-bold ${
                  backtestResult.summary.sharpeRatio > 1.5 ? 'text-emerald-400' : backtestResult.summary.sharpeRatio > 0.8 ? 'text-zinc-200' : 'text-amber-400'
                }`}>
                  {backtestResult.summary.sharpeRatio}
                </div>
                <span className="text-[10px] font-mono text-zinc-400">
                  Sortino: {backtestResult.summary.sortinoRatio}
                </span>
              </div>
              <div className="text-[10px] font-mono text-zinc-500 mt-1">
                Profit Factor: {backtestResult.summary.profitFactor}x
              </div>
            </div>

            {/* 6. Trade Payoff Profile */}
            <div className="bg-zinc-900 border border-zinc-800 p-3.5 rounded-lg">
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">
                Trade Metrics
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-sm font-mono font-bold text-emerald-400 truncate">
                  +${backtestResult.summary.bestTradeUSD}
                </div>
                <span className="text-xs font-mono font-bold text-rose-400">
                  ${backtestResult.summary.worstTradeUSD}
                </span>
              </div>
              <div className="text-[10px] font-mono text-zinc-500 mt-1 flex justify-between">
                <span>Avg: ${backtestResult.summary.averageTradeReturn}</span>
                <span>Fees: ${backtestResult.summary.totalFeesPaid}</span>
              </div>
            </div>
          </div>

          {/* B. MAIN INTERACTIVE VISUALIZER & CHARTS */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3 mb-4">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setActiveChartTab('equity')}
                  className={`px-3 py-1 rounded text-xs font-mono font-semibold transition-all ${
                    activeChartTab === 'equity'
                      ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 shadow-sm'
                      : 'text-zinc-400 hover:text-white bg-zinc-950/40'
                  }`}
                >
                  Portfolio Equity vs Benchmark
                </button>
                <button
                  onClick={() => setActiveChartTab('drawdown')}
                  className={`px-3 py-1 rounded text-xs font-mono font-semibold transition-all ${
                    activeChartTab === 'drawdown'
                      ? 'bg-rose-950/80 text-rose-400 border border-rose-800/60 shadow-sm'
                      : 'text-zinc-400 hover:text-white bg-zinc-950/40'
                  }`}
                >
                  Underwater Drawdown (%)
                </button>
                <button
                  onClick={() => setActiveChartTab('price')}
                  className={`px-3 py-1 rounded text-xs font-mono font-semibold transition-all ${
                    activeChartTab === 'price'
                      ? 'bg-zinc-800 text-zinc-200 border border-zinc-700 shadow-sm'
                      : 'text-zinc-400 hover:text-white bg-zinc-950/40'
                  }`}
                >
                  Price Action &amp; Fills
                </button>
              </div>

              <div className="text-[11px] font-mono text-zinc-400 flex items-center space-x-3">
                <span className="flex items-center space-x-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                  <span>Strategy Equity</span>
                </span>
                <span className="flex items-center space-x-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-500 inline-block" />
                  <span>Buy &amp; Hold Benchmark</span>
                </span>
              </div>
            </div>

            {/* CHART RENDERER */}
            <div className="h-72 w-full">
              {activeChartTab === 'equity' && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={backtestResult.equityCurve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="benchGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#71717a" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#71717a" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis 
                      dataKey="time" 
                      stroke="#71717a" 
                      fontSize={10} 
                      tickLine={false} 
                      minTickGap={30}
                    />
                    <YAxis 
                      stroke="#71717a" 
                      fontSize={10} 
                      tickLine={false} 
                      domain={['dataMin - 100', 'dataMax + 100']}
                      tickFormatter={(v) => `$${v.toLocaleString()}`}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace' }}
                      formatter={(val: any) => [`$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, '']}
                    />
                    <Area type="monotone" dataKey="equity" name="Strategy Equity" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#equityGrad)" />
                    <Area type="monotone" dataKey="benchmarkEquity" name="Buy & Hold" stroke="#71717a" strokeWidth={1.5} strokeDasharray="4 4" fillOpacity={1} fill="url(#benchGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}

              {activeChartTab === 'drawdown' && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={backtestResult.equityCurve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="drawdownGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="time" stroke="#71717a" fontSize={10} tickLine={false} minTickGap={30} />
                    <YAxis 
                      stroke="#71717a" 
                      fontSize={10} 
                      tickLine={false} 
                      domain={[-backtestResult.summary.maxDrawdownPercent * 1.2, 0]} 
                      tickFormatter={(v) => `${v}%`} 
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace' }}
                      formatter={(val: any) => [`-${Number(val)}%`, 'Drawdown']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey={(d) => -d.drawdown} 
                      name="Underwater Drawdown" 
                      stroke="#f43f5e" 
                      strokeWidth={2} 
                      fillOpacity={1} 
                      fill="url(#drawdownGrad)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}

              {activeChartTab === 'price' && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={backtestResult.equityCurve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="time" stroke="#71717a" fontSize={10} tickLine={false} minTickGap={30} />
                    <YAxis 
                      stroke="#71717a" 
                      fontSize={10} 
                      tickLine={false} 
                      domain={['auto', 'auto']}
                      tickFormatter={(v) => `$${v.toLocaleString()}`}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace' }}
                      formatter={(val: any) => [`$${Number(val).toLocaleString()}`, 'Price']}
                    />
                    <Line type="monotone" dataKey="price" name={`${backtestResult.assetPair} Price`} stroke="#38bdf8" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* C. QUANT AI COPILOT AUDIT SECTION */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                  Quantitative AI Diagnostics &amp; Audit Report
                </h3>
              </div>

              {!aiReport ? (
                <button
                  onClick={handleRunAIAnalysis}
                  disabled={isAnalyzingAI}
                  className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-zinc-950 font-mono font-bold text-xs rounded flex items-center space-x-1.5 transition-all shadow-sm"
                >
                  {isAnalyzingAI ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Generating Quant Audit...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 fill-zinc-950" />
                      <span>Audit with Gemini Quant Copilot</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="flex items-center space-x-2">
                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                    aiReport.score >= 80 ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800' :
                    aiReport.score >= 60 ? 'bg-amber-950/80 text-amber-400 border-amber-800' :
                    'bg-rose-950/80 text-rose-400 border-rose-800'
                  }`}>
                    Quant Score: {aiReport.score}/100 ({aiReport.verdict})
                  </span>
                  <button
                    onClick={handleRunAIAnalysis}
                    disabled={isAnalyzingAI}
                    className="p-1 rounded border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                    title="Re-audit"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzingAI ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              )}
            </div>

            {aiReport ? (
              <div className="space-y-4 text-xs font-mono">
                {/* Executive Summary */}
                <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-semibold mb-1">
                    Executive Quant Review
                  </span>
                  <p className="text-zinc-200 leading-relaxed">
                    {aiReport.executiveSummary}
                  </p>
                </div>

                {/* Market Regimes Breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded">
                    <span className="text-[10px] text-emerald-400 uppercase tracking-wider block font-semibold mb-1 flex items-center space-x-1">
                      <TrendingUp className="w-3 h-3" />
                      <span>Bullish Up-Trend Regime</span>
                    </span>
                    <p className="text-zinc-400 text-[11px] leading-relaxed">
                      {aiReport.regimePerformance.trendingUp}
                    </p>
                  </div>

                  <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded">
                    <span className="text-[10px] text-rose-400 uppercase tracking-wider block font-semibold mb-1 flex items-center space-x-1">
                      <TrendingDown className="w-3 h-3" />
                      <span>Bearish Down-Trend Regime</span>
                    </span>
                    <p className="text-zinc-400 text-[11px] leading-relaxed">
                      {aiReport.regimePerformance.trendingDown}
                    </p>
                  </div>

                  <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded">
                    <span className="text-[10px] text-amber-400 uppercase tracking-wider block font-semibold mb-1 flex items-center space-x-1">
                      <Activity className="w-3 h-3" />
                      <span>Choppy Consolidation</span>
                    </span>
                    <p className="text-zinc-400 text-[11px] leading-relaxed">
                      {aiReport.regimePerformance.choppyRange}
                    </p>
                  </div>
                </div>

                {/* Drawdown Diagnosis & Tweaks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-semibold mb-1">
                      Drawdown &amp; Tail Risk Diagnosis
                    </span>
                    <p className="text-zinc-300 text-[11px] leading-relaxed">
                      {aiReport.drawdownDiagnosis}
                    </p>
                  </div>

                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-emerald-400 uppercase tracking-wider block font-semibold">
                        Actionable Quant Recommendations
                      </span>
                      {aiReport.suggestedParameters && (
                        <button
                          id="btn-apply-ai-params"
                          onClick={handleApplyAITweaks}
                          disabled={isApplyingParams}
                          className={`text-[10px] px-2.5 py-1 rounded font-mono font-medium flex items-center space-x-1.5 transition-all shadow-sm ${
                            isParamsApplied
                              ? 'bg-emerald-500 text-zinc-950 font-bold border border-emerald-400 scale-[1.02]'
                              : isApplyingParams
                              ? 'bg-zinc-800 text-zinc-400 border border-zinc-700 cursor-not-allowed'
                              : 'bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/80 text-emerald-300 hover:text-emerald-200 active:scale-95'
                          }`}
                        >
                          {isApplyingParams ? (
                            <>
                              <RefreshCw className="w-3 h-3 animate-spin text-emerald-400" />
                              <span>Applying...</span>
                            </>
                          ) : isParamsApplied ? (
                            <>
                              <Check className="w-3 h-3 stroke-[3]" />
                              <span>Params Applied!</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3 h-3 text-emerald-400" />
                              <span>Apply AI Params</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <ul className="space-y-1 text-zinc-300 text-[11px]">
                      {aiReport.recommendedTweaks.map((tweak, i) => (
                        <li key={i} className="flex items-start space-x-1.5">
                          <span className="text-emerald-400 font-bold">•</span>
                          <span>{tweak}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 font-mono">
                Click &ldquo;Audit with Gemini Quant Copilot&rdquo; to evaluate regime viability, drawdown risk, and parameter calibrations for {backtestResult.assetPair}.
              </p>
            )}
          </div>

          {/* D. DETAILED TRADE BLOTTER */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3 mb-4">
              <div className="flex items-center space-x-3">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                  Executed Trade Blotter ({filteredTrades.length} trades)
                </h3>

                {/* Filter Pills */}
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setTradeFilter('all')}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                      tradeFilter === 'all' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    All ({backtestResult.trades.length})
                  </button>
                  <button
                    onClick={() => setTradeFilter('wins')}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                      tradeFilter === 'wins' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Wins ({backtestResult.summary.winningTrades})
                  </button>
                  <button
                    onClick={() => setTradeFilter('losses')}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                      tradeFilter === 'losses' ? 'bg-rose-950 text-rose-400 border border-rose-800' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Losses ({backtestResult.summary.losingTrades})
                  </button>
                </div>
              </div>

              {/* Action Downloads */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleExportCSV}
                  className="px-2.5 py-1 rounded border border-zinc-800 bg-zinc-950 hover:bg-zinc-800 text-zinc-300 text-[11px] font-mono flex items-center space-x-1 transition-colors"
                  title="Export Trades as CSV"
                >
                  <Download className="w-3 h-3 text-zinc-400" />
                  <span>Export CSV</span>
                </button>
                <button
                  onClick={handleExportJSON}
                  className="px-2.5 py-1 rounded border border-zinc-800 bg-zinc-950 hover:bg-zinc-800 text-zinc-300 text-[11px] font-mono flex items-center space-x-1 transition-colors"
                  title="Export Complete JSON Report"
                >
                  <Download className="w-3 h-3 text-zinc-400" />
                  <span>Export JSON</span>
                </button>
              </div>
            </div>

            {/* TABLE */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 text-[10px] uppercase tracking-wider bg-zinc-950/40">
                    <th className="py-2 px-3">Trade #</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">Entry Time</th>
                    <th className="py-2 px-3">Exit Time</th>
                    <th className="py-2 px-3">Entry Price</th>
                    <th className="py-2 px-3">Exit Price</th>
                    <th className="py-2 px-3">Volume USD</th>
                    <th className="py-2 px-3">Fee Paid</th>
                    <th className="py-2 px-3 text-right">Net P&amp;L ($)</th>
                    <th className="py-2 px-3 text-right">Return (%)</th>
                    <th className="py-2 px-3">Execution Trigger</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filteredTrades.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-6 text-center text-zinc-500 font-mono">
                        No trades matching this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredTrades.map((t, idx) => {
                      const isProfit = t.pnl >= 0;
                      const isStopLoss = t.reason.toLowerCase().includes('stop');
                      return (
                        <tr key={`${t.id || 'trade'}-${idx}`} className="hover:bg-zinc-950/60 transition-colors">
                          <td className="py-2.5 px-3 text-zinc-400">#{idx + 1}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-200">
                              ROUNDTRIP
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-zinc-400 text-[11px]">
                            {new Date(t.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' })}
                          </td>
                          <td className="py-2.5 px-3 text-zinc-400 text-[11px]">
                            {t.exitTime ? new Date(t.exitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' }) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-zinc-300">${t.entryPrice.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-zinc-300">{t.exitPrice ? `$${t.exitPrice.toLocaleString()}` : '-'}</td>
                          <td className="py-2.5 px-3 text-zinc-400">${t.totalValue.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-zinc-500">${t.fee}</td>
                          <td className={`py-2.5 px-3 text-right font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isProfit ? '+' : ''}${t.pnl.toFixed(2)}
                          </td>
                          <td className={`py-2.5 px-3 text-right font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isProfit ? '+' : ''}{t.pnlPercent}%
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              isStopLoss 
                                ? 'bg-rose-950/60 text-rose-400 border border-rose-900/50' 
                                : isProfit 
                                ? 'bg-emerald-950/40 text-emerald-400' 
                                : 'bg-zinc-800 text-zinc-400'
                            }`}>
                              {t.reason}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
