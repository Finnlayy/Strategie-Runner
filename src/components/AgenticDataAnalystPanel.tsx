import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Bot, Sparkles, Terminal, Play, CheckCircle2, 
  Cpu, Activity, TrendingUp, ShieldAlert, Sliders, 
  Copy, Check, ArrowRight, RefreshCw, Layers, Zap,
  BarChart3, BrainCircuit, Code2, AlertTriangle, ChevronDown, ChevronUp
} from "lucide-react";
import { TradingStrategy } from "../types";

export interface AgenticDataAnalystPanelProps {
  currentStrategy?: TradingStrategy | null;
  strategies?: TradingStrategy[];
  onApplyStrategyParameters?: (params: { hardStopPercent?: number; parameters?: Record<string, any> }) => void;
}

interface AnalystStep {
  type: "reasoning" | "code_execution" | "tool_call" | "synthesis";
  title: string;
  content: string;
  code?: string;
  output?: string;
  timestamp: string;
  durationMs?: number;
}

interface AnalysisResult {
  query: string;
  model: string;
  agent: string;
  summary: string;
  steps: AnalystStep[];
  computedMetrics: Record<string, any>;
  recommendations: string[];
  executionTimeMs: number;
  timestamp: string;
}

interface PresetItem {
  id: string;
  category: string;
  title: string;
  query: string;
}

