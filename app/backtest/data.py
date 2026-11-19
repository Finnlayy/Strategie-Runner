"""Market-data normalisation for the backtesting workflow.

Every source (Kraken OHLC payloads from the TypeScript layer, CSV exports,
the local DuckDB/Parquet lake and deterministic sample data) is converted to
the same :class:`CandlePanel`: aligned, timezone-aware OHLCV frames indexed by
bar close time.  Alignment guarantees one return matrix for the QuantJourney
portfolio engine.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd

from app.backtest.config import BacktestConfig, BacktestError

OHLCV_FIELDS = ("open", "high", "low", "close", "volume")
_FIELD_ALIASES = {
    "o": "open",
    "h": "high",
    "l": "low",
    "c": "close",
    "v": "volume",
    "vol": "volume",
    "basevolume": "volume",
    "volume_base": "volume",
}
_TIME_ALIASES = ("time", "timestamp", "t", "date", "datetime", "ts", "open_time")


@dataclass(frozen=True)
class CandlePanel:
    """Aligned multi-symbol OHLCV panel."""

    open: pd.DataFrame
    high: pd.DataFrame
    low: pd.DataFrame
    close: pd.DataFrame
    volume: pd.DataFrame
    source: str
    interval_minutes: int

    @property
    def index(self) -> pd.DatetimeIndex:
        return self.close.index  # type: ignore[return-value]

    @property
    def symbols(self) -> list[str]:
        return list(self.close.columns)

    @property
    def n_bars(self) -> int:
        return int(len(self.close))

    @property
    def start(self) -> str:
        return self.index[0].isoformat()

    @property
    def end(self) -> str:
        return self.index[-1].isoformat()

    @property
    def returns(self) -> pd.DataFrame:
        return self.close.pct_change(fill_method=None).replace([np.inf, -np.inf], np.nan).fillna(0.0)

    @property
    def prices(self) -> dict[str, pd.DataFrame]:
        return {
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
        }

    def slice(self, start: Any = None, end: Any = None) -> "CandlePanel":
        """Return a time slice keeping the same data contract."""

        idx = self.index
        mask = np.ones(len(idx), dtype=bool)
        if start is not None:
            mask &= idx >= _utc_timestamp(start)
        if end is not None:
            mask &= idx <= _utc_timestamp(end)
        if mask.all():
            return self
        if mask.sum() < 2:
            raise BacktestError("requested date range leaves fewer than two bars")
        frames = {
            name: frame.loc[mask]
            for name, frame in (
                ("open", self.open),
                ("high", self.high),
                ("low", self.low),
                ("close", self.close),
                ("volume", self.volume),
            )
        }
        return CandlePanel(
            open=frames["open"],
            high=frames["high"],
            low=frames["low"],
            close=frames["close"],
            volume=frames["volume"],
            source=self.source,
            interval_minutes=self.interval_minutes,
        )

    def select(self, symbols: Iterable[str]) -> "CandlePanel":
        """Return a panel restricted to the given symbols."""

        wanted = [str(symbol).upper() for symbol in symbols]
        missing = [symbol for symbol in wanted if symbol not in self.close.columns]
        if missing:
            raise BacktestError(f"panel is missing symbols: {', '.join(missing)}")
        if wanted == self.symbols:
            return self
        return CandlePanel(
            open=self.open[wanted],
            high=self.high[wanted],
            low=self.low[wanted],
            close=self.close[wanted],
            volume=self.volume[wanted],
            source=self.source,
            interval_minutes=self.interval_minutes,
        )

    def tail(self, bars: int) -> "CandlePanel":
        if bars >= self.n_bars:
            return self
        return self.slice(start=self.index[-bars])


def _utc_timestamp(value: Any) -> pd.Timestamp:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        return timestamp.tz_localize("UTC")
    return timestamp.tz_convert("UTC")


def _coerce_time(values: Any) -> pd.DatetimeIndex:
    """Convert epoch seconds/ms/us/ns or ISO strings into a UTC index."""

    series = pd.Series(list(values)) if not isinstance(values, pd.Series) else values
    if series.empty:
        return pd.DatetimeIndex([], tz="UTC")
    numeric = pd.to_numeric(series, errors="coerce")
    if numeric.notna().all():
        magnitude = float(numeric.abs().max())
        unit = "s"
        if magnitude >= 1e17:
            unit = "ns"
        elif magnitude >= 1e14:
            unit = "us"
        elif magnitude >= 1e11:
            unit = "ms"
        return pd.DatetimeIndex(pd.to_datetime(numeric.astype("int64"), unit=unit, utc=True, errors="raise"))
    parsed = pd.to_datetime(series, utc=True, errors="coerce")
    if parsed.isna().any():
        raise BacktestError("candles contain an unparseable timestamp")
    return pd.DatetimeIndex(parsed)


def _normalise_bar(bar: Mapping[str, Any]) -> dict[str, float]:
    lowered = {str(key).strip().lower(): value for key, value in bar.items()}
    row: dict[str, float] = {}
    for field_name in OHLCV_FIELDS:
        raw = lowered.get(field_name, lowered.get(_FIELD_ALIASES.get(field_name, "")))
        if raw is None:
            for alias, target in _FIELD_ALIASES.items():
                if target == field_name and alias in lowered:
                    raw = lowered[alias]
                    break
        if raw is None:
            if field_name == "volume":
                raw = 0.0
            else:
                raise BacktestError(f"candle is missing the {field_name!r} field")
        try:
            value = float(raw)
        except (TypeError, ValueError) as exc:
            raise BacktestError(f"candle {field_name} is not numeric: {raw!r}") from exc
        if not math.isfinite(value):
            raise BacktestError(f"candle {field_name} is not finite")
        row[field_name] = value
    if row["open"] <= 0 or row["close"] <= 0 or row["high"] <= 0 or row["low"] <= 0:
        raise BacktestError("candle prices must be positive")
    if row["low"] > row["high"]:
        raise BacktestError("candle low exceeds high")
    row["high"] = max(row["high"], row["open"], row["close"])
    row["low"] = min(row["low"], row["open"], row["close"])
    row["volume"] = max(0.0, row["volume"])
    return row


def bars_to_frame(bars: Sequence[Mapping[str, Any]], symbol: str | None = None) -> pd.DataFrame:
    """Normalise a bar list (with or without a symbol column) into a frame."""

    rows: list[dict[str, Any]] = []
    for bar in bars:
        if not isinstance(bar, Mapping):
            raise BacktestError("each candle must be an object")
        lowered = {str(key).strip().lower(): value for key, value in bar.items()}
        time_value = next((lowered[key] for key in _TIME_ALIASES if key in lowered), None)
        if time_value is None:
            raise BacktestError("candle is missing a timestamp field")
        row = _normalise_bar(bar)
        row["time"] = time_value
        row["symbol"] = str(lowered.get("symbol") or symbol or "").strip().upper()
        rows.append(row)
    if not rows:
        raise BacktestError("candle list is empty")
    frame = pd.DataFrame(rows)
    frame["date"] = _coerce_time(frame["time"])
    return frame


def payload_to_panels(payload: Any) -> dict[str, pd.DataFrame]:
    """Convert the flexible ``candles`` payload into symbol -> OHLCV frame."""

    if payload is None:
        raise BacktestError("source=payload requires candles")
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    if isinstance(payload, Mapping):
        items = payload.items()
        for symbol, bars in items:
            if bars is None:
                continue
            if not isinstance(bars, Sequence) or isinstance(bars, (str, bytes)):
                raise BacktestError(f"candles for {symbol} must be a list")
            grouped[str(symbol).strip().upper()] = list(bars)
    elif isinstance(payload, Sequence) and not isinstance(payload, (str, bytes)):
        for bar in payload:
            if not isinstance(bar, Mapping):
                raise BacktestError("each candle must be an object")
            lowered = {str(key).strip().lower(): value for key, value in bar.items()}
            symbol = str(lowered.get("symbol") or lowered.get("pair") or "").strip().upper()
            if not symbol:
                raise BacktestError("flat candle arrays must include a symbol field")
            grouped.setdefault(symbol, []).append(bar)
    else:
        raise BacktestError("candles must be an object keyed by symbol or a flat list with symbols")
    if not grouped:
        raise BacktestError("candles payload is empty")

    frames: dict[str, pd.DataFrame] = {}
    for symbol, bars in grouped.items():
        frame = bars_to_frame(bars, symbol=symbol)
        frame = frame.set_index("date").sort_index()
        duplicated = frame.index.duplicated(keep="last")
        if duplicated.any():
            frame = frame[~duplicated]
        frames[symbol] = frame[OHLCV_FIELDS].astype(float)
    return frames


def load_csv(path: str | Path) -> dict[str, pd.DataFrame]:
    """Load a long-form (date, symbol, OHLCV) or single-symbol CSV."""

    candidate = Path(path)
    if not candidate.exists():
        raise BacktestError(f"CSV data file not found: {candidate}")
    try:
        frame = pd.read_csv(candidate)
    except Exception as exc:  # pragma: no cover - pandas error surface
        raise BacktestError(f"unable to read CSV data file: {exc}") from exc
    if frame.empty:
        raise BacktestError("CSV data file is empty")
    lowered = {str(column).strip().lower(): column for column in frame.columns}
    date_column = next((lowered[key] for key in _TIME_ALIASES if key in lowered), None)
    if date_column is None:
        raise BacktestError("CSV data file needs a date or timestamp column")
    rename = {lowered[key]: target for key, target in _FIELD_ALIASES.items() if key in lowered}
    for field_name in OHLCV_FIELDS:
        if field_name in lowered:
            rename[lowered[field_name]] = field_name
    frame = frame.rename(columns=rename)
    frame[date_column] = _coerce_time(frame[date_column])
    if "symbol" in lowered:
        frame = frame.rename(columns={lowered["symbol"]: "symbol"})
        grouped = {
            str(symbol).strip().upper(): part.drop(columns=["symbol"])
            for symbol, part in frame.groupby("symbol", sort=True)
        }
    else:
        grouped = {"ASSET": frame}
    frames: dict[str, pd.DataFrame] = {}
    for symbol, part in grouped.items():
        part = part.rename(columns={date_column: "date"}).set_index("date").sort_index()
        missing = [field_name for field_name in ("open", "high", "low", "close") if field_name not in part]
        if missing:
            raise BacktestError(f"CSV data is missing columns: {', '.join(missing)}")
        if "volume" not in part:
            part["volume"] = 0.0
        frames[symbol] = part[list(OHLCV_FIELDS)].astype(float)
    return frames


def load_lake(symbols: Iterable[str], start: Any, end: Any, interval_minutes: int) -> dict[str, pd.DataFrame]:
    """Load candles from the local DuckDB/Parquet OHLCV lake."""

    try:
        from app.data_layer.ohlc_query import query_engine
    except Exception as exc:  # pragma: no cover - optional dependency
        raise BacktestError(f"local data lake is unavailable: {exc}") from exc
    if not query_engine.has_data():
        raise BacktestError("local data lake is empty; seed it or use source=csv/sample")
    frames: dict[str, pd.DataFrame] = {}
    timeframe = _minutes_to_timeframe(interval_minutes)
    for symbol in symbols:
        try:
            records = query_engine.query_range(
                symbol,
                start_time=start,
                end_time=end,
                timeframe=timeframe,
                as_format="records",
            )
        except Exception as exc:
            raise BacktestError(f"lake query failed for {symbol}: {exc}") from exc
        if not records:
            raise BacktestError(f"no lake candles for {symbol} at {timeframe}")
        frame = bars_to_frame(records, symbol=symbol).set_index("date").sort_index()
        frames[str(symbol).upper()] = frame[list(OHLCV_FIELDS)].astype(float)
    return frames


def _minutes_to_timeframe(minutes: int) -> str:
    if minutes % 1_440 == 0:
        return f"{minutes // 1_440}d"
    if minutes % 60 == 0:
        return f"{minutes // 60}h"
    return f"{minutes}m"


def sample_frames(
    symbols: Sequence[str],
    bars: int,
    interval_minutes: int,
    seed: int = 42,
    end: pd.Timestamp | None = None,
) -> dict[str, pd.DataFrame]:
    """Deterministic regime-switching GBM sample data (offline demo)."""

    rng = np.random.default_rng(seed)
    end_ts = end or pd.Timestamp("2026-11-01T00:00:00Z").floor(f"{interval_minutes}min")
    index = pd.date_range(end=end_ts, periods=bars, freq=f"{interval_minutes}min", tz="UTC")
    frames: dict[str, pd.DataFrame] = {}
    base_prices = {"BTC": 62_000.0, "ETH": 3_200.0, "SOL": 145.0, "XRP": 0.62, "ADA": 0.46, "DOGE": 0.12}
    for position, symbol in enumerate(symbols):
        symbol_rng = np.random.default_rng(seed + 7919 * (position + 1) + sum(ord(ch) for ch in symbol))
        root = symbol.split("/")[0].split("-")[0].upper()
        base_price = base_prices.get(root, 50.0 + 10 * position)
        # Regime switches create trending and mean-reverting phases.
        regime_blocks = max(1, bars // 180)
        regimes = symbol_rng.choice([-1, 0, 1], size=regime_blocks, p=[0.25, 0.35, 0.40])
        bar_vol = (0.35 / math.sqrt(365 * 24 * 60 / interval_minutes))
        drift = np.repeat(regimes, math.ceil(bars / regime_blocks))[:bars]
        shocks = symbol_rng.normal(0.0, bar_vol, size=bars)
        cycle = np.sin(np.linspace(0, 6.2 * max(1, bars // 400), bars)) * bar_vol * 0.9
        log_returns = drift * bar_vol * 0.20 + shocks + cycle
        close = base_price * np.exp(np.cumsum(log_returns))
        open_ = np.concatenate([[base_price], close[:-1]])
        wick = np.abs(symbol_rng.normal(0.0, bar_vol * 0.7, size=bars))
        high = np.maximum(open_, close) * (1 + wick)
        low = np.minimum(open_, close) * (1 - wick)
        volume = np.abs(symbol_rng.normal(1.0, 0.25, size=bars)) * (base_price * 25)
        frames[str(symbol).upper()] = pd.DataFrame(
            {
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            },
            index=index,
        )
    return frames


def frames_to_panel(
    frames: Mapping[str, pd.DataFrame], *, source: str, interval_minutes: int
) -> CandlePanel:
    """Align per-symbol frames on a common UTC index."""

    if not frames:
        raise BacktestError("no market data available")
    cleaned: dict[str, pd.DataFrame] = {}
    for symbol, frame in frames.items():
        if frame is None or frame.empty:
            raise BacktestError(f"no candles for {symbol}")
        work = frame.copy()
        if not isinstance(work.index, pd.DatetimeIndex):
            raise BacktestError(f"{symbol} data is not indexed by time")
        if work.index.tz is None:
            work.index = work.index.tz_localize("UTC")
        else:
            work.index = work.index.tz_convert("UTC")
        work = work[~work.index.duplicated(keep="last")].sort_index()
        work = work.replace([np.inf, -np.inf], np.nan)
        for field_name in OHLCV_FIELDS:
            if field_name not in work:
                if field_name == "volume":
                    work[field_name] = 0.0
                else:
                    raise BacktestError(f"{symbol} data is missing {field_name}")
        work = work[list(OHLCV_FIELDS)].astype(float)
        work = work.dropna(subset=["open", "high", "low", "close"])
        work["volume"] = work["volume"].fillna(0.0)
        if work.empty:
            raise BacktestError(f"{symbol} data has no valid OHLC rows")
        cleaned[str(symbol).upper()] = work

    union_index = cleaned[next(iter(cleaned))].index
    for frame in cleaned.values():
        union_index = union_index.union(frame.index)
    union_index = union_index.sort_values()
    union_index = union_index[~union_index.duplicated()]

    data: dict[str, dict[str, pd.Series]] = {field_name: {} for field_name in OHLCV_FIELDS}
    for symbol, frame in cleaned.items():
        reindexed = frame.reindex(union_index)
        for field_name in OHLCV_FIELDS:
            column = reindexed[field_name]
            if field_name == "volume":
                column = column.fillna(0.0)
            else:
                # Limited forward fill keeps a symbol alive through short gaps
                # without inventing prices before its first observation.
                column = column.ffill(limit=3)
            data[field_name][symbol] = column

    close = pd.DataFrame(data["close"]).dropna(how="any")
    if len(close) < 10:
        raise BacktestError(f"at least 10 aligned bars are required, got {len(close)}")
    index = close.index
    open_ = pd.DataFrame(data["open"]).reindex(index)
    high = pd.DataFrame(data["high"]).reindex(index)
    low = pd.DataFrame(data["low"]).reindex(index)
    volume = pd.DataFrame(data["volume"]).reindex(index).fillna(0.0)

    # A final guard: prices must be strictly positive for return accounting.
    if (close <= 0).any().any():
        raise BacktestError("market data contains non-positive prices")
    high = high.where(high >= close, close)
    low = low.where(low <= close, close)

    return CandlePanel(
        open=open_.astype(float),
        high=high.astype(float),
        low=low.astype(float),
        close=close.astype(float),
        volume=volume.astype(float),
        source=source,
        interval_minutes=interval_minutes,
    )


def resolve_panel(config: BacktestConfig) -> CandlePanel:
    """Resolve the configured data source into an aligned candle panel."""

    if config.source == "payload":
        frames = payload_to_panels(config.candles)
    elif config.source == "csv":
        if not config.data_file:
            raise BacktestError("source=csv requires dataFile")
        frames = load_csv(config.data_file)
    elif config.source == "duckdb":
        frames = load_lake(config.symbols, config.start, config.end, config.interval_minutes)
    else:
        frames = sample_frames(
            config.symbols,
            config.sample_bars,
            config.interval_minutes,
            seed=config.seed,
        )

    requested = set(config.symbols)
    if config.benchmark_symbol:
        requested.add(config.benchmark_symbol.upper())
    available = set(frames)
    if config.source == "csv" and len(frames) == 1 and "ASSET" in frames:
        # Single-symbol CSV: map the generic column to the requested symbol.
        frames = {config.symbols[0]: frames["ASSET"]}
        available = set(frames)
    missing = sorted(requested - available)
    if missing and config.source != "payload":
        raise BacktestError(f"data source is missing requested symbols: {', '.join(missing)}")
    selected = {symbol: frames[symbol] for symbol in frames if symbol in requested}
    if not selected:
        raise BacktestError("data source has none of the requested symbols")

    panel = frames_to_panel(selected, source=config.source, interval_minutes=config.interval_minutes)
    if config.start or config.end:
        panel = panel.slice(config.start, config.end)
    return panel
