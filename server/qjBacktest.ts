/**
 * QuantJourney Backtester bridge.
 *
 * All compute runs in Python (`python -m app.backtest.cli`, see
 * `app/backtest/`).  This module is a thin, typed, defensive transport:
 *
 *  - probes engine capabilities (cached)
 *  - streams a JSON request on stdin and parses one JSON document from stdout
 *  - enforces timeouts and output limits
 *  - serves persisted artifacts from the run store
 *
 * The Python service already returns the UI's historical `BacktestResult`
 * shape (summary / equityCurve / trades) *plus* the richer QJ analytics
 * envelope, so callers can render either representation.
 */

import { spawn } from "child_process";
import type { BacktestResult } from "../src/types";
import fs from "fs";
import path from "path";

export interface QjVersions {
  quantjourneyBt?: string | null;
  quantjourneyTi?: string | null;
  pandas?: string | null;
  numpy?: string | null;
  python?: string | null;
}

export interface QjModelParam {
  key: string;
  label: string;
  type: "int" | "float" | "bool" | "json" | string;
  default: unknown;
  min?: number;
  max?: number;
}

export interface QjModelDefinition {
  id: string;
  label: string;
  family: string;
  description: string;
  params: QjModelParam[];
}

export interface QjCapabilities {
  engine: "quantjourney-bt" | "native-fallback" | string;
  qjAvailable: boolean;
  tiAvailable: boolean;
  versions: QjVersions;
  missing: string[];
  models: QjModelDefinition[];
  features: Record<string, boolean>;
  runsDir?: string;
  runCount?: number;
}

export interface QjTrade {
  id: string;
  symbol?: string;
  type: "buy" | "sell";
  side?: "long" | "short";
  entryTime: string;
  exitTime?: string | null;
  entryPrice: number;
  exitPrice?: number | null;
  amount: number;
  totalValue: number;
  fee: number;
  pnl: number;
  pnlPercent: number;
  reason: string;
  status: "closed" | "open";
  holdingBars?: number;
}

export interface QjEquityPoint {
  timestamp: string;
  time: string;
  price: number;
  equity: number;
  benchmarkEquity: number;
  drawdown: number;
  cash: number;
  assetHoldings: number;
  action?: "buy" | "sell" | "stop-loss";
  tradePrice?: number;
}

export interface QjMetrics {
  [key: string]: unknown;
  totalReturnPercent?: number | null;
  cagrPercent?: number | null;
  sharpeRatio?: number | null;
  sortinoRatio?: number | null;
  calmarRatio?: number | null;
  maxDrawdownPercent?: number | null;
  annualizedVolatilityPercent?: number | null;
  winRate?: number | null;
  profitFactor?: number | null;
  totalTrades?: number | null;
  averageTradeReturnPercent?: number | null;
  turnoverRatio?: number | null;
  exposurePercent?: number | null;
  var95Percent?: number | null;
  cvar95Percent?: number | null;
  alphaPercent?: number | null;
  beta?: number | null;
  benchmarkReturnPercent?: number | null;
  metricFrequency?: string;
}

export interface QjAnalytics {
  engine: {
    engine: string;
    version?: string | null;
    mode?: string;
    rebalanceEngine?: string;
    costSolver?: string;
    costModel?: string;
    policy?: string;
    periodsPerYear?: number;
  };
  metrics: QjMetrics;
  tradeStats?: Record<string, unknown>;
  rebalance?: { policy?: string; count?: number; stats?: Record<string, unknown> };
  contribution?: Record<
    string,
    { contributionPercent?: number; sharePercent?: number | null; averageWeightPercent?: number; exposureSharePercent?: number }
  >;
  data?: {
    source?: string;
    symbols?: string[];
    bars?: number;
    start?: string;
    end?: string;
    intervalMinutes?: number;
    benchmark?: string;
  };
  strategy?: { model?: string; params?: Record<string, unknown>; diagnostics?: Record<string, unknown> };
  quality?: { warnings?: string[]; rating?: string; confidence?: string };
  assumptions?: Record<string, unknown>;
  optimization?: Record<string, unknown>;
}

export interface QjArtifact {
  name: string;
  bytes?: number;
  mediaType?: string;
  url: string;
}

