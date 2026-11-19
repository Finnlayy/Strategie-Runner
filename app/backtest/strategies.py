"""Strategy registry: signals and portfolio construction.

The registry translates a declarative model (and its parameters) into a
target-weight matrix.  It covers the strategy families used by
QuantJourney's weights-mode examples — trend, mean reversion, momentum,
cross-sectional rotation, risk parity and volatility targeting — plus a
generic rule model so existing strategy parameters can be expressed without
executing arbitrary user code in the backtest process.

All signals are computed on closed bars and the resulting weights are shifted
by one bar before execution, which removes look-ahead bias.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping

import numpy as np
import pandas as pd

from app.backtest import indicators
from app.backtest.config import AllocationSpec, BacktestError, StrategySpec
from app.backtest.data import CandlePanel

MODELS: list[dict[str, Any]] = [
    {
        "id": "sma_cross",
        "label": "SMA Trend",
        "family": "trend",
        "description": "Long while the fast simple moving average is above the slow average.",
        "params": [
            {"key": "fast", "label": "Fast SMA", "type": "int", "default": 20, "min": 2, "max": 500},
            {"key": "slow", "label": "Slow SMA", "type": "int", "default": 60, "min": 3, "max": 1000},
            {"key": "allow_short", "label": "Allow Short", "type": "bool", "default": False},
        ],
    },
    {
        "id": "ema_cross",
        "label": "EMA Trend",
        "family": "trend",
        "description": "Exponential moving-average crossover with optional shorts.",
        "params": [
            {"key": "fast", "label": "Fast EMA", "type": "int", "default": 12, "min": 2, "max": 500},
            {"key": "slow", "label": "Slow EMA", "type": "int", "default": 48, "min": 3, "max": 1000},
            {"key": "allow_short", "label": "Allow Short", "type": "bool", "default": False},
        ],
    },
    {
        "id": "rsi_reversion",
        "label": "RSI Reversion",
        "family": "mean_reversion",
        "description": "Buy oversold RSI readings and exit once RSI normalises.",
        "params": [
            {"key": "period", "label": "RSI Period", "type": "int", "default": 14, "min": 2, "max": 200},
            {"key": "oversold", "label": "Entry Level", "type": "float", "default": 30, "min": 1, "max": 49},
            {"key": "exit_level", "label": "Exit Level", "type": "float", "default": 55, "min": 51, "max": 99},
        ],
    },
    {
        "id": "macd_trend",
        "label": "MACD Trend",
        "family": "trend",
        "description": "Long when the MACD line is above its signal line.",
        "params": [
            {"key": "fast", "label": "Fast EMA", "type": "int", "default": 12, "min": 2, "max": 200},
            {"key": "slow", "label": "Slow EMA", "type": "int", "default": 26, "min": 3, "max": 400},
            {"key": "signal", "label": "Signal EMA", "type": "int", "default": 9, "min": 2, "max": 200},
            {"key": "allow_short", "label": "Allow Short", "type": "bool", "default": False},
        ],
    },
    {
        "id": "bollinger_reversion",
        "label": "Bollinger Reversion",
        "family": "mean_reversion",
        "description": "Buy lower-band breaks and exit at the middle band.",
        "params": [
            {"key": "period", "label": "Band Period", "type": "int", "default": 20, "min": 3, "max": 300},
            {"key": "num_std", "label": "Std Multiplier", "type": "float", "default": 2.0, "min": 0.5, "max": 5},
        ],
    },
    {
        "id": "momentum",
        "label": "Time-Series Momentum",
        "family": "momentum",
        "description": "Hold while the lookback return exceeds a threshold.",
        "params": [
            {"key": "lookback", "label": "Lookback Bars", "type": "int", "default": 48, "min": 2, "max": 1000},
            {"key": "threshold", "label": "Entry Return", "type": "float", "default": 0.0, "min": -0.5, "max": 0.5},
            {"key": "allow_short", "label": "Allow Short", "type": "bool", "default": False},
        ],
    },
    {
        "id": "donchian_breakout",
        "label": "Donchian Breakout",
        "family": "breakout",
        "description": "Enter on a new N-bar high, exit on a new M-bar low.",
        "params": [
            {"key": "entry_window", "label": "Entry Window", "type": "int", "default": 55, "min": 3, "max": 500},
            {"key": "exit_window", "label": "Exit Window", "type": "int", "default": 20, "min": 2, "max": 500},
        ],
    },
    {
        "id": "cross_sectional_momentum",
        "label": "Cross-Sectional Momentum",
        "family": "rotation",
        "description": "Rotate into the strongest symbols by lookback return.",
        "params": [
            {"key": "lookback", "label": "Lookback Bars", "type": "int", "default": 96, "min": 2, "max": 2000},
            {"key": "top_n", "label": "Top N", "type": "int", "default": 2, "min": 1, "max": 50},
            {"key": "hold_bars", "label": "Hold Bars", "type": "int", "default": 24, "min": 1, "max": 2000},
            {"key": "allow_short", "label": "Long / Short", "type": "bool", "default": False},
        ],
    },
    {
        "id": "inverse_volatility",
        "label": "Inverse Volatility",
        "family": "risk",
        "description": "Always invested, weighted by the inverse of realised volatility.",
        "params": [
            {"key": "vol_window", "label": "Vol Window", "type": "int", "default": 20, "min": 2, "max": 500},
        ],
    },
    {
        "id": "risk_parity",
        "label": "Risk Parity",
        "family": "risk",
        "description": "Equal risk contribution proxy using inverse volatility weights.",
        "params": [
            {"key": "vol_window", "label": "Vol Window", "type": "int", "default": 30, "min": 2, "max": 500},
        ],
    },
    {
        "id": "vol_target_trend",
        "label": "Volatility-Target Trend",
        "family": "trend",
        "description": "SMA trend exposure scaled to an annualised volatility target.",
        "params": [
            {"key": "fast", "label": "Fast SMA", "type": "int", "default": 20, "min": 2, "max": 500},
            {"key": "slow", "label": "Slow SMA", "type": "int", "default": 60, "min": 3, "max": 1000},
            {"key": "target_vol", "label": "Target Vol", "type": "float", "default": 0.25, "min": 0.01, "max": 2},
            {"key": "vol_window", "label": "Vol Window", "type": "int", "default": 30, "min": 2, "max": 500},
        ],
    },
    {
        "id": "buy_hold",
        "label": "Buy & Hold",
        "family": "benchmark",
        "description": "Fully invested equal-weight buy-and-hold basket.",
        "params": [],
    },
    {
        "id": "weights",
        "label": "Static Weights",
        "family": "custom",
        "description": "Explicit target weights per symbol, rebalanced by policy.",
        "params": [
            {"key": "weights", "label": "Weights", "type": "json", "default": {}},
        ],
    },
    {
        "id": "rule",
        "label": "Rule Builder",
        "family": "custom",
        "description": "Entry/exit rule pairs over price, SMA, EMA, RSI, MACD, Bollinger or ROC operands.",
        "params": [
            {
                "key": "entry",
                "label": "Entry Rule",
                "type": "json",
                "default": {"left": "close", "op": ">", "right": "sma(50)"},
            },
            {
                "key": "exit",
                "label": "Exit Rule",
                "type": "json",
                "default": {"left": "close", "op": "<", "right": "sma(50)"},
            },
            {"key": "allow_short", "label": "Allow Short", "type": "bool", "default": False},
        ],
    },
]

MODEL_IDS = {model["id"] for model in MODELS}

DEFAULT_PARAMS: dict[str, dict[str, Any]] = {
    model["id"]: {param["key"]: param["default"] for param in model["params"]} for model in MODELS
}

_OPERATORS = {
    ">": lambda left, right: left > right,
    ">=": lambda left, right: left >= right,
    "<": lambda left, right: left < right,
    "<=": lambda left, right: left <= right,
    "cross_above": lambda left, right: (left > right) & (left.shift(1) <= right.shift(1)),
    "cross_below": lambda left, right: (left < right) & (left.shift(1) >= right.shift(1)),
}


@dataclass
class StrategyBuild:
    weights: pd.DataFrame
    signals: pd.DataFrame
    model: str
    params: dict[str, Any]
    diagnostics: dict[str, Any]


def resolve_params(spec: StrategySpec) -> dict[str, Any]:
    """Merge defaults with user parameters and coerce to declared types."""

    model = spec.model
    if model not in DEFAULT_PARAMS:
        raise BacktestError(f"unknown strategy model {model!r}")
    params = dict(DEFAULT_PARAMS[model])
    for key, value in spec.params.items():
        if key in {"model", "name", "type", "params"}:
            continue
        params[str(key)] = value

    declared = {param["key"]: param for model_def in MODELS if model_def["id"] == model for param in model_def["params"]}
    for key, meta in declared.items():
        if key not in params:
            continue
        value = params[key]
        if meta["type"] == "bool":
            params[key] = _coerce_bool(value)
        elif meta["type"] in {"int", "float"}:
            number = _coerce_number(value, f"{model}.{key}")
            if meta["type"] == "int":
                number = int(round(number))
            low, high = meta.get("min"), meta.get("max")
            if low is not None and number < low:
                raise BacktestError(f"{model}.{key} must be >= {low}")
            if high is not None and number > high:
                raise BacktestError(f"{model}.{key} must be <= {high}")
            params[key] = number
        elif meta["type"] == "json":
            if isinstance(value, str):
                import json

                try:
                    params[key] = json.loads(value)
                except Exception as exc:
                    raise BacktestError(f"{model}.{key} must be valid JSON") from exc
            if not isinstance(params[key], (dict, list)):
                raise BacktestError(f"{model}.{key} must be an object")

    if model in {"sma_cross", "ema_cross", "vol_target_trend"}:
        if params["fast"] >= params["slow"]:
            raise BacktestError(f"{model}: fast period must be smaller than slow period")
    if model == "macd_trend":
        if params["fast"] >= params["slow"]:
            raise BacktestError("macd_trend: fast period must be smaller than slow period")
    if model == "rsi_reversion":
        if params["oversold"] >= params["exit_level"]:
            raise BacktestError("rsi_reversion: entry level must be below exit level")
    return params


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _coerce_number(value: Any, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise BacktestError(f"{name} must be numeric") from exc
    if not math.isfinite(number):
        raise BacktestError(f"{name} must be finite")
    return number


def _state_machine(entry: pd.Series, exit_: pd.Series, allow_short: bool = False) -> pd.Series:
    """Hold a position between entry and exit triggers."""

    entry_values = entry.fillna(False).to_numpy(dtype=bool)
    exit_values = exit_.fillna(False).to_numpy(dtype=bool)
    out = np.zeros(len(entry_values), dtype=float)
    state = 0.0
    for i in range(len(entry_values)):
        if state == 0.0:
            if entry_values[i]:
                state = 1.0
            elif allow_short and bool(exit_values[i]):
                # For short-capable models the caller passes the short entry
                # condition through ``exit_`` with an explicit marker.
                state = -1.0
        elif state == 1.0:
            if exit_values[i]:
                state = 0.0
        elif state == -1.0:
            if entry_values[i]:
                state = 0.0
        out[i] = state
    return pd.Series(out, index=entry.index)


def _two_sided_state(entry_long: pd.Series, entry_short: pd.Series, exit_long: pd.Series, exit_short: pd.Series) -> pd.Series:
    """Long/short state machine with independent entry and exit rules."""

    el = entry_long.fillna(False).to_numpy(dtype=bool)
    es = entry_short.fillna(False).to_numpy(dtype=bool)
    xl = exit_long.fillna(False).to_numpy(dtype=bool)
    xs = exit_short.fillna(False).to_numpy(dtype=bool)
    out = np.zeros(len(el), dtype=float)
    state = 0.0
    for i in range(len(el)):
        if state == 0.0:
            if el[i] and not es[i]:
                state = 1.0
            elif es[i] and not el[i]:
                state = -1.0
        elif state > 0:
            if xl[i] or es[i]:
                state = 0.0
        else:
            if xs[i] or el[i]:
                state = 0.0
        out[i] = state
    return pd.Series(out, index=entry_long.index)


def _apply_hard_stop(
    signal: pd.Series,
    price: pd.Series,
    stop_percent: float | None,
) -> pd.Series:
    """Flatten a position after an adverse move and wait for a fresh signal."""

    if not stop_percent or stop_percent <= 0:
        return signal
    values = signal.fillna(0.0).to_numpy(dtype=float)
    prices = price.astype(float).to_numpy()
    out = values.copy()
    state = 0.0
    entry_price = 0.0
    blocked = False
    for i, raw in enumerate(values):
        if state == 0.0:
            if raw != 0.0:
                state = raw
                entry_price = prices[i]
                blocked = False
            out[i] = 0.0
            continue
        if raw == 0.0:
            state = 0.0
            out[i] = 0.0
            blocked = False
            continue
        if raw != state:
            state = raw
            entry_price = prices[i]
            out[i] = state
            continue
        change = prices[i] / entry_price - 1.0 if entry_price else 0.0
        adverse = (-change) if state > 0 else change
        if adverse >= stop_percent:
            state = 0.0
            blocked = True
            out[i] = 0.0
        else:
            out[i] = state
    return pd.Series(out, index=signal.index)


def compute_signals(panel: CandlePanel, spec: StrategySpec) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Return a symbol -> {-1, 0, 1} signal frame and build diagnostics."""

    model = spec.model
    params = resolve_params(spec)
    close = panel.close
    signals = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    diagnostics: dict[str, Any] = {"model": model, "params": params, "tiEngine": indicators.ti_engine()}

    allow_short = bool(params.get("allow_short"))
    long_short_alloc = False

    if model in {"sma_cross", "ema_cross"}:
        average = indicators.sma if model == "sma_cross" else indicators.ema
        for symbol in close.columns:
            price = close[symbol]
            fast = average(price, int(params["fast"]))
            slow = average(price, int(params["slow"]))
            valid = fast.notna() & slow.notna()
            long_entry = (fast > slow) & valid
            long_exit = (fast < slow) & valid
            if allow_short:
                signals[symbol] = _two_sided_state(long_entry, long_exit, long_exit, long_entry)
            else:
                signals[symbol] = _state_machine(long_entry, long_exit)

    elif model == "rsi_reversion":
        for symbol in close.columns:
            price = close[symbol]
            values = indicators.rsi(price, int(params["period"]))
            entry = (values < float(params["oversold"])).fillna(False)
            exit_ = (values > float(params["exit_level"])).fillna(False)
            signals[symbol] = _state_machine(entry, exit_)

    elif model == "macd_trend":
        for symbol in close.columns:
            frame = indicators.macd(
                close[symbol],
                int(params["fast"]),
                int(params["slow"]),
                int(params["signal"]),
            )
            valid = frame["macd"].notna() & frame["signal"].notna()
            long_entry = (frame["macd"] > frame["signal"]) & valid
            long_exit = (frame["macd"] < frame["signal"]) & valid
            if allow_short:
                signals[symbol] = _two_sided_state(long_entry, long_exit, long_exit, long_entry)
            else:
                signals[symbol] = _state_machine(long_entry, long_exit)

    elif model == "bollinger_reversion":
        for symbol in close.columns:
            price = close[symbol]
            bands = indicators.bollinger(price, int(params["period"]), float(params["num_std"]))
            entry = (price < bands["lower"]).fillna(False)
            exit_ = ((price > bands["middle"]) | price.isna()).fillna(False)
            signals[symbol] = _state_machine(entry, exit_)

    elif model == "momentum":
        for symbol in close.columns:
            price = close[symbol]
            values = indicators.roc(price, int(params["lookback"]))
            threshold = float(params["threshold"])
            long_entry = (values > threshold).fillna(False)
            long_exit = (values < 0).fillna(False)
            if allow_short:
                signals[symbol] = _two_sided_state(long_entry, long_exit, long_exit, long_entry)
            else:
                signals[symbol] = _state_machine(long_entry, long_exit)

    elif model == "donchian_breakout":
        for symbol in close.columns:
            price = close[symbol]
            entry = (price > indicators.rolling_high(price, int(params["entry_window"]))).fillna(False)
            exit_ = (price < indicators.rolling_low(price, int(params["exit_window"]))).fillna(False)
            signals[symbol] = _state_machine(entry, exit_)

    elif model == "cross_sectional_momentum":
        lookback = int(params["lookback"])
        top_n = min(int(params["top_n"]), len(close.columns))
        hold_bars = max(1, int(params["hold_bars"]))
        score = close.pct_change(lookback, fill_method=None)
        ranks = score.rank(axis=1, ascending=False)
        selection = pd.DataFrame(0.0, index=close.index, columns=close.columns)
        for i in range(0, len(close), hold_bars):
            row = ranks.iloc[i]
            valid = row.dropna()
            if valid.empty:
                continue
            chosen = valid.nsmallest(top_n).index
            selection.iloc[i : i + hold_bars, :] = 0.0
            selection.loc[selection.index[i : i + hold_bars], chosen] = 1.0
            if allow_short and len(valid) > top_n:
                shorts = valid.nlargest(min(top_n, len(valid) - top_n)).index
                selection.loc[selection.index[i : i + hold_bars], shorts] = -1.0
        signals = selection

    elif model in {"inverse_volatility", "risk_parity"}:
        signals[:] = 1.0

    elif model == "vol_target_trend":
        for symbol in close.columns:
            price = close[symbol]
            fast = indicators.sma(price, int(params["fast"]))
            slow = indicators.sma(price, int(params["slow"]))
            valid = fast.notna() & slow.notna()
            signals[symbol] = _state_machine((fast > slow) & valid, (fast < slow) & valid)
        diagnostics["volTarget"] = float(params["target_vol"])
        diagnostics["volWindow"] = int(params["vol_window"])

    elif model == "buy_hold":
        signals[:] = 1.0

    elif model == "weights":
        weights = params.get("weights") or {}
        if not isinstance(weights, Mapping) or not weights:
            raise BacktestError("weights model requires a non-empty weights object")
        unknown = sorted(set(str(k).upper() for k in weights) - set(close.columns))
        if unknown:
            raise BacktestError(f"static weights reference unknown symbols: {', '.join(unknown)}")
        diagnostics["staticWeights"] = {str(k).upper(): float(v) for k, v in weights.items()}
        signals[:] = 0.0
        for symbol, weight in diagnostics["staticWeights"].items():
            signals[symbol] = 1.0 if weight >= 0 else -1.0
        long_short_alloc = True

    elif model == "rule":
        for symbol in close.columns:
            entry_rule = params.get("entry") or {}
            exit_rule = params.get("exit") or {}
            if not isinstance(entry_rule, Mapping) or not isinstance(exit_rule, Mapping):
                raise BacktestError("rule model entry/exit must be objects")
            entry = _evaluate_rule(entry_rule, panel, symbol)
            exit_ = _evaluate_rule(exit_rule, panel, symbol)
            if allow_short:
                signals[symbol] = _two_sided_state(entry, exit_, exit_, entry)
            else:
                signals[symbol] = _state_machine(entry, exit_)
    else:  # pragma: no cover - config validates the model already
        raise BacktestError(f"unsupported strategy model {model!r}")

    if panel.close.isna().any().any():
        signals = signals.where(panel.close.notna(), 0.0)

    diagnostics["longShort"] = bool(allow_short or long_short_alloc)
    diagnostics["signalCoverage"] = float((signals != 0).mean().mean() * 100) if len(signals) else 0.0
    return signals.fillna(0.0).astype(float), diagnostics


