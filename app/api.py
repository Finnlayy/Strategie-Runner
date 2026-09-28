from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.execution.LeverageEngine import LeverageEngine

app = FastAPI(title="Projekt Alpha Execution Engine API", version="1.6.4")

# Instantiate engines
leverage_engine = LeverageEngine()

class SizingRequest(BaseModel):
    market_type: str
    execution_queue: str
    direction: str
    current_budget_usd: float
    budget_multiplier: float = 1.0
    entry_price: float
    stop_loss_price: float
    base_leverage: float = 1.0
    risk_fraction_per_trade: float = 0.20

@app.post("/api/execution/size", response_model=dict)
async def calculate_sizing(req: SizingRequest):
    try:
        result = leverage_engine.calculate_sizing(
            market_type=req.market_type,
            execution_queue=req.execution_queue,
            direction=req.direction,
            current_budget_usd=req.current_budget_usd,
            budget_multiplier=req.budget_multiplier,
            entry_price=req.entry_price,
            stop_loss_price=req.stop_loss_price,
            base_leverage=req.base_leverage,
            risk_fraction_per_trade=req.risk_fraction_per_trade
        )
        return {"status": "success", "data": result.__dict__}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy", "engine": "Projekt Alpha execution core"}


from app.execution.m8_judge import m8_judge
from app.execution.kelly_sizing import kelly_sizer

class EvaluateOrderRequest(BaseModel):
    strategy_id: str
    symbol: str
    side: str
    mid_price: float
    best_bid: float
    best_ask: float
    requested_qty: float
    available_cash: float
    recent_prices: list[float]
    win_rate: float
    win_loss_ratio: float
    target_vol: float

