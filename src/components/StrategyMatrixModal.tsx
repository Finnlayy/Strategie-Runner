import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, TrendingUp, TrendingDown, Target, Activity, ShieldAlert,
  Zap, Clock, DollarSign, BarChart2, Layers, Play, Square,
  CheckCircle2, AlertCircle, Code, ArrowUpRight, ArrowDownRight,
  ExternalLink, Sparkles, Filter
} from "lucide-react";
import { 
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, 
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid, Cell
} from "recharts";
import { StrategyQueueMatrix, TradeOrder, formatTimeframe } from "../types";

interface StrategyMatrixModalProps {
  strategyMatrix: StrategyQueueMatrix | null;
  queue: 'paper' | 'live';
  isOpen: boolean;
  onClose: () => void;
  onToggleRun?: (id: string, action: 'start' | 'stop', mode: 'paper' | 'live') => void;
}

export default function StrategyMatrixModal({
  strategyMatrix,
  queue,
  isOpen,
  onClose,
  onToggleRun
}: StrategyMatrixModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'trades' | 'config'>('overview');
  const [tradeFilter, setTradeFilter] = useState<'all' | 'wins' | 'losses' | 'buys' | 'sells'>('all');

  if (!isOpen || !strategyMatrix) return null;

  const isProfit = strategyMatrix.totalPnL >= 0;
  const isPaper = queue === 'paper';
  const closedTrades = strategyMatrix.trades.filter(t => t.pnl !== undefined && t.type === 'sell');

  // Build cumulative P&L chart data for this strategy
  let runningPnL = 0;
  const chartData = closedTrades
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((t, idx) => {
      const pnl = t.pnl || 0;
      runningPnL = Number((runningPnL + pnl).toFixed(2));
      return {
        tradeNum: idx + 1,
        time: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        pnl,
        cumPnL: runningPnL,
        price: t.price
      };
    });

  // Filter strategy trades
  const filteredTrades = strategyMatrix.trades.filter(t => {
    if (tradeFilter === 'wins') return t.pnl !== undefined && t.pnl > 0;
    if (tradeFilter === 'losses') return t.pnl !== undefined && t.pnl <= 0;
    if (tradeFilter === 'buys') return t.type === 'buy';
    if (tradeFilter === 'sells') return t.type === 'sell';
    return true;
  });

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ duration: 0.18 }}
          className="bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-zinc-100 font-sans"
        >
          {/* Modal Header */}
          <div className="p-5 border-b border-zinc-800 bg-zinc-950/70 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center space-x-3.5">
              <div className={`p-2.5 rounded-lg border font-mono font-bold text-sm ${
                strategyMatrix.assetPair.startsWith('BTC') || strategyMatrix.assetPair.startsWith('XBT')
                  ? 'bg-amber-950/50 border-amber-600/60 text-amber-300'
                  : strategyMatrix.assetPair.startsWith('ETH')
                    ? 'bg-indigo-950/50 border-indigo-600/60 text-indigo-300'
                    : strategyMatrix.assetPair.startsWith('SOL')
                      ? 'bg-purple-950/50 border-purple-600/60 text-purple-300'
                      : 'bg-emerald-950/50 border-emerald-600/60 text-emerald-300'
              }`}>
                {strategyMatrix.assetPair}
              </div>
              <div>
                <div className="flex items-center space-x-2.5">
                  <h3 className="text-base font-mono font-bold text-white tracking-tight">
                    {strategyMatrix.strategyName}
                  </h3>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-bold tracking-wider ${
                    isPaper
                      ? 'bg-amber-950/70 text-amber-300 border-amber-700/60'
                      : 'bg-rose-950/70 text-rose-300 border-rose-700/60'
                  }`}>
                    {isPaper ? 'L2 PAPER QUEUE MATRIX' : 'L4 LIVE QUEUE MATRIX'}
                  </span>
                </div>
                <div className="flex items-center space-x-3 text-xs font-mono text-zinc-400 mt-1">
                  <span>Symbol: <strong className="text-zinc-200">{strategyMatrix.assetPair}</strong></span>
                  <span>•</span>
                  <span>Timeframe: <strong className="text-zinc-200">{formatTimeframe(strategyMatrix.interval)}</strong></span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    Status: 
                    <span className={`w-2 h-2 rounded-full ${strategyMatrix.status === 'active' ? 'bg-emerald-400 animate-ping' : 'bg-zinc-600'}`} />
                    <strong className={strategyMatrix.status === 'active' ? 'text-emerald-400' : 'text-zinc-400'}>
                      {strategyMatrix.status.toUpperCase()}
                    </strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions & Close */}
            <div className="flex items-center space-x-2">
              {onToggleRun && (
                <button
                  onClick={() => onToggleRun(strategyMatrix.strategyId, strategyMatrix.status === 'active' ? 'stop' : 'start', queue)}
                  className={`px-3 py-1.5 rounded text-xs font-mono font-bold flex items-center space-x-1.5 transition-all shadow-sm ${
                    strategyMatrix.status === 'active'
                      ? 'bg-rose-950/80 border border-rose-700 text-rose-200 hover:bg-rose-900'
                      : isPaper
                        ? 'bg-emerald-950/80 border border-emerald-700 text-emerald-200 hover:bg-emerald-900'
                        : 'bg-rose-950/80 border border-rose-700 text-rose-200 hover:bg-rose-900'
                  }`}
                >
                  {strategyMatrix.status === 'active' ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                  <span>{strategyMatrix.status === 'active' ? 'HALT STRATEGY' : isPaper ? 'DEPLOY TO L2' : 'DEPLOY TO L4'}</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                title="Close template"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Navigation Sub-Tabs */}
          <div className="flex items-center space-x-1 px-5 pt-3 border-b border-zinc-800/80 bg-zinc-950/40">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3.5 py-2 text-xs font-mono font-semibold border-b-2 transition-all ${
                activeTab === 'overview'
                  ? 'border-emerald-500 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Matrix Telemetry &amp; Visuals
            </button>
            <button
              onClick={() => setActiveTab('trades')}
              className={`px-3.5 py-2 text-xs font-mono font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === 'trades'
                  ? 'border-emerald-500 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>All-Time Queue Trades</span>
              <span className="bg-zinc-800 text-zinc-300 text-[10px] px-1.5 py-0.2 rounded-full">
                {strategyMatrix.trades.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`px-3.5 py-2 text-xs font-mono font-semibold border-b-2 transition-all ${
                activeTab === 'config'
                  ? 'border-emerald-500 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Algorithm Parameters
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-5 overflow-y-auto flex-1 space-y-5">
            {activeTab === 'overview' && (
              <>
                {/* 1. Core Matrix Stats Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                  <div className="bg-zinc-950/60 border border-zinc-800 p-3 rounded-lg">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Net Total P&amp;L</span>
                    <div className={`text-lg font-bold mt-1 ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isProfit ? '+' : ''}${strategyMatrix.totalPnL.toFixed(2)}
                    </div>
                    <span className="text-[10px] text-zinc-500">
                      Realized: ${strategyMatrix.realizedPnL.toFixed(2)}
                    </span>
                  </div>

                  <div className="bg-zinc-950/60 border border-zinc-800 p-3 rounded-lg">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Win Rate (Closed)</span>
                    <div className="text-lg font-bold text-white mt-1">
                      {strategyMatrix.winRate}%
                    </div>
                    <span className="text-[10px] text-zinc-400">
                      {strategyMatrix.winningTrades}W / {strategyMatrix.losingTrades}L ({strategyMatrix.totalTrades} closed)
                    </span>
                  </div>

                  <div className="bg-zinc-950/60 border border-zinc-800 p-3 rounded-lg">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Profit Factor</span>
                    <div className="text-lg font-bold text-amber-400 mt-1">
                      {strategyMatrix.profitFactor.toFixed(2)}
                    </div>
                    <span className="text-[10px] text-zinc-500">
                      Max DD: {strategyMatrix.maxDrawdown}%
                    </span>
                  </div>

                  <div className="bg-zinc-950/60 border border-zinc-800 p-3 rounded-lg">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Traded Volume</span>
                    <div className="text-lg font-bold text-zinc-200 mt-1">
                      ${strategyMatrix.volumeTradedUSD.toLocaleString()}
                    </div>
                    <span className="text-[10px] text-zinc-500">
                      Avg Trade: ${strategyMatrix.avgTradeReturn.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* 2. Visual Charts Bento Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Cumulative P&L Curve */}
                  <div className="bg-zinc-950/60 border border-zinc-800 p-4 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                        Cumulative P&amp;L Trajectory ($ USD)
                      </h4>
                      <span className="text-[10px] font-mono text-zinc-500">{chartData.length} closed trades</span>
                    </div>

                    <div className="h-44 w-full pt-2">
                      {chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                              <linearGradient id="stratPnlGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={isProfit ? "#10b981" : "#f43f5e"} stopOpacity={0.4}/>
                                <stop offset="95%" stopColor={isProfit ? "#10b981" : "#f43f5e"} stopOpacity={0.0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                            <XAxis 
                              dataKey="tradeNum" 
                              tick={{ fontSize: 9, fill: "#71717a", fontFamily: "monospace" }}
                              tickLine={false}
                              axisLine={{ stroke: "#27272a" }}
                              tickFormatter={(val) => `T#${val}`}
                            />
                            <YAxis 
                              tick={{ fontSize: 9, fill: "#71717a", fontFamily: "monospace" }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(val) => `$${Number(val).toFixed(0)}`}
                            />
                            <Tooltip
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload;
                                  return (
                                    <div className="bg-zinc-950 border border-zinc-800 p-2 rounded shadow-xl font-mono text-[11px] space-y-1">
                                      <div className="text-zinc-400 text-[10px]">Trade #{data.tradeNum} ({data.time})</div>
                                      <div className="text-zinc-200">Trade P&amp;L: <strong className={data.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}</strong></div>
                                      <div className="text-zinc-200">Cum. P&amp;L: <strong className={data.cumPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}>${data.cumPnL.toFixed(2)}</strong></div>
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
                              strokeWidth={2}
                              fill="url(#stratPnlGrad)" 
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs font-mono text-zinc-500">
                          No closed round-trip trades recorded on this queue yet
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Individual Trade P&L Bar Chart */}
                  <div className="bg-zinc-950/60 border border-zinc-800 p-4 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                        <BarChart2 className="w-3.5 h-3.5 text-amber-400" />
                        Individual Trade P&amp;L Distribution
                      </h4>
                      <span className="text-[10px] font-mono text-zinc-500">
                        Best: +${strategyMatrix.bestTrade.toFixed(2)} | Worst: ${strategyMatrix.worstTrade.toFixed(2)}
                      </span>
                    </div>

                    <div className="h-44 w-full pt-2">
                      {chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                            <XAxis 
                              dataKey="tradeNum" 
                              tick={{ fontSize: 9, fill: "#71717a", fontFamily: "monospace" }}
                              tickLine={false}
                              axisLine={{ stroke: "#27272a" }}
                              tickFormatter={(val) => `T#${val}`}
                            />
                            <YAxis 
                              tick={{ fontSize: 9, fill: "#71717a", fontFamily: "monospace" }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(val) => `$${Number(val).toFixed(0)}`}
                            />
                            <Tooltip
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload;
                                  return (
                                    <div className="bg-zinc-950 border border-zinc-800 p-2 rounded shadow-xl font-mono text-[11px] space-y-1">
                                      <div className="text-zinc-400 text-[10px]">Trade #{data.tradeNum}</div>
                                      <div className={data.pnl >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                        {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)} USD
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <ReferenceLine y={0} stroke="#52525b" strokeDasharray="2 2" />
                            <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                              {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs font-mono text-zinc-500">
                          No trade distributions available yet
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 3. Deep Matrix Attributes List */}
                <div className="bg-zinc-950/60 border border-zinc-800 p-4 rounded-lg">
                  <h4 className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider mb-3">
                    Detailed Matrix Attributes
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
                    <div className="flex justify-between border-b border-zinc-800/60 pb-1.5">
                      <span className="text-zinc-500">Execution Queue:</span>
                      <span className={`font-semibold ${isPaper ? 'text-amber-400' : 'text-rose-400'}`}>
                        {isPaper ? 'Level 2 Paper' : 'Level 4 Live'}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-zinc-800/60 pb-1.5">
                      <span className="text-zinc-500">Total Round-Trips:</span>
                      <span className="text-zinc-200 font-semibold">{strategyMatrix.totalTrades}</span>
                    </div>
                    <div className="flex justify-between border-b border-zinc-800/60 pb-1.5">
                      <span className="text-zinc-500">Win / Loss Ratio:</span>
                      <span className="text-zinc-200 font-semibold">
                        {strategyMatrix.losingTrades > 0 ? (strategyMatrix.winningTrades / strategyMatrix.losingTrades).toFixed(2) : strategyMatrix.winningTrades}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-zinc-800/60 pb-1.5">
                      <span className="text-zinc-500">Max Trade Peak:</span>
                      <span className="text-emerald-400 font-semibold">+${strategyMatrix.bestTrade.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-b border-zinc-800/60 pb-1.5">
                      <span className="text-zinc-500">Max Trade Trough:</span>
                      <span className="text-rose-400 font-semibold">${strategyMatrix.worstTrade.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-b border-zinc-800/60 pb-1.5">
                      <span className="text-zinc-500">Current Floating Unrealized:</span>
                      <span className={`font-semibold ${strategyMatrix.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {strategyMatrix.unrealizedPnL >= 0 ? '+' : ''}${strategyMatrix.unrealizedPnL.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'trades' && (
              <div className="space-y-3 font-mono">
                {/* Filter Controls */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center space-x-1.5">
                    <Filter className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="text-xs text-zinc-400 font-semibold">Filter:</span>
                    {(['all', 'wins', 'losses', 'buys', 'sells'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setTradeFilter(f)}
                        className={`px-2.5 py-1 rounded text-[11px] uppercase tracking-wider transition-colors ${
                          tradeFilter === f
                            ? 'bg-zinc-700 text-white font-bold'
                            : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] text-zinc-500">{filteredTrades.length} trades listed</span>
                </div>

                {/* Trades Table */}
                <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
                  <div className="overflow-x-auto max-h-[360px] terminal-scroll">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-900 border-b border-zinc-800 text-[10px] text-zinc-400 uppercase tracking-wider sticky top-0">
                        <tr>
                          <th className="py-2.5 px-3">Order ID</th>
                          <th className="py-2.5 px-3">Time</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">Price</th>
                          <th className="py-2.5 px-3">Amount</th>
                          <th className="py-2.5 px-3">Total (USD)</th>
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
                                <td className="py-2 px-3 text-zinc-400 font-mono text-[11px]">{t.id}</td>
                                <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">
                                  {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                                </td>
                                <td className="py-2 px-3">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                    isBuy ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60' : 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                                  }`}>
                                    {t.type}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-zinc-200">${t.price.toLocaleString()}</td>
                                <td className="py-2 px-3 text-zinc-300">{t.amount}</td>
                                <td className="py-2 px-3 text-zinc-300">${t.total.toLocaleString()}</td>
                                <td className="py-2 px-3 text-right">
                                  {hasPnl ? (
                                    <span className={`font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {isWin ? '+' : ''}${t.pnl?.toFixed(2)}
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
                            <td colSpan={7} className="py-6 text-center text-zinc-500 font-mono">
                              No trades match the current filter
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'config' && (
              <div className="space-y-4 font-mono">
                <div className="bg-zinc-950/60 border border-zinc-800 p-4 rounded-lg">
                  <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-3">
                    Active Parameter Matrix
                  </h4>
                  {strategyMatrix.parameters && Object.keys(strategyMatrix.parameters).length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                      {Object.entries(strategyMatrix.parameters).map(([key, val]) => (
                        <div key={key} className="bg-zinc-900 border border-zinc-800/80 p-2.5 rounded">
                          <span className="text-[10px] text-zinc-500 block">{key}</span>
                          <span className="text-white font-semibold mt-0.5 block">{String(val)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500">No custom parameters declared</div>
                  )}
                </div>

                <div className="bg-zinc-950/60 border border-zinc-800 p-4 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Code className="w-3.5 h-3.5 text-emerald-400" />
                      Execution Queue Configuration
                    </h4>
                    <span className="text-[10px] text-zinc-500">Automation Rule</span>
                  </div>
                  <div className="text-xs text-zinc-400 space-y-1 bg-zinc-900 p-3 rounded border border-zinc-800/80 leading-relaxed">
                    <p>• Strategy assigned to <strong>{isPaper ? 'Paper Queue (Level 2)' : 'Live Queue (Level 4)'}</strong>.</p>
                    <p>• Polling Interval: <strong>{strategyMatrix.interval}s</strong>.</p>
                    <p>• Order fills validated against live Kraken Exchange order-book tickers.</p>
                    <p>• Win rate strictly computed on closed sell executions.</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="p-4 border-t border-zinc-800 bg-zinc-950/80 flex items-center justify-between text-xs font-mono text-zinc-500">
            <span>Kraken Strategy Matrix Inspector • {strategyMatrix.strategyId}</span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold transition-colors"
            >
              Close Template
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
