"""Validated configuration objects for the QuantJourney backtesting workflow.

All request payloads (HTTP, CLI, MCP, frontend) converge on
:class:`BacktestConfig`.  Aliases are accepted in both camelCase and
snake_case so the TypeScript layer can forward UI state without mapping every
field, while the engine itself only sees normalised, validated values.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable, Mapping, Sequence

SUPPORTED_MODELS = (
    "sma_cross",
    "ema_cross",
    "rsi_reversion",
    "macd_trend",
    "bollinger_reversion",
    "momentum",
    "donchian_breakout",
    "cross_sectional_momentum",
    "inverse_volatility",
    "risk_parity",
    "vol_target_trend",
    "buy_hold",
    "weights",
    "rule",
)

ALLOCATION_METHODS = (
    "equal_weight",
    "inverse_volatility",
    "fixed_fraction",
    "signal_weighted",
)

REBALANCE_FREQUENCIES = ("signal", "bar", "D", "W", "BME", "BQE", "BYE", "NONE")

OBJECTIVES = ("sharpe", "sortino", "calmar", "total_return", "cagr", "profit_factor")


class BacktestError(ValueError):
    """Invalid backtest request or unusable market data."""


def _pick(payload: Mapping[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in payload and payload[key] is not None:
            return payload[key]
    return default


def _as_float(value: Any, name: str, *, default: float | None = None) -> float:
    if value is None:
        if default is None:
            raise BacktestError(f"{name} is required")
        return float(default)
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise BacktestError(f"{name} must be numeric, got {value!r}") from exc
    if math.isnan(number) or math.isinf(number):
        raise BacktestError(f"{name} must be finite")
    return number


def _as_int(value: Any, name: str, *, default: int | None = None) -> int:
    number = _as_float(value, name, default=None if default is None else float(default))
    if number != int(number):
        raise BacktestError(f"{name} must be an integer")
    return int(number)


def _as_bool(value: Any, name: str, *, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    raw = str(value).strip().lower()
    if raw in {"1", "true", "yes", "y", "on"}:
        return True
    if raw in {"0", "false", "no", "n", "off", ""}:
        return False
    raise BacktestError(f"{name} must be boolean, got {value!r}")


_INTERVAL_ALIASES = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "60m": 60,
    "60min": 60,
    "hourly": 60,
    "2h": 120,
    "4h": 240,
    "240m": 240,
    "1d": 1440,
    "daily": 1440,
    "day": 1440,
    "1w": 10080,
    "1wk": 10080,
    "weekly": 10080,
}


def _as_interval(value: Any, name: str = "intervalMinutes", default: int = 15) -> int:
    """Parse numeric minute intervals plus common granularity aliases."""

    if isinstance(value, str):
        key = value.strip().lower()
        if key in _INTERVAL_ALIASES:
            return _INTERVAL_ALIASES[key]
    return _as_int(value, name, default=default)


def _as_symbols(value: Any, fallback: str | None = None) -> tuple[str, ...]:
    if value is None:
        if fallback:
            value = [fallback]
        else:
            raise BacktestError("symbols is required")
    if isinstance(value, str):
        value = [part for part in value.replace(";", ",").split(",") if part.strip()]
    if not isinstance(value, Iterable):
        raise BacktestError("symbols must be a list of trading symbols")
    symbols: list[str] = []
    for raw in value:
        symbol = str(raw).strip().upper()
        if not symbol:
            continue
        if not all(ch.isalnum() or ch in "/-.:_" for ch in symbol):
            raise BacktestError(f"invalid symbol {raw!r}")
        if symbol not in symbols:
            symbols.append(symbol)
    if not symbols:
        raise BacktestError("at least one symbol is required")
    if len(symbols) > 50:
        raise BacktestError("at most 50 symbols are supported per backtest")
    return tuple(symbols)


def _normalize_model(value: Any) -> str:
    model = str(value or "sma_cross").strip().lower().replace("-", "_")
    aliases = {
        "sma": "sma_cross",
        "ma_cross": "sma_cross",
        "golden_cross": "sma_cross",
        "ema": "ema_cross",
        "rsi": "rsi_reversion",
        "rsi_mean_reversion": "rsi_reversion",
        "macd": "macd_trend",
        "bollinger": "bollinger_reversion",
        "bollinger_bands": "bollinger_reversion",
        "breakout": "donchian_breakout",
        "donchian": "donchian_breakout",
        "momentum_strategy": "momentum",
        "xsmom": "cross_sectional_momentum",
        "cross_sectional": "cross_sectional_momentum",
        "risk_parity": "risk_parity",
        "inverse_vol": "inverse_volatility",
        "inv_vol": "inverse_volatility",
        "vol_target": "vol_target_trend",
        "volatility_target": "vol_target_trend",
        "buy_and_hold": "buy_hold",
        "buyhold": "buy_hold",
        "static_weights": "weights",
        "rules": "rule",
    }
    model = aliases.get(model, model)
    if model not in SUPPORTED_MODELS:
        raise BacktestError(
            f"unsupported strategy model {value!r}; choose one of {', '.join(SUPPORTED_MODELS)}"
        )
    return model


@dataclass(frozen=True)
class StrategySpec:
    """Signal model and its parameters."""

    model: str = "sma_cross"
    params: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any] | None) -> "StrategySpec":
        payload = dict(payload or {})
        model = payload.get("model") or payload.get("name") or payload.get("type") or "sma_cross"
        params = payload.get("params")
        if params is None:
            params = {
                key: value
                for key, value in payload.items()
                if key not in {"model", "name", "type", "params"}
            }
        if not isinstance(params, Mapping):
            raise BacktestError("strategy.params must be an object")
        return cls(model=_normalize_model(model), params=dict(params))

    def to_dict(self) -> dict[str, Any]:
        return {"model": self.model, "params": dict(self.params)}


@dataclass(frozen=True)
class AllocationSpec:
    """Portfolio construction rules applied to raw signals."""

    method: str = "equal_weight"
    max_position_size: float = 1.0
    long_short: bool = False
    vol_target: float | None = None
    gross_exposure: float = 1.0
    top_n: int | None = None

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any] | None) -> "AllocationSpec":
        payload = dict(payload or {})
        method = str(payload.get("method") or payload.get("mode") or "equal_weight").lower()
        method = {
            "equal": "equal_weight",
            "equally_weighted": "equal_weight",
            "inverse_vol": "inverse_volatility",
            "inv_vol": "inverse_volatility",
            "fixed": "fixed_fraction",
            "signal": "signal_weighted",
        }.get(method, method)
        if method not in ALLOCATION_METHODS:
            raise BacktestError(
                f"unsupported allocation method {method!r}; choose {', '.join(ALLOCATION_METHODS)}"
            )
        max_position = _as_float(
            _pick(payload, "maxPositionSize", "max_position_size"), "allocation.maxPositionSize", default=1.0
        )
        if not (0 < max_position <= 1.0):
            raise BacktestError("allocation.maxPositionSize must be in (0, 1]")
        gross = _as_float(
            _pick(payload, "grossExposure", "gross_exposure"), "allocation.grossExposure", default=1.0
        )
        if not (0 < gross <= 5.0):
            raise BacktestError("allocation.grossExposure must be in (0, 5]")
        vol_target = _pick(payload, "volTarget", "vol_target", "targetVolatility", "target_volatility")
        vol_target_value = None
        if vol_target not in (None, "", 0):
            vol_target_value = _as_float(vol_target, "allocation.volTarget")
            if not (0 < vol_target_value <= 3.0):
                raise BacktestError("allocation.volTarget must be in (0, 3]")
        top_n = _pick(payload, "topN", "top_n")
        top_n_value = None if top_n in (None, "", 0) else _as_int(top_n, "allocation.topN")
        if top_n_value is not None and top_n_value < 1:
            raise BacktestError("allocation.topN must be >= 1")
        return cls(
            method=method,
            max_position_size=max_position,
            long_short=_as_bool(_pick(payload, "longShort", "long_short"), "allocation.longShort", default=False),
            vol_target=vol_target_value,
            gross_exposure=gross,
            top_n=top_n_value,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class RebalanceSpec:
    """Rebalance policy forwarded to ``quantjourney_bt.portfolio.rebalance``."""

    frequency: str = "D"
    every_bars: int | None = None
    drift_threshold: float | None = None
    on_signal_change: bool = False
    signal_change_threshold: float = 0.0
    max_drawdown_trigger: float | None = None
    max_drawdown_action: str = "flatten"
    max_annual_turnover: float | None = None
    min_trade_weight: float = 0.0
    partial: bool = False
    calendar_dates: tuple[str, ...] | None = None

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any] | None) -> "RebalanceSpec":
        payload = dict(payload or {})
        frequency = str(payload.get("frequency") or payload.get("freq") or "D").strip()
        upper = frequency.upper()
        if upper in {"SIGNAL", "SIGNAL_CHANGE"}:
            frequency = "signal"
        elif upper in {"BAR", "EVERY_BAR"}:
            frequency = "bar"
        elif upper in {"NONE", "OFF", "NEVER"}:
            frequency = "NONE"
        elif upper in {"DAILY", "DAY"}:
            frequency = "D"
        elif upper in {"WEEKLY", "WEEK"}:
            frequency = "W"
        elif upper in {"MONTHLY", "MONTH"}:
            frequency = "BME"
        elif upper in {"QUARTERLY", "QUARTER"}:
            frequency = "BQE"
        if frequency not in REBALANCE_FREQUENCIES:
            raise BacktestError(
                f"unsupported rebalance frequency {frequency!r}; choose {', '.join(REBALANCE_FREQUENCIES)}"
            )
        every_bars = _pick(payload, "everyBars", "every_bars", "everyNBars", "every_n_bars")
        every_bars_value = None
        if every_bars not in (None, "", 0):
            every_bars_value = _as_int(every_bars, "rebalance.everyBars")
            if every_bars_value < 1:
                raise BacktestError("rebalance.everyBars must be >= 1")
        drift = _pick(payload, "driftThreshold", "drift_threshold", "driftBand", "drift_band")
        drift_value = None
        if drift not in (None, "", 0):
            drift_value = _as_float(drift, "rebalance.driftThreshold")
            if not (0 < drift_value <= 1):
                raise BacktestError("rebalance.driftThreshold must be in (0, 1]")
        drawdown = _pick(
            payload, "maxDrawdownTrigger", "max_drawdown_trigger", "drawdownTrigger", "drawdown_trigger"
        )
        drawdown_value = None
        if drawdown not in (None, "", 0):
            drawdown_value = _as_float(drawdown, "rebalance.maxDrawdownTrigger")
            if drawdown_value >= 0:
                drawdown_value = -abs(drawdown_value)
            if drawdown_value < -1:
                raise BacktestError("rebalance.maxDrawdownTrigger must be >= -1")
        turnover = _pick(payload, "maxAnnualTurnover", "max_annual_turnover")
        turnover_value = None
        if turnover not in (None, "", 0):
            turnover_value = _as_float(turnover, "rebalance.maxAnnualTurnover")
            if turnover_value <= 0:
                raise BacktestError("rebalance.maxAnnualTurnover must be > 0")
        calendar = _pick(payload, "calendarDates", "calendar_dates")
        calendar_value = None
        if calendar:
            if isinstance(calendar, str):
                calendar = [calendar]
            calendar_value = tuple(str(item) for item in calendar)
        return cls(
            frequency=frequency,
            every_bars=every_bars_value,
            drift_threshold=drift_value,
            on_signal_change=_as_bool(
                _pick(payload, "onSignalChange", "on_signal_change", "rebalanceOnSignalChange"),
                "rebalance.onSignalChange",
                default=False,
            ),
            signal_change_threshold=_as_float(
                _pick(payload, "signalChangeThreshold", "signal_change_threshold"),
                "rebalance.signalChangeThreshold",
                default=0.0,
            ),
            max_drawdown_trigger=drawdown_value,
            max_drawdown_action=str(
                _pick(payload, "maxDrawdownAction", "max_drawdown_action", default="flatten")
            ),
            max_annual_turnover=turnover_value,
            min_trade_weight=_as_float(
                _pick(payload, "minTradeWeight", "min_trade_weight"), "rebalance.minTradeWeight", default=0.0
            ),
            partial=_as_bool(_pick(payload, "partial", "partialRebalance", "partial_rebalance"), "rebalance.partial"),
            calendar_dates=calendar_value,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class BacktestConfig:
    """Normalised, validated request for one backtest run."""

    strategy_id: str = "custom"
    strategy_name: str = "QuantJourney Backtest"
    symbols: tuple[str, ...] = ("BTC/USD",)
    interval_minutes: int = 15
    source: str = "payload"
    data_file: str | None = None
    start: str | None = None
    end: str | None = None
    initial_capital: float = 10_000.0
    fee_bps: float = 26.0
    slippage_bps: float = 5.0
    strategy: StrategySpec = field(default_factory=StrategySpec)
    allocation: AllocationSpec = field(default_factory=AllocationSpec)
    rebalance: RebalanceSpec = field(default_factory=RebalanceSpec)
    benchmark_mode: str = "asset"
    benchmark_symbol: str | None = None
    hard_stop_enabled: bool = False
    hard_stop_percent: float | None = None
    periods_per_year: int | None = None
    sample_bars: int = 1440
    seed: int = 42
    persist: bool = True
    tags: tuple[str, ...] = ()
    candles: dict[str, Any] | None = None

    # ------------------------------------------------------------------
    # construction
    # ------------------------------------------------------------------
    @classmethod
    def from_payload(cls, payload: Mapping[str, Any] | None) -> "BacktestConfig":
        if not isinstance(payload, Mapping):
            raise BacktestError("backtest request must be a JSON object")
        payload = dict(payload)

        raw_symbols = _pick(payload, "symbols", "instruments", "assetPairs", "asset_pairs")
        fallback = _pick(payload, "symbol", "assetPair", "pair", "asset_pair")
        symbols = _as_symbols(raw_symbols, fallback=str(fallback) if fallback else None)

        interval = _pick(payload, "intervalMinutes", "interval_minutes", "interval", "timeframeMinutes")
        interval_value = _as_interval(interval, "intervalMinutes", default=15)
        if interval_value < 1 or interval_value > 43_200:
            raise BacktestError("intervalMinutes must be between 1 and 43200")

        capital = _as_float(
            _pick(payload, "initialCapital", "initial_capital", "initialBalance", "initial_balance"),
            "initialCapital",
            default=10_000.0,
        )
        if capital <= 0:
            raise BacktestError("initialCapital must be positive")

        fee = _as_float(_pick(payload, "feeBps", "fee_bps"), "feeBps", default=26.0)
        slippage = _as_float(
            _pick(payload, "slippageBps", "slippage_bps"), "slippageBps", default=5.0
        )
        if fee < 0 or slippage < 0:
            raise BacktestError("feeBps and slippageBps must be non-negative")
        if fee > 2_000 or slippage > 2_000:
            raise BacktestError("feeBps and slippageBps above 2000 bps are not supported")

        source = str(_pick(payload, "source", default="payload")).strip().lower()
        if source in {"inline", "candles", "api"}:
            source = "payload"
        if source in {"synthetic", "demo"}:
            source = "sample"
        if source not in {"payload", "sample", "csv", "duckdb"}:
            raise BacktestError("source must be one of payload, sample, csv, duckdb")

        strategy_payload = _pick(payload, "strategy", "strategyConfig")
        if strategy_payload is None:
            strategy_payload = {
                "model": _pick(payload, "model", "strategyModel", default="sma_cross"),
                "params": _pick(payload, "parameters", "params", default={}),
            }
        strategy = StrategySpec.from_payload(strategy_payload)

        allocation = AllocationSpec.from_payload(_pick(payload, "allocation", "portfolio"))
        rebalance = RebalanceSpec.from_payload(_pick(payload, "rebalance", "execution"))

        benchmark_mode = str(
            _pick(payload, "benchmarkMode", "benchmark_mode", default="asset")
        ).lower()
        if benchmark_mode not in {"asset", "equal_weight", "flat", "none"}:
            raise BacktestError("benchmarkMode must be asset, equal_weight or flat")
        benchmark_symbol = _pick(payload, "benchmarkSymbol", "benchmark_symbol", "benchmark")
        if isinstance(benchmark_symbol, Mapping):
            benchmark_symbol = benchmark_symbol.get("symbol")
        if benchmark_symbol:
            benchmark_mode = "asset"

        hard_stop_enabled = _as_bool(
            _pick(payload, "hardStopEnabled", "hard_stop_enabled"), "hardStopEnabled", default=False
        )
        hard_stop_percent = _pick(payload, "hardStopPercent", "hard_stop_percent")
        hard_stop_value = None
        if hard_stop_percent not in (None, "", 0):
            hard_stop_value = _as_float(hard_stop_percent, "hardStopPercent")
            if not (0 < hard_stop_value <= 100):
                raise BacktestError("hardStopPercent must be in (0, 100]")

        periods = _pick(payload, "periodsPerYear", "periods_per_year")
        periods_value = None
        if periods not in (None, "", 0):
            periods_value = _as_int(periods, "periodsPerYear")
            if periods_value < 1:
                raise BacktestError("periodsPerYear must be >= 1")

        sample_bars = _as_int(
            _pick(payload, "sampleBars", "sample_bars", "candleCount", "candle_count", "bars"),
            "sampleBars",
            default=1440,
        )
        if sample_bars < 30:
            raise BacktestError("sampleBars must be at least 30")
        if sample_bars > 200_000:
            raise BacktestError("sampleBars above 200000 is not supported")
        seed = _as_int(_pick(payload, "seed"), "seed", default=42)
        tags = _pick(payload, "tags", default=())
        if isinstance(tags, str):
            tags = tuple(part.strip() for part in tags.split(",") if part.strip())
        else:
            tags = tuple(str(tag) for tag in (tags or ()))

        candles = _pick(payload, "candles", "bars", "ohlcv", "data")
        if candles is not None and not isinstance(candles, (Mapping, Sequence)) or isinstance(candles, str):
            raise BacktestError("candles must be a list of bars or an object keyed by symbol")

        return cls(
            strategy_id=str(_pick(payload, "strategyId", "strategy_id", default="custom")),
            strategy_name=str(
                _pick(payload, "strategyName", "strategy_name", default="QuantJourney Backtest")
            ),
            symbols=symbols,
            interval_minutes=interval_value,
            source=source,
            data_file=_pick(payload, "dataFile", "data_file", "csvPath", "csv_path"),
            start=_pick(payload, "start", "startDate", "start_date", "from"),
            end=_pick(payload, "end", "endDate", "end_date", "to"),
            initial_capital=capital,
            fee_bps=fee,
            slippage_bps=slippage,
            strategy=strategy,
            allocation=allocation,
            rebalance=rebalance,
            benchmark_mode=benchmark_mode,
            benchmark_symbol=str(benchmark_symbol) if benchmark_symbol else None,
            hard_stop_enabled=hard_stop_enabled,
            hard_stop_percent=hard_stop_value,
            periods_per_year=periods_value,
            sample_bars=sample_bars,
            seed=seed,
            persist=_as_bool(payload.get("persist"), "persist", default=True),
            tags=tags,
            candles=candles,
        )

    # ------------------------------------------------------------------
    # derived values
    # ------------------------------------------------------------------
    @property
    def bars_per_day(self) -> float:
        return 24 * 60 / self.interval_minutes

    @property
    def resolved_periods_per_year(self) -> int:
        if self.periods_per_year:
            return self.periods_per_year
        if self.interval_minutes >= 1_440:
            return max(1, int(365 * 1_440 / self.interval_minutes))
        return max(1, int(round(365 * self.bars_per_day)))

    @property
    def run_key(self) -> str:
        return self.fingerprint()

    def fingerprint(self) -> str:
        payload = self.to_dict()
        payload.pop("candles", None)
        payload["data_file"] = self.data_file
        payload["source"] = self.source
        blob = json.dumps(payload, sort_keys=True, default=str)
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload.pop("candles", None)
        payload["symbols"] = list(self.symbols)
        payload["tags"] = list(self.tags)
        payload["hasInlineCandles"] = self.candles is not None
        return payload

    def with_overrides(self, *, strategy_params: Mapping[str, Any] | None = None,
                       fee_bps: float | None = None,
                       slippage_bps: float | None = None) -> "BacktestConfig":
        from dataclasses import replace

        strategy = self.strategy
        if strategy_params is not None:
            merged = {**strategy.params, **dict(strategy_params)}
            strategy = StrategySpec(model=strategy.model, params=merged)
        return replace(
            self,
            strategy=strategy,
            fee_bps=self.fee_bps if fee_bps is None else fee_bps,
            slippage_bps=self.slippage_bps if slippage_bps is None else slippage_bps,
        )


def _expand_grid(grid: Mapping[str, Sequence[Any]], limit: int) -> list[dict[str, Any]]:
    """Cartesian product of a parameter grid, capped deterministically."""

    keys = sorted(grid)
    combinations: list[dict[str, Any]] = [{}]
    for key in keys:
        values = grid[key]
        if values is None:
            continue
        if isinstance(values, (str, bytes)) or not isinstance(values, Sequence):
            values = [values]
        next_combinations: list[dict[str, Any]] = []
        for base in combinations:
            for value in values:
                next_combinations.append({**base, key: value})
                if len(next_combinations) >= limit:
                    break
            if len(next_combinations) >= limit:
                break
        combinations = next_combinations
        if len(combinations) >= limit:
            break
    return combinations[:limit]


@dataclass(frozen=True)
class WalkForwardSpec:
    """Walk-forward geometry and per-fold optimisation settings."""

    scheme: str = "rolling"  # rolling | expanding
    train_bars: int | None = None
    test_bars: int | None = None
    step_bars: int | None = None
    purge_bars: int = 0
    min_train_bars: int | None = None
    train_months: float | None = None
    test_months: float | None = None
    step_months: float | None = None
    objective: str = "sharpe"
    param_grid: dict[str, list[Any]] = field(default_factory=dict)
    max_trials: int = 48
    refit: bool = True
    cost_sensitivity: tuple[float, ...] = (0.0, 5.0, 15.0, 40.0)

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any] | None) -> "WalkForwardSpec":
        payload = dict(payload or {})
        scheme = str(payload.get("scheme") or "rolling").lower()
        if scheme not in {"rolling", "expanding"}:
            raise BacktestError("walk-forward scheme must be rolling or expanding")
        objective = str(payload.get("objective") or "sharpe").lower()
        if objective not in OBJECTIVES:
            raise BacktestError(f"objective must be one of {', '.join(OBJECTIVES)}")
        grid = payload.get("paramGrid", payload.get("param_grid", payload.get("grid", {}))) or {}
        if not isinstance(grid, Mapping):
            raise BacktestError("walk-forward paramGrid must be an object of parameter -> values")
        clean_grid: dict[str, list[Any]] = {}
        for key, values in grid.items():
            if values is None:
                continue
            if isinstance(values, (str, bytes)) or not isinstance(values, Sequence):
                values = [values]
            clean_grid[str(key)] = list(values)
        max_trials = _as_int(payload.get("maxTrials", payload.get("max_trials")), "maxTrials", default=48)
        if max_trials < 1 or max_trials > 2_000:
            raise BacktestError("maxTrials must be between 1 and 2000")
        train_bars = payload.get("trainBars", payload.get("train_bars"))
        test_bars = payload.get("testBars", payload.get("test_bars"))
        step_bars = payload.get("stepBars", payload.get("step_bars"))
        purge_bars = payload.get("purgeBars", payload.get("purge_bars"))
        min_train = payload.get("minTrainBars", payload.get("min_train_bars"))
        train_months = payload.get("trainMonths", payload.get("train_months"))
        test_months = payload.get("testMonths", payload.get("test_months"))
        step_months = payload.get("stepMonths", payload.get("step_months"))
        cost = payload.get("costSensitivityBps", payload.get("cost_sensitivity_bps"))
        if cost is None:
            cost_values = (0.0, 5.0, 15.0, 40.0)
        else:
            cost_values = tuple(_as_float(item, "costSensitivityBps") for item in cost)
        return cls(
            scheme=scheme,
            train_bars=None if train_bars in (None, "", 0) else _as_int(train_bars, "trainBars"),
            test_bars=None if test_bars in (None, "", 0) else _as_int(test_bars, "testBars"),
            step_bars=None if step_bars in (None, "", 0) else _as_int(step_bars, "stepBars"),
            purge_bars=_as_int(purge_bars, "purgeBars", default=0),
            min_train_bars=None if min_train in (None, "", 0) else _as_int(min_train, "minTrainBars"),
            train_months=None if train_months in (None, "", 0) else _as_float(train_months, "trainMonths"),
            test_months=None if test_months in (None, "", 0) else _as_float(test_months, "testMonths"),
            step_months=None if step_months in (None, "", 0) else _as_float(step_months, "stepMonths"),
            objective=objective,
            param_grid=clean_grid,
            max_trials=max_trials,
            refit=_as_bool(payload.get("refit"), "refit", default=True),
            cost_sensitivity=cost_values,
        )

    def resolved_geometry(self, config: BacktestConfig, n_bars: int) -> tuple[int, int, int, int]:
        """Resolve fold geometry to bars for the given data length."""

        bars_per_month = max(1, int(round(config.bars_per_day * 30)))
        train = self.train_bars
        test = self.test_bars
        step = self.step_bars
        if self.train_months:
            train = max(2, int(round(self.train_months * bars_per_month)))
        if self.test_months:
            test = max(1, int(round(self.test_months * bars_per_month)))
        if self.step_months:
            step = max(1, int(round(self.step_months * bars_per_month)))
        if train is None:
            train = max(20, int(round(n_bars * 0.6)))
        if test is None:
            test = max(5, int(round(n_bars * 0.1)))
        if step is None:
            step = test
        min_train = self.min_train_bars or max(10, train // 2)
        if train < 2 or test < 1 or step < 1:
            raise BacktestError("walk-forward windows must be positive")
        if train < min_train:
            train = min_train
        if train + test + self.purge_bars > n_bars:
            raise BacktestError(
                f"insufficient bars for walk-forward: need {train + test + self.purge_bars}, have {n_bars}"
            )
        return train, test, step, self.purge_bars

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["cost_sensitivity_bps"] = list(self.cost_sensitivity)
        return payload


@dataclass(frozen=True)
class OptimizeSpec:
    """Full-sample parameter optimisation settings."""

    objective: str = "sharpe"
    param_grid: dict[str, list[Any]] = field(default_factory=dict)
    max_trials: int = 96

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any] | None) -> "OptimizeSpec":
        payload = dict(payload or {})
        objective = str(payload.get("objective") or "sharpe").lower()
        if objective not in OBJECTIVES:
            raise BacktestError(f"objective must be one of {', '.join(OBJECTIVES)}")
        grid = payload.get("paramGrid", payload.get("param_grid", payload.get("grid", {}))) or {}
        if not isinstance(grid, Mapping):
            raise BacktestError("optimisation paramGrid must be an object of parameter -> values")
        clean: dict[str, list[Any]] = {}
        for key, values in grid.items():
            if values is None:
                continue
            if isinstance(values, (str, bytes)) or not isinstance(values, Sequence):
                values = [values]
            clean[str(key)] = list(values)
        if not clean:
            raise BacktestError("optimisation requires a non-empty paramGrid")
        max_trials = _as_int(payload.get("maxTrials", payload.get("max_trials")), "maxTrials", default=96)
        if max_trials < 1 or max_trials > 2_000:
            raise BacktestError("maxTrials must be between 1 and 2000")
        return cls(objective=objective, param_grid=clean, max_trials=max_trials)

    def expand(self) -> list[dict[str, Any]]:
        return _expand_grid(self.param_grid, self.max_trials)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class StressSpec:
    """Cost stress-test settings."""

    fee_bps: tuple[float, ...] = (0.0, 10.0, 26.0, 50.0)
    slippage_bps: tuple[float, ...] = (0.0, 5.0, 15.0, 40.0)

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any] | None) -> "StressSpec":
        payload = dict(payload or {})

        def parse(values: Any, fallback: tuple[float, ...]) -> tuple[float, ...]:
            if values is None:
                return fallback
            if not isinstance(values, Sequence) or isinstance(values, (str, bytes)):
                values = [values]
            parsed = tuple(_as_float(item, "stress bps") for item in values)
            if not parsed or len(parsed) > 12:
                raise BacktestError("stress grids must contain between 1 and 12 values")
            return parsed

        return cls(
            fee_bps=parse(payload.get("feeBpsGrid", payload.get("fee_bps_grid")), cls.__dataclass_fields__["fee_bps"].default),
            slippage_bps=parse(
                payload.get("slippageBpsGrid", payload.get("slippage_bps_grid")),
                cls.__dataclass_fields__["slippage_bps"].default,
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
