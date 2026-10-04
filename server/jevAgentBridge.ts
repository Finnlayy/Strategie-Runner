import { exec } from "child_process";
import { promisify } from "util";
import { submitKrakenOrder } from "./kraken";

const execAsync = promisify(exec);

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
export const JEV_API_URL = "https://openrouter.ai/api/alpha/decisions";

export interface MarketState {
  timestamp: number;
  symbol: string;
  bid_ask_spread: number;
  order_book_imbalance: number; // -1.0 (pure asks) to +1.0 (pure bids)
  delta_vof: number;           // Volume Order Flow delta (positive = net aggressive buying)
  recent_volatility_atr: number;
  micro_price_trend: "upward" | "downward" | "neutral" | string;
}

export interface JevSignalOutput {
  symbol: string;
  timestamp: number;
  signal: "long" | "short" | "wait";
  probabilities: {
    long: number;
    short: number;
    wait: number;
  };
  urgency_score: number;
  spread_safe_probability: number; // noul
  executable_action: boolean;
  gating: {
    spread_safe: boolean;
    urgency_sufficient: boolean;
    confidence_sufficient: boolean;
    reasons: string[];
  };
  source: "openrouter_jev" | "local_heuristic";
  raw_answers?: any;
  execution_plan?: {
    action: "buy" | "sell" | "none";
    order_type: "limit" | "market";
    suggested_volume: number;
    suggested_price?: number;
    cli_command: string;
  };
}

export interface JevExecutionHistoryItem {
  id: string;
  timestamp: number;
  market_state: MarketState;
  signal: JevSignalOutput;
  dispatch_result?: {
    status: "executed" | "paper_simulated" | "blocked" | "error";
    order_id?: string;
    message: string;
    executed_at: number;
    cli_command: string;
  };
}

// In-memory decision log (last 50 signals)
const signalHistory: JevExecutionHistoryItem[] = [];

/**
 * Derives a synthetic or empirical MarketState from current market ticker telemetry.
 */
export function buildLiveMarketState(
  symbol: string,
  price: number,
  change24h: number = 0,
  volume: number = 1000
): MarketState {
  // Compute normalized bid/ask spread
  const baseSpread = symbol.includes("BTC") ? 0.50 : symbol.includes("ETH") ? 0.25 : 0.08;
  const spreadJitter = ((Date.now() % 17) - 8) * 0.02;
  const bid_ask_spread = Math.max(0.02, parseFloat((baseSpread + spreadJitter).toFixed(2)));

  // Compute order book imbalance (-1.0 to 1.0) correlated with 24h change & recent tick
  const momentumBias = Math.max(-0.6, Math.min(0.6, change24h / 10));
  const tickJitter = ((Date.now() % 23) - 11) * 0.03;
  const order_book_imbalance = parseFloat(Math.max(-0.95, Math.min(0.95, momentumBias + tickJitter)).toFixed(2));

  // Compute volume order flow delta (delta_vof)
  const baseVof = Math.round(order_book_imbalance * (volume > 1000 ? 1800 : 800));
  const delta_vof = baseVof + Math.round(((Date.now() % 50) - 25) * 15);

  // ATR estimate
  const recent_volatility_atr = parseFloat(Math.max(1.5, (price * 0.0018)).toFixed(2));

  const micro_price_trend = order_book_imbalance > 0.25 ? "upward" : order_book_imbalance < -0.25 ? "downward" : "neutral";

  return {
    timestamp: Date.now(),
    symbol,
    bid_ask_spread,
    order_book_imbalance,
    delta_vof,
    recent_volatility_atr,
    micro_price_trend,
  };
}

/**
 * Pure heuristic evaluator implementing Jev 1.13 decision criteria locally
 * when OPENROUTER_API_KEY is unset or API is unreachable.
 */
