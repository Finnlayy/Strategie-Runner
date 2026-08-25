import React, { useState, useEffect, useRef, useMemo } from "react";
import { 
  Code, Settings, Play, Square, Save, Trash2, Plus, 
  HelpCircle, ChevronDown, RefreshCw, FileText,
  HardDrive, Download, Upload, RotateCcw, X, Copy, Check, CheckCircle2, ShieldCheck,
  ShieldAlert, AlertOctagon, Zap, Shield, Globe, Search, Archive, ArchiveRestore, GitCommit, Dna, History
} from "lucide-react";
import { TradingStrategy, StrategyManifest, KrakenSymbolInfo } from "../types";
import KrakenSymbolModal from "./KrakenSymbolModal";
import { StrategyQueueConfirmModal } from "./StrategyQueueConfirmModal";

const KRAKEN_OFFICIAL_TIMEFRAMES = [
  { value: 1, label: "1m (1 Minute)", ohlc: "Kraken OHLC 1m" },
  { value: 5, label: "5m (5 Minuten)", ohlc: "Kraken OHLC 5m" },
  { value: 15, label: "15m (15 Minuten)", ohlc: "Kraken OHLC 15m" },
  { value: 30, label: "30m (30 Minuten)", ohlc: "Kraken OHLC 30m" },
  { value: 60, label: "1h (1 Stunde / 60 Min)", ohlc: "Kraken OHLC 1h" },
  { value: 240, label: "4h (4 Stunden / 240 Min)", ohlc: "Kraken OHLC 4h" },
  { value: 1440, label: "1d (1 Tag / 24 Std)", ohlc: "Kraken OHLC 1d" },
  { value: 10080, label: "1w (1 Woche / 7 Tage)", ohlc: "Kraken OHLC 1w" },
  { value: 21600, label: "15d (15 Tage)", ohlc: "Kraken OHLC 15d" },
];

interface StrategyEditorProps {
  strategies: TradingStrategy[];
  selectedStrategy: TradingStrategy | null;
  onSelectStrategy: (strat: TradingStrategy) => void;
  onUpdateStrategy: (id: string, updates: Partial<TradingStrategy>) => Promise<void>;
  onCreateStrategy: (strategy: Partial<TradingStrategy>) => Promise<void>;
  onDeleteStrategy: (id: string) => Promise<void>;
  onToggleRun: (id: string, action: 'start' | 'stop', mode?: 'paper' | 'live') => Promise<void>;
  onReloadStrategies?: () => Promise<void>;
  onArchiveStrategy?: (id: string) => Promise<void>;
  onRestoreStrategy?: (id: string) => Promise<void>;
}

