import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Cpu,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Activity,
  Terminal,
  Play,
  RotateCw,
  Copy,
  Check,
  AlertTriangle,
  Zap,
  Sliders,
  Clock,
  BrainCircuit
} from "lucide-react";

export interface MarketState {
  timestamp: number;
  symbol: string;
  bid_ask_spread: number;
  order_book_imbalance: number;
  delta_vof: number;
  recent_volatility_atr: number;
  micro_price_trend: string;
}

export interface JevSignalOutput {
  symbol: string;
  timestamp: number;
  signal: "long" | "short" | "wait";
  probabilities: {
    long: number;
    short: number;
    wait: number;
  };
  urgency_score: number;
  spread_safe_probability: number;
  executable_action: boolean;
  gating: {
    spread_safe: boolean;
    urgency_sufficient: boolean;
    confidence_sufficient: boolean;
    reasons: string[];
  };
  source?: "openrouter_jev" | "local_heuristic";
  execution_plan?: {
    action: "buy" | "sell" | "none";
    order_type: "limit" | "market";
    suggested_volume: number;
    suggested_price?: number;
    cli_command: string;
  };
}

export interface JevExecutionHistoryItem {
  id: string;
  timestamp: number;
  market_state: MarketState;
  signal: JevSignalOutput;
  dispatch_result?: {
    status: "executed" | "paper_simulated" | "blocked" | "error";
    order_id?: string;
    message: string;
    executed_at: number;
    cli_command: string;
  };
}

interface JevAgentBridgePanelProps {
  activePair?: string;
}

