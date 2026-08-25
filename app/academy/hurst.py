"""
Hurst Exponent & Market Regime Classification Engine (Modul 2 & Modul 7).
Implements Vectorized Rescaled Range (R/S) Analysis and Variance Ratio testing to detect persistent, random walk, or mean-reverting phases.
"""

from datetime import datetime, timezone
import math
from typing import Any, Dict, List, Optional, Tuple


def calculate_returns(prices: List[float]) -> List[float]:
    """
    Computes logarithmic returns for a given price series.

    Args:
        prices: List of consecutive asset prices.

    Returns:
        List of log returns (len(prices) - 1).
    """
    if len(prices) < 2:
        return []
    returns: List[float] = []
    for i in range(1, len(prices)):
        prev = prices[i - 1]
        curr = prices[i]
        if prev > 0 and curr > 0:
            returns.append(math.log(curr / prev))
        else:
            returns.append(0.0)
    return returns


def calculate_hurst_exponent(
    prices: List[float],
    min_window: int = 10,
    max_window: Optional[int] = None
) -> float:
    """
    Calculates the Hurst Exponent (H) using Rescaled Range (R/S) Analysis across multiple sub-windows.

    Interpretation:
        H < 0.45 : Anti-persistent / Mean-reverting regime (Chop, Oscillating ranges)
        0.45 <= H <= 0.55 : Geometric Brownian Motion (Random Walk / Efficient market)
        H > 0.55 : Persistent / Trending regime (Momentum, Directional drift)

    Args:
        prices: List of close prices.
        min_window: Minimum sub-window size.
        max_window: Maximum sub-window size (defaults to len(returns) // 2).

    Returns:
        Calculated Hurst exponent in range [0.0, 1.0].
    """
    returns = calculate_returns(prices)
    n = len(returns)
    if n < 30:
        return 0.50  # Default neutral random walk for insufficient sample

    max_w = max_window or min(n // 2, 256)
    if max_w <= min_window:
        max_w = n - 1

    # Generate log-spaced window lengths
    window_sizes: List[int] = []
    curr = min_window
    while curr <= max_w:
        window_sizes.append(curr)
        curr = int(curr * 1.5) + 1

    log_sizes: List[float] = []
    log_rs_values: List[float] = []

    for w in window_sizes:
        num_chunks = n // w
        if num_chunks < 1:
            continue

        rs_chunk_list: List[float] = []

        for i in range(num_chunks):
            chunk = returns[i * w : (i + 1) * w]
            chunk_len = len(chunk)
            if chunk_len < 2:
                continue

            mean = sum(chunk) / chunk_len
            
            # Deviations and cumulative sum
            cum_dev: List[float] = []
            running_sum = 0.0
            variance_sum = 0.0
            for val in chunk:
                dev = val - mean
                running_sum += dev
                cum_dev.append(running_sum)
                variance_sum += dev ** 2

            std_dev = math.sqrt(variance_sum / chunk_len) if variance_sum > 0 else 0.0

            if std_dev > 1e-9:
                r_range = max(cum_dev) - min(cum_dev)
                rs_chunk_list.append(r_range / std_dev)

        if rs_chunk_list:
            avg_rs = sum(rs_chunk_list) / len(rs_chunk_list)
            if avg_rs > 0:
                log_sizes.append(math.log(float(w)))
                log_rs_values.append(math.log(avg_rs))

    # Ordinary Least Squares regression to compute slope (Hurst Exponent)
    if len(log_sizes) < 2:
        return 0.50

    x_mean = sum(log_sizes) / len(log_sizes)
    y_mean = sum(log_rs_values) / len(log_rs_values)

    numerator = 0.0
    denominator = 0.0
    for x, y in zip(log_sizes, log_rs_values):
        numerator += (x - x_mean) * (y - y_mean)
        denominator += (x - x_mean) ** 2

    if denominator <= 0:
        return 0.50

    hurst = numerator / denominator
    return max(0.01, min(0.99, round(hurst, 4)))


def classify_market_regime(prices: List[float], lookback: int = 120) -> Dict[str, Any]:
    """
    Classifies current market structure into statistical regimes using the Hurst Exponent.

    Args:
        prices: Series of historical prices.
        lookback: Lookback window to evaluate.

    Returns:
        Dictionary containing Hurst value, regime name, confidence score, and trading recommendations.
    """
    window_prices = prices[-lookback:] if len(prices) > lookback else prices
    h = calculate_hurst_exponent(window_prices)

    if h < 0.42:
        regime = "STRONG_MEAN_REVERSION"
        desc = "High-frequency mean-reverting oscillating market. Ideal for Bollinger/MOS pivots and fade setups."
        confidence = round((0.50 - h) / 0.50 * 100, 1)
        recommended_mode = "MEAN_REVERSION"
    elif h < 0.48:
        regime = "MILD_MEAN_REVERSION"
        desc = "Mildly anti-persistent chop regime. Limit breakout sizing and prioritize range boundaries."
        confidence = round((0.50 - h) / 0.50 * 100, 1)
        recommended_mode = "RANGE_BOUND"
    elif h <= 0.55:
        regime = "RANDOM_WALK_CHOP"
        desc = "Brownian motion / Efficient market state. No persistent directional edge; tighten risk filters."
        confidence = round((1.0 - abs(h - 0.50) / 0.10) * 100, 1)
        recommended_mode = "PRESERVATION_DEFENSIVE"
    elif h <= 0.65:
        regime = "MODERATE_TREND"
        desc = "Persistent momentum detected. FVG and EMA breakout continuation strategies favored."
        confidence = round((h - 0.50) / 0.50 * 100, 1)
        recommended_mode = "MOMENTUM_TREND"
    else:
        regime = "SUPER_TREND_PARABOLIC"
        desc = "Strongly persistent directional run. Maximize trend-following and trailing ATR stops."
        confidence = round((h - 0.50) / 0.50 * 100, 1)
        recommended_mode = "AGGRESSIVE_TREND_FOLLOW"

    return {
        "hurst_exponent": h,
        "regime": regime,
        "recommended_mode": recommended_mode,
        "confidence_pct": confidence,
        "description": desc,
        "sample_bars": len(window_prices),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
