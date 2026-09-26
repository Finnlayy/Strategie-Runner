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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
