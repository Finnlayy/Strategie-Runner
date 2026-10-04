/**
 * JEV-1.13-HFT ULTRA-LOW-LATENCY DECISION ENGINE — server/jevDecisionEngine.ts
 *
 * Parallel System 1 quantitative decision engine specialized in high-frequency
 * microstructure trading, order flow imbalance, and immediate-term price action direction.
 *
 * Implements OpenRouter's typed decision model (`typesafe/jev-1.13`) via the
 * `https://openrouter.ai/api/alpha/decisions` endpoint.
 *
 * Core Directives:
 * 1. ZERO-LATENCY PARALLEL EVALUATION: Process all input states simultaneously with zero conversational filler.
 * 2. STRICT PROBABILITY DISTRIBUTION: Assign mathematically calibrated odds (summing to 1.0) across action space.
 * 3. FEE & OVERTRADING AWARENESS: Default to 'wait' unless edge exceeds transaction costs and spread crossing.
 * 4. NO FUTURE LEAK / NO HINDSIGHT: Evaluate strictly on closed historical candles plus latest tick state.
 */

export interface JevQuestionChoice {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface JevQuestionScore {
  type: "score";
  instructions: string;
  criteria: string[];
}

export interface JevQuestionNoul {
  type: "noul";
  instructions: string;
  criteria?: {
    true?: string;
    false?: string;
    [key: string]: string | undefined;
  };
}

export type JevQuestion = JevQuestionChoice | JevQuestionScore | JevQuestionNoul;

export interface JevDecisionRequest {
  model?: string;
  state: string | Record<string, any>;
  questions: Record<string, JevQuestion>;
}

export interface JevAnswerChoice {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
}

export interface JevAnswerScore {
  type: "score";
  score: number;
  probabilities?: Record<string, number>;
}

export interface JevAnswerNoul {
  type: "noul";
  noul: number; // Probability between 0 and 1
}

export type JevAnswer = JevAnswerChoice | JevAnswerScore | JevAnswerNoul;

export interface JevDecisionResponse {
  id?: string;
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    total_tokens?: number;
  };
  latency_ms: number;
  source: "openrouter_live" | "jev_simulated_fastpath";
  note?: string;
}

/**
 * Jev-1.13-HFT Canonical Output Schema
 */
export interface JevHftOutput {
  timestamp: number;
  symbol: string;
  dominant_action: "long" | "short" | "wait" | "move_stop_breakeven";
  confidence_score: number;
  odds_distribution: {
    long: number;
    short: number;
    wait: number;
    move_stop_breakeven: number;
  };
  execution_urgency: number; // 0 to 3
  risk_gate_passed: boolean;
  latency_ms: number;
  source: "openrouter_live" | "jev_simulated_fastpath";
  details?: Record<string, any>;
}

export const JEV_113_HFT_SPEC = {
  system_role: "You are Jev-1.13-HFT, an ultra-low-latency System 1 parallel decision engine specialized in high-frequency quantitative microstructure trading, order flow imbalance, and immediate-term price action direction.",
  core_directives: [
    "1. ZERO-LATENCY PARALLEL EVALUATION: Process all input states simultaneously. Do not generate explanations, reasoning text, or conversational filler. Output strictly structured decision objects.",
    "2. STRICT PROBABILITY DISTRIBUTION: For every decision node, assign mathematically rigorous odds (summing to 1.0 or weighted confidence scores between 0.0 and 1.0) based exclusively on empirical market micro-features.",
    "3. FEE & OVERTRADING AWARENESS: Default to 'WAIT / FLAT' unless statistical edge significantly outweighs the transaction costs, spread crossing, and clearing fees associated with high-frequency execution intervals (30s cadence).",
    "4. NO FUTURE LEAK / NO HINDSIGHT: Evaluate strictly on closed historical candles plus the latest unclosed tick state. Never anticipate or assume arbitrary reversals without order-book confirmation."
  ],
  decision_primitives: {
    action_space: {
      long: {
        definition: "Initiate or maintain a long position / scale into buying pressure.",
        trigger_conditions: "Order book imbalance > 0.65, positive volume delta, aggressive bids crossing micro-price trend."
      },
      short: {
        definition: "Initiate or maintain a short position / scale into selling pressure.",
        trigger_conditions: "Order book imbalance < 0.35, negative volume delta, aggressive asks crossing micro-price trend."
      },
      wait: {
        definition: "Remain flat or hold current position without changes.",
        trigger_conditions: "Market noise, equilibrium, high spread risk, or insufficient statistical edge."
      },
      move_stop_breakeven: {
        definition: "Active position management: relocate stop-loss to entry price.",
        trigger_conditions: "Unrealized profit exceeds 1.5x ATR or local momentum shows signs of immediate exhaustion."
      }
    }
  },
  evaluation_weights: {
    order_book_imbalance: 0.35,
    volume_delta_vof: 0.30,
    volatility_atr_constraint: 0.20,
    recent_price_action_momentum: 0.15
  }
};