@app.post("/api/execution/evaluate_order")
async def evaluate_order_api(req: EvaluateOrderRequest):
    try:
        gate_eval = m8_judge.judge_order(
            strategy_id=req.strategy_id,
            symbol=req.symbol,
            side=req.side,
            mid_price=req.mid_price,
            best_bid=req.best_bid,
            best_ask=req.best_ask,
            requested_qty=req.requested_qty,
            available_cash=req.available_cash,
            recent_prices=req.recent_prices,
            sentiment_score=0.1,
            daily_volume_usd=50000000.0,
            current_drawdown_pct=3.2
        )
        
        kelly_res = kelly_sizer.calculate_allocation(
            win_rate=req.win_rate,
            win_loss_ratio=req.win_loss_ratio,
            portfolio_equity=req.available_cash,
            target_volatility=req.target_vol,
            current_asset_volatility=0.024
        )
        
        from datetime import datetime
        return {
            "m8_verdict": gate_eval,
            "kelly_sizing": kelly_res,
            "symbol": req.symbol,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import json

class DictRequest(BaseModel):
    data: Dict[str, Any]

@app.post("/api/core/system_status")
async def system_status():
    from app.core.directives import system_directive
    from app.core.resource_guard import resource_guard
    from app.monitoring.watchdog_sse import system_watchdog, nb_logger
    from app.data_layer.tiering import storage_tiering
    return {
        "status": "ONLINE",
        "directives": system_directive.current_mode.name,
        "resource_health": resource_guard.check_all(),
        "tiering": storage_tiering.get_stats(),
        "watchdog": system_watchdog.health_check()
    }

class StateMachineRequest(BaseModel):
    state: str
    reason: Optional[str] = "Manual Override"

@app.post("/api/core/set_state")
async def set_state(req: StateMachineRequest):
    from app.core.directives import system_directive, SystemOperationalMode, CircuitBreakerStatus
    if req.state == "NORMAL":
        system_directive.current_mode = SystemOperationalMode.AUTONOMOUS
        system_directive.circuit_breaker = CircuitBreakerStatus.ARMED
    elif req.state == "PAUSED":
        system_directive.current_mode = SystemOperationalMode.DEGRADED
    elif req.state == "KILL_SWITCH":
        system_directive.current_mode = SystemOperationalMode.EMERGENCY_STOP
        system_directive.circuit_breaker = CircuitBreakerStatus.TRIPPED
    return {"status": "success", "new_state": system_directive.current_mode.name, "circuit_breaker": system_directive.circuit_breaker.name}

class MarketImpactRequest(BaseModel):
    symbol: str = "BTC/USD"
    order_qty: float = 1.0
    current_price: float = 50000.0
    side: str = "BUY"
    daily_volume: float = 5000.0

@app.post("/api/engine/market_impact")
async def market_impact_api(req: MarketImpactRequest):
    from app.engine.market_impact import market_impact
    impact = market_impact.estimate_slippage(req.symbol, req.order_qty, req.current_price, req.side, req.daily_volume)
    return impact

class DFAHurstRequest(BaseModel):
    symbol: str = "BTC/USD"
    recent_prices: List[float] = []

@app.post("/api/regime/dfa_hurst")
async def dfa_hurst(req: DFAHurstRequest):
    from app.regime.dfa_engine import dfa_engine
    res = dfa_engine.analyze(req.symbol, req.recent_prices)
    return res

class DERequest(BaseModel):
    candles: List[Any]
    max_generations: int = 15
    population_size: int = 16

@app.post("/api/evolution/de")
async def de_api(req: DERequest):
    from app.evolution.differential_evolution import DifferentialEvolutionOptimizer
    opt = DifferentialEvolutionOptimizer(max_generations=req.max_generations, population_size=req.population_size)
    best = opt.optimize(req.candles)
    return {"best_params": best}

class BootstrapRequest(BaseModel):
    returns: List[float]
    trials: int = 200

@app.post("/api/validation/bootstrap")
async def bootstrap_api(req: BootstrapRequest):
    from app.validation.bootstrap import statistical_hardness
    res = statistical_hardness.run_monte_carlo(req.returns, trials=req.trials)
    return res

class SentimentRequest(BaseModel):
    text: str

@app.post("/api/risk/sentiment")
async def sentiment_api(req: SentimentRequest):
    from app.risk.finbert_risk import finbert_risk_scorer
    return finbert_risk_scorer.score(req.text)

class ReconciliationRequest(BaseModel):
    expected: Dict[str, float]
    actual: Dict[str, float]

@app.post("/api/execution/reconciliation")
async def reconciliation_api(req: ReconciliationRequest):
    from app.execution.reconciliation import reconciliation_daemon
    diffs = reconciliation_daemon.run_audit(req.expected, req.actual)
    return {"status": "ok", "differences": diffs}

class PostMortemRequest(BaseModel):
    trade_loss_id: Optional[str] = None
    query_text: Optional[str] = None

@app.post("/api/analysis/postmortem")
async def postmortem_api(req: PostMortemRequest):
    from app.analysis.postmortem_rag import postmortem_rag
    return postmortem_rag.analyze(req.trade_loss_id, req.query_text)

class AmpelRequest(BaseModel):
    symbol: str
    recent_prices: List[float]

@app.post("/api/regime/ampelsystem")
async def ampelsystem_api(req: AmpelRequest):
    from app.regime.asset_calibrator import asset_calibrator
    return asset_calibrator.evaluate(req.symbol, req.recent_prices)

class CrossImpactRequest(BaseModel):
    asset_prices: Dict[str, List[float]]

@app.post("/api/regime/cross_impact")
async def cross_impact_api(req: CrossImpactRequest):
    import numpy as np
    from datetime import datetime
    assets = list(req.asset_prices.keys())
    matrix = []
    for a in assets:
        prices_a = np.array(req.asset_prices[a]) if len(req.asset_prices[a]) > 0 else np.array([0])
        returns_a = np.diff(prices_a) / prices_a[:-1] if len(prices_a) > 1 else np.array([0])
        spillover = round(float(np.std(returns_a) * 10) if len(returns_a) > 1 else 0.0, 3)
        row = {"asset": a, "correlations": {}, "spillover": spillover}
        for b in assets:
            if a == b:
                row["correlations"][b] = 1.00
            else:
                prices_b = np.array(req.asset_prices[b]) if len(req.asset_prices[b]) > 0 else np.array([0])
                returns_b = np.diff(prices_b) / prices_b[:-1] if len(prices_b) > 1 else np.array([0])
                min_len = min(len(returns_a), len(returns_b))
                if min_len > 1:
                    corr = np.corrcoef(returns_a[-min_len:], returns_b[-min_len:])[0, 1]
                    if np.isnan(corr): corr = 0.0
                else:
                    corr = 0.0
                row["correlations"][b] = round(float(corr), 3)
        matrix.append(row)
    return {
        "assets": assets,
        "matrix": matrix,
        "lead_asset": "BTC/USD",
        "lead_lag_lag_ms": 145,
        "timestamp": datetime.now().isoformat()
    }

class RLFastPathRequest(BaseModel):
    state_vector: List[float] = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

@app.post("/api/engine/rl_fast_path")
async def rl_fast_path_api(req: RLFastPathRequest):
    from app.engine.rl_fast_path import rl_fast_path
    return rl_fast_path.predict_action(req.state_vector)

class ValidateSignalRequest(BaseModel):
    signal: Any
    contract_opts: Any = {}
    equity_usd: float = 0.0
    current_exposure: Dict[str, float] = {}

@app.post("/api/llm/validate_signal")
async def validate_signal_api(req: ValidateSignalRequest):
    from app.llm.grok_contracts import grok_engine_facade
    return grok_engine_facade.validate_signal(req.signal, req.contract_opts, req.equity_usd, req.current_exposure)

class BiasAuditRequest(BaseModel):
    window_start: str = ""
    window_end: str = ""
    model: str = "grok-4.6"
    sample_text: str = ""
    in_sample: Optional[Dict[str, float]] = None
    out_of_sample: Optional[Dict[str, float]] = None

@app.post("/api/llm/bias_audit")
async def bias_audit_api(req: BiasAuditRequest):
    from app.llm.grok_contracts import grok_engine_facade
    return grok_engine_facade.bias_audit(
        window_start=req.window_start,
        window_end=req.window_end,
        model=req.model,
        sample_text=req.sample_text,
        in_sample=req.in_sample,
        out_of_sample=req.out_of_sample
    )

class CostProbeRequest(BaseModel):
    model: str
    prompt_tokens: int
    completion_tokens: int
    cached_prompt_tokens: int = 0
    x_search_calls: int = 0
    code_exec_calls: int = 0

@app.post("/api/llm/cost_probe")
async def cost_probe_api(req: CostProbeRequest):
    from app.llm.grok_contracts import grok_engine_facade
    return grok_engine_facade.cost_probe(
        req.model, max(0, req.prompt_tokens), max(0, req.completion_tokens),
        max(0, req.cached_prompt_tokens), max(0, req.x_search_calls), max(0, req.code_exec_calls)
    )

@app.get("/api/quant/backend_status")
async def backend_status_api():
    from app.quant.sigma_bridge import quant_backend_status
    return quant_backend_status()

@app.post("/api/quant/evaluate_sigma")
async def evaluate_sigma_api(req: DictRequest):
    from app.quant.sigma_bridge import SigmaQuantBridge
    return SigmaQuantBridge().evaluate_payload(req.data)

@app.post("/api/academy/night_train")
async def night_train_api(req: DictRequest):
    from app.academy.night_train import run_night_train
    return run_night_train(**req.data)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
