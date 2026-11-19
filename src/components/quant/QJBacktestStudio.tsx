import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Gauge,
  History,
  Play,
  RefreshCw,
  Scale,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Wand2,
  XCircle,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BacktestEquityPoint,
  QjEngineCapabilities,
  QjEnrichedBacktestResult,
  QjModelParam,
  QjOptimizationResult,
  QjRunSummary,
  QjStressResult,
  QjTrial,
  QjWalkForwardResult,
  TradingStrategy,
} from '../../types';
import {
  compareQjRuns,
  deleteQjRun,
  getQjCapabilities,
  getQjRun,
  listQjRuns,
  qjArtifactUrl,
  QjApiError,
  runQjBacktest,
  runQjOptimization,
  runQjStress,
  runQjWalkForward,
} from '../../lib/qjBacktest';

interface QJBacktestStudioProps {
  strategies: TradingStrategy[];
  selectedStrategy: TradingStrategy | null;
  onSelectStrategy: (strategy: TradingStrategy) => void;
}

type StudioTab = 'results' | 'walkforward' | 'optimization' | 'stress' | 'runs';
type ActionKind = 'backtest' | 'walkforward' | 'optimization' | 'stress' | null;

const POPULAR_SYMBOLS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD', 'DOGE/USD', 'LINK/USD', 'AVAX/USD'];
const INTERVALS = [1, 5, 15, 30, 60, 240, 1440];
const OBJECTIVES = ['sharpe', 'sortino', 'calmar', 'total_return', 'cagr', 'profit_factor'];
const ALLOCATION_METHODS = ['equal_weight', 'inverse_volatility', 'fixed_fraction', 'signal_weighted'];
const REBALANCE_FREQUENCIES = ['signal', 'bar', 'D', 'W', 'BME', 'BQE', 'NONE'];

function num(value: any): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmt(value: any, digits = 2, suffix = ''): string {
  const parsed = num(value);
  if (parsed === null) return '—';
  return `${parsed.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${suffix}`;
}