def _resolve_operand(name: Any, panel: CandlePanel, symbol: str) -> pd.Series:
    if isinstance(name, (int, float)):
        return pd.Series(float(name), index=panel.index)
    text = str(name).strip().lower()
    price = panel.close[symbol]
    if text in {"close", "price", "c"}:
        return price
    if text in {"open", "o"}:
        return panel.open[symbol]
    if text in {"high", "h"}:
        return panel.high[symbol]
    if text in {"low", "l"}:
        return panel.low[symbol]
    if text in {"volume", "v"}:
        return panel.volume[symbol]
    if text.startswith(("sma(", "ema(", "rsi(", "roc(", "bb_upper(", "bb_lower(", "bb_middle(")):
        head, _, rest = text.partition("(")
        argument = rest.rstrip(")")
        try:
            period = int(float(argument))
        except ValueError as exc:
            raise BacktestError(f"invalid indicator period in {name!r}") from exc
        if head == "sma":
            return indicators.sma(price, period)
        if head == "ema":
            return indicators.ema(price, period)
        if head == "rsi":
            return indicators.rsi(price, period)
        if head == "roc":
            return indicators.roc(price, period)
        bands = indicators.bollinger(price, period)
        if head == "bb_upper":
            return bands["upper"]
        if head == "bb_lower":
            return bands["lower"]
        return bands["middle"]
    if text in {"macd", "macd_line", "macd_signal", "macd_hist"}:
        frame = indicators.macd(price)
        return frame["macd"] if text in {"macd", "macd_line"} else frame["histogram" if text == "macd_hist" else "signal"]
    raise BacktestError(f"unknown rule operand {name!r}")