export default function AgenticDataAnalystPanel({
  currentStrategy,
  strategies = [],
  onApplyStrategyParameters,
}: AgenticDataAnalystPanelProps) {
  const [query, setQuery] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExecutingCustomCode, setIsExecutingCustomCode] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [currentResult, setCurrentResult] = useState<AnalysisResult | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({ 0: true, 1: true, 2: true });

  // Load Presets on Mount
  useEffect(() => {
    fetch("/api/ai/managed-agent/presets")
      .then((res) => {
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) return null;
        return res.json();
      })
      .then((data) => {
        if (data && data.presets && Array.isArray(data.presets)) {
          setPresets(data.presets);
        }
      })
      .catch((err) => console.warn("Could not load agentic presets:", err));
  }, []);

  const handleRunAnalysis = async (queryText?: string) => {
    const textToRun = (queryText || query).trim();
    if (!textToRun) return;

    setIsAnalyzing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/ai/managed-agent/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: textToRun,
          context: {
            selectedStrategy: currentStrategy ? {
              name: currentStrategy.name,
              assetPair: currentStrategy.assetPair,
              interval: currentStrategy.interval,
              hardStopPercent: currentStrategy.hardStopPercent,
              parameters: currentStrategy.parameters,
            } : null,
          }
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const rawText = await res.text();
        if (rawText.includes("<!doctype") || rawText.includes("<html") || !res.ok) {
          throw new Error(`The Agentic Analysis service is temporarily initializing (${res.status}). Please try again.`);
        }
        throw new Error(`Server returned unexpected format (${res.status})`);
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server responded with status ${res.status}`);
      }

      setCurrentResult(data);
      setHistory((prev) => [data, ...prev.slice(0, 9)]);
      setQuery("");
      // Expand all steps for the new result
      setExpandedSteps({ 0: true, 1: true, 2: true, 3: true });
    } catch (err: any) {
      console.warn("Agentic Analysis notice:", err.message);
      setErrorMsg(err.message || "Failed to execute agentic data analysis.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReexecuteCode = async (pythonCode: string) => {
    if (!pythonCode.trim()) return;
    setIsExecutingCustomCode(true);
    try {
      const res = await fetch("/api/ai/managed-agent/execute-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pythonCode }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Sandbox execution format error (${res.status})`);
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Execution failed with code ${res.status}`);
      }
      if (currentResult) {
        // Update the code execution step output
        const updatedSteps = currentResult.steps.map((s) => {
          if (s.type === "code_execution") {
            return {
              ...s,
              output: data.stdout || data.stderr || "Executed with code 0",
              durationMs: data.durationMs,
            };
          }
          return s;
        });
        setCurrentResult({ ...currentResult, steps: updatedSteps });
      }
      setSuccessMsg(`Sandbox execution finished in ${data.durationMs}ms`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg("Sandbox execution error: " + err.message);
    } finally {
      setIsExecutingCustomCode(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Hero / Metadata Banner */}
      <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="p-2.5 rounded-lg bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 shrink-0">
              <BrainCircuit className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5 flex-wrap">
                <h2 className="text-base font-mono font-bold text-white tracking-wide">
                  Agentic Data Analyst
                </h2>
                <span className="bg-indigo-950/80 border border-indigo-700/70 text-indigo-300 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center space-x-1">
                  <Sparkles className="w-3 h-3" />
                  <span>Gemini 3.8 Flash (Default)</span>
                </span>
                <span className="bg-zinc-800 text-zinc-300 text-[10px] font-mono px-2 py-0.5 rounded-full">
                  Managed Agent
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1 max-w-3xl leading-relaxed">
                Autonomous analytical agent that formulates mathematical hypotheses, writes and executes Python/DuckDB code, and derives empirical risk bounds, Sharpe enhancements, and volatility models.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs font-mono shrink-0">
            <div className="bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800 flex items-center space-x-2">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-zinc-400">Sandbox:</span>
              <span className="text-emerald-300 font-bold">NumPy + DuckDB</span>
            </div>
            <div className="bg-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-800 flex items-center space-x-2">
              <Cpu className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-zinc-400">Execution:</span>
              <span className="text-blue-300 font-bold">Code Sandbox</span>
            </div>
          </div>
        </div>
      </div>

      {/* Preset Quick Actions */}
      <div className="space-y-2">
        <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider font-semibold">
          Quantitative Inquiry Presets
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setQuery(p.query);
                handleRunAnalysis(p.query);
              }}
              disabled={isAnalyzing}
              className="text-left p-3 rounded-lg border bg-zinc-900/60 hover:bg-zinc-900 border-zinc-800/80 hover:border-indigo-700/60 transition-all group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                  <span className="text-indigo-400 font-semibold">{p.category}</span>
                  <span className="text-zinc-600 group-hover:text-indigo-300 transition-colors">Select &amp; Run &rarr;</span>
                </div>
                <h4 className="text-xs font-mono font-bold text-zinc-200 group-hover:text-white line-clamp-1">
                  {p.title}
                </h4>
              </div>
              <p className="text-[11px] text-zinc-500 line-clamp-2 mt-1.5 leading-normal">
                {p.query}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Input Form */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <label className="block text-xs font-mono text-zinc-300 font-bold flex items-center justify-between">
          <span className="flex items-center space-x-1.5">
            <Bot className="w-4 h-4 text-indigo-400" />
            <span>Prompt the Agentic Data Analyst</span>
          </span>
          {currentStrategy && (
            <span className="text-[10px] font-normal text-zinc-500 font-mono">
              Bound Target: <span className="text-emerald-400 font-bold">{currentStrategy.name}</span> ({currentStrategy.assetPair})
            </span>
          )}
        </label>

        <div className="relative">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleRunAnalysis();
              }
            }}
            placeholder="E.g., Analyze 15m return kurtosis for BTC/USD, test for volatility clustering, write Python code to calculate GARCH parameters, and recommend optimal stop loss."
            rows={3}
            disabled={isAnalyzing}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] font-mono text-zinc-500">
            Press <kbd className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-300">Ctrl+Enter</kbd> or click to execute
          </span>
          <button
            onClick={() => handleRunAnalysis()}
            disabled={isAnalyzing || !query.trim()}
            className={`px-4 py-2 rounded-lg text-xs font-mono font-bold flex items-center space-x-2 transition-all ${
              isAnalyzing || !query.trim()
                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-750"
                : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md hover:shadow-indigo-500/20 cursor-pointer"
            }`}
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Agent Reasoning &amp; Executing Code...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Agentic Analysis</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Status Alerts */}
      {errorMsg && (
        <div className="p-3.5 bg-rose-950/40 border border-rose-800/60 rounded-lg text-xs font-mono text-rose-300 flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 bg-emerald-950/40 border border-emerald-800/60 rounded-lg text-xs font-mono text-emerald-300 flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Current Analysis Result: Dynamic Proof of Work Display */}
      {currentResult && (
        <div className="space-y-6">
          {/* Header of the Result */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2 text-[10px] font-mono text-zinc-500">
                <span>MODEL: <strong className="text-indigo-300">{currentResult.model}</strong></span>
                <span>•</span>
                <span>EXECUTION: <strong className="text-emerald-400">{currentResult.executionTimeMs}ms</strong></span>
                <span>•</span>
                <span>TIME: {new Date(currentResult.timestamp).toLocaleTimeString()}</span>
              </div>
              <h3 className="text-sm font-mono font-bold text-white mt-1">
                Inquiry: {currentResult.query}
              </h3>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono text-zinc-400 bg-zinc-950 px-2.5 py-1 rounded border border-zinc-800 flex items-center space-x-1.5">
                <Check className="w-3 h-3 text-emerald-400" />
                <span>Deterministic Computation</span>
              </span>
            </div>
          </div>

          {/* Computed Metrics Bar */}
          {Object.keys(currentResult.computedMetrics).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {Object.entries(currentResult.computedMetrics)
                .filter(([k]) => k !== "model")
                .map(([key, value]) => (
                  <div key={key} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block truncate">
                      {key.replace(/([A-Z])/g, " $1")}
                    </span>
                    <span className="text-base font-mono font-bold text-white mt-0.5 block">
                      {typeof value === "number" ? value.toFixed(2) : String(value)}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {/* PROOF OF WORK: Dynamic Agent Step Cards */}
          <div className="space-y-3">
            <h4 className="text-xs font-mono font-bold text-zinc-400 uppercase tracking-wider flex items-center space-x-2">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>Agent Proof of Work &amp; Execution Pipeline</span>
            </h4>

            {currentResult.steps.map((step, idx) => (
              <div
                key={idx}
                className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden transition-all"
              >
                {/* Step Header */}
                <button
                  onClick={() => toggleStep(idx)}
                  className="w-full p-3.5 flex items-center justify-between text-left hover:bg-zinc-850/50 transition-colors"
                >
                  <div className="flex items-center space-x-2.5">
                    {step.type === "reasoning" && (
                      <BrainCircuit className="w-4 h-4 text-indigo-400 shrink-0" />
                    )}
                    {step.type === "code_execution" && (
                      <Code2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                    {step.type === "synthesis" && (
                      <TrendingUp className="w-4 h-4 text-cyan-400 shrink-0" />
                    )}
                    <span className="text-xs font-mono font-bold text-zinc-200">
                      {step.title}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-zinc-500 text-xs">
                    {step.durationMs && (
                      <span className="text-[10px] font-mono">{step.durationMs}ms</span>
                    )}
                    {expandedSteps[idx] ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </button>

                {/* Step Body */}
                {expandedSteps[idx] && (
                  <div className="p-4 border-t border-zinc-800/80 bg-zinc-950/60 space-y-3">
                    {step.content && (
                      <p className="text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">
                        {step.content}
                      </p>
                    )}

                    {/* Executable Code Block */}
                    {step.code && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 bg-zinc-900 px-3 py-1.5 rounded-t border border-zinc-800">
                          <span className="flex items-center space-x-1.5 text-emerald-400 font-bold">
                            <Code2 className="w-3 h-3" />
                            <span>Python / NumPy Quantitative Model</span>
                          </span>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => copyToClipboard(step.code!)}
                              className="hover:text-white flex items-center space-x-1"
                            >
                              {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedCode ? "Copied" : "Copy Code"}</span>
                            </button>
                            <button
                              onClick={() => handleReexecuteCode(step.code!)}
                              disabled={isExecutingCustomCode}
                              className="text-emerald-400 hover:text-emerald-300 font-bold flex items-center space-x-1 ml-2"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>{isExecutingCustomCode ? "Executing..." : "Re-run in Sandbox"}</span>
                            </button>
                          </div>
                        </div>
                        <pre className="p-3 bg-zinc-950 border border-zinc-800 rounded-b text-[11px] font-mono text-zinc-200 overflow-x-auto">
                          <code>{step.code}</code>
                        </pre>
                      </div>
                    )}

                    {/* Execution Output Console */}
                    {step.output && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 bg-zinc-900 px-3 py-1.5 rounded-t border border-zinc-800">
                          <span className="flex items-center space-x-1.5 text-zinc-300 font-semibold">
                            <Terminal className="w-3 h-3 text-cyan-400" />
                            <span>Sandbox Terminal Output</span>
                          </span>
                          <span className="text-emerald-400 text-[9px] uppercase font-bold">Exit Code 0</span>
                        </div>
                        <pre className="p-3 bg-black border border-zinc-800 rounded-b text-[11px] font-mono text-emerald-300/90 overflow-x-auto max-h-48">
                          <code>{step.output}</code>
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Actionable Recommendations & Bridge to Strategy Orchestrator */}
          <div className="bg-zinc-900/90 border border-indigo-900/50 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>Actionable Alpha &amp; Parameter Recommendations</span>
              </h4>
              {currentStrategy && (
                <span className="text-xs font-mono text-zinc-400">
                  Target: <strong className="text-white">{currentStrategy.name}</strong>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {currentResult.recommendations.map((rec, i) => (
                <div
                  key={i}
                  className="p-3 bg-zinc-950/80 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-300 flex items-start space-x-2.5"
                >
                  <span className="text-indigo-400 font-bold shrink-0">{i + 1}.</span>
                  <span className="leading-relaxed">{rec}</span>
                </div>
              ))}
            </div>

            {/* Bridge Button */}
            {onApplyStrategyParameters && currentStrategy && (
              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => {
                    const stopRec = currentResult.computedMetrics?.recommendedStopLossPct;
                    onApplyStrategyParameters({
                      hardStopPercent: typeof stopRec === "number" ? stopRec : undefined,
                      parameters: currentResult.computedMetrics,
                    });
                    setSuccessMsg("Applied analyst risk boundaries to " + currentStrategy.name);
                    setTimeout(() => setSuccessMsg(null), 4000);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold rounded-lg flex items-center space-x-2 shadow-sm transition-all cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Apply Recommended Boundaries to Strategy</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Session History Drawer / Previous Analyses */}
      {history.length > 1 && (
        <div className="space-y-2 pt-4">
          <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider font-semibold">
            Recent Agentic Inquiries ({history.length})
          </span>
          <div className="space-y-1.5">
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => setCurrentResult(h)}
                className={`w-full text-left p-2.5 rounded-lg border text-xs font-mono flex items-center justify-between transition-colors ${
                  currentResult === h
                    ? "bg-zinc-800 border-indigo-500 text-white font-bold"
                    : "bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:bg-zinc-900"
                }`}
              >
                <span className="truncate max-w-xl">{h.query}</span>
                <span className="text-[10px] text-zinc-500 shrink-0">
                  {new Date(h.timestamp).toLocaleTimeString()} ({h.executionTimeMs}ms)
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
