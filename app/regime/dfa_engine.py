"""
Detrended Fluctuation Analysis (DFA) & Hurst Regime Engine (Modul 3: 03_REGIME_DFA_ENGINE).
Implements exact DFA scaling exponent estimation and market regime classification.
"""

from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np

from app.core.directives import ExecutionPath, system_directive


class MarketRegime(str, Enum):
    MEAN_REVERTING = "MEAN_REVERTING"        # H < 0.45 (Anti-persistent, range-bound)
    BROWNIAN_CHOP = "BROWNIAN_CHOP"          # 0.45 <= H <= 0.55 (Random walk, noise)
    MOMENTUM_TREND = "MOMENTUM_TREND"        # 0.55 < H <= 0.75 (Persistent trend)
    SUPER_EXPONENTIAL = "SUPER_EXPONENTIAL"  # H > 0.75 (Explosive parabolic bubble/crash)


class DFAEngine:
    """
    Computes Detrended Fluctuation Analysis (DFA) and Hurst Exponent on price series.
    """

    def __init__(self, min_scale: int = 10, max_scale: Optional[int] = None, scale_steps: int = 16, order: int = 1):
        self.min_scale = min_scale
        self.max_scale = max_scale
        self.scale_steps = scale_steps
        self.order = order

    def compute_hurst_dfa(self, series: Union[List[float], np.ndarray]) -> Dict[str, Any]:
        """
        Executes Detrended Fluctuation Analysis on a return or price series.

        Steps:
        1. Compute log-returns r_t.
        2. Mean-center and integrate profile Y(k) = sum(r_i - mean(r)).
        3. Partition Y(k) into scales s in logarithmic grid.
        4. In each window, subtract least-squares polynomial fit (order=1).
        5. Compute fluctuation F(s) = sqrt(mean(residuals^2)).
        6. Compute linear regression slope alpha of log(F(s)) vs log(s).

        Returns:
            Dictionary with hurst_exponent, regime, r_squared, scales, and fluctuations.
        """
        system_directive.record_path_execution(ExecutionPath.WARM_PATH)
        arr = np.asarray(series, dtype=np.float64)
        if len(arr) < 30:
            return {
                "hurst_exponent": 0.5,
                "regime": MarketRegime.BROWNIAN_CHOP.value,
                "r_squared": 0.0,
                "confidence": 0.0,
                "error": "Insufficient sample size (minimum 30 points required)."
            }

        # Calculate returns if prices given
        if np.all(arr > 0) and not np.any(np.diff(arr) == 0):
            # Check if prices
            if np.mean(arr) > 1.0:
                returns = np.diff(np.log(arr))
            else:
                returns = arr
        else:
            returns = arr

        n = len(returns)
        if n < 20:
            return {
                "hurst_exponent": 0.5,
                "regime": MarketRegime.BROWNIAN_CHOP.value,
                "r_squared": 0.0,
                "confidence": 0.0
            }

        # 1. Integrate the profile
        y = np.cumsum(returns - np.mean(returns))

        # 2. Scale selection (logarithmic spacing)
        max_s = self.max_scale or (n // 4)
        min_s = max(self.min_scale, self.order + 2)
        if max_s <= min_s:
            max_s = min_s + 5

        scales = np.unique(np.logspace(np.log10(min_s), np.log10(max_s), num=self.scale_steps).astype(int))
        fluctuations = []

        # 3. Fluctuation calculation per scale
        valid_scales = []
        for s in scales:
            num_segments = n // s
            if num_segments < 2:
                continue

            residuals = []
            # Forward & Backward segmentation
            for i in range(num_segments):
                seg = y[i * s : (i + 1) * s]
                x_seg = np.arange(s)
                poly = np.polyfit(x_seg, seg, self.order)
                fit = np.polyval(poly, x_seg)
                residuals.extend((seg - fit) ** 2)

            for i in range(num_segments):
                seg = y[n - (i + 1) * s : n - i * s]
                x_seg = np.arange(s)
                poly = np.polyfit(x_seg, seg, self.order)
                fit = np.polyval(poly, x_seg)
                residuals.extend((seg - fit) ** 2)

            f_s = np.sqrt(np.mean(residuals))
            if f_s > 0:
                fluctuations.append(f_s)
                valid_scales.append(s)

        if len(valid_scales) < 4:
            return {
                "hurst_exponent": 0.5,
                "regime": MarketRegime.BROWNIAN_CHOP.value,
                "r_squared": 0.0,
                "confidence": 0.0
            }

        # 4. Log-Log Linear Regression
        log_s = np.log10(valid_scales)
        log_f = np.log10(fluctuations)

        poly_fit = np.polyfit(log_s, log_f, 1)
        hurst = float(poly_fit[0])
        # Bound hurst in [0.05, 0.99]
        hurst_clamped = max(0.05, min(0.99, hurst))

        # Pearson R^2 goodness of fit
        corr_mat = np.corrcoef(log_s, log_f)
        r_squared = float(corr_mat[0, 1] ** 2) if corr_mat.shape == (2, 2) else 0.0

        # 5. Regime Classification
        if hurst_clamped < 0.45:
            regime = MarketRegime.MEAN_REVERTING
        elif hurst_clamped <= 0.55:
            regime = MarketRegime.BROWNIAN_CHOP
        elif hurst_clamped <= 0.75:
            regime = MarketRegime.MOMENTUM_TREND
        else:
            regime = MarketRegime.SUPER_EXPONENTIAL

        return {
            "hurst_exponent": round(hurst_clamped, 4),
            "raw_hurst": round(hurst, 4),
            "regime": regime.value,
            "r_squared": round(r_squared, 4),
            "confidence": round(r_squared * 100.0, 2),
            "scales_evaluated": [int(s) for s in valid_scales],
            "fluctuations": [round(float(f), 6) for f in fluctuations]
        }


# Global Singleton
dfa_engine = DFAEngine()