def _evaluate_rule(rule: Mapping[str, Any], panel: CandlePanel, symbol: str) -> pd.Series:
    left = _resolve_operand(rule.get("left", "close"), panel, symbol)
    right = _resolve_operand(rule.get("right", "sma(50)"), panel, symbol)
    if not isinstance(left, pd.Series):
        left = pd.Series(float(left), index=panel.index)
    if not isinstance(right, pd.Series):
        right = pd.Series(float(right), index=panel.index)
    operator = str(rule.get("op") or rule.get("operator") or ">").strip().lower()
    if operator not in _OPERATORS:
        raise BacktestError(f"unsupported rule operator {operator!r}")
    result = _OPERATORS[operator](left, right)
    return result.fillna(False).astype(bool)


def build_target_weights(
    panel: CandlePanel,
    spec: StrategySpec,
    allocation: AllocationSpec,
    hard_stop_percent: float | None = None,
) -> StrategyBuild:
    """Compute target portfolio weights with a one-bar execution delay."""

    signals, diagnostics = compute_signals(panel, spec)
    close = panel.close
    symbols = list(close.columns)

    if spec.model == "weights" and diagnostics.get("staticWeights"):
        base = pd.DataFrame(0.0, index=close.index, columns=symbols)
        for symbol, weight in diagnostics["staticWeights"].items():
            base[symbol] = weight
        weights = base.clip(-1.0, 1.0)
        shifted = weights.shift(1).fillna(0.0)
        diagnostics["grossExposure"] = float(shifted.abs().sum(axis=1).mean())
        return StrategyBuild(shifted, signals, spec.model, diagnostics["params"], diagnostics)

    if hard_stop_percent:
        stopped = pd.DataFrame(0.0, index=close.index, columns=symbols)
        for symbol in symbols:
            stopped[symbol] = _apply_hard_stop(signals[symbol], close[symbol], hard_stop_percent)
        signals = stopped
        diagnostics["hardStopPercent"] = hard_stop_percent

    weights = allocate_weights(panel, signals, allocation, diagnostics["params"])
    weights = weights.clip(lower=-allocation.max_position_size, upper=allocation.max_position_size)
    gross = weights.abs().sum(axis=1)
    over = gross > allocation.gross_exposure
    if over.any():
        scale = allocation.gross_exposure / gross[over]
        weights.loc[over] = weights.loc[over].mul(scale, axis=0)
    effective_target = allocation.vol_target
    if effective_target is None and spec.model == "vol_target_trend":
        effective_target = float(diagnostics["params"].get("target_vol") or 0.0) or None
    if effective_target:
        import dataclasses

        weights = _apply_vol_target(weights, panel, dataclasses.replace(allocation, vol_target=effective_target))
    shifted = weights.shift(1).fillna(0.0)
    diagnostics["grossExposure"] = float(shifted.abs().sum(axis=1).mean())
    diagnostics["netExposure"] = float(shifted.sum(axis=1).mean())
    return StrategyBuild(shifted, signals, spec.model, diagnostics["params"], diagnostics)