export interface QjBacktestResponse {
  id: string;
  runId: string;
  kind: "backtest";
  strategyId: string;
  strategyName: string;
  assetPair: string;
  symbols: string[];
  interval: number;
  periodLabel: string;
  startTime: string;
  endTime: string;
  totalCandles: number;
  summary: BacktestResult["summary"];
  equityCurve: QjEquityPoint[];
  trades: QjTrade[];
  analytics: QjAnalytics;
  engine: string;
  warnings: string[];
  artifacts: QjArtifact[];
}

// Compile-time proof that the bridge payload keeps satisfying the UI contract.
const _backtestResultContract: BacktestResult = {} as QjBacktestResponse;
void _backtestResultContract;

export interface QjArenaSignalCheck {
  label: string;
  value: string;
  status: "pass" | "fail" | "info" | string;
}

export interface QjArenaLadderStep {
  target: string;
  rMultiple: number;
  fraction: number;
  price: number | null;
  hit: boolean;
  time: string | null;
}

export interface QjArenaTrade {
  id: string;
  symbol: string;
  side: string;
  entryTime: string;
  exitTime: string | null;
  entryPrice: number;
  exitPrice: number | null;
  amount: number;
  totalValue?: number;
  fee?: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  reason?: string;
  holdingBars?: number;
  entryTs?: number | null;
  exitTs?: number | null;
  rMultiple: number;
  grossR?: number;
  feeR?: number;
  riskAmount?: number;
  riskDistance?: number;
  exitReason?: string;
  simulated?: boolean;
  ladder?: QjArenaLadderStep[];
}

export interface QjArenaBot {
  id: string;
  name: string;
  tagline: string;
  family: string;
  model: string;
  params: Record<string, unknown>;
  color: string;
  rule: string;
  rank: number;
  scoreR: number;
  avgR: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  profitFactorR: number | null;
  totalTrades: number;
  openTrades: number;
  totalReturnPercent: number | null;
  maxDrawdownPercent: number | null;
  sharpeRatio: number | null;
  exposurePercent: number | null;
  equityCurve: Array<{ time: string; equity: number }>;
  trades: QjArenaTrade[];
  lastTrade: QjArenaTrade | null;
  openPosition: Record<string, any> | null;
  signal: {
    state: string;
    label: string;
    detail: string;
    checks: QjArenaSignalCheck[];
    lastPrice: number | null;
    lastWeight: number | null;
  };
  status: string;
}

export interface QjArenaResponse {
  kind: "arena";
  generatedAt: string;
  symbols: string[];
  assetPair: string;
  interval: number;
  periodLabel: string;
  totalCandles: number;
  source: string;
  engine: Record<string, any>;
  scoring: {
    metric: string;
    basis: string;
    riskPercent: number;
    ladder: number[];
    ladderSizing: string;
  };
  priceSeries: Array<{ timestamp: string; ts: number; time: string; price: number }>;
  bots: QjArenaBot[];
  leaderboard: Array<Record<string, any>>;
  tradeTape: Array<Record<string, any>>;
  notes: Array<{ id: string; title: string; body: string }>;
  warnings: string[];
  assumptions: Record<string, any>;
  elapsedSeconds: number | null;
}

export interface QjFold {
  fold: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainBars?: number;
  testBars?: number;
  bestParams?: Record<string, unknown>;
  inSample?: Record<string, any>;
  outOfSample?: Record<string, any>;
  efficiency?: number | null;
  overfitRatio?: number | null;
  deflatedSharpe?: number | null;
  rankStabilityLogit?: number | null;
  stitchedNav?: number;
  status: string;
  error?: string;
}

export interface QjWalkForwardResponse {
  runId: string;
  kind: "walkforward";
  strategyName: string;
  assetPair: string;
  symbols: string[];
  periodLabel: string;
  geometry: {
    scheme: string;
    trainBars: number;
    testBars: number;
    stepBars: number;
    purgeBars: number;
    folds: number;
    gridSize: number;
  };
  folds: QjFold[];
  summary: {
    nFolds: number;
    failedFolds: number;
    oosSharpe?: number | null;
    oosCagrPercent?: number | null;
    oosTotalReturnPercent?: number | null;
    oosMaxDrawdownPercent?: number | null;
    inSampleSharpe?: number;
    meanOosSharpe?: number;
    efficiency?: number | null;
    overfitRatio?: number | null;
    sharpeDecayPerFold?: number | null;
    consistencyPercent?: number;
    bestParams?: Record<string, unknown>;
    deflatedSharpe?: number | null;
    deflatedSharpeMethod?: string | null;
    deflatedSharpeReason?: string | null;
    rankStabilityFailureRate?: number | null;
    rankStabilityReason?: string | null;
    objective: string;
    warnings: string[];
    verdicts: Array<{ name: string; value: number; signal: string; description: string }>;
    elapsedSeconds?: number;
  };
  equityCurve: QjEquityPoint[];
  warnings: string[];
  artifacts: QjArtifact[];
}

