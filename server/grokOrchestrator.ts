/**
 * GROK-AGENTEN-SEITE DES ORCHESTRATORS — server/grokOrchestrator.ts
 *
 * Hier (und nur hier) spricht der Orchestrator mit Grok. Die Regel ist asymmetrisch:
 *
 *   ALPHA  <- Grok liefert Antraege: Richtung, Staerke, Confidence, Horizont, Begründung.
 *   SIGMA  <- Grok darf NUR verengen: Risikoprüfung kann veto'en und damit die
 *             Antragsqualität im Folgezyklus drücken. Grok kann keine Menge,
 *             keinen Hebel, keine Exposure-Kappe, kein Gate ändern.
 *
 * Das ist die Antwort auf "Orchestrierung autonomer Grok-Agenten": Agenten
 * erzeugen Kante, eine deterministische Kammer entscheidet über Kapital.
 *
 * Uebernahmepunkte für den Bot (identisch zur Liste in
 * app/orchestrator/alpha_sigma_engine.py::GROK_BOT_HOOKS):
 *   GBH-01 Agenten-Antrags-Prompts      -> dieser Datei: grokAlphaVotes()
 *   GBH-04 Exakte DFA/Hurst              -> dieser Datei: sigmaHurstViaCodeInterpreter()
 *   GBH-05 x_search Handle-Listen        -> dieser Datei: buildXSearchHandles()
 *   GBH-08 Look-Ahead-Kadenz             -> grokEngine.assessLookAheadBias + cadence()
 */

import {
  grokEnabled,
  grokStructured,
  conversationKey,
  estimateTokens,
  checkLongContextBudget,
  getGrokConfig,
  type JsonSchema,
  type XSearchOptions,
} from "./grokEngine";
import {
  orsDeriveRunnerVotes,
  orsDecide,
  orsIngest,
  orsParity,
  orsStatus,
  orsSubmitVotes,
  type OrchestratorVote,
} from "./orchestratorEngine";

// ---------------------------------------------------------------------------
// 1. Vertraege
// ---------------------------------------------------------------------------

const ALPHA_VOTE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    votes: {
      type: "array", minItems: 0, maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string", enum: ["grok_trader", "grok_sentiment", "grok_debate_bull", "grok_debate_bear", "grok_news_triage"] },
          direction: { type: "integer", enum: [-1, 0, 1] },
          strength: { type: "number", minimum: 0, maximum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          horizon_bars: { type: "integer", minimum: 1, maximum: 96 },
          rationale: { type: "string", maxLength: 400 },
        },
        required: ["source", "direction", "strength", "confidence", "horizon_bars", "rationale"],
      },
    },
    regime_opinion: { type: "string", enum: ["MEAN_REVERTING", "BROWNIAN_CHOP", "MOMENTUM_TREND", "SUPER_EXPONENTIAL", "UNKNOWN"] },
    thesis: { type: "string", maxLength: 600 },
    invalidation: { type: "string", maxLength: 300 },
    data_gaps: { type: "array", maxItems: 4, items: { type: "string", maxLength: 160 } },
  },
  required: ["votes", "thesis"],
};

const RISK_REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    veto: { type: "boolean" },
    risk_level: { type: "string", enum: ["none", "low", "elevated", "high"] },
    concerns: { type: "array", maxItems: 4, items: { type: "string", maxLength: 220 } },
    note: { type: "string", maxLength: 400 },
  },
  required: ["veto", "risk_level", "note"],
};

/**
 * Staetiger Praefix — aendert sich nie pro Zyklus, damit der Prompt-Cache traegt.
 * >>> GROK-BOT [GBH-01] >>> Ersetze diesen Block durch asset-spezifische
 * Regelwerks-Korpusse (Manifest + Risk-Policy), aber IMMER vorne anstellen.
 * <<< GROK-BOT [GBH-01] <<<
 */