def allocate_weights(
    panel: CandlePanel,
    signals: pd.DataFrame,
    allocation: AllocationSpec,
    params: Mapping[str, Any] | None = None,
) -> pd.DataFrame:
    symbols = list(signals.columns)
    close = panel.close
    long_active = signals > 0
    short_active = signals < 0
    long_count = long_active.sum(axis=1).replace(0, np.nan)
    short_count = short_active.sum(axis=1).replace(0, np.nan)

    if allocation.method == "fixed_fraction":
        weights = signals.abs() * allocation.max_position_size
        weights = weights.where(signals != 0, 0.0)
        if allocation.long_short:
            weights = weights.where(signals >= 0, weights * -1.0)
        return weights.fillna(0.0)

    if allocation.method in {"inverse_volatility", "signal_weighted"}:
        params = params or {}
        vol_window = int(params.get("vol_window", params.get("volWindow", 20)) or 20)
        vol = close.pct_change(fill_method=None).rolling(vol_window, min_periods=2).std(ddof=0)
        inverse = (1.0 / vol.replace(0.0, np.nan)).replace([np.inf, -np.inf], np.nan)
        long_denominator = inverse.where(long_active).sum(axis=1).replace(0, np.nan)
        long_weights = inverse.where(long_active).div(long_denominator, axis=0)
        weights = long_weights.fillna(0.0)
        if allocation.long_short or (signals < 0).any().any():
            short_denominator = inverse.where(short_active).sum(axis=1).replace(0, np.nan)
            short_weights = inverse.where(short_active).div(short_denominator, axis=0)
            weights = weights - short_weights.fillna(0.0)
        if allocation.method == "signal_weighted":
            weights = weights * signals.abs()
        return weights

    # equal weight (default)
    long_weights = long_active.div(long_count, axis=0).fillna(0.0)
    weights = long_weights
    if allocation.long_short:
        short_weights = short_active.div(short_count, axis=0).fillna(0.0)
        weights = long_weights - short_weights
    return weights