export function evaluateLocalJevHeuristic(state: MarketState): JevSignalOutput {
  const { symbol, bid_ask_spread, order_book_imbalance, delta_vof, recent_volatility_atr, micro_price_trend } = state;

  // 1. Directional Probabilities
  let rawLong = 0.20;
  let rawShort = 0.20;
  let rawWait = 0.25;

  if (order_book_imbalance > 0) {
    rawLong += order_book_imbalance * 0.70;
  } else {
    rawShort += Math.abs(order_book_imbalance) * 0.70;
  }

  if (delta_vof > 0) {
    rawLong += Math.min(0.40, (delta_vof / 2000) * 0.40);
  } else {
    rawShort += Math.min(0.40, (Math.abs(delta_vof) / 2000) * 0.40);
  }

  if (micro_price_trend === "upward") {
    rawLong += 0.25;
  } else if (micro_price_trend === "downward") {
    rawShort += 0.25;
  } else {
    rawWait += 0.35;
  }

  const sum = rawLong + rawShort + rawWait;
  const pLong = parseFloat((rawLong / sum).toFixed(3));
  const pShort = parseFloat((rawShort / sum).toFixed(3));
  const pWait = parseFloat(Math.max(0, 1 - pLong - pShort).toFixed(3));

  let direction: "long" | "short" | "wait" = "wait";
  if (pLong > pShort && pLong > pWait) direction = "long";
  else if (pShort > pLong && pShort > pWait) direction = "short";

  // 2. Execution Urgency (0 to 3 scale)
  // 0: No action / noise
  // 1: Scalp limit
  // 2: Momentum crossing spread
  // 3: Urgent sweep / breakout
  let urgency = 0;
  const dominance = Math.max(pLong, pShort);
  const intensity = Math.abs(order_book_imbalance) + (Math.abs(delta_vof) / 2000);

  if (dominance > 0.75 && intensity > 1.4) {
    urgency = 3;
  } else if (dominance > 0.60 && intensity > 0.8) {
    urgency = 2;
  } else if (dominance > 0.45) {
    urgency = 1;
  } else {
    urgency = 0;
  }

  // 3. Spread Risk Safe Probability (noul, 0 to 1)
  // Safe threshold parameter checking spread vs ATR
  const relativeSpreadPct = (bid_ask_spread / Math.max(1, recent_volatility_atr)) * 100;
  let spreadSafe = 0.95;
  if (relativeSpreadPct > 15) {
    spreadSafe = Math.max(0.2, 0.95 - ((relativeSpreadPct - 15) * 0.04));
  }
  if (bid_ask_spread > 5.0) {
    spreadSafe = Math.min(spreadSafe, 0.45);
  }
  const isSafe = parseFloat(spreadSafe.toFixed(3));

  // Gating criteria:
  // isSafe > 0.85 && urgency >= 2 && probs[direction] > 0.60
  const probs = { long: pLong, short: pShort, wait: pWait };
  const spreadSafePass = isSafe > 0.85;
  const urgencyPass = urgency >= 2;
  const confidencePass = probs[direction] > 0.60 && direction !== "wait";

  const executable = spreadSafePass && urgencyPass && confidencePass;

  const reasons: string[] = [];
  if (!spreadSafePass) reasons.push(`Spread safe prob ${isSafe} <= 0.85 threshold`);
  if (!urgencyPass) reasons.push(`Execution urgency score ${urgency} < 2 threshold`);
  if (!confidencePass) reasons.push(`Direction confidence ${probs[direction]} <= 0.60 or signal is 'wait'`);

  // Construct CLI command
  const action = executable ? (direction === "long" ? "buy" : "sell") : "none";
  const orderType = urgency === 3 ? "market" : "limit";
  const cliCommand = executable
    ? `kraken spot orders add --pair ${symbol} --type ${action} --ordertype ${orderType} --volume 0.01 -o json`
    : `# No order dispatched: Gating blocked (${reasons.join(", ")})`;

  return {
    symbol,
    timestamp: state.timestamp,
    signal: executable ? direction : "wait",
    probabilities: probs,
    urgency_score: urgency,
    spread_safe_probability: isSafe,
    executable_action: executable,
    gating: {
      spread_safe: spreadSafePass,
      urgency_sufficient: urgencyPass,
      confidence_sufficient: confidencePass,
      reasons,
    },
    source: "local_heuristic",
    execution_plan: {
      action,
      order_type: orderType,
      suggested_volume: 0.01,
      cli_command: cliCommand,
    },
  };
}

