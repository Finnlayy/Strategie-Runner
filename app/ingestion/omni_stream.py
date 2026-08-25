"""
Omni-Channel Live Ingestion Engine (Modul 15: 15_OMNI_INGESTION_ALPHA).
Implements:
- Multi-Source Stream Ingestion (Telegram Channels, RSS Feeds, CryptoNews Webhooks)
- High-Speed Regex Ticker Extraction ($BTC, #ETH, SOL/USD, etc.)
- Real-Time FinBERT Sentiment Integration and Urgency Tagging
"""

from datetime import datetime, timezone
import re
from typing import Any, Dict, List, Optional, Set, Tuple

from app.core.directives import ExecutionPath, system_directive
from app.risk.finbert_risk import finbert_risk_scorer

# Regex patterns for fast ticker detection
TICKER_REGEX = re.compile(r"(\$[A-Z0-9]{2,10}|#[A-Z0-9]{2,10}|(?:\b[A-Z0-9]{2,6}[/-][A-Z0-9]{2,6}\b)|\b(?:BTC|ETH|SOL|ADA|XRP|DOGE|AVAX|DOT|LINK|MATIC)\b)", re.IGNORECASE)


class OmniStreamIngestor:
    """
    Ingests and parses real-time text streams from social media and news feeds.
    """

    def __init__(self):
        self._parsed_events: List[Dict[str, Any]] = []

    def extract_tickers(self, text: str) -> List[str]:
        """Extracts canonicalized crypto symbols from unstructured message text."""
        matches = TICKER_REGEX.findall(text)
        cleaned: Set[str] = set()
        for m in matches:
            sym = m.strip("$#").upper().replace("-", "/")
            if "/" not in sym:
                sym = f"{sym}/USD"
            cleaned.add(sym)
        return sorted(list(cleaned))

    def ingest_message(
        self,
        source: str,
        raw_text: str,
        author: str = "SYSTEM_STREAM",
        external_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Parses raw text stream event, scores sentiment, and indexes extracted assets.
        """
        system_directive.record_path_execution(ExecutionPath.HOT_PATH)
        tickers = self.extract_tickers(raw_text)
        sentiment_res = finbert_risk_scorer.score_text(raw_text)

        event = {
            "source": source,
            "author": author,
            "external_id": external_id or f"msg_{datetime.now(timezone.utc).timestamp()}",
            "text": raw_text,
            "detected_tickers": tickers,
            "sentiment_score": sentiment_res["sentiment_score"],
            "circuit_breaker_tripped": sentiment_res["circuit_breaker_tripped"],
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        self._parsed_events.append(event)
        if len(self._parsed_events) > 500:
            self._parsed_events.pop(0)

        return event

    def get_latest_stream_events(self, limit: int = 50) -> List[Dict[str, Any]]:
        return self._parsed_events[-limit:]


# Global Singleton
omni_stream_ingestor = OmniStreamIngestor()
