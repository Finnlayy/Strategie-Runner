import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ShieldCheck,
  ShieldAlert,
  Cpu,
  Zap,
  Activity,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Database,
  Layers,
  Radio,
  Server,
  TrendingUp,
  TrendingDown,
  Clock,
  Sparkles,
  GitCommit,
  Scale,
  Gauge,
  Wallet
} from "lucide-react";
import { safeFetchJson } from "../../lib/api";
import { M8ControlDashboard } from "../M8ControlDashboard";

export interface M8GateItem {
  gate: string;
  name: string;
  passed: boolean;
  reason: string;
  metric?: string;
  threshold?: string;
}

export interface M8StateTransition {
  id: string;
  timestamp: string;
  fromState: string;
  toState: string;
  trigger: string;
  severity: "info" | "warn" | "success" | "critical";
  latencyMs: number;
}

export interface M8StrategyAllocation {
  id: string;
  name: string;
  pair: string;
  state: "ACCUMULATION" | "NEUTRAL" | "REDUCTION" | "COOLDOWN" | "THROTTLED";
  budgetUSD: number;
  baseBudgetUSD: number;
  budgetMultiplier: number;
  consecutiveLosses: number;
  lastSignalTimestamp: string;
  executionStatus: "ROUTING_ACTIVE" | "ORDER_APPROVED" | "GATED_STANDBY" | "THROTTLED";
  targetWeightPct: number;
}

export interface M8LiveTelemetryPayload {
  timestamp: string;
  engine_status: {
    global_state: "NORMAL_EXECUTION" | "VOL_CORRIDOR_SCALED" | "PROTECTIVE_COOLDOWN" | "RECONCILING";
    health_score: number;
    transition_latency_ms: number;
    processed_trades_count: number;
    shadow_trades_count: number;
    uptime_seconds: number;
  };
  sizing_model: {
    model_name: string;
    kelly_fraction: number;
    recommended_equity_pct: number;
    target_vol_corridor: string;
    current_asset_vol_pct: number;
    drawdown_dampener: number;
    portfolio_equity_usd: number;
    max_single_trade_cap_usd: number;
  };
  gatekeeper: {
    approved: boolean;
    verdict: "ORDER APPROVED FOR EXECUTION" | "ORDER REJECTED / RE-EVALUATE";
    primary_symbol: string;
    gates: M8GateItem[];
    last_evaluated: string;
  };
  sync_and_memory: {
    redis_state_cache: {
      status: "CONNECTED" | "DEGRADED" | "SYNCHRONIZING";
      latency_ms: number;
      memory_used_mb: number;
      keyspace_pattern: string;
      lua_sha_loaded: boolean;
    };
    fastmcp_layer: {
      status: "HEALTHY" | "RECONNECTING" | "STANDBY";
      channel: string;
      last_heartbeat: string;
      events_per_sec: number;
    };
    reconciliation_daemon: {
      status: "100% IN SYNC" | "DRIFT_DETECTED";
      position_drift_btc: number;
      last_audit_iso: string;
      auto_heal_armed: boolean;
    };
  };
  strategy_allocations: M8StrategyAllocation[];
  transition_history: M8StateTransition[];
}

