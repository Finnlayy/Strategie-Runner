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
