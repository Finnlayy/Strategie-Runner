import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Crosshair,
  Flame,
  Gauge,
  Play,
  RefreshCw,
  Shield,
  Sparkles,
  Star,
  Swords,
  Target,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArenaResult, ArenaTrade } from '../../types';
import { QjApiError, runQjArena } from '../../lib/qjBacktest';

const PAIRS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD'];
const INTERVALS = [
  { value: 15, label: '15m' },
  { value: 60, label: '1h' },
  { value: 240, label: '4h' },
  { value: 1440, label: '1d' },
];
const BAR_OPTIONS = [300, 500, 720];

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

function signedR(value: any): string {
  const parsed = num(value);
  if (parsed === null) return '—';
  const sign = parsed > 0 ? '+' : '';
  return `${sign}${parsed.toFixed(2)}R`;
}

function rTone(value: any): string {
  const parsed = num(value) ?? 0;
  if (parsed > 0.05) return 'text-emerald-400';
  if (parsed < -0.05) return 'text-rose-400';
  return 'text-zinc-300';
}

function timeFromTs(ts: any): string {
  const value = num(ts);
  if (value === null) return '—';
  const date = new Date(value);
  return date.toLocaleString('en-GB', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

function timeFromIso(value: any): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('en-GB', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

const Sparkline: React.FC<{ points: Array<{ equity: number }>; color: string; width?: number; height?: number }> = ({
  points,
  color,
  width = 110,
  height = 32,
}) => {
  const path = useMemo(() => {
    const values = (points || []).map((point) => Number(point.equity)).filter((value) => Number.isFinite(value));
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - ((value - min) / span) * (height - 4) - 2;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [points, width, height]);
  if (!path) return <div style={{ width, height }} />;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const StatePill: React.FC<{ state: string; label: string }> = ({ state, label }) => {
  const styles: Record<string, string> = {
    long: 'bg-emerald-950/70 border-emerald-700/60 text-emerald-300',
    short: 'bg-rose-950/70 border-rose-800/60 text-rose-300',
    ready: 'bg-amber-950/70 border-amber-700/60 text-amber-300',
    waiting: 'bg-zinc-950/80 border-zinc-700/60 text-zinc-400',
  };
  return (
    <span
      className={`inline-flex items-center space-x-1.5 px-2 py-0.5 rounded border text-[10px] font-mono font-bold tracking-wider ${
        styles[state] || styles.waiting
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          state === 'ready' ? 'bg-amber-400 animate-pulse' : state === 'long' ? 'bg-emerald-400' : state === 'short' ? 'bg-rose-400' : 'bg-zinc-500'
        }`}
      />
      <span>{label}</span>
    </span>
  );
};

const LadderPips: React.FC<{ trade: ArenaTrade | null }> = ({ trade }) => {
  const steps = trade?.ladder || [];
  const risk = num(trade?.riskAmount);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
        <span>SCALE-OUT LADDER</span>
        <span>risk {risk !== null ? `$${risk.toFixed(0)}` : '—'}</span>
      </div>
      {steps.length === 0 ? (
        <div className="text-[10px] font-mono text-zinc-600">No ladder data for this trade.</div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {steps.map((step) => (
            <div
              key={step.target}
              className={`rounded border px-2 py-1.5 ${
                step.hit ? 'bg-emerald-950/40 border-emerald-800/60' : 'bg-zinc-950/60 border-zinc-800'
              }`}
            >
              <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-wider">
                <span className={step.hit ? 'text-emerald-300' : 'text-zinc-500'}>{step.target}</span>
                {step.hit ? <Target className="w-3 h-3 text-emerald-400" /> : <Timer className="w-3 h-3 text-zinc-600" />}
              </div>
              <div className={`text-xs font-mono font-bold ${step.hit ? 'text-emerald-200' : 'text-zinc-500'}`}>
                {step.rMultiple.toFixed(0)}R
              </div>
              <div className="text-[9px] font-mono text-zinc-500 truncate">
                {step.hit ? timeFromIso(step.time) : 'not reached'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; hint?: string; tone?: string }> = ({ label, value, hint, tone }) => (
  <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-2">
    <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">{label}</div>
    <div className={`text-base font-mono font-bold ${tone || 'text-zinc-100'}`}>{value}</div>
    {hint && <div className="text-[9px] font-mono text-zinc-600 truncate">{hint}</div>}
  </div>
);

export const BotArena: React.FC = () => {
  const [pair, setPair] = useState('BTC/USD');
  const [interval, setIntervalMinutes] = useState(60);
  const [bars, setBars] = useState(720);
  const [riskPercent, setRiskPercent] = useState(2);
  const [arena, setArena] = useState<ArenaResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem('arena.pinnedBots');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await runQjArena({
        symbols: [pair],
        intervalMinutes: interval,
        candleCount: bars,
        initialCapital: 10000,
        feeBps: 26,
        slippageBps: 5,
        source: 'payload',
        riskPercent,
        ladder: [1, 2, 3],
        rebalance: { frequency: 'signal', onSignalChange: true },
        allocation: { method: 'equal_weight', maxPositionSize: 1, longShort: false },
      });
      setArena(payload);
      setSelectedId((prev) => {
        if (prev && payload.bots.some((bot) => bot.id === prev)) return prev;
        return payload.bots[0]?.id || null;
      });
    } catch (err: any) {
      setError(err instanceof QjApiError ? err.message : err?.message || 'Arena run failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('arena.pinnedBots', JSON.stringify(pinned));
    } catch {
      // ignore storage failures
    }
  }, [pinned]);

  const bots = arena?.bots || [];
  const selected = bots.find((bot) => bot.id === selectedId) || bots[0] || null;
  const priceSeries = arena?.priceSeries || [];
  const firstPrice = priceSeries[0]?.price;
  const lastPrice = priceSeries[priceSeries.length - 1]?.price;
  const changePercent =
    firstPrice && lastPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : null;
  const closedTrades = bots.reduce((total, bot) => total + bot.totalTrades, 0);
  const openTrades = bots.reduce((total, bot) => total + bot.openTrades, 0);

  const entryMarkers = useMemo(
    () =>
      (selected?.trades || [])
        .filter((trade) => trade.entryTs)
        .map((trade) => ({ ts: trade.entryTs, price: trade.entryPrice })),
    [selected]
  );
  const exitMarkers = useMemo(
    () =>
      (selected?.trades || [])
        .filter((trade) => trade.exitTs && trade.exitPrice)
        .map((trade) => ({ ts: trade.exitTs, price: trade.exitPrice })),
    [selected]
  );

  const togglePin = (id: string) => {
    setPinned((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const podium = bots.slice(0, 3);

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-12">
      {/* HEADER */}
      <div className="relative overflow-hidden bg-zinc-900 border border-zinc-800 rounded-lg p-4 sm:p-5">
        <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-48 w-48 rounded-full bg-emerald-500/5 blur-3xl" />
        <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div className="w-11 h-11 rounded-lg bg-amber-950/70 border border-amber-800/60 flex items-center justify-center text-amber-300 shadow-inner">
              <Swords className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <h2 className="text-base sm:text-xl font-mono font-bold text-white tracking-tight">Strategy Arena</h2>
                <span className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded border border-amber-700/60 bg-amber-950/60 text-amber-300 text-[10px] font-mono font-bold tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span>REPLAY</span>
                </span>
                {arena?.source && (
                  <span className="text-[10px] font-mono text-zinc-500 uppercase">{arena.source} data</span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-zinc-400 mt-1 font-mono">
                Six rule sets. One market. One cost model. Score = realised R on closed trades only.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 space-y-1">
              <span className="block">Market</span>
              <select
                value={pair}
                onChange={(event) => setPair(event.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-amber-600"
              >
                {PAIRS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 space-y-1">
              <span className="block">Bars</span>
              <select
                value={interval}
                onChange={(event) => setIntervalMinutes(Number(event.target.value))}
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-amber-600"
              >
                {INTERVALS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 space-y-1">
              <span className="block">Sample</span>
              <select
                value={bars}
                onChange={(event) => setBars(Number(event.target.value))}
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-amber-600"
              >
                {BAR_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value} bars</option>
                ))}
              </select>
            </label>
            <label className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 space-y-1">
              <span className="block">Risk / trade</span>
              <select
                value={riskPercent}
                onChange={(event) => setRiskPercent(Number(event.target.value))}
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-amber-600"
              >
                {[0.5, 1, 2, 3].map((value) => (
                  <option key={value} value={value}>{value}%</option>
                ))}
              </select>
            </label>
            <button
              onClick={() => void run()}
              disabled={loading}
              className={`px-3.5 py-2 rounded font-mono font-bold text-[11px] flex items-center space-x-1.5 ${
                loading
                  ? 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed'
                  : 'bg-amber-400 hover:bg-amber-300 text-zinc-950'
              }`}
            >
              {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{loading ? 'RUNNING…' : 'RUN ARENA'}</span>
            </button>
          </div>
        </div>

        <div className="relative mt-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
          <Stat
            label="Last price"
            value={lastPrice ? `$${fmt(lastPrice, 2)}` : '—'}
            hint={arena?.periodLabel?.split('→')[1]?.trim()}
          />
          <Stat
            label="Period move"
            value={fmt(changePercent, 2, '%')}
            tone={(changePercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            hint={arena?.periodLabel?.split('→')[0]?.trim()}
          />
          <Stat label="Entrants" value={`${bots.length}`} hint="rule-based bots" />
          <Stat label="Closed trades" value={`${closedTrades}`} hint={`${openTrades} still open`} />
          <Stat label="Score basis" value="Σ R" hint="1/3 at 1R · 2R · 3R" />
          <Stat
            label="Run time"
            value={arena?.elapsedSeconds ? `${arena.elapsedSeconds.toFixed(1)}s` : '—'}
            hint={`${arena?.totalCandles || 0} candles`}
          />
        </div>
      </div>

      {error && (
        <div className="bg-rose-950/50 border border-rose-900 rounded-lg p-3 text-[11px] font-mono text-rose-200 flex items-start space-x-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold">Arena could not run</div>
            <div className="text-rose-300/80">{error}</div>
          </div>
          <button onClick={() => void run()} className="px-2 py-1 border border-rose-800 rounded text-[10px] hover:bg-rose-900/40">
            retry
          </button>
        </div>
      )}

      {loading && !arena && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-amber-500/30 border-t-amber-400 animate-spin" />
          <div className="text-xs font-mono text-zinc-300">Running six bots on {bars} candles…</div>
          <div className="text-[10px] font-mono text-zinc-600">shared panel · shared costs · one-bar execution delay</div>
        </div>
      )}

      {arena && (
        <>
          {/* PODIUM */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {podium.map((bot, index) => {
              const isFirst = index === 0;
              return (
                <button
                  key={bot.id}
                  onClick={() => setSelectedId(bot.id)}
                  className={`text-left relative overflow-hidden rounded-lg border p-4 transition-colors ${
                    selected?.id === bot.id
                      ? 'bg-zinc-900 border-zinc-600'
                      : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div
                    className="absolute inset-x-0 top-0 h-0.5"
                    style={{ background: `linear-gradient(90deg, ${bot.color}00, ${bot.color}, ${bot.color}00)` }}
                  />
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`w-7 h-7 rounded-md border flex items-center justify-center text-[11px] font-mono font-bold ${
                          isFirst
                            ? 'bg-amber-950/70 border-amber-700/70 text-amber-300'
                            : 'bg-zinc-950 border-zinc-700 text-zinc-400'
                        }`}
                      >
                        {isFirst ? <Trophy className="w-3.5 h-3.5" /> : `#${bot.rank}`}
                      </span>
                      <div>
                        <div className="text-sm font-mono font-bold text-zinc-100">{bot.name}</div>
                        <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">{bot.tagline}</div>
                      </div>
                    </div>
                    <span className="flex items-center space-x-1">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          togglePin(bot.id);
                        }}
                        className={pinned.includes(bot.id) ? 'text-amber-300' : 'text-zinc-600 hover:text-zinc-400'}
                        title="Follow this bot"
                      >
                        <Star className={`w-3.5 h-3.5 ${pinned.includes(bot.id) ? 'fill-current' : ''}`} />
                      </button>
                    </span>
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <div className={`text-2xl font-mono font-bold ${rTone(bot.scoreR)}`}>{signedR(bot.scoreR)}</div>
                      <div className="text-[9px] font-mono text-zinc-500">
                        {bot.wins}W / {bot.losses}L · {fmt(bot.winRate, 0, '%')} win rate
                      </div>
                    </div>
                    <Sparkline points={bot.equityCurve} color={bot.color} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-zinc-500">
                    <span>{bot.totalTrades} closed · {bot.openTrades} open</span>
                    <StatePill state={bot.signal.state} label={bot.signal.label} />
                  </div>
                </button>
              );
            })}
          </div>

          {/* CHART + ANALYSIS */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 space-y-4">
              <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-zinc-800 pb-3 mb-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: selected?.color }} />
                      <h3 className="text-sm font-mono font-bold text-zinc-100">{selected?.name}</h3>
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-500">
                        {selected?.model}
                      </span>
                      {selected && <StatePill state={selected.signal.state} label={selected.signal.label} />}
                    </div>
                    <p className="text-[10px] sm:text-[11px] font-mono text-zinc-500 mt-1 max-w-2xl">{selected?.rule}</p>
                  </div>
                  <div className="flex items-center gap-3 text-[9px] font-mono text-zinc-500">
                    <span className="flex items-center space-x-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span>entry</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <span className="w-2 h-2 rounded-full bg-rose-400" />
                      <span>exit</span>
                    </span>
                  </div>
                </div>

                <div style={{ width: '100%', height: 320 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={priceSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        scale="time"
                        stroke="#71717a"
                        tick={{ fontSize: 9 }}
                        tickFormatter={(value) => timeFromTs(value).replace(',', '')}
                        minTickGap={50}
                      />
                      <YAxis
                        stroke="#71717a"
                        tick={{ fontSize: 9 }}
                        width={64}
                        domain={['auto', 'auto']}
                        tickFormatter={(value) => `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                      />
                      <Tooltip
                        contentStyle={{ background: '#09090b', border: '1px solid #27272a', fontSize: 10, fontFamily: 'monospace' }}
                        labelFormatter={(value) => timeFromTs(value)}
                        formatter={(value: any, name: any) => [`$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`, name]}
                      />
                      <Line type="monotone" dataKey="price" name="Price" stroke="#e4e4e7" strokeWidth={1.4} dot={false} />
                      <Scatter data={entryMarkers} dataKey="price" name="Entry" fill="#34d399" shape="triangle" />
                      <Scatter data={exitMarkers} dataKey="price" name="Exit" fill="#fb7185" shape="diamond" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px] font-mono text-zinc-500">
                  <span>{arena.periodLabel}</span>
                  <span>
                    {arena.symbols.join(', ')} · {arena.interval}m bars · fee {arena.engine?.feeBps}bps + slippage {arena.engine?.slippageBps}bps
                  </span>
                </div>
              </section>

              {/* LEADERBOARD */}
              <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2">
                  <h3 className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-400">Leaderboard</h3>
                  <span className="text-[9px] font-mono text-zinc-600">click a bot to inspect its rule and last trade</span>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-[10px] font-mono">
                    <thead className="text-zinc-500">
                      <tr>
                        {['#', 'Bot', 'Score', 'W/L', 'Win %', 'Trades', 'Return', 'Max DD', 'State', ''].map((head) => (
                          <th key={head} className="text-left px-2 py-1.5 border-b border-zinc-800 whitespace-nowrap font-medium">
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bots.map((bot) => (
                        <tr
                          key={bot.id}
                          onClick={() => setSelectedId(bot.id)}
                          className={`border-b border-zinc-900/70 cursor-pointer transition-colors ${
                            selected?.id === bot.id ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'
                          }`}
                        >
                          <td className="px-2 py-2 text-zinc-500">{bot.rank}</td>
                          <td className="px-2 py-2">
                            <div className="flex items-center space-x-2">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: bot.color }} />
                              <span className="text-zinc-200">{bot.name}</span>
                              {pinned.includes(bot.id) && <Star className="w-2.5 h-2.5 text-amber-400 fill-current" />}
                            </div>
                          </td>
                          <td className={`px-2 py-2 font-bold ${rTone(bot.scoreR)}`}>{signedR(bot.scoreR)}</td>
                          <td className="px-2 py-2 text-zinc-400">{bot.wins}/{bot.losses}</td>
                          <td className="px-2 py-2 text-zinc-400">{fmt(bot.winRate, 0)}%</td>
                          <td className="px-2 py-2 text-zinc-400">{bot.totalTrades}</td>
                          <td className={`px-2 py-2 ${(bot.totalReturnPercent ?? 0) >= 0 ? 'text-emerald-400/90' : 'text-rose-400/90'}`}>
                            {fmt(bot.totalReturnPercent, 1, '%')}
                          </td>
                          <td className="px-2 py-2 text-rose-400/80">{fmt(bot.maxDrawdownPercent, 1, '%')}</td>
                          <td className="px-2 py-2">
                            <span className={`inline-flex items-center space-x-1 ${bot.status === 'in-position' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${bot.status === 'in-position' ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                              <span>{bot.status === 'in-position' ? 'IN POSITION' : 'SCANNING'}</span>
                            </span>
                          </td>
                          <td className="px-2 py-2 text-zinc-600">
                            <ChevronRight className="w-3 h-3" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {/* ANALYSIS RAIL */}
            <div className="space-y-4">
              <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
                  <div className="flex items-center space-x-1.5">
                    <Crosshair className="w-3.5 h-3.5 text-amber-400" />
                    <h3 className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-300">Bot analysis</h3>
                  </div>
                  {selected && (
                    <button
                      onClick={() => togglePin(selected.id)}
                      className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
                        pinned.includes(selected.id)
                          ? 'border-amber-700/60 bg-amber-950/50 text-amber-300'
                          : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {pinned.includes(selected.id) ? 'FOLLOWING' : 'FOLLOW'}
                    </button>
                  )}
                </div>

                {selected && (
                  <div className="space-y-3">
                    <div>
                      <div className="text-sm font-mono font-bold text-zinc-100">{selected.name}</div>
                      <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">{selected.family} · {selected.tagline}</div>
                    </div>

                    <div className={`rounded-lg border p-3 ${
                      selected.signal.state === 'ready'
                        ? 'bg-amber-950/30 border-amber-800/50'
                        : selected.signal.state === 'long'
                          ? 'bg-emerald-950/30 border-emerald-800/50'
                          : selected.signal.state === 'short'
                            ? 'bg-rose-950/30 border-rose-800/50'
                            : 'bg-zinc-950/60 border-zinc-800'
                    }`}>
                      <div className="flex items-center justify-between">
                        <StatePill state={selected.signal.state} label={selected.signal.label} />
                        <span className="text-[9px] font-mono text-zinc-500">latest candle</span>
                      </div>
                      <p className="text-[10px] font-mono text-zinc-300 mt-2 leading-relaxed">{selected.signal.detail}</p>
                    </div>

                    <div className="space-y-1.5">
                      {selected.signal.checks.map((check, index) => (
                        <div key={`${check.label}-${index}`} className="flex items-center justify-between text-[10px] font-mono">
                          <span className="text-zinc-500">{check.label}</span>
                          <span className="flex items-center space-x-1.5">
                            <span className="text-zinc-300">{check.value}</span>
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                check.status === 'pass' ? 'bg-emerald-400' : check.status === 'fail' ? 'bg-rose-500' : 'bg-zinc-600'
                              }`}
                            />
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="bg-zinc-950/60 border border-zinc-800 rounded p-2">
                      <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-600 mb-1">Rule</div>
                      <div className="text-[10px] font-mono text-zinc-400 leading-relaxed">{selected.rule}</div>
                    </div>

                    {selected.openPosition && (
                      <div className="rounded border border-emerald-900/50 bg-emerald-950/20 p-2">
                        <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-wider">
                          <span className="text-emerald-300">Open position</span>
                          <span className="text-zinc-500">{selected.openPosition.holdingBars || 0} bars</span>
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[10px] font-mono">
                          <span className="text-zinc-300">
                            {String(selected.openPosition.side || 'long').toUpperCase()} @ ${fmt(selected.openPosition.entryPrice, 2)}
                          </span>
                          <span className={(num(selected.openPosition.pnl) ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {fmt(selected.openPosition.pnl, 2, ' USD')}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
                  <div className="flex items-center space-x-1.5">
                    <Flame className="w-3.5 h-3.5 text-rose-400" />
                    <h3 className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-300">Last trade replay</h3>
                  </div>
                  {selected?.lastTrade && (
                    <span className={`text-sm font-mono font-bold ${rTone(selected.lastTrade.rMultiple)}`}>
                      {signedR(selected.lastTrade.rMultiple)}
                    </span>
                  )}
                </div>

                {selected?.lastTrade ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-zinc-400">
                        {String(selected.lastTrade.side || 'long').toUpperCase()} {selected.lastTrade.symbol}
                      </span>
                      <span className="text-zinc-500 uppercase">{String(selected.lastTrade.exitReason || '').replace(/_/g, ' ')}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                      <div className="bg-zinc-950/60 border border-zinc-800 rounded p-2">
                        <div className="text-[9px] text-zinc-600 uppercase">Entry</div>
                        <div className="text-zinc-200">${fmt(selected.lastTrade.entryPrice, 2)}</div>
                        <div className="text-[9px] text-zinc-500">{timeFromIso(selected.lastTrade.entryTime)}</div>
                      </div>
                      <div className="bg-zinc-950/60 border border-zinc-800 rounded p-2">
                        <div className="text-[9px] text-zinc-600 uppercase">Exit</div>
                        <div className="text-zinc-200">${fmt(selected.lastTrade.exitPrice, 2)}</div>
                        <div className="text-[9px] text-zinc-500">{timeFromIso(selected.lastTrade.exitTime)}</div>
                      </div>
                    </div>
                    <LadderPips trade={selected.lastTrade} />
                    <div className="flex items-center justify-between text-[9px] font-mono text-zinc-500">
                      <span>gross {fmt(selected.lastTrade.grossR, 2)}R</span>
                      <span>fees {fmt(selected.lastTrade.feeR, 2)}R</span>
                      <span>{selected.lastTrade.holdingBars ?? 0} bars held</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] font-mono text-zinc-500 py-4 text-center">
                    No closed trades yet. The bot is still waiting for its rule to complete a round trip.
                  </div>
                )}
              </section>

              <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center space-x-1.5 mb-2">
                  <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                  <h3 className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-300">Risk envelope</h3>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                  <div className="bg-zinc-950/60 border border-zinc-800 rounded p-2">
                    <div className="text-[9px] uppercase text-zinc-600">Risk / trade</div>
                    <div className="text-zinc-200">{arena.scoring.riskPercent}%</div>
                  </div>
                  <div className="bg-zinc-950/60 border border-zinc-800 rounded p-2">
                    <div className="text-[9px] uppercase text-zinc-600">Exit ladder</div>
                    <div className="text-zinc-200">{arena.scoring.ladder.join('R / ')}R</div>
                  </div>
                  <div className="bg-zinc-950/60 border border-zinc-800 rounded p-2">
                    <div className="text-[9px] uppercase text-zinc-600">Execution</div>
                    <div className="text-zinc-200">1-bar delay</div>
                  </div>
                  <div className="bg-zinc-950/60 border border-zinc-800 rounded p-2">
                    <div className="text-[9px] uppercase text-zinc-600">Capital</div>
                    <div className="text-zinc-200">${fmt(arena.assumptions.initialCapital, 0)}</div>
                  </div>
                </div>
                <p className="text-[9px] font-mono text-zinc-600 mt-2 leading-relaxed">
                  {arena.scoring.ladderSizing}. Score excludes open trades.
                </p>
              </section>
            </div>
          </div>

          {/* TRADE TAPE + ACADEMY */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <section className="xl:col-span-2 bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2">
                <div className="flex items-center space-x-1.5">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  <h3 className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-300">Trade tape</h3>
                </div>
                <span className="text-[9px] font-mono text-zinc-600">{arena.tradeTape.length} latest closes</span>
              </div>
              <div className="overflow-auto max-h-80">
                <table className="w-full text-[10px] font-mono">
                  <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                    <tr>
                      {['Bot', 'Side', 'Entry', 'Exit', 'R', 'Exit type'].map((head) => (
                        <th key={head} className="text-left px-2 py-1.5 border-b border-zinc-800 whitespace-nowrap font-medium">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {arena.tradeTape.map((trade, index) => (
                      <tr
                        key={`${trade.botId}-${trade.entryTime}-${index}`}
                        className="border-b border-zinc-900/70 hover:bg-zinc-800/20 cursor-pointer"
                        onClick={() => setSelectedId(trade.botId)}
                      >
                        <td className="px-2 py-1.5">
                          <span className="flex items-center space-x-1.5">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: trade.color }} />
                            <span className="text-zinc-300">{trade.botName}</span>
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={String(trade.side).toLowerCase() === 'long' ? 'text-emerald-400' : 'text-rose-400'}>
                            {String(trade.side || '').toUpperCase()}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-zinc-500 whitespace-nowrap">{timeFromIso(trade.entryTime)}</td>
                        <td className="px-2 py-1.5 text-zinc-500 whitespace-nowrap">{timeFromIso(trade.exitTime)}</td>
                        <td className={`px-2 py-1.5 font-bold ${rTone(trade.rMultiple)}`}>{signedR(trade.rMultiple)}</td>
                        <td className="px-2 py-1.5 text-zinc-500 uppercase">{String(trade.exitReason || '').replace(/_/g, ' ')}</td>
                      </tr>
                    ))}
                    {arena.tradeTape.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-2 py-6 text-center text-zinc-500">
                          No closed trades in this window.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center space-x-1.5 border-b border-zinc-800 pb-2 mb-3">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <h3 className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-300">Arena academy</h3>
              </div>
              <div className="space-y-2">
                {arena.notes.slice(0, 3).map((note, index) => (
                  <div key={note.id} className="bg-zinc-950/60 border border-zinc-800 rounded p-2.5">
                    <div className="flex items-start space-x-2">
                      <span className="text-[9px] font-mono text-amber-500/80 mt-0.5">{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <div className="text-[10px] font-mono font-semibold text-zinc-300">{note.title}</div>
                        <p className="text-[9px] font-mono text-zinc-500 mt-1 leading-relaxed">{note.body}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-zinc-600">
                <span className="flex items-center space-x-1">
                  <Shield className="w-3 h-3" />
                  <span>simulated · no orders</span>
                </span>
                <span className="flex items-center space-x-1">
                  <Zap className="w-3 h-3" />
                  <span>same rules for all</span>
                </span>
              </div>
            </section>
          </div>

          {arena.warnings.length > 0 && (
            <div className="bg-amber-950/30 border border-amber-900/50 rounded-lg p-3 text-[10px] font-mono text-amber-200/90 space-y-1">
              {arena.warnings.slice(0, 4).map((warning, index) => (
                <div key={index} className="flex items-start space-x-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default BotArena;