export interface QjTrial {
  rank: number;
  params: Record<string, unknown>;
  score: number;
  sharpeRatio?: number | null;
  totalReturnPercent?: number | null;
  maxDrawdownPercent?: number | null;
  totalTrades?: number | null;
  profitFactor?: number | null;
}

export interface QjOptimizationResponse {
  runId: string;
  kind: "optimization";
  strategyName: string;
  assetPair: string;
  symbols: string[];
  periodLabel: string;
  summary: {
    objective: string;
    gridSize: number;
    completedTrials: number;
    failedTrials: number;
    bestParams: Record<string, unknown>;
    bestScore?: number | null;
    bestMetrics?: Record<string, any>;
    deflatedSharpe?: number | null;
    deflatedSharpeReason?: string | null;
    baselineMetrics?: Record<string, any>;
    warnings: string[];
    elapsedSeconds?: number;
  };
  trials: QjTrial[];
  bestResult?: QjBacktestResponse | null;
  warnings: string[];
  artifacts: QjArtifact[];
}

export interface QjStressScenario {
  feeBps: number;
  slippageBps: number;
  totalBps: number;
  totalReturnPercent?: number | null;
  cagrPercent?: number | null;
  sharpeRatio?: number | null;
  maxDrawdownPercent?: number | null;
  totalCostsUSD?: number | null;
  totalTrades?: number | null;
  status: string;
  error?: string;
}

export interface QjStressResponse {
  runId: string;
  kind: "stress";
  strategyName: string;
  assetPair: string;
  symbols: string[];
  periodLabel: string;
  summary: {
    scenarios: number;
    breakevenBps?: number | null;
    zeroCostReturnPercent?: number | null;
    highestCostReturnPercent?: number | null;
    returnDecayPercent?: number | null;
    elapsedSeconds?: number;
  };
  scenarios: QjStressScenario[];
  warnings: string[];
  artifacts: QjArtifact[];
}

export interface QjRunSummary {
  runId: string;
  kind: string;
  createdAt: string;
  strategyName?: string;
  assetPair?: string;
  interval?: number;
  periodLabel?: string;
  engine?: string;
  metrics?: Record<string, any>;
  warnings?: string[];
  config?: Record<string, any> | null;
  artifactCount?: number;
}

const ARTIFACT_ALLOWLIST = new Set([
  "result.json",
  "payload.json",
  "summary.json",
  "metrics.csv",
  "equity_curve.csv",
  "trades.csv",
  "weights.csv",
  "folds.csv",
  "trials.csv",
  "stress.csv",
  "dashboard.html",
  "manifest.json",
]);

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{5,95}$/;

interface CapabilitiesCache {
  value: QjCapabilities | null;
  at: number;
  error?: string;
}

let capabilitiesCache: CapabilitiesCache = { value: null, at: 0 };

export function pythonExecutable(): string {
  return process.env.PYTHON_BIN || process.env.PYTHON_EXECUTABLE || "python3";
}

export function qjRunsDirectory(): string {
  return process.env.QJ_BACKTEST_RUNS_DIR || path.join(process.cwd(), "data", "backtest_runs");
}

function cliEnvironment(): NodeJS.ProcessEnv {
  const root = process.cwd();
  const existingPath = process.env.PYTHONPATH || "";
  return {
    ...process.env,
    PYTHONPATH: existingPath ? `${root}${path.delimiter}${existingPath}` : root,
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
    QJ_LOG_LEVEL: process.env.QJ_LOG_LEVEL || "ERROR",
  };
}

const MAX_STDOUT_BYTES = 96 * 1024 * 1024;

