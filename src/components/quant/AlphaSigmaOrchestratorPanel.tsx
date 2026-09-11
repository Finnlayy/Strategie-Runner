import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "motion/react";
import {
  Scale, Layers, Waves, Bot, RefreshCw, Play, ShieldCheck, ShieldAlert,
  CircleDashed, CheckCircle2, XCircle, AlertTriangle, Gauge, ScrollText,
} from "lucide-react";

/**
 * ALPHA/SIGMA ORCHESTRATOR (Modul 19)
 * ---------------------------------------------------------------------------
 * Zwei Kammern, ein Urteil. ALPHA (links) sammelt Antraege — inkl. der
 * Grok-Agenten —, SIGMA (mitte) bewilligt oder verweigert nach Volatilitaet,
 * Regime und Caps. Die Spalte rechts zeigt das Ergebnis samt Reason-Codes.
 *
 * Der untere Block ist die Arbeitsliste des Grok-Bots [GBH-xx]. Plaetze, die der
 * Bot noch nicht uebernommen haben, sind bewusst ROT/GELB markiert: die Engine
 * laeuft dort mit dokumentiertem Heuristik-Fallback, und die zugehoerigen
 * Python-Tests sind als expectedFailure abgelegt (npm run test:orchestrator).
 */

const SYMBOLS = ["BTC/USD", "ETH/USD", "XRP/USD", "SOL/USD"];

type Hook = {
  id: string; subsystem: string; status: string; blocking: boolean; title: string;
  purpose: string; fallback: string; file: string; owner?: string; note?: string;
  input_contract?: Record<string, string>; output_contract?: Record<string, string>;
};

async function post<T = any>(url: string, body?: any, timeoutMs = 70000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? "{}" : JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { __error: (data as any)?.error || `HTTP ${res.status}`, ...(data as any) } as any;
    return data as T;
  } catch (err: any) {
    return { __error: String(err?.message || err) } as any;
  } finally {
    clearTimeout(t);
  }
}

async function get<T = any>(url: string, timeoutMs = 12000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { __error: (data as any)?.error || `HTTP ${res.status}` } as any;
    return data as T;
  } catch (err: any) {
    return { __error: String(err?.message || err) } as any;
  } finally {
    clearTimeout(t);
  }
}

const fmt = (v: any, d = 4) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "—");
const pct = (v: any) => (Number.isFinite(Number(v)) ? `${(Number(v) * 100).toFixed(2)}%` : "—");

function Badge({ tone, children, title }: { tone: "ok" | "warn" | "bad" | "info" | "muted"; children: any; title?: string }) {
  const map = {
    ok: "bg-emerald-950/80 border-emerald-700/70 text-emerald-300",
    warn: "bg-amber-950/80 border-amber-700/70 text-amber-300",
    bad: "bg-rose-950/80 border-rose-700/70 text-rose-300",
    info: "bg-sky-950/80 border-sky-700/70 text-sky-300",
    muted: "bg-zinc-800/80 border-zinc-700/70 text-zinc-300",
  } as const;
  return (
    <span title={title} className={`border px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold ${map[tone]}`}>
      {children}
    </span>
  );
}

