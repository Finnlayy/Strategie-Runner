"""
News & Sentiment Risk Scorer with FinBERT / Heuristic ONNX Engine (Modul 10: 10_NEWS_RISK_FINBERT).
Implements:
- Quantitative financial sentiment scoring (Positive, Neutral, Negative)
- Dynamic Sentiment Volatility Shock Monitor
- Emergency Sentiment Circuit Breaker (Trips if negative sentiment > 3 sigma shock)
"""

from datetime import datetime, timezone
import math
import re
from typing import Any, Dict, List, Optional, Tuple

from app.core.directives import CircuitBreakerStatus, ExecutionPath, system_directive

# Financial Sentiment Lexicon weights for high-speed sub-millisecond scoring
BULLISH_KEYWORDS = {
    "surge": 1.5, "breakout": 1.2, "rally": 1.4, "bullish": 1.6, "all-time high": 1.8,
    "partnership": 1.0, "approved": 1.5, "etf inflow": 1.7, "adoption": 1.1,
    "upgrade": 1.2, "growth": 0.9, "profit": 1.0, "expansion": 0.8, "accumulating": 1.3
}

BEARISH_KEYWORDS = {
    "crash": 2.0, "hack": 2.2, "exploit": 2.2, "sec lawsuit": 2.0, "subpoena": 1.8,
    "liquidation": 1.7, "insolvency": 2.5, "ban": 1.9, "fraud": 2.4, "outage": 1.5,
    "dump": 1.6, "bearish": 1.4, "investigation": 1.7, "collapse": 2.5, "bankruptcy": 2.6
}


class FinBERTRiskScorer:
    """
    Quantized Financial Sentiment and Macro-News Risk Engine.
    """

    def __init__(self, shock_threshold_sigma: float = 3.0):
        self.shock_threshold_sigma = shock_threshold_sigma
        self._history_scores: List[float] = [0.0] * 30

    def score_text(self, text: str) -> Dict[str, Any]:
        """
        Extracts polarity sentiment score in [-1.0, +1.0] and checks for emergency circuit breaker triggers.
        """
        system_directive.record_path_execution(ExecutionPath.HOT_PATH)
        clean = text.lower()

        bull_score = sum(weight for kw, weight in BULLISH_KEYWORDS.items() if kw in clean)
        bear_score = sum(weight for kw, weight in BEARISH_KEYWORDS.items() if kw in clean)

        total_score = bull_score - bear_score
        normalized_score = math.tanh(total_score / 3.0)  # Squeeze to [-1.0, 1.0]

        # Update historical score rolling buffer
        self._history_scores.append(normalized_score)
        if len(self._history_scores) > 100:
            self._history_scores.pop(0)

        # Check for 3-sigma negative shock
        mean_score = sum(self._history_scores) / len(self._history_scores)
        variance = sum((s - mean_score) ** 2 for s in self._history_scores) / len(self._history_scores)
        std_score = math.sqrt(variance) if variance > 0 else 0.2

        z_score = (normalized_score - mean_score) / std_score if std_score > 0 else 0.0

        is_circuit_breaker_trip = False
        if z_score < -self.shock_threshold_sigma and normalized_score < -0.65:
            is_circuit_breaker_trip = True
            system_directive.trip_circuit_breaker(
                status=CircuitBreakerStatus.TRIPPED_SENTIMENT_SHOCK,
                reason=f"Severe Negative News Shock: z_score={z_score:.2f}, text='{text[:80]}...'"
            )

        return {
            "text_snippet": text[:120],
            "sentiment_score": round(normalized_score, 4),
            "bullish_magnitude": round(bull_score, 2),
            "bearish_magnitude": round(bear_score, 2),
            "z_score": round(z_score, 2),
            "circuit_breaker_tripped": is_circuit_breaker_trip,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


# Global Singleton
finbert_risk_scorer = FinBERTRiskScorer()