function runCli(
  command: string,
  payload: Record<string, unknown> | null,
  timeoutMs = 180_000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const args = ["-m", "app.backtest.cli", command, "--request", "-"];
    const child = spawn(pythonExecutable(), args, {
      cwd: process.cwd(),
      env: cliEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new Error(`QJ backtest timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill("SIGKILL");
          reject(new Error("QJ backtest output exceeded the transport limit"));
        }
        return;
      }
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 64_000) stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Unable to start Python backtester: ${error.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const trimmed = stdout.trim();
      let parsed: any = null;
      if (trimmed) {
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          parsed = null;
        }
      }
      if (parsed && parsed.ok === false) {
        reject(new Error(parsed.error || "QJ backtest failed"));
        return;
      }
      if (code !== 0) {
        const detail =
          (parsed && parsed.error) ||
          stderr.trim().split("\n").slice(-3).join(" | ") ||
          `exit code ${code}`;
        reject(new Error(`QJ backtest failed: ${detail}`));
        return;
      }
      if (!parsed) {
        reject(
          new Error(
            `QJ backtest returned no JSON${stderr ? ` (${stderr.trim().split("\n").slice(-2).join(" | ")})` : ""}`
          )
        );
        return;
      }
      resolve(parsed);
    });

    if (payload !== null) {
      try {
        child.stdin.write(JSON.stringify(payload));
      } catch (error: any) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Unable to send backtest request: ${error?.message}`));
        }
        return;
      }
    }
    child.stdin.end();
  });
}

export async function getQjCapabilities(force = false): Promise<QjCapabilities> {
  const now = Date.now();
  if (!force && capabilitiesCache.value && now - capabilitiesCache.at < 60_000) {
    return capabilitiesCache.value;
  }
  try {
    const payload = await runCli("engines", null, 60_000);
    const capabilities = payload as QjCapabilities;
    capabilitiesCache = { value: capabilities, at: now };
    return capabilities;
  } catch (error: any) {
    const fallback: QjCapabilities = {
      engine: "native-fallback",
      qjAvailable: false,
      tiAvailable: false,
      versions: {},
      missing: ["quantjourney-bt", "pandas"],
      models: [],
      features: {
        weightsMode: false,
        transactionCosts: false,
        rebalancePolicies: false,
        walkForward: false,
        optimization: false,
        costStress: false,
        dashboardReport: false,
        deflatedSharpe: false,
        rankStability: false,
      },
    };
    capabilitiesCache = { value: fallback, at: now, error: error?.message };
    return fallback;
  }
}

export async function runQjBacktest(payload: Record<string, unknown>): Promise<QjBacktestResponse> {
  return (await runCli("run", payload, 240_000)) as QjBacktestResponse;
}

export async function runQjWalkForward(payload: Record<string, unknown>): Promise<QjWalkForwardResponse> {
  return (await runCli("walkforward", payload, 600_000)) as QjWalkForwardResponse;
}

export async function runQjOptimization(payload: Record<string, unknown>): Promise<QjOptimizationResponse> {
  return (await runCli("optimize", payload, 600_000)) as QjOptimizationResponse;
}

export async function runQjStress(payload: Record<string, unknown>): Promise<QjStressResponse> {
  return (await runCli("stress", payload, 300_000)) as QjStressResponse;
}

export async function runQjArena(payload: Record<string, unknown>): Promise<QjArenaResponse> {
  return (await runCli("arena", payload, 300_000)) as QjArenaResponse;
}

export async function listQjRuns(limit = 50, kind?: string): Promise<QjRunSummary[]> {
  const args = ["list", "--limit", String(limit)];
  if (kind) args.push("--kind", kind);
  // `list` does not read stdin, so avoid the piped request.
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable(), ["-m", "app.backtest.cli", ...args], {
      cwd: process.cwd(),
      env: cliEnvironment(),
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("QJ run listing timed out"));
    }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || "QJ run listing failed"));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve((parsed.runs || []) as QjRunSummary[]);
      } catch (error: any) {
        reject(new Error(`Invalid run listing: ${error?.message}`));
      }
    });
  });
}

