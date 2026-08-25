"""
Universal Symbol Parser and Exchange Gateway Normalizer for Kraken Spot & Kraken Pro.

Provides deterministic sanitization, canonical conversion (BASE/QUOTE),
Parquet partition formatting (BASE_QUOTE), Kraken Spot legacy pair translation
(XXBTZUSD, XETHZEUR, etc.), and Kraken Pro Perpetual Futures format (PF_XBTUSD).
"""

import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union


class ExchangeSymbolNormalizer:
    """
    Enterprise-grade symbol resolution engine for crypto asset tickers.
    
    Transforms arbitrary free-text user, CLI, or API inputs (e.g., 'btc usd',
    'ETH-USDT', 'sol_eur', 'xrp/usd', 'BTCUSD', 'kraken:btc/usd') into canonical,
    storage partition, Kraken Spot, and Kraken Pro Futures formats deterministically.
    """

    # Comprehensive Kraken ISO/Alt-Code Mapping Dictionary
    KRAKEN_BASE_MAP: Dict[str, str] = {
        "BTC": "XXBT",
        "XBT": "XXBT",
        "ETH": "XETH",
        "XRP": "XXRP",
        "LTC": "XLTC",
        "XLM": "XXLM",
        "XMR": "XXMR",
        "ETC": "XETC",
        "ZEC": "XZEC",
        "REP": "XREP",
        "DOGE": "XDG",
        "MLN": "XMLN",
        "USD": "ZUSD",
        "EUR": "ZEUR",
        "GBP": "ZGBP",
        "CAD": "ZCAD",
        "JPY": "ZJPY",
        "KRW": "ZKRW",
    }

    # Inverse mapping from Kraken Alt-Codes back to Canonical tickers
    REVERSE_KRAKEN_BASE_MAP: Dict[str, str] = {
        "XXBT": "BTC",
        "XBT": "BTC",
        "XETH": "ETH",
        "XXRP": "XRP",
        "XLTC": "LTC",
        "XXLM": "XLM",
        "XXMR": "XMR",
        "XETC": "ETC",
        "XZEC": "ZEC",
        "XREP": "REP",
        "XDG": "DOGE",
        "XMLN": "MLN",
        "ZUSD": "USD",
        "ZEUR": "EUR",
        "ZGBP": "GBP",
        "ZCAD": "CAD",
        "ZJPY": "JPY",
        "ZKRW": "KRW",
    }

    # Known fiat & stablecoin quote currencies for regex splitting
    KNOWN_QUOTES: Set[str] = {
        "USD", "USDT", "USDC", "EUR", "GBP", "CAD", "JPY", 
        "CHF", "AUD", "DAI", "KRW", "SGD", "BUSD", "TUSD", "BTC", "ETH"
    }

    # Common prefix stripping regex (kraken:, exchange:, spot:, futures:, etc.)
    PREFIX_REGEX = re.compile(r"^(KRAKEN|KRAKENPRO|KRAKEN_PRO|EXCHANGE|SPOT|FUTURES|PERP)[:_/\s]+", re.IGNORECASE)

    # Delimiter normalization regex
    DELIMITER_REGEX = re.compile(r"[\s\-_\.:|]+", re.UNICODE)

    @classmethod
    def parse(cls, raw_input: str) -> Tuple[str, str]:
        """
        Parses and sanitizes any free-text ticker input into a clean (Base, Quote) tuple.

        Args:
            raw_input: Raw ticker string from CLI, UI, or API (e.g. 'btc usd', 'ETH-USDT', 'sol_eur').

        Returns:
            Tuple of (base, quote) in standardized uppercase strings (e.g., ('BTC', 'USD')).
        """
        if not raw_input or not isinstance(raw_input, str):
            return ("BTC", "USD")

        clean = raw_input.strip().upper()
        # Strip exchange/context prefixes (e.g., 'kraken:btc/usd' -> 'BTC/USD')
        clean = cls.PREFIX_REGEX.sub("", clean).strip()

        # Handle reverse legacy kraken format (e.g. 'XXBTZUSD' -> 'BTC/USD')
        if clean.startswith("XXBT") and clean.endswith("ZUSD"):
            return ("BTC", "USD")
        if clean.startswith("XXBT") and clean.endswith("ZEUR"):
            return ("BTC", "EUR")
        if clean.startswith("XETH") and clean.endswith("ZUSD"):
            return ("ETH", "USD")
        if clean.startswith("XETH") and clean.endswith("ZEUR"):
            return ("ETH", "EUR")

        # Normalize any whitespace or punctuation delimiters into a single '/'
        clean = cls.DELIMITER_REGEX.sub("/", clean)

        # 1. Delimiter-based splitting (e.g., 'BTC/USD', 'ETH/EUR', 'SOL/USDT')
        if "/" in clean:
            parts = [p for p in clean.split("/") if p]
            if len(parts) >= 2:
                base, quote = parts[0], parts[1]
                # Normalize legacy XBT -> BTC
                resolved_base = "BTC" if base in ("XBT", "XXBT") else cls.REVERSE_KRAKEN_BASE_MAP.get(base, base)
                resolved_quote = cls.REVERSE_KRAKEN_BASE_MAP.get(quote, quote)
                return (resolved_base, resolved_quote)
            elif len(parts) == 1:
                clean = parts[0]

        # 2. Suffix matching against known quotes (sorted by length descending for greediness)
        for quote in sorted(cls.KNOWN_QUOTES, key=len, reverse=True):
            if clean.endswith(quote) and len(clean) > len(quote):
                base = clean[:-len(quote)]
                resolved_base = "BTC" if base in ("XBT", "XXBT") else cls.REVERSE_KRAKEN_BASE_MAP.get(base, base)
                return (resolved_base, quote)

        # 3. Fallback when no known quote currency matches
        resolved_base = "BTC" if clean in ("XBT", "XXBT") else cls.REVERSE_KRAKEN_BASE_MAP.get(clean, clean)
        return (resolved_base, "USD")

    @classmethod
    def to_canonical(cls, raw_input: str) -> str:
        """
        Converts raw input to canonical User & UI format: 'BASE/QUOTE'.

        Args:
            raw_input: Raw ticker string (e.g. 'btc_usd', 'ETH-USDT').

        Returns:
            Canonical string (e.g. 'BTC/USD', 'ETH/USDT').
        """
        base, quote = cls.parse(raw_input)
        return f"{base}/{quote}"

    @classmethod
    def to_lake_partition(cls, raw_input: str) -> str:
        """
        Converts raw input to DuckDB / Parquet storage directory format: 'BASE_QUOTE'.

        Args:
            raw_input: Raw ticker string.

        Returns:
            Sanitized partition identifier (e.g. 'BTC_USD', 'SOL_EUR').
        """
        base, quote = cls.parse(raw_input)
        return f"{base}_{quote}"

    @classmethod
    def to_kraken_spot(cls, raw_input: str) -> str:
        """
        Maps symbol to official Kraken Spot REST & WebSocket format.
        Applies legacy prefixes (XXBT, ZUSD, etc.) or modern ISO format.

        Args:
            raw_input: Raw ticker string.

        Returns:
            Kraken Spot pair identifier (e.g. 'XXBTZUSD', 'XETHZEUR', 'SOLUSD').
        """
        base, quote = cls.parse(raw_input)
        k_base = cls.KRAKEN_BASE_MAP.get(base, base)
        k_quote = cls.KRAKEN_BASE_MAP.get(quote, quote)
        return f"{k_base}{k_quote}"

    @classmethod
    def to_kraken_pro_futures(cls, raw_input: str) -> str:
        """
        Maps symbol to official Kraken Pro Futures perpetual contracts ('PF_BASEQUOTE').

        Args:
            raw_input: Raw ticker string.

        Returns:
            Kraken Pro perpetual contract symbol (e.g. 'PF_XBTUSD', 'PF_ETHUSD', 'PF_SOLUSD').
        """
        base, quote = cls.parse(raw_input)
        f_base = "XBT" if base in ("BTC", "XXBT") else base
        return f"PF_{f_base}{quote}"

    @classmethod
    def resolve_all(cls, raw_input: str) -> Dict[str, str]:
        """
        Generates full resolution payload with all representations and metadata.

        Args:
            raw_input: Raw ticker string.

        Returns:
            Dictionary containing base, quote, canonical, lake_partition,
            kraken_spot, and kraken_pro_futures keys.
        """
        base, quote = cls.parse(raw_input)
        return {
            "raw_input": raw_input,
            "base": base,
            "quote": quote,
            "canonical": f"{base}/{quote}",
            "lake_partition": f"{base}_{quote}",
            "kraken_spot": cls.to_kraken_spot(raw_input),
            "kraken_pro_futures": cls.to_kraken_pro_futures(raw_input),
        }

    @classmethod
    def is_valid_symbol(cls, raw_input: str) -> bool:
        """
        Validates whether raw_input yields a valid base and quote currency.

        Args:
            raw_input: Raw ticker string.

        Returns:
            True if symbol can be parsed into valid alpha strings, False otherwise.
        """
        if not raw_input or not isinstance(raw_input, str):
            return False
        try:
            base, quote = cls.parse(raw_input)
            return len(base) >= 2 and len(quote) >= 2 and base.isalnum() and quote.isalnum()
        except Exception:
            return False


# Singleton alias for convenient functional importation
symbol_normalizer = ExchangeSymbolNormalizer()
