import { useState, useEffect } from "react";
import { 
  Sparkles, Bot, AlertTriangle, Lightbulb, Check, ChevronRight, 
  RefreshCw, Wrench, BookOpen, Layers, ArrowRight, ShieldAlert,
  Sliders, FileCode, CheckCircle2, ShieldCheck, Zap
} from "lucide-react";
import { TradingStrategy, AuditReport, TweakedStrategyResult } from "../types";

interface AIReviewerProps {
  currentStrategy?: TradingStrategy | null;
  strategies?: TradingStrategy[];
  onInsertGeneratedStrategy: (strategy: any) => void;
  onUpdateStrategy?: (strategy: Partial<TradingStrategy>) => Promise<void>;
  onReloadStrategies?: () => Promise<void>;
}

export default function AIReviewer({ 
  currentStrategy, 
  strategies = [],
  onInsertGeneratedStrategy,
  onUpdateStrategy,
  onReloadStrategies
}: AIReviewerProps) {
  const currentCode = currentStrategy?.code || null;
  const currentName = currentStrategy?.name || null;

  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDebugging, setIsDebugging] = useState(false);
  const [isTweaking, setIsTweaking] = useState(false);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  
  const [aiResult, setAiResult] = useState<any>(null);
  const [debugResult, setDebugResult] = useState<AuditReport | null>(null);
  const [tweakedResult, setTweakedResult] = useState<TweakedStrategyResult | null>(null);
  const [manifestInsights, setManifestInsights] = useState<any>(null);
  
  const [activeTab, setActiveTab] = useState<'generate' | 'audit' | 'manifest'>('generate');
  const [customTweakNote, setCustomTweakNote] = useState("");
  const [applySuccessMsg, setApplySuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const suggestions = [
    "Hybrid MACD Momentum + RSI oversold filter",
    "Volatility breakout with trailing stop-loss",
    "Dynamic spread scalper on high SOL volume"
  ];

  // Fetch Manifest Learned Knowledge Insights
  const fetchManifestInsights = async () => {
    setIsLoadingInsights(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/ai/manifest-learn");
      if (res.ok) {
        const data = await res.json();
        setManifestInsights(data);
      }
    } catch (err: any) {
      console.error("Failed to load manifest insights:", err);
      setErrorMsg("Failed to load manifest insights. Please try again.");
    } finally {
      setIsLoadingInsights(false);
    }
  };

  // Trigger strategy generation grounded in manifest
  const handleGenerate = async (queryText: string) => {
    const textToQuery = queryText || prompt;
    if (!textToQuery.trim()) return;

    setIsGenerating(true);
    setAiResult(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: textToQuery })
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = `Failed to generate strategy (${res.status})`;
        try {
          const parsed = JSON.parse(text);
          if (parsed.error) msg = parsed.error;
        } catch {}
        setErrorMsg(msg);
        return;
      }
      const data = await res.json();
      setAiResult(data);
    } catch (err: any) {
      console.error("Generate error:", err);
      setErrorMsg("Error generating strategy. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Trigger audit of the currently selected strategy script
  const handleDebugCode = async () => {
    if (!currentCode) return;
    setIsDebugging(true);
    setDebugResult(null);
    setTweakedResult(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/ai/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: currentCode, name: currentName })
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = `Failed to review strategy (${res.status})`;
        try {
          const parsed = JSON.parse(text);
          if (parsed.error) msg = parsed.error;
        } catch {}
        setErrorMsg(msg);
        return;
      }
      const data = await res.json();
      setDebugResult(data);
    } catch (err: any) {
      console.error("Debug error:", err);
      setErrorMsg("Error auditing strategy. Please try again.");
    } finally {
      setIsDebugging(false);
    }
  };

  // Trigger auto-tweaking the strategy according to the audit report
  const handleTweakStrategy = async () => {
    if (!currentStrategy || !debugResult) return;
    setIsTweaking(true);
    setTweakedResult(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/ai/tweak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy: currentStrategy,
          auditReport: debugResult,
          customInstruction: customTweakNote.trim() || undefined
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setErrorMsg(errData.error || "Tweak request failed. Please try again.");
        return;
      }

      const data = await res.json();
      setTweakedResult(data);
    } catch (err: any) {
      console.error("Tweak error:", err);
      setErrorMsg("Error tweaking strategy. Please try again.");
    } finally {
      setIsTweaking(false);
    }
  };

  // Apply tweaks directly to the active selected strategy
  const handleApplyTweaksToCurrent = async () => {
    if (!tweakedResult || !currentStrategy || !onUpdateStrategy) return;
    try {
      await onUpdateStrategy({
        id: currentStrategy.id,
        name: tweakedResult.name || currentStrategy.name,
        description: tweakedResult.description || currentStrategy.description,
        assetPair: tweakedResult.assetPair || currentStrategy.assetPair,
        interval: tweakedResult.interval || currentStrategy.interval,
        parameters: tweakedResult.parameters || currentStrategy.parameters,
        code: tweakedResult.code || currentStrategy.code
      });

      setApplySuccessMsg("✅ Tweaks successfully applied to current strategy!");
      if (onReloadStrategies) await onReloadStrategies();
      setTimeout(() => setApplySuccessMsg(null), 3500);
    } catch (err) {
      console.error("Failed to apply tweaks:", err);
    }
  };

  // Save tweaked strategy as a new strategy entry
  const handleSaveTweaksAsNew = () => {
    if (!tweakedResult) return;
    onInsertGeneratedStrategy({
      name: tweakedResult.name,
      description: tweakedResult.description,
      assetPair: tweakedResult.assetPair,
      interval: tweakedResult.interval,
      parameters: tweakedResult.parameters,
      code: tweakedResult.code
    });
    setApplySuccessMsg("✅ Tweaked version saved as a new strategy!");
    setTimeout(() => setApplySuccessMsg(null), 3500);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col h-full overflow-hidden shadow-xl">
      {/* AI Header tabs */}
      <div className="bg-zinc-900/80 border-b border-zinc-800 px-3.5 py-2.5 flex justify-between items-center flex-wrap gap-2">
        <div className="flex items-center space-x-2 text-emerald-400">
          <Sparkles className="w-4 h-4 fill-emerald-500/10" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider">Gemini Quant Copilot</span>
        </div>

        <div className="flex space-x-1">
          <button
            onClick={() => setActiveTab('generate')}
            className={`px-2.5 py-1 text-[11px] font-mono rounded transition-all flex items-center space-x-1 ${
              activeTab === 'generate' ? 'bg-emerald-950/70 border border-emerald-900/60 text-emerald-400 font-semibold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <span>Generate</span>
          </button>
          
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-2.5 py-1 text-[11px] font-mono rounded transition-all flex items-center space-x-1 ${
              activeTab === 'audit' ? 'bg-emerald-950/70 border border-emerald-900/60 text-emerald-400 font-semibold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <span>Audit & Tweak</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('manifest');
              if (!manifestInsights) fetchManifestInsights();
            }}
            className={`px-2.5 py-1 text-[11px] font-mono rounded transition-all flex items-center space-x-1 ${
              activeTab === 'manifest' ? 'bg-emerald-950/70 border border-emerald-900/60 text-emerald-400 font-semibold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <BookOpen className="w-3 h-3 text-emerald-400" />
            <span>Manifest Learn</span>
          </button>
        </div>
      </div>

      {/* Persistent Manifest Learning Banner */}
      <div className="bg-zinc-950/80 px-3.5 py-1.5 border-b border-zinc-850 flex items-center justify-between text-[10px] font-mono">
        <div className="flex items-center space-x-1.5 text-zinc-400">
          <Layers className="w-3 h-3 text-emerald-400" />
          <span>Manifest Knowledge Base:</span>
          <span className="text-emerald-400 font-semibold">{strategies.length} active scripts ingested</span>
        </div>
        <span className="text-zinc-500">Gemini 3.7-Flash</span>
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {applySuccessMsg && (
          <div className="bg-emerald-950/60 border border-emerald-800 text-emerald-300 px-3 py-2 rounded text-xs font-mono flex items-center space-x-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{applySuccessMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="bg-rose-950/70 border border-rose-800 text-rose-300 px-3 py-2 rounded text-xs font-mono flex items-center justify-between animate-in fade-in">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button 
              onClick={() => setErrorMsg(null)}
              className="text-rose-400 hover:text-rose-200 text-[10px] uppercase font-bold ml-2 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* TAB 1: GENERATE STRATEGY (MANIFEST GROUNDED) */}
        {activeTab === 'generate' && (
          <div className="space-y-4">
            {/* Generation form */}
            <div className="space-y-2">
              <span className="block text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                Synthesize New Strategy (Learned from Manifest)
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Volume-weighted MACD with ATR trailing stop..."
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-xs font-mono text-white focus:border-emerald-700 focus:outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && handleGenerate("")}
                />
                <button
                  onClick={() => handleGenerate("")}
                  disabled={isGenerating}
                  className="bg-emerald-500 hover:bg-emerald-400 text-black px-3.5 rounded text-xs font-mono font-semibold flex items-center space-x-1 transition-all disabled:bg-emerald-950"
                >
                  {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <span>Build</span>}
                </button>
              </div>
            </div>

            {/* Suggestions cards */}
            {!aiResult && !isGenerating && (
              <div className="space-y-2">
                <span className="block text-[10px] font-mono text-zinc-500 uppercase">Quant Ideation Patterns:</span>
                <div className="space-y-2">
                  {suggestions.map((sug, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setPrompt(sug);
                        handleGenerate(sug);
                      }}
                      className="w-full text-left bg-zinc-950/40 hover:bg-zinc-950 border border-zinc-800/60 hover:border-zinc-800 p-2.5 rounded text-xs font-mono text-zinc-400 hover:text-emerald-400 transition-all flex items-center justify-between"
                    >
                      <span>{sug}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Loading state */}
            {isGenerating && (
              <div className="p-6 border border-zinc-800 rounded bg-zinc-950/40 text-center space-y-3">
                <Bot className="w-8 h-8 text-emerald-500 mx-auto animate-bounce" />
                <div className="space-y-1">
                  <p className="text-xs font-mono text-white font-medium">Gemini is synthesizing algorithmic code...</p>
                  <p className="text-[10px] font-mono text-zinc-500">
                    Applying paradigms learned from {strategies.length} manifest scripts
                  </p>
                </div>
              </div>
            )}

            {/* Generated results rendering */}
            {aiResult && (
              <div className="border border-zinc-800 rounded bg-zinc-950 p-4 space-y-3.5">
                <div className="flex justify-between items-start border-b border-zinc-800/80 pb-2.5">
                  <div>
                    <h5 className="text-xs font-mono font-bold text-white uppercase">{aiResult.name}</h5>
                    <span className="text-[10px] font-mono text-zinc-500 uppercase">Pair: {aiResult.assetPair} | Interval: {aiResult.interval}s</span>
                  </div>
                  <span className="bg-emerald-950 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded text-[9px] font-mono font-bold">
                    MANIFEST-INFORMED
                  </span>
                </div>

                <p className="text-xs font-mono text-zinc-400 leading-relaxed">{aiResult.description}</p>

                {/* Parameters list */}
                <div className="bg-zinc-900 border border-zinc-850 p-2.5 rounded">
                  <span className="block text-[9px] font-mono text-zinc-500 uppercase mb-1.5">Parameters Configured</span>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    {Object.keys(aiResult.parameters || {}).map((p) => (
                      <div key={p} className="flex justify-between">
                        <span className="text-zinc-500">{p}:</span>
                        <span className="text-emerald-400 font-semibold">{String(aiResult.parameters[p])}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => {
                    onInsertGeneratedStrategy(aiResult);
                    setAiResult(null);
                    setPrompt("");
                  }}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-black py-2 rounded text-xs font-mono font-bold flex items-center justify-center space-x-1.5 transition-all"
                >
                  <Check className="w-4 h-4" />
                  <span>LOAD INTO WORKSPACE & MANIFEST</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: AUDIT & TWEAK STRATEGY */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            {/* Audit Trigger Card */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="block text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  Selected Strategy for Audit
                </span>
                <span className="text-[10px] font-mono text-emerald-400 font-semibold truncate max-w-[140px]">
                  {currentName || "No strategy selected"}
                </span>
              </div>
              <p className="text-[11px] font-mono text-zinc-400">
                Audits syntax, unhandled edge cases, liquidation exposure, and compares with high-performing manifest algorithms.
              </p>
              <button
                onClick={handleDebugCode}
                disabled={isDebugging || !currentCode}
                className="w-full bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 disabled:bg-zinc-950/20 disabled:text-zinc-700 py-2.5 rounded text-xs font-mono font-medium text-white transition-all flex items-center justify-center space-x-1.5"
              >
                {isDebugging ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5 text-emerald-400" />}
                <span>{isDebugging ? "Scanning & Auditing Script..." : "Audit Active Strategy"}</span>
              </button>
            </div>

            {/* Audit Result Display */}
            {debugResult && (
              <div className="border border-zinc-800 rounded bg-zinc-950 p-4 space-y-3.5">
                <div className="flex justify-between items-center border-b border-zinc-800/80 pb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono font-bold text-white uppercase">Audit Report</span>
                    {debugResult.riskScore !== undefined && (
                      <span className="bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded text-[10px] font-mono text-zinc-300">
                        Risk Score: <strong className={debugResult.riskScore > 50 ? 'text-amber-400' : 'text-emerald-400'}>{debugResult.riskScore}/100</strong>
                      </span>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border uppercase ${
                    debugResult.status === 'clean' 
                      ? 'bg-emerald-950 text-emerald-400 border-emerald-900/50' 
                      : debugResult.status === 'error'
                      ? 'bg-rose-950 text-rose-400 border-rose-900/50'
                      : 'bg-amber-950 text-amber-400 border-amber-900/50'
                  }`}>
                    {debugResult.status}
                  </span>
                </div>

                <p className="text-xs font-mono text-zinc-400 leading-relaxed">{debugResult.summary}</p>

                {/* Identified Issues */}
                {debugResult.issues && debugResult.issues.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="block text-[9px] font-mono text-zinc-500 uppercase flex items-center">
                      <AlertTriangle className="w-3 h-3 text-amber-500 mr-1 shrink-0" />
                      Vulnerabilities & Risk Warnings
                    </span>
                    <ul className="space-y-1 text-[11px] font-mono text-zinc-300 list-disc pl-4">
                      {debugResult.issues.map((issue: string, i: number) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Recommendations */}
                <div className="bg-zinc-900 border border-zinc-850 p-3 rounded space-y-1.5">
                  <span className="block text-[9px] font-mono text-zinc-500 uppercase flex items-center">
                    <Lightbulb className="w-3 h-3 text-emerald-400 mr-1" />
                    Actionable Recommendations
                  </span>
                  <p className="text-[11px] font-mono text-zinc-400 leading-relaxed">
                    {debugResult.recommendations}
                  </p>
                </div>

                {/* Manifest Ingestion Insight */}
                {debugResult.manifestLearnedInsights && (
                  <div className="bg-emerald-950/20 border border-emerald-900/40 p-2.5 rounded text-[11px] font-mono text-emerald-300/90 leading-relaxed">
                    <span className="block text-[9px] font-semibold text-emerald-400 uppercase mb-1">
                      Learned from Manifest Context:
                    </span>
                    {debugResult.manifestLearnedInsights}
                  </div>
                )}

                {/* AUTO-TWEAK SECTION */}
                <div className="pt-2 border-t border-zinc-800/80 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase text-zinc-400 flex items-center space-x-1">
                      <Wrench className="w-3 h-3 text-emerald-400" />
                      <span>Gemini Auto-Tweaker</span>
                    </span>
                    <span className="text-[9px] text-zinc-500 font-mono">Applies all audit fixes</span>
                  </div>

                  <input
                    type="text"
                    value={customTweakNote}
                    onChange={(e) => setCustomTweakNote(e.target.value)}
                    placeholder="Optional tweak request (e.g. tighten stop-loss, add EMA filter)..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-[11px] font-mono text-zinc-200 placeholder-zinc-600 focus:border-emerald-700 focus:outline-none"
                  />

                  <button
                    onClick={handleTweakStrategy}
                    disabled={isTweaking}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-black py-2 rounded text-xs font-mono font-bold flex items-center justify-center space-x-1.5 transition-all shadow-md shadow-emerald-950"
                  >
                    {isTweaking ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Gemini is Tweaking Strategy...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>Tweak Strategy According to Audit</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* TWEAKED RESULT INSPECTOR & APPLY PANEL */}
            {tweakedResult && (
              <div className="border border-emerald-800/80 bg-zinc-950 p-4 rounded space-y-3.5 shadow-xl animate-in fade-in">
                <div className="flex justify-between items-start border-b border-zinc-800 pb-2">
                  <div>
                    <div className="flex items-center space-x-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <h5 className="text-xs font-mono font-bold text-white uppercase">{tweakedResult.name}</h5>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400">
                      Optimized Code & Parameter Calibrations
                    </span>
                  </div>
                  <span className="bg-emerald-950 border border-emerald-800 text-emerald-400 text-[9px] font-mono px-2 py-0.5 rounded font-semibold">
                    AUDIT RESOLVED
                  </span>
                </div>

                {/* Specific Tweaks Applied List */}
                <div className="space-y-1.5">
                  <span className="block text-[9px] font-mono text-zinc-500 uppercase font-semibold">
                    Tweaks Applied:
                  </span>
                  <ul className="space-y-1 text-[11px] font-mono text-zinc-200 list-disc pl-4">
                    {tweakedResult.tweaksApplied.map((tweak, i) => (
                      <li key={i} className="text-emerald-300/90">{tweak}</li>
                    ))}
                  </ul>
                </div>

                {/* Reasoning & Anticipated Improvements */}
                <div className="bg-zinc-900/90 border border-zinc-800 p-2.5 rounded space-y-1.5 text-[11px] font-mono">
                  <div>
                    <span className="text-zinc-500 block text-[9px] uppercase">Reasoning:</span>
                    <p className="text-zinc-300">{tweakedResult.reasoning}</p>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[9px] uppercase">Expected Yield/Safety Impact:</span>
                    <p className="text-emerald-400">{tweakedResult.expectedImprovement}</p>
                  </div>
                </div>

                {/* Parameter Changes */}
                <div className="bg-zinc-900 border border-zinc-850 p-2.5 rounded">
                  <span className="block text-[9px] font-mono text-zinc-500 uppercase mb-1">
                    Calibrated Parameters
                  </span>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    {Object.keys(tweakedResult.parameters || {}).map((p) => (
                      <div key={p} className="flex justify-between">
                        <span className="text-zinc-500">{p}:</span>
                        <span className="text-emerald-400 font-semibold">{String(tweakedResult.parameters[p])}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tweaked Code Snippet Box */}
                <div>
                  <span className="block text-[9px] font-mono text-zinc-500 uppercase mb-1">
                    Tweaked Execution Logic
                  </span>
                  <div className="bg-zinc-900/90 border border-zinc-850 rounded p-2.5 text-[10px] font-mono text-zinc-300 max-h-36 overflow-y-auto whitespace-pre">
                    {tweakedResult.code}
                  </div>
                </div>

                {/* Dual Action Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {onUpdateStrategy && currentStrategy && (
                    <button
                      onClick={handleApplyTweaksToCurrent}
                      className="bg-emerald-500 hover:bg-emerald-400 text-black py-2 rounded text-xs font-mono font-bold flex items-center justify-center space-x-1.5 transition-all"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Apply Tweaks to Current</span>
                    </button>
                  )}

                  <button
                    onClick={handleSaveTweaksAsNew}
                    className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 py-2 rounded text-xs font-mono font-semibold flex items-center justify-center space-x-1.5 transition-all"
                  >
                    <Sliders className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Save as New Strategy</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: MANIFEST KNOWLEDGE BASE & SYNERGIES */}
        {activeTab === 'manifest' && (
          <div className="space-y-4 text-xs font-mono">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white uppercase block">
                  Manifest Knowledge Base
                </span>
                <span className="text-[10px] text-zinc-500">
                  Learned from {strategies.length} persistent algorithms & live P&L data
                </span>
              </div>
              <button
                onClick={fetchManifestInsights}
                disabled={isLoadingInsights}
                className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-750 text-zinc-300 px-2.5 py-1 rounded text-[11px] font-mono flex items-center space-x-1"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingInsights ? 'animate-spin' : ''}`} />
                <span>Refresh Insights</span>
              </button>
            </div>

            {isLoadingInsights ? (
              <div className="p-8 border border-zinc-800 rounded bg-zinc-950/40 text-center space-y-2">
                <Bot className="w-6 h-6 text-emerald-400 mx-auto animate-spin" />
                <p className="text-xs text-zinc-300">Gemini is synthesizing cross-strategy manifest insights...</p>
              </div>
            ) : manifestInsights ? (
              <div className="space-y-3">
                {/* Learned Algorithmic Patterns */}
                <div className="bg-zinc-950 border border-zinc-800 p-3 rounded space-y-2">
                  <span className="text-[10px] text-zinc-500 uppercase block font-semibold">
                    Core Learned Algorithmic Patterns
                  </span>
                  <div className="space-y-1.5">
                    {(manifestInsights.learnedPatterns || []).map((pat: string, idx: number) => (
                      <div key={idx} className="flex items-start space-x-2 text-[11px] text-zinc-300">
                        <span className="text-emerald-400 font-bold">•</span>
                        <span>{pat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Manifest Synergy */}
                <div className="bg-zinc-950 border border-zinc-800 p-3 rounded space-y-1">
                  <span className="text-[10px] text-zinc-500 uppercase block font-semibold">
                    Cross-Strategy Synergy
                  </span>
                  <p className="text-zinc-300 text-[11px] leading-relaxed">
                    {manifestInsights.manifestSynergy}
                  </p>
                </div>

                {/* Collective Risk Overview */}
                <div className="bg-zinc-950 border border-zinc-800 p-3 rounded space-y-1">
                  <span className="text-[10px] text-zinc-500 uppercase block font-semibold flex items-center">
                    <ShieldAlert className="w-3 h-3 text-amber-400 mr-1" />
                    Manifest Risk Profile
                  </span>
                  <p className="text-zinc-300 text-[11px] leading-relaxed">
                    {manifestInsights.riskOverview}
                  </p>
                </div>

                {/* Suggested Manifest Upgrades */}
                {manifestInsights.suggestedImprovements && (
                  <div className="bg-zinc-950 border border-zinc-800 p-3 rounded space-y-2">
                    <span className="text-[10px] text-emerald-400 uppercase block font-semibold">
                      Suggested Manifest Upgrades
                    </span>
                    <ul className="space-y-1 list-disc pl-4 text-zinc-300 text-[11px]">
                      {manifestInsights.suggestedImprovements.map((imp: string, idx: number) => (
                        <li key={idx}>{imp}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded text-center text-zinc-500 text-xs">
                Click "Refresh Insights" to evaluate all {strategies.length} manifest algorithms with Gemini.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