export async function getQjRun(runId: string, includeResult = false): Promise<any> {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("invalid run id");
  const args = ["show", runId];
  if (!includeResult) args.push("--summary-only");
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable(), ["-m", "app.backtest.cli", ...args], {
      cwd: process.cwd(),
      env: cliEnvironment(),
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("QJ run lookup timed out"));
    }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || "QJ run not found"));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error: any) {
        reject(new Error(`Invalid run payload: ${error?.message}`));
      }
    });
  });
}

export async function deleteQjRun(runId: string): Promise<any> {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("invalid run id");
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable(), ["-m", "app.backtest.cli", "delete", runId], {
      cwd: process.cwd(),
      env: cliEnvironment(),
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("QJ run deletion timed out"));
    }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || "QJ run deletion failed"));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error: any) {
        reject(new Error(`Invalid delete response: ${error?.message}`));
      }
    });
  });
}

export async function compareQjRuns(runIds: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonExecutable(),
      ["-m", "app.backtest.cli", "compare", ...runIds],
      { cwd: process.cwd(), env: cliEnvironment() }
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("QJ run comparison timed out"));
    }, 60_000);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || "QJ run comparison failed"));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error: any) {
        reject(new Error(`Invalid comparison payload: ${error?.message}`));
      }
    });
  });
}

/**
 * Infer a QJ strategy model from a UI strategy's parameters/code.
 * Explicit `model` always wins; otherwise the common seeded templates are
 * mapped onto the closest QuantJourney model family.
 */
export function inferStrategySpec(
  params: Record<string, any> | undefined,
  code: string | undefined,
  explicitModel?: string
): { model: string; params: Record<string, any> } {
  const parameters = { ...(params || {}) };
  if (explicitModel) return { model: explicitModel, params: parameters };
  const source = `${code || ""} ${JSON.stringify(parameters)}`.toLowerCase();
  const num = (value: any, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  if (parameters.fastPeriod || parameters.slowPeriod || source.includes("macd")) {
    return {
      model: "macd_trend",
      params: {
        fast: num(parameters.fastPeriod, 12),
        slow: num(parameters.slowPeriod, 26),
        signal: num(parameters.signalPeriod, 9),
      },
    };
  }
  if (parameters.rsiPeriod || parameters.oversold || source.includes("rsi")) {
    return {
      model: "rsi_reversion",
      params: {
        period: num(parameters.rsiPeriod, 14),
        oversold: Math.min(49, Math.max(1, num(parameters.oversold, 30))),
        exit_level: Math.min(99, Math.max(51, num(parameters.overbought, 55))),
      },
    };
  }
  if (parameters.gridLevels) {
    return { model: "bollinger_reversion", params: { period: 20, num_std: 2.0 } };
  }
  if (parameters.fast || parameters.slow) {
    const fast = num(parameters.fast, 20);
    const slow = Math.max(fast + 1, num(parameters.slow, 60));
    return { model: "sma_cross", params: { fast, slow } };
  }
  return { model: "sma_cross", params: { fast: 20, slow: 60 } };
}

export function readQjArtifact(runId: string, name: string): { content: Buffer; mediaType: string } {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("invalid run id");
  if (!ARTIFACT_ALLOWLIST.has(name)) throw new Error("unknown artifact");
  const directory = path.resolve(qjRunsDirectory(), runId);
  const file = path.resolve(directory, name);
  if (!file.startsWith(directory + path.sep)) throw new Error("invalid artifact path");
  if (!fs.existsSync(file)) throw new Error("artifact not found");
  const mediaType = name.endsWith(".html")
    ? "text/html; charset=utf-8"
    : name.endsWith(".json")
      ? "application/json"
      : "text/csv; charset=utf-8";
  return { content: fs.readFileSync(file), mediaType };
}

/**
 * Fetch OHLC for the configured symbols and build the `candles` payload the
 * Python engine expects.  Kept here so routes share one fetch/validation path.
 */
export function candlesPayload(
  pairs: string[],
  candlesByPair: Record<string, Array<Record<string, unknown>>>
): Record<string, Array<Record<string, unknown>>> {
  const payload: Record<string, Array<Record<string, unknown>>> = {};
  for (const pair of pairs) {
    const candles = candlesByPair[pair];
    if (candles && candles.length) {
      payload[pair] = candles.map((candle) => ({
        time: candle.time ?? candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      }));
    }
  }
  return payload;
}

export function invalidateQjCapabilities(): void {
  capabilitiesCache = { value: null, at: 0 };
}
