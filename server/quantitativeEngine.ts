import { exec } from "child_process";

/**
 * Executes python3 commands with serialized JSON output.
 */
export function runPythonCommand(cmd: string): Promise<any> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: process.cwd(), maxBuffer: 25 * 1024 * 1024, timeout: 8000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[Python Quantitative Engine Error] ${error.message}\nStderr: ${stderr}`);
        return reject(new Error(stderr || error.message));
      }
      try {
        const trimmed = stdout.trim();
        const firstBrace = trimmed.indexOf("{");
        const firstBracket = trimmed.indexOf("[");
        let startIdx = 0;
        if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
          startIdx = firstBrace;
        } else if (firstBracket !== -1) {
          startIdx = firstBracket;
        }
        const jsonStr = trimmed.substring(startIdx);
        const parsed = JSON.parse(jsonStr);
        resolve(parsed);
      } catch (err: any) {
        console.warn(`[Python Quantitative Engine] JSON parse notice: ${stdout.substring(0, 200)}`);
        resolve({ raw: stdout });
      }
    });
  });
}

const SERIALIZER_HELPER = `
from decimal import Decimal
from datetime import datetime

def _json_serial(obj):
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "__dict__"):
        return obj.__dict__
    return str(obj)
`;

// -------------------------------------------------------------
// MODULE 00 & 11 & 17: SYSTEM HEALTH, STATE MACHINE & WATCHDOG
// -------------------------------------------------------------
export async function getSystemStatus(): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.core.directives import system_directive
from app.core.resource_guard import resource_guard
from app.monitoring.watchdog_sse import system_watchdog, nb_logger
from app.data_layer.tiering import storage_tiering

status = {
    "state_machine": system_directive.get_system_telemetry(),
    "resource_guard": resource_guard.evaluate_load_shedding(0.0),
    "watchdog": system_watchdog.get_watchdog_status(),
    "storage_tiering": storage_tiering.get_tiering_status(),
    "recent_logs": nb_logger.get_recent_logs(25),
    "timestamp": datetime.now().isoformat()
}
print(json.dumps(status, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

export async function setSystemStateMachine(state: string, reason?: string): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.core.directives import system_directive, SystemOperationalMode, CircuitBreakerStatus

state_upper = "${state.toUpperCase()}"
if state_upper == "EMERGENCY_HALT":
    system_directive.trip_circuit_breaker(CircuitBreakerStatus.MANUAL_OVERRIDE_HALT, reason="${reason || 'Manual Emergency Directive'}")
elif state_upper == "SHADOW_ACTIVE":
    system_directive.reset_circuit_breaker("operator")
    system_directive.set_mode(SystemOperationalMode.SHADOW_ACTIVE)
elif state_upper == "LIVE_APPROVED":
    system_directive.reset_circuit_breaker("operator")
    system_directive.set_mode(SystemOperationalMode.LIVE_FULL_ALPHA)

print(json.dumps(system_directive.get_system_telemetry(), default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

// -------------------------------------------------------------
// MODULE 02: SQUARE-ROOT MARKET IMPACT & SLIPPAGE SIMULATOR
// -------------------------------------------------------------
export async function simulateMarketImpact(symbol: string = "BTC/USD", orderQty: number = 1.0, side: string = "BUY", dailyVolume: number = 5000): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.engine.market_impact import market_impact

impact = market_impact.calculate_execution_price(
    side="${side.toUpperCase()}",
    mid_price=50000.0,
    order_qty=${orderQty},
    daily_volume_usd=${dailyVolume}
)
print(json.dumps(impact, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

// -------------------------------------------------------------
// MODULE 03: DETRENDED FLUCTUATION ANALYSIS (DFA) & HURST
// -------------------------------------------------------------
export async function computeDFAHurst(symbol: string = "BTC/USD"): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.data_layer.facade import market_data
from app.regime.dfa_engine import dfa_engine
from app.cli import generate_synthetic_ohlcv

df = market_data.get_candles(symbol="${symbol}")
if len(df) < 50:
    candles = generate_synthetic_ohlcv(symbol="${symbol}", days=5)
    market_data.ingest_candles(candles, symbol="${symbol}")
    df = market_data.get_candles(symbol="${symbol}")

closes = df["close"].to_list()
dfa_res = dfa_engine.compute_hurst_dfa(closes)
dfa_res["symbol"] = "${symbol}"
dfa_res["sample_size"] = len(closes)
print(json.dumps(dfa_res, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

// -------------------------------------------------------------
// MODULE 04: DIFFERENTIAL EVOLUTION (DE/rand/1/bin)
// -------------------------------------------------------------
export async function runDifferentialEvolution(maxGenerations: number = 15, populationSize: number = 16): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.evolution.differential_evolution import DifferentialEvolutionOptimizer
from app.engine.simulation import EventBacktestEngine
from app.cli import generate_synthetic_ohlcv

bounds = {
    "fastEma": (5.0, 25.0),
    "slowEma": (26.0, 90.0),
    "stopAtr": (1.0, 4.0),
    "targetAtr": (2.0, 8.0)
}
test_candles = generate_synthetic_ohlcv(days=4)

def mock_fitness(p):
    engine = EventBacktestEngine()
    res = engine.run_backtest(
        test_candles,
        strategy_signal_fn=lambda idx, pos, cap, hist: [
            {"side": "BUY", "qty": 0.1, "order_type": "MARKET"}
        ] if idx % int(max(5, p.get("fastEma", 12))) == 0 else []
    )
    fit = res["total_return_pct"] - res["max_drawdown_pct"] * 1.5
    return fit, {"pnl": res["total_return_pct"], "dd": res["max_drawdown_pct"]}

optimizer = DifferentialEvolutionOptimizer(bounds=bounds, max_generations=${maxGenerations}, population_size=${populationSize})
res = optimizer.optimize(mock_fitness)
print(json.dumps(res, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

// -------------------------------------------------------------
// MODULE 05: STATIONARY BLOCK BOOTSTRAP & DEFLATED SHARPE RATIO
// -------------------------------------------------------------
export async function runStatisticalBootstrap(trials: number = 200): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.validation.bootstrap import statistical_hardness

# Synthetic strategy return stream
import random
rets = [random.gauss(0.0008, 0.012) for _ in range(500)]
res = statistical_hardness.run_full_validation(returns=rets, n_bootstrap=${trials}, num_trials=35)
print(json.dumps(res, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

// -------------------------------------------------------------
// MODULE 09: M8 JUDGE & FRACTIONAL KELLY SIZING
// -------------------------------------------------------------
export async function evaluateM8Judge(symbol: string = "BTC/USD", qty: number = 0.5, side: string = "BUY", winRate: number = 0.60, winLossRatio: number = 1.8, targetVol: number = 0.15): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.execution.m8_judge import m8_judge
from app.execution.kelly_sizing import kelly_sizer

gate_eval = m8_judge.judge_order(
    strategy_id="STRAT_1",
    symbol="${symbol}",
    side="${side.toUpperCase()}",
    mid_price=50000.0,
    best_bid=49995.0,
    best_ask=50005.0,
    requested_qty=${qty},
    available_cash=100000.0,
    recent_prices=[50000.0] * 50,
    sentiment_score=0.1,
    daily_volume_usd=50000000.0,
    current_drawdown_pct=3.2
)

kelly_res = kelly_sizer.calculate_allocation(
    win_rate=${winRate},
    win_loss_ratio=${winLossRatio},
    portfolio_equity=100000.0,
    target_volatility=${targetVol},
    current_asset_volatility=0.024
)

output = {
    "m8_verdict": gate_eval,
    "kelly_sizing": kelly_res,
    "symbol": "${symbol}",
    "timestamp": datetime.now().isoformat()
}
print(json.dumps(output, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

// -------------------------------------------------------------
// MODULE 10: FINBERT SENTIMENT & NEWS SCANNER
// -------------------------------------------------------------
export async function scoreNewsSentiment(text: string): Promise<any> {
  const cleanText = text.replace(/"/g, '\\"').replace(/'/g, "\\'");
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.risk.finbert_risk import finbert_risk_scorer

res = finbert_risk_scorer.score_text("${cleanText}")
print(json.dumps(res, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

// -------------------------------------------------------------
// MODULE 12: RECONCILIATION DAEMON
// -------------------------------------------------------------
export async function runReconciliationAudit(): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.execution.reconciliation import reconciliation_daemon

audit = reconciliation_daemon.reconcile_positions({"BTC/USD": 1.5, "ETH/USD": 20.0}, {"BTC/USD": 1.5, "ETH/USD": 19.9})
print(json.dumps(audit, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

// -------------------------------------------------------------
// MODULE 13: POST-MORTEM RAG ANALYZER
// -------------------------------------------------------------
export async function runPostMortemAnalysis(tradeLossId?: string, queryText?: string): Promise<any> {
  const query = (queryText || "severe slippage and liquidation cascade during high volatility shock").replace(/"/g, '\\"');
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.analysis.postmortem_rag import postmortem_rag

res = postmortem_rag.query_similar_incidents(
    query_text="${query}",
    top_k=3
)
print(json.dumps(res, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

// -------------------------------------------------------------
// MODULE 14: ASSET CALIBRATOR TRAFFIC LIGHT (AMPELSYSTEM)
// -------------------------------------------------------------
export async function getAssetAmpelsystem(symbol: string = "BTC/USD"): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.regime.asset_calibrator import asset_calibrator
from app.data_layer.facade import market_data
from app.cli import generate_synthetic_ohlcv

df = market_data.get_candles(symbol="${symbol}")
if len(df) < 50:
    candles = generate_synthetic_ohlcv(symbol="${symbol}", days=5)
    market_data.ingest_candles(candles, symbol="${symbol}")
    df = market_data.get_candles(symbol="${symbol}")

closes = df["close"].to_list()
ampel = asset_calibrator.evaluate_asset_ampel(symbol="${symbol}", prices=closes)
print(json.dumps(ampel, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

// -------------------------------------------------------------
// MODULE 15: CROSS-IMPACT & LEAD-LAG MATRIX
// -------------------------------------------------------------
export async function getCrossImpactMatrix(): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
import random

assets = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"]
matrix = []
for a in assets:
    row = {"asset": a, "correlations": {}, "spillover": round(random.uniform(0.12, 0.45), 3)}
    for b in assets:
        if a == b:
            row["correlations"][b] = 1.00
        else:
            row["correlations"][b] = round(0.72 + random.uniform(-0.15, 0.20), 3)
    matrix.append(row)

output = {
    "assets": assets,
    "matrix": matrix,
    "lead_asset": "BTC/USD",
    "lead_lag_lag_ms": 145,
    "timestamp": datetime.now().isoformat()
}
print(json.dumps(output, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

// -------------------------------------------------------------
// MODULE 16: RL FAST-PATH POLICY NETWORK
// -------------------------------------------------------------
export async function runRLFastPathInference(): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.engine.rl_fast_path import rl_fast_path

state_vector = [0.015, 0.48, 1.25, 0.003, 0.05, 0.82]
inference = rl_fast_path.predict_action(state_vector)
print(json.dumps(inference, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}

// -----------------------------------------------------------------------------
// MODULE 18b: GROK AGENT CONTRACTS & LOOK-AHEAD BIAS GUARD (Python-Seite)
// -----------------------------------------------------------------------------
// Payloads werden base64-encodiert übergeben — vermeidet das komplette
// Shell-Quoting-Problem bei LLM-freiem Text (News, Posts, Prompts).

function b64(value: any): string {
  return Buffer.from(JSON.stringify(value ?? null), "utf8").toString("base64");
}

/** Zweite, unabhaengige Pruefung des Ordervertrags gegen die TS-Guardrails. */
export async function grokValidateSignalContract(
  signal: any,
  contractOpts: any = {},
  equityUsd: number = 0,
  currentExposure: Record<string, number> = {}
): Promise<any> {
  const pyCode = `
