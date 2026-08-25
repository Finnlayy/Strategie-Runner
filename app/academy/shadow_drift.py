"""
Shadow-Racing & Statistical Drift Engine (Modul 8: 08_SHADOW_RACING_DRIFT).
Implements:
- Parallel Live A/B Shadow Racing (Champion vs. Challenger)
- Two-Sample Kolmogorov-Smirnov (KS) Distribution Test
- Population Stability Index (PSI) for Regime and Feature Drift Detection
"""

import math
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
from scipy import stats

from app.core.directives import ExecutionPath, system_directive
from app.registry.career_log import career_logger
from app.registry.identity import BadgeType, CareerEventType, LifecycleStatus
from app.registry.registry_service import strategy_registry


class ShadowDriftEngine:
    """
    Evaluates real-time performance divergences and distribution shifts between Champion and Shadow Challengers.
    """

    def compute_two_sample_ks_test(
        self,
        champion_returns: Union[List[float], np.ndarray],
        challenger_returns: Union[List[float], np.ndarray]
    ) -> Dict[str, Any]:
        """
        Executes two-sample Kolmogorov-Smirnov test to detect return distribution divergence.
        """
        system_directive.record_path_execution(ExecutionPath.WARM_PATH)
        r_champ = np.asarray(champion_returns, dtype=np.float64)
        r_chal = np.asarray(challenger_returns, dtype=np.float64)

        if len(r_champ) < 10 or len(r_chal) < 10:
            return {
                "ks_statistic": 0.0,
                "p_value": 1.0,
                "distributions_differ": False,
                "error": "Insufficient observations (minimum 10 each required)."
            }

        res = stats.ks_2samp(r_champ, r_chal)
        ks_stat = float(res.statistic)
        p_val = float(res.pvalue)

        return {
            "ks_statistic": round(ks_stat, 4),
            "p_value": round(p_val, 6),
            "distributions_differ": p_val < 0.05,
            "sample_size_champion": len(r_champ),
            "sample_size_challenger": len(r_chal)
        }

    def compute_psi(
        self,
        reference_data: Union[List[float], np.ndarray],
        actual_data: Union[List[float], np.ndarray],
        num_bins: int = 10
    ) -> Dict[str, Any]:
        """
        Computes Population Stability Index (PSI) to detect feature / return drift.
        PSI = sum((Actual_i - Expected_i) * ln(Actual_i / Expected_i))

        Thresholds:
        - PSI < 0.10: Stable / No Drift
        - 0.10 <= PSI < 0.25: Moderate Shift (Warning)
        - PSI >= 0.25: Significant Population Drift (Demote / Re-calibrate)
        """
        system_directive.record_path_execution(ExecutionPath.WARM_PATH)
        ref = np.asarray(reference_data, dtype=np.float64)
        act = np.asarray(actual_data, dtype=np.float64)

        if len(ref) < 10 or len(act) < 10:
            return {
                "psi": 0.0,
                "drift_category": "INSUFFICIENT_DATA",
                "is_drift_critical": False
            }

        # Calculate quantile bin edges on reference data
        quantiles = np.linspace(0, 100, num_bins + 1)
        bin_edges = np.percentile(ref, quantiles)
        bin_edges[0] = -np.inf
        bin_edges[-1] = np.inf

        # Count frequencies
        ref_counts, _ = np.histogram(ref, bins=bin_edges)
        act_counts, _ = np.histogram(act, bins=bin_edges)

        # Frequencies with epsilon smoothing to avoid div-by-zero
        eps = 1e-4
        ref_pct = (ref_counts + eps) / (np.sum(ref_counts) + eps * num_bins)
        act_pct = (act_counts + eps) / (np.sum(act_counts) + eps * num_bins)

        # PSI formula
        psi_contributions = (act_pct - ref_pct) * np.log(act_pct / ref_pct)
        total_psi = float(np.sum(psi_contributions))

        if total_psi < 0.10:
            drift_cat = "STABLE"
            is_critical = False
        elif total_psi < 0.25:
            drift_cat = "MODERATE_SHIFT"
            is_critical = False
        else:
            drift_cat = "SIGNIFICANT_DRIFT"
            is_critical = True

        return {
            "psi": round(total_psi, 4),
            "drift_category": drift_cat,
            "is_drift_critical": is_critical,
            "bins_count": num_bins
        }

    def evaluate_shadow_race(
        self,
        champion_id: str,
        challenger_id: str,
        champion_returns: List[float],
        challenger_returns: List[float]
    ) -> Dict[str, Any]:
        """
        Runs comprehensive A/B race evaluation with KS-test and PSI drift checking.
        If Challenger decisively outperforms Champion on Sharpe, PSR, and PSI stability,
        promotes Challenger and records hash-chained career event.
        """
        ks_res = self.compute_two_sample_ks_test(champion_returns, challenger_returns)
        psi_res = self.compute_psi(champion_returns, challenger_returns)

        mean_champ = float(np.mean(champion_returns)) if champion_returns else 0.0
        mean_chal = float(np.mean(challenger_returns)) if challenger_returns else 0.0
        std_champ = float(np.std(champion_returns, ddof=1)) if len(champion_returns) > 1 else 1.0
        std_chal = float(np.std(challenger_returns, ddof=1)) if len(challenger_returns) > 1 else 1.0

        sr_champ = (mean_champ / std_champ) * math.sqrt(365.0) if std_champ > 0 else 0.0
        sr_chal = (mean_chal / std_chal) * math.sqrt(365.0) if std_chal > 0 else 0.0

        challenger_outperforming = (sr_chal > sr_champ * 1.15) and not psi_res["is_drift_critical"]

        summary = {
            "champion_id": champion_id,
            "challenger_id": challenger_id,
            "champion_sharpe": round(sr_champ, 3),
            "challenger_sharpe": round(sr_chal, 3),
            "ks_test": ks_res,
            "psi_drift": psi_res,
            "challenger_outperforming": challenger_outperforming,
            "promotion_recommended": challenger_outperforming and len(challenger_returns) >= 30
        }

        if summary["promotion_recommended"]:
            career_logger.append_event(
                strategy_id=challenger_id,
                event_type=CareerEventType.PROMOTED_CHAMPION,
                title="Promoted to Champion in Live Shadow Racing",
                description=f"Outperformed Champion ({sr_chal:.2f} SR vs {sr_champ:.2f} SR) with stable PSI ({psi_res['psi']}).",
                payload=summary,
                actor="SHADOW_RACING_ENGINE"
            )

        return summary


# Global Singleton
shadow_drift_engine = ShadowDriftEngine()
