/**
 * ORCHESTRATOR-BRUECKE (Alpha/Sigma Zwei-Kammer-System) — server/orchestratorEngine.ts
 *
 * Der eigentliche Orchestrator lebt in Python (app/orchestrator/alpha_sigma_engine.py),
 * weil dort bereits Sigma-Mathematik, Regime-Erkennung, Kelly-Sizing und die M8-Gates
 * sitzen. Diese Datei ist nur der schlanke, pro-Aufruf stateless Prozessstart mit
 * JSON-in/JSON-out; der Zustand wird von der Engine selbst in
 * data/orchestrator/ors_state.json persistiert (Snapshot/Hydratation).
 *
 * Warum so: der LLM-Stack (Node) darf Antraege stellen, aber die Bewilligung
 * (Sigma-Gates) laeuft in derselben Implementierung wie Backtest/CLI/Worker.
 * Ein zweites, in TS nachgebautes Regelwerk waere eine zweite Realitaet.
 *
 * >>> GROK-BOT [GBH-xx] >>>
 * Uebernahmepunkte sind in der Engine definiert und werden hier nur durchgereicht:
 *   GET  /api/orchestrator/hooks          -> Arbeitsliste (machine-lesbar)
 *   POST /api/orchestrator/hooks/:id/claim|resolution -> Status + Payload
 * <<< GROK-BOT [GBH-xx] <<<
 */

import { runPythonCommand } from "./quantitativeEngine";

// ---------------------------------------------------------------------------
// Payload-Kanal: base64 im ENV (shellsicher, kein Quoting-Infight mit JSON)
// ---------------------------------------------------------------------------

const ORS_HARNESS = `
import base64, json, os, sys, traceback
sys.path.insert(0, '.')
try:
    from app.orchestrator.alpha_sigma_engine import (
        AlphaSigmaOrchestrator, OrchestratorConfig, REGIME_SOURCE_MATRIX,
        GROK_BOT_HOOKS, hook_worklist, set_hook_state, sigma_indicators, sigma_parity_report,
    )
except Exception as exc:  # pragma: no cover
    print(json.dumps({"error": "import_failed", "detail": str(exc)}))
    raise SystemExit(0)

out = {}
try:
    p = json.loads((base64.b64decode(os.environ.get('ORS_PAYLOAD_B64', '') or b'{}')).decode('utf-8') or '{}')
    op = str(p.get('op') or 'status')
    o = AlphaSigmaOrchestrator()
    if op == 'status':
        out = o.status(p.get('symbol'))
    elif op == 'ingest':
        out = o.ingest(p['symbol'], prices=p.get('prices'), price=p.get('price'),
                       equity_usd=p.get('equity_usd'), available_cash_usd=p.get('available_cash_usd')).to_dict()
    elif op == 'votes':
        out = {'accepted': o.submit_votes(p.get('votes') or []), 'alpha': o.status(p.get('symbol'))['alpha']}
    elif op == 'derive':
        out = o.derive_runner_votes(p['symbol'], prices=p.get('prices'), params=p.get('params'))
    elif op == 'decide':
        out = o.decide(p['symbol'], allow_entries=bool(p.get('allow_entries', True)),
                       spread_bps=p.get('spread_bps'), est_slippage_bps=p.get('est_slippage_bps'),
                       auto_sigma_from=p.get('prices'))
    elif op == 'grok_signal':
        out = o.submit_grok_signal(p['symbol'], p.get('payload') or {})
    elif op == 'fill':
        out = o.confirm_fill(p['symbol'], p['action'], p['qty'], p['price'])
    elif op == 'parity':
        out = o.check_parity(p['symbol'], runner=p.get('runner'), params=p.get('params'),
                             mark_hook=bool(p.get('mark_hook', True)), prices=p.get('prices'))
    elif op == 'indicators':
        out = sigma_indicators(p.get('prices') or o.sigma._series.get(str(p.get('symbol') or '').upper(), []), p.get('params'), o.cfg)
    elif op == 'hooks':
        out = hook_worklist(o.state)
    elif op == 'hook_state':
        out = set_hook_state(o.state, p['hook_id'], p['status'], p.get('owner', 'grok-bot'),
                             p.get('note', ''), p.get('payload'))
    elif op == 'reset':
        out = o.reset(p.get('symbol'))
    elif op == 'worklist_matrix':
        out = {'regime_matrix': {k: [r.value for r in v] for k, v in REGIME_SOURCE_MATRIX.items()},
               'hooks': hook_worklist(o.state), 'config': o.status().get('config')}
    else:
        out = {"error": "unknown_op", "op": op, "known": ['status','ingest','votes','derive','decide','grok_signal','fill','parity','indicators','hooks','hook_state','reset','worklist_matrix']}
except SystemExit:
    raise
except Exception as exc:  # noqa: BLE001
    out = {"error": type(exc).__name__, "detail": str(exc), "trace": traceback.format_exc(limit=6)}
print(json.dumps(out, default=str))
`;

