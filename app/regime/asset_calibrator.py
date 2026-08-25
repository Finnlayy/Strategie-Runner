"""
Multi-Asset Traffic Light ("Ampelsystem") Calibrator (Modul 14: 14_ASSET_CALIBRATOR_AMPEL).
Implements:
- Lo-MacKinlay Variance Ratio Test (VR Test for random walk rejection)
- Ljung-Box Serial Autocorrelation Test (lag 1-10)
- ARCH-LM Test for Heteroscedastic Volatility Clustering
- Unified GREEN / YELLOW / RED Tradeability Signal per Asset
"""

from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
from scipy import stats

from app.core.directives import ExecutionPath, system_directive


class TradeabilitySignal(str, Enum):
    GREEN = "GREEN"    # High statistical edge, predictable persistence or clean mean-reversion
    YELLOW = "YELLOW"  # Marginal edge, elevated noise, reduced Kelly position sizing recommended
    RED = "RED"        # Random walk / pure noise (Brownian chop), ARCH instability, DO NOT TRADE


class AssetCalibratorAmpel:
    """
    Evaluates multi-asset suitability for algorithmic execution.
    """

    def compute_variance_ratio(
        self,
        prices: Union[List[float], np.ndarray],
        k: int = 4
    ) -> Dict[str, Any]:
        """
        Lo-MacKinlay Variance Ratio Test under homoscedastic & heteroscedastic assumptions.
        VR(k) = Var(r_t^k) / (k * Var(r_t))
        - VR > 1: Momentum / Persistence
        - VR < 1: Mean-Reversion
        - VR == 1: Pure Random Walk
        """
        p = np.asarray(prices, dtype=np.float64)
        if len(p) < 30:
            return {"vr": 1.0, "z_stat": 0.0, "p_value": 1.0}

        log_p = np.log(p)
        r1 = np.diff(log_p)
        n = len(r1)

        rk = log_p[k:] - log_p[:-k]
        mu = float(np.mean(r1))

        var1 = float(np.sum((r1 - mu) ** 2) / (n - 1))
        vark = float(np.sum((rk - k * mu) ** 2) / (n - k + 1))

        vr = vark / (k * var1) if var1 > 0 else 1.0

        # Asymptotic variance under heteroscedasticity
        phi = 0.0
        for j in range(1, k):
            delta_j = np.sum((r1[j:] - mu) ** 2 * (r1[:-j] - mu) ** 2) / (np.sum((r1 - mu) ** 2) ** 2)
            phi += (2.0 * (k - j) / k) ** 2 * delta_j

        z_stat = (vr - 1.0) / math.sqrt(phi) if phi > 0 else 0.0
        p_val = 2.0 * (1.0 - stats.norm.cdf(abs(z_stat)))

        return {
            "variance_ratio": round(vr, 4),
            "z_stat": round(z_stat, 4),
            "p_value": round(p_val, 6),
            "random_walk_rejected": bool(p_val < 0.05)
        }

    def compute_ljung_box(
        self,
        returns: Union[List[float], np.ndarray],
        lags: int = 10
    ) -> Dict[str, Any]:
        """
        Ljung-Box test for serial correlation in returns.
        Q = n * (n + 2) * sum( r_k^2 / (n - k) )
        """
        r = np.asarray(returns, dtype=np.float64)
        n = len(r)
        if n <= lags + 2:
            return {"q_stat": 0.0, "p_value": 1.0, "has_autocorrelation": False}

        r_mean = np.mean(r)
        c0 = np.sum((r - r_mean) ** 2)
        if c0 == 0:
            return {"q_stat": 0.0, "p_value": 1.0, "has_autocorrelation": False}

        q_stat = 0.0
        for k in range(1, lags + 1):
            ck = np.sum((r[k:] - r_mean) * (r[:-k] - r_mean))
            rk = ck / c0
            q_stat += (rk ** 2) / (n - k)

        q_stat *= n * (n + 2)
        p_val = 1.0 - stats.chi2.cdf(q_stat, df=lags)

        return {
            "q_stat": round(q_stat, 4),
            "p_value": round(float(p_val), 6),
            "has_autocorrelation": bool(p_val < 0.05)
        }

    def compute_arch_lm(
        self,
        returns: Union[List[float], np.ndarray],
        lags: int = 5
    ) -> Dict[str, Any]:
        """
        Engle's ARCH Lagrange Multiplier test for autoregressive conditional heteroscedasticity.
        """
        r = np.asarray(returns, dtype=np.float64)
        n = len(r)
        if n <= lags + 5:
            return {"lm_stat": 0.0, "p_value": 1.0, "has_arch_effect": False}

        e2 = (r - np.mean(r)) ** 2
        y = e2[lags:]
        x = np.column_stack([np.ones(n - lags)] + [e2[lags - i : n - i] for i in range(1, lags + 1)])

        try:
            beta, residuals, _, _ = np.linalg.lstsq(x, y, rcond=None)
            y_pred = x @ beta
            ss_tot = np.sum((y - np.mean(y)) ** 2)
            ss_res = np.sum((y - y_pred) ** 2)
            r2 = max(0.0, 1.0 - (ss_res / ss_tot)) if ss_tot > 0 else 0.0
            lm_stat = (n - lags) * r2
            p_val = 1.0 - stats.chi2.cdf(lm_stat, df=lags)
            return {
                "lm_stat": round(lm_stat, 4),
                "p_value": round(float(p_val), 6),
                "has_arch_effect": bool(p_val < 0.05)
            }
        except Exception:
            return {"lm_stat": 0.0, "p_value": 1.0, "has_arch_effect": False}

    def evaluate_asset_ampel(
        self,
        symbol: str,
        prices: Union[List[float], np.ndarray]
    ) -> Dict[str, Any]:
        """
        Produces unified GREEN / YELLOW / RED tradeability signal for the asset.
        """
        system_directive.record_path_execution(ExecutionPath.WARM_PATH)
        p = np.asarray(prices, dtype=np.float64)
        if len(p) < 35:
            return {
                "symbol": symbol,
                "signal": TradeabilitySignal.YELLOW.value,
                "reason": "Insufficient history for full calibration."
            }

        returns = np.diff(np.log(p))
        vr_res = self.compute_variance_ratio(p, k=4)
        lb_res = self.compute_ljung_box(returns, lags=5)
        arch_res = self.compute_arch_lm(returns, lags=5)

        # Decision matrix
        if vr_res["random_walk_rejected"] and (lb_res["has_autocorrelation"] or arch_res["has_arch_effect"]):
            signal = TradeabilitySignal.GREEN
            reason = "Statistically significant non-random structure (VR rejected & predictable autocorrelation)."
        elif vr_res["random_walk_rejected"] or arch_res["has_arch_effect"]:
            signal = TradeabilitySignal.YELLOW
            reason = "Partial non-random structure with moderate noise. Half-Kelly position sizing enforced."
        else:
            signal = TradeabilitySignal.RED
            reason = "Market indistinguishable from Geometric Brownian Motion (Random Walk). No statistical edge."

        return {
            "symbol": symbol,
            "signal": signal.value,
            "reason": reason,
            "variance_ratio_test": vr_res,
            "ljung_box_test": lb_res,
            "arch_lm_test": arch_res
        }


# Global Singleton
asset_calibrator = AssetCalibratorAmpel()