/**
 * Holt die Jev-Entscheidung ein und gibt ein standardisiertes Signal-JSON zurück,
 * welches direkt an die Kraken CLI / den Agenten übergeben werden kann.
 */
export async function evaluateSignalForKrakenAgent(state: MarketState): Promise<JevSignalOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY;

  if (!apiKey) {
    // Graceful offline heuristic when OpenRouter key is not provided in env
    return evaluateLocalJevHeuristic(state);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(JEV_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://your-agent-env.local",
        "X-OpenRouter-Title": "Kraken CLI Jev Agent Bridge",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "typesafe/jev-1.13",
        state: state,
        questions: {
          market_direction: {
            type: "choice",
            instructions: "Determine immediate short-term price direction based on order book imbalance and volume delta.",
            criteria: {
              long: "Strong aggressive buying pressure, positive delta, book skewed to bids",
              short: "Strong aggressive selling pressure, negative delta, book skewed to asks",
              wait: "Equilibrium, high noise, or fading momentum",
            },
          },
          execution_urgency: {
            type: "score",
            instructions: "Rate the execution urgency for entering the market on a scale from 0 to 3.",
            criteria: [
              "No action / noise range",
              "Scalp entry with standard limit order",
              "Momentum entry requiring aggressive crossing of the spread",
              "Urgent sweep / breakout execution",
            ],
          },
          spread_risk_safe: {
            type: "noul",
            instructions: "True if the spread and volatility profile allow safe execution without excessive slippage risk.",
            criteria: {
              true: "Spread and ATR are within safe threshold parameters",
              false: "Excessive spread widening or volatility spike risk",
            },
          },
        },
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[Jev Agent] OpenRouter API notice (${response.status}): ${errText}. Using local heuristic.`);
      return evaluateLocalJevHeuristic(state);
    }

    const data = (await response.json()) as any;
    const answers = data.answers;

    if (!answers || !answers.market_direction || !answers.execution_urgency || !answers.spread_risk_safe) {
      console.warn("[Jev Agent] Malformed answers structure from OpenRouter Jev API; falling back to local heuristic.");
      return evaluateLocalJevHeuristic(state);
    }

    const direction: "long" | "short" | "wait" = answers.market_direction.choice;
    const probs = answers.market_direction.probabilities || { long: 0.33, short: 0.33, wait: 0.34 };
    const urgency = answers.execution_urgency.score ?? 0;
    const isSafe = answers.spread_risk_safe.noul ?? 0.5;

    // Gating: Nur ausführen, wenn Spread sicher ist (>0.85), Dringlichkeit >= 2 und Richtungssicherheit > 0.60
    const spreadSafePass = isSafe > 0.85;
    const urgencyPass = urgency >= 2;
    const confidencePass = (probs[direction] || 0) > 0.60 && direction !== "wait";

    const executable = spreadSafePass && urgencyPass && confidencePass;

    const reasons: string[] = [];
    if (!spreadSafePass) reasons.push(`Spread safe prob ${isSafe.toFixed(2)} <= 0.85 threshold`);
    if (!urgencyPass) reasons.push(`Execution urgency score ${urgency} < 2 threshold`);
    if (!confidencePass) reasons.push(`Direction confidence ${(probs[direction] || 0).toFixed(2)} <= 0.60 or signal is 'wait'`);

    const action = executable ? (direction === "long" ? "buy" : "sell") : "none";
    const orderType = urgency === 3 ? "market" : "limit";
    const cliCommand = executable
      ? `kraken spot orders add --pair ${state.symbol} --type ${action} --ordertype ${orderType} --volume 0.01 -o json`
      : `# No order dispatched: Gating blocked (${reasons.join(", ")})`;

    return {
      symbol: state.symbol,
      timestamp: state.timestamp,
      signal: executable ? direction : "wait",
      probabilities: probs,
      urgency_score: urgency,
      spread_safe_probability: isSafe,
      executable_action: executable,
      gating: {
        spread_safe: spreadSafePass,
        urgency_sufficient: urgencyPass,
        confidence_sufficient: confidencePass,
        reasons,
      },
      source: "openrouter_jev",
      raw_answers: answers,
      execution_plan: {
        action,
        order_type: orderType,
        suggested_volume: 0.01,
        cli_command: cliCommand,
      },
    };
  } catch (err: any) {
    console.warn(`[Jev Agent] Network or evaluation error: ${err.message}. Using resilient local heuristic.`);
    return evaluateLocalJevHeuristic(state);
  }
}