function compact(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function parseJsonObject(text: string, label: string): Record<string, any> {
  const trimmed = (text || '').trim();
  if (!trimmed) return {};
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error: any) {
    throw new Error(`${label} is not valid JSON: ${error?.message || 'parse error'}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function parseJsonArray(text: string, label: string): number[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error: any) {
    throw new Error(`${label} is not valid JSON: ${error?.message || 'parse error'}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`);
  return parsed.map((value) => Number(value)).filter((value) => Number.isFinite(value));
}

function inferStudioModel(strategy: TradingStrategy | null): { model: string; params: Record<string, any> } {
  const params = strategy?.parameters || {};
  const code = (strategy?.code || '').toLowerCase();
  if (params.fastPeriod || params.slowPeriod || code.includes('macd')) {
    return {
      model: 'macd_trend',
      params: {
        fast: Number(params.fastPeriod) || 12,
        slow: Number(params.slowPeriod) || 26,
        signal: Number(params.signalPeriod) || 9,
      },
    };
  }
  if (params.rsiPeriod || params.oversold || code.includes('rsi')) {
    return {
      model: 'rsi_reversion',
      params: {
        period: Number(params.rsiPeriod) || 14,
        oversold: Math.min(49, Number(params.oversold) || 30),
        exit_level: Number(params.overbought) || 55,
      },
    };
  }
  if (params.gridLevels) {
    return { model: 'bollinger_reversion', params: { period: 20, num_std: 2 } };
  }
  if (params.fast || params.slow) {
    return {
      model: 'sma_cross',
      params: { fast: Number(params.fast) || 20, slow: Number(params.slow) || 60 },
    };
  }
  return { model: 'sma_cross', params: { fast: 20, slow: 60 } };
}

const MetricCard: React.FC<{ label: string; value: string; hint?: string; tone?: 'good' | 'bad' | 'neutral' }> = ({
  label,
  value,
  hint,
  tone = 'neutral',
}) => {
  const toneClass = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : 'text-zinc-100';
  return (
    <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-3">
      <span className="block text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={`block mt-1 text-lg font-mono font-bold ${toneClass}`}>{value}</span>
      {hint && <span className="block mt-0.5 text-[10px] font-mono text-zinc-500 truncate">{hint}</span>}
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode; right?: React.ReactNode }> = ({
  title,
  children,
  right,
}) => (
  <section className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
    <div className="flex items-center justify-between gap-3 mb-3">
      <h3 className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
      {right}
    </div>
    {children}
  </section>
);

const Warnings: React.FC<{ items?: string[] }> = ({ items }) => {
  if (!items || items.length === 0) return null;
  return (
    <div className="bg-amber-950/40 border border-amber-800/60 rounded-lg p-3 text-[11px] font-mono text-amber-200 space-y-1">
      <div className="flex items-center space-x-1.5 font-semibold text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>Research warnings</span>
      </div>
      {items.map((item, index) => (
        <div key={`${index}-${item}`} className="flex items-start space-x-1.5">
          <ChevronRight className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
};

function equityChartData(points: BacktestEquityPoint[] | undefined, maxPoints = 400) {
  if (!points || points.length === 0) return [];
  const step = Math.max(1, Math.floor(points.length / maxPoints));
  const sampled = points.filter((_, index) => index % step === 0);
  if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]);
  return sampled.map((point) => ({
    time: point.time,
    equity: point.equity,
    benchmark: point.benchmarkEquity,
    drawdown: point.drawdown,
    price: point.price,
  }));
}

const EquityCharts: React.FC<{ points?: BacktestEquityPoint[]; height?: number }> = ({ points, height = 260 }) => {
  const data = useMemo(() => equityChartData(points), [points]);
  if (data.length === 0) {
    return <div className="text-xs font-mono text-zinc-500 py-6 text-center">No equity curve available</div>;
  }
  return (
    <div className="space-y-3">
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="qjEquity" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#34d399" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
            <XAxis dataKey="time" stroke="#71717a" tick={{ fontSize: 10 }} minTickGap={40} />
            <YAxis stroke="#71717a" tick={{ fontSize: 10 }} width={64} />
            <Tooltip
              contentStyle={{ background: '#09090b', border: '1px solid #27272a', fontSize: 11, fontFamily: 'monospace' }}
              labelStyle={{ color: '#a1a1aa' }}
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'monospace' }} />
            <Area type="monotone" dataKey="equity" name="Strategy NAV" stroke="#34d399" strokeWidth={2} fill="url(#qjEquity)" />
            <Line type="monotone" dataKey="benchmark" name="Benchmark" stroke="#60a5fa" strokeWidth={1.4} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ width: '100%', height: 140 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="qjDrawdown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#fb7185" stopOpacity={0.5} />
                <stop offset="95%" stopColor="#fb7185" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
            <XAxis dataKey="time" stroke="#71717a" tick={{ fontSize: 10 }} minTickGap={60} />
            <YAxis stroke="#71717a" tick={{ fontSize: 10 }} width={54} />
            <Tooltip
              contentStyle={{ background: '#09090b', border: '1px solid #27272a', fontSize: 11, fontFamily: 'monospace' }}
              formatter={(value: any) => [`${Number(value).toFixed(2)}%`, 'Drawdown']}
            />
            <Area type="monotone" dataKey="drawdown" stroke="#fb7185" strokeWidth={1.4} fill="url(#qjDrawdown)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const TradesTable: React.FC<{ trades: any[] }> = ({ trades }) => {
  if (!trades || trades.length === 0) {
    return <div className="text-xs font-mono text-zinc-500 py-4 text-center">No trades reconstructed for this run.</div>;
  }
  return (
    <div className="max-h-80 overflow-auto border border-zinc-800 rounded-lg">
      <table className="w-full text-[11px] font-mono">
        <thead className="sticky top-0 bg-zinc-950/95 text-zinc-400">
          <tr>
            {['ID', 'Symbol', 'Side', 'Entry', 'Exit', 'Entry Px', 'Exit Px', 'Qty', 'PnL', 'PnL %', 'Status'].map((head) => (
              <th key={head} className="text-left px-2 py-1.5 border-b border-zinc-800 whitespace-nowrap">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id} className="border-b border-zinc-900/70">
              <td className="px-2 py-1.5 text-zinc-500">{trade.id}</td>
              <td className="px-2 py-1.5 text-zinc-300">{trade.symbol || '—'}</td>
              <td className={`px-2 py-1.5 ${trade.type === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {trade.side || trade.type}
              </td>
              <td className="px-2 py-1.5 text-zinc-500 whitespace-nowrap">{String(trade.entryTime || '').slice(0, 16)}</td>
              <td className="px-2 py-1.5 text-zinc-500 whitespace-nowrap">{trade.exitTime ? String(trade.exitTime).slice(0, 16) : '—'}</td>
              <td className="px-2 py-1.5 text-zinc-300">{fmt(trade.entryPrice, 4)}</td>
              <td className="px-2 py-1.5 text-zinc-300">{trade.exitPrice != null ? fmt(trade.exitPrice, 4) : '—'}</td>
              <td className="px-2 py-1.5 text-zinc-400">{fmt(trade.amount, 6)}</td>
              <td className={`px-2 py-1.5 ${num(trade.pnl) !== null && Number(trade.pnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {fmt(trade.pnl, 2)}
              </td>
              <td className="px-2 py-1.5 text-zinc-400">{fmt(trade.pnlPercent, 2, '%')}</td>
              <td className={`px-2 py-1.5 ${trade.status === 'open' ? 'text-amber-400' : 'text-zinc-500'}`}>{trade.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Artifacts: React.FC<{ runId?: string; artifacts?: { name: string; bytes?: number; url?: string }[] }> = ({
  runId,
  artifacts,
}) => {
  if (!runId) return null;
  const items = artifacts && artifacts.length > 0
    ? artifacts
    : [
        { name: 'dashboard.html', bytes: undefined },
        { name: 'summary.json', bytes: undefined },
        { name: 'metrics.csv', bytes: undefined },
        { name: 'trades.csv', bytes: undefined },
        { name: 'equity_curve.csv', bytes: undefined },
      ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((artifact) => (
        <a
          key={artifact.name}
          href={artifact.url || qjArtifactUrl(runId, artifact.name)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded border border-zinc-700 bg-zinc-950 hover:border-emerald-600 hover:text-emerald-300 text-[10px] font-mono text-zinc-300 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          <span>{artifact.name}</span>
          {artifact.bytes ? <span className="text-zinc-600">{(artifact.bytes / 1024).toFixed(0)}k</span> : null}
        </a>
      ))}
    </div>
  );
};

export const QJBacktestStudio: React.FC<QJBacktestStudioProps> = ({
  strategies,
  selectedStrategy,
  onSelectStrategy,
}) => {
  const [capabilities, setCapabilities] = useState<QjEngineCapabilities | null>(null);
  const [capError, setCapError] = useState<string | null>(null);
  const [capsLoading, setCapsLoading] = useState<boolean>(true);

  const [strategyId, setStrategyId] = useState<string>(selectedStrategy?.id || strategies[0]?.id || 'custom');
  const [symbols, setSymbols] = useState<string[]>([selectedStrategy?.assetPair || 'BTC/USD']);
  const [customSymbol, setCustomSymbol] = useState<string>('');
  const [interval, setIntervalMinutes] = useState<number>(selectedStrategy?.interval || 60);
  const [candleCount, setCandleCount] = useState<number>(720);
  const [capital, setCapital] = useState<number>(10000);
  const [feeBps, setFeeBps] = useState<number>(26);
  const [slippageBps, setSlippageBps] = useState<number>(5);

  const initialModel = inferStudioModel(selectedStrategy);
  const [model, setModel] = useState<string>(initialModel.model);
  const [params, setParams] = useState<Record<string, any>>(initialModel.params);
  const [allocationMethod, setAllocationMethod] = useState<string>('equal_weight');
  const [maxPositionSize, setMaxPositionSize] = useState<number>(1);
  const [longShort, setLongShort] = useState<boolean>(false);
  const [volTarget, setVolTarget] = useState<string>('');
  const [rebalanceFrequency, setRebalanceFrequency] = useState<string>('signal');
  const [driftThreshold, setDriftThreshold] = useState<string>('');
  const [onSignalChange, setOnSignalChange] = useState<boolean>(true);

  const [wfScheme, setWfScheme] = useState<'rolling' | 'expanding'>('rolling');
  const [trainBars, setTrainBars] = useState<number>(240);
  const [testBars, setTestBars] = useState<number>(96);
  const [stepBars, setStepBars] = useState<number>(96);
  const [purgeBars, setPurgeBars] = useState<number>(12);
  const [wfObjective, setWfObjective] = useState<string>('sharpe');
  const [wfGrid, setWfGrid] = useState<string>('{"fast":[10,20],"slow":[40,60]}');
  const [wfMaxTrials, setWfMaxTrials] = useState<number>(12);
  const [refit, setRefit] = useState<boolean>(true);

  const [optObjective, setOptObjective] = useState<string>('sharpe');
  const [optGrid, setOptGrid] = useState<string>('{"fast":[10,20],"slow":[40,60]}');
  const [optMaxTrials, setOptMaxTrials] = useState<number>(24);

  const [feeGrid, setFeeGrid] = useState<string>('[0,10,26,50]');
  const [slippageGrid, setSlippageGrid] = useState<string>('[0,5,15,40]');

  const [activeTab, setActiveTab] = useState<StudioTab>('results');
  const [action, setAction] = useState<ActionKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [result, setResult] = useState<QjEnrichedBacktestResult | null>(null);
  const [wfResult, setWfResult] = useState<QjWalkForwardResult | null>(null);
  const [optResult, setOptResult] = useState<QjOptimizationResult | null>(null);
  const [stressResult, setStressResult] = useState<QjStressResult | null>(null);

  const [runs, setRuns] = useState<QjRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState<boolean>(false);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<any>(null);

  const models = capabilities?.models || [];
  const modelDefinition = models.find((item) => item.id === model);
  const qjAvailable = capabilities?.qjAvailable ?? false;

  const loadCapabilities = async (force = false) => {
    setCapsLoading(true);
    try {
      const payload = await getQjCapabilities(force);
      setCapabilities(payload);
      setCapError(null);
      if (payload.models.length > 0) {
        const exists = payload.models.some((item) => item.id === model);
        if (!exists) {
          const next = inferStudioModel(selectedStrategy);
          setModel(next.model);
          setParams(next.params);
        }
      }
    } catch (err: any) {
      setCapError(err?.message || 'Unable to inspect the backtest engine');
    } finally {
      setCapsLoading(false);
    }
  };

  const loadRuns = async () => {
    setRunsLoading(true);
    try {
      const payload = await listQjRuns(50);
      setRuns(payload);
    } catch (err: any) {
      setError(err?.message || 'Unable to load run history');
    } finally {
      setRunsLoading(false);
    }
  };

  useEffect(() => {
    loadCapabilities(true);
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedStrategy) return;
    setStrategyId(selectedStrategy.id);
    if (selectedStrategy.assetPair) setSymbols([selectedStrategy.assetPair]);
    if (selectedStrategy.interval) setIntervalMinutes(selectedStrategy.interval);
    const next = inferStudioModel(selectedStrategy);
    setModel(next.model);
    setParams(next.params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStrategy?.id]);

  const applyModelDefaults = (modelId: string) => {
    setModel(modelId);
    const definition = models.find((item) => item.id === modelId);
    const defaults: Record<string, any> = {};
    definition?.params.forEach((param) => {
      defaults[param.key] = param.default;
    });
    setParams(defaults);
  };

  const updateParam = (key: string, value: any) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSymbol = (symbol: string) => {
    setSymbols((prev) => {
      if (prev.includes(symbol)) {
        return prev.length === 1 ? prev : prev.filter((item) => item !== symbol);
      }
      if (prev.length >= 12) return prev;
      return [...prev, symbol];
    });
  };

  const addCustomSymbol = () => {
    const cleaned = customSymbol.trim().toUpperCase();
    if (!cleaned) return;
    setSymbols((prev) => (prev.includes(cleaned) || prev.length >= 12 ? prev : [...prev, cleaned]));
    setCustomSymbol('');
  };

  const strategyName = strategies.find((item) => item.id === strategyId)?.name || 'QuantJourney Backtest';

  const basePayload = (): Record<string, any> => {
    const allocation: Record<string, any> = {
      method: allocationMethod,
      maxPositionSize,
      longShort,
    };
    if (volTarget.trim()) allocation.volTarget = Number(volTarget) / 100;
    const rebalance: Record<string, any> = {
      frequency: rebalanceFrequency,
      onSignalChange,
    };
    if (driftThreshold.trim()) rebalance.driftThreshold = Number(driftThreshold) / 100;
    return {
      strategyId,
      strategyName,
      symbols,
      intervalMinutes: interval,
      candleCount,
      initialCapital: capital,
      feeBps,
      slippageBps,
      source: 'payload',
      strategy: { model, params },
      allocation,
      rebalance,
      benchmarkSymbol: symbols[0],
      persist: true,
    };
  };

  const runAction = async (kind: Exclude<ActionKind, null>) => {
    setAction(kind);
    setError(null);
    setStatus(null);
    const startedAt = Date.now();
    try {
      if (kind === 'backtest') {
        const payload = await runQjBacktest(basePayload());
        setResult(payload);
        setActiveTab('results');
        setStatus(`Backtest completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s · ${payload.engine || 'engine'}`);
      } else if (kind === 'walkforward') {
        const payload = await runQjWalkForward({
          ...basePayload(),
          walkForward: {
            scheme: wfScheme,
            trainBars,
            testBars,
            stepBars,
            purgeBars,
            objective: wfObjective,
            paramGrid: parseJsonObject(wfGrid, 'Walk-forward grid'),
            maxTrials: wfMaxTrials,
            refit,
          },
        });
        setWfResult(payload);
        setActiveTab('walkforward');
        setStatus(`Walk-forward finished: ${payload.summary?.nFolds || 0} folds in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      } else if (kind === 'optimization') {
        const payload = await runQjOptimization({
          ...basePayload(),
          optimization: {
            objective: optObjective,
            paramGrid: parseJsonObject(optGrid, 'Optimisation grid'),
            maxTrials: optMaxTrials,
          },
        });
        setOptResult(payload);
        setActiveTab('optimization');
        setStatus(`Optimisation finished: ${payload.summary?.completedTrials || 0} trials in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      } else {
        const payload = await runQjStress({
          ...basePayload(),
          stress: {
            feeBpsGrid: parseJsonArray(feeGrid, 'Fee grid'),
            slippageBpsGrid: parseJsonArray(slippageGrid, 'Slippage grid'),
          },
        });
        setStressResult(payload);
        setActiveTab('stress');
        setStatus(`Cost stress finished: ${payload.summary?.scenarios || 0} scenarios in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      }
      await loadRuns();
    } catch (err: any) {
      const message = err instanceof QjApiError ? err.message : err?.message || 'Backtest failed';
      setError(message);
    } finally {
      setAction(null);
    }
  };

  const loadRun = async (runId: string) => {
    setError(null);
    try {
      const payload = await getQjRun(runId, true);
      const full = payload.payload || payload.result;
      if (!full) {
        setError('This run has no reloadable payload; open its dashboard artifact instead.');
        return;
      }
      if (full.kind === 'walkforward') {
        setWfResult(full as QjWalkForwardResult);
        setActiveTab('walkforward');
      } else if (full.kind === 'optimization') {
        setOptResult(full as QjOptimizationResult);
        setActiveTab('optimization');
      } else if (full.kind === 'stress') {
        setStressResult(full as QjStressResult);
        setActiveTab('stress');
      } else {
        setResult(full as QjEnrichedBacktestResult);
        setActiveTab('results');
      }
      setStatus(`Loaded run ${runId}`);
    } catch (err: any) {
      setError(err?.message || 'Unable to load run');
    }
  };

  const removeRun = async (runId: string) => {
    if (!window.confirm(`Delete run ${runId} and its artifacts?`)) return;
    try {
      await deleteQjRun(runId);
      setCompareSelection((prev) => prev.filter((item) => item !== runId));
      await loadRuns();
      setStatus(`Deleted run ${runId}`);
    } catch (err: any) {
      setError(err?.message || 'Unable to delete run');
    }
  };

  const runComparison = async () => {
    if (compareSelection.length < 2) {
      setError('Select at least two runs to compare.');
      return;
    }
    try {
      const payload = await compareQjRuns(compareSelection);
      setCompareResult(payload);
    } catch (err: any) {
      setError(err?.message || 'Comparison failed');
    }
  };

  const resultMetrics = result?.analytics?.metrics || {};
  const summary = result?.summary;
  const netReturn = num(resultMetrics.totalReturnPercent ?? summary?.totalReturnPercent);
  const sharpe = num(resultMetrics.sharpeRatio ?? summary?.sharpeRatio);
  const maxDrawdown = num(resultMetrics.maxDrawdownPercent ?? summary?.maxDrawdownPercent);
  const winRate = num(resultMetrics.winRate ?? summary?.winRate);
  const profitFactor = num(resultMetrics.profitFactor ?? summary?.profitFactor);
  const cagr = num(resultMetrics.cagrPercent);
  const sortino = num(resultMetrics.sortinoRatio ?? summary?.sortinoRatio);
  const calmar = num(resultMetrics.calmarRatio ?? summary?.calmarRatio);
  const exposure = num(resultMetrics.exposurePercent ?? summary?.exposurePercent);
  const trades = num(resultMetrics.totalTrades ?? summary?.totalTrades);
  const var95 = num(resultMetrics.var95Percent ?? summary?.var95Percent);
  const fees = num(resultMetrics.totalCostsUSD ?? summary?.totalFeesPaid);

  const tabs: { id: StudioTab; label: string; count?: number }[] = [
    { id: 'results', label: 'Results', count: result ? result.trades?.length : undefined },
    { id: 'walkforward', label: 'Walk-Forward', count: wfResult?.folds?.length },
    { id: 'optimization', label: 'Optimise', count: optResult?.trials?.length },
    { id: 'stress', label: 'Cost Stress', count: stressResult?.scenarios?.length },
    { id: 'runs', label: 'Run History', count: runs.length },
  ];

  const busy = action !== null;

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-10">
      {/* HEADER */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800 pb-4 mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-950/80 border border-indigo-800/60 flex items-center justify-center text-indigo-300 shadow-inner">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <h2 className="text-base sm:text-lg font-mono font-bold text-white tracking-tight">
                  QuantJourney Backtest Studio
                </h2>
                <span
                  className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${
                    qjAvailable
                      ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50'
                      : 'bg-amber-950/60 text-amber-300 border-amber-800/50'
                  }`}
                >
                  {capsLoading ? 'probing engine…' : qjAvailable ? 'quantjourney-bt' : 'native fallback'}
                </span>
                {capabilities?.versions?.quantjourneyBt && (
                  <span className="text-[10px] font-mono text-zinc-500">v{capabilities.versions.quantjourneyBt}</span>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5 font-mono">
                Signals → target weights → policy rebalancing → costs → NAV → analytics → walk-forward → optimisation → research packet.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => loadCapabilities(true)}
              disabled={capsLoading}
              className="px-3 py-1.5 rounded border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-200 text-xs font-mono flex items-center space-x-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${capsLoading ? 'animate-spin' : ''}`} />
              <span>Refresh Engine</span>
            </button>
            <button
              id="qj-run-backtest"
              onClick={() => runAction('backtest')}
              disabled={busy}
              className={`px-4 py-2 rounded font-mono font-bold text-xs flex items-center space-x-2 shadow-md transition-all ${
                busy
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950'
              }`}
            >
              {action === 'backtest' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              <span>{action === 'backtest' ? 'Running…' : 'Run Backtest'}</span>
            </button>
          </div>
        </div>

        {capError && (
          <div className="mb-3 text-[11px] font-mono text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded p-2">
            {capError}
          </div>
        )}
        {!qjAvailable && !capsLoading && (
          <div className="mb-3 text-[11px] font-mono text-amber-200 bg-amber-950/30 border border-amber-900/50 rounded p-2">
            The QuantJourney distribution is not installed. Install it with{' '}
            <code className="text-amber-300">pip install -r requirements.txt</code> to enable the full engine. The studio is
            showing the native fallback capability envelope.
          </div>
        )}
        {status && (
          <div className="mb-3 text-[11px] font-mono text-emerald-300 bg-emerald-950/30 border border-emerald-900/50 rounded p-2 flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{status}</span>
          </div>
        )}
        {error && (
          <div className="mb-3 text-[11px] font-mono text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded p-2 flex items-start space-x-1.5">
            <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* CONFIG */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs font-mono">
          <div className="space-y-1">
            <label className="text-zinc-400 block text-[10px] font-semibold uppercase tracking-wider">Strategy</label>
            <select
              value={strategyId}
              onChange={(e) => {
                setStrategyId(e.target.value);
                const match = strategies.find((item) => item.id === e.target.value);
                if (match) onSelectStrategy(match);
              }}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              {strategies.length === 0 && <option value="custom">Custom Strategy</option>}
              {strategies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-zinc-400 block text-[10px] font-semibold uppercase tracking-wider">Signal Model</label>
            <select
              value={model}
              onChange={(e) => applyModelDefaults(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              {models.length === 0 && <option value="sma_cross">SMA Trend</option>}
              {models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            {modelDefinition && <p className="text-[9px] text-zinc-500 leading-tight">{modelDefinition.description}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-zinc-400 block text-[10px] font-semibold uppercase tracking-wider">Bar Interval</label>
            <select
              value={interval}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              {INTERVALS.map((value) => (
                <option key={value} value={value}>
                  {value < 60 ? `${value} minutes` : value === 60 ? '1 hour' : value === 240 ? '4 hours' : '1 day'}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-zinc-400 block text-[10px] font-semibold uppercase tracking-wider">Sample Bars</label>
            <select
              value={candleCount}
              onChange={(e) => setCandleCount(Number(e.target.value))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              {[200, 300, 500, 720].map((value) => (
                <option key={value} value={value}>
                  {value} bars
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-zinc-400 block text-[10px] font-semibold uppercase tracking-wider">Initial Capital (USD)</label>
            <input
              type="number"
              value={capital}
              min={100}
              onChange={(e) => setCapital(Math.max(100, Number(e.target.value)))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-zinc-400 block text-[10px] font-semibold uppercase tracking-wider">Fee (bps)</label>
            <input
              type="number"
              value={feeBps}
              min={0}
              onChange={(e) => setFeeBps(Math.max(0, Number(e.target.value)))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-zinc-400 block text-[10px] font-semibold uppercase tracking-wider">Slippage (bps)</label>
            <input
              type="number"
              value={slippageBps}
              min={0}
              onChange={(e) => setSlippageBps(Math.max(0, Number(e.target.value)))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-zinc-400 block text-[10px] font-semibold uppercase tracking-wider">Allocation</label>
            <select
              value={allocationMethod}
              onChange={(e) => setAllocationMethod(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              {ALLOCATION_METHODS.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* SYMBOLS */}
        <div className="mt-3 space-y-1">
          <label className="text-zinc-400 block text-[10px] font-mono font-semibold uppercase tracking-wider">
            Universe ({symbols.length}/12)
          </label>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(new Set([...POPULAR_SYMBOLS, ...symbols])).map((symbol) => {
              const selected = symbols.includes(symbol);
              return (
                <button
                  key={symbol}
                  onClick={() => toggleSymbol(symbol)}
                  className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                    selected
                      ? 'bg-emerald-950/60 border-emerald-700/70 text-emerald-300'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {symbol}
                </button>
              );
            })}
            <div className="flex items-center gap-1">
              <input
                value={customSymbol}
                onChange={(e) => setCustomSymbol(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomSymbol();
                  }
                }}
                placeholder="ADD PAIR"
                className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[10px] text-zinc-200 focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={addCustomSymbol}
                className="px-2 py-1 rounded border border-zinc-700 text-[10px] font-mono text-zinc-300 hover:border-emerald-600"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* STRATEGY PARAMS */}
        {modelDefinition && modelDefinition.params.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center space-x-1.5 mb-1.5">
              <Settings2 className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-400">
                {modelDefinition.label} Parameters
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
              {modelDefinition.params.map((param: QjModelParam) => (
                <div key={param.key} className="space-y-0.5">
                  <label className="block text-[9px] font-mono text-zinc-500 uppercase">{param.label}</label>
                  {param.type === 'bool' ? (
                    <button
                      onClick={() => updateParam(param.key, !params[param.key])}
                      className={`w-full px-2 py-1 rounded text-[10px] font-mono border ${
                        params[param.key]
                          ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-300'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-500'
                      }`}
                    >
                      {params[param.key] ? 'TRUE' : 'FALSE'}
                    </button>
                  ) : param.type === 'json' ? (
                    <textarea
                      value={typeof params[param.key] === 'string' ? params[param.key] : JSON.stringify(params[param.key] ?? {}, null, 0)}
                      onChange={(e) => updateParam(param.key, e.target.value)}
                      rows={2}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[9px] font-mono text-zinc-200 focus:outline-none focus:border-emerald-500"
                    />
                  ) : (
                    <input
                      type="number"
                      step={param.type === 'float' ? 'any' : '1'}
                      value={params[param.key] ?? param.default}
                      onChange={(e) => updateParam(param.key, Number(e.target.value))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-zinc-200 focus:outline-none focus:border-emerald-500"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* EXECUTION / ADVANCED */}
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs font-mono">
          <div className="space-y-1">
            <label className="text-zinc-400 block text-[10px] font-semibold uppercase tracking-wider">Rebalance Policy</label>
            <select
              value={rebalanceFrequency}
              onChange={(e) => setRebalanceFrequency(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              {REBALANCE_FREQUENCIES.map((value) => (
                <option key={value} value={value}>
                  {value === 'signal' ? 'On signal change' : value === 'bar' ? 'Every bar' : value}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-zinc-400 block text-[10px] font-semibold uppercase tracking-wider">Max Position (%)</label>
            <input
              type="number"
              value={Math.round(maxPositionSize * 100)}
              min={1}
              max={100}
              onChange={(e) => setMaxPositionSize(Math.min(1, Math.max(0.01, Number(e.target.value) / 100)))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-zinc-400 block text-[10px] font-semibold uppercase tracking-wider">Drift Band (%)</label>
            <input
              type="number"
              value={driftThreshold}
              placeholder="off"
              min={0}
              max={100}
              onChange={(e) => setDriftThreshold(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-zinc-400 block text-[10px] font-semibold uppercase tracking-wider">Vol Target (%)</label>
            <input
              type="number"
              value={volTarget}
              placeholder="off"
              min={1}
              max={300}
              onChange={(e) => setVolTarget(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-mono text-zinc-400">
          <button
            onClick={() => setLongShort((prev) => !prev)}
            className={`px-2 py-1 rounded border ${longShort ? 'bg-indigo-950/60 border-indigo-700/60 text-indigo-300' : 'bg-zinc-950 border-zinc-800 text-zinc-500'}`}
          >
            {longShort ? 'LONG / SHORT' : 'LONG ONLY'}
          </button>
          <button
            onClick={() => setOnSignalChange((prev) => !prev)}
            className={`px-2 py-1 rounded border ${onSignalChange ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300' : 'bg-zinc-950 border-zinc-800 text-zinc-500'}`}
          >
            {onSignalChange ? 'SIGNAL-CHANGE TRIGGER' : 'CALENDAR ONLY'}
          </button>
          <span className="text-zinc-600">
            Costs: {(feeBps + slippageBps).toFixed(1)} bps per side · one-bar execution delay
          </span>
        </div>
      </div>

      {/* ADVANCED RUNS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <Activity className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-mono font-bold text-zinc-200">Walk-Forward</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <label className="space-y-0.5">
              <span className="text-zinc-500 uppercase">Scheme</span>
              <select value={wfScheme} onChange={(e) => setWfScheme(e.target.value as 'rolling' | 'expanding')} className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200">
                <option value="rolling">rolling</option>
                <option value="expanding">expanding</option>
              </select>
            </label>
            <label className="space-y-0.5">
              <span className="text-zinc-500 uppercase">Objective</span>
              <select value={wfObjective} onChange={(e) => setWfObjective(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200">
                {OBJECTIVES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            {[
              ['Train Bars', trainBars, setTrainBars],
              ['Test Bars', testBars, setTestBars],
              ['Step Bars', stepBars, setStepBars],
              ['Purge Bars', purgeBars, setPurgeBars],
            ].map(([label, value, setter]: any) => (
              <label key={label} className="space-y-0.5">
                <span className="text-zinc-500 uppercase">{label}</span>
                <input
                  type="number"
                  value={value}
                  min={0}
                  onChange={(e) => setter(Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200"
                />
              </label>
            ))}
            <label className="space-y-0.5 col-span-2">
              <span className="text-zinc-500 uppercase">Parameter Grid (JSON)</span>
              <input value={wfGrid} onChange={(e) => setWfGrid(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200" />
            </label>
            <label className="space-y-0.5">
              <span className="text-zinc-500 uppercase">Max Trials</span>
              <input type="number" value={wfMaxTrials} min={1} onChange={(e) => setWfMaxTrials(Number(e.target.value))} className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200" />
            </label>
            <button
              onClick={() => setRefit((prev) => !prev)}
              className={`self-end px-2 py-1 rounded border ${refit ? 'bg-indigo-950/60 border-indigo-700/60 text-indigo-300' : 'bg-zinc-950 border-zinc-800 text-zinc-500'}`}
            >
              {refit ? 'REFIT / FOLD' : 'FIXED PARAMS'}
            </button>
          </div>
          <button
            onClick={() => runAction('walkforward')}
            disabled={busy}
            className="mt-3 w-full py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-[11px] font-mono font-bold flex items-center justify-center space-x-1.5"
          >
            {action === 'walkforward' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
            <span>{action === 'walkforward' ? 'Validating…' : 'Validate Walk-Forward'}</span>
          </button>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <Target className="w-4 h-4 text-purple-400" />
            <h3 className="text-xs font-mono font-bold text-zinc-200">Grid Optimisation</h3>
          </div>
          <div className="space-y-2 text-[10px] font-mono">
            <label className="block space-y-0.5">
              <span className="text-zinc-500 uppercase">Objective</span>
              <select value={optObjective} onChange={(e) => setOptObjective(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200">
                {OBJECTIVES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="block space-y-0.5">
              <span className="text-zinc-500 uppercase">Parameter Grid (JSON)</span>
              <input value={optGrid} onChange={(e) => setOptGrid(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200" />
            </label>
            <label className="block space-y-0.5">
              <span className="text-zinc-500 uppercase">Max Trials</span>
              <input type="number" value={optMaxTrials} min={1} onChange={(e) => setOptMaxTrials(Number(e.target.value))} className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200" />
            </label>
          </div>
          <button
            onClick={() => runAction('optimization')}
            disabled={busy}
            className="mt-3 w-full py-1.5 rounded bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-[11px] font-mono font-bold flex items-center justify-center space-x-1.5"
          >
            {action === 'optimization' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            <span>{action === 'optimization' ? 'Optimising…' : 'Optimise Parameters'}</span>
          </button>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <Scale className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-mono font-bold text-zinc-200">Cost Stress</h3>
          </div>
          <div className="space-y-2 text-[10px] font-mono">
            <label className="block space-y-0.5">
              <span className="text-zinc-500 uppercase">Fee Grid (bps)</span>
              <input value={feeGrid} onChange={(e) => setFeeGrid(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200" />
            </label>
            <label className="block space-y-0.5">
              <span className="text-zinc-500 uppercase">Slippage Grid (bps)</span>
              <input value={slippageGrid} onChange={(e) => setSlippageGrid(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200" />
            </label>
            <p className="text-[9px] text-zinc-500 leading-snug pt-1">
              Re-runs the strategy across every fee/slippage combination to expose cost fragility and the breakeven bps level.
            </p>
          </div>
          <button
            onClick={() => runAction('stress')}
            disabled={busy}
            className="mt-3 w-full py-1.5 rounded bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 text-[11px] font-mono font-bold flex items-center justify-center space-x-1.5"
          >
            {action === 'stress' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Gauge className="w-3.5 h-3.5" />}
            <span>{action === 'stress' ? 'Stress testing…' : 'Run Cost Stress'}</span>
          </button>
        </div>
      </div>

      {/* TABS */}
      <div className="flex flex-wrap gap-1.5 border-b border-zinc-800 pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-t text-[11px] font-mono border-b-2 transition-colors flex items-center space-x-1.5 ${
              activeTab === tab.id
                ? 'border-emerald-500 text-emerald-300 bg-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* RESULTS */}
      {activeTab === 'results' && (
        <div className="space-y-4">
          {!result ? (
            <EmptyState
              icon={<BarChart3 className="w-8 h-8 text-zinc-600" />}
              title="No backtest yet"
              body="Configure a universe and signal model, then run the QuantJourney engine to produce metrics, an equity curve, a trade ledger and a research packet."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
                <MetricCard label="Net Return" value={fmt(netReturn, 2, '%')} tone={(netReturn ?? 0) >= 0 ? 'good' : 'bad'} hint={`Benchmark ${fmt(resultMetrics.benchmarkReturnPercent, 2, '%')}`} />
                <MetricCard label="CAGR" value={fmt(cagr, 2, '%')} hint={resultMetrics.cagrAnnualized === false ? 'sample-horizon' : 'annualised'} />
                <MetricCard label="Sharpe" value={fmt(sharpe, 2)} tone={(sharpe ?? 0) > 1 ? 'good' : (sharpe ?? 0) < 0 ? 'bad' : 'neutral'} hint={`Sortino ${fmt(sortino, 2)}`} />
                <MetricCard label="Calmar" value={fmt(calmar, 2)} hint={`Vol ${fmt(resultMetrics.annualizedVolatilityPercent, 1, '%')}`} />
                <MetricCard label="Max Drawdown" value={`-${fmt(maxDrawdown, 2, '%')}`} tone="bad" hint={`VaR95 ${fmt(var95, 2, '%')}`} />
                <MetricCard label="Win Rate" value={fmt(winRate, 1, '%')} tone={(winRate ?? 0) >= 50 ? 'good' : 'neutral'} hint={`PF ${fmt(profitFactor, 2)}`} />
                <MetricCard label="Trades" value={fmt(trades, 0)} hint={`Exposure ${fmt(exposure, 1, '%')}`} />
                <MetricCard label="Costs" value={fmt(fees, 2, ' USD')} hint={`${fmt(resultMetrics.turnoverRatio, 2)}x turnover`} />
                <MetricCard label="Alpha" value={fmt(resultMetrics.alphaPercent, 2, '%')} tone={(resultMetrics.alphaPercent ?? 0) >= 0 ? 'good' : 'bad'} hint={`β ${fmt(resultMetrics.beta, 2)}`} />
                <MetricCard label="Margin" value={result.analytics?.engine?.mode || 'weights'} hint={result.analytics?.engine?.policy || ''} />
                <MetricCard label="Engine" value={result.engine === 'quantjourney-bt' ? 'QJ' : 'Native'} hint={result.analytics?.engine?.version ? `v${result.analytics.engine.version}` : 'fallback'} />
                <MetricCard label="Bars" value={fmt(result.totalCandles, 0)} hint={result.analytics?.data?.source || 'payload'} />
              </div>

              <Warnings items={result.warnings} />

              <Section
                title="Equity & Drawdown"
                right={<Artifacts runId={result.runId || result.id} artifacts={result.artifacts} />}
              >
                <EquityCharts points={result.equityCurve} />
                <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-mono text-zinc-500">
                  <span>{result.periodLabel}</span>
                  <span>·</span>
                  <span>{result.analytics?.data?.symbols?.join(', ')}</span>
                  <span>·</span>
                  <span>benchmark: {result.analytics?.metrics?.benchmarkName || 'equal-weight'}</span>
                </div>
              </Section>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Section title="Trade Ledger">
                  <TradesTable trades={result.trades} />
                </Section>
                <Section title="Symbol Contribution">
                  <ContributionTable contribution={result.analytics?.contribution} />
                </Section>
              </div>

              <Section title="Engine Assumptions">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono text-zinc-400">
                  {Object.entries(result.analytics?.assumptions || {}).map(([key, value]) => (
                    <div key={key} className="bg-zinc-950/60 border border-zinc-800 rounded p-2">
                      <div className="text-zinc-600 uppercase text-[9px]">{key}</div>
                      <div className="text-zinc-300 truncate">{compact(value)}</div>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>
      )}

      {/* WALK-FORWARD */}
      {activeTab === 'walkforward' && (
        <div className="space-y-4">
          {!wfResult ? (
            <EmptyState
              icon={<Activity className="w-8 h-8 text-zinc-600" />}
              title="No walk-forward validation yet"
              body="Slice the history into rolling train/test folds, refit parameters on each train window and measure the untouched out-of-sample transfer."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
                <MetricCard label="OOS Sharpe" value={fmt(wfResult.summary?.oosSharpe, 2)} tone={(wfResult.summary?.oosSharpe ?? 0) > 0 ? 'good' : 'bad'} hint={`IS ${fmt(wfResult.summary?.inSampleSharpe, 2)}`} />
                <MetricCard label="OOS Return" value={fmt(wfResult.summary?.oosTotalReturnPercent, 2, '%')} hint={`${wfResult.summary?.nFolds || 0} folds`} />
                <MetricCard label="Efficiency" value={fmt(wfResult.summary?.efficiency, 2)} tone={(wfResult.summary?.efficiency ?? 0) > 0.7 ? 'good' : 'neutral'} hint="OOS / IS Sharpe" />
                <MetricCard label="Overfit Ratio" value={fmt(wfResult.summary?.overfitRatio, 2)} tone={(wfResult.summary?.overfitRatio ?? 0) > 2.5 ? 'bad' : 'good'} hint="IS / OOS Sharpe" />
                <MetricCard label="Deflated Sharpe" value={fmt(wfResult.summary?.deflatedSharpe, 3)} tone={(wfResult.summary?.deflatedSharpe ?? 0) >= 0.95 ? 'good' : 'neutral'} hint="multiple testing" />
                <MetricCard label="Consistency" value={fmt(wfResult.summary?.consistencyPercent, 1, '%')} hint={`decay ${fmt(wfResult.summary?.sharpeDecayPerFold, 3)}/fold`} />
              </div>

              <Warnings items={wfResult.warnings} />

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2">
                  <Section
                    title="Stitched Out-of-Sample Equity"
                    right={<Artifacts runId={wfResult.runId} artifacts={wfResult.artifacts} />}
                  >
                    <EquityCharts points={wfResult.equityCurve} height={230} />
                  </Section>
                </div>
                <Section title="Traffic Lights">
                  <div className="space-y-2">
                    {(wfResult.summary?.verdicts || []).map((verdict) => (
                      <div key={verdict.name} className="bg-zinc-950/60 border border-zinc-800 rounded p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono uppercase text-zinc-400">{verdict.name.replace(/_/g, ' ')}</span>
                          <span className={`w-2 h-2 rounded-full ${verdict.signal === 'green' ? 'bg-emerald-400' : verdict.signal === 'red' ? 'bg-rose-500' : 'bg-amber-400'}`} />
                        </div>
                        <div className="text-[11px] font-mono text-zinc-200">{fmt(verdict.value, 3)}</div>
                        <div className="text-[9px] font-mono text-zinc-500">{verdict.description}</div>
                      </div>
                    ))}
                    {(wfResult.summary?.verdicts || []).length === 0 && (
                      <div className="text-[10px] font-mono text-zinc-500">No verdicts available.</div>
                    )}
                    {wfResult.summary?.rankStabilityFailureRate != null && (
                      <div className="text-[10px] font-mono text-zinc-400">
                        Rank-stability failure rate: {fmt(wfResult.summary.rankStabilityFailureRate, 1, '%')}
                      </div>
                    )}
                  </div>
                </Section>
              </div>

              <Section title="Folds">
                <div className="overflow-auto max-h-80 border border-zinc-800 rounded-lg">
                  <table className="w-full text-[10px] font-mono">
                    <thead className="sticky top-0 bg-zinc-950/95 text-zinc-400">
                      <tr>
                        {['#', 'Train', 'Test', 'Best Params', 'IS Sharpe', 'OOS Sharpe', 'OOS Return', 'OOS DD', 'Status'].map((head) => (
                          <th key={head} className="text-left px-2 py-1.5 border-b border-zinc-800 whitespace-nowrap">{head}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {wfResult.folds.map((fold) => (
                        <tr key={fold.fold} className="border-b border-zinc-900/70">
                          <td className="px-2 py-1.5 text-zinc-500">{fold.fold}</td>
                          <td className="px-2 py-1.5 text-zinc-400 whitespace-nowrap">{String(fold.trainStart).slice(0, 10)} → {String(fold.trainEnd).slice(0, 10)}</td>
                          <td className="px-2 py-1.5 text-zinc-400 whitespace-nowrap">{String(fold.testStart).slice(0, 10)} → {String(fold.testEnd).slice(0, 10)}</td>
                          <td className="px-2 py-1.5 text-indigo-300">{JSON.stringify(fold.bestParams || {})}</td>
                          <td className="px-2 py-1.5 text-zinc-300">{fmt(fold.inSample?.sharpeRatio, 2)}</td>
                          <td className={`px-2 py-1.5 ${(fold.outOfSample?.sharpeRatio ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(fold.outOfSample?.sharpeRatio, 2)}</td>
                          <td className="px-2 py-1.5 text-zinc-300">{fmt(fold.outOfSample?.totalReturnPercent, 2, '%')}</td>
                          <td className="px-2 py-1.5 text-rose-400">{fmt(fold.outOfSample?.maxDrawdownPercent, 2, '%')}</td>
                          <td className={`px-2 py-1.5 ${fold.status === 'ok' ? 'text-zinc-500' : 'text-rose-400'}`}>{fold.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-mono text-zinc-500">
                  <span>scheme {wfResult.geometry?.scheme}</span>
                  <span>train {wfResult.geometry?.trainBars} bars</span>
                  <span>test {wfResult.geometry?.testBars} bars</span>
                  <span>purge {wfResult.geometry?.purgeBars} bars</span>
                  <span>grid {wfResult.geometry?.gridSize}</span>
                  <span>objective {wfResult.summary?.objective}</span>
                  {wfResult.summary?.deflatedSharpeMethod && <span>DSR: {wfResult.summary.deflatedSharpeMethod}</span>}
                </div>
              </Section>
            </>
          )}
        </div>
      )}

      {/* OPTIMISATION */}
      {activeTab === 'optimization' && (
        <div className="space-y-4">
          {!optResult ? (
            <EmptyState
              icon={<Target className="w-8 h-8 text-zinc-600" />}
              title="No optimisation yet"
              body="Search a parameter grid on the full sample, then inspect the deflated Sharpe and the trial distribution before promoting the winner."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
                <MetricCard label="Trials" value={`${optResult.summary?.completedTrials ?? 0}/${optResult.summary?.gridSize ?? 0}`} hint={`${optResult.summary?.failedTrials ?? 0} failed`} />
                <MetricCard label="Objective" value={compact(optResult.summary?.objective)} hint={`best ${fmt(optResult.summary?.bestScore, 3)}`} />
                <MetricCard label="Best Return" value={fmt(optResult.summary?.bestMetrics?.totalReturnPercent, 2, '%')} />
                <MetricCard label="Best Sharpe" value={fmt(optResult.summary?.bestMetrics?.sharpeRatio, 2)} />
                <MetricCard label="Best Max DD" value={`-${fmt(optResult.summary?.bestMetrics?.maxDrawdownPercent, 2, '%')}`} tone="bad" />
                <MetricCard label="Deflated Sharpe" value={fmt(optResult.summary?.deflatedSharpe, 3)} tone={(optResult.summary?.deflatedSharpe ?? 0) >= 0.95 ? 'good' : 'bad'} hint="multiple testing" />
              </div>

              <Warnings items={optResult.warnings} />

              <Section title="Best Parameters">
                <div className="flex flex-wrap items-center gap-2">
                  {Object.entries(optResult.summary?.bestParams || {}).map(([key, value]) => (
                    <span key={key} className="px-2.5 py-1 rounded bg-indigo-950/40 border border-indigo-800/60 text-[11px] font-mono text-indigo-300">
                      {key} = {compact(value)}
                    </span>
                  ))}
                  {Object.keys(optResult.summary?.bestParams || {}).length === 0 && (
                    <span className="text-[10px] font-mono text-zinc-500">No parameters changed.</span>
                  )}
                  <Artifacts runId={optResult.runId} artifacts={optResult.artifacts} />
                </div>
              </Section>

              <Section title="Trials">
                <TrialTable trials={optResult.trials} />
              </Section>

              {optResult.bestResult?.equityCurve?.length ? (
                <Section title="Best Trial Equity">
                  <EquityCharts points={optResult.bestResult.equityCurve} height={220} />
                </Section>
              ) : null}
            </>
          )}
        </div>
      )}

      {/* STRESS */}
      {activeTab === 'stress' && (
        <div className="space-y-4">
          {!stressResult ? (
            <EmptyState
              icon={<Scale className="w-8 h-8 text-zinc-600" />}
              title="No cost stress yet"
              body="Re-run the strategy across a fee/slippage grid to see how quickly net returns decay and where the breakeven cost level sits."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <MetricCard label="Scenarios" value={fmt(stressResult.summary?.scenarios, 0)} />
                <MetricCard label="Breakeven" value={fmt(stressResult.summary?.breakevenBps, 0, ' bps')} tone={(stressResult.summary?.breakevenBps ?? 0) > 20 ? 'good' : 'bad'} hint={`${feeBps + slippageBps} bps configured`} />
                <MetricCard label="Zero-Cost Return" value={fmt(stressResult.summary?.zeroCostReturnPercent, 2, '%')} />
                <MetricCard label="Return Decay" value={fmt(stressResult.summary?.returnDecayPercent, 2, '%')} tone="bad" hint="highest vs zero cost" />
              </div>
              <Artifacts runId={stressResult.runId} artifacts={stressResult.artifacts} />
              <Section title="Cost Sensitivity">
                <div style={{ width: '100%', height: 220 }}>
                  <ResponsiveContainer>
                    <LineChart
                      data={stressResult.scenarios
                        .filter((scenario) => scenario.status === 'ok')
                        .sort((a, b) => a.totalBps - b.totalBps)
                        .map((scenario) => ({
                          cost: scenario.totalBps,
                          ret: scenario.totalReturnPercent,
                          sharpe: scenario.sharpeRatio,
                        }))}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                      <XAxis dataKey="cost" stroke="#71717a" tick={{ fontSize: 10 }} label={{ value: 'total bps', fill: '#71717a', fontSize: 10, position: 'insideBottom', offset: -4 }} />
                      <YAxis stroke="#71717a" tick={{ fontSize: 10 }} width={64} />
                      <Tooltip contentStyle={{ background: '#09090b', border: '1px solid #27272a', fontSize: 11, fontFamily: 'monospace' }} />
                      <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'monospace' }} />
                      <Line type="monotone" dataKey="ret" name="Net Return %" stroke="#fbbf24" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="sharpe" name="Sharpe" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 overflow-auto max-h-72 border border-zinc-800 rounded-lg">
                  <table className="w-full text-[10px] font-mono">
                    <thead className="sticky top-0 bg-zinc-950/95 text-zinc-400">
                      <tr>
                        {['Fee bps', 'Slippage bps', 'Total bps', 'Net Return', 'Sharpe', 'Max DD', 'Costs USD', 'Trades'].map((head) => (
                          <th key={head} className="text-left px-2 py-1.5 border-b border-zinc-800 whitespace-nowrap">{head}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...stressResult.scenarios]
                        .sort((a, b) => a.totalBps - b.totalBps)
                        .map((scenario, index) => (
                          <tr key={`${scenario.feeBps}-${scenario.slippageBps}-${index}`} className="border-b border-zinc-900/70">
                            <td className="px-2 py-1.5 text-zinc-400">{fmt(scenario.feeBps, 0)}</td>
                            <td className="px-2 py-1.5 text-zinc-400">{fmt(scenario.slippageBps, 0)}</td>
                            <td className="px-2 py-1.5 text-zinc-300">{fmt(scenario.totalBps, 0)}</td>
                            <td className={`px-2 py-1.5 ${(scenario.totalReturnPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(scenario.totalReturnPercent, 2, '%')}</td>
                            <td className="px-2 py-1.5 text-zinc-300">{fmt(scenario.sharpeRatio, 2)}</td>
                            <td className="px-2 py-1.5 text-rose-400">{fmt(scenario.maxDrawdownPercent, 2, '%')}</td>
                            <td className="px-2 py-1.5 text-zinc-400">{fmt(scenario.totalCostsUSD, 0)}</td>
                            <td className="px-2 py-1.5 text-zinc-500">{fmt(scenario.totalTrades, 0)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            </>
          )}
        </div>
      )}

      {/* RUNS */}
      {activeTab === 'runs' && (
        <div className="space-y-4">
          <Section
            title="Persisted Research Packets"
            right={
              <div className="flex items-center gap-2">
                <button
                  onClick={runComparison}
                  disabled={compareSelection.length < 2}
                  className="px-2.5 py-1 rounded border border-zinc-700 text-[10px] font-mono text-zinc-300 disabled:opacity-40 hover:border-purple-600"
                >
                  Compare ({compareSelection.length})
                </button>
                <button
                  onClick={loadRuns}
                  disabled={runsLoading}
                  className="px-2.5 py-1 rounded border border-zinc-700 text-[10px] font-mono text-zinc-300 hover:border-emerald-600 flex items-center space-x-1"
                >
                  <RefreshCw className={`w-3 h-3 ${runsLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>
            }
          >
            {runs.length === 0 ? (
              <div className="text-xs font-mono text-zinc-500 py-6 text-center flex flex-col items-center gap-2">
                <History className="w-6 h-6 text-zinc-600" />
                <span>No persisted runs yet. Every completed research call creates an artifact packet.</span>
              </div>
            ) : (
              <div className="overflow-auto max-h-[28rem] border border-zinc-800 rounded-lg">
                <table className="w-full text-[10px] font-mono">
                  <thead className="sticky top-0 bg-zinc-950/95 text-zinc-400">
                    <tr>
                      <th className="px-2 py-1.5 border-b border-zinc-800">Cmp</th>
                      {['Run', 'Kind', 'Strategy', 'Sharpe', 'Return', 'Engine', 'Created', 'Actions'].map((head) => (
                        <th key={head} className="text-left px-2 py-1.5 border-b border-zinc-800 whitespace-nowrap">{head}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => {
                      const selected = compareSelection.includes(run.runId);
                      return (
                        <tr key={run.runId} className="border-b border-zinc-900/70">
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() =>
                                setCompareSelection((prev) =>
                                  prev.includes(run.runId)
                                    ? prev.filter((item) => item !== run.runId)
                                    : prev.length >= 4
                                      ? prev
                                      : [...prev, run.runId]
                                )
                              }
                              className="accent-emerald-500"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-zinc-400 whitespace-nowrap">{run.runId}</td>
                          <td className="px-2 py-1.5 text-zinc-300">{run.kind}</td>
                          <td className="px-2 py-1.5 text-zinc-300 max-w-[16rem] truncate">{run.strategyName || '—'}</td>
                          <td className="px-2 py-1.5 text-zinc-300">{fmt(run.metrics?.sharpeRatio, 2)}</td>
                          <td className={`px-2 py-1.5 ${(run.metrics?.totalReturnPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(run.metrics?.totalReturnPercent, 2, '%')}</td>
                          <td className="px-2 py-1.5 text-zinc-500">{run.engine || '—'}</td>
                          <td className="px-2 py-1.5 text-zinc-500 whitespace-nowrap">{String(run.createdAt || '').slice(0, 16).replace('T', ' ')}</td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => loadRun(run.runId)} className="text-indigo-400 hover:text-indigo-300">load</button>
                              <a href={qjArtifactUrl(run.runId, 'dashboard.html')} target="_blank" rel="noreferrer" className="text-emerald-400 hover:text-emerald-300">report</a>
                              <button onClick={() => removeRun(run.runId)} className="text-rose-400 hover:text-rose-300">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {compareResult && (
            <Section title="Run Comparison">
              <div className="overflow-auto border border-zinc-800 rounded-lg">
                <table className="w-full text-[10px] font-mono">
                  <thead className="bg-zinc-950/95 text-zinc-400">
                    <tr>
                      <th className="text-left px-2 py-1.5">Metric</th>
                      {(compareResult.runs || []).map((run: any) => (
                        <th key={run.runId} className="text-left px-2 py-1.5 whitespace-nowrap">{run.strategyName || run.runId}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(compareResult.metrics || []).map((row: any) => (
                      <tr key={row.metric} className="border-t border-zinc-900/70">
                        <td className="px-2 py-1.5 text-zinc-400">{row.metric}</td>
                        {(row.values || []).map((value: any, index: number) => {
                          const run = (compareResult.runs || [])[index];
                          const best = run?.runId === row.bestRunId;
                          return (
                            <td key={index} className={`px-2 py-1.5 ${best ? 'text-emerald-400 font-bold' : 'text-zinc-300'}`}>
                              {fmt(value, 3)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
};

const EmptyState: React.FC<{ icon: React.ReactNode; title: string; body: string }> = ({ icon, title, body }) => (
  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-10 flex flex-col items-center text-center gap-2">
    {icon}
    <h3 className="text-sm font-mono font-bold text-zinc-200">{title}</h3>
    <p className="text-xs font-mono text-zinc-500 max-w-xl">{body}</p>
  </div>
);

const ContributionTable: React.FC<{ contribution?: Record<string, any> }> = ({ contribution }) => {
  const entries = Object.entries(contribution || {});
  if (entries.length === 0) {
    return <div className="text-xs font-mono text-zinc-500 py-4 text-center">No contribution data.</div>;
  }
  return (
    <div className="overflow-auto border border-zinc-800 rounded-lg">
      <table className="w-full text-[11px] font-mono">
        <thead className="bg-zinc-950/95 text-zinc-400">
          <tr>
            {['Symbol', 'Contribution', 'Avg Weight', 'Share'].map((head) => (
              <th key={head} className="text-left px-2 py-1.5 border-b border-zinc-800">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map(([symbol, item]: [string, any]) => (
            <tr key={symbol} className="border-b border-zinc-900/70">
              <td className="px-2 py-1.5 text-zinc-300">{symbol}</td>
              <td className={`px-2 py-1.5 ${(item.contributionPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {fmt(item.contributionPercent, 2, '%')}
              </td>
              <td className="px-2 py-1.5 text-zinc-400">{fmt(item.averageWeightPercent, 1, '%')}</td>
              <td className="px-2 py-1.5 text-zinc-500">{fmt(item.sharePercent, 1, '%')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const TrialTable: React.FC<{ trials: QjTrial[] }> = ({ trials }) => {
  const [sortKey, setSortKey] = useState<keyof QjTrial>('rank');
  const [ascending, setAscending] = useState<boolean>(true);
  const sorted = useMemo(() => {
    const copy = [...(trials || [])];
    copy.sort((left: any, right: any) => {
      const l = left[sortKey];
      const r = right[sortKey];
      if (typeof l === 'number' && typeof r === 'number') return ascending ? l - r : r - l;
      return ascending ? String(l).localeCompare(String(r)) : String(r).localeCompare(String(l));
    });
    return copy;
  }, [trials, sortKey, ascending]);

  const head = (key: keyof QjTrial, label: string) => (
    <th
      key={key}
      onClick={() => {
        if (sortKey === key) setAscending((prev) => !prev);
        else {
          setSortKey(key);
          setAscending(key === 'rank');
        }
      }}
      className="text-left px-2 py-1.5 border-b border-zinc-800 whitespace-nowrap cursor-pointer hover:text-zinc-200"
    >
      {label}
      {sortKey === key ? (ascending ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <div className="overflow-auto max-h-96 border border-zinc-800 rounded-lg">
      <table className="w-full text-[10px] font-mono">
        <thead className="sticky top-0 bg-zinc-950/95 text-zinc-400">
          <tr>
            {head('rank', 'Rank')}
            <th className="text-left px-2 py-1.5 border-b border-zinc-800">Params</th>
            {head('sharpeRatio', 'Sharpe')}
            {head('totalReturnPercent', 'Return')}
            {head('cagrPercent', 'CAGR')}
            {head('maxDrawdownPercent', 'Max DD')}
            {head('totalTrades', 'Trades')}
            {head('profitFactor', 'PF')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((trial) => (
            <tr key={`${trial.rank}-${JSON.stringify(trial.params)}`} className={`border-b border-zinc-900/70 ${trial.rank === 1 ? 'bg-emerald-950/20' : ''}`}>
              <td className="px-2 py-1.5 text-zinc-500">{trial.rank}</td>
              <td className="px-2 py-1.5 text-indigo-300">{JSON.stringify(trial.params)}</td>
              <td className="px-2 py-1.5 text-zinc-200">{fmt(trial.sharpeRatio, 2)}</td>
              <td className={`px-2 py-1.5 ${(trial.totalReturnPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(trial.totalReturnPercent, 2, '%')}</td>
              <td className="px-2 py-1.5 text-zinc-400">{fmt(trial.cagrPercent, 2, '%')}</td>
              <td className="px-2 py-1.5 text-rose-400">{fmt(trial.maxDrawdownPercent, 2, '%')}</td>
              <td className="px-2 py-1.5 text-zinc-400">{fmt(trial.totalTrades, 0)}</td>
              <td className="px-2 py-1.5 text-zinc-400">{fmt(trial.profitFactor, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default QJBacktestStudio;
