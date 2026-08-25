import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Terminal as TerminalIcon, Cpu, ShieldAlert, BarChart2, Zap, 
  HelpCircle, ChevronDown, ListFilter, Play, Square, LayoutDashboard,
  Code2, Sliders, ArrowRight, Radio, Activity, ExternalLink, ShieldCheck,
  TrendingUp, TrendingDown, DollarSign, BarChart3, History, Dna, Layers,
  Wallet, FileSpreadsheet, Database, Archive, ArchiveRestore, GitCommit, Calculator,
  Coins, ArrowUpRight
} from "lucide-react";

import { TradingStrategy, MarketTicker, ExecutionLog, TradeOrder, RunnerMetrics, StrategyPnL, QueueMatrixData, formatTimeframe } from "./types";
import { getLedgerCurrency, getCurrencySymbol } from "./lib/symbolNormalizer";
import { safeFetchJson, DashboardInitResponse } from "./lib/api";
import MetricsPanel from "./components/MetricsPanel";
import TerminalPanel from "./components/TerminalPanel";
import StrategyEditor from "./components/StrategyEditor";
import AIReviewer from "./components/AIReviewer";
import MarketPanel from "./components/MarketPanel";
import { BacktestingPanel } from "./components/BacktestingPanel";
import { GeneticOptimizerPanel } from "./components/GeneticOptimizerPanel";
import QueueMatrixPanel from "./components/QueueMatrixPanel";
import KrakenLedgersPanel from "./components/KrakenLedgersPanel";
import { DataLakePanel } from "./components/DataLakePanel";
import { SystemHealthPanel } from "./components/quant/SystemHealthPanel";
import { QuantitativeRegimePanel } from "./components/quant/QuantitativeRegimePanel";
import { ExecutionRiskPanel } from "./components/quant/ExecutionRiskPanel";
import { AcademyRegistryPanel } from "./components/quant/AcademyRegistryPanel";