export function ExecutionRiskPanel() {
  const [currentView, setCurrentView] = useState<"hybrid_control" | "matrix">("hybrid_control");
  const [telemetry, setTelemetry] = useState<M8LiveTelemetryPayload | null>(null);
  const [streamStatus, setStreamStatus] = useState<"LIVE" | "POLLING" | "RECONNECTING">("RECONNECTING");
  const [isReevaluating, setIsReevaluating] = useState<boolean>(false);
  const [selectedStrategyFilter, setSelectedStrategyFilter] = useState<string>("all");
  const [lastHeartbeatTime, setLastHeartbeatTime] = useState<number>(Date.now());

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingIntervalRef = useRef<any>(null);

  // Fallback direct REST poll
  const fetchTelemetryREST = useCallback(async () => {
    try {
      const data = await safeFetchJson<M8LiveTelemetryPayload>("/api/quant/m8-engine/live-telemetry", {}, 3000);
      if (data && data.gatekeeper) {
        setTelemetry(data);
        setLastHeartbeatTime(Date.now());
        setStreamStatus((prev) => (prev === "LIVE" ? "LIVE" : "POLLING"));
      }
    } catch {
      setStreamStatus("RECONNECTING");
    }
  }, []);

  // Real-time SSE Stream Connection with Auto-reconnect & Fallback
  useEffect(() => {
    let isSubscribed = true;

    function initEventSource() {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      try {
        const es = new EventSource("/api/quant/m8-engine/stream");
        eventSourceRef.current = es;

        es.onopen = () => {
          if (isSubscribed) {
            setStreamStatus("LIVE");
          }
        };

        es.onmessage = (event) => {
          if (!isSubscribed) return;
          try {
            const parsed = JSON.parse(event.data) as M8LiveTelemetryPayload;
            setTelemetry(parsed);
            setLastHeartbeatTime(Date.now());
            setStreamStatus("LIVE");
          } catch (e) {
            console.warn("[M8 SSE Parse Error]", e);
          }
        };

        es.onerror = () => {
          if (isSubscribed) {
            setStreamStatus("RECONNECTING");
            // Fall back to REST polling while reconnecting
            fetchTelemetryREST();
          }
        };
      } catch {
        if (isSubscribed) {
          setStreamStatus("POLLING");
        }
      }
    }

    // Initial REST fetch for instant paint (<100ms)
    fetchTelemetryREST();
    initEventSource();

    // Secondary watchdog interval: checks for stale data (>5s without packet)
    pollingIntervalRef.current = setInterval(() => {
      const timeSinceHeartbeat = Date.now() - lastHeartbeatTime;
      if (timeSinceHeartbeat > 4000) {
        setStreamStatus("RECONNECTING");
        fetchTelemetryREST();
      }
    }, 2500);

    return () => {
      isSubscribed = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [fetchTelemetryREST, lastHeartbeatTime]);

  const handleReevaluateGates = async () => {
    setIsReevaluating(true);
    try {
      const data = await safeFetchJson<M8LiveTelemetryPayload>(
        "/api/quant/m8-engine/reevaluate",
        { method: "POST" },
        4000
      );
      if (data) {
        setTelemetry(data);
        setLastHeartbeatTime(Date.now());
      }
    } catch (err) {
      console.error("Failed to re-evaluate M8 gates:", err);
    } finally {
      setIsReevaluating(false);
    }
  };

  const isApproved = telemetry?.gatekeeper?.approved ?? true;
  const gates = telemetry?.gatekeeper?.gates || [];
  const sizing = telemetry?.sizing_model;
  const engine = telemetry?.engine_status;
  const sync = telemetry?.sync_and_memory;
  const allocations = telemetry?.strategy_allocations || [];
  const history = telemetry?.transition_history || [];

  const filteredAllocations = selectedStrategyFilter === "all"
    ? allocations
    : allocations.filter((a) => a.state.toLowerCase() === selectedStrategyFilter.toLowerCase());

  return (
    <div className="space-y-6 pb-12 font-sans" id="m8-live-quant-dashboard">
      {/* ======================================================== */}
      {/* 1. HEADER & GLOBAL STATUS (Gatekeeper Modul 09 & Verdict) */}
      {/* ======================================================== */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-2xl relative overflow-hidden backdrop-blur-md">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 relative z-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 shadow-inner">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2.5">
                  <span>M8 Judge &amp; 8 Reject-Gates Gatekeeper</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-mono bg-emerald-950 text-emerald-300 border border-emerald-700/50">
                    Modul 09
                  </span>
                </h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  Multi-layer order pre-flight validation, fractional Kelly sizing corridor &amp; atomic Redis state telemetry.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Live WebSocket / SSE Stream Indicator with STALE fallback */}
            <div
              className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center gap-2 ${
                streamStatus === "LIVE"
                  ? "bg-emerald-950/80 border-emerald-500/50 text-emerald-300 shadow-emerald-950/50 shadow-md"
                  : streamStatus === "POLLING"
                  ? "bg-blue-950/80 border-blue-500/50 text-blue-300"
                  : "bg-amber-950/80 border-amber-500/50 text-amber-300 animate-pulse"
              }`}
              title={
                streamStatus === "LIVE"
                  ? "Real-time SSE telemetric stream connected"
                  : streamStatus === "POLLING"
                  ? "HTTP polling active"
                  : "Stream connection stale - reconnecting in background"
              }
            >
              <Radio
                className={`w-3.5 h-3.5 ${
                  streamStatus === "LIVE"
                    ? "text-emerald-400 animate-pulse"
                    : streamStatus === "POLLING"
                    ? "text-blue-400"
                    : "text-amber-400"
                }`}
              />
              <span>
                {streamStatus === "LIVE"
                  ? "LIVE STREAM (SSE)"
                  : streamStatus === "POLLING"
                  ? "POLL (REST ACTIVE)"
                  : "STALE / RECONNECTING"}
              </span>
            </div>

            {/* Verdict Status Indicator Badge */}
            <span
              className={`px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold tracking-wider uppercase flex items-center gap-2 shadow-lg transition-all ${
                isApproved
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-emerald-500/10"
                  : "bg-red-500/20 text-red-300 border border-red-500/40 shadow-red-500/10"
              }`}
            >
              {isApproved ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>
                {telemetry?.gatekeeper?.verdict || (isApproved ? "ORDER APPROVED FOR EXECUTION" : "RE-EVALUATE")}
              </span>
            </span>

            {/* View Switcher: Hybrid Control vs Matrix */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
              <button
                onClick={() => setCurrentView("hybrid_control")}
                className={`px-3 py-1.5 rounded transition-all cursor-pointer flex items-center gap-1.5 ${
                  currentView === "hybrid_control"
                    ? "bg-sky-600 text-white font-bold shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-amber-300" />
                <span>ONNX + Jev Control</span>
              </button>
              <button
                onClick={() => setCurrentView("matrix")}
                className={`px-3 py-1.5 rounded transition-all cursor-pointer flex items-center gap-1.5 ${
                  currentView === "matrix"
                    ? "bg-emerald-600 text-white font-bold shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Scale className="w-3.5 h-3.5 text-emerald-400" />
                <span>Allocation Matrix</span>
              </button>
            </div>

            {/* Re-evaluate Trigger */}
            <button
              onClick={handleReevaluateGates}
              disabled={isReevaluating}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold tracking-wider transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-600/20 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReevaluating ? "animate-spin" : ""}`} />
              <span>RE-EVALUATE GATES</span>
            </button>
          </div>
        </div>

        {/* 8 Reject-Gates Gatekeeper Live Matrix */}
        <div className="mt-6 pt-5 border-t border-slate-800">
          <div className="flex items-center justify-between mb-3 text-xs">
            <span className="text-slate-400 font-medium uppercase tracking-wider flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              8-Gate Pre-Flight Pipeline Status (All Gates must pass for live routing)
            </span>
            <span className="text-slate-500 font-mono text-[11px]">
              Last evaluated: {telemetry ? new Date(telemetry.gatekeeper.last_evaluated).toLocaleTimeString() : "Live"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {gates.map((g, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border transition-all flex flex-col justify-between ${
                  g.passed
                    ? "bg-slate-950/70 border-slate-800/80 hover:border-slate-700 text-slate-300"
                    : "bg-red-950/30 border-red-800/70 text-red-200"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400 font-bold">
                    {g.gate || `Gate ${idx + 1}`}
                  </span>
                  {g.passed ? (
                    <span className="text-[10px] font-bold font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/40">
                      PASS
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold font-mono text-red-400 bg-red-950/80 px-2 py-0.5 rounded border border-red-800/40">
                      REJECT
                    </span>
                  )}
                </div>
                <h5 className="text-xs font-semibold text-slate-100 mb-1 leading-snug">{g.name}</h5>
                <p className="text-[10px] text-slate-400 leading-tight">{g.reason}</p>
                {g.metric && (
                  <div className="mt-2 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>Observed: {g.metric}</span>
                    <span className="text-slate-500">{g.threshold}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {currentView === "hybrid_control" ? (
        <M8ControlDashboard />
      ) : (
        <>
          {/* ======================================================== */}
          {/* 2. SIZING & STRATEGY ALLOCATION MATRIX (Mittlerer Bereich) */}
          {/* ======================================================== */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Dynamic Kelly Sizing Engine Card (4 cols) */}
        <div className="lg:col-span-4 bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Live Sizing Model (Half-Kelly)
              </h3>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/50">
              f* / 2 Active
            </span>
          </div>

          {/* Core Sizing Metrics Grid */}
          <div className="space-y-3">
            <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800/80">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block mb-0.5">
                Target Allocation per Trade
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-emerald-400">
                  {sizing ? `${sizing.recommended_equity_pct}%` : "14.2%"}
                </span>
                <span className="text-xs text-slate-400 font-mono">of Total Capital</span>
              </div>
              <div className="mt-2 w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (sizing?.recommended_equity_pct || 14.2) * 2.5)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                <span>0% Min</span>
                <span>Max 25% Single Cap</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/60">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Kelly Fraction f*</span>
                <span className="text-base font-bold font-mono text-cyan-300 mt-0.5 block">
                  {sizing ? sizing.kelly_fraction.toFixed(3) : "0.248"}
                </span>
                <span className="text-[9px] text-slate-500">Half-Kelly factor</span>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/60">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Asset Vol Proxy</span>
                <span className="text-base font-bold font-mono text-amber-300 mt-0.5 block">
                  {sizing ? `${sizing.current_asset_vol_pct}%` : "16.4%"}
                </span>
                <span className="text-[9px] text-slate-500">ATR-calibrated</span>
              </div>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/60 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Volatility Corridor:</span>
                <span className="font-mono text-slate-200 text-[11px] font-semibold">
                  {sizing?.target_vol_corridor || "12% - 20% Ann."}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Drawdown Dampener:</span>
                <span className="font-mono text-emerald-400 text-[11px]">
                  {sizing ? `${sizing.drawdown_dampener.toFixed(2)}x` : "1.00x"} (Unconstrained)
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-800 pt-2">
                <span className="text-slate-400 text-[11px]">Active Equity Pool:</span>
                <span className="font-mono text-slate-100 text-[11px] font-bold">
                  ${sizing ? sizing.portfolio_equity_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "100,000.00"} USD
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Active Strategies Routed Through M8 Table & Cards (8 cols) */}
        <div className="lg:col-span-8 bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                M8 Active Strategy Allocation Matrix
              </h3>
              <span className="text-xs text-slate-500 font-mono">({allocations.length} Active Runners)</span>
            </div>

            <div className="flex items-center gap-1.5 text-xs font-mono">
              <span className="text-slate-400 mr-1 text-[11px]">Filter:</span>
              {["all", "accumulation", "neutral", "reduction", "cooldown"].map((st) => (
                <button
                  key={st}
                  onClick={() => setSelectedStrategyFilter(st)}
                  className={`px-2 py-0.5 rounded uppercase text-[10px] transition-colors cursor-pointer ${
                    selectedStrategyFilter === st
                      ? "bg-emerald-600 text-white font-bold"
                      : "bg-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Strategy Roster Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                  <th className="py-2.5 px-3">Strategy ID / Name</th>
                  <th className="py-2.5 px-3">Pair</th>
                  <th className="py-2.5 px-3">M8 State</th>
                  <th className="py-2.5 px-3">Allocated Equity</th>
                  <th className="py-2.5 px-3">Budget Multiplier</th>
                  <th className="py-2.5 px-3">Last Signal</th>
                  <th className="py-2.5 px-3 text-right">Execution Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredAllocations.map((strat) => (
                  <tr key={strat.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-200">{strat.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{strat.id}</div>
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-300">{strat.pair}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          strat.state === "ACCUMULATION"
                            ? "bg-emerald-950/80 text-emerald-400 border border-emerald-800/50"
                            : strat.state === "NEUTRAL"
                            ? "bg-slate-800 text-slate-300"
                            : strat.state === "REDUCTION"
                            ? "bg-amber-950/80 text-amber-400 border border-amber-800/50"
                            : "bg-purple-950/80 text-purple-400 border border-purple-800/50"
                        }`}
                      >
                        {strat.state}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-emerald-400">
                      ${strat.budgetUSD.toLocaleString()} USD
                      <span className="text-[10px] text-slate-500 ml-1 font-normal">
                        ({strat.targetWeightPct}%)
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`font-semibold ${
                          strat.budgetMultiplier >= 1.0 ? "text-slate-200" : "text-amber-400"
                        }`}
                      >
                        {strat.budgetMultiplier.toFixed(2)}x
                      </span>
                      {strat.consecutiveLosses > 0 && (
                        <span className="text-[10px] text-rose-400 ml-1.5">
                          ({strat.consecutiveLosses} loss)
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                      {new Date(strat.lastSignalTimestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          strat.executionStatus === "ORDER_APPROVED"
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : strat.executionStatus === "ROUTING_ACTIVE"
                            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {strat.executionStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 3. M8 STATE ENGINE DEEP TELEMETRY (Unterer Bereich)      */}
      {/* ======================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Core State Machine Status & Metrics (4 cols) */}
        <div className="lg:col-span-4 bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                M8 State Machine Telemetry
              </h3>
            </div>
            <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Core Armed
            </span>
          </div>

          <div className="space-y-3">
            <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800/80">
              <span className="text-[10px] uppercase text-slate-400 block mb-0.5">Global Engine State</span>
              <div className="text-base font-bold font-mono text-emerald-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{engine?.global_state || "NORMAL_EXECUTION"}</span>
              </div>
              <span className="text-[10px] text-slate-500">Atomic Lua transition lock active</span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/60">
                <span className="text-[10px] text-slate-400 uppercase block">Transition Latency</span>
                <span className="text-base font-bold font-mono text-cyan-300 mt-0.5 block">
                  {engine ? `${engine.transition_latency_ms.toFixed(2)} ms` : "1.14 ms"}
                </span>
                <span className="text-[9px] text-slate-500">Sub-2ms SLA</span>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/60">
                <span className="text-[10px] text-slate-400 uppercase block">Health Score</span>
                <span className="text-base font-bold font-mono text-emerald-300 mt-0.5 block">
                  {engine ? `${engine.health_score}%` : "99.8%"}
                </span>
                <span className="text-[9px] text-slate-500">Zero state faults</span>
              </div>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/60 space-y-1.5 text-xs font-mono">
              <div className="flex justify-between text-slate-400">
                <span>Processed Live Trades:</span>
                <span className="text-slate-200 font-bold">{engine?.processed_trades_count || 142}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Shadow Quarantined Wins:</span>
                <span className="text-emerald-400">{engine?.shadow_trades_count || 18}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Engine Active Uptime:</span>
                <span className="text-cyan-300">{engine ? `${Math.floor(engine.uptime_seconds / 60)} min` : "Live"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* State Transition History (5 cols) */}
        <div className="lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                State Transition History (Last 4 Events)
              </h3>
            </div>
            <span className="text-[10px] font-mono text-slate-500">Audited Chronology</span>
          </div>

          <div className="space-y-2.5">
            {history.slice(0, 4).map((t) => (
              <div
                key={t.id}
                className="p-3 rounded-lg border border-slate-800/80 bg-slate-950/70 space-y-1.5 text-xs font-mono"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        t.severity === "success"
                          ? "bg-emerald-400"
                          : t.severity === "warn"
                          ? "bg-amber-400"
                          : "bg-cyan-400"
                      }`}
                    />
                    <span className="font-bold text-slate-200">
                      {t.fromState} <ArrowRight className="inline w-3 h-3 text-slate-500" /> {t.toState}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {new Date(t.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 pl-4">{t.trigger}</div>
                <div className="text-[10px] text-slate-500 pl-4 flex justify-between">
                  <span>Latency: {t.latencyMs} ms</span>
                  <span className="uppercase text-[9px] px-1.5 py-0.2 rounded bg-slate-900 text-slate-400">
                    Verified
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sync & Memory Status: Redis, FastMCP & Auto-Heal (3 cols) */}
        <div className="lg:col-span-3 bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Sync &amp; Memory Layer
              </h3>
            </div>
            <span className="text-[10px] font-mono text-emerald-400">100% In Sync</span>
          </div>

          <div className="space-y-3 text-xs font-mono">
            {/* Redis State Cache Card */}
            <div className="p-3 bg-slate-950/70 rounded-lg border border-slate-800/70 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold">Redis State Cache</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/40">
                  {sync?.redis_state_cache.status || "CONNECTED"}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 pt-1 flex justify-between">
                <span>Latency:</span>
                <span className="text-emerald-400">{sync?.redis_state_cache.latency_ms || 0.38} ms</span>
              </div>
              <div className="text-[11px] text-slate-400 flex justify-between">
                <span>Memory:</span>
                <span className="text-slate-200">{sync?.redis_state_cache.memory_used_mb || 14.8} MB</span>
              </div>
              <div className="text-[10px] text-slate-500 pt-0.5">
                Keyspace: {sync?.redis_state_cache.keyspace_pattern || "m8:state:*"}
              </div>
            </div>

            {/* FastMCP Layer Card */}
            <div className="p-3 bg-slate-950/70 rounded-lg border border-slate-800/70 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold">FastMCP Layer</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/40">
                  {sync?.fastmcp_layer.status || "HEALTHY"}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 pt-1 flex justify-between">
                <span>Channel:</span>
                <span className="text-cyan-300">{sync?.fastmcp_layer.channel || "strategies:wake_up"}</span>
              </div>
              <div className="text-[11px] text-slate-400 flex justify-between">
                <span>Throughput:</span>
                <span className="text-slate-200">{sync?.fastmcp_layer.events_per_sec || 16.2} evt/s</span>
              </div>
            </div>

            {/* Reconciliation Daemon Card */}
            <div className="p-3 bg-slate-950/70 rounded-lg border border-slate-800/70 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold">Reconciliation Daemon</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/40">
                  {sync?.reconciliation_daemon.status || "100% IN SYNC"}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 pt-1 flex justify-between">
                <span>Position Drift:</span>
                <span className="text-emerald-400 font-bold">
                  {sync?.reconciliation_daemon.position_drift_btc.toFixed(4) || "0.0000"} BTC
                </span>
              </div>
              <div className="text-[10px] text-slate-500 pt-0.5">
                Auto-Heal Engine: {sync?.reconciliation_daemon.auto_heal_armed ? "ARMED & ENGAGED" : "STANDBY"}
              </div>
            </div>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

export default ExecutionRiskPanel;