const ALPHA_INSTRUCTIONS = `You are the ALPHA chamber of a two-chamber trading orchestrator.
HARD RULES:
- You propose. You never size. Quantity, leverage, exposure and gates are decided by a
  deterministic SIGMA chamber; asking for them has zero effect.
- Only dated, verifiable, non-consensus information may raise strength. Stale or
  second-hand claims must reduce strength, not raise it.
- If the printed statistics contradict your narrative, the statistics win: report
  direction 0 and put the conflict into data_gaps.
- Return a vote per independent thesis only. One thesis, one vote. Never duplicate a
  thesis across sources to average it up.
- rationale: what is the edge and which observation would falsify it, in <= 400 chars.
Never invent prices, never restate the prompt.`;

function stateBlockFor(sig: any, ind: any): string {
  const g = (v: any, d = "n/a") => (Number.isFinite(Number(v)) ? Number(v).toFixed(4) : d);
  return [
    `price=${g(sig?.price)}`, `bars=${sig?.bars ?? "n/a"}`,
    `z_score=${g(sig?.z_score)}`, `basis=${g(sig?.basis)}`, `sigma=${g(ind?.sigma)}`,
    `atr=${g(sig?.atr)}`, `hurst=${g(sig?.hurst)}`, `regime=${sig?.regime ?? "UNKNOWN"}`,
    `ewma_vol_bps=${g(sig?.ewma_vol_bps)}`, `garch_vol_bps=${g(sig?.garch_vol_bps)}`,
    `realized_vol_ann=${g(sig?.realized_vol_ann)}`,
    `mos_support=${g(ind?.support_score)}`, `mos_resistance=${g(ind?.resistance_score)}`,
    `runner_signals=${JSON.stringify(ind?.signals ?? {})}`,
    `sigma_flags=${JSON.stringify(sig?.risk_flags ?? [])}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// 2. x_search-Handles (GBH-05)
// ---------------------------------------------------------------------------

/**
 * >>> GROK-BOT [GBH-05] >>>
 * Der Bot pflegt die Listen aus Trefferstatistik (hit_rate je Handle) und zieht
 * unzuverlaessige Accounts nach. Liefert der Bot eine Resolution fuer GBH-05,
 * gewinnt sie; sonst bleibt diese statische Kurzliste stehen.
 * <<< GROK-BOT [GBH-05] <<<
 */
export function buildXSearchHandles(args: { symbol?: string; extra?: { allowed?: string[]; excluded?: string[] } } = {}): XSearchOptions {
  const byAsset: Record<string, string[]> = {
    BTC: ["Bitcoin", "bitcoin", "Coindesk", "theblock"],
    ETH: ["ethereum", "VitalkButerin", "ethdev"],
    XRP: ["Ripple", "XRPWeb"],
    SOL: ["solaboratory", "solana"],
  };
  const base = byAsset[String(args.symbol || "").toUpperCase()] || [];
  const allowed = [...new Set([...base, ...(args.extra?.allowed || [])])].slice(0, 20);
  const excluded = [...new Set(args.extra?.excluded || [])].slice(0, 20);
  const opts: XSearchOptions = {};
  // xAI: allow- und exclude-Listen sind mutually exclusive, maximal 20 Eintraege.
  if (allowed.length) opts.allowedHandles = allowed;
  else if (excluded.length) opts.excludedHandles = excluded;
  return opts;
}

// ---------------------------------------------------------------------------
// 3. GBH-04: exakte DFA/Hurst ueber code_interpreter
// ---------------------------------------------------------------------------

export interface HurstProbe {
  ok: boolean; hurst?: number; rSquared?: number; method?: string;
  fallback: boolean; note?: string; meta?: any;
}

/**
 * Laesst die DFA auf dem xAI-Server mit numpy/pandas rechnen (die Sandbox hat sie,
 * der Node-/Stdlib-Prozess nicht) und liefert den Wert als Vote-Meta zurueck.
 * Scheitert alles, bleibt der R/S-Fallback der Engine stehen — der Zyklus laeuft weiter.
 */
export async function sigmaHurstViaCodeInterpreter(prices: number[], args: { lookback?: number; deadlineMs?: number } = {}): Promise<HurstProbe> {
  const series = (prices || []).filter((x) => Number.isFinite(x)).slice(-(args.lookback || 256) * 2);
  if (series.length < 40 || !grokEnabled()) {
    return { ok: false, fallback: true, note: "code_interpreter nicht verfuegbar (deaktiviert oder zu wenige Daten)" };
  }
  const sample = series.slice(-400).map((x) => Number(x.toFixed(6)));
  const res = await grokStructured<{ hurst: number; r_squared: number; method: string }>({
    task: "technical_math",
    conversationKey: conversationKey({ symbol: "HURST", task: "dfa-code" }),
    system: "You are a numerical routines. Compute Detrended Fluctuation Analysis exactly as Peng et al. 1994 on the supplied log-return series. Use box sizes from 8 up to n/4, log-log least-squares slope of log F(s) vs log s. Return numbers only, no prose.",
    prompt: `Series (close prices, ordered old->new):\n${JSON.stringify(sample)}\nCompute log returns, run DFA, return hurst (slope) and r_squared of the fit and a one-line method description.`,
    schema: {
      type: "object", additionalProperties: false,
      properties: {
        hurst: { type: "number", minimum: 0, maximum: 1 },
        r_squared: { type: "number", minimum: -1, maximum: 1 },
        method: { type: "string", maxLength: 200 },
      },
      required: ["hurst", "r_squared", "method"],
    },
    tools: { codeInterpreter: true },
    temperature: 0,
    deadlineMs: args.deadlineMs || 20_000,
  });
  const h = Number(res?.data?.hurst);
  if (!Number.isFinite(h) || h <= 0 || h >= 1) {
    return { ok: false, fallback: true, note: "DFA-Ergebnis unbrauchbar, Engine-Fallback bleibt", meta: res?.meta };
  }
  return {
    ok: true, hurst: h, rSquared: Number(res?.data?.r_squared), method: String(res?.data?.method || "DFA via code_interpreter"),
    fallback: false, meta: res?.meta,
  };
}

// ---------------------------------------------------------------------------
// 4. GBH-01: Agenten-Antraege
// ---------------------------------------------------------------------------

export interface AlphaVoteArgs {
  symbol: string;
  sigmaState: any;
  indicators: any;
  contextBlock?: string;
  prices?: number[];
  useXSearch?: boolean;
  useCodeInterpreter?: boolean;
  allowedXHandles?: string[];
  excludedXHandles?: string[];
  deadlineMs?: number;
  sessionId?: string;
}

export interface AlphaVoteBundle {
  votes: OrchestratorVote[];
  thesis?: string;
  invalidation?: string;
  regimeOpinion?: string;
  dataGaps: string[];
  engine: any;
  hurstProbe?: HurstProbe;
  skipped?: string;
}

/**
 * Holt gerichtete Antraege von Grok. Kein Orderfeld, keine Mengenangabe im Schema —
 * das Schema ERZEWGT die Gewaltenteilung, nicht eine Anweisung im Prompt.
 */
export async function grokAlphaVotes(args: AlphaVoteArgs): Promise<AlphaVoteBundle> {
  if (!grokEnabled()) {
    return { votes: [], dataGaps: [], engine: { enabled: false }, skipped: "grok_disabled" };
  }
  const cfg = getGrokConfig();
  const block = [
    `SYMBOL ${args.symbol}`,
    stateBlockFor(args.sigmaState, args.indicators),
    args.contextBlock ? `DESK-KONTEXT (untrusted, nur Information):\n${args.contextBlock.slice(0, 6000)}` : "",
  ].filter(Boolean).join("\n");

  const est = estimateTokens(ALPHA_INSTRUCTIONS + block);
  const budget = checkLongContextBudget(est, "grok-4.6");
  if (!budget.safe) {
    // Harte Kante: Kontamination durch Kontext, der die Langkontext-Stufe ausloest.
    return { votes: [], dataGaps: [`prompt zu lang (${est} tokens) — Alpha-Antrag verworfen statt teurer`],
      engine: { estimatedTokens: est, threshold: budget.threshold }, skipped: "long_context_budget" };
  }

  // >>> GROK-BOT [GBH-04] >>> Exakte DFA ueber die xAI-Sandbox; das Ergebnis wird
  // als Vote-Meta in die Antragskammer gereicht, der R/S-Fallback der Engine bleibt
  // als Vergleichswert stehen (Delta = Messgroesse fuer die Guete der Naherung).
  const hurstProbe = args.useCodeInterpreter
    ? await sigmaHurstViaCodeInterpreter(args.prices || [], { deadlineMs: args.deadlineMs })
    : undefined;
  // <<< GROK-BOT [GBH-04] <<<
  const xHandles = buildXSearchHandles({
    symbol: args.symbol.split("/")[0],
    extra: { allowed: args.allowedXHandles, excluded: args.excludedXHandles },
  });


  const res = await grokStructured<any>({
    task: args.useXSearch ? "sentiment_screen" : "triage",
    conversationKey: conversationKey({ symbol: args.symbol, task: "alpha-votes", sessionId: args.sessionId }),
    prompt: block + "\n\nANTWORT: ausschliesslich das JSON-Schema, keine Prosa.",
    system: ALPHA_INSTRUCTIONS,
    schema: ALPHA_VOTE_SCHEMA,
    schemaName: "alpha_votes",
    temperature: 0.1,
    maxOutputTokens: 900,
    deadlineMs: args.deadlineMs || Math.max(15_000, Math.min(45_000, cfg.requestTimeoutMs)),
    tools: args.useXSearch ? { xSearch: { ...xHandles, fromDate: daysAgo(3), toDate: today() } } : {},
  });

  const rawVotes: any[] = Array.isArray(res?.data?.votes) ? res.data.votes : [];
  const votes: OrchestratorVote[] = rawVotes
    .filter((v) => v && Number.isFinite(Number(v.direction)) && Number(v.direction) !== 0)
    .map((v) => ({
      source: String(v.source || "grok_trader"),
      symbol: args.symbol.toUpperCase(),
      direction: Math.sign(Number(v.direction)),
      strength: clamp01(Number(v.strength)),
      confidence: clamp01(Number(v.confidence)),
      horizon_bars: Math.max(1, Math.min(96, Math.round(Number(v.horizon_bars) || 8))),
      rationale: String(v.rationale || "").slice(0, 400),
      meta: {
        thesis: String(res?.data?.thesis || "").slice(0, 600),
        regime_opinion: res?.data?.regime_opinion,
        via: "grok",
        ...(hurstProbe?.ok ? { hurst_dfa: hurstProbe.hurst, hurst_r2: hurstProbe.rSquared } : {}),
      },
    }));

  return {
    votes,
    thesis: res?.data?.thesis, invalidation: res?.data?.invalidation,
    regimeOpinion: res?.data?.regime_opinion,
    dataGaps: (res?.data?.data_gaps || []).slice(0, 4),
    hurstProbe,
    engine: {
      modelUsed: res?.meta?.model, provider: res?.meta?.provider, costUsd: res?.meta?.costUsd,
      cacheHit: res?.meta?.cacheHit, repairAttempts: res?.meta?.repairAttempts, citations: res?.meta?.citations,
      validationIssues: res?.validationIssues,
    },
  };
}

/**
 * Sigma darf vom Modell nur VERENGEND begleitet werden (advisory risk review).
 * Ein Veto erhoht nichts und blockiert nichts hart — es setzt einen Gegenantrag
 * in die Antragskammer, damit der naechste Zyklus sauberer entscheidet, und
 * markiert den aktuellen Zyklus als dispatch-blockiert.
 */
export async function grokRiskReview(args: {
  symbol: string; intent: any; sigmaState: any; deadlineMs?: number;
}): Promise<{ veto: boolean; riskLevel: string; note: string; concerns: string[]; engine: any }> {
  if (!grokEnabled() || !args.intent) {
    return { veto: false, riskLevel: "none", note: "kein risk review (Grok aus oder kein intent)", concerns: [], engine: { skipped: true } };
  }
  const res = await grokStructured<any>({
    task: "risk_review",
    conversationKey: conversationKey({ symbol: args.symbol, task: "risk-review" }),
    system: "You review an ALREADY SIZED order intent of a deterministic risk chamber. You may only object on grounds the gates cannot see: event risk, exchange/custody risk, liquidity mirage, contradictory data. You may not request a larger size, a higher leverage or a gate change; such answers are invalid and must be a veto=false with the concern noted.",
    prompt: `INTENT ${JSON.stringify(args.intent).slice(0, 1500)}\nSIGMA ${stateBlockFor(args.sigmaState, null)}`,
    schema: RISK_REVIEW_SCHEMA,
    temperature: 0,
    maxOutputTokens: 500,
    deadlineMs: args.deadlineMs || 20_000,
  });
  return {
    veto: Boolean(res?.data?.veto),
    riskLevel: String(res?.data?.risk_level || "none"),
    note: String(res?.data?.note || "").slice(0, 400),
    concerns: (res?.data?.concerns || []).slice(0, 4),
    engine: { modelUsed: res?.meta?.model, costUsd: res?.meta?.costUsd, cacheHit: res?.meta?.cacheHit },
  };
}

// ---------------------------------------------------------------------------
// 5. Der Zyklus
// ---------------------------------------------------------------------------

export interface CycleArgs {
  symbol: string;
  prices: number[];
  price?: number;
  equityUsd?: number;
  availableCashUsd?: number;
  spreadBps?: number;
  slippageBps?: number;
  useGrok?: boolean;
  useXSearch?: boolean;
  /** GBH-04: DFA/Hurst ueber code_interpreter statt R/S-Fallback der Engine. */
  useCodeInterpreter?: boolean;
  contextBlock?: string;
  runRiskReview?: boolean;
  /** GBH-06: Runner gemeldete Indikatoren, damit die Engine ihre Paritaet belegen kann. */
  runnerIndicators?: Record<string, any>;
  allowEntries?: boolean;
  deadlineMs?: number;
  sessionId?: string;
}

export interface CycleResult {
  symbol: string;
  parity: any;
  derived: any;
  grok: any;
  decision: any;
  dispatchBlocked: boolean;
  riskReview?: any;
  costUsd: number;
  pendingHooks: string[];
  warnings: string[];
}

/**
 * Ein Takt des Orchestrators, von Marktdaten bis OrderIntent.
 * Reihenfolge ist Teil des Designs: Paritaet -> Runner-Votes -> Agenten-Votes -> Sigma-Gate.
 */
export async function runAlphaSigmaCycle(args: CycleArgs): Promise<CycleResult> {
  const warnings: string[] = [];
  const prices = (args.prices || []).filter((x) => Number.isFinite(x)).slice(-1024);
  let costUsd = 0;

  const sigma = await orsIngest({
    symbol: args.symbol, prices: prices.length ? prices : undefined,
    price: prices.length ? undefined : args.price,
    equityUsd: args.equityUsd, availableCashUsd: args.availableCashUsd,
  });
  if (sigma?.error) warnings.push(`ingest: ${sigma.error}`);

  const parity = await orsParity(args.symbol, args.runnerIndicators);
  if (parity?.error) warnings.push(`parity: ${parity.error}`);
  if (parity && parity.parity_ok === false) {
    warnings.push(`GBH-06 offen: ${parity.reason || `delta ${parity.worst_delta}`}`);
  }

  const derived = await orsDeriveRunnerVotes(args.symbol, prices.length ? prices : undefined);
  if (derived?.error) warnings.push(`derive: ${derived.error}`);

  let grokBundle: any = { votes: [], skipped: "useGrok=false" };
  if (args.useGrok !== false && grokEnabled()) {
    try {
      grokBundle = await grokAlphaVotes({
        symbol: args.symbol, sigmaState: sigma, indicators: derived?.indicators,
        contextBlock: args.contextBlock, prices, useXSearch: args.useXSearch,
        useCodeInterpreter: args.useCodeInterpreter,
        deadlineMs: args.deadlineMs, sessionId: args.sessionId,
      });
      costUsd += Number(grokBundle?.engine?.costUsd || 0);
      if (grokBundle.votes?.length) {
        const posted = await orsSubmitVotes(grokBundle.votes.map((v: OrchestratorVote) => ({ ...v, bar_index: sigma?.bars ?? 0 })));
        if (posted?.error) warnings.push(`votes: ${posted.error}`);
      }
      if (grokBundle.skipped) warnings.push(`alpha: ${grokBundle.skipped}`);
    } catch (err: any) {
      warnings.push(`alpha_call_failed: ${String(err?.message || err).slice(0, 160)}`);
    }
  } else if (args.useGrok !== false) {
    warnings.push("alpha: grok_disabled — nur Runner-Votes");
  }

  const decision = await orsDecide({
    symbol: args.symbol, allowEntries: args.allowEntries !== false,
    spreadBps: args.spreadBps, slippageBps: args.slippageBps,
  });
  if (decision?.error) warnings.push(`decide: ${decision.error}`);

  let riskReview: any;
  let dispatchBlocked = decision?.verdict === undefined;
  if (args.runRiskReview !== false && decision?.verdict && decision.verdict !== "NO_INTENT" && decision.intent) {
    try {
      riskReview = await grokRiskReview({ symbol: args.symbol, intent: decision.intent, sigmaState: sigma, deadlineMs: args.deadlineMs });
      costUsd += Number(riskReview?.engine?.costUsd || 0);
      if (riskReview.veto) {
        dispatchBlocked = true;
        // Gegenantrag in die Kammer: die Antragsseite wird dadurch fuer den Folgetakt
        // ehrlicher, ohne dass das Modell ein Sigma-Gate verbiegt.
        const dir = String(decision.intent.action || "").toUpperCase() === "LONG" ? -1 : 1;
        await orsSubmitVotes([{
          source: dir < 0 ? "grok_debate_bear" : "grok_debate_bull", symbol: args.symbol.toUpperCase(),
          direction: dir, strength: 0.6, confidence: 0.5, horizon_bars: 4,
          rationale: `risk-review veto: ${riskReview.note}`.slice(0, 400), bar_index: sigma?.bars ?? 0,
        }]);
      }
    } catch (err: any) {
      warnings.push(`risk_review_failed: ${String(err?.message || err).slice(0, 160)}`);
    }
  }

  return {
    symbol: args.symbol.toUpperCase(),
    parity: { parity_ok: parity?.parity_ok, worst_delta: parity?.worst_delta, reason: parity?.reason, delta: parity?.delta },
    derived: { count: derived?.derived, indicators: derived?.indicators },
    grok: grokBundle,
    decision,
    dispatchBlocked,
    riskReview,
    costUsd,
    pendingHooks: decision?.pending_hooks || [],
    warnings,
  };
}

/** Stand fuer UI/Desk: Engine-Status + offene Bot-Arbeit. */
export async function orchestratorSnapshot(symbol?: string): Promise<any> {
  const st = await orsStatus(symbol);
  return st;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(Number(v)) ? Number(v) : 0));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}