export function AlphaSigmaOrchestratorPanel() {
  const [symbol, setSymbol] = useState<string>("BTC/USD");
  const [status, setStatus] = useState<any>(null);
  const [cycle, setCycle] = useState<any>(null);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [hookMeta, setHookMeta] = useState<any>(null);
  const [probe, setProbe] = useState<any>(null);
  const [mirror, setMirror] = useState<any>(null);
  const [evidenceJson, setEvidenceJson] = useState<string>("");
  const [evidenceMsg, setEvidenceMsg] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [useGrok, setUseGrok] = useState<boolean>(true);
  const [useXSearch, setUseXSearch] = useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const loadStatus = useCallback(async (sym: string) => {
    const [st, hk] = await Promise.all([
      get("/api/orchestrator/status?symbol=" + encodeURIComponent(sym)),
      get("/api/orchestrator/hooks"),
    ]);
    if (!mounted.current) return;
    if (st?.__error) setError(st.__error); else { setStatus(st); setError(""); }
    if (Array.isArray(hk?.hooks)) { setHooks(hk.hooks); setHookMeta(hk); }
  }, []);

  useEffect(() => { loadStatus(symbol); }, [symbol, loadStatus]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => loadStatus(symbol), 10000);
    return () => clearInterval(id);
  }, [autoRefresh, symbol, loadStatus]);

  const runCycle = async (dispatch: boolean) => {
    setBusy(dispatch ? "cycle+dispatch" : "cycle");
    const out = await post("/api/orchestrator/cycle", {
      symbol, useGrok, useXSearch, dispatch,
    }, dispatch ? 90000 : 70000);
    if (!mounted.current) return;
    setCycle(out);
    setBusy("");
    if (out?.__error) setError(out.__error);
    loadStatus(symbol);
  };

  const claimHook = async (id: string) => {
    setBusy("claim:" + id);
    await post(`/api/orchestrator/hooks/${id}/claim`, { owner: "desk-grok-bot", note: "übernommen aus dem Panel" });
    loadStatus(symbol); setBusy("");
  };

  /**
   * Spiegel-Selbstvergleich: haelt die Bruecke gegen ihre eigenen Runner-Formeln.
   * Bewusst KEIN Nachweis — GBH-06 wird dadurch nicht erfuellt.
   */
  const runMirrorCheck = async () => {
    setBusy("mirror");
    const out: any = await post("/api/orchestrator/parity-check", { symbol });
    setMirror(out);
    setBusy("");
  };

  /**
   * Nachweis-Aufnahme: Zahlen aus dem laufenden Runner-Skript einfuegen.
   * Nur dieser Weg bucht GBH-06 (bei Abweichung <= Toleranz).
   */
  const submitEvidence = async () => {
    let runner: any;
    try {
      runner = JSON.parse(evidenceJson);
    } catch (e) {
      setEvidenceMsg("JSON konnte nicht gelesen werden — Schluessel wie basis, sigma, z_score, atr, hurst, ema_fast, ema_slow, breakout_upper, breakout_lower, support_score, resistance_score");
      return;
    }
    setBusy("parity");
    const out: any = await post("/api/orchestrator/parity", { symbol, runner });
    setEvidenceMsg(out?.parity_ok
      ? `Paritaet belegt (worst delta ${out.worst_delta}) — GBH-06 auf IMPLEMENTED gesetzt`
      : `Nachweis verworfen: ${out?.reason || `delta ${out?.worst_delta} ueber Toleranz`}`);
    setBusy("");
    loadStatus(symbol);
  };

  const runHurstProbe = async () => {
    setBusy("probe");
    setProbe(await post("/api/orchestrator/hurst-probe", { symbol }, 60000));
    setBusy("");
  };

  const dec = cycle?.decision || status?.last_decision || {};
  const alpha = dec?.alpha || {};
  const sigma = dec?.sigma || {};
  const intent = dec?.intent || null;
  const verdict: string = dec?.verdict || "—";
  const tone = verdict === "APPROVED" ? "ok" : verdict === "SIZED_DOWN" ? "info" : verdict === "NO_INTENT" ? "muted" : "bad";
  const openHooks = hooks.filter((h) => h.status !== "IMPLEMENTED");
  const blockingOpen = openHooks.filter((h) => h.blocking);
  const portfolio = status?.portfolio || {};

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mt-5"
    >
      {/* Kopf */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3 mb-3">
        <div className="flex items-center space-x-2">
          <Scale className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-mono font-bold text-white tracking-tight">ALPHA / SIGMA ORCHESTRATOR</h3>
          <Badge tone="muted" title="Zwei-Kammer-System: ALPHA beantragt, SIGMA bewilligt">Modul 19</Badge>
          {blockingOpen.length > 0 && (
            <Badge tone="bad" title="Neue Anträge bleiben gesperrt, bis der Bot diese Stufe liefert">
              {blockingOpen.map((h) => h.id).join(", ")} offen
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] font-mono text-zinc-200"
          >
            {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="flex items-center space-x-1 text-[10px] font-mono text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={useGrok} onChange={(e) => setUseGrok(e.target.checked)} className="accent-emerald-500" />
            <span>Grok-Anträge</span>
          </label>
          <label className="flex items-center space-x-1 text-[10px] font-mono text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={useXSearch} onChange={(e) => setUseXSearch(e.target.checked)} className="accent-emerald-500" />
            <span>x_search</span>
          </label>
          <label className="flex items-center space-x-1 text-[10px] font-mono text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-emerald-500" />
            <span>auto 10s</span>
          </label>
          <button
            onClick={() => loadStatus(symbol)}
            className="flex items-center space-x-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-2 py-1 rounded text-[10px] font-mono"
          >
            <RefreshCw className="w-3 h-3" /><span>Status</span>
          </button>
          <button
            disabled={!!busy}
            onClick={() => runCycle(false)}
            className="flex items-center space-x-1 bg-emerald-950 hover:bg-emerald-900 border border-emerald-700 text-emerald-200 px-2 py-1 rounded text-[10px] font-mono disabled:opacity-50"
          >
            <Play className="w-3 h-3" /><span>{busy === "cycle" ? "Zyklus läuft…" : "Zyklus (nur entscheiden)"}</span>
          </button>
          <button
            disabled={!!busy}
            onClick={() => runCycle(true)}
            title="Erfordert ORS_ALLOW_DISPATCH=1 auf dem Server; Live nur zusätzlich mit ORS_ALLOW_LIVE_DISPATCH=1"
            className="flex items-center space-x-1 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-200 px-2 py-1 rounded text-[10px] font-mono disabled:opacity-50"
          >
            <Bot className="w-3 h-3" /><span>Dispatch anfragen</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start space-x-2 bg-rose-950/40 border border-rose-800/70 rounded p-2 text-[11px] font-mono text-rose-300">
          <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {/* Drei Spalten: ALPHA | SIGMA | URTEIL */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ALPHA */}
        <div className="bg-zinc-950/60 border border-zinc-800 rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-[11px] font-mono font-bold text-sky-300">ALPHA — Antragskammer</span>
            </div>
            <Badge tone={Math.abs(alpha?.score ?? 0) >= (status?.config?.alpha_min_score ?? 0.18) ? "info" : "muted"}>
              score {fmt(alpha?.score, 3)}
            </Badge>
          </div>

          <div className="mb-2">
            <div className="h-1.5 bg-zinc-800 rounded overflow-hidden relative">
              <div
                className="absolute top-0 bottom-0 bg-sky-500/70"
                style={{
                  left: alpha?.score >= 0 ? "50%" : `${50 + (alpha?.score ?? 0) * 50}%`,
                  width: `${Math.min(50, Math.abs(alpha?.score ?? 0) * 50)}%`,
                }}
              />
              <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-600" />
            </div>
            <div className="flex justify-between text-[9px] font-mono text-zinc-500 mt-0.5">
              <span>-1 SHORT</span><span>0</span><span>LONG +1</span>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-mono">
            <dt className="text-zinc-500">Richtung</dt><dd className="text-zinc-200">{alpha?.direction === 1 ? "LONG" : alpha?.direction === -1 ? "SHORT" : "neutral"}</dd>
            <dt className="text-zinc-500">Gleichlauf</dt><dd className="text-zinc-200">{pct(alpha?.agreement)}</dd>
            <dt className="text-zinc-500">Quellen aktiv</dt><dd className="text-zinc-200">{alpha?.effective_sources ?? 0}</dd>
            <dt className="text-zinc-500">Durch Stärke</dt><dd className="text-zinc-200">{fmt(alpha?.magnitude, 2)}</dd>
          </dl>

          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto pr-1">
            {(alpha?.contributors || []).map((c: any) => (
              <div key={c.source} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1">
                <span className="text-[10px] font-mono text-zinc-300">{c.source}</span>
                <span className="flex items-center space-x-1">
                  <Badge tone={c.direction > 0 ? "ok" : c.direction < 0 ? "bad" : "muted"}>{c.direction > 0 ? "▲" : c.direction < 0 ? "▼" : "–"}</Badge>
                  <span className="text-[9px] font-mono text-zinc-500" title={`Stärke ${c.strength}, Alter ${c.age_bars} Bars, IC ${c.ic}`}>
                    w={fmt(c.weight, 4)}
                  </span>
                </span>
              </div>
            ))}
            {!(alpha?.contributors || []).length && (
              <p className="text-[10px] font-mono text-zinc-600">keine offenen Anträge — Zyklus läuft mit Rein-Heuristik</p>
            )}
          </div>

          {(alpha?.blocked_by_regime || []).length > 0 && (
            <p className="mt-1.5 text-[9px] font-mono text-amber-400/90">
              <ShieldAlert className="w-3 h-3 inline mr-1" />durch Regime gesperrt: {alpha.blocked_by_regime.join(", ")}
            </p>
          )}
          {(alpha?.stale_sources || []).length > 0 && (
            <p className="text-[9px] font-mono text-zinc-500">gealtert verworfen: {alpha.stale_sources.join(", ")}</p>
          )}
        </div>

        {/* SIGMA */}
        <div className="bg-zinc-950/60 border border-zinc-800 rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-1.5">
              <Waves className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] font-mono font-bold text-emerald-300">SIGMA — Bewilligung</span>
            </div>
            <Badge tone={sigma?.regime === "MOMENTUM_TREND" || sigma?.regime === "SUPER_EXPONENTIAL" ? "ok" : sigma?.regime === "BROWNIAN_CHOP" ? "warn" : "muted"}>
              {sigma?.regime || "UNKNOWN"}
            </Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-mono">
            <dt className="text-zinc-500">Preis</dt><dd className="text-zinc-200">{fmt(sigma?.price, 2)}</dd>
            <dt className="text-zinc-500">z-Score</dt><dd className="text-zinc-200">{fmt(sigma?.z_score, 3)}</dd>
            <dt className="text-zinc-500">Hurst (R/S)</dt><dd className="text-zinc-200">{fmt(sigma?.hurst, 3)}</dd>
            <dt className="text-zinc-500">ATR</dt><dd className="text-zinc-200">{fmt(sigma?.atr, 4)}</dd>
            <dt className="text-zinc-500">Vol (ann.)</dt><dd className="text-zinc-200">{pct(sigma?.realized_vol_ann)}</dd>
            <dt className="text-zinc-500">GARCH / EWMA bps</dt><dd className="text-zinc-200">{fmt(sigma?.garch_vol_bps, 2)} / {fmt(sigma?.ewma_vol_bps, 2)}</dd>
            <dt className="text-zinc-500">MOS supp/res</dt><dd className="text-zinc-200">{fmt(dec?.sigma?.structure?.support_score, 2)} / {fmt(dec?.sigma?.structure?.resistance_score, 2)}</dd>
            <dt className="text-zinc-500">Bars</dt><dd className="text-zinc-200">{sigma?.bars ?? 0}</dd>
          </dl>

          <div className="mt-2 grid grid-cols-2 gap-1 text-[9px] font-mono">
            <div className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1">
              Zielvol <span className="text-emerald-300">{pct(status?.config?.sigma_target_annual_vol)}</span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1">
              Alloc-Cap <span className="text-emerald-300">{pct(status?.config?.sigma_max_alloc_pct)}</span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1">
              Gross-Exp <span className={portfolio.gross_exposure_pct > (status?.config?.sigma_max_gross_exposure_pct ?? 0.6) ? "text-rose-300" : "text-zinc-200"}>{pct(portfolio.gross_exposure_pct)}</span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1">
              Drawdown <span className={(portfolio.drawdown_pct ?? 0) > 5 ? "text-amber-300" : "text-zinc-200"}>{fmt(portfolio.drawdown_pct, 2)}%</span>
            </div>
          </div>

          {(intent?.sizing_trace) && (
            <div className="mt-2 text-[9px] font-mono text-zinc-500 leading-relaxed">
              <span className="text-zinc-400">Sizing-Spur:</span>{" "}
              {Object.entries(intent.sizing_trace).map(([k, v]) => `${k}=${typeof v === "number" ? (v as number).toFixed(4) : String(v)}`).join(" · ")}
            </div>
          )}
          {(status?.parity && Object.keys(status.parity).length > 0) && (
            <p className="mt-1.5 text-[9px] font-mono">
              <ShieldCheck className="w-3 h-3 inline mr-1 text-emerald-400" />
              Runner-Parität {status.parity[symbol] ? <span className="text-emerald-300">belegt</span> : <span className="text-rose-300">nicht belegt</span>}
            </p>
          )}
        </div>

        {/* URTEIL */}
        <div className="bg-zinc-950/60 border border-zinc-800 rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-1.5">
              <Gauge className="w-3.5 h-3.5 text-white" />
              <span className="text-[11px] font-mono font-bold text-white">URTEIL der Arbitrierung</span>
            </div>
            <Badge tone={tone as any}>{verdict}</Badge>
          </div>

          <div className="flex flex-wrap gap-1 mb-2">
            {(dec?.reason_codes || []).map((r: string) => (
              <Badge key={r} tone={r === "NONE" ? "ok" : "warn"}>{r}</Badge>
            ))}
            {!(dec?.reason_codes || []).length && <span className="text-[10px] font-mono text-zinc-600">noch kein Zyklus</span>}
          </div>

          {intent ? (
            <div className="bg-zinc-900 border border-emerald-900/60 rounded p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-emerald-300">
                  {intent.action} {fmt(intent.qty, 6)} {intent.symbol}
                </span>
                <Badge tone="muted">{pct(intent.allocation_pct)}</Badge>
              </div>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono text-zinc-300">
                <dt className="text-zinc-500">Notional</dt><dd>${fmt(intent.notional_usd, 2)}</dd>
                <dt className="text-zinc-500">Limit hint</dt><dd>{fmt(intent.limit_price_hint, 2)}</dd>
                <dt className="text-zinc-500">Stop</dt><dd className="text-rose-300">{fmt(intent.stop_price, 2)}</dd>
                <dt className="text-zinc-500">Ziel</dt><dd className="text-emerald-300">{fmt(intent.target_price, 2)}</dd>
                <dt className="text-zinc-500">Haltezeit max</dt><dd>{intent.max_hold_bars} Bars</dd>
                <dt className="text-zinc-500">Gültigkeit</dt><dd>{intent.ttl_bars} Bars</dd>
              </dl>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded p-2 text-[10px] font-mono text-zinc-400">
              {verdict === "NO_INTENT" ? "Alpha unter Schwelle — kein Antrag, keine Order." : verdict === "REJECTED" ? "SIGMA hat verweigert. Keine Order, kein Retry ohne neue Daten." : "—"}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-zinc-500">
            <span>LLM-Kosten Zyklus: ${fmt(cycle?.costUsd, 5)}</span>
            {cycle?.dispatch && (
              <span className={cycle.dispatch.attempted ? "text-emerald-300" : "text-zinc-400"}>
                dispatch: {cycle.dispatch.attempted ? "ausgelöst" : "zu — " + (cycle.dispatch.reason || "unbekannt")}
              </span>
            )}
          </div>
          {(cycle?.warnings || []).length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {cycle.warnings.map((w: string, i: number) => (
                <li key={i} className="text-[9px] font-mono text-amber-400/90 flex items-start space-x-1">
                  <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" /><span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          {cycle?.riskReview && (
            <p className="mt-1 text-[9px] font-mono text-zinc-400">
              Risikoprüfung (advisory, kann nur verengen): {cycle.riskReview.risk_level}
              {cycle.riskReview.veto ? " — VETO, Dispatch blockiert" : ""} · {String(cycle.riskReview.note || "").slice(0, 140)}
            </p>
          )}
        </div>
      </div>

      {/* Bot-Arbeitsliste */}
      <div className="mt-4 border-t border-zinc-800 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center space-x-2">
            <ScrollText className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] font-mono font-bold text-white">UEBERNAHME-LISTE FÜR DEN GROK-BOT</span>
            <Badge tone={openHooks.length ? "warn" : "ok"}>{openHooks.length}/{hooks.length} offen</Badge>
            {hookMeta?.blocking_open > 0 && <Badge tone="bad">{hookMeta.blocking_open} blockieren neue Anträge</Badge>}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={runMirrorCheck}
              disabled={!!busy}
              title="POST /api/orchestrator/parity-check — Selbstvergleich der Brücke, KEIN GBH-06-Nachweis"
              className="flex items-center space-x-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-2 py-1 rounded text-[10px] font-mono disabled:opacity-50"
            >
              <ShieldCheck className="w-3 h-3" /><span>{busy === "mirror" ? "spiegel…" : "Spiegel prüfen"}</span>
            </button>
            <button
              onClick={runHurstProbe}
              disabled={!!busy}
              title="DFA/Hurst exakt über code_interpreter (GBH-04); ohne XAI_API_KEY kommt der Hinweis-Fallback"
              className="flex items-center space-x-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-2 py-1 rounded text-[10px] font-mono disabled:opacity-50"
            >
              <Waves className="w-3 h-3" /><span>{busy === "probe" ? "probe…" : "DFA-Probe"}</span>
            </button>
          </div>
        </div>

        {/* >>> GROK-BOT [GBH-06] >>>
            UI-Regel: "Spiegel prüfen" ist Debugging und bucht nichts. Erfuellen kann
            den blockierenden Hook nur ein Nachweis mit Zahlen aus dem laufenden
            Runner-Skript (Nachweis buchen -> POST /api/orchestrator/parity).
            <<< GROK-BOT [GBH-06] <<< */}
        <div className="mb-2 bg-zinc-950/70 border border-zinc-800 rounded p-2">
          <div className="flex items-center space-x-2 mb-1">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span className="text-[10px] font-mono font-bold text-zinc-200">GBH-06 NACHWEISEN (nur Runner-Zahlen zählen)</span>
          </div>
          <textarea
            value={evidenceJson}
            onChange={(e) => setEvidenceJson(e.target.value)}
            placeholder='{"basis":68837.486,"sigma":539.51,"z_score":-1.9926,"atr":164.146,"hurst":0.7017,"ema_fast":68688.04,"ema_slow":68443.63,"breakout_upper":69791.94,"breakout_lower":67955.9,"support_score":3.961,"resistance_score":2.4544}'
            className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-[9px] font-mono text-zinc-300 h-14 resize-y"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[9px] font-mono text-zinc-500">
              {mirror ? <>Spiegel: {mirror.parity_ok ? "Deckung" : "Abweichung"} (worst {String(mirror.worst_delta ?? "—")}){mirror.hint ? " — " + mirror.hint : ""}</> : "Spiegelvergleich dient nur dem Debuggen der Brücke."}
            </span>
            <button
              onClick={submitEvidence}
              disabled={!!busy || !evidenceJson.trim()}
              className="bg-emerald-950 hover:bg-emerald-900 border border-emerald-800 text-emerald-200 px-2 py-1 rounded text-[9px] font-mono disabled:opacity-40"
            >
              {busy === "parity" ? "prüfe…" : "Nachweis buchen"}
            </button>
          </div>
          {evidenceMsg && <p className="mt-1 text-[9px] font-mono text-amber-300">{evidenceMsg}</p>}
        </div>

        {probe && (
          <div className="mb-2 text-[10px] font-mono bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-300">
            DFA-Probe: {probe.ok
              ? <>hurst={fmt(probe.hurst, 4)} r²={fmt(probe.rSquared, 3)} · Engine R/S={fmt(probe.engine_rs_hurst, 4)} · Δ={fmt(probe.delta, 4)} <span className="text-zinc-500">({probe.method})</span></>
              : <span className="text-amber-300">{probe.note || probe.error || "kein Ergebnis"} — R/S-Fallback bleibt maßgeblich</span>}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {hooks.map((h) => {
            const tone2 = h.status === "IMPLEMENTED" ? "ok" : h.status === "CLAIMED" ? "info" : h.blocking ? "bad" : "warn";
            return (
              <div key={h.id} className="bg-zinc-950/70 border border-zinc-800 rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center space-x-1.5">
                    {h.status === "IMPLEMENTED" ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      : h.status === "CLAIMED" ? <CircleDashed className="w-3 h-3 text-sky-400" />
                        : <XCircle className={`w-3 h-3 ${h.blocking ? "text-rose-400" : "text-amber-400"}`} />}
                    <span className="text-[10px] font-mono font-bold text-zinc-200">{h.id}</span>
                    <Badge tone="muted">{h.subsystem}</Badge>
                    {h.blocking && <Badge tone="bad" title="blockiert neue Anträge bis zur Lieferung">blocking</Badge>}
                  </span>
                  <Badge tone={tone2 as any}>{h.status}</Badge>
                </div>
                <p className="text-[10px] font-mono text-zinc-300 mb-1">{h.title}</p>
                <p className="text-[9px] font-mono text-zinc-500 leading-snug mb-1">{h.purpose}</p>
                <p className="text-[9px] font-mono text-zinc-500">
                  <span className="text-zinc-400">Fallback:</span> {h.fallback}
                </p>
                <p className="text-[9px] font-mono text-zinc-600 truncate" title={h.file}>{h.file}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] font-mono text-zinc-600">
                    {h.owner && h.owner !== "heuristik" ? <>owner: {h.owner}</> : "owner: heuristik"}
                  </span>
                  {h.status === "PLACEHOLDER" && (
                    <button
                      onClick={() => claimHook(h.id)}
                      disabled={!!busy}
                      className="text-[9px] font-mono text-sky-300 hover:text-sky-200 disabled:opacity-50"
                    >
                      {busy === "claim:" + h.id ? "…" : "claimen"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Journal */}
      {(status?.recent_decisions || []).length > 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-2">
          <div className="flex items-center space-x-1.5 mb-1">
            <ScrollText className="w-3 h-3 text-zinc-500" />
            <span className="text-[10px] font-mono font-bold text-zinc-400">LETZTE ENTSCHIEDENE TAKTE (Journal)</span>
            <span className="text-[9px] font-mono text-zinc-600">· {status?.decisions_24h ?? 0} heute</span>
          </div>
          <div className="max-h-32 overflow-y-auto pr-1 space-y-0.5">
            {(status.recent_decisions || []).map((d: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-[9px] font-mono bg-zinc-950/60 border border-zinc-800/70 rounded px-1.5 py-0.5">
                <span className="text-zinc-400">{String(d.ts || "").replace("T", " ").slice(0, 19)} · {d.symbol} · bar {d.bar}</span>
                <span className="flex items-center space-x-1.5">
                  <span className="text-zinc-500">α {fmt(d.alpha_score, 3)} / gl {fmt(d.alpha_agreement, 2)}</span>
                  <span className="text-zinc-500">{d.regime}</span>
                  <Badge tone={d.verdict === "APPROVED" ? "ok" : d.verdict === "SIZED_DOWN" ? "info" : d.verdict === "NO_INTENT" ? "muted" : "bad"}>
                    {d.verdict}{d.intent ? ` ${d.intent.action}` : ""}
                  </Badge>
                  <span className="text-zinc-600">{(d.reason_codes || []).slice(0, 2).join(",")}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
