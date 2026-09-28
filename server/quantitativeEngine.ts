/**
 * QUANTITATIVE ENGINE (STRANGLER FIG MIGRATION)
 * Alle Aufrufe an Python-Skripte wurden durch schnelle FastAPI-Aufrufe (fetch) ersetzt.
 * Die Node.js Event Loop wird nicht mehr durch Subprozesse blockiert.
 */

export async function getSystemStatus(): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/core/system_status", { method: "POST" });
  return await response.json();
}

export async function setSystemStateMachine(state: string, reason?: string): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/core/set_state", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, reason })
  });
  return await response.json();
}

export async function simulateMarketImpact(symbol: string = "BTC/USD", orderQty: number = 1.0, currentPrice: number = 50000.0, side: string = "BUY", dailyVolume: number = 5000): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/engine/market_impact", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, order_qty: orderQty, current_price: currentPrice, side, daily_volume: dailyVolume })
  });
  return await response.json();
}

export async function computeDFAHurst(symbol: string = "BTC/USD", recentPrices: number[] = []): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/regime/dfa_hurst", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, recent_prices: recentPrices })
  });
  return await response.json();
}

export async function runDifferentialEvolution(candlesData: any[], maxGenerations: number = 15, populationSize: number = 16): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/evolution/de", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candles: candlesData, max_generations: maxGenerations, population_size: populationSize })
  });
  return await response.json();
}

export async function runStatisticalBootstrap(returns: number[], trials: number = 200): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/validation/bootstrap", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returns, trials })
  });
  return await response.json();
}

export async function evaluateM8Judge(symbol: string, qty: number, side: string, currentPrice: number, availableCash: number, recentPrices: number[], winRate: number = 0.60, winLossRatio: number = 1.8, targetVol: number = 0.15): Promise<any> {
  const payload = { strategy_id: "STRAT_1", symbol, side: side.toUpperCase(), mid_price: currentPrice, best_bid: currentPrice * 0.999, best_ask: currentPrice * 1.001, requested_qty: qty, available_cash: availableCash, recent_prices: recentPrices, win_rate: winRate, win_loss_ratio: winLossRatio, target_vol: targetVol };
  const response = await fetch("http://127.0.0.1:8000/api/execution/evaluate_order", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return await response.json();
}

export async function scoreNewsSentiment(text: string): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/risk/sentiment", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  return await response.json();
}

export async function runReconciliationAudit(expected: Record<string, number>, actual: Record<string, number>): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/execution/reconciliation", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected, actual })
  });
  return await response.json();
}

export async function runPostMortemAnalysis(tradeLossId?: string, queryText?: string): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/analysis/postmortem", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trade_loss_id: tradeLossId, query_text: queryText })
  });
  return await response.json();
}

export async function getAssetAmpelsystem(symbol: string, recentPrices: number[]): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/regime/ampelsystem", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, recent_prices: recentPrices })
  });
  return await response.json();
}

export async function getCrossImpactMatrix(assetPrices: Record<string, number[]>): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/regime/cross_impact", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset_prices: assetPrices })
  });
  return await response.json();
}

export async function runRLFastPathInference(stateVector: number[] = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/engine/rl_fast_path", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state_vector: stateVector })
  });
  return await response.json();
}

export async function grokValidateSignalContract(signal: any, contractOpts: any = {}, equityUsd: number = 0, currentExposure: Record<string, number> = {}): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/llm/validate_signal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signal, contract_opts: contractOpts, equity_usd: equityUsd, current_exposure: currentExposure })
  });
  return await response.json();
}

export async function grokBiasAudit(input: { windowStart: string; windowEnd: string; model?: string; sampleText?: string; inSample?: Record<string, number>; outOfSample?: Record<string, number>; }): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/llm/bias_audit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ window_start: input.windowStart, window_end: input.windowEnd, model: input.model || 'grok-4.6', sample_text: input.sampleText, in_sample: input.inSample, out_of_sample: input.outOfSample })
  });
  return await response.json();
}

export async function grokCostProbe(model: string, promptTokens: number, completionTokens: number, cachedPromptTokens: number = 0, xSearchCalls: number = 0, codeExecCalls: number = 0): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/llm/cost_probe", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt_tokens: promptTokens, completion_tokens: completionTokens, cached_prompt_tokens: cachedPromptTokens, x_search_calls: xSearchCalls, code_exec_calls: codeExecCalls })
  });
  return await response.json();
}

export async function getQuantBackendStatus(): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/quant/backend_status", { method: "GET" });
  return await response.json();
}

export async function evaluateSigmaQuant(payload: Record<string, any>): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/quant/evaluate_sigma", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: payload })
  });
  return await response.json();
}

export async function runJulesNightTrain(payload: Record<string, any> = {}): Promise<any> {
  const response = await fetch("http://127.0.0.1:8000/api/academy/night_train", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: payload })
  });
  return await response.json();
}