export type OrsOp =
  | "status" | "ingest" | "votes" | "derive" | "decide" | "grok_signal"
  | "fill" | "parity" | "indicators" | "hooks" | "hook_state" | "reset" | "worklist_matrix";

async function callOrchestrator(op: OrsOp, payload: Record<string, any> = {}): Promise<any> {
  const b64 = Buffer.from(JSON.stringify({ op, ...payload }), "utf-8").toString("base64");
  const cmd = `ORS_PAYLOAD_B64='${b64}' python3 -W ignore -c '${ORS_HARNESS.replace(/'/g, "'\\''")}'`;
  try {
    const res = await runPythonCommand(cmd);
    if (res && typeof res === "object" && "raw" in res && Object.keys(res).length === 1) {
      return { error: "python_response_unparsable", raw: String((res as any).raw).slice(0, 400) };
    }
    return res;
  } catch (err: any) {
    // Der Takt darf nie an der Bruecke scheitern — Aufrufer bekommen einen strukturierten Ausfall.
    return { error: "orchestrator_bridge_unavailable", detail: String(err?.message || err).slice(0, 400) };
  }
}

// ---------------------------------------------------------------------------
// Oeffentliche API der Bruecke
// ---------------------------------------------------------------------------

export function orsStatus(symbol?: string): Promise<any> {
  return callOrchestrator("status", symbol ? { symbol } : {});
}

export function orsIngest(args: {
  symbol: string; prices?: number[]; price?: number; equityUsd?: number; availableCashUsd?: number;
}): Promise<any> {
  return callOrchestrator("ingest", {
    symbol: args.symbol, prices: args.prices, price: args.price,
    equity_usd: args.equityUsd, available_cash_usd: args.availableCashUsd,
  });
}

export interface OrchestratorVote {
  source: string; symbol: string; direction: number; strength: number;
  confidence?: number; horizon_bars?: number; rationale?: string; bar_index?: number;
  meta?: Record<string, any>;
}

export function orsSubmitVotes(votes: OrchestratorVote[], symbol?: string): Promise<any> {
  return callOrchestrator("votes", { votes, symbol });
}

export function orsDeriveRunnerVotes(symbol: string, prices?: number[], params?: Record<string, any>): Promise<any> {
  return callOrchestrator("derive", { symbol, prices, params });
}

export function orsDecide(args: {
  symbol: string; allowEntries?: boolean; spreadBps?: number; slippageBps?: number; prices?: number[];
}): Promise<any> {
  return callOrchestrator("decide", {
    symbol: args.symbol, allow_entries: args.allowEntries !== false, spread_bps: args.spreadBps,
    est_slippage_bps: args.slippageBps, prices: args.prices,
  });
}

export function orsSubmitGrokSignal(symbol: string, payload: Record<string, any>): Promise<any> {
  return callOrchestrator("grok_signal", { symbol, payload });
}

export function orsConfirmFill(symbol: string, action: string, qty: number, price: number): Promise<any> {
  return callOrchestrator("fill", { symbol, action, qty, price });
}

/**
 * Paritaetspruefung. `markHook=true` (Default) bucht einen successfulichen Nachweis
 * als GBH-06-Resolution; `markHook=false` ist der reine Spiegel-Selbstvergleich
 * ohne Nachweiswirkung — fuer Debugging, nicht als Beleg.
 */
export function orsParity(symbol: string, runner?: Record<string, any>, params?: Record<string, any>,
                          markHook: boolean = true, prices?: number[]): Promise<any> {
  return callOrchestrator("parity", { symbol, runner, params, mark_hook: markHook, prices });
}

export function orsIndicators(symbol?: string, prices?: number[], params?: Record<string, any>): Promise<any> {
  return callOrchestrator("indicators", { symbol, prices, params });
}

export function orsHooks(): Promise<any> {
  return callOrchestrator("hooks");
}

export function orsSetHookState(args: {
  hookId: string; status: "PLACEHOLDER" | "CLAIMED" | "IMPLEMENTED";
  owner?: string; note?: string; payload?: Record<string, any>;
}): Promise<any> {
  return callOrchestrator("hook_state", {
    hook_id: args.hookId, status: args.status, owner: args.owner || "grok-bot",
    note: args.note || "", payload: args.payload,
  });
}

export function orsReset(symbol?: string): Promise<any> {
  return callOrchestrator("reset", symbol ? { symbol } : {});
}

export function orsWorklistMatrix(): Promise<any> {
  return callOrchestrator("worklist_matrix");
}
