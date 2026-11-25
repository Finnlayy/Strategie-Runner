"""Indicator helpers backed by ``quantjourney_ti`` with a pandas fallback.

The public functions accept a price Series and return a Series/DataFrame with
the same index.  When the QuantJourney indicator library is installed it is
used directly; otherwise equivalent pandas implementations keep the strategy
registry usable in minimal environments.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

try:  # pragma: no cover - exercised through integration paths
    import quantjourney_ti as _ti
except Exception:  # pragma: no cover - optional dependency
    _ti = None


def ti_engine() -> str:
    return "quantjourney_ti" if _ti is not None else "pandas-fallback"


def sma(series: pd.Series, period: int = 20) -> pd.Series:
    period = _period(period, "sma")
    if _ti is not None:
        return _ti.sma(series, period)
    return series.rolling(period, min_periods=period).mean()


def ema(series: pd.Series, period: int = 20) -> pd.Series:
    period = _period(period, "ema")
    if _ti is not None:
        return _ti.ema(series, period)
    return series.ewm(span=period, adjust=False, min_periods=period).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    period = _period(period, "rsi")
    if _ti is not None:
        return _ti.rsi(series, period)
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    return (100 - 100 / (1 + rs)).rename(f"RSI_{period}")


def macd(
    series: pd.Series,
    fast_period: int = 12,
    slow_period: int = 26,
    signal_period: int = 9,
) -> pd.DataFrame:
    fast_period = _period(fast_period, "macd fast")
    slow_period = _period(slow_period, "macd slow")
    if fast_period >= slow_period:
        raise ValueError("macd fast period must be smaller than the slow period")
    if _ti is not None:
        frame = _ti.macd(series, fast_period, slow_period, signal_period)
        return _canonical_macd(frame, series, fast_period, slow_period, signal_period)
    fast = series.ewm(span=fast_period, adjust=False, min_periods=fast_period).mean()
    slow = series.ewm(span=slow_period, adjust=False, min_periods=slow_period).mean()
    line = fast - slow
    signal = line.ewm(span=max(2, signal_period), adjust=False, min_periods=max(2, signal_period)).mean()
    return pd.DataFrame({"macd": line, "signal": signal, "histogram": line - signal})


def _canonical_macd(
    frame: Any,
    series: pd.Series,
    fast_period: int,
    slow_period: int,
    signal_period: int,
) -> pd.DataFrame:
    if isinstance(frame, pd.DataFrame):
        columns = {str(column).lower(): column for column in frame.columns}
        line_col = next((columns[key] for key in columns if "macd" in key and "signal" not in key and "hist" not in key), None)
        signal_col = next((columns[key] for key in columns if "signal" in key), None)
        hist_col = next((columns[key] for key in columns if "hist" in key), None)
        if line_col is not None:
            line = frame[line_col].astype(float)
            signal = frame[signal_col].astype(float) if signal_col is not None else line.ewm(span=signal_period, adjust=False).mean()
            hist = frame[hist_col].astype(float) if hist_col is not None else line - signal
            return pd.DataFrame({"macd": line, "signal": signal, "histogram": hist})
    fast = series.ewm(span=fast_period, adjust=False, min_periods=fast_period).mean()
    slow = series.ewm(span=slow_period, adjust=False, min_periods=slow_period).mean()
    line = fast - slow
    signal = line.ewm(span=signal_period, adjust=False, min_periods=signal_period).mean()
    return pd.DataFrame({"macd": line, "signal": signal, "histogram": line - signal})


def bollinger(series: pd.Series, period: int = 20, num_std: float = 2.0) -> pd.DataFrame:
    period = _period(period, "bollinger")
    if _ti is not None:
        frame = _ti.bb(series, period, num_std)
        if isinstance(frame, pd.DataFrame):
            lowered = {str(column).lower(): column for column in frame.columns}
            upper = next((lowered[key] for key in lowered if "upper" in key), None)
            middle = next((lowered[key] for key in lowered if "mid" in key or "sma" in key or "basis" in key), None)
            lower = next((lowered[key] for key in lowered if "lower" in key), None)
            if upper is not None and lower is not None:
                middle_series = frame[middle].astype(float) if middle is not None else (frame[upper] + frame[lower]) / 2
                return pd.DataFrame(
                    {
                        "upper": frame[upper].astype(float),
                        "middle": middle_series,
                        "lower": frame[lower].astype(float),
                    }
                )
    middle = series.rolling(period, min_periods=period).mean()
    deviation = series.rolling(period, min_periods=period).std(ddof=0)
    return pd.DataFrame(
        {
            "upper": middle + num_std * deviation,
            "middle": middle,
            "lower": middle - num_std * deviation,
        }
    )


def roc(series: pd.Series, period: int = 12) -> pd.Series:
    period = _period(period, "roc")
    if _ti is not None:
        return _ti.roc(series, period)
    return (series / series.shift(period) - 1.0).rename(f"ROC_{period}")


def atr(panel_frame: pd.DataFrame, period: int = 14) -> pd.Series:
    period = _period(period, "atr")
    frame = panel_frame[["high", "low", "close"]].astype(float)
    if _ti is not None:
        try:
            return _ti.atr(frame, period)
        except Exception:
            pass
    previous_close = frame["close"].shift(1)
    true_range = pd.concat(
        [
            frame["high"] - frame["low"],
            (frame["high"] - previous_close).abs(),
            (frame["low"] - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return true_range.ewm(alpha=1 / period, adjust=False, min_periods=period).mean().rename(f"ATR_{period}")


def realized_volatility(series: pd.Series, window: int = 20, periods_per_year: int = 365) -> pd.Series:
    window = max(2, int(window))
    returns = series.pct_change(fill_method=None)
    return (returns.rolling(window, min_periods=max(2, window // 2)).std(ddof=0) * np.sqrt(periods_per_year)).rename(
        f"VOL_{window}"
    )


def rolling_high(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(int(window), min_periods=int(window)).max().shift(1)


def rolling_low(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(int(window), min_periods=int(window)).min().shift(1)


def _period(value: Any, name: str) -> int:
    try:
        period = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} period must be an integer, got {value!r}") from exc
    if period < 1:
        raise ValueError(f"{name} period must be >= 1")
    return period