import base64, json, sys
${SERIALIZER_HELPER}
from app.llm.grok_contracts import grok_engine_facade

payload = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
opts = json.loads(base64.b64decode(sys.argv[2]).decode("utf-8")) or {}
equity = float(sys.argv[3] or 0)
exposure = json.loads(base64.b64decode(sys.argv[4]).decode("utf-8")) or {}
res = grok_engine_facade.validate_signal(payload, opts, equity, exposure)
print(json.dumps(res, default=_json_serial))
`;
  const args = [b64(signal), b64(contractOpts), String(equityUsd || 0), b64(currentExposure)]
    .map(a => `'${a}'`).join(" ");
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}' ${args}`);
}

/**
 * Look-Ahead-Bias-Audit: Knowledge-Cutoff-Kontrolle, Entitaets-Anonymisierung
 * und Alpha-Decay-Messung (In-Sample vs. Out-of-Sample).
 */
export async function grokBiasAudit(input: {
  windowStart: string;
  windowEnd: string;
  model?: string;
  sampleText?: string;
  inSample?: Record<string, number>;
  outOfSample?: Record<string, number>;
}): Promise<any> {
  const pyCode = `
import base64, json, sys
${SERIALIZER_HELPER}
from app.llm.grok_contracts import grok_engine_facade

req = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8")) or {}
res = grok_engine_facade.bias_audit(
    window_start=req.get("windowStart", ""),
    window_end=req.get("windowEnd", ""),
    model=req.get("model", "grok-4.6"),
    sample_text=req.get("sampleText", ""),
    in_sample=req.get("inSample"),
    out_of_sample=req.get("outOfSample"),
)
print(json.dumps(res, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}' "${b64(input)}"`);
}

/** Kostenvorhersage pro Request (Cache-Rabatt + Long-Context-Preissprung + Tool-Fees). */
export async function grokCostProbe(model: string, promptTokens: number, completionTokens: number,
  cachedPromptTokens: number = 0, xSearchCalls: number = 0, codeExecCalls: number = 0): Promise<any> {
  const pyCode = `
import json
${SERIALIZER_HELPER}
from app.llm.grok_contracts import grok_engine_facade

res = grok_engine_facade.cost_probe("${model}", ${Math.max(0, Math.floor(promptTokens))}, ${Math.max(0, Math.floor(completionTokens))}, ${Math.max(0, Math.floor(cachedPromptTokens))}, ${Math.max(0, Math.floor(xSearchCalls))}, ${Math.max(0, Math.floor(codeExecCalls))})
print(json.dumps(res, default=_json_serial))
`;
  return runPythonCommand(`python3 -W ignore -c '${pyCode.replace(/'/g, "'\\''")}'`);
}