/**
 * Dispatches an approved signal to the Kraken CLI or Kraken Paper Engine
 */
export async function dispatchToKrakenCliAgent(
  signal: JevSignalOutput,
  options: {
    paperMode?: boolean;
    volume?: number;
    price?: number;
  } = {}
): Promise<{
  success: boolean;
  status: "executed" | "paper_simulated" | "blocked" | "error";
  order_id?: string;
  message: string;
  cli_output?: string;
}> {
  const paperMode = options.paperMode !== false; // defaults to paper mode
  const volume = options.volume || signal.execution_plan?.suggested_volume || 0.01;

  if (!signal.executable_action || signal.signal === "wait") {
    return {
      success: false,
      status: "blocked",
      message: `Risk gating blocked: Signal is '${signal.signal}', executable_action: false. ${signal.gating.reasons.join("; ")}`,
    };
  }

  const action = signal.signal === "long" ? "buy" : "sell";
  const orderType = signal.urgency_score === 3 ? "market" : "limit";
  const cliCommand = `kraken spot orders add --pair ${signal.symbol} --type ${action} --ordertype ${orderType} --volume ${volume}${options.price ? ` --price ${options.price}` : ""} -o json`;

  console.log(`[Kraken CLI Bridge] Initiating ${paperMode ? "Paper" : "Live"} ${action.toUpperCase()} for ${signal.symbol}...`);

  // 1. Check if real 'kraken' CLI binary is present on system PATH
  let cliExecuted = false;
  let cliOutput = "";

  try {
    const { stdout } = await execAsync(`which kraken`);
    if (stdout.trim().length > 0) {
      console.log(`[Kraken CLI Bridge] Found kraken CLI binary at ${stdout.trim()}. Executing child process...`);
      const execResult = await execAsync(cliCommand);
      cliExecuted = true;
      cliOutput = execResult.stdout || execResult.stderr || "Executed CLI successfully.";
    }
  } catch {
    // CLI binary not installed globally; proceeding to API engine dispatch
  }

  // 2. Dispatch through Kraken execution engine (paper or live validation)
  try {
    const orderResult = await submitKrakenOrder(
      signal.symbol,
      action,
      volume,
      options.price,
      paperMode
    );

    const orderId = orderResult.data?.txid?.[0] || `jev-cli-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    return {
      success: orderResult.success,
      status: paperMode ? "paper_simulated" : "executed",
      order_id: orderId,
      message: orderResult.success
        ? `Order successfully processed via Kraken Engine (${paperMode ? "Paper Mode / validate=true" : "Live Execution"}). Order ID: ${orderId}`
        : `Order validation returned: ${orderResult.error || "Execution error"}`,
      cli_output: cliExecuted ? cliOutput : JSON.stringify({
        command: cliCommand,
        paperMode,
        engine: "Kraken REST / Paper Queue",
        result: orderResult,
      }, null, 2),
    };
  } catch (err: any) {
    return {
      success: false,
      status: "error",
      message: `Failed to dispatch Kraken order: ${err.message}`,
    };
  }
}

/**
 * Record evaluation and execution in history log
 */
export function recordJevHistory(
  state: MarketState,
  signal: JevSignalOutput,
  dispatchResult?: JevExecutionHistoryItem["dispatch_result"]
): JevExecutionHistoryItem {
  const item: JevExecutionHistoryItem = {
    id: `jev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: Date.now(),
    market_state: state,
    signal,
    dispatch_result: dispatchResult,
  };

  signalHistory.unshift(item);
  if (signalHistory.length > 50) {
    signalHistory.pop();
  }
  return item;
}

export function getJevHistory(): JevExecutionHistoryItem[] {
  return signalHistory;
}