export default function App() {
  // Page Navigation State: 'overview' | 'health' | 'regime' | 'execution' | 'academy' | 'orchestrator' | 'backtesting' | 'genetic' | 'queues' | 'ledgers' | 'datalake'
  const [activePage, setActivePage] = useState<'overview' | 'health' | 'regime' | 'execution' | 'academy' | 'orchestrator' | 'backtesting' | 'genetic' | 'queues' | 'ledgers' | 'datalake'>('overview');

  const [strategies, setStrategies] = useState<TradingStrategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<TradingStrategy | null>(null);
  const [tickers, setTickers] = useState<MarketTicker[]>([]);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [metrics, setMetrics] = useState<RunnerMetrics | null>(null);
  const [balances, setBalances] = useState<Record<string, number> | null>(null);
  const [strategyPnL, setStrategyPnL] = useState<StrategyPnL[]>([]);
  const [queueMatrices, setQueueMatrices] = useState<{ paper: QueueMatrixData; live: QueueMatrixData } | null>(null);
  const [isPaperTrading, setIsPaperTrading] = useState<boolean>(true);
  const [hasKrakenKeys, setHasKrakenKeys] = useState<boolean>(false);
  const [isTogglingMode, setIsTogglingMode] = useState<boolean>(false);
  
  // Historical portfolio values for charting
  const [portfolioHistory, setPortfolioHistory] = useState<{ time: string; balance: number }[]>([]);

  // AI Reviewer insertion bridge ref/state
  const [aiGeneratedToInsert, setAiGeneratedToInsert] = useState<any>(null);

  // Strategy Manifest List Filter in Orchestrator: 'active' | 'archived'
  const [manifestFilter, setManifestFilter] = useState<'active' | 'archived'>('active');
  const [showQuickStatBaselineTooltip, setShowQuickStatBaselineTooltip] = useState(false);

  // Active pair and ledger currency resolution
  const activePair = selectedStrategy?.assetPair || (strategies.length > 0 ? strategies[0].assetPair : "BTC/USD");
  const activeCurrency = useMemo(() => getLedgerCurrency(activePair), [activePair]);

  // Fast Non-Blocking Dashboard Initialization & Polling
  useEffect(() => {
    // 1. Ultra-fast initial metadata (<100ms)
    fetchDashboardInit();

    // 2. Parallel non-blocking initial data fetch
    fetchStrategies();
    fetchTickers();
    fetchLogsAndMetrics();
    fetchQueueMatrices();
    fetchKrakenStatus();

    // 3. Resilient background polling (throttled when tab is hidden)
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      fetchTickers();
      fetchLogsAndMetrics();
      fetchQueueMatrices();
      fetchKrakenStatus();
    }, 6000);

    return () => clearInterval(interval);
  }, []);

  const fetchDashboardInit = async () => {
    const data = await safeFetchJson<DashboardInitResponse>("/api/dashboard/init");
    if (data) {
      setIsPaperTrading(data.isPaperTrading);
      setHasKrakenKeys(data.hasCredentials);
    }
  };

  const fetchKrakenStatus = async () => {
    const data = await safeFetchJson<{
      connected: boolean;
      hasCredentials: boolean;
      paperTrading: boolean;
      mode: string;
    }>("/api/kraken/status");
    if (data) {
      setIsPaperTrading(data.paperTrading);
      setHasKrakenKeys(data.hasCredentials);
    }
  };

  const fetchQueueMatrices = async () => {
    const data = await safeFetchJson<{
      paper: QueueMatrixData;
      live: QueueMatrixData;
    }>("/api/queue-matrices");
    if (data) {
      setQueueMatrices(data);
    }
  };

  const handleTogglePaperTrading = async (newVal: boolean) => {
    setIsTogglingMode(true);
    try {
      const res = await fetch("/api/kraken/toggle-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperTrading: newVal })
      });
      if (res.ok) {
        const data = await res.json();
        setIsPaperTrading(data.paperTrading);
      }
    } catch (err) {
      console.error("Failed to toggle trading mode:", err);
    } finally {
      setIsTogglingMode(false);
    }
  };

  // Sync historical chart balance on update
  useEffect(() => {
    if (metrics) {
      const timeStr = new Date().toLocaleTimeString(undefined, { hour12: false });
      setPortfolioHistory(prev => {
        const next = [...prev, { time: timeStr, balance: (metrics as any).portfolioUSD || 0 }];
        if (next.length > 20) next.shift(); // Keep last 20 ticks
        return next;
      });
    }
  }, [metrics]);

  const fetchStrategies = async () => {
    const data = await safeFetchJson<TradingStrategy[]>("/api/strategies");
    if (data) {
      setStrategies(data);
      setSelectedStrategy(prev => {
        if (!prev && data.length > 0) return data[0];
        if (prev) {
          const matched = data.find(s => s.id === prev.id);
          return matched || prev;
        }
        return null;
      });
    }
  };

  const fetchTickers = async () => {
    const data = await safeFetchJson<MarketTicker[]>("/api/market-data");
    if (data) {
      setTickers(data);
    }
  };

  const fetchLogsAndMetrics = async () => {
    const data = await safeFetchJson<{
      logs: ExecutionLog[];
      metrics: RunnerMetrics;
      orders: TradeOrder[];
      balances: Record<string, number>;
      strategyPnL?: StrategyPnL[];
    }>("/api/logs");

    if (data) {
      setLogs(data.logs || []);
      setMetrics(data.metrics || null);
      setOrders(data.orders || []);
      setBalances(data.balances || null);
      if (data.strategyPnL) {
        setStrategyPnL(data.strategyPnL);
      }
    }
  };

  // ACTIONS
  const handleUpdateStrategy = async (id: string, updates: Partial<TradingStrategy>) => {
    try {
      const res = await fetch(`/api/strategies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      if (!res.ok) {
        const text = await res.text();
        let errorMsg = `Server error (${res.status})`;
        try {
          const parsed = JSON.parse(text);
          if (parsed.error) errorMsg = parsed.error;
        } catch {}
        console.error("Error updating strategy:", errorMsg);
        return;
      }
      const updated = await res.json();
      setStrategies(prev => prev.map(s => s.id === id ? updated : s));
      if (selectedStrategy?.id === id) {
        setSelectedStrategy(updated);
      }
    } catch (err) {
      console.error("Error updating strategy:", err);
    }
  };

  const handleCreateStrategy = async (strategy: Partial<TradingStrategy>) => {
    try {
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(strategy)
      });
      if (!res.ok) {
        const text = await res.text();
        let errorMsg = `Server error (${res.status})`;
        try {
          const parsed = JSON.parse(text);
          if (parsed.error) errorMsg = parsed.error;
        } catch {}
        console.error("Error creating strategy:", errorMsg);
        return;
      }
      const created = await res.json();
      setStrategies(prev => [...prev, created]);
      setSelectedStrategy(created);
      fetchLogsAndMetrics();
    } catch (err) {
      console.error("Error creating strategy:", err);
    }
  };

  const handleDeleteStrategy = async (id: string) => {
    try {
      const res = await fetch(`/api/strategies/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setStrategies(prev => prev.filter(s => s.id !== id));
      setSelectedStrategy(prev => prev?.id === id ? null : prev);
      fetchLogsAndMetrics();
    } catch (err) {
      console.error("Error deleting strategy:", err);
    }
  };

  const handleArchiveStrategy = async (id: string) => {
    try {
      const res = await fetch(`/api/strategies/${id}/archive`, { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      setStrategies(prev => prev.map(s => s.id === id ? data.strategy : s));
      if (selectedStrategy?.id === id) {
        setSelectedStrategy(data.strategy);
      }
      fetchLogsAndMetrics();
    } catch (err) {
      console.error("Error archiving strategy:", err);
    }
  };

  const handleRestoreStrategy = async (id: string) => {
    try {
      const res = await fetch(`/api/strategies/${id}/restore`, { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      setStrategies(prev => prev.map(s => s.id === id ? data.strategy : s));
      if (selectedStrategy?.id === id) {
        setSelectedStrategy(data.strategy);
      }
      fetchLogsAndMetrics();
    } catch (err) {
      console.error("Error restoring strategy:", err);
    }
  };

  const handleToggleRun = async (id: string, action: 'start' | 'stop', mode?: 'paper' | 'live') => {
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, mode })
      });
      if (!res.ok) return;
      const updated = await res.json();
      setStrategies(prev => prev.map(s => s.id === id ? updated : s));
      if (selectedStrategy?.id === id) {
        setSelectedStrategy(updated);
      }
      fetchLogsAndMetrics();
    } catch (err) {
      console.error("Error toggling strategy run:", err);
    }
  };

  const handleSendCommand = async (command: string): Promise<string> => {
    try {
      const res = await fetch("/api/cli-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command })
      });
      if (!res.ok) {
        const text = await res.text();
        return `CLI Error: ${text}`;
      }
      const data = await res.json();
      
      // Parse special response keys to bridge UI
      if (data.reply && data.reply.startsWith("PENDING_AI_GENERATION:")) {
        const promptText = data.reply.split("PENDING_AI_GENERATION:")[1];
        setAiGeneratedToInsert(promptText);
        fetchLogsAndMetrics();
        return "Broadcasting prompt instruction to quantitative copilot thread...";
      }

      fetchLogsAndMetrics();
      fetchStrategies();
      return data.reply || "";
    } catch (err) {
      console.error("Error sending command:", err);
      return "CLI connection pipeline failed.";
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  const handleResetHistory = () => {
    setOrders([]);
    setPortfolioHistory([]);
    fetchLogsAndMetrics();
    fetchStrategies();
  };

  return (
    <div id="application-container" className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* 1. Global Navigation Header with Page Tabs */}
      <header className="bg-zinc-900 border-b border-zinc-800 px-6 py-3 flex items-center justify-between flex-wrap gap-4 select-none shrink-0 sticky top-0 z-30">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            <div className="bg-emerald-500/15 border border-emerald-500/35 p-2 rounded-lg">
              <Cpu className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-base font-semibold tracking-tight text-white font-mono">Remix: Kraken Runner</h1>
                <span className="bg-zinc-850 text-zinc-400 border border-zinc-800 text-[10px] px-1.5 py-0.5 rounded font-mono font-bold tracking-widest">
                  CLI-PRO
                </span>
              </div>
              <p className="text-xs text-zinc-400 hidden sm:block">Headless trading algorithm orchestrator for decentralized markets</p>
            </div>
          </div>

          {/* Primary View Switcher Tabs */}
          <nav className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800/80 shadow-inner flex-wrap gap-1">
            <button
              id="nav-tab-overview"
              onClick={() => setActivePage('overview')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                activePage === 'overview'
                  ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5 text-emerald-400" />
              <span>Overview</span>
            </button>

            <button
              id="nav-tab-health"
              onClick={() => setActivePage('health')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                activePage === 'health'
                  ? 'bg-blue-950/80 text-blue-300 shadow-sm border border-blue-600/70 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
              }`}
            >
              <Radio className="w-3.5 h-3.5 text-blue-400" />
              <span>System Health</span>
              <span className="bg-blue-900/60 text-blue-300 text-[9px] px-1.5 py-0.2 rounded font-bold uppercase">
                SSE M00-17
              </span>
            </button>

            <button
              id="nav-tab-regime"
              onClick={() => setActivePage('regime')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                activePage === 'regime'
                  ? 'bg-indigo-950/80 text-indigo-300 shadow-sm border border-indigo-600/70 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              <span>Regimes &amp; DFA</span>
              <span className="bg-indigo-900/60 text-indigo-300 text-[9px] px-1.5 py-0.2 rounded font-bold uppercase">
                M03/10/14
              </span>
            </button>

            <button
              id="nav-tab-execution"
              onClick={() => setActivePage('execution')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                activePage === 'execution'
                  ? 'bg-emerald-950/80 text-emerald-300 shadow-sm border border-emerald-600/70 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>M8 Execution &amp; Risk</span>
              <span className="bg-emerald-900/60 text-emerald-300 text-[9px] px-1.5 py-0.2 rounded font-bold uppercase">
                Kelly
              </span>
            </button>

            <button
              id="nav-tab-academy"
              onClick={() => setActivePage('academy')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                activePage === 'academy'
                  ? 'bg-purple-950/80 text-purple-300 shadow-sm border border-purple-600/70 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 text-purple-400" />
              <span>Academy &amp; Drills</span>
              <span className="bg-purple-900/60 text-purple-300 text-[9px] px-1.5 py-0.2 rounded font-bold uppercase">
                85/100
              </span>
            </button>

            <button
              id="nav-tab-orchestrator"
              onClick={() => setActivePage('orchestrator')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                activePage === 'orchestrator'
                  ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
              }`}
            >
              <Code2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Orchestrator</span>
              {metrics?.activeWorkers ? (
                <span className="bg-emerald-950/90 border border-emerald-700/80 text-emerald-300 text-[10px] px-2 py-0.5 rounded-full font-bold shadow-[0_0_6px_rgba(16,185,129,0.3)] flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{metrics.activeWorkers} active</span>
                </span>
              ) : (
                <span className="bg-zinc-800/90 text-zinc-300 border border-zinc-700/60 text-[10px] px-2 py-0.5 rounded-full font-mono font-medium">
                  {strategies.length}
                </span>
              )}
            </button>

            <button
              id="nav-tab-backtesting"
              onClick={() => setActivePage('backtesting')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                activePage === 'backtesting'
                  ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Strategy Backtesting</span>
              <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider">
                OHLC
              </span>
            </button>

            <button
              id="nav-tab-genetic-optimizer"
              onClick={() => setActivePage('genetic')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                activePage === 'genetic'
                  ? 'bg-purple-950/60 text-purple-300 shadow-sm border border-purple-700/80 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
              }`}
            >
              <Dna className="w-3.5 h-3.5 text-purple-400" />
              <span>Genetic Optimizer</span>
              <span className="bg-purple-900/70 text-purple-300 border border-purple-700/60 text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider">
                WFO-30/50
              </span>
            </button>

            <button
              id="nav-tab-queue-matrices"
              onClick={() => setActivePage('queues')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                activePage === 'queues'
                  ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Queue Matrices</span>
              <span className="bg-amber-950/80 text-amber-300 border border-amber-800/60 text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider">
                L2 &amp; L4
              </span>
            </button>

            <button
              id="nav-tab-ledgers"
              onClick={() => setActivePage('ledgers')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                activePage === 'ledgers'
                  ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Position Ledgers</span>
              <span className="bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider">
                Spot &amp; Pro
              </span>
            </button>

            <button
              id="nav-tab-datalake"
              onClick={() => setActivePage('datalake')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
                activePage === 'datalake'
                  ? 'bg-cyan-950/70 text-cyan-300 shadow-sm border border-cyan-700/80 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
              }`}
            >
              <Database className="w-3.5 h-3.5 text-cyan-400" />
              <span>OHLCV Data Lake</span>
              <span className="bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider">
                Parquet &amp; DuckDB
              </span>
            </button>
          </nav>
        </div>

        {/* Global telemetry stats & Queue Status in header */}
        <div className="flex items-center space-x-4 sm:space-x-5">
          {/* Strategy Queue Status Badge - Pure Isolated Queue Display */}
          <div id="strategy-queue-indicator" className="flex items-center bg-zinc-900/90 border border-zinc-800/90 rounded-lg px-3 py-1.5 space-x-2.5 shadow-sm">
            <div className="flex flex-col text-left">
              <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest leading-none">Strategy Execution Queues</span>
              <div className="flex items-center space-x-2 mt-1">
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/50">
                  L2 PAPER ({strategies.filter(s => (s.executionMode || 'paper') === 'paper').length})
                </span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/50">
                  L4 LIVE ({strategies.filter(s => s.executionMode === 'live').length})
                </span>
              </div>
            </div>
          </div>

          {/* Engine Pipeline Status */}
          <div className="hidden md:block text-right border-l border-zinc-800 pl-4">
            <span className="block text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Engine Pipeline</span>
            <span className="text-xs font-mono font-semibold text-emerald-400 flex items-center justify-end mt-0.5">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-ping mr-2" />
              CL-ACTIVE (production)
            </span>
          </div>

          <div className="text-right border-l border-zinc-800 pl-4">
            <span className="block text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Latency</span>
            <span className="text-xs font-mono font-semibold text-zinc-300 mt-0.5">
              {metrics?.latencyMs || 14}ms
            </span>
          </div>
        </div>
      </header>

      {/* 2. Main Body Content Switcher with Animation */}
      <main className="flex-1 overflow-y-auto p-5 sm:p-6">
        <AnimatePresence mode="wait">
          {activePage === 'overview' ? (
            /* ======================================================== */
            /* PAGE 1: OVERVIEW & TELEMETRY DASHBOARD                   */
            /* ======================================================== */
            <motion.div
              key="overview-page"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="space-y-5 max-w-7xl mx-auto"
            >
              {/* Top Quick Stats Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Portfolio Quick Stat */}
                <div id="portfolio-quickstat-card" className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg shadow-sm relative overflow-visible">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block">
                          {isPaperTrading ? 'Paper Portfolio' : 'Kraken Pro Portfolio'}
                        </span>

                        {/* Dynamic Baseline Tag with Active Ledger Currency */}
                        <div id="portfolio-dynamic-baseline-tag" className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-700/60 shadow-xs">
                          <span className="text-amber-500 font-normal">Baseline:</span>
                          <span className="text-amber-200">{activeCurrency.symbol}{((metrics?.baselineUSD ?? (isPaperTrading ? 190412.50 : (metrics?.portfolioUSD || 0)))).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                          <span className="text-[9px] text-amber-400/80 uppercase">{activeCurrency.quote}</span>
                        </div>

                        {/* Tooltip button */}
                        <div className="relative inline-block">
                          <button
                            id="portfolio-baseline-tooltip-btn"
                            type="button"
                            onClick={() => setShowQuickStatBaselineTooltip(!showQuickStatBaselineTooltip)}
                            onMouseEnter={() => setShowQuickStatBaselineTooltip(true)}
                            onMouseLeave={() => setShowQuickStatBaselineTooltip(false)}
                            className="text-zinc-500 hover:text-emerald-400 p-0.5 rounded transition-colors cursor-pointer"
                            title="View Baseline Capital & Return Calculation Breakdown"
                          >
                            <HelpCircle className="w-3.5 h-3.5" />
                          </button>

                          {/* Baseline Info Popup - Perfectly Aligned with Asset Pair */}
                          {showQuickStatBaselineTooltip && (
                            <div 
                              id="portfolio-baseline-tooltip-popup"
                              className="absolute right-0 sm:right-auto sm:left-0 top-6 z-50 w-72 sm:w-84 max-w-[calc(100vw-2rem)] p-3.5 bg-zinc-950/95 backdrop-blur-md border border-zinc-700 rounded-lg shadow-2xl text-[11px] font-mono text-zinc-300 space-y-2.5 pointer-events-none text-left"
                              style={{ filter: "drop-shadow(0 12px 28px rgba(0,0,0,0.85))" }}
                            >
                              <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 text-white font-bold">
                                <div className="flex items-center space-x-1.5 text-emerald-400">
                                  <Calculator className="w-3.5 h-3.5" />
                                  <span>Baseline Capital Breakdown</span>
                                </div>
                                <span className="text-[10px] text-zinc-500 uppercase">{isPaperTrading ? 'Paper Basket' : 'Live Sync'}</span>
                              </div>

                              {/* Asset Pair Alignment Badge */}
                              <div className="flex items-center justify-between bg-zinc-900/90 border border-zinc-800 rounded p-2 text-[10px]">
                                <div>
                                  <span className="text-zinc-500 block uppercase text-[9px]">Active Asset Pair</span>
                                  <span className="font-bold text-white text-xs">{activeCurrency.pair}</span>
                                </div>
                                <div className="text-right">
                                  <span className="text-zinc-500 block uppercase text-[9px]">Ledger Currency</span>
                                  <span className="font-bold text-cyan-400 text-xs">{activeCurrency.quote} ({activeCurrency.symbol})</span>
                                </div>
                              </div>

                              <div className="space-y-1.5 text-[10px]">
                                <div className="flex justify-between items-center">
                                  <span className="text-zinc-400">Baseline Reference ({activeCurrency.quote}):</span>
                                  <span className="font-bold text-amber-300">
                                    {activeCurrency.symbol}{((metrics?.baselineUSD ?? (isPaperTrading ? 190412.50 : (metrics?.portfolioUSD || 0)))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {activeCurrency.quote}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-zinc-400">Current Valuation:</span>
                                  <span className="font-bold text-white">
                                    {activeCurrency.symbol}{((metrics?.portfolioUSD || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {activeCurrency.quote}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center pt-1 border-t border-zinc-800/80">
                                  <span className="text-zinc-400">P&L Return:</span>
                                  <span className={`font-bold ${(metrics?.profitLossPercentage ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {(metrics?.profitLossPercentage ?? 0) >= 0 ? '+' : ''}{metrics?.profitLossPercentage ?? 0}%
                                  </span>
                                </div>
                              </div>

                              {isPaperTrading ? (
                                <div className="p-2 rounded bg-zinc-900/90 border border-zinc-800/80 text-[10px] text-zinc-400 space-y-1">
                                  <div className="flex items-center justify-between text-zinc-300 font-bold">
                                    <span>Paper Initial Basket:</span>
                                    <span className="text-[9px] text-zinc-500">{activeCurrency.pair} Context</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-2 text-[9px] text-zinc-400">
                                    <span>• {activeCurrency.symbol}50,000 {activeCurrency.quote}</span>
                                    <span>• 1.500 BTC</span>
                                    <span>• 10.00 ETH</span>
                                    <span>• 100.0 SOL</span>
                                    <span>• 5,000 XRP</span>
                                  </div>
                                  <span className="text-[9px] text-zinc-500 block pt-0.5">Initial Seed Baseline = {activeCurrency.symbol}190,412.50 {activeCurrency.quote}</span>
                                </div>
                              ) : (
                                <div className="p-2 rounded bg-zinc-900/90 border border-zinc-800/80 text-[10px] text-zinc-400">
                                  <span className="text-zinc-300 font-bold block">Kraken Pro Live Sync ({activeCurrency.quote}):</span>
                                  <p className="text-[9px] text-zinc-400 mt-0.5">
                                    Baseline is locked to total synchronized asset equity in {activeCurrency.quote} ledger.
                                  </p>
                                </div>
                              )}

                              <div className="text-[9px] text-zinc-500 pt-1 border-t border-zinc-800/60 leading-tight">
                                Formula: <code className="text-zinc-400 font-bold">((Current - Baseline) / Baseline) × 100</code>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-2xl font-mono font-bold text-white mt-1">
                        {activeCurrency.symbol}{((metrics as any)?.portfolioUSD || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className={`px-2 py-0.5 rounded text-xs font-mono flex items-center gap-1 ${
                      (metrics?.profitLossPercentage ?? 0) >= 0 
                        ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60' 
                        : 'bg-rose-950/60 text-rose-400 border border-rose-800/60'
                    }`}>
                      {(metrics?.profitLossPercentage ?? 0) >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      <span>{(metrics?.profitLossPercentage ?? 0) >= 0 ? '+' : ''}{metrics?.profitLossPercentage ?? 0}%</span>
                    </div>
                  </div>
                  <div className="text-[11px] font-mono text-zinc-500 mt-2 flex justify-between">
                    <span>{isPaperTrading ? 'Level 2 Paper Automation' : 'Level 4 Live Capital Execution'}</span>
                    <span className="text-zinc-400 font-medium">
                      Baseline: <strong className="text-amber-300 font-semibold">{activeCurrency.symbol}{((metrics?.baselineUSD ?? (isPaperTrading ? 190412.50 : (metrics?.portfolioUSD || 0)))).toLocaleString(undefined, { maximumFractionDigits: 0 })} {activeCurrency.quote}</strong>
                    </span>
                  </div>
                </div>

                {/* Active Automated Workers */}
                <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg shadow-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block">
                        Automation Workers
                      </span>
                      <div className="text-2xl font-mono font-bold text-white mt-1 flex items-baseline gap-2">
                        <span>{metrics?.activeWorkers || 0}</span>
                        <span className="text-xs font-mono text-zinc-500 font-normal">/ {strategies.length} active</span>
                      </div>
                    </div>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.6)] mt-1" />
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400 mt-2 flex justify-between">
                    <span className="text-amber-400 font-semibold">{metrics?.paperWorkers ?? 0} Paper (L2)</span>
                    <span className="text-rose-400 font-semibold">{metrics?.liveWorkers ?? 0} Live (L4)</span>
                    <span className="text-zinc-500">CPU: {metrics?.cpuUsage || 0}%</span>
                  </div>
                </div>

                {/* Top P&L Strategy */}
                <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg shadow-sm">
                  <div>
                    <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block">
                      Top Performance Strategy
                    </span>
                    {strategyPnL.length > 0 ? (
                      (() => {
                        const topStrat = [...strategyPnL].sort((a, b) => b.totalPnL - a.totalPnL)[0];
                        const isPos = topStrat.totalPnL >= 0;
                        return (
                          <div className="mt-1">
                            <div className="flex justify-between items-baseline">
                              <span className="text-sm font-mono font-bold text-white truncate max-w-[140px]">
                                {topStrat.strategyName}
                              </span>
                              <span className={`text-base font-mono font-bold ${isPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {isPos ? '+' : ''}${topStrat.totalPnL.toFixed(2)}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-zinc-500 mt-2 flex justify-between">
                              <span>Win Rate: {topStrat.winRate}%</span>
                              <span>Vol: ${topStrat.volumeTradedUSD.toLocaleString()}</span>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="text-sm font-mono text-zinc-500 mt-1">No execution history yet</div>
                    )}
                  </div>
                </div>

                {/* Fast Orchestrator Action Card */}
                <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 p-4 rounded-lg shadow-sm flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block">
                      Algorithmic Hub
                    </span>
                    <p className="text-xs text-zinc-300 mt-1 font-mono">
                      Edit strategy logic, adjust Hard Stop limits &amp; consult AI Copilot.
                    </p>
                  </div>
                  <button
                    onClick={() => setActivePage('orchestrator')}
                    className="mt-3 w-full bg-emerald-600 hover:bg-emerald-500 text-zinc-950 hover:text-black font-mono font-bold text-xs py-1.5 px-3 rounded flex items-center justify-center space-x-1.5 transition-all shadow-sm"
                  >
                    <span>Open Strategy Orchestrator</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Main Dashboard Bento Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* LEFT COLUMN: Telemetry, 1H P&L Chart & Market Books (7/12) */}
                <div className="lg:col-span-7 space-y-5">
                  {/* Visualizer & Historical P&L Panel */}
                  <MetricsPanel 
                    metrics={metrics} 
                    balances={balances} 
                    strategies={strategies}
                    strategyPnL={strategyPnL}
                    selectedStrategy={selectedStrategy}
                    queueMatrices={queueMatrices}
                    tickers={tickers}
                    onOpenQueueMatrixPage={() => setActivePage('queues')}
                    onOpenLedgersPage={() => setActivePage('ledgers')}
                    onSelectStrategy={(stratId) => {
                      const found = strategies.find(s => s.id === stratId);
                      if (found) setSelectedStrategy(found);
                    }}
                  />

                  {/* Public Tickers & Recent Executed Trades */}
                  <MarketPanel 
                    tickers={tickers} 
                    orders={orders}
                    portfolioHistory={portfolioHistory}
                    onResetHistory={handleResetHistory}
                  />
                </div>

                {/* RIGHT COLUMN: Strategy Roster Overview & Live CLI Console (5/12) */}
                <div className="lg:col-span-5 space-y-5 flex flex-col">
                  {/* Strategy Overview Roster Card */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col">
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-3">
                      <div className="flex items-center space-x-2">
                        <ListFilter className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                          Deployed Strategies Overview
                        </span>
                      </div>
                      <button
                        onClick={() => setActivePage('orchestrator')}
                        className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center space-x-1"
                      >
                        <span>Manage all</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      {strategies.filter(s => s.status !== 'archived').map((strat) => {
                        const isActive = strat.status === 'active';
                        const isSelected = selectedStrategy?.id === strat.id;
                        // Mode priority: explicitly set strategy mode, or fallback to current global default queue
                        const stratMode = strat.executionMode || (isPaperTrading ? 'paper' : 'live');
                        const isLiveMode = stratMode === 'live';

                        return (
                          <div
                            key={strat.id}
                            id={`deployed-strat-card-${strat.id}`}
                            onClick={() => setSelectedStrategy(strat)}
                            className={`p-3 rounded-lg border transition-all cursor-pointer select-none ${
                              isSelected 
                                ? 'bg-zinc-950/95 border-emerald-500/60 shadow-md ring-1 ring-emerald-500/20' 
                                : 'bg-zinc-950/40 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-950/70'
                            }`}
                            title="Click to select strategy and visualize its P&L trajectory"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-1.5 flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="text-xs font-mono font-bold text-white truncate max-w-[200px]">
                                    {strat.name}
                                  </h4>
                                  <span className="bg-purple-950/70 border border-purple-800/50 text-purple-300 px-1 py-0.2 rounded text-[9px] font-mono font-bold shrink-0">
                                    v{strat.version || 1}
                                  </span>
                                  <span className={`w-2 h-2 rounded-full ${
                                    isActive ? 'bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-zinc-700'
                                  }`} />

                                  {/* Interactive Queue Toggle Pill */}
                                  <button
                                    type="button"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const nextMode = isLiveMode ? 'paper' : 'live';
                                      try {
                                        const res = await fetch(`/api/strategies/${strat.id}`, {
                                          method: 'PUT',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ ...strat, executionMode: nextMode })
                                        });
                                        if (res.ok) {
                                          const updated = await res.json();
                                          setStrategies(prev => prev.map(s => s.id === strat.id ? updated : s));
                                          if (selectedStrategy?.id === strat.id) {
                                            setSelectedStrategy(updated);
                                          }
                                          fetchLogsAndMetrics();
                                        }
                                      } catch (err) {
                                        console.error("Failed to switch strategy mode:", err);
                                      }
                                    }}
                                    title={isActive 
                                      ? `Worker is currently running on ${isLiveMode ? 'Live Level 4' : 'Paper Level 2'} queue. Click to change queue.` 
                                      : `Click to switch execution queue between Paper (L2) and Live (L4)`
                                    }
                                    className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all cursor-pointer flex items-center space-x-1 ${
                                      isLiveMode
                                        ? 'bg-rose-950/90 border-rose-600 text-rose-200 hover:bg-rose-900 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                                        : 'bg-amber-950/90 border-amber-600 text-amber-200 hover:bg-amber-900 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                                    }`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full ${isLiveMode ? 'bg-rose-400 animate-ping' : 'bg-amber-400'}`} />
                                    <span>{isLiveMode ? 'LIVE Q (L4)' : 'PAPER Q (L2)'}</span>
                                  </button>

                                  {isSelected && (
                                    <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-1.5 py-0.2 rounded">
                                      Active P&amp;L View
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center space-x-2 text-[10px] font-mono text-zinc-400">
                                  <span className="text-zinc-300 font-semibold">{strat.assetPair}</span>
                                  <span>•</span>
                                  <span>{formatTimeframe(strat.interval)} timeframe</span>
                                  {strat.hardStopEnabled !== false && (
                                    <>
                                      <span>•</span>
                                      <span className="text-rose-400 font-semibold">
                                        Stop: -{strat.hardStopPercent ?? 5.0}%
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Controls */}
                              <div 
                                className="flex items-center space-x-1.5 shrink-0" 
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleRun(strat.id, isActive ? 'stop' : 'start', stratMode);
                                  }}
                                  className={`px-3 py-1.5 rounded-md border text-[11px] font-mono font-bold flex items-center space-x-1.5 transition-all shadow-sm ${
                                    isActive
                                      ? 'bg-rose-950/90 border-rose-600 text-rose-200 hover:bg-rose-900 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                                      : isLiveMode
                                        ? 'bg-rose-950/80 border-rose-600 text-rose-200 hover:bg-rose-900 shadow-[0_0_8px_rgba(244,63,94,0.2)]'
                                        : 'bg-emerald-950/80 border-emerald-600 text-emerald-200 hover:bg-emerald-900 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                                  }`}
                                >
                                  {isActive ? <Square className="w-2.5 h-2.5 fill-rose-400" /> : <Play className="w-2.5 h-2.5 fill-current" />}
                                  <span>{isActive ? 'HALT' : isLiveMode ? 'RUN L4' : 'RUN L2'}</span>
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedStrategy(strat);
                                    setActivePage('orchestrator');
                                  }}
                                  title="Open in Strategy Orchestrator"
                                  className="p-1.5 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                                >
                                  <Code2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <p className="text-[11px] text-zinc-400 mt-2 line-clamp-2 leading-relaxed">
                              {strat.description}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Terminal Panel in Overview */}
                  <div className="flex-1 min-h-[380px]">
                    <TerminalPanel 
                      logs={logs}
                      onSendCommand={handleSendCommand}
                      onClearLogs={handleClearLogs}
                      onRefresh={fetchLogsAndMetrics}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          ) : activePage === 'health' ? (
            /* ======================================================== */
            /* PILLAR A: SYSTEM HEALTH & CORE TELEMETRY (M-00,01,11,17) */
            /* ======================================================== */
            <motion.div
              key="health-page"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="max-w-7xl mx-auto"
            >
              <SystemHealthPanel onRefresh={fetchLogsAndMetrics} />
            </motion.div>
          ) : activePage === 'regime' ? (
            /* ======================================================== */
            /* PILLAR B: QUANTITATIVE REGIMES & DFA (M-03,10,14,15)     */
            /* ======================================================== */
            <motion.div
              key="regime-page"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="max-w-7xl mx-auto"
            >
              <QuantitativeRegimePanel />
            </motion.div>
          ) : activePage === 'execution' ? (
            /* ======================================================== */
            /* PILLAR C: M8 EXECUTION & RISK SIZING (M-02,09,12,16)     */
            /* ======================================================== */
            <motion.div
              key="execution-page"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="max-w-7xl mx-auto"
            >
              <ExecutionRiskPanel />
            </motion.div>
          ) : activePage === 'academy' ? (
            /* ======================================================== */
            /* PILLAR D: ACADEMY, STRESS DRILLS & REGISTRY (M-04..08,13)*/
            /* ======================================================== */
            <motion.div
              key="academy-page"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="max-w-7xl mx-auto"
            >
              <AcademyRegistryPanel />
            </motion.div>
          ) : activePage === 'orchestrator' ? (
            /* ======================================================== */
            /* PAGE 2: STRATEGY ORCHESTRATOR PAGE                       */
            /* ======================================================== */
            <motion.div
              key="orchestrator-page"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="grid grid-cols-1 xl:grid-cols-12 gap-5"
            >
              {/* COLUMN 1: STRATEGY MANIFEST & SELECTION (3/12) */}
              <div className="xl:col-span-3 flex flex-col space-y-4">
                {/* Strategy Manifest Selector */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-3">
                    <div className="flex items-center space-x-2">
                      <ListFilter className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                        Strategies Manifest
                      </span>
                    </div>
                    <div className="flex items-center space-x-1 bg-zinc-950 p-0.5 rounded border border-zinc-800">
                      <button
                        onClick={() => setManifestFilter('active')}
                        className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${
                          manifestFilter === 'active' 
                            ? 'bg-zinc-800 text-white font-bold' 
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        Active ({strategies.filter(s => s.status !== 'archived').length})
                      </button>
                      <button
                        onClick={() => setManifestFilter('archived')}
                        className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors flex items-center space-x-1 ${
                          manifestFilter === 'archived' 
                            ? 'bg-purple-950/80 border border-purple-800/60 text-purple-300 font-bold' 
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        <Archive className="w-2.5 h-2.5" />
                        <span>Archives ({strategies.filter(s => s.status === 'archived').length})</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 pr-1 max-h-[460px] overflow-y-auto terminal-scroll">
                    {strategies
                      .filter(strat => manifestFilter === 'archived' ? strat.status === 'archived' : strat.status !== 'archived')
                      .map((strat) => {
                      const isSelected = selectedStrategy?.id === strat.id;
                      const isActive = strat.status === 'active';
                      const isArchived = strat.status === 'archived';

                      return (
                        <motion.div
                          key={strat.id}
                          onClick={() => {
                            setAiGeneratedToInsert(null);
                            setSelectedStrategy(strat);
                          }}
                          className={`p-3 rounded-lg border transition-all cursor-pointer select-none relative ${
                            isSelected 
                              ? isArchived
                                ? 'bg-amber-950/30 border-amber-500/60 text-white shadow-md'
                                : 'bg-zinc-800/90 border-emerald-500/60 text-white shadow-md' 
                              : isArchived
                                ? 'bg-zinc-950/40 hover:bg-zinc-950 border-zinc-850 text-zinc-400'
                                : 'bg-zinc-950/50 hover:bg-zinc-950 border-zinc-800 text-zinc-300'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1 flex-1 min-w-0">
                              <div className="flex items-center space-x-1.5 flex-wrap">
                                <h4 className="text-xs font-mono font-bold leading-none truncate max-w-[180px]">
                                  {strat.name}
                                </h4>
                                <span className="bg-purple-950/70 border border-purple-800/50 text-purple-300 px-1 py-0.2 rounded text-[9px] font-mono font-bold shrink-0">
                                  v{strat.version || 1}
                                </span>
                                {isArchived && (
                                  <span className="bg-amber-950/70 border border-amber-800/50 text-amber-300 px-1 py-0.2 rounded text-[9px] font-mono shrink-0 flex items-center space-x-0.5">
                                    <Archive className="w-2.5 h-2.5" />
                                    <span>ARCHIVE</span>
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center space-x-2 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                                <span>{strat.assetPair}</span>
                                <span>•</span>
                                <span>{formatTimeframe(strat.interval)}</span>
                                {strat.hardStopEnabled !== false && (
                                  <>
                                    <span>•</span>
                                    <span className="text-rose-400 font-semibold lowercase">
                                      stop: -{strat.hardStopPercent ?? 5.0}%
                                    </span>
                                  </>
                                )}
                              </div>

                              {strat.seededFromName && (
                                <div className="text-[10px] font-mono text-purple-400 flex items-center space-x-1 truncate pt-0.5" title={`Seeded from: ${strat.seededFromName}`}>
                                  <Dna className="w-2.5 h-2.5 shrink-0" />
                                  <span className="truncate">Seed: {strat.seededFromName}</span>
                                </div>
                              )}
                            </div>

                            {/* Status indicator badge */}
                            <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${
                              isActive 
                                ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.5)]' 
                                : isArchived
                                  ? 'bg-amber-600'
                                  : 'bg-zinc-700'
                            }`} />
                          </div>

                          <p className="text-[11px] text-zinc-400 mt-2 line-clamp-2 leading-relaxed">
                            {strat.description}
                          </p>

                          {/* Quick control overlay */}
                          {isSelected && (
                            <div className="mt-3 pt-2.5 border-t border-zinc-700/60 flex justify-between items-center text-[10px] font-mono">
                              <span className="text-zinc-500 uppercase">
                                {isArchived ? 'Archive State' : 'Worker Engine'}
                              </span>
                              {isArchived ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRestoreStrategy(strat.id);
                                  }}
                                  className="px-2 py-0.5 rounded border bg-purple-950/60 border-purple-800/80 hover:bg-purple-900/60 text-purple-300 flex items-center space-x-1"
                                >
                                  <ArchiveRestore className="w-2.5 h-2.5" />
                                  <span>RESTORE</span>
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleRun(strat.id, isActive ? 'stop' : 'start');
                                  }}
                                  className={`px-2 py-0.5 rounded border flex items-center space-x-1 ${
                                    isActive
                                      ? 'bg-rose-950/40 border-rose-900/40 hover:bg-rose-900/40 text-rose-400'
                                      : 'bg-emerald-950/40 border-emerald-900/40 hover:bg-emerald-900/40 text-emerald-400'
                                  }`}
                                >
                                  {isActive ? <Square className="w-2.5 h-2.5 fill-rose-400" /> : <Play className="w-2.5 h-2.5 fill-emerald-400" />}
                                  <span>{isActive ? 'SHUTDOWN' : 'DEPLOY'}</span>
                                </button>
                              )}
                            </div>
                          )}
                        </motion.div>
                      );
                    })}

                    {strategies.filter(strat => manifestFilter === 'archived' ? strat.status === 'archived' : strat.status !== 'archived').length === 0 && (
                      <div className="p-4 rounded border border-zinc-800/60 bg-zinc-950/40 text-center text-xs font-mono text-zinc-500">
                        {manifestFilter === 'archived' 
                          ? 'No archived strategies. When evolutionary optimization seeds new versions, ancestor strategies will be automatically archived here.'
                          : 'No active strategies registered.'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Selected Strategy Live Scorecard in Orchestrator */}
                {selectedStrategy && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
                    <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300 flex items-center justify-between">
                      <span>Selected Diagnostics</span>
                      <Activity className="w-3.5 h-3.5 text-emerald-400" />
                    </h4>
                    {(() => {
                      const pnl = strategyPnL.find(p => p.strategyId === selectedStrategy.id);
                      if (!pnl) {
                        return <div className="text-xs font-mono text-zinc-500">No telemetry logged yet for {selectedStrategy.name}</div>;
                      }
                      const isProfit = pnl.totalPnL >= 0;
                      return (
                        <div className="space-y-2 text-xs font-mono">
                          <div className="flex justify-between items-center border-b border-zinc-800 pb-1.5">
                            <span className="text-zinc-400">Net Performance</span>
                            <span className={`font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {isProfit ? '+' : ''}${pnl.totalPnL.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center border-b border-zinc-800 pb-1.5">
                            <span className="text-zinc-400">Win Rate</span>
                            <span className="text-white font-medium">{pnl.winRate}% ({pnl.totalTrades} trades)</span>
                          </div>
                          <div className="flex justify-between items-center border-b border-zinc-800 pb-1.5">
                            <span className="text-zinc-400">Volume Traded</span>
                            <span className="text-white font-medium">${pnl.volumeTradedUSD.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-zinc-400">Hard Stop Risk</span>
                            <span className={selectedStrategy.hardStopEnabled !== false ? 'text-rose-400 font-semibold' : 'text-zinc-500'}>
                              {selectedStrategy.hardStopEnabled !== false ? `-${selectedStrategy.hardStopPercent ?? 5.0}% Emergency Cutoff` : 'Disabled'}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* COLUMN 2: STRATEGY EDITOR & DOCKED CLI (6/12) */}
              <div className="xl:col-span-6 flex flex-col space-y-5 min-h-[600px]">
                {/* Full Interactive Code & Config Editor */}
                <div className="flex-1 min-h-0">
                  <StrategyEditor 
                    strategies={strategies}
                    selectedStrategy={selectedStrategy}
                    onSelectStrategy={setSelectedStrategy}
                    onUpdateStrategy={handleUpdateStrategy}
                    onCreateStrategy={handleCreateStrategy}
                    onDeleteStrategy={handleDeleteStrategy}
                    onToggleRun={handleToggleRun}
                    onReloadStrategies={fetchStrategies}
                    onArchiveStrategy={handleArchiveStrategy}
                    onRestoreStrategy={handleRestoreStrategy}
                  />
                </div>

                {/* Docked Live Terminal Emulator */}
                <div className="h-72 shrink-0">
                  <TerminalPanel 
                    logs={logs}
                    onSendCommand={handleSendCommand}
                    onClearLogs={handleClearLogs}
                    onRefresh={fetchLogsAndMetrics}
                  />
                </div>
              </div>

              {/* COLUMN 3: QUANTITATIVE AI COPILOT (3/12) */}
              <div className="xl:col-span-3 flex flex-col space-y-4">
                {/* Gemini Quant Copilot Integration */}
                <div className="flex-1 min-h-[400px]">
                  <AIReviewer 
                    currentStrategy={selectedStrategy}
                    strategies={strategies}
                    onInsertGeneratedStrategy={handleCreateStrategy}
                    onUpdateStrategy={async (strategyUpdates) => {
                      if (strategyUpdates.id) {
                        await handleUpdateStrategy(strategyUpdates.id, strategyUpdates);
                      }
                    }}
                    onReloadStrategies={fetchStrategies}
                  />
                </div>
              </div>
            </motion.div>
          ) : activePage === 'backtesting' ? (
            /* ======================================================== */
            /* PAGE 3: STRATEGY BACKTESTING PAGE                        */
            /* ======================================================== */
            <motion.div
              key="backtesting-page"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <BacktestingPanel 
                strategies={strategies}
                selectedStrategy={selectedStrategy}
                onSelectStrategy={(strat) => setSelectedStrategy(strat)}
                onOpenOrchestrator={(strat) => {
                  setSelectedStrategy(strat);
                  setActivePage('orchestrator');
                }}
                onUpdateStrategyParams={async (stratId, params) => {
                  await handleUpdateStrategy(stratId, { parameters: params });
                }}
              />
            </motion.div>
          ) : activePage === 'genetic' ? (
            /* ======================================================== */
            /* PAGE 4: GENETIC WALK-FORWARD OPTIMIZER PAGE              */
            /* ======================================================== */
            <motion.div
              key="genetic-optimizer-page"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <GeneticOptimizerPanel
                strategies={strategies}
                onOpenOrchestrator={(strat) => {
                  setSelectedStrategy(strat);
                  setActivePage('orchestrator');
                }}
                onOpenBacktester={(pair, interval, code, params) => {
                  // If strategy exists or create temporary strategy for backtester
                  const matched = strategies.find(s => s.assetPair === pair);
                  if (matched) {
                    setSelectedStrategy(matched);
                  }
                  setActivePage('backtesting');
                }}
                onReloadStrategies={fetchStrategies}
              />
            </motion.div>
          ) : activePage === 'queues' ? (
            /* ======================================================== */
            /* PAGE 5: QUEUE PERFORMANCE MATRICES (L2 PAPER & L4 LIVE)  */
            /* ======================================================== */
            <motion.div
              key="queue-matrices-page"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <QueueMatrixPanel
                queueMatrices={queueMatrices}
                onSelectStrategy={(stratId) => {
                  const matched = strategies.find(s => s.id === stratId);
                  if (matched) {
                    setSelectedStrategy(matched);
                    setActivePage('orchestrator');
                  }
                }}
                onRefresh={fetchQueueMatrices}
              />
            </motion.div>
          ) : activePage === 'ledgers' ? (
            /* ======================================================== */
            /* PAGE 6: KRAKEN POSITION LEDGERS (SPOT & PRO FUTURES)     */
            /* ======================================================== */
            <motion.div
              key="kraken-ledgers-page"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <KrakenLedgersPanel
                isPaperTrading={isPaperTrading}
                hasCredentials={hasKrakenKeys}
                onRefreshTrigger={fetchKrakenStatus}
              />
            </motion.div>
          ) : (
            /* ======================================================== */
            /* PAGE 7: ENTERPRISE OHLCV DATA LAKE & DUCKDB COMPUTE      */
            /* ======================================================== */
            <motion.div
              key="data-lake-page"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <DataLakePanel
                activeSymbol={selectedStrategy?.assetPair || "BTC/USD"}
                onSelectSymbol={(sym) => {
                  const match = strategies.find(s => s.assetPair === sym);
                  if (match) setSelectedStrategy(match);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
