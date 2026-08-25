import React, { useState } from "react";
import { motion } from "motion/react";
import { 
  TrendingUp, TrendingDown, Layers, Activity, ShieldCheck, Zap,
  BarChart2, PieChart as PieIcon, ArrowUpRight, ArrowDownRight,
  Filter, Search, Download, RefreshCw, ChevronRight, Play, Square,
  CheckCircle2, AlertTriangle, HelpCircle, FileText
} from "lucide-react";
import { 
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid, Cell,
  PieChart, Pie, Legend
} from "recharts";
import { QueueMatrixData, StrategyQueueMatrix, TradeOrder } from "../types";
import StrategyMatrixModal from "./StrategyMatrixModal";

interface QueueMatrixPanelProps {
  paperMatrix?: QueueMatrixData | null;
  liveMatrix?: QueueMatrixData | null;
  queueMatrices?: { paper: QueueMatrixData; live: QueueMatrixData } | null;
  activeLedgerMode?: 'paper' | 'live';
  onSelectStrategy?: (id: string) => void;
  onToggleStrategy?: (id: string, action: 'start' | 'stop', mode: 'paper' | 'live') => void;
  onRefresh?: () => void;
}

export default function QueueMatrixPanel({
  paperMatrix,
  liveMatrix,
  queueMatrices,
  activeLedgerMode = 'paper',
  onSelectStrategy,
  onToggleStrategy,
  onRefresh
}: QueueMatrixPanelProps) {
  const effectivePaperMatrix = paperMatrix || queueMatrices?.paper || null;
  const effectiveLiveMatrix = liveMatrix || queueMatrices?.live || null;

  const [selectedView, setSelectedView] = useState<'paper' | 'live' | 'dual'>(
    activeLedgerMode === 'live' ? 'live' : 'paper'
  );
  const [selectedStrategyForModal, setSelectedStrategyForModal] = useState<{
    strategy: StrategyQueueMatrix;
    queue: 'paper' | 'live';
  } | null>(null);
  const [tradeSearch, setTradeSearch] = useState("");
  const [tradeTypeFilter, setTradeTypeFilter] = useState<'all' | 'buy' | 'sell' | 'wins' | 'losses'>('all');

  const activeMatrix = selectedView === 'live' ? liveMatrix : paperMatrix;

  const handleOpenStrategyModal = (strat: StrategyQueueMatrix, queue: 'paper' | 'live') => {
    setSelectedStrategyForModal({ strategy: strat, queue });
  };

  const handleCloseModal = () => {
    setSelectedStrategyForModal(null);
  };

  const exportTradesCSV = (trades: TradeOrder[], queueName: string) => {
    if (!trades || trades.length === 0) return;
    const headers = ["Order ID", "Timestamp", "Strategy", "Symbol", "Type", "Price", "Amount", "Total USD", "Realized PnL", "Status", "Queue"];
    const rows = trades.map(t => [
      t.id,
      t.timestamp,
      `"${t.strategyName || ''}"`,
      t.pair,
      t.type,
      t.price,
      t.amount,
      t.total,
      t.pnl !== undefined ? t.pnl : '',
      t.status,
      t.executionMode || queueName
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `kraken_${queueName}_all_time_trades_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderQueueMatrixContent = (matrix: QueueMatrixData | null, queueType: 'paper' | 'live') => {
    if (!matrix) {
      return (
        <div className="p-12 text-center text-zinc-500 font-mono">
          <Activity className="w-8 h-8 mx-auto animate-spin mb-3 text-zinc-600" />
          <p>Compiling all-time queue performance matrix...</p>
        </div>
      );
    }

    const isProfit = matrix.totalPnL >= 0;
    const isPaper = queueType === 'paper';

    // Filter all time trades
    const filteredTrades = matrix.allTimeTrades.filter(t => {
      const matchesSearch = tradeSearch === "" || 
        t.pair.toLowerCase().includes(tradeSearch.toLowerCase()) ||
        t.strategyName.toLowerCase().includes(tradeSearch.toLowerCase()) ||
        t.id.toLowerCase().includes(tradeSearch.toLowerCase());

      if (!matchesSearch) return false;

      if (tradeTypeFilter === 'buy') return t.type === 'buy';
      if (tradeTypeFilter === 'sell') return t.type === 'sell';
      if (tradeTypeFilter === 'wins') return t.pnl !== undefined && t.pnl > 0;
      if (tradeTypeFilter === 'losses') return t.pnl !== undefined && t.pnl <= 0;
      return true;
    });

    const PIE_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];

    return (
      <div className="space-y-6">
        {/* Queue Header Badge Banner */}
        <div className={`p-4 rounded-xl border flex items-center justify-between flex-wrap gap-3 ${
          isPaper 
            ? 'bg-amber-950/20 border-amber-800/40 text-amber-200' 
            : 'bg-rose-950/20 border-rose-800/40 text-rose-200'
        }`}>
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-lg border font-mono font-bold text-sm ${
              isPaper ? 'bg-amber-950/60 border-amber-700/60 text-amber-300' : 'bg-rose-950/60 border-rose-700/60 text-rose-300'
            }`}>
              {isPaper ? 'LEVEL 2' : 'LEVEL 4'}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-mono font-bold text-white tracking-tight">
                  {matrix.queueLabel}
                </h3>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                  isPaper ? 'bg-amber-900/50 text-amber-300 border border-amber-700/50' : 'bg-rose-900/50 text-rose-300 border border-rose-700/50'
                }`}>
                  {isPaper ? 'Guarded Validation (validate=true)' : 'Autonomous Capital (Real Orders)'}
                </span>
              </div>
              <p className="text-xs font-mono text-zinc-400 mt-0.5">
                {isPaper 
                  ? 'All-time simulation queue with direct real-time order-book fills & simulated ledger.' 
                  : 'All-time autonomous execution queue routing capital to Kraken Pro Exchange.'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 text-xs font-mono">
            <div className="bg-zinc-950/60 border border-zinc-800 px-3 py-1.5 rounded-lg text-right">
              <span className="text-zinc-500 text-[10px] block">ACTIVE WORKERS</span>
              <strong className="text-emerald-400 font-bold">{matrix.activeWorkers} Running</strong>
            </div>
            <button
              onClick={() => exportTradesCSV(matrix.allTimeTrades, queueType)}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-mono flex items-center space-x-1.5 transition-colors shadow-sm"
              title="Download CSV of all-time trade ledger"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* 1. Core All-Time Matrix Telemetry Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono">
          <div className="bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-xl">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Net Total P&amp;L</span>
            <div className={`text-xl font-bold mt-1 ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isProfit ? '+' : ''}${matrix.totalPnL.toFixed(2)}
            </div>
            <span className="text-[10px] text-zinc-400">
              Return: <strong className={matrix.cumulativeReturnPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {matrix.cumulativeReturnPercent >= 0 ? '+' : ''}{matrix.cumulativeReturnPercent}%
              </strong>
            </span>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-xl">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Win Rate (Closed)</span>
            <div className="text-xl font-bold text-white mt-1">
              {matrix.winRate}%
            </div>
            <span className="text-[10px] text-zinc-400">
              {matrix.winningTrades}W / {matrix.losingTrades}L ({matrix.totalClosedTrades} closed)
            </span>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-xl">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Profit Factor</span>
            <div className="text-xl font-bold text-amber-400 mt-1">
              {matrix.profitFactor.toFixed(2)}
            </div>
            <span className="text-[10px] text-zinc-500">
              Realized: ${matrix.totalRealizedPnL.toFixed(2)}
            </span>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-xl">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Sharpe Ratio</span>
            <div className="text-xl font-bold text-indigo-400 mt-1">
              {matrix.sharpeRatio.toFixed(2)}
            </div>
            <span className="text-[10px] text-zinc-500">
              Sortino: {matrix.sortinoRatio.toFixed(2)}
            </span>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-xl">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Max Drawdown</span>
            <div className="text-xl font-bold text-rose-400 mt-1">
              -{matrix.maxDrawdownPercent}%
            </div>
            <span className="text-[10px] text-zinc-500">
              Floating: ${matrix.totalUnrealizedPnL.toFixed(2)}
            </span>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 p-3.5 rounded-xl">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Volume Traded</span>
            <div className="text-xl font-bold text-zinc-200 mt-1">
              ${matrix.volumeTradedUSD.toLocaleString()}
            </div>
            <span className="text-[10px] text-zinc-500">
              {matrix.totalAllTrades} total orders
            </span>
          </div>
        </div>

        {/* 2. Performed Strategies as Clickable Symbols */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h4 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                Performed Strategies on this Queue
              </h4>
              <p className="text-[11px] font-mono text-zinc-400 mt-0.5">
                Click any symbol card to open its complete Strategy Performance Matrix Template.
              </p>
            </div>
            <span className="text-xs font-mono text-zinc-500">
              {matrix.strategies.length} configured strategies
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 font-mono">
            {matrix.strategies.map((strat) => {
              const stratProfit = strat.totalPnL >= 0;
              const isBTC = strat.assetPair.startsWith('BTC') || strat.assetPair.startsWith('XBT');
              const isETH = strat.assetPair.startsWith('ETH');
              const isSOL = strat.assetPair.startsWith('SOL');

              return (
                <button
                  key={strat.strategyId}
                  onClick={() => handleOpenStrategyModal(strat, queueType)}
                  className={`group text-left p-3.5 rounded-xl border transition-all relative overflow-hidden flex flex-col justify-between hover:scale-[1.01] hover:shadow-lg ${
                    strat.status === 'active'
                      ? 'bg-zinc-950/90 border-zinc-700/80 hover:border-emerald-500/80'
                      : 'bg-zinc-950/50 border-zinc-850 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start justify-between w-full mb-2">
                    <div className="flex items-center space-x-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs border ${
                        isBTC ? 'bg-amber-950/60 border-amber-600/70 text-amber-300' :
                        isETH ? 'bg-indigo-950/60 border-indigo-600/70 text-indigo-300' :
                        isSOL ? 'bg-purple-950/60 border-purple-600/70 text-purple-300' :
                        'bg-emerald-950/60 border-emerald-600/70 text-emerald-300'
                      }`}>
                        {strat.assetPair.split('/')[0]}
                      </div>
                      <div>
                        <div className="font-bold text-white text-xs group-hover:text-emerald-400 transition-colors flex items-center gap-1">
                          <span>{strat.assetPair}</span>
                          <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400" />
                        </div>
                        <span className="text-[10px] text-zinc-400 block truncate max-w-[130px]">
                          {strat.strategyName}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1">
                      <span className={`w-2 h-2 rounded-full ${strat.status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                      <span className={`text-[9px] uppercase font-bold ${strat.status === 'active' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                        {strat.status}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-zinc-800/80 grid grid-cols-3 gap-1 text-center w-full">
                    <div>
                      <span className="text-[9px] text-zinc-500 block">Win Rate</span>
                      <span className="text-xs font-bold text-white">{strat.winRate}%</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-zinc-500 block">Net P&amp;L</span>
                      <span className={`text-xs font-bold ${stratProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {stratProfit ? '+' : ''}${strat.totalPnL.toFixed(0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] text-zinc-500 block">Closed</span>
                      <span className="text-xs font-bold text-zinc-300">{strat.totalTrades}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Visual Charts & Analytics Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Cumulative Trajectory Chart */}
          <div className="lg:col-span-2 bg-zinc-900/80 border border-zinc-800 p-4 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                All-Time Queue Cumulative Equity Curve ($ USD)
              </h4>
              <span className="text-[10px] font-mono text-zinc-400">
                {matrix.pnlTrajectory.length} closed round-trips
              </span>
            </div>

            <div className="h-56 w-full pt-2">
              {matrix.pnlTrajectory.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={matrix.pnlTrajectory} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`queueGrad-${queueType}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isProfit ? "#10b981" : "#f43f5e"} stopOpacity={0.4}/>
                        <stop offset="95%" stopColor={isProfit ? "#10b981" : "#f43f5e"} stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                    <XAxis 
                      dataKey="tradeIndex" 
                      tick={{ fontSize: 10, fill: "#71717a", fontFamily: "monospace" }}
                      tickLine={false}
                      axisLine={{ stroke: "#27272a" }}
                      tickFormatter={(val) => `Trade #${val}`}
                    />
                    <YAxis 
                      tick={{ fontSize: 10, fill: "#71717a", fontFamily: "monospace" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => `$${Number(val).toFixed(0)}`}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg shadow-xl font-mono text-xs space-y-1">
                              <div className="text-zinc-400 text-[10px] font-bold">Trade #{data.tradeIndex} ({data.time})</div>
                              <div className="text-zinc-300">Symbol: <strong className="text-white">{data.pair}</strong></div>
                              <div className="text-zinc-300">Strategy: <span className="text-zinc-400">{data.strategyName}</span></div>
                              <div className="text-zinc-300">Trade P&amp;L: <strong className={data.tradePnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{data.tradePnL >= 0 ? '+' : ''}${data.tradePnL.toFixed(2)}</strong></div>
                              <div className="text-zinc-300">Cum. Equity: <strong className={data.cumPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}>${data.cumPnL.toFixed(2)} USD</strong></div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <ReferenceLine y={0} stroke="#52525b" strokeDasharray="2 2" />
                    <Area 
                      type="monotone" 
                      dataKey="cumPnL" 
                      stroke={isProfit ? "#10b981" : "#f43f5e"} 
                      strokeWidth={2.5}
                      fill={`url(#queueGrad-${queueType})`} 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs font-mono text-zinc-500">
                  No closed trades recorded in this queue
                </div>
              )}
            </div>
          </div>

          {/* Asset Volume & Allocation Breakdown */}
          <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-xl space-y-2 flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <PieIcon className="w-3.5 h-3.5 text-amber-400" />
                Asset Volume &amp; P&amp;L Breakdown
              </h4>
              <p className="text-[10px] font-mono text-zinc-500 mt-0.5">
                Performance by trading pair
              </p>
            </div>

            <div className="space-y-2.5 font-mono text-xs my-auto pt-2">
              {matrix.assetBreakdown.length > 0 ? (
                matrix.assetBreakdown.map((asset, idx) => (
                  <div key={asset.pair} className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800/80 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                        {asset.pair}
                      </span>
                      <span className={`font-bold ${asset.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {asset.netPnL >= 0 ? '+' : ''}${asset.netPnL.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-zinc-500">
                      <span>Volume: ${asset.volumeUSD.toLocaleString()}</span>
                      <span>Win: {asset.winRate}% ({asset.tradesCount} orders)</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-zinc-500 py-6 text-xs">
                  No assets traded yet
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-zinc-800 text-[11px] font-mono text-zinc-400 flex justify-between">
              <span>Avg Trade Return:</span>
              <strong className={matrix.averageTradeReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                ${matrix.averageTradeReturn.toFixed(2)} USD
              </strong>
            </div>
          </div>
        </div>

        {/* 4. All-Time Queue Trades Ledger */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-3 font-mono">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-zinc-400" />
                All-Time Queue Execution Ledger
              </h4>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Complete history of filled orders on {isPaper ? 'Level 2 Paper Queue' : 'Level 4 Live Queue'}.
              </p>
            </div>

            <div className="flex items-center space-x-2 flex-wrap gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Search pair, ID, strat..."
                  value={tradeSearch}
                  onChange={(e) => setTradeSearch(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 w-44"
                />
              </div>

              <div className="flex items-center space-x-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                {(['all', 'buy', 'sell', 'wins', 'losses'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setTradeTypeFilter(f)}
                    className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold transition-colors ${
                      tradeTypeFilter === f ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
            <div className="overflow-x-auto max-h-[380px] terminal-scroll">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-900 border-b border-zinc-800 text-[10px] text-zinc-400 uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">Order ID</th>
                    <th className="py-2.5 px-3">Time</th>
                    <th className="py-2.5 px-3">Strategy</th>
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Fill Price</th>
                    <th className="py-2.5 px-3">Volume USD</th>
                    <th className="py-2.5 px-3 text-right">Realized P&amp;L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {filteredTrades.length > 0 ? (
                    filteredTrades.map((t, idx) => {
                      const isBuy = t.type === 'buy';
                      const hasPnl = t.pnl !== undefined;
                      const isWin = (t.pnl || 0) > 0;
                      return (
                        <tr key={`${t.id || 'trade'}-${t.timestamp || ''}-${idx}`} className="hover:bg-zinc-900/50 transition-colors">
                          <td className="py-2 px-3 text-zinc-400 text-[11px]">{t.id}</td>
                          <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">
                            {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                          </td>
                          <td className="py-2 px-3 text-zinc-300 font-semibold truncate max-w-[150px]">
                            {t.strategyName}
                          </td>
                          <td className="py-2 px-3">
                            <span className="font-bold text-white bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                              {t.pair}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                              isBuy ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60' : 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                            }`}>
                              {t.type}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-zinc-200">${t.price.toLocaleString()}</td>
                          <td className="py-2 px-3 text-zinc-300">${t.total.toLocaleString()}</td>
                          <td className="py-2 px-3 text-right">
                            {hasPnl ? (
                              <span className={`font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {isWin ? '+' : ''}${t.pnl?.toFixed(2)} USD
                              </span>
                            ) : (
                              <span className="text-zinc-600 text-[10px]">OPEN / ENTRY</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-zinc-500 font-mono">
                        No orders recorded matching filter
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Header & View Switcher */}
      <div className="flex items-center justify-between flex-wrap gap-4 bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-mono font-bold text-white tracking-tight">
              Queue Performance Matrices
            </h2>
          </div>
          <p className="text-xs font-mono text-zinc-400">
            Dedicated performance matrices for Level 2 Paper Queue and Level 4 Live Queue with complete all-time data.
          </p>
        </div>

        {/* View Mode Switcher Buttons */}
        <div className="flex items-center space-x-2 bg-zinc-950 p-1 rounded-xl border border-zinc-800 font-mono text-xs">
          <button
            onClick={() => setSelectedView('paper')}
            className={`px-3.5 py-1.5 rounded-lg font-bold transition-all flex items-center space-x-1.5 ${
              selectedView === 'paper'
                ? 'bg-amber-950 text-amber-300 border border-amber-700/60 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            <span>L2 Paper Queue Matrix</span>
          </button>

          <button
            onClick={() => setSelectedView('live')}
            className={`px-3.5 py-1.5 rounded-lg font-bold transition-all flex items-center space-x-1.5 ${
              selectedView === 'live'
                ? 'bg-rose-950 text-rose-300 border border-rose-700/60 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-rose-400" />
            <span>L4 Live Queue Matrix</span>
          </button>

          <button
            onClick={() => setSelectedView('dual')}
            className={`px-3.5 py-1.5 rounded-lg font-bold transition-all flex items-center space-x-1.5 ${
              selectedView === 'dual'
                ? 'bg-zinc-800 text-white border border-zinc-600 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Dual Comparison</span>
          </button>
        </div>
      </div>

      {/* Main View Display */}
      {selectedView === 'paper' && renderQueueMatrixContent(effectivePaperMatrix, 'paper')}
      {selectedView === 'live' && renderQueueMatrixContent(effectiveLiveMatrix, 'live')}

      {selectedView === 'dual' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="space-y-6 bg-zinc-950/40 p-4 rounded-xl border border-zinc-800/80">
            <h3 className="text-sm font-mono font-bold text-amber-400 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              L2 Paper Execution Queue Matrix
            </h3>
            {renderQueueMatrixContent(effectivePaperMatrix, 'paper')}
          </div>

          <div className="space-y-6 bg-zinc-950/40 p-4 rounded-xl border border-zinc-800/80">
            <h3 className="text-sm font-mono font-bold text-rose-400 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              L4 Live Execution Queue Matrix
            </h3>
            {renderQueueMatrixContent(effectiveLiveMatrix, 'live')}
          </div>
        </div>
      )}

      {/* Strategy Performance Template Modal */}
      {selectedStrategyForModal && (
        <StrategyMatrixModal
          strategyMatrix={selectedStrategyForModal.strategy}
          queue={selectedStrategyForModal.queue}
          isOpen={true}
          onClose={handleCloseModal}
          onToggleRun={onToggleStrategy}
        />
      )}
    </div>
  );
}