export default function StrategyEditor({
  strategies,
  selectedStrategy,
  onSelectStrategy,
  onUpdateStrategy,
  onCreateStrategy,
  onDeleteStrategy,
  onToggleRun,
  onReloadStrategies,
  onArchiveStrategy,
  onRestoreStrategy
}: StrategyEditorProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assetPair, setAssetPair] = useState("BTC/USD");
  const [interval, setIntervalVal] = useState(5);
  const [executionMode, setExecutionMode] = useState<'paper' | 'live'>('paper');
  const [hardStopEnabled, setHardStopEnabled] = useState(true);
  const [hardStopPercent, setHardStopPercent] = useState(5.0);
  const [paramsStr, setParamsStr] = useState("{}");
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTriggeringEmergency, setIsTriggeringEmergency] = useState(false);
  const [emergencyFeedback, setEmergencyFeedback] = useState<string | null>(null);

  // Manifest modal state
  const [isManifestOpen, setIsManifestOpen] = useState(false);
  const [manifestData, setManifestData] = useState<StrategyManifest | null>(null);
  const [isLoadingManifest, setIsLoadingManifest] = useState(false);
  const [importText, setImportText] = useState("");
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Kraken Symbols Directory state
  const [krakenSymbols, setKrakenSymbols] = useState<KrakenSymbolInfo[]>([]);
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);
  const [isSymbolModalOpen, setIsSymbolModalOpen] = useState(false);

  // Queue Switch Confirmation Dialog State
  const [isQueueConfirmOpen, setIsQueueConfirmOpen] = useState(false);
  const [pendingQueueTarget, setPendingQueueTarget] = useState<'paper' | 'live'>('paper');
  const [isSwitchingQueue, setIsSwitchingQueue] = useState(false);

  const handleRequestQueueChange = (target: 'paper' | 'live') => {
    if (target === executionMode) return;
    if (isCreating || !selectedStrategy) {
      // New strategy being created: set directly
      setExecutionMode(target);
      return;
    }
    // Existing strategy: prompt with confirmation modal
    setPendingQueueTarget(target);
    setIsQueueConfirmOpen(true);
  };

  const handleConfirmQueueSwitch = async () => {
    if (!selectedStrategy) return;
    setIsSwitchingQueue(true);
    try {
      setExecutionMode(pendingQueueTarget);
      await onUpdateStrategy(selectedStrategy.id, {
        executionMode: pendingQueueTarget
      });
      setIsQueueConfirmOpen(false);
    } catch (err) {
      console.error("Failed to switch strategy queue:", err);
    } finally {
      setIsSwitchingQueue(false);
    }
  };

  // Fetch full Kraken & Kraken Pro symbol catalog
  const fetchKrakenSymbols = async () => {
    setIsLoadingSymbols(true);
    try {
      const res = await fetch("/api/kraken/symbols");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.symbols)) {
          setKrakenSymbols(data.symbols);
        }
      }
    } catch (err) {
      console.error("Failed to load Kraken symbols:", err);
    } finally {
      setIsLoadingSymbols(false);
    }
  };

  useEffect(() => {
    fetchKrakenSymbols();
  }, []);

  const popularSymbols = useMemo(() => [
    "BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD",
    "ADA/USD", "DOGE/USD", "AVAX/USD", "LINK/USD",
    "DOT/USD", "NEAR/USD", "SUI/USD", "PEPE/USD",
    "BTC/EUR", "ETH/EUR", "SOL/EUR", "XRP/EUR",
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "USDT/USD"
  ], []);

  const { usdSymbols, eurSymbols, usdtSymbols, btcSymbols, otherSymbols } = useMemo(() => {
    const usd: string[] = [];
    const eur: string[] = [];
    const usdt: string[] = [];
    const btc: string[] = [];
    const other: string[] = [];

    krakenSymbols.forEach(s => {
      if (s.quote === 'USD' || s.symbol.endsWith('/USD')) usd.push(s.symbol);
      else if (s.quote === 'EUR' || s.symbol.endsWith('/EUR')) eur.push(s.symbol);
      else if (s.quote === 'USDT' || s.symbol.endsWith('/USDT')) usdt.push(s.symbol);
      else if (s.quote === 'BTC' || s.quote === 'XBT' || s.symbol.endsWith('/BTC')) btc.push(s.symbol);
      else other.push(s.symbol);
    });

    return {
      usdSymbols: usd,
      eurSymbols: eur,
      usdtSymbols: usdt,
      btcSymbols: btc,
      otherSymbols: other
    };
  }, [krakenSymbols]);

  // Fetch Manifest
  const fetchManifest = async () => {
    setIsLoadingManifest(true);
    try {
      const res = await fetch("/api/manifest");
      if (res.ok) {
        const data = await res.json();
        setManifestData(data);
      }
    } catch (err) {
      console.error("Failed to load manifest:", err);
    } finally {
      setIsLoadingManifest(false);
    }
  };

  const handleOpenManifest = () => {
    setIsManifestOpen(true);
    fetchManifest();
  };

  const handleExportManifest = () => {
    if (!manifestData) return;
    const blob = new Blob([JSON.stringify(manifestData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kraken-strategy-manifest-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportManifest = async (jsonContent?: string) => {
    const raw = jsonContent || importText;
    if (!raw.trim()) {
      setImportStatus("Error: Manifest JSON is empty");
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const payload = Array.isArray(parsed) ? { strategies: parsed } : parsed;
      const res = await fetch("/api/manifest/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setImportStatus("Manifest successfully imported and saved to disk!");
        setImportText("");
        if (onReloadStrategies) await onReloadStrategies();
        await fetchManifest();
        setTimeout(() => setImportStatus(null), 3000);
      } else {
        const err = await res.json();
        setImportStatus(`Import error: ${err.error || "Failed"}`);
      }
    } catch (err: any) {
      setImportStatus(`JSON Parse error: ${err.message}`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setImportText(content);
      handleImportManifest(content);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleResetManifest = async () => {
    if (!confirm("Restore factory seed strategy manifest? This will revert your strategies to defaults.")) return;
    try {
      const res = await fetch("/api/manifest/reset", { method: "POST" });
      if (res.ok) {
        if (onReloadStrategies) await onReloadStrategies();
        await fetchManifest();
        setImportStatus("Restored default factory seed manifest.");
        setTimeout(() => setImportStatus(null), 3000);
      }
    } catch (err) {
      console.error("Reset error:", err);
    }
  };

  const copyManifestJSON = () => {
    if (!manifestData) return;
    navigator.clipboard.writeText(JSON.stringify(manifestData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Synchronize inputs when selected strategy changes
  useEffect(() => {
    if (selectedStrategy && !isCreating) {
      setCode(selectedStrategy.code);
      setName(selectedStrategy.name);
      setDescription(selectedStrategy.description);
      setAssetPair(selectedStrategy.assetPair);
      setIntervalVal(selectedStrategy.interval);
      setExecutionMode(selectedStrategy.executionMode || 'paper');
      setHardStopEnabled(selectedStrategy.hardStopEnabled !== undefined ? selectedStrategy.hardStopEnabled : Boolean(selectedStrategy.parameters?.globalHardStopEnabled ?? true));
      setHardStopPercent(selectedStrategy.hardStopPercent !== undefined ? selectedStrategy.hardStopPercent : Number(selectedStrategy.parameters?.globalHardStopPercent ?? 5.0));
      setParamsStr(JSON.stringify(selectedStrategy.parameters, null, 2));
    }
  }, [selectedStrategy, isCreating]);

  const handleTriggerEmergencyStop = async () => {
    if (!confirm("🚨 Send EMERGENCY 'cancel all' signal to Kraken CLI daemon? This will immediately purge open orders and suspend active trading workers.")) {
      return;
    }
    setIsTriggeringEmergency(true);
    try {
      const res = await fetch("/api/emergency/cancel-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyId: selectedStrategy?.id,
          reason: "Manual Emergency Hard Stop Triggered via StrategyEditor"
        })
      });
      if (res.ok) {
        const data = await res.json();
        setEmergencyFeedback(`🚨 Cancel-all signal executed on Kraken CLI daemon! ${data.message || 'Workers halted.'}`);
        if (onReloadStrategies) await onReloadStrategies();
        setTimeout(() => setEmergencyFeedback(null), 5000);
      } else {
        setEmergencyFeedback("Failed to dispatch emergency signal to Kraken CLI.");
        setTimeout(() => setEmergencyFeedback(null), 4000);
      }
    } catch (err) {
      setEmergencyFeedback("Error connecting to Kraken CLI emergency endpoint.");
      setTimeout(() => setEmergencyFeedback(null), 4000);
    } finally {
      setIsTriggeringEmergency(false);
    }
  };

  const handleSave = async () => {
    if (!selectedStrategy) return;
    setIsSaving(true);
    try {
      let parsedParams = {};
      try {
        parsedParams = JSON.parse(paramsStr);
      } catch (err) {
        alert("Parameters must be valid JSON object.");
        setIsSaving(false);
        return;
      }

      (parsedParams as any).globalHardStopEnabled = hardStopEnabled;
      (parsedParams as any).globalHardStopPercent = hardStopPercent;

      await onUpdateStrategy(selectedStrategy.id, {
        code,
        name,
        description,
        assetPair,
        interval,
        executionMode,
        hardStopEnabled,
        hardStopPercent,
        parameters: parsedParams
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateNew = async () => {
    setIsSaving(true);
    try {
      let parsedParams = {};
      try {
        parsedParams = JSON.parse(paramsStr);
      } catch (err) {
        alert("Parameters must be valid JSON.");
        setIsSaving(false);
        return;
      }

      (parsedParams as any).globalHardStopEnabled = hardStopEnabled;
      (parsedParams as any).globalHardStopPercent = hardStopPercent;

      await onCreateStrategy({
        name: name || "New Trading Strategy",
        description: description || "Headless custom trading script.",
        assetPair,
        interval,
        executionMode,
        hardStopEnabled,
        hardStopPercent,
        parameters: parsedParams,
        code: code || `// Custom trading script\nif (currentPrice > parameters.threshold) {\n  executeOrder('sell', 0.1);\n}`
      });
      setIsCreating(false);
    } finally {
      setIsSaving(false);
    }
  };

  const loadTemplate = (type: string) => {
    if (type === 'scalper') {
      setName("High-Freq Scalper Engine");
      setDescription("Sells on brief upwards micro-trends and accumulates on slight pullback dips.");
      setAssetPair("ETH/USD");
      setIntervalVal(5);
      setHardStopEnabled(true);
      setHardStopPercent(3.0);
      setParamsStr(JSON.stringify({ threshold: 0.2, tradeAmount: 0.25, globalHardStopEnabled: true, globalHardStopPercent: 3.0 }, null, 2));
      setCode(`// High-Frequency Scalper logic
const avgPrice = getRollingAverage(prices, 5);
const dev = (currentPrice - avgPrice) / avgPrice * 100;

if (dev < -parameters.threshold) {
  executeOrder('buy', parameters.tradeAmount);
} else if (dev > parameters.threshold) {
  executeOrder('sell', parameters.tradeAmount);
}`);
    } else if (type === 'breakout') {
      setName("EMA Breakout Alert");
      setDescription("Buys breakouts above short-term Exponential Moving Average limits.");
      setAssetPair("BTC/USD");
      setIntervalVal(15);
      setHardStopEnabled(true);
      setHardStopPercent(5.0);
      setParamsStr(JSON.stringify({ threshold: 0.5, period: 20, tradeAmount: 0.05, globalHardStopEnabled: true, globalHardStopPercent: 5.0 }, null, 2));
      setCode(`// EMA Breakout logic
const emaVal = calculateEMA(prices, parameters.period);
const diff = (currentPrice - emaVal) / emaVal * 100;

if (diff > parameters.threshold) {
  executeOrder('buy', parameters.tradeAmount);
} else if (diff < -parameters.threshold) {
  executeOrder('sell', parameters.tradeAmount);
}`);
    }
  };

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col h-full overflow-hidden relative">
      {/* Hidden File Input for Manifest Upload */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        accept=".json,application/json" 
        className="hidden" 
      />

      {/* Strategy Selector Header Tabs */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <Code className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-300">Strategy Orchestrator</span>
          </div>

          {/* Trans-Session Manifest Status Pill */}
          <button
            onClick={handleOpenManifest}
            className="bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-800/60 hover:border-emerald-700 text-emerald-400 px-2.5 py-1 rounded text-[11px] font-mono transition-all flex items-center space-x-1.5"
            title="Inspect trans-session persistent strategy manifest"
          >
            <HardDrive className="w-3 h-3 text-emerald-400" />
            <span className="font-semibold">Persistent Manifest:</span>
            <span className="text-emerald-300">Synced</span>
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleOpenManifest}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white px-2.5 py-1.5 rounded text-xs font-mono transition-all flex items-center space-x-1.5"
          >
            <Settings className="w-3.5 h-3.5 text-zinc-400" />
            <span>Manage Manifest</span>
          </button>

          {!isCreating ? (
            <button
              onClick={() => {
                setIsCreating(true);
                setName("");
                setDescription("");
                setAssetPair("BTC/USD");
                setIntervalVal(10);
                setParamsStr("{\n  \"threshold\": 1.0\n}");
                setCode(`// Write custom trading logic using standard hooks\n// available parameters:\n// 'currentPrice', 'prices', 'parameters', 'executeOrder(type, amount)'\n\nif (currentPrice < parameters.threshold) {\n  executeOrder('buy', 0.1);\n}`);
              }}
              className="bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-850 hover:border-emerald-700 text-emerald-400 px-3 py-1.5 rounded text-xs font-mono transition-all flex items-center space-x-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Strategy</span>
            </button>
          ) : (
            <button
              onClick={() => setIsCreating(false)}
              className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 px-3 py-1.5 rounded text-xs font-mono transition-all"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* MANIFEST INSPECTOR & MANAGEMENT MODAL */}
      {isManifestOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="bg-zinc-900 px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <HardDrive className="w-4 h-4 text-emerald-400" />
                <span className="font-mono text-xs font-semibold text-white uppercase tracking-wider">
                  Trans-Session Strategy Manifest
                </span>
                <span className="bg-emerald-950 border border-emerald-800 text-emerald-400 text-[10px] font-mono px-2 py-0.5 rounded">
                  Persistent Storage
                </span>
              </div>
              <button 
                onClick={() => setIsManifestOpen(false)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs font-mono">
              {importStatus && (
                <div className={`p-3 rounded border text-xs ${
                  importStatus.includes('error') || importStatus.includes('Error')
                    ? 'bg-rose-950/40 border-rose-800 text-rose-300'
                    : 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                }`}>
                  {importStatus}
                </div>
              )}

              {/* Manifest Metadata Card */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-900/60 p-3 rounded border border-zinc-850">
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase">Schema</span>
                  <span className="text-zinc-200 font-semibold">{manifestData?.schemaVersion || "2.0.0"}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase">File Target</span>
                  <span className="text-emerald-400 truncate block" title={manifestData?.persistedPath || "data/strategy-manifest.json"}>
                    {manifestData?.persistedPath || "data/strategy-manifest.json"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase">Strategies</span>
                  <span className="text-zinc-200 font-semibold">{strategies.length} configured</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase">Active Running</span>
                  <span className="text-emerald-400 font-semibold">
                    {strategies.filter(s => s.status === 'active').length} workers
                  </span>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={handleExportManifest}
                  className="bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-800 text-emerald-300 px-3 py-1.5 rounded text-xs font-mono transition-all flex items-center space-x-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Manifest (.json)</span>
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded text-xs font-mono transition-all flex items-center space-x-1.5"
                >
                  <Upload className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Upload Backup JSON</span>
                </button>

                <button
                  onClick={copyManifestJSON}
                  className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-700 text-zinc-300 px-3 py-1.5 rounded text-xs font-mono transition-all flex items-center space-x-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-zinc-400" />}
                  <span>{copied ? "Copied!" : "Copy JSON"}</span>
                </button>

                <button
                  onClick={handleResetManifest}
                  className="bg-zinc-900 hover:bg-rose-950/40 border border-zinc-750 hover:border-rose-800 text-zinc-400 hover:text-rose-300 px-3 py-1.5 rounded text-xs font-mono transition-all flex items-center space-x-1.5 ml-auto"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Reset Seed Defaults</span>
                </button>
              </div>

              {/* Direct Paste Import Box */}
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                  Import / Restore Strategy Manifest JSON Payload
                </label>
                <div className="space-y-2">
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder='Paste valid strategy manifest JSON here to restore or merge...'
                    className="w-full bg-zinc-900 border border-zinc-800 rounded p-2.5 text-[11px] font-mono text-zinc-200 placeholder-zinc-600 h-24 focus:border-emerald-800 focus:outline-none resize-none"
                  />
                  {importText.trim() && (
                    <button
                      onClick={() => handleImportManifest()}
                      className="bg-emerald-600 hover:bg-emerald-500 text-black font-semibold px-4 py-1.5 rounded text-xs font-mono transition-all"
                    >
                      Commit & Apply Manifest Import
                    </button>
                  )}
                </div>
              </div>

              {/* Raw JSON Manifest Viewer */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    Live Persistent Storage Document
                  </span>
                  <button 
                    onClick={fetchManifest}
                    className="text-zinc-500 hover:text-emerald-400 text-[10px] flex items-center space-x-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingManifest ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="bg-zinc-900/90 border border-zinc-800 rounded p-3 text-[11px] font-mono text-zinc-300 max-h-48 overflow-y-auto whitespace-pre">
                  {JSON.stringify(manifestData || { strategies }, null, 2)}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-zinc-900 px-4 py-2.5 border-t border-zinc-800 flex justify-end">
              <button
                onClick={() => setIsManifestOpen(false)}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-1.5 rounded text-xs font-mono transition-all"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Layout Divided into side configs + code workspace */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-y-auto md:overflow-hidden">
        {/* Sidebar Configuration Panel */}
        <div className="w-full md:w-80 border-r-0 md:border-r border-b md:border-b-0 border-zinc-800 p-4 space-y-4 md:overflow-y-auto shrink-0 bg-zinc-900/40">
          {/* Strategy Version & Evolution Lineage Header */}
          {!isCreating && selectedStrategy && (
            <div className={`p-3 rounded-lg border text-xs font-mono space-y-2 ${
              selectedStrategy.status === 'archived'
                ? 'bg-amber-950/30 border-amber-800/60 text-amber-200'
                : 'bg-zinc-950 border-zinc-800 text-zinc-300'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <GitCommit className="w-3.5 h-3.5 text-purple-400" />
                  <span className="font-bold text-white uppercase text-[11px]">Version & Lineage</span>
                </div>
                <span className="bg-purple-950/80 text-purple-300 border border-purple-800/60 px-1.5 py-0.5 rounded text-[10px] font-bold">
                  v{selectedStrategy.version || 1}
                </span>
              </div>

              {selectedStrategy.status === 'archived' && (
                <div className="p-2 rounded bg-amber-900/20 border border-amber-800/40 text-[10px] text-amber-300 flex items-start space-x-1.5">
                  <Archive className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Archived Strategy</span>
                    <span>This version has been evolved into a newer generation and moved out of the active orchestrator.</span>
                  </div>
                </div>
              )}

              {selectedStrategy.seededFromName && (
                <div className="text-[10px] text-zinc-400 space-y-0.5 pt-1 border-t border-zinc-800/60">
                  <div className="flex items-center space-x-1 text-purple-300">
                    <Dna className="w-3 h-3 text-purple-400" />
                    <span>Seeded From:</span>
                  </div>
                  <div className="font-semibold text-zinc-200 truncate pl-4" title={selectedStrategy.seededFromName}>
                    {selectedStrategy.seededFromName}
                  </div>
                </div>
              )}

              {selectedStrategy.evolutionGeneration && (
                <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1 border-t border-zinc-800/60">
                  <span>Optimizer Gen {selectedStrategy.evolutionGeneration}</span>
                  {selectedStrategy.evolutionFitness !== undefined && (
                    <span className="text-emerald-400 font-bold">Fit: {selectedStrategy.evolutionFitness}</span>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1.5">Strategy Profile</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Strategy Title..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-white placeholder-zinc-700 focus:border-emerald-800 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1.5">Profile Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Explain how this algorithm is structured..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-white placeholder-zinc-700 h-16 resize-none focus:border-emerald-800 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  Kraken Index Pair
                </label>
                <button
                  type="button"
                  onClick={() => setIsSymbolModalOpen(true)}
                  className="text-emerald-400 hover:text-emerald-300 text-[10px] font-mono flex items-center space-x-1 cursor-pointer transition-colors"
                  title="Open full searchable Kraken & Kraken Pro symbols directory"
                >
                  <Globe className="w-3 h-3" />
                  <span className="hidden sm:inline">All ({krakenSymbols.length > 0 ? `${krakenSymbols.length.toLocaleString()}` : '1,400+'})</span>
                </button>
              </div>
              <select
                value={assetPair}
                onChange={(e) => setAssetPair(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-2 text-xs font-mono text-white focus:border-emerald-800 focus:outline-none cursor-pointer"
              >
                {/* Custom current pair if not in popular */}
                {assetPair && !popularSymbols.includes(assetPair) && (
                  <option value={assetPair}>{assetPair} (Selected)</option>
                )}

                {/* Popular Spot Pairs */}
                <optgroup label="Popular Kraken & Kraken Pro Pairs">
                  {popularSymbols.map(sym => (
                    <option key={sym} value={sym}>{sym}</option>
                  ))}
                </optgroup>

                {/* USD Quote Pairs */}
                {usdSymbols.length > 0 && (
                  <optgroup label={`USD Pairs (${usdSymbols.length})`}>
                    {usdSymbols.map(sym => (
                      <option key={sym} value={sym}>{sym}</option>
                    ))}
                  </optgroup>
                )}

                {/* EUR Quote Pairs */}
                {eurSymbols.length > 0 && (
                  <optgroup label={`EUR Pairs (${eurSymbols.length})`}>
                    {eurSymbols.map(sym => (
                      <option key={sym} value={sym}>{sym}</option>
                    ))}
                  </optgroup>
                )}

                {/* USDT Quote Pairs */}
                {usdtSymbols.length > 0 && (
                  <optgroup label={`USDT Pairs (${usdtSymbols.length})`}>
                    {usdtSymbols.map(sym => (
                      <option key={sym} value={sym}>{sym}</option>
                    ))}
                  </optgroup>
                )}

                {/* BTC Quote Pairs */}
                {btcSymbols.length > 0 && (
                  <optgroup label={`BTC Pairs (${btcSymbols.length})`}>
                    {btcSymbols.map(sym => (
                      <option key={sym} value={sym}>{sym}</option>
                    ))}
                  </optgroup>
                )}

                {/* Other Quote Pairs */}
                {otherSymbols.length > 0 && (
                  <optgroup label={`Other Kraken Pairs (${otherSymbols.length})`}>
                    {otherSymbols.slice(0, 200).map(sym => (
                      <option key={sym} value={sym}>{sym}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  Kraken Zeitrahmen (OHLC)
                </label>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-1 py-0.5 rounded">
                  Kraken API
                </span>
              </div>
              <select
                value={interval}
                onChange={(e) => setIntervalVal(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-2 text-xs font-mono text-white focus:border-emerald-800 focus:outline-none cursor-pointer"
              >
                {!KRAKEN_OFFICIAL_TIMEFRAMES.some(t => t.value === interval) && (
                  <option value={interval}>{interval}m (Benutzerdefiniert)</option>
                )}
                {KRAKEN_OFFICIAL_TIMEFRAMES.map((tf) => (
                  <option key={tf.value} value={tf.value}>
                    {tf.label} – {tf.ohlc}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* DEDICATED EXECUTION QUEUE SELECTOR (LEVEL 2 PAPER VS LEVEL 4 LIVE) */}
          <div className="bg-zinc-950/80 border border-zinc-800/90 rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Zap className={`w-4 h-4 ${executionMode === 'live' ? 'text-rose-400 animate-pulse' : 'text-amber-400'}`} />
                <div>
                  <span className="text-xs font-mono font-semibold text-white block">Worker Execution Queue</span>
                  <span className="text-[10px] font-mono text-zinc-500 block">Independent Strategy Thread</span>
                </div>
              </div>
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                executionMode === 'live'
                  ? 'bg-rose-950/80 border-rose-700 text-rose-300'
                  : 'bg-amber-950/80 border-amber-700 text-amber-300'
              }`}>
                {executionMode === 'live' ? 'LEVEL 4 LIVE' : 'LEVEL 2 PAPER'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <button
                type="button"
                onClick={() => handleRequestQueueChange('paper')}
                className={`p-2 rounded border text-left transition-all ${
                  executionMode === 'paper'
                    ? 'bg-amber-950/40 border-amber-600 text-amber-300 shadow-sm ring-1 ring-amber-500/20'
                    : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <div className="font-bold flex items-center justify-between">
                  <span>Paper Queue</span>
                  <span className="text-[9px] bg-amber-950 px-1 py-0.2 rounded border border-amber-800">L2</span>
                </div>
                <div className="text-[10px] text-zinc-500 mt-1 leading-tight">
                  Guarded simulation, Kraken validate=true
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleRequestQueueChange('live')}
                className={`p-2 rounded border text-left transition-all ${
                  executionMode === 'live'
                    ? 'bg-rose-950/40 border-rose-600 text-rose-300 shadow-sm ring-1 ring-rose-500/20'
                    : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <div className="font-bold flex items-center justify-between">
                  <span>Live Queue</span>
                  <span className="text-[9px] bg-rose-950 px-1 py-0.2 rounded border border-rose-800">L4</span>
                </div>
                <div className="text-[10px] text-zinc-500 mt-1 leading-tight">
                  Autonomous real order dispatch on Kraken Pro
                </div>
              </button>
            </div>
            <p className="text-[10px] font-mono text-zinc-500 leading-relaxed">
              *Workers deployed on this queue run independently. Toggling the global menu switch will not stop or alter this worker's queue.
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1.5 flex justify-between">
              <span>Variables Config (JSON)</span>
              <Settings className="w-3.5 h-3.5 text-zinc-500" />
            </label>
            <textarea
              value={paramsStr}
              onChange={(e) => setParamsStr(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-emerald-400 placeholder-zinc-700 h-24 focus:border-emerald-800 focus:outline-none"
            />
          </div>

          {/* DEDICATED GLOBAL HARD STOP CONFIGURATION SECTION */}
          <div className="bg-zinc-950/80 border border-zinc-800/90 rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ShieldAlert className={`w-4 h-4 ${hardStopEnabled ? 'text-rose-400' : 'text-zinc-500'}`} />
                <div>
                  <span className="text-xs font-mono font-semibold text-white block">Global Hard Stop</span>
                  <span className="text-[10px] font-mono text-zinc-500 block">Emergency CLI Cancel-All</span>
                </div>
              </div>

              {/* Toggle Switch */}
              <button
                type="button"
                role="switch"
                aria-checked={hardStopEnabled}
                onClick={() => setHardStopEnabled(!hardStopEnabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  hardStopEnabled ? 'bg-rose-600' : 'bg-zinc-800'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    hardStopEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {hardStopEnabled ? (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-zinc-400">Hard Stop Threshold:</span>
                  <span className="font-bold text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-900/60">
                    -{hardStopPercent.toFixed(1)}% Max Loss
                  </span>
                </div>

                {/* Preset % buttons */}
                <div className="grid grid-cols-4 gap-1.5 text-[10px] font-mono">
                  {[2.5, 5.0, 7.5, 10.0].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setHardStopPercent(pct)}
                      className={`py-1 rounded border transition-all ${
                        hardStopPercent === pct
                          ? 'bg-rose-950 border-rose-700 text-rose-300 font-semibold'
                          : 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>

                {/* Custom Slider / Input */}
                <div className="flex items-center space-x-2 pt-0.5">
                  <input
                    type="range"
                    min="1"
                    max="25"
                    step="0.5"
                    value={hardStopPercent}
                    onChange={(e) => setHardStopPercent(Number(e.target.value))}
                    className="w-full accent-rose-500 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-zinc-400 shrink-0 w-9 text-right">{hardStopPercent}%</span>
                </div>

                <p className="text-[10px] font-mono text-zinc-500 leading-tight">
                  Breaching -{hardStopPercent}% drawdown sends an emergency <span className="text-rose-400 font-semibold">cancel all</span> signal to Kraken CLI and halts workers.
                </p>
              </div>
            ) : (
              <div className="text-[10px] font-mono text-zinc-500 bg-zinc-900/40 p-2 rounded border border-zinc-850">
                Hard Stop is disabled. Strategy will run without automated emergency loss cutoff.
              </div>
            )}

            {/* Immediate Manual Emergency Signal Trigger Button */}
            <button
              type="button"
              onClick={handleTriggerEmergencyStop}
              disabled={isTriggeringEmergency}
              className="w-full bg-rose-950/60 hover:bg-rose-900/70 border border-rose-800/80 hover:border-rose-700 text-rose-300 hover:text-white py-1.5 px-2 rounded text-[11px] font-mono font-medium transition-all flex items-center justify-center space-x-1.5 group"
              title="Immediately send emergency cancel-all signal to Kraken CLI"
            >
              <AlertOctagon className="w-3.5 h-3.5 text-rose-400 group-hover:scale-110 transition-transform" />
              <span>{isTriggeringEmergency ? "Dispatching Signal..." : "🚨 Emergency Cancel All (Kraken CLI)"}</span>
            </button>

            {emergencyFeedback && (
              <div className="p-2 rounded bg-rose-950/90 border border-rose-800 text-[10px] font-mono text-rose-200">
                {emergencyFeedback}
              </div>
            )}
          </div>

          {isCreating && (
            <div className="border border-zinc-800 p-3 rounded bg-zinc-950 space-y-2">
              <span className="block text-[10px] font-mono text-zinc-500 uppercase">Load Prebuilt Base Boilerplate</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => loadTemplate('scalper')}
                  className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 px-2 py-1 text-[11px] font-mono text-zinc-300 rounded text-left flex items-center space-x-1"
                >
                  <FileText className="w-3 h-3 text-zinc-500" />
                  <span>Scalper Code</span>
                </button>
                <button
                  onClick={() => loadTemplate('breakout')}
                  className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 px-2 py-1 text-[11px] font-mono text-zinc-300 rounded text-left flex items-center space-x-1"
                >
                  <FileText className="w-3 h-3 text-zinc-500" />
                  <span>EMA Breakout</span>
                </button>
              </div>
            </div>
          )}

          {!isCreating && selectedStrategy && (
            <div className="pt-2 border-t border-zinc-800 space-y-2">
              <div className="flex justify-between space-x-2">
                <button
                  onClick={() => onToggleRun(
                    selectedStrategy.id, 
                    selectedStrategy.status === 'active' ? 'stop' : 'start',
                    executionMode
                  )}
                  className={`flex-1 py-2 rounded text-xs font-mono font-bold transition-all flex items-center justify-center space-x-1.5 border shadow-sm ${
                    selectedStrategy.status === 'active'
                      ? 'bg-rose-950/60 border-rose-800 hover:bg-rose-900/60 text-rose-300'
                      : executionMode === 'live'
                        ? 'bg-rose-950/50 border-rose-800/80 hover:bg-rose-900/60 text-rose-300'
                        : 'bg-emerald-950/50 border-emerald-800/80 hover:bg-emerald-900/60 text-emerald-300'
                  }`}
                >
                  {selectedStrategy.status === 'active' ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-rose-400" />
                      <span>HALT WORKER (RUNNING ON {(selectedStrategy.executionMode || 'paper').toUpperCase()} QUEUE)</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>DEPLOY ON {executionMode.toUpperCase()} QUEUE ({executionMode === 'live' ? 'LEVEL 4' : 'LEVEL 2'})</span>
                    </>
                  )}
                </button>

                {selectedStrategy.status === 'archived' ? (
                  onRestoreStrategy && (
                    <button
                      onClick={() => onRestoreStrategy(selectedStrategy.id)}
                      className="bg-purple-950/60 border border-purple-800/80 hover:border-purple-600 hover:bg-purple-900/60 text-purple-300 px-3 rounded transition-all flex items-center space-x-1 text-xs font-mono font-semibold"
                      title="Restore Strategy back to Active Orchestrator"
                    >
                      <ArchiveRestore className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Restore</span>
                    </button>
                  )
                ) : (
                  onArchiveStrategy && (
                    <button
                      onClick={() => {
                        if (confirm(`Move strategy "${selectedStrategy.name}" to the archives? This keeps its history but removes it from the main orchestrator view.`)) {
                          onArchiveStrategy(selectedStrategy.id);
                        }
                      }}
                      className="bg-zinc-950 border border-zinc-850 hover:border-amber-800/60 hover:bg-amber-950/20 text-zinc-500 hover:text-amber-400 px-3 rounded transition-all"
                      title="Move to Archives"
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                  )
                )}

                <button
                  onClick={() => {
                    if (confirm(`Are you sure you want to delete strategy: ${selectedStrategy.name}?`)) {
                      onDeleteStrategy(selectedStrategy.id);
                    }
                  }}
                  className="bg-zinc-950 border border-zinc-850 hover:border-rose-900/50 hover:bg-rose-950/20 text-zinc-500 hover:text-rose-400 px-3 rounded transition-all"
                  title="Delete Strategy"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Script Editor Workspace */}
        <div className="flex-1 flex flex-col min-h-0 bg-zinc-950">
          <div className="bg-zinc-950 border-b border-zinc-900 px-4 py-2 flex items-center justify-between">
            <span className="text-[10px] font-mono text-zinc-500 uppercase">Interactive Algorithm Sandboxed Editor</span>
            <button
              onClick={isCreating ? handleCreateNew : handleSave}
              disabled={isSaving}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-950 disabled:text-emerald-700 text-black px-4 py-1 rounded text-xs font-mono font-semibold transition-all flex items-center space-x-1"
            >
              {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>{isCreating ? "Deploy Worker" : "Commit Changes"}</span>
            </button>
          </div>

          <div className="flex-1 flex min-h-0">
            {/* Simulated Line numbers */}
            <div className="w-10 bg-zinc-950 border-r border-zinc-900/60 py-4 text-right pr-2 select-none font-mono text-[11px] text-zinc-700 leading-6 hidden sm:block">
              {Array.from({ length: Math.max(15, code.split('\n').length + 5) }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>

            {/* Main Raw Code Editor Textarea */}
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="flex-1 bg-zinc-950/60 p-4 font-mono text-xs text-zinc-100 placeholder-zinc-800 leading-6 border-0 focus:outline-none resize-none overflow-y-auto h-full w-full outline-none focus:ring-0"
              spellCheck="false"
              placeholder="// Write standard javascript logic block..."
            />
          </div>
        </div>
      </div>

      {/* KRAKEN & KRAKEN PRO SYMBOL DIRECTORY MODAL */}
      <KrakenSymbolModal
        isOpen={isSymbolModalOpen}
        onClose={() => setIsSymbolModalOpen(false)}
        onSelectSymbol={(sym) => setAssetPair(sym)}
        currentSymbol={assetPair}
        symbols={krakenSymbols}
        isLoading={isLoadingSymbols}
        onRefreshSymbols={fetchKrakenSymbols}
      />

      {/* STRATEGY QUEUE SWITCH CONFIRMATION MODAL */}
      <StrategyQueueConfirmModal
        isOpen={isQueueConfirmOpen}
        strategy={selectedStrategy}
        targetQueue={pendingQueueTarget}
        onConfirm={handleConfirmQueueSwitch}
        onCancel={() => setIsQueueConfirmOpen(false)}
        isLoading={isSwitchingQueue}
      />
    </div>
  );
}