def _apply_vol_target(
    weights: pd.DataFrame,
    panel: CandlePanel,
    allocation: AllocationSpec,
) -> pd.DataFrame:
    """Scale gross exposure towards an ex-ante annualised volatility target."""

    target = float(allocation.vol_target or 0)
    if target <= 0:
        return weights
    returns = panel.close.pct_change(fill_method=None)
    window = 30
    covariance = returns.rolling(window, min_periods=max(3, window // 2)).cov()
    estimates = []
    for position in range(len(weights)):
        timestamp = weights.index[position]
        try:
            block = covariance.loc[timestamp].reindex(index=weights.columns, columns=weights.columns)
            vector = weights.iloc[position].to_numpy(dtype=float)
            variance = float(vector @ block.fillna(0.0).to_numpy(dtype=float) @ vector)
            estimates.append(math.sqrt(max(variance, 0.0)) * math.sqrt(365 * 24 * 60 / max(1, panel.interval_minutes)))
        except Exception:
            estimates.append(float("nan"))
    estimate = pd.Series(estimates, index=weights.index)
    scale = (target / estimate.replace(0.0, np.nan)).clip(lower=0.0, upper=4.0).fillna(0.0)
    scaled = weights.mul(scale, axis=0)
    gross = scaled.abs().sum(axis=1)
    over = gross > allocation.gross_exposure
    if over.any():
        scaled.loc[over] = scaled.loc[over].mul(allocation.gross_exposure / gross[over], axis=0)
    return scaled.fillna(0.0)
