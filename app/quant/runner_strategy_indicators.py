"""Independent Strategy-Runner indicator side for GBH-06 parity.

This module is the *runner* SoT used when posting values to
``POST /api/orchestrator/parity``.  It deliberately does NOT import
``sigma_indicators`` from the orchestrator — a self-import would be a
mirror check (``mark_hook=False``), not evidence.

Formulas match the documented Sigma runner script family
(meanReversionLookback / atrLookback / hurstRs / priceZoneScore).
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional


def _finite(v: Any) -> bool:
    try:
        return v is not None and math.isfinite(float(v))
    except (TypeError, ValueError):
        return False


def sma(a: List[float], n: int) -> float:
    n = min(int(n), len(a))
    if n <= 0:
        return float("nan")
    return sum(a[-n:]) / n


def stdev(a: List[float], n: int) -> float:
    n = min(int(n), len(a))
    if n <= 1:
        return float("nan")
    w = a[-n:]
    m = sum(w) / n
    return math.sqrt(sum((x - m) ** 2 for x in w) / n)


def ema(a: List[float], n: int) -> float:
    n = max(2, int(n))
    if len(a) < n:
        return float("nan")
    e = sum(a[:n]) / n
    k = 2.0 / (n + 1.0)
    for x in a[n:]:
        e = x * k + e * (1.0 - k)
    return e


def atr(a: List[float], n: int) -> float:
    """True-range proxy on closes (runner script equivalent)."""
    n = min(int(n), max(0, len(a) - 1))
    if n <= 0:
        return float("nan")
    d = [abs(a[i] - a[i - 1]) for i in range(len(a) - n, len(a))]
    return sum(d) / len(d)


def hurst_rs(a: List[float], n: int) -> float:
    r = [math.log(a[i] / a[i - 1]) for i in range(1, len(a)) if a[i] > 0 and a[i - 1] > 0]
    n = min(int(n), len(r))
    if n < 20:
        return float("nan")
    w = r[-n:]
    mean = sum(w) / n
    cum = hi = lo = 0.0
    ss = 0.0
    for x in w:
        cum += x - mean
        hi, lo = max(hi, cum), min(lo, cum)
        ss += (x - mean) ** 2
    sd = math.sqrt(ss / n)
    rs = (hi - lo) / sd if sd > 0 else 0.0
    if rs <= 0:
        return 0.5
    return max(0.0, min(1.0, math.log(rs) / math.log(n)))


def zone_score(a: List[float], lookback: int, side: str, atr_value: float) -> float:
    n = min(int(lookback), len(a) - 2)
    if n < 10:
        return 0.0
    w = a[-n:]
    last = w[-1]
    tol = max((atr_value if _finite(atr_value) else 0.0) * 1.5, last * 0.001)
    score = touches = 0.0
    for i in range(2, len(w) - 2):
        local = (w[i] <= w[i - 1] and w[i] <= w[i + 1]) if side == "support" else (
            w[i] >= w[i - 1] and w[i] >= w[i + 1]
        )
        if not local:
            continue
        dist = abs(last - w[i])
        if dist <= tol:
            touches += 1
            score += max(0.0, 1.0 - dist / tol)
    return min(10.0, touches * 1.4 + score * 1.2)


def compute(prices: List[float], params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Return runner-side indicator map suitable for check_parity(runner=...)."""
    p = params or {}
    series = [float(x) for x in (prices or []) if _finite(x)]
    if not series:
        return {"ok": False, "reason": "keine preise", "source": "runner_strategy_indicators"}
    atr_look = int(p.get("atrLookback", 14))
    mr_look = int(p.get("meanReversionLookback", 20))
    fast_p = int(p.get("fastEma", 20))
    slow_p = int(p.get("slowEma", 50))
    brk = int(p.get("breakoutLookback", 20))
    hurst_look = int(p.get("hurstLookback", 100))
    mos_look = int(p.get("mosLookback", 60))

    price = series[-1]
    atr_v = atr(series, atr_look)
    basis = sma(series, mr_look)
    sd = stdev(series, mr_look)
    z = (price - basis) / sd if _finite(sd) and sd > 0 else 0.0
    fast = ema(series, fast_p)
    slow = ema(series, slow_p)
    window = series[-brk - 1:-1]
    upper = max(window) if window else float("nan")
    lower = min(window) if window else float("nan")
    h = hurst_rs(series, hurst_look)
    if not _finite(h):
        h = 0.5
    support = zone_score(series, mos_look, "support", atr_v)
    resistance = zone_score(series, mos_look, "resistance", atr_v)
    return {
        "ok": True,
        "source": "runner_strategy_indicators",
        "price": price,
        "basis": basis,
        "sigma": sd,
        "z_score": z,
        "atr": atr_v,
        "ema_fast": fast,
        "ema_slow": slow,
        "breakout_upper": upper,
        "breakout_lower": lower,
        "hurst": h,
        "support_score": support,
        "resistance_score": resistance,
    }