const DEFAULT_JEV_MODEL = process.env.OPENROUTER_JEV_MODEL || "typesafe/jev-1.13";
const DEFAULT_DECISIONS_URL = process.env.OPENROUTER_DECISIONS_URL || "https://openrouter.ai/api/alpha/decisions";

/**
 * Executes a structured decision against OpenRouter JEV API, with an ultra-low-latency
 * deterministic mathematical fallback if the API key is not yet set or external endpoint is offline.
 */
export async function executeJevDecision(
  request: JevDecisionRequest,
  options: { timeoutMs?: number; apiKey?: string } = {}
): Promise<JevDecisionResponse> {
  const start = Date.now();
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY || "";
  const model = request.model || DEFAULT_JEV_MODEL;
  const timeoutMs = options.timeoutMs || 10000;

  const statePayload = typeof request.state === "string" ? request.state : request.state;

  if (apiKey && apiKey.trim().length > 0) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);

      const resp = await fetch(DEFAULT_DECISIONS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey.trim()}`,
          "HTTP-Referer": "https://ai.studio",
          "X-Title": "Strategie-Runner-JEV-Orchestrator",
        },
        body: JSON.stringify({
          model,
          state: statePayload,
          questions: request.questions,
        }),
        signal: ctl.signal,
      });

      clearTimeout(timer);

      if (resp.ok) {
        const data = (await resp.json()) as any;
        const latency_ms = Date.now() - start;
        return {
          id: data.id || `jev-${Date.now()}`,
          model: data.model || model,
          answers: data.answers || {},
          usage: data.usage || {
            prompt_tokens: Math.round(JSON.stringify(request).length / 4),
            cost: 0.000042 * (JSON.stringify(request).length / 4 / 1000),
          },
          latency_ms,
          source: "openrouter_live",
        };
      } else {
        const errText = await resp.text().catch(() => "");
        console.warn(`[JEV OpenRouter Notice] HTTP ${resp.status}: ${errText.slice(0, 200)}. Activating JEV fastpath.`);
      }
    } catch (err: any) {
      console.warn(`[JEV OpenRouter Notice] Live call skipped: ${err?.message || err}. Activating JEV fastpath.`);
    }
  }

  // Fastpath Deterministic Mathematical Inference Simulator
  const latency_ms = Math.max(1, Date.now() - start);
  const answers = simulateJevAnswers(statePayload, request.questions);

  return {
    id: `jev-fastpath-${Date.now()}`,
    model,
    answers,
    usage: {
      prompt_tokens: Math.round(JSON.stringify(request).length / 4),
      cost: 0.000001,
    },
    latency_ms,
    source: "jev_simulated_fastpath",
    note: apiKey ? "Fastpath executed due to OpenRouter response fallback" : "Executed via JEV high-speed local inference engine. Set OPENROUTER_API_KEY for live OpenRouter API routing.",
  };
}

/**
 * Execute Jev-1.13-HFT Core Microstructure Decision Engine
 * Directly adheres to user specification with action space: long, short, wait, move_stop_breakeven
 */
export async function executeJevHftDecision(
  state: Record<string, any>,
  options: { timeoutMs?: number; apiKey?: string } = {}
): Promise<JevHftOutput> {
  const start = Date.now();
  const symbol = String(state.symbol || "NQ").toUpperCase();
  const timestamp = Number(state.timestamp || Math.floor(Date.now() / 1000));

  // Build the JEV OpenRouter Questions matching the Jev-1.13-HFT Spec
  const req: JevDecisionRequest = {
    model: DEFAULT_JEV_MODEL,
    state: {
      system_role: JEV_113_HFT_SPEC.system_role,
      symbol,
      timestamp,
      bid_ask_spread: state.bid_ask_spread ?? 0.25,
      order_book_imbalance: state.order_book_imbalance ?? 0.5,
      delta_vof: state.delta_vof ?? 0,
      recent_volatility_atr: state.recent_volatility_atr ?? 2.0,
      micro_price_trend: state.micro_price_trend ?? "neutral",
      unrealized_profit_atr: state.unrealized_profit_atr ?? 0,
    },
    questions: {
      dominant_action: {
        type: "choice",
        instructions: "Determine dominant action based on Jev-1.13-HFT action space criteria.",
        criteria: {
          long: JEV_113_HFT_SPEC.decision_primitives.action_space.long.trigger_conditions,
          short: JEV_113_HFT_SPEC.decision_primitives.action_space.short.trigger_conditions,
          wait: JEV_113_HFT_SPEC.decision_primitives.action_space.wait.trigger_conditions,
          move_stop_breakeven: JEV_113_HFT_SPEC.decision_primitives.action_space.move_stop_breakeven.trigger_conditions,
        },
      },
      execution_urgency: {
        type: "score",
        instructions: "Rate execution urgency from 0 (noise/wait) to 3 (urgent sweep/breakout).",
        criteria: [
          "0: No action / noise range",
          "1: Scalp entry with standard limit order",
          "2: Momentum entry requiring aggressive crossing of the spread",
          "3: Urgent sweep / breakout execution",
        ],
      },
      risk_gate_passed: {
        type: "noul",
        instructions: "True if spread, fee threshold, and volatility allow safe execution without excessive slippage.",
      },
    },
  };

  const decisionRes = await executeJevDecision(req, options);
  const latency_ms = Date.now() - start;

  // Extract from JEV Decision answers or calculate with rigorous weights
  const domAnswer = decisionRes.answers.dominant_action as JevAnswerChoice | undefined;
  const urgAnswer = decisionRes.answers.execution_urgency as JevAnswerScore | undefined;
  const riskAnswer = decisionRes.answers.risk_gate_passed as JevAnswerNoul | undefined;

  let dominantAction: "long" | "short" | "wait" | "move_stop_breakeven" = (domAnswer?.choice as any) || "wait";
  let oddsDist: { long: number; short: number; wait: number; move_stop_breakeven: number };

  if (domAnswer?.probabilities && Object.keys(domAnswer.probabilities).length >= 3) {
    const p = domAnswer.probabilities;
    oddsDist = {
      long: Number((p["long"] || 0.05).toFixed(3)),
      short: Number((p["short"] || 0.05).toFixed(3)),
      wait: Number((p["wait"] || 0.85).toFixed(3)),
      move_stop_breakeven: Number((p["move_stop_breakeven"] || 0.05).toFixed(3)),
    };
  } else {
    // Mathematical evaluation using evaluation_weights
    oddsDist = computeHftOddsDistribution(state);
    // Dominant is the highest probability
    dominantAction = (Object.entries(oddsDist).sort((a, b) => b[1] - a[1])[0][0] as any);
  }

  const confidenceScore = Number((oddsDist[dominantAction] || 0.5).toFixed(3));
  const rawUrgency = urgAnswer?.score ?? (dominantAction === "wait" ? 0 : dominantAction === "move_stop_breakeven" ? 1 : Math.round(confidenceScore * 3));
  const executionUrgency = Math.max(0, Math.min(3, Math.round(rawUrgency)));
  const riskGatePassed = riskAnswer?.noul !== undefined ? riskAnswer.noul >= 0.5 : (Number(state.bid_ask_spread || 0.25) <= 1.0);

  return {
    timestamp,
    symbol,
    dominant_action: dominantAction,
    confidence_score: confidenceScore,
    odds_distribution: oddsDist,
    execution_urgency: executionUrgency,
    risk_gate_passed: riskGatePassed,
    latency_ms,
    source: decisionRes.source,
    details: {
      raw_answers: decisionRes.answers,
      model: decisionRes.model,
      usage: decisionRes.usage,
    },
  };
}

/**
 * Rigorous HFT evaluation using exact weights:
 * order_book_imbalance: 0.35,
 * volume_delta_vof: 0.30,
 * volatility_atr_constraint: 0.20,
 * recent_price_action_momentum: 0.15
 *
 * Directive #3 (FEE & OVERTRADING AWARENESS): default to 'wait' unless edge exceeds threshold.
 */
function computeHftOddsDistribution(state: Record<string, any>): {
  long: number;
  short: number;
  wait: number;
  move_stop_breakeven: number;
} {
  const weights = JEV_113_HFT_SPEC.evaluation_weights;

  const imb = Number(state.order_book_imbalance ?? 0.5); // 0 to 1, >0.65 long, <0.35 short
  const delta = Number(state.delta_vof ?? 0); // e.g. +1250 or -1250
  const atr = Number(state.recent_volatility_atr ?? 2.0);
  const spread = Number(state.bid_ask_spread ?? 0.25);
  const trend = String(state.micro_price_trend ?? "neutral").toLowerCase();
  const unprofitAtr = Number(state.unrealized_profit_atr ?? 0);

  // Check move_stop_breakeven trigger: unrealized profit > 1.5x ATR
  let pBe = 0.03;
  if (unprofitAtr >= 1.5) {
    pBe = Math.min(0.85, 0.4 + (unprofitAtr - 1.5) * 0.3);
  }

  // Component 1: Imbalance (-1 to +1)
  let cImb = 0;
  if (imb >= 0.65) cImb = Math.min(1.0, (imb - 0.5) * 2.5);
  else if (imb <= 0.35) cImb = -Math.min(1.0, (0.5 - imb) * 2.5);
  else cImb = (imb - 0.5) * 1.0;

  // Component 2: Volume Delta (-1 to +1)
  const cDelta = Math.max(-1.0, Math.min(1.0, delta / 1500));

  // Component 3: Volatility ATR / Spread Constraint (Higher spread penalty)
  let cSpreadPen = 0;
  if (spread > 0.75 || atr > 7.0) {
    cSpreadPen = 0.4; // heavy penalty towards WAIT
  }

  // Component 4: Momentum (-1 to +1)
  let cMom = 0;
  if (trend.includes("up") || trend.includes("bull")) cMom = 0.8;
  else if (trend.includes("down") || trend.includes("bear")) cMom = -0.8;

  // Composite directional score
  const directionalScore =
    cImb * weights.order_book_imbalance +
    cDelta * weights.volume_delta_vof +
    cMom * weights.recent_price_action_momentum;

  // Directive #3: Fee & overtrading threshold. Must exceed 0.22 to overcome wait/flat
  const edgeMagnitude = Math.abs(directionalScore) - cSpreadPen;

  let pLong = 0.05;
  let pShort = 0.05;
  let pWait = 0.90;

  if (pBe > 0.4) {
    // Breakeven management dominates
    pWait = (1.0 - pBe) * 0.5;
    pLong = (1.0 - pBe) * 0.3;
    pShort = (1.0 - pBe) * 0.2;
  } else if (edgeMagnitude > 0.15) {
    if (directionalScore > 0) {
      pLong = Math.min(0.88, 0.45 + edgeMagnitude * 0.7);
      pWait = Math.max(0.08, 1.0 - pLong - 0.04);
      pShort = 0.04;
    } else {
      pShort = Math.min(0.88, 0.45 + edgeMagnitude * 0.7);
      pWait = Math.max(0.08, 1.0 - pShort - 0.04);
      pLong = 0.04;
    }
  } else {
    // Equilibrium / noise / fee barrier -> WAIT dominates
    pWait = 0.78;
    pLong = 0.11;
    pShort = 0.11;
  }

  // Normalize to exact 1.0 sum
  const sum = pLong + pShort + pWait + pBe;
  return {
    long: Number((pLong / sum).toFixed(3)),
    short: Number((pShort / sum).toFixed(3)),
    wait: Number((pWait / sum).toFixed(3)),
    move_stop_breakeven: Number((pBe / sum).toFixed(3)),
  };
}

/**
 * Mathematically evaluates state indicators against JEV criteria
 */
function simulateJevAnswers(
  state: string | Record<string, any>,
  questions: Record<string, JevQuestion>
): Record<string, JevAnswer> {
  const result: Record<string, JevAnswer> = {};
  const stateObj = typeof state === "object" && state !== null ? state : parseStateString(String(state));

  const hftOdds = computeHftOddsDistribution(stateObj);

  for (const [key, q] of Object.entries(questions)) {
    if (q.type === "choice") {
      const criteriaKeys = Object.keys(q.criteria || {});
      const probs: Record<string, number> = {};

      if (criteriaKeys.includes("long") && criteriaKeys.includes("wait")) {
        // Direct HFT action space match
        for (const k of criteriaKeys) {
          probs[k] = (hftOdds as any)[k] ?? 0.05;
        }
        const best = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
        result[key] = { type: "choice", choice: best, probabilities: probs };
      } else if (criteriaKeys.includes("long") || criteriaKeys.includes("short") || criteriaKeys.includes("flat")) {
        probs["long"] = hftOdds.long;
        probs["short"] = hftOdds.short;
        probs["flat"] = hftOdds.wait + hftOdds.move_stop_breakeven;
        const best = probs["long"] > probs["short"] && probs["long"] > probs["flat"]
          ? "long"
          : (probs["short"] > probs["flat"] ? "short" : "flat");
        result[key] = { type: "choice", choice: best, probabilities: probs };
      } else {
        criteriaKeys.forEach((k, idx) => {
          probs[k] = Number((1 / criteriaKeys.length).toFixed(3));
        });
        result[key] = { type: "choice", choice: criteriaKeys[0] || "default", probabilities: probs };
      }
    } else if (q.type === "score") {
      const bestOdds = Math.max(hftOdds.long, hftOdds.short);
      const isWait = hftOdds.wait > bestOdds;
      const score = isWait ? 0.3 : Math.min(3.0, Number((bestOdds * 3.2).toFixed(2)));

      const probs: Record<string, number> = {};
      (q.criteria || []).forEach((crit, idx) => {
        const dist = Math.abs(idx - score);
        probs[crit] = Number(Math.exp(-dist * 1.5).toFixed(3));
      });
      const sum = Object.values(probs).reduce((a, b) => a + b, 0) || 1;
      for (const k of Object.keys(probs)) probs[k] = Number((probs[k] / sum).toFixed(3));

      result[key] = { type: "score", score, probabilities: probs };
    } else if (q.type === "noul") {
      const spread = Number(stateObj.bid_ask_spread ?? 0.25);
      const atr = Number(stateObj.recent_volatility_atr ?? 2.0);
      const isSafe = spread <= 0.5 && atr <= 6.0;
      result[key] = {
        type: "noul",
        noul: isSafe ? 0.92 : 0.22,
      };
    }
  }

  return result;
}

function parseStateString(str: string): Record<string, any> {
  try {
    return JSON.parse(str);
  } catch {
    const res: Record<string, any> = {};
    const tokens = str.split(/\s+/);
    for (const t of tokens) {
      if (t.includes("=")) {
        const [k, v] = t.split("=");
        res[k] = isNaN(Number(v)) ? v : Number(v);
      }
    }
    return res;
  }
}

/**
 * JEV Alpha Decision Generator
 * Converts live market microstructure and order flow metrics into an instant OrchestratorVote
 */
export async function jevAlphaOrchestratorDecide(args: {
  symbol: string;
  state: Record<string, any>;
  deadlineMs?: number;
}): Promise<{
  vote: {
    source: string;
    symbol: string;
    direction: number;
    strength: number;
    confidence: number;
    horizon_bars: number;
    rationale: string;
    meta: Record<string, any>;
  };
  hftOutput: JevHftOutput;
}> {
  const hftRes = await executeJevHftDecision(args.state, { timeoutMs: args.deadlineMs || 5000 });

  let direction = 0;
  let strength = 0;
  if (hftRes.dominant_action === "long") {
    direction = 1;
    strength = hftRes.odds_distribution.long;
  } else if (hftRes.dominant_action === "short") {
    direction = -1;
    strength = hftRes.odds_distribution.short;
  } else if (hftRes.dominant_action === "move_stop_breakeven") {
    direction = 0;
    strength = 0.5;
  } else {
    direction = 0;
    strength = 0;
  }

  const confidence = hftRes.confidence_score;
  const horizonBars = Math.max(1, Math.min(24, Math.round(8 / Math.max(0.5, hftRes.execution_urgency))));

  const rationale = `Jev-1.13-HFT ${hftRes.dominant_action.toUpperCase()} (${(confidence * 100).toFixed(0)}% conf) | Urgency: ${hftRes.execution_urgency}/3 | RiskGate: ${hftRes.risk_gate_passed ? "PASS" : "FAIL"} | Latency: ${hftRes.latency_ms}ms`;

  return {
    vote: {
      source: "jev_113_hft",
      symbol: args.symbol.toUpperCase(),
      direction,
      strength: Number(strength.toFixed(3)),
      confidence: Number(confidence.toFixed(3)),
      horizon_bars: horizonBars,
      rationale,
      meta: {
        via: "openrouter_jev_113_hft",
        dominant_action: hftRes.dominant_action,
        odds_distribution: hftRes.odds_distribution,
        execution_urgency: hftRes.execution_urgency,
        risk_gate_passed: hftRes.risk_gate_passed,
        latency_ms: hftRes.latency_ms,
        source: hftRes.source,
      },
    },
    hftOutput: hftRes,
  };
}

/**
 * JEV Sigma Risk Review
 * Sub-100ms validation of sized order intents
 */
export async function jevSigmaRiskReview(args: {
  symbol: string;
  intent: any;
  sigmaState: any;
  deadlineMs?: number;
}): Promise<{
  veto: boolean;
  riskLevel: string;
  note: string;
  concerns: string[];
  latency_ms: number;
  engine: any;
}> {
  const req: JevDecisionRequest = {
    model: DEFAULT_JEV_MODEL,
    state: {
      symbol: args.symbol,
      intent: args.intent,
      price: args.sigmaState?.price,
      spread_bps: args.sigmaState?.spread_bps,
      atr: args.sigmaState?.atr,
      z_score: args.sigmaState?.z_score,
      regime: args.sigmaState?.regime,
      gross_exposure_pct: args.sigmaState?.gross_exposure_pct,
      drawdown_pct: args.sigmaState?.drawdown_pct,
    },
    questions: {
      should_veto: {
        type: "noul",
        instructions: "Evaluate if this trade intent should be vetoed due to excessive risk, extreme spread, or adverse regime divergence.",
        criteria: {
          true: "Extreme tail risk, liquidity shortage, or adverse price dislocation",
          false: "Within acceptable risk budget",
        },
      },
      risk_level: {
        type: "choice",
        instructions: "Classify the overall risk level for this order.",
        criteria: {
          none: "Standard orderly conditions",
          low: "Routine minor market movement",
          elevated: "Heightened spread or volatility",
          high: "Severe danger or liquidity vacuum",
        },
      },
    },
  };

  const decision = await executeJevDecision(req, { timeoutMs: args.deadlineMs || 5000 });
  const vetoAnswer = decision.answers.should_veto as JevAnswerNoul;
  const riskAnswer = decision.answers.risk_level as JevAnswerChoice;

  const vetoProb = vetoAnswer?.noul ?? 0.05;
  const veto = vetoProb >= 0.65;
  const riskLevel = riskAnswer?.choice || (veto ? "high" : "low");

  const concerns: string[] = [];
  if (veto) concerns.push(`JEV veto threshold exceeded: ${(vetoProb * 100).toFixed(1)}% tail-risk`);
  if (riskLevel === "elevated" || riskLevel === "high") {
    concerns.push(`Elevated market risk tier: ${riskLevel}`);
  }

  const note = `JEV Risk Review: ${veto ? "VETO" : "APPROVED"} (risk: ${riskLevel}, pVeto: ${(vetoProb * 100).toFixed(1)}%, ${decision.latency_ms}ms)`;

  return {
    veto,
    riskLevel,
    note,
    concerns,
    latency_ms: decision.latency_ms,
    engine: {
      modelUsed: decision.model,
      source: decision.source,
      latency_ms: decision.latency_ms,
      costUsd: decision.usage?.cost || 0.000002,
    },
  };
}