export const JevAgentBridgePanel: React.FC<JevAgentBridgePanelProps> = ({
  activePair = "BTC/USD"
}) => {
  const [status, setStatus] = useState<{
    configured: boolean;
    model: string;
    apiUrl: string;
  } | null>(null);

  const [symbol, setSymbol] = useState<string>(activePair);
  const [bidAskSpread, setBidAskSpread] = useState<number>(0.50);
  const [orderBookImbalance, setOrderBookImbalance] = useState<number>(0.78);
  const [deltaVof, setDeltaVof] = useState<number>(1450);
  const [recentAtr, setRecentAtr] = useState<number>(12.4);
  const [microPriceTrend, setMicroPriceTrend] = useState<string>("upward");

  const [paperMode, setPaperMode] = useState<boolean>(true);
  const [orderVolume, setOrderVolume] = useState<number>(0.01);
  const [autoDispatch, setAutoDispatch] = useState<boolean>(false);

  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [latestSignal, setLatestSignal] = useState<JevSignalOutput | null>(null);
  const [latestDispatch, setLatestDispatch] = useState<any>(null);
  const [history, setHistory] = useState<JevExecutionHistoryItem[]>([]);
  const [copiedCli, setCopiedCli] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    fetchStatus();
    fetchHistory();
  }, []);

  useEffect(() => {
    if (activePair) {
      setSymbol(activePair);
      fetchLiveTelemetry(activePair);
    }
  }, [activePair]);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/jev/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (e) {
      console.warn("Could not fetch Jev bridge status", e);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/jev/history");
      if (res.ok) {
        const data = await res.json();
        if (data.history) {
          setHistory(data.history);
          if (data.history.length > 0 && !latestSignal) {
            setLatestSignal(data.history[0].signal);
            if (data.history[0].dispatch_result) {
              setLatestDispatch(data.history[0].dispatch_result);
            }
          }
        }
      }
    } catch (e) {
      console.warn("Could not fetch Jev history", e);
    }
  };

  const fetchLiveTelemetry = async (targetSymbol: string) => {
    try {
      const encoded = encodeURIComponent(targetSymbol);
      const res = await fetch(`/api/jev/live-state/${encoded}`);
      if (res.ok) {
        const data: MarketState = await res.json();
        setBidAskSpread(data.bid_ask_spread);
        setOrderBookImbalance(data.order_book_imbalance);
        setDeltaVof(data.delta_vof);
        setRecentAtr(data.recent_volatility_atr);
        setMicroPriceTrend(data.micro_price_trend);
      }
    } catch (e) {
      console.warn("Failed to fetch live state", e);
    }
  };

  const handleEvaluate = async () => {
    setIsEvaluating(true);
    setFeedbackMsg(null);
    setLatestDispatch(null);

    const currentState: MarketState = {
      timestamp: Date.now(),
      symbol,
      bid_ask_spread: Number(bidAskSpread),
      order_book_imbalance: Number(orderBookImbalance),
      delta_vof: Number(deltaVof),
      recent_volatility_atr: Number(recentAtr),
      micro_price_trend: microPriceTrend,
    };

    try {
      const res = await fetch("/api/jev/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: currentState,
          symbol,
          autoDispatch,
          paperMode,
          volume: orderVolume,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Evaluation failed (${res.status}): ${errText}`);
      }

      const data = await res.json();
      setLatestSignal(data.signal);
      if (data.dispatchResult) {
        setLatestDispatch(data.dispatchResult);
      }

      fetchHistory();

      if (data.signal.executable_action) {
        setFeedbackMsg({
          type: "success",
          text: `Signal Approved! ${data.signal.signal.toUpperCase()} with Urgency ${data.signal.urgency_score} (SpreadSafe: ${(data.signal.spread_safe_probability * 100).toFixed(1)}%).`,
        });
      } else {
        setFeedbackMsg({
          type: "info",
          text: `Risk Gating: Order blocked (${data.signal.gating.reasons.join(", ")}).`,
        });
      }
    } catch (err: any) {
      setFeedbackMsg({
        type: "error",
        text: err.message || "Failed to evaluate Jev signal.",
      });
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleDispatchOrder = async () => {
    if (!latestSignal || !latestSignal.executable_action) return;

    setIsDispatching(true);
    setFeedbackMsg(null);

    try {
      const res = await fetch("/api/jev/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signal: latestSignal,
          paperMode,
          volume: orderVolume,
        }),
      });

      const result = await res.json();
      setLatestDispatch(result);

      if (result.success) {
        setFeedbackMsg({
          type: "success",
          text: `Order successfully dispatched to Kraken (${paperMode ? "Paper Mode" : "Live"}). ID: ${result.order_id || "N/A"}`,
        });
      } else {
        setFeedbackMsg({
          type: "error",
          text: result.message || "Kraken order execution rejected.",
        });
      }
      fetchHistory();
    } catch (err: any) {
      setFeedbackMsg({
        type: "error",
        text: `Dispatch error: ${err.message}`,
      });
    } finally {
      setIsDispatching(false);
    }
  };

  const handleCopyCli = (cmd: string) => {
    if (!cmd) return;
    navigator.clipboard.writeText(cmd);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  const applyPreset = (preset: "bullish" | "bearish" | "wide_spread" | "noise") => {
    if (preset === "bullish") {
      setSymbol("BTC/USD");
      setBidAskSpread(0.50);
      setOrderBookImbalance(0.78);
      setDeltaVof(1450);
      setRecentAtr(12.4);
      setMicroPriceTrend("upward");
    } else if (preset === "bearish") {
      setSymbol("ETH/USD");
      setBidAskSpread(0.25);
      setOrderBookImbalance(-0.84);
      setDeltaVof(-1820);
      setRecentAtr(14.8);
      setMicroPriceTrend("downward");
    } else if (preset === "wide_spread") {
      setSymbol("SOL/USD");
      setBidAskSpread(4.80);
      setOrderBookImbalance(0.72);
      setDeltaVof(1100);
      setRecentAtr(65.0);
      setMicroPriceTrend("upward");
    } else if (preset === "noise") {
      setSymbol("BTC/USD");
      setBidAskSpread(0.60);
      setOrderBookImbalance(0.05);
      setDeltaVof(40);
      setRecentAtr(8.5);
      setMicroPriceTrend("neutral");
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl relative overflow-hidden backdrop-blur-md">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shadow-inner">
                <Cpu className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                  Jev Decision Agent & Kraken CLI Bridge
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-mono bg-indigo-950 text-indigo-300 border border-indigo-700/50">
                    typesafe/jev-1.13
                  </span>
                </h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  Microstructure Decision Engine (Order Book Imbalance, VOF Delta & Spread Gating) routed directly to Kraken CLI / Paper Engine.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700 text-xs">
              <span className="text-slate-400">Execution Mode:</span>
              <button
                onClick={() => setPaperMode(true)}
                className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                  paperMode ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Paper / Validate
              </button>
              <button
                onClick={() => setPaperMode(false)}
                className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                  !paperMode ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Live Exchange
              </button>
            </div>

            <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700 text-xs">
              <span className="text-slate-400">Engine:</span>
              <span className="font-mono text-slate-300">
                {status?.configured ? "OpenRouter /api/alpha/decisions" : "Autonomous Heuristic"}
              </span>
            </div>
          </div>
        </div>

        {/* Gating Rule Summary Badges */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            Hard Safety Gating Protocol:
          </span>
          <span className="bg-slate-800/60 px-2.5 py-1 rounded border border-slate-700 font-mono text-slate-300">
            Gate 1: Spread Risk Safe &gt; 85%
          </span>
          <span className="bg-slate-800/60 px-2.5 py-1 rounded border border-slate-700 font-mono text-slate-300">
            Gate 2: Urgency Score &gt;= 2 (0-3 scale)
          </span>
          <span className="bg-slate-800/60 px-2.5 py-1 rounded border border-slate-700 font-mono text-slate-300">
            Gate 3: Direction Confidence &gt; 60%
          </span>
        </div>
      </div>

      {/* Feedback Banner */}
      <AnimatePresence>
        {feedbackMsg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`p-4 rounded-xl border flex items-center justify-between text-sm ${
              feedbackMsg.type === "success"
                ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                : feedbackMsg.type === "error"
                ? "bg-rose-950/40 border-rose-500/40 text-rose-300"
                : "bg-blue-950/40 border-blue-500/40 text-blue-300"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {feedbackMsg.type === "success" ? (
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : feedbackMsg.type === "error" ? (
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              ) : (
                <Activity className="w-5 h-5 text-blue-400 shrink-0" />
              )}
              <span>{feedbackMsg.text}</span>
            </div>
            <button
              onClick={() => setFeedbackMsg(null)}
              className="text-xs opacity-70 hover:opacity-100 underline ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Grid: Telemetry Deck on Left, Decision Matrix on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Market State Telemetry & Controls (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-200 font-semibold">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <span>Market State Microstructure</span>
              </div>
              <button
                onClick={() => fetchLiveTelemetry(symbol)}
                className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-950/50 hover:bg-indigo-900/50 px-2.5 py-1 rounded border border-indigo-800/40 transition-colors cursor-pointer"
                title="Sync from Kraken live order book"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Sync Live
              </button>
            </div>

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Quick Test Scenarios:</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => applyPreset("bullish")}
                  className="px-2.5 py-1.5 text-xs text-left rounded bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-slate-100 border border-slate-700/60 transition-colors flex items-center justify-between cursor-pointer"
                >
                  <span>🚀 Bullish Sweep</span>
                  <span className="text-[10px] text-emerald-400 font-mono">PASS</span>
                </button>
                <button
                  onClick={() => applyPreset("bearish")}
                  className="px-2.5 py-1.5 text-xs text-left rounded bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-slate-100 border border-slate-700/60 transition-colors flex items-center justify-between cursor-pointer"
                >
                  <span>🐻 Bearish Breakdown</span>
                  <span className="text-[10px] text-emerald-400 font-mono">PASS</span>
                </button>
                <button
                  onClick={() => applyPreset("wide_spread")}
                  className="px-2.5 py-1.5 text-xs text-left rounded bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-slate-100 border border-slate-700/60 transition-colors flex items-center justify-between cursor-pointer"
                >
                  <span>🛑 Wide Spread Risk</span>
                  <span className="text-[10px] text-rose-400 font-mono">GATED</span>
                </button>
                <button
                  onClick={() => applyPreset("noise")}
                  className="px-2.5 py-1.5 text-xs text-left rounded bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-slate-100 border border-slate-700/60 transition-colors flex items-center justify-between cursor-pointer"
                >
                  <span>⚖️ Equilibrium Noise</span>
                  <span className="text-[10px] text-amber-400 font-mono">WAIT</span>
                </button>
              </div>
            </div>

            {/* Symbol & Order Volume Inputs */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 font-medium block mb-1">Symbol</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                  placeholder="BTC/USD"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium block mb-1">Order Volume</label>
                <input
                  type="number"
                  step="0.001"
                  min="0.0001"
                  value={orderVolume}
                  onChange={(e) => setOrderVolume(parseFloat(e.target.value) || 0.01)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Bid/Ask Spread */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Bid-Ask Spread ($)</span>
                <span className={`font-mono font-medium ${bidAskSpread > 3 ? "text-rose-400" : "text-emerald-400"}`}>
                  ${bidAskSpread.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.05"
                max="8.0"
                step="0.05"
                value={bidAskSpread}
                onChange={(e) => setBidAskSpread(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>$0.05 (Tight)</span>
                <span>$2.00</span>
                <span>$8.00 (Wide)</span>
              </div>
            </div>

            {/* Order Book Imbalance */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Order Book Imbalance</span>
                <span
                  className={`font-mono font-medium ${
                    orderBookImbalance > 0.3
                      ? "text-emerald-400"
                      : orderBookImbalance < -0.3
                      ? "text-rose-400"
                      : "text-amber-400"
                  }`}
                >
                  {orderBookImbalance > 0 ? `+${orderBookImbalance.toFixed(2)} (Bids)` : `${orderBookImbalance.toFixed(2)} (Asks)`}
                </span>
              </div>
              <input
                type="range"
                min="-1.0"
                max="1.0"
                step="0.02"
                value={orderBookImbalance}
                onChange={(e) => setOrderBookImbalance(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span className="text-rose-500">-1.0 (Asks Heavy)</span>
                <span>0.0 (Balanced)</span>
                <span className="text-emerald-500">+1.0 (Bids Heavy)</span>
              </div>
            </div>

            {/* Delta VOF */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Volume Order Flow Delta (VOF)</span>
                <span className={`font-mono font-medium ${deltaVof > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {deltaVof > 0 ? `+${deltaVof}` : deltaVof} contracts
                </span>
              </div>
              <input
                type="range"
                min="-2500"
                max="2500"
                step="50"
                value={deltaVof}
                onChange={(e) => setDeltaVof(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>-2500</span>
                <span>0</span>
                <span>+2500</span>
              </div>
            </div>

            {/* ATR & Micro Trend */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 font-medium block mb-1">Recent ATR (Volatility)</label>
                <input
                  type="number"
                  step="0.5"
                  value={recentAtr}
                  onChange={(e) => setRecentAtr(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium block mb-1">Micro-Price Trend</label>
                <select
                  value={microPriceTrend}
                  onChange={(e) => setMicroPriceTrend(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="upward">Upward (Bullish momentum)</option>
                  <option value="downward">Downward (Bearish momentum)</option>
                  <option value="neutral">Neutral / Range</option>
                </select>
              </div>
            </div>

            {/* Evaluate Button & Auto-Dispatch Checkbox */}
            <div className="pt-2 border-t border-slate-800 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="autoDispatch"
                  checked={autoDispatch}
                  onChange={(e) => setAutoDispatch(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0"
                />
                <label htmlFor="autoDispatch" className="text-xs text-slate-300 cursor-pointer">
                  Auto-Dispatch to Kraken CLI when safety gating passes
                </label>
              </div>

              <button
                onClick={handleEvaluate}
                disabled={isEvaluating}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg shadow-lg shadow-indigo-600/20 disabled:opacity-50 transition-all cursor-pointer"
              >
                {isEvaluating ? (
                  <>
                    <RotateCw className="w-4 h-4 animate-spin" />
                    <span>Evaluating via Jev 1.13...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    <span>Evaluate Market State for Kraken Agent</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Jev Decision Output & Kraken CLI Terminal (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Signal & Probabilities Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-300 font-semibold">
                <BrainCircuit className="w-5 h-5 text-indigo-400" />
                <span>Jev Decision Signal Output</span>
              </div>
              {latestSignal && (
                <span className="text-[11px] text-slate-500 font-mono">
                  {new Date(latestSignal.timestamp).toLocaleTimeString()}
                </span>
              )}
            </div>

            {latestSignal ? (
              <div className="space-y-6">
                {/* Primary Decision Banner */}
                <div
                  className={`p-5 rounded-xl border flex items-center justify-between ${
                    latestSignal.signal === "long"
                      ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-200"
                      : latestSignal.signal === "short"
                      ? "bg-rose-950/40 border-rose-500/50 text-rose-200"
                      : "bg-slate-800/60 border-slate-700 text-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`p-3 rounded-lg ${
                        latestSignal.signal === "long"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : latestSignal.signal === "short"
                          ? "bg-rose-500/20 text-rose-400"
                          : "bg-slate-700/50 text-slate-400"
                      }`}
                    >
                      {latestSignal.signal === "long" ? (
                        <TrendingUp className="w-8 h-8" />
                      ) : latestSignal.signal === "short" ? (
                        <TrendingDown className="w-8 h-8" />
                      ) : (
                        <Clock className="w-8 h-8" />
                      )}
                    </div>
                    <div>
                      <div className="text-xs uppercase font-mono tracking-wider opacity-75">
                        Evaluated Action
                      </div>
                      <div className="text-2xl font-black font-mono tracking-wide">
                        {latestSignal.signal.toUpperCase()}
                      </div>
                      <div className="text-xs opacity-90 mt-0.5">
                        {latestSignal.executable_action
                          ? "Safe to execute on Kraken exchange."
                          : "Execution suspended: Risk gate blocked."}
                      </div>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <div className="text-xs opacity-75">Urgency Score</div>
                    <div className="text-xl font-bold flex items-center justify-end gap-1">
                      <span>{latestSignal.urgency_score}</span>
                      <span className="text-xs opacity-60">/ 3</span>
                    </div>
                    <div className="text-[11px] opacity-80">
                      {latestSignal.urgency_score === 3
                        ? "Urgent Sweep"
                        : latestSignal.urgency_score === 2
                        ? "Momentum Cross"
                        : latestSignal.urgency_score === 1
                        ? "Scalp Limit"
                        : "Noise / No Action"}
                    </div>
                  </div>
                </div>

                {/* Probabilities Distribution */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300 flex justify-between">
                    <span>Market Direction Probabilities</span>
                    <span className="text-slate-500 font-mono text-[11px]">Jev Choice Model</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">LONG</span>
                        <span className="font-mono text-emerald-400 font-bold">
                          {(latestSignal.probabilities.long * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${latestSignal.probabilities.long * 100}%` }}
                        />
                      </div>
                    </div>

                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">SHORT</span>
                        <span className="font-mono text-rose-400 font-bold">
                          {(latestSignal.probabilities.short * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-rose-500 rounded-full"
                          style={{ width: `${latestSignal.probabilities.short * 100}%` }}
                        />
                      </div>
                    </div>

                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">WAIT</span>
                        <span className="font-mono text-amber-400 font-bold">
                          {(latestSignal.probabilities.wait * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full"
                          style={{ width: `${latestSignal.probabilities.wait * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3-Point Safety Gating Checklist */}
                <div className="bg-slate-950/90 rounded-lg p-4 border border-slate-800 space-y-3">
                  <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-indigo-400" />
                      Kraken CLI Safety Gating Gatekeeper
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-mono font-bold ${
                        latestSignal.executable_action
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                      }`}
                    >
                      {latestSignal.executable_action ? "PASSED (EXECUTABLE)" : "BLOCKED (WAIT)"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                    <div
                      className={`p-2.5 rounded border flex items-start gap-2 ${
                        latestSignal.gating.spread_safe
                          ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-300"
                          : "bg-rose-950/20 border-rose-800/40 text-rose-300"
                      }`}
                    >
                      {latestSignal.gating.spread_safe ? (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold">Gate 1: Spread Safe</div>
                        <div className="text-[11px] opacity-80">
                          Prob: {(latestSignal.spread_safe_probability * 100).toFixed(1)}% (&gt; 85%)
                        </div>
                      </div>
                    </div>

                    <div
                      className={`p-2.5 rounded border flex items-start gap-2 ${
                        latestSignal.gating.urgency_sufficient
                          ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-300"
                          : "bg-rose-950/20 border-rose-800/40 text-rose-300"
                      }`}
                    >
                      {latestSignal.gating.urgency_sufficient ? (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold">Gate 2: Urgency Score</div>
                        <div className="text-[11px] opacity-80">
                          Score: {latestSignal.urgency_score} (&gt;= 2)
                        </div>
                      </div>
                    </div>

                    <div
                      className={`p-2.5 rounded border flex items-start gap-2 ${
                        latestSignal.gating.confidence_sufficient
                          ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-300"
                          : "bg-rose-950/20 border-rose-800/40 text-rose-300"
                      }`}
                    >
                      {latestSignal.gating.confidence_sufficient ? (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold">Gate 3: Direction Conf</div>
                        <div className="text-[11px] opacity-80">
                          Conf:{" "}
                          {(
                            (latestSignal.probabilities[latestSignal.signal] || 0) * 100
                          ).toFixed(1)}
                          % (&gt; 60%)
                        </div>
                      </div>
                    </div>
                  </div>

                  {latestSignal.gating.reasons.length > 0 && (
                    <div className="text-[11px] text-rose-400/90 pt-1">
                      <span className="font-semibold">Block details: </span>
                      {latestSignal.gating.reasons.join("; ")}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-500">
                <BrainCircuit className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Click "Evaluate Market State" to run Jev 1.13 decision inference.</p>
              </div>
            )}
          </div>

          {/* Kraken CLI Command & Execution Terminal */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-200 font-semibold">
                <Terminal className="w-4 h-4 text-indigo-400" />
                <span>Kraken CLI Command & Execution Bridge</span>
              </div>
              <span className="text-xs text-slate-400">
                Mode: <span className="font-mono text-amber-400">{paperMode ? "Paper / Level 2" : "Live Exchange"}</span>
              </span>
            </div>

            {/* Generated CLI Command Box */}
            <div className="relative bg-slate-950 rounded-lg p-3 font-mono text-xs border border-slate-800 text-slate-300">
              <div className="flex items-center justify-between text-slate-500 text-[10px] mb-1.5 uppercase">
                <span>CLI Command Syntax</span>
                <button
                  onClick={() => handleCopyCli(latestSignal?.execution_plan?.cli_command || "")}
                  disabled={!latestSignal?.execution_plan?.cli_command}
                  className="flex items-center gap-1 hover:text-slate-300 transition-colors cursor-pointer"
                >
                  {copiedCli ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCli ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <div className="overflow-x-auto whitespace-pre-wrap select-all text-indigo-300">
                {latestSignal?.execution_plan?.cli_command ||
                  `kraken spot orders add --pair ${symbol} --type buy --ordertype limit --volume ${orderVolume} -o json`}
              </div>
            </div>

            {/* Manual Dispatch Trigger */}
            <div className="flex items-center justify-between gap-4 pt-1">
              <div className="text-xs text-slate-400">
                {latestSignal?.executable_action ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    Signal is executable. Ready to submit order.
                  </span>
                ) : (
                  <span className="text-slate-500">
                    Order blocked by gating or signal is wait.
                  </span>
                )}
              </div>

              <button
                onClick={handleDispatchOrder}
                disabled={!latestSignal?.executable_action || isDispatching}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed shadow transition-colors cursor-pointer"
              >
                {isDispatching ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Executing via Kraken...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Dispatch via Kraken CLI / Engine</span>
                  </>
                )}
              </button>
            </div>

            {/* Dispatch Result Terminal */}
            {latestDispatch && (
              <div className="bg-slate-950 rounded-lg p-3 text-xs font-mono border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-slate-500 text-[10px] uppercase">
                  <span>Execution Response</span>
                  <span
                    className={
                      latestDispatch.status === "executed" || latestDispatch.status === "paper_simulated"
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }
                  >
                    {latestDispatch.status}
                  </span>
                </div>
                <div className="text-slate-300">{latestDispatch.message}</div>
                {latestDispatch.order_id && (
                  <div className="text-[11px] text-slate-400">Order ID: {latestDispatch.order_id}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Decision History Log Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-slate-200 font-semibold">
            <Clock className="w-4 h-4 text-indigo-400" />
            <span>Signal Decision & Kraken CLI History</span>
          </div>
          <span className="text-xs text-slate-400">Last {history.length} evaluations</span>
        </div>

        {history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 uppercase text-[10px]">
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-3">Imbalance / VOF</th>
                  <th className="py-2 px-3">Spread / ATR</th>
                  <th className="py-2 px-3">Signal</th>
                  <th className="py-2 px-3">Prob (L / S / W)</th>
                  <th className="py-2 px-3">Urgency</th>
                  <th className="py-2 px-3">Spread Safe</th>
                  <th className="py-2 px-3">Gating</th>
                  <th className="py-2 px-3">Dispatch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {history.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-3 text-slate-500">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-200">{item.market_state.symbol}</td>
                    <td className="py-2.5 px-3">
                      <span className={item.market_state.order_book_imbalance > 0 ? "text-emerald-400" : "text-rose-400"}>
                        {item.market_state.order_book_imbalance > 0 ? "+" : ""}
                        {item.market_state.order_book_imbalance.toFixed(2)}
                      </span>{" "}
                      / {item.market_state.delta_vof}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">
                      ${item.market_state.bid_ask_spread.toFixed(2)} / {item.market_state.recent_volatility_atr.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          item.signal.signal === "long"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : item.signal.signal === "short"
                            ? "bg-rose-500/20 text-rose-400"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {item.signal.signal.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">
                      {(item.signal.probabilities.long * 100).toFixed(0)}% /{" "}
                      {(item.signal.probabilities.short * 100).toFixed(0)}% /{" "}
                      {(item.signal.probabilities.wait * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-300">{item.signal.urgency_score}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={
                          item.signal.spread_safe_probability > 0.85 ? "text-emerald-400" : "text-rose-400"
                        }
                      >
                        {(item.signal.spread_safe_probability * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      {item.signal.executable_action ? (
                        <span className="text-emerald-400 flex items-center gap-1 font-bold">
                          <Check className="w-3.5 h-3.5" /> PASS
                        </span>
                      ) : (
                        <span className="text-slate-500">BLOCKED</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {item.dispatch_result ? (
                        <span className="text-emerald-400">{item.dispatch_result.status}</span>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-6 text-center text-slate-500 text-xs">
            No historical evaluations recorded yet. Run an evaluation above to record signals.
          </div>
        )}
      </div>
    </div>
  );
};

export default JevAgentBridgePanel;
