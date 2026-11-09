"""
=========================================================
Datei:      app/execution/AutopsyProcessor.py
Zweck:      Klassifikation von Autopsie-Zonen & R-Multiples
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
from typing import Dict, Any

def classify_autopsy_zone(pnl_r: float, mfe_r: float, exit_reason: str, capture_ratio: float) -> str:
    if pnl_r > 0:
        return "GOOD" if capture_ratio >= 0.55 else "WATCH"
    else:
        if mfe_r >= 0.5:
            return "BAD"
        elif exit_reason == "STOP_LOSS":
            return "CLEAN_LOSS"
        else:
            return "NEUTRAL_LOSS"

def calculate_r_multiples(pnl_pct: float, mfe_pct: float, mae_pct: float, stop_distance_pct: float) -> Dict[str, float]:
    if stop_distance_pct <= 0.0:
        raise ValueError("stop_distance_pct muss > 0 sein")
    pnl_r = pnl_pct / stop_distance_pct
    mfe_r = mfe_pct / stop_distance_pct
    mae_r = mae_pct / stop_distance_pct
    capture_ratio = pnl_r / mfe_r if mfe_r > 0 else 0.0
    return {
        "pnl_r": pnl_r,
        "mfe_r": mfe_r,
        "mae_r": mae_r,
        "capture_ratio": capture_ratio
    }

def calculate_stop_slippage(trigger_price: float, fill_price: float, direction: str = 'LONG', exit_reason: str = '', threshold_bps: float = 0.0) -> bool:
    if direction.upper() == "LONG":
        slip = trigger_price - fill_price
    else:
        slip = fill_price - trigger_price
    if slip > 0 and (slip / trigger_price) * 10000 > threshold_bps:
        return True
    return False
