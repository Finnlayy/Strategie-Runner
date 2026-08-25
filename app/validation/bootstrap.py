"""
Stationary Block Bootstrap & Deflated Sharpe Ratio Engine (Modul 5: 05_STATISTICAL_HARDNESS_BOOTSTRAP).
Implements:
- Politis & Romano (1994) Stationary Block Bootstrap for dependent financial time series
- Probabilistic Sharpe Ratio (PSR) accounting for non-normality (skewness, kurtosis)
- Deflated Sharpe Ratio (DSR) discounting selection bias across N_eff multiple trials
- Effective Independent Trials (N_eff) estimation via correlation matrix eigenvalue Marchenko-Pastur spectrum
"""

import math
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
from scipy import stats

from app.core.directives import ExecutionPath, system_directive


class StatisticalHardnessEngine:
    """
    Computes rigorous statistical validation for algorithmic trading strategies.
    """

    def __init__(self, default_p_geom: float = 0.05, num_bootstrap_samples: int = 1000):
        # p_geom = 1 / mean_block_length (e.g. 0.05 corresponds to average block length of 20 bars)
        self.default_p_geom = default_p_geom
        self.num_bootstrap_samples = num_bootstrap_samples

    def stationary_block_bootstrap(
        self,
        returns: Union[List[float], np.ndarray],
        num_samples: Optional[int] = None,
        p_geom: Optional[float] = None
    ) -> np.ndarray:
        """
        Generates stationary bootstrap replicates of the return series.

        Args:
            returns: 1D array of returns.
            num_samples: Number of resampled sequences to generate.
            p_geom: Geometric probability for block termination.

        Returns:
            2D numpy array of shape (num_samples, len(returns)).
        """
        system_directive.record_path_execution(ExecutionPath.COLD_PATH)
        r = np.asarray(returns, dtype=np.float64)
        n = len(r)
        if n < 10:
            raise ValueError("Returns series must contain at least 10 observations.")

        B = num_samples or self.num_bootstrap_samples
        p = p_geom or self.default_p_geom

        resamples = np.empty((B, n), dtype=np.float64)

        for b in range(B):
            idx = np.random.randint(0, n)
            for t in range(n):
                resamples[b, t] = r[idx]
                if np.random.rand() < p:
                    idx = np.random.randint(0, n)
                else:
                    idx = (idx + 1) % n

        return resamples

    def compute_psr(
        self,
        returns: Union[List[float], np.ndarray],
        benchmark_sharpe: float = 0.0,
        annualization_factor: float = 365.0
    ) -> Dict[str, Any]:
        """
        Computes Probabilistic Sharpe Ratio (PSR) correcting for sample length, skewness, and kurtosis.
        PSR = Z_score( (SR - SR*) * sqrt(T-1) / sqrt(1 - skew*SR + ((kurt-1)/4)*SR^2) )
        """
        r = np.asarray(returns, dtype=np.float64)
        n = len(r)
        if n < 10:
            return {"psr": 0.0, "sharpe": 0.0, "error": "Insufficient sample size"}

        mean_r = np.mean(r)
        std_r = np.std(r, ddof=1)
        if std_r == 0:
            return {"psr": 0.0, "sharpe": 0.0}

        sr = (mean_r / std_r) * math.sqrt(annualization_factor)
        sr_non_ann = mean_r / std_r

        skew = float(stats.skew(r))
        kurt = float(stats.kurtosis(r, fisher=False))  # Pearson kurtosis (normal = 3)

        # Variance of the Sharpe ratio estimate
        denominator_term = 1.0 - skew * sr_non_ann + ((kurt - 1.0) / 4.0) * (sr_non_ann ** 2)
        if denominator_term <= 0:
            denominator_term = 1.0

        sr_se = math.sqrt(denominator_term / (n - 1.0)) * math.sqrt(annualization_factor)
        z_stat = (sr - benchmark_sharpe) / sr_se if sr_se > 0 else 0.0
        psr = float(stats.norm.cdf(z_stat))

        return {
            "annualized_sharpe": round(sr, 4),
            "psr": round(psr, 4),
            "z_stat": round(z_stat, 4),
            "skewness": round(skew, 4),
            "kurtosis": round(kurt, 4),
            "sample_size": n
        }

    def compute_dsr(
        self,
        strategy_returns: Union[List[float], np.ndarray],
        all_trials_sharpes: List[float],
        annualization_factor: float = 365.0
    ) -> Dict[str, Any]:
        """
        Computes Deflated Sharpe Ratio (DSR) (Bailey & Lopez de Prado 2014).
        Discounts the selected strategy's Sharpe Ratio against the maximum expected Sharpe ratio
        under the null hypothesis of multiple testing.
        """
        system_directive.record_path_execution(ExecutionPath.COLD_PATH)
        r = np.asarray(strategy_returns, dtype=np.float64)
        n = len(r)
        if n < 10 or not all_trials_sharpes:
            return {"dsr": 0.0, "expected_max_sharpe": 0.0, "error": "Insufficient data"}

        psr_res = self.compute_psr(r, benchmark_sharpe=0.0, annualization_factor=annualization_factor)
        sr_ann = psr_res["annualized_sharpe"]

        # Number of trials N
        num_trials = len(all_trials_sharpes)
        std_sharpes = float(np.std(all_trials_sharpes, ddof=1)) if num_trials > 1 else 0.5
        mean_sharpes = float(np.mean(all_trials_sharpes))

        # Expected maximum Sharpe under standard normal Euler-Mascheroni approximation:
        # E[max_N] = ( (1 - gamma)*Z^{-1}(1 - 1/N) + gamma*Z^{-1}(1 - 1/(N*e)) )
        # where gamma = 0.5772156649 (Euler-Mascheroni constant)
        euler_mascheroni = 0.5772156649
        if num_trials > 1:
            z1 = stats.norm.ppf(1.0 - (1.0 / num_trials))
            z2 = stats.norm.ppf(1.0 - (1.0 / (num_trials * math.e)))
            expected_max_sr = mean_sharpes + std_sharpes * ((1.0 - euler_mascheroni) * z1 + euler_mascheroni * z2)
        else:
            expected_max_sr = 0.0

        # Compute DSR using the expected max Sharpe as the benchmark
        dsr_res = self.compute_psr(r, benchmark_sharpe=expected_max_sr, annualization_factor=annualization_factor)

        return {
            "strategy_sharpe": round(sr_ann, 4),
            "expected_max_sharpe": round(expected_max_sr, 4),
            "dsr": round(dsr_res["psr"], 4),
            "z_stat": round(dsr_res["z_stat"], 4),
            "total_trials_tested": num_trials,
            "passes_defenses": dsr_res["psr"] >= 0.95
        }

    def estimate_effective_trials_neff(self, correlation_matrix: np.ndarray) -> int:
        """
        Estimates the effective number of independent trials (N_eff) from the correlation matrix
        using Marchenko-Pastur eigenvalue spectrum decomposition:
        N_eff = sum(eigenvalues)^2 / sum(eigenvalues^2)
        """
        mat = np.asarray(correlation_matrix, dtype=np.float64)
        if mat.ndim != 2 or mat.shape[0] != mat.shape[1]:
            return 1

        eigenvals = np.linalg.eigvalsh(mat)
        pos_eigenvals = eigenvals[eigenvals > 1e-6]
        if len(pos_eigenvals) == 0:
            return 1

        n_eff = float(np.sum(pos_eigenvals) ** 2 / np.sum(pos_eigenvals ** 2))
        return max(1, int(round(n_eff)))


# Global Singleton
statistical_hardness = StatisticalHardnessEngine()
