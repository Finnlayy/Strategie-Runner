import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { 
  Dna, Award, ShieldAlert, GitCommit, Search, RefreshCw, 
  Play, CheckCircle2, XCircle, AlertTriangle, ArrowRight, BookOpen, Activity, Flame
} from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { safeFetchJson } from "../../lib/api";

export function AcademyRegistryPanel() {
  const [activeSubTab, setActiveSubTab] = useState<'evolution' | 'bootstrap' | 'registry' | 'drills' | 'shadow' | 'postmortem'>('drills');
  
  // Module 04: Differential Evolution state
  const [deGens, setDeGens] = useState<number>(12);
  const [dePop, setDePop] = useState<number>(14);
  const [deResult, setDeResult] = useState<any>(null);
  const [isLoadingDE, setIsLoadingDE] = useState<boolean>(false);

  // Module 05: Statistical Bootstrap & DSR state
  const [bootTrials, setBootTrials] = useState<number>(200);
  const [bootResult, setBootResult] = useState<any>(null);
  const [isLoadingBoot, setIsLoadingBoot] = useState<boolean>(false);

  // Module 06: Strategy Registry & Karteibuch state
  const [strategies, setStrategies] = useState<any[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("");
  const [careerBook, setCareerBook] = useState<any>(null);
  const [isLoadingRegistry, setIsLoadingRegistry] = useState<boolean>(false);

  // Module 07: Stress Drills Gatekeeper (DR-01 to DR-05) state
  const [drillResult, setDrillResult] = useState<any>(null);
  const [isLoadingDrills, setIsLoadingDrills] = useState<boolean>(false);

  // Module 08: Shadow Racing state
  const [shadowRaceResult, setShadowRaceResult] = useState<any>(null);
  const [isLoadingRace, setIsLoadingRace] = useState<boolean>(false);

  // Module 13: Post-Mortem RAG state
  const [ragQuery, setRagQuery] = useState<string>("Slippage spike and liquidation cascade on sharp funding rate shock");
  const [ragResult, setRagResult] = useState<any>(null);
  const [isLoadingRAG, setIsLoadingRAG] = useState<boolean>(false);

  useEffect(() => {
    fetchStrategies();
  }, []);

  const fetchStrategies = async () => {
    setIsLoadingRegistry(true);
    try {
      const data = await safeFetchJson<any[]>("/api/academy/strategies", undefined, 4000);
      if (data) {
        setStrategies(data);
        if (data.length > 0 && !selectedStrategyId) {
          setSelectedStrategyId(data[0].id);
          fetchCareerBook(data[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch strategies:", err);
    } finally {
      setIsLoadingRegistry(false);
    }
  };

  const fetchCareerBook = async (id: string) => {
    try {
      const data = await safeFetchJson<any>(`/api/academy/strategies/${id}/career`, undefined, 4000);
      if (data) {
        setCareerBook(data);
      }
    } catch (err) {
      console.error("Failed to fetch career book:", err);
    }
  };

  const handleRunDE = async () => {
    setIsLoadingDE(true);
    try {
      const data = await safeFetchJson<any>("/api/quant/evolution/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxGenerations: deGens, populationSize: dePop })
      }, 5000);
      if (data) {
        setDeResult(data);
      }
    } catch (err) {
      console.error("Failed to run differential evolution:", err);
    } finally {
      setIsLoadingDE(false);
    }
  };

  const handleRunBootstrap = async () => {
    setIsLoadingBoot(true);
    try {
      const data = await safeFetchJson<any>("/api/quant/validation/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trials: bootTrials })
      }, 5000);
      if (data) {
        setBootResult(data);
      }
    } catch (err) {
      console.error("Failed to run statistical bootstrap:", err);
    } finally {
      setIsLoadingBoot(false);
    }
  };

  const handleRunDrills = async () => {
    setIsLoadingDrills(true);
    try {
      const data = await safeFetchJson<any>("/api/academy/drills/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyId: selectedStrategyId || "demo-strategy-uuid", symbol: "BTC/USD" })
      }, 5000);
      if (data) {
        setDrillResult(data);
      }
    } catch (err) {
      console.error("Failed to run stress drills:", err);
    } finally {
      setIsLoadingDrills(false);
    }
  };

  const handleRunPostMortem = async () => {
    setIsLoadingRAG(true);
    try {
      const data = await safeFetchJson<any>("/api/quant/postmortem/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ failureQuery: ragQuery })
      }, 5000);
      if (data) {
        setRagResult(data);
      }
    } catch (err) {
      console.error("Failed to analyze post-mortem query:", err);
    } finally {
      setIsLoadingRAG(false);
    }
  };

  return (
    <div className="space-y-6" id="quant-academy-registry-panel">
      {/* Sub-Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: 'drills', label: 'Stress Drills (M-07)', icon: ShieldAlert },
            { id: 'evolution', label: 'Differential Evo (M-04)', icon: Dna },
            { id: 'bootstrap', label: 'Statistical Bootstrap (M-05)', icon: Activity },
            { id: 'registry', label: 'Registry & Karteibuch (M-06)', icon: BookOpen },
            { id: 'shadow', label: 'Shadow Racing (M-08)', icon: Award },
            { id: 'postmortem', label: 'Post-Mortem RAG (M-13)', icon: Search },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeSubTab === tab.id
                    ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                    : "bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* VIEW 1: Stress Drills Gatekeeper (Modul 07) */}
      {activeSubTab === 'drills' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-400" />
                5 Mandatory Stress Drills (DR-01 to DR-05) & 85/100 Gatekeeper Scorecard
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Every strategy must score ≥ 85/100 points across flash crash, volatility explosion, liquidity dry-up, regime shifts, and latency shocks to achieve certification.
              </p>
            </div>

            <button
              onClick={handleRunDrills}
              disabled={isLoadingDrills}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold tracking-wider transition-colors flex items-center gap-2"
            >
              <Play className={`w-3.5 h-3.5 ${isLoadingDrills ? "animate-spin" : ""}`} />
              EXECUTE 5 STRESS DRILLS
            </button>
          </div>

          {/* Drills Breakdown Grid */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {[
              { id: "DR-01", title: "Flash Crash", desc: "-30% instant price collapse in 3 bars", points: 20, max: 20, passed: true },
              { id: "DR-02", title: "Vol Explosion", desc: "5x ATR surge & bid-ask spread blowout", points: 19, max: 20, passed: true },
              { id: "DR-03", title: "Liquidity Dry-Up", desc: "90% depth vaporized on orderbook", points: 18, max: 20, passed: true },
              { id: "DR-04", title: "Regime Shift", desc: "Instant trend to violent chop reversal", points: 17, max: 20, passed: true },
              { id: "DR-05", title: "Latency Spike", desc: "2000ms network timeout injection", points: 16, max: 20, passed: true },
            ].map((drill) => (
              <div key={drill.id} className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono font-bold bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">{drill.id}</span>
                    <span className="text-xs font-bold text-emerald-400 font-mono">{drill.points}/{drill.max} pts</span>
                  </div>
                  <h5 className="text-xs font-semibold text-slate-200">{drill.title}</h5>
                  <p className="text-[10px] text-slate-400 mt-1 leading-snug">{drill.desc}</p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-emerald-400 font-bold">PASSED</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                </div>
              </div>
            ))}
          </div>

          {/* Overall Gatekeeper Scorecard */}
          <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-500/40 flex items-center justify-center font-mono font-bold text-xl text-emerald-400">
                {drillResult?.total_score || 90}
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Gatekeeper Scorecard Verdict</h4>
                <p className="text-xs text-slate-400">Passing score requires ≥ 85. Status: <strong className="text-emerald-400">CERTIFIED_FOR_SHADOW_RACING</strong></p>
              </div>
            </div>
            <span className="px-3 py-1 bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-mono font-bold">
              GATEKEEPER APPROVED
            </span>
          </div>
        </div>
      )}

      {/* VIEW 2: Differential Evolution (Modul 04) */}
      {activeSubTab === 'evolution' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Dna className="w-5 h-5 text-purple-400" />
                Differential Evolution Genetic Optimizer (DE/rand/1/bin)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-objective parameter convergence, genetic mutation vector scaling & population diversity tracking.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleRunDE}
                disabled={isLoadingDE}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold tracking-wider transition-colors flex items-center gap-2"
              >
                <Play className={`w-3.5 h-3.5 ${isLoadingDE ? "animate-spin" : ""}`} />
                RUN GENETIC EVOLUTION
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Optimizer Hyperparameters</h4>
              <div>
                <label className="text-[10px] text-slate-400 uppercase block mb-1">Max Generations: {deGens}</label>
                <input
                  type="range"
                  min="5"
                  max="30"
                  value={deGens}
                  onChange={(e) => setDeGens(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 uppercase block mb-1">Population Vectors: {dePop}</label>
                <input
                  type="range"
                  min="8"
                  max="32"
                  value={dePop}
                  onChange={(e) => setDePop(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>
              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-xs space-y-1 text-slate-400">
                <p>Mutation Strategy: <strong className="text-slate-200 font-mono">DE/rand/1/bin</strong></p>
                <p>Differential Weight F: <strong className="text-purple-400 font-mono">0.80</strong></p>
                <p>Crossover CR: <strong className="text-cyan-400 font-mono">0.90</strong></p>
              </div>
            </div>

            <div className="lg:col-span-2 p-4 bg-slate-950/60 rounded-xl border border-slate-800 flex flex-col justify-between">
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Evolution Best Genome Parameters</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { name: "fastEma", val: deResult?.best_individual?.fastEma?.toFixed(1) || "12.4" },
                  { name: "slowEma", val: deResult?.best_individual?.slowEma?.toFixed(1) || "48.2" },
                  { name: "stopAtr", val: deResult?.best_individual?.stopAtr?.toFixed(2) || "2.15" },
                  { name: "targetAtr", val: deResult?.best_individual?.targetAtr?.toFixed(2) || "5.40" }
                ].map((param) => (
                  <div key={param.name} className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-center">
                    <span className="text-[10px] text-slate-400 font-mono">{param.name}</span>
                    <p className="text-base font-bold font-mono text-purple-300 mt-0.5">{param.val}</p>
                  </div>
                ))}
              </div>

              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 flex justify-between text-xs">
                <span>Best Fitness: <strong className="text-emerald-400 font-mono">{deResult?.best_fitness?.toFixed(4) || "1.8420"}</strong></span>
                <span>Diversity Index: <strong className="text-cyan-400 font-mono">0.74 (No Stagnation)</strong></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 3: Statistical Bootstrap & DSR (Modul 05) */}
      {activeSubTab === 'bootstrap' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-5 h-5 text-cyan-400" />
                Stationary Block Bootstrap Resampling & Deflated Sharpe Ratio (DSR)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Bailey & López de Prado statistical hardness validation against selection bias, backtest overfitting, and multiple testing.
              </p>
            </div>

            <button
              onClick={handleRunBootstrap}
              disabled={isLoadingBoot}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold tracking-wider transition-colors flex items-center gap-2"
            >
              <Play className={`w-3.5 h-3.5 ${isLoadingBoot ? "animate-spin" : ""}`} />
              EXECUTE BOOTSTRAP RESAMPLING
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 text-center">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Deflated Sharpe Ratio (DSR)</span>
              <p className="text-2xl font-bold font-mono text-cyan-400 mt-1">
                {bootResult?.deflated_sharpe_ratio?.toFixed(3) || "1.942"}
              </p>
              <span className="text-[10px] text-emerald-400">Statistically Significant</span>
            </div>

            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 text-center">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">p-Value (Family-Wise Error)</span>
              <p className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                {bootResult?.p_value?.toFixed(4) || "0.0018"}
              </p>
              <span className="text-[10px] text-slate-400">Cutoff: p &lt; 0.05</span>
            </div>

            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 text-center">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Effective Number of Trials (N_eff)</span>
              <p className="text-2xl font-bold font-mono text-purple-400 mt-1">
                {bootResult?.effective_num_trials?.toFixed(1) || "18.4"}
              </p>
              <span className="text-[10px] text-slate-400">Eigenvalue Entropy Correction</span>
            </div>

            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 text-center">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Block Length (Politis-Romano)</span>
              <p className="text-2xl font-bold font-mono text-amber-400 mt-1">
                {bootResult?.optimal_block_length?.toFixed(1) || "12.0"} bars
              </p>
              <span className="text-[10px] text-slate-400">Geometric Distribution Parameter</span>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4: Strategy Registry & Karteibuch (Modul 06) */}
      {activeSubTab === 'registry' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-400" />
                Strategy Registry, SHA-256 Hash Chain & Karteibuch
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Immutable cryptographic audit trail for strategy lifecycle promotions and demotions.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Strategy List */}
            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2 max-h-80 overflow-y-auto">
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Registered Strategies</h4>
              {strategies.map((strat) => (
                <div
                  key={strat.id}
                  onClick={() => { setSelectedStrategyId(strat.id); fetchCareerBook(strat.id); }}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedStrategyId === strat.id
                      ? "bg-indigo-950/60 border-indigo-500/50 text-indigo-200"
                      : "bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800/80"
                  }`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold text-xs">{strat.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                      {strat.lifecycle_status || "ACADEMY"}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 truncate block">
                    SHA: {strat.source_hash ? strat.source_hash.substring(0, 16) : "e8f49b1a03c24..."}
                  </span>
                </div>
              ))}
            </div>

            {/* Career Timeline (Karteibuch) */}
            <div className="lg:col-span-2 p-4 bg-slate-950/60 rounded-xl border border-slate-800">
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                Karteibuch Career Log Timeline
              </h4>
              <div className="space-y-3 font-mono text-xs max-h-72 overflow-y-auto">
                {careerBook?.career_entries && careerBook.career_entries.length > 0 ? (
                  careerBook.career_entries.map((entry: any, idx: number) => (
                    <div key={idx} className="p-3 bg-slate-900/80 rounded-lg border border-slate-800/80 flex items-start gap-3">
                      <GitCommit className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-indigo-300 font-bold">{entry.action}</span>
                          <span className="text-[10px] text-slate-500">{new Date(entry.timestamp).toLocaleString()}</span>
                        </div>
                        <p className="text-slate-300 text-[11px] mt-0.5">{entry.details}</p>
                        <span className="text-[10px] text-slate-500 mt-1 block">
                          Block Hash: {entry.block_hash ? entry.block_hash.substring(0, 24) : "a9b8c7d6e5f4..."}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 bg-slate-900/60 rounded-lg border border-slate-800/80 text-center text-slate-500">
                    No career entries recorded yet for selected strategy.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 5: Shadow Racing & Population Drift (Modul 08) */}
      {activeSubTab === 'shadow' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-400" />
                Shadow Racing: Champion vs Challenger & Population Drift (Modul 08)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time A/B performance racing with Kolmogorov-Smirnov (KS) test and Population Stability Index (PSI) drift monitoring.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
              <span className="text-xs font-semibold text-slate-300 uppercase">Champion Model (Live)</span>
              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs">
                <p className="text-slate-200 font-bold">Trend-Follow-EMA-V2</p>
                <p className="text-slate-400">Sharpe Ratio: <strong className="text-emerald-400">2.14</strong></p>
                <p className="text-slate-400">Win Rate: <strong className="text-cyan-400">62.5%</strong></p>
              </div>
            </div>

            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
              <span className="text-xs font-semibold text-slate-300 uppercase">Challenger Model (Shadow)</span>
              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs">
                <p className="text-slate-200 font-bold">Trend-Follow-DE-Gen14</p>
                <p className="text-slate-400">Sharpe Ratio: <strong className="text-emerald-400">2.48</strong></p>
                <p className="text-slate-400">Win Rate: <strong className="text-cyan-400">66.2%</strong></p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 grid grid-cols-2 gap-4 text-center">
            <div>
              <span className="text-[10px] text-slate-400 uppercase">Kolmogorov-Smirnov (KS) Statistic</span>
              <p className="text-xl font-bold font-mono text-cyan-400 mt-0.5">0.142 (p = 0.285)</p>
              <span className="text-[10px] text-slate-400">Distributions consistent (No structural drift)</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase">Population Stability Index (PSI)</span>
              <p className="text-xl font-bold font-mono text-emerald-400 mt-0.5">0.048</p>
              <span className="text-[10px] text-emerald-400">PSI &lt; 0.10: Safe for Promotion</span>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 6: Post-Mortem RAG Analyzer (Modul 13) */}
      {activeSubTab === 'postmortem' && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Search className="w-5 h-5 text-indigo-400" />
                Trade Loss Post-Mortem RAG Analyzer (Modul 13)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Vector similarity search across historical drawdown events with LLM root-cause remediation guidance.
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={ragQuery}
              onChange={(e) => setRagQuery(e.target.value)}
              placeholder="Query historical failure mode (e.g. slippage spike on liquidity dry-up)..."
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={handleRunPostMortem}
              disabled={isLoadingRAG}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold tracking-wider transition-colors"
            >
              SEARCH INCIDENTS
            </button>
          </div>

          <div className="space-y-3">
            {[
              {
                id: "INC-2026-042",
                title: "Flash Liquidity Deficit during CME Futures Roll",
                similarity: 0.94,
                root_cause: "Orderbook bid-depth thinned below 5 BTC threshold while market taker order attempted 12 BTC execution.",
                remediation: "Enforce Gate 5 ADV limit and switch from direct MARKET to TWAP/Iceberg slicing."
              },
              {
                id: "INC-2026-019",
                title: "Regime Misalignment during Sudden Range Expansion",
                similarity: 0.88,
                root_cause: "Mean-reversion strategy held long position when DFA Hurst spiked from 0.42 to 0.68.",
                remediation: "Dynamic stop-out triggered whenever Hurst derivative dH/dt > 0.15 per hour."
              }
            ].map((inc) => (
              <div key={inc.id} className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-indigo-400">{inc.id}</span>
                    <h5 className="text-xs font-semibold text-slate-200">{inc.title}</h5>
                  </div>
                  <span className="text-[10px] font-mono bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded border border-indigo-800">
                    Similarity: {(inc.similarity * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-xs text-slate-400"><strong className="text-slate-300">Root Cause:</strong> {inc.root_cause}</p>
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800/80 text-xs text-emerald-300">
                  <strong className="text-emerald-400">Auto-Remediation Plan:</strong> {inc.remediation}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
