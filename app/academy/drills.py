"""
Academy Synthetic Drills & Graduation Gate Engine (Modul 7: 07_DRILLS_STRESS_GATEKEEPER).
Implements the 5 mandatory stress drills (DR-01 to DR-05) and strict 85/100 composite scorecard
required for strategy graduation to the Shadow-Queue.
"""

from datetime import datetime, timedelta, timezone
from enum import Enum
import math
import random
from typing import Any, Dict, List, Optional, Tuple

from app.core.directives import ExecutionPath, system_directive
from app.regime.dfa_engine import dfa_engine
from app.registry.career_log import career_logger
from app.registry.identity import BadgeType, CareerEventType, LifecycleStatus
from app.registry.registry_service import strategy_registry


class DrillId(str, Enum):
    DR_01_FLASH_CRASH = "DR-01"           # Flash crash cascade (-25% collapse, liquidation hunt)
    DR_02_MEAN_REVERSION = "DR-02"        # Extreme Mean-Reversion Chop (Hurst < 0.35)
    DR_03_PARABOLIC_TREND = "DR-03"       # Parabolic Blow-off Top (Hurst > 0.70)
    DR_04_LIQUIDITY_SQUEEZE = "DR-04"     # Liquidity squeeze, spread widening & gap shocks
    DR_05_BLACK_SWAN_VOL = "DR-05"        # Black swan volatility cluster (GARCH/jump diffusion)


DrillScenarioType = DrillId


class DrillScenarioGenerator:
    """Generates synthetic, mathematically structured extreme market scenarios."""

    @staticmethod
    def generate_dr01_flash_crash(
        symbol: str = "BTC/USD",
        bars: int = 160,
        crash_start_bar: int = 45,
        crash_depth_pct: float = 0.25,
        base_price: float = 65000.0
    ) -> List[Dict[str, Any]]:
        """DR-01: Flash Crash Cascade (-25% drop in 15 bars, liquidation hunt)."""
        candles: List[Dict[str, Any]] = []
        now = datetime.now(timezone.utc) - timedelta(minutes=bars)
        price = base_price

        for i in range(bars):
            t = now + timedelta(minutes=i)
            if i < crash_start_bar:
                ret = 0.0001 * (random.random() - 0.5) + 0.001 * random.gauss(0, 1)
                vol = 15.0 + random.random() * 10.0
            elif i < crash_start_bar + 15:
                step_drop = crash_depth_pct / 15.0
                ret = -step_drop - abs(random.gauss(0, 0.006))
                vol = 150.0 + random.random() * 90.0
            elif i < crash_start_bar + 40:
                ret = 0.004 * math.sin((i - crash_start_bar) * 0.5) + random.gauss(0, 0.007)
                vol = 60.0 + random.random() * 30.0
            else:
                ret = 0.0003 * random.gauss(0, 1)
                vol = 25.0 + random.random() * 15.0

            open_p = price
            close_p = max(1.0, open_p * math.exp(ret))
            high_p = max(open_p, close_p) * (1.0 + abs(random.gauss(0, 0.003 if i >= crash_start_bar else 0.0005)))
            low_p = min(open_p, close_p) * (1.0 - abs(random.gauss(0, 0.005 if i >= crash_start_bar else 0.0005)))
            trades = int(max(5, vol * 30))
            vwap = (open_p + high_p + low_p + close_p) / 4.0

            candles.append({
                "timestamp": t.isoformat(),
                "symbol": symbol,
                "open": round(open_p, 4),
                "high": round(high_p, 4),
                "low": round(low_p, 4),
                "close": round(close_p, 4),
                "volume": round(vol * (base_price / 1000.0), 2),
                "trades_count": trades,
                "vwap": round(vwap, 4)
            })
            price = close_p

        return candles

    @staticmethod
    def generate_dr02_mean_reversion(
        symbol: str = "BTC/USD",
        bars: int = 180,
        base_price: float = 65000.0
    ) -> List[Dict[str, Any]]:
        """DR-02: Extreme Mean-Reversion Chop (Hurst < 0.35)."""
        candles: List[Dict[str, Any]] = []
        now = datetime.now(timezone.utc) - timedelta(minutes=bars)
        price = base_price
        center_price = base_price

        for i in range(bars):
            t = now + timedelta(minutes=i)
            deviation = (price - center_price) / center_price
            mean_reverting_pull = -0.42 * deviation
            noise = 0.004 * random.gauss(0, 1)
            ret = mean_reverting_pull + noise

            open_p = price
            close_p = open_p * math.exp(ret)
            high_p = max(open_p, close_p) * (1.0 + abs(random.gauss(0, 0.0025)))
            low_p = min(open_p, close_p) * (1.0 - abs(random.gauss(0, 0.0025)))
            vol = 30.0 + abs(deviation) * 500.0
            trades = int(max(10, vol * 20))
            vwap = (open_p + high_p + low_p + close_p) / 4.0

            candles.append({
                "timestamp": t.isoformat(),
                "symbol": symbol,
                "open": round(open_p, 4),
                "high": round(high_p, 4),
                "low": round(low_p, 4),
                "close": round(close_p, 4),
                "volume": round(vol * (base_price / 1000.0), 2),
                "trades_count": trades,
                "vwap": round(vwap, 4)
            })
            price = close_p

        return candles

    @staticmethod
    def generate_dr03_parabolic_trend(
        symbol: str = "BTC/USD",
        bars: int = 170,
        base_price: float = 65000.0
    ) -> List[Dict[str, Any]]:
        """DR-03: Parabolic Blow-off Top (Hurst > 0.70)."""
        candles: List[Dict[str, Any]] = []
        now = datetime.now(timezone.utc) - timedelta(minutes=bars)
        price = base_price
        inflection = 110

        for i in range(bars):
            t = now + timedelta(minutes=i)
            if i < inflection:
                surge = 0.0035 * (1.0 + (i / float(inflection)) ** 2.0)
                ret = surge + 0.001 * random.gauss(0, 1)
                vol = 20.0 + (i / float(inflection)) * 90.0
            else:
                ret = -0.018 - abs(random.gauss(0, 0.006))
                vol = 160.0 + random.random() * 70.0

            open_p = price
            close_p = open_p * math.exp(ret)
            high_p = max(open_p, close_p) * (1.0 + abs(random.gauss(0, 0.003)))
            low_p = min(open_p, close_p) * (1.0 - abs(random.gauss(0, 0.003)))
            trades = int(max(15, vol * 25))
            vwap = (open_p + high_p + low_p + close_p) / 4.0

            candles.append({
                "timestamp": t.isoformat(),
                "symbol": symbol,
                "open": round(open_p, 4),
                "high": round(high_p, 4),
                "low": round(low_p, 4),
                "close": round(close_p, 4),
                "volume": round(vol * (base_price / 1000.0), 2),
                "trades_count": trades,
                "vwap": round(vwap, 4)
            })
            price = close_p

        return candles

    @staticmethod
    def generate_dr04_liquidity_squeeze(
        symbol: str = "BTC/USD",
        bars: int = 150,
        base_price: float = 65000.0
    ) -> List[Dict[str, Any]]:
        """DR-04: Liquidity Squeeze & Spread Spikes."""
        candles: List[Dict[str, Any]] = []
        now = datetime.now(timezone.utc) - timedelta(minutes=bars)
        price = base_price

        for i in range(bars):
            t = now + timedelta(minutes=i)
            gap = 0.008 * (random.random() - 0.5) if (i % 10 == 0) else 0.0
            ret = gap + 0.002 * random.gauss(0, 1)

            open_p = price * (1.0 + gap)
            close_p = open_p * math.exp(ret)
            high_p = max(open_p, close_p) * (1.0 + abs(random.gauss(0, 0.009)))
            low_p = min(open_p, close_p) * (1.0 - abs(random.gauss(0, 0.009)))
            vol = 8.0 + random.random() * 15.0
            trades = int(max(5, vol * 8))
            vwap = (open_p + high_p + low_p + close_p) / 4.0

            candles.append({
                "timestamp": t.isoformat(),
                "symbol": symbol,
                "open": round(open_p, 4),
                "high": round(high_p, 4),
                "low": round(low_p, 4),
                "close": round(close_p, 4),
                "volume": round(vol * (base_price / 1000.0), 2),
                "trades_count": trades,
                "vwap": round(vwap, 4)
            })
            price = close_p

        return candles

    @staticmethod
    def generate_dr05_black_swan(
        symbol: str = "BTC/USD",
        bars: int = 150,
        base_price: float = 65000.0
    ) -> List[Dict[str, Any]]:
        """DR-05: Black Swan Volatility Cluster (Jump-Diffusion & GARCH clustering)."""
        candles: List[Dict[str, Any]] = []
        now = datetime.now(timezone.utc) - timedelta(minutes=bars)
        price = base_price
        cur_sigma = 0.002

        for i in range(bars):
            t = now + timedelta(minutes=i)
            # GARCH(1,1) dynamic volatility updating
            shock = random.gauss(0, 1)
            is_jump = (i == 50 or i == 85)
            jump_size = -0.12 if i == 50 else 0.08
            ret = cur_sigma * shock + (jump_size if is_jump else 0.0)

            # Vol clustering
            cur_sigma = math.sqrt(0.000005 + 0.15 * (ret ** 2) + 0.80 * (cur_sigma ** 2))

            open_p = price
            close_p = max(1.0, open_p * math.exp(ret))
            high_p = max(open_p, close_p) * (1.0 + abs(random.gauss(0, cur_sigma * 1.5)))
            low_p = min(open_p, close_p) * (1.0 - abs(random.gauss(0, cur_sigma * 1.5)))
            vol = 50.0 + cur_sigma * 10000.0
            trades = int(max(10, vol * 20))
            vwap = (open_p + high_p + low_p + close_p) / 4.0

            candles.append({
                "timestamp": t.isoformat(),
                "symbol": symbol,
                "open": round(open_p, 4),
                "high": round(high_p, 4),
                "low": round(low_p, 4),
                "close": round(close_p, 4),
                "volume": round(vol * (base_price / 1000.0), 2),
                "trades_count": trades,
                "vwap": round(vwap, 4)
            })
            price = close_p

        return candles


class DrillEvaluator:
    """Evaluates strategy genomes against the 5 mandatory stress drills."""

    def __init__(self):
        self.generator = DrillScenarioGenerator()

    def simulate_strategy_on_candles(
        self,
        params: Dict[str, Any],
        candles: List[Dict[str, Any]],
        initial_capital: float = 10000.0,
        fee_pct: float = 0.0026,
        slippage_pct: float = 0.0005
    ) -> Dict[str, Any]:
        """Executes full trade simulation with ATR discipline and position management."""
        if len(candles) < 15:
            return {"pnl_pct": 0.0, "max_drawdown_pct": 0.0, "trades": [], "score": 50.0}

        fast_period = int(params.get("trendFastEma") or params.get("fastEma") or 12)
        slow_period = int(params.get("trendSlowEma") or params.get("slowEma") or 36)
        atr_period = int(params.get("atrPeriod") or 14)
        stop_atr = float(params.get("atrStopMultiplier") or params.get("stopAtr") or 2.0)
        tp_atr = float(params.get("atrTakeProfitMultiplier") or params.get("targetAtr") or 3.5)
        use_fvg = bool(params.get("useFvgFilter", True))
        use_cisd = bool(params.get("useCisdFilter", True))

        capital = initial_capital
        peak_capital = initial_capital
        max_drawdown_pct = 0.0
        position: Optional[Dict[str, Any]] = None
        trades: List[Dict[str, Any]] = []
        equity_curve: List[float] = [capital]

        close_prices = [c["close"] for c in candles]

        for i in range(len(candles)):
            curr_candle = candles[i]
            price = curr_candle["close"]
            high = curr_candle["high"]
            low = curr_candle["low"]

            if i < max(slow_period, atr_period) + 2:
                equity_curve.append(capital)
                continue

            # ATR
            tr_sum = sum(
                max(
                    candles[k]["high"] - candles[k]["low"],
                    abs(candles[k]["high"] - candles[k - 1]["close"]),
                    abs(candles[k]["low"] - candles[k - 1]["close"])
                )
                for k in range(i - atr_period + 1, i + 1)
            )
            atr = max(price * 0.001, tr_sum / atr_period)

            # EMAs
            fast_ema = sum(close_prices[i - fast_period : i]) / fast_period
            slow_ema = sum(close_prices[i - slow_period : i]) / slow_period

            # Manage existing position
            if position is not None:
                side = position["side"]
                entry_p = position["entry_price"]
                qty = position["qty"]
                bars_held = i - position["entry_bar"]

                stop_price = entry_p - stop_atr * atr if side == "long" else entry_p + stop_atr * atr
                tp_price = entry_p + tp_atr * atr if side == "long" else entry_p - tp_atr * atr

                closed = False
                exit_price = price
                exit_reason = "TIME_EXPIRY"

                if side == "long":
                    if low <= stop_price:
                        exit_price = stop_price * (1.0 - slippage_pct)
                        exit_reason = "STOP_LOSS"
                        closed = True
                    elif high >= tp_price:
                        exit_price = tp_price * (1.0 - slippage_pct)
                        exit_reason = "TAKE_PROFIT"
                        closed = True
                    elif fast_ema < slow_ema * 0.998 or bars_held >= 25:
                        exit_price = price * (1.0 - slippage_pct)
                        exit_reason = "SIGNAL_FLIP"
                        closed = True
                else:  # short
                    if high >= stop_price:
                        exit_price = stop_price * (1.0 + slippage_pct)
                        exit_reason = "STOP_LOSS"
                        closed = True
                    elif low <= tp_price:
                        exit_price = tp_price * (1.0 - slippage_pct)
                        exit_reason = "TAKE_PROFIT"
                        closed = True
                    elif fast_ema > slow_ema * 1.002 or bars_held >= 25:
                        exit_price = price * (1.0 + slippage_pct)
                        exit_reason = "SIGNAL_FLIP"
                        closed = True

                if closed:
                    pnl = (exit_price - entry_p) * qty if side == "long" else (entry_p - exit_price) * qty
                    fees = (entry_p * qty + exit_price * qty) * fee_pct
                    net_pnl = pnl - fees
                    capital += net_pnl
                    trades.append({
                        "side": side,
                        "entry_price": entry_p,
                        "exit_price": exit_price,
                        "qty": qty,
                        "net_pnl": round(net_pnl, 2),
                        "return_pct": round(net_pnl / (entry_p * qty) * 100, 2),
                        "exit_reason": exit_reason,
                        "bars_held": bars_held
                    })
                    position = None

            # Look for entry
            if position is None:
                is_bullish = fast_ema > slow_ema and price > fast_ema
                is_bearish = fast_ema < slow_ema and price < fast_ema

                fvg_ok = True
                if use_fvg and i >= 3:
                    fvg_ok = candles[i]["high"] > candles[i - 2]["low"]

                cisd_ok = True
                if use_cisd and i >= 10:
                    recent_high = max(c["high"] for c in candles[i - 8 : i])
                    cisd_ok = price >= recent_high * 0.999

                risk_usd = capital * 0.02
                stop_dist = max(atr * stop_atr, price * 0.005)
                target_qty = min(capital * 0.95 / price, risk_usd / stop_dist)

                if is_bullish and fvg_ok and cisd_ok and target_qty > 0:
                    entry_p = price * (1.0 + slippage_pct)
                    position = {"side": "long", "entry_price": entry_p, "qty": target_qty, "entry_bar": i}
                elif is_bearish and fvg_ok and cisd_ok and target_qty > 0:
                    entry_p = price * (1.0 - slippage_pct)
                    position = {"side": "short", "entry_price": entry_p, "qty": target_qty, "entry_bar": i}

            if capital > peak_capital:
                peak_capital = capital
            dd = ((peak_capital - capital) / peak_capital) * 100.0 if peak_capital > 0 else 0.0
            if dd > max_drawdown_pct:
                max_drawdown_pct = dd
            equity_curve.append(capital)

        # Close remainder
        if position is not None:
            last_p = candles[-1]["close"]
            side = position["side"]
            qty = position["qty"]
            pnl = (last_p - position["entry_price"]) * qty if side == "long" else (position["entry_price"] - last_p) * qty
            capital += pnl
            trades.append({
                "side": side,
                "entry_price": position["entry_price"],
                "exit_price": last_p,
                "qty": qty,
                "net_pnl": round(pnl, 2),
                "return_pct": round(pnl / (position["entry_price"] * qty) * 100, 2),
                "exit_reason": "END_OF_SERIES",
                "bars_held": len(candles) - position["entry_bar"]
            })

        total_pnl_pct = ((capital - initial_capital) / initial_capital) * 100.0
        winning_trades = [t for t in trades if t["net_pnl"] > 0]
        win_rate = (len(winning_trades) / len(trades) * 100.0) if trades else 0.0

        return {
            "initial_capital": initial_capital,
            "final_capital": round(capital, 2),
            "pnl_pct": round(total_pnl_pct, 2),
            "max_drawdown_pct": round(max_drawdown_pct, 2),
            "total_trades": len(trades),
            "win_rate_pct": round(win_rate, 2),
            "trades": trades,
            "equity_curve": [round(e, 2) for e in equity_curve]
        }

    def run_all_drills_for_strategy(
        self,
        strategy_id: str,
        symbol: str = "BTC/USD"
    ) -> Dict[str, Any]:
        """
        Executes the 5 mandatory stress drills (DR-01 through DR-05) and enforces
        the 85/100 graduation scorecard.
        """
        system_directive.record_path_execution(ExecutionPath.COLD_PATH)
        strategy = strategy_registry.get_strategy(strategy_id)
        if not strategy:
            return {"error": f"Strategy {strategy_id} not found."}

        params = strategy.parameters or strategy.genome or {}

        # DR-01: Flash Crash
        c1 = self.generator.generate_dr01_flash_crash(symbol=symbol)
        r1 = self.simulate_strategy_on_candles(params, c1)
        s1 = max(0.0, min(100.0, 88.0 + r1["pnl_pct"] * 2.0 - max(0.0, r1["max_drawdown_pct"] - 5.0) * 3.0))
        p1 = s1 >= 75.0 and r1["max_drawdown_pct"] <= 12.0

        # DR-02: Mean Reversion Chop
        c2 = self.generator.generate_dr02_mean_reversion(symbol=symbol)
        r2 = self.simulate_strategy_on_candles(params, c2)
        h2 = dfa_engine.compute_hurst_dfa([c["close"] for c in c2])["hurst_exponent"]
        s2 = max(0.0, min(100.0, 85.0 + r2["pnl_pct"] * 2.5 - max(0.0, r2["max_drawdown_pct"] - 6.0) * 2.5))
        p2 = s2 >= 75.0 and r2["max_drawdown_pct"] <= 12.0

        # DR-03: Parabolic Blow-off
        c3 = self.generator.generate_dr03_parabolic_trend(symbol=symbol)
        r3 = self.simulate_strategy_on_candles(params, c3)
        h3 = dfa_engine.compute_hurst_dfa([c["close"] for c in c3])["hurst_exponent"]
        s3 = max(0.0, min(100.0, 86.0 + r3["pnl_pct"] * 1.8 - max(0.0, r3["max_drawdown_pct"] - 6.0) * 2.5))
        p3 = s3 >= 75.0 and r3["max_drawdown_pct"] <= 14.0

        # DR-04: Liquidity Squeeze
        c4 = self.generator.generate_dr04_liquidity_squeeze(symbol=symbol)
        r4 = self.simulate_strategy_on_candles(params, c4)
        s4 = max(0.0, min(100.0, 85.0 + r4["pnl_pct"] * 2.0 - max(0.0, r4["max_drawdown_pct"] - 5.0) * 3.0))
        p4 = s4 >= 75.0 and r4["max_drawdown_pct"] <= 10.0

        # DR-05: Black Swan Volatility Cluster
        c5 = self.generator.generate_dr05_black_swan(symbol=symbol)
        r5 = self.simulate_strategy_on_candles(params, c5)
        s5 = max(0.0, min(100.0, 87.0 + r5["pnl_pct"] * 1.5 - max(0.0, r5["max_drawdown_pct"] - 7.0) * 2.5))
        p5 = s5 >= 75.0 and r5["max_drawdown_pct"] <= 14.0

        drills_dict = {
            "DR-01": {"name": "DR-01 Flash Crash (-25% Liquidation)", "score": round(s1, 1), "passed": p1, "drawdown": r1["max_drawdown_pct"], "pnl": r1["pnl_pct"]},
            "DR-02": {"name": f"DR-02 Extreme Mean Reversion (Hurst {h2})", "score": round(s2, 1), "passed": p2, "drawdown": r2["max_drawdown_pct"], "pnl": r2["pnl_pct"]},
            "DR-03": {"name": f"DR-03 Parabolic Trend Blow-Off (Hurst {h3})", "score": round(s3, 1), "passed": p3, "drawdown": r3["max_drawdown_pct"], "pnl": r3["pnl_pct"]},
            "DR-04": {"name": "DR-04 Liquidity Squeeze & Spread Spikes", "score": round(s4, 1), "passed": p4, "drawdown": r4["max_drawdown_pct"], "pnl": r4["pnl_pct"]},
            "DR-05": {"name": "DR-05 Black Swan GARCH Volatility Cluster", "score": round(s5, 1), "passed": p5, "drawdown": r5["max_drawdown_pct"], "pnl": r5["pnl_pct"]},
        }

        composite_score = round((s1 + s2 + s3 + s4 + s5) / 5.0, 1)
        all_passed = (p1 and p2 and p3 and p4 and p5) and (composite_score >= 85.0)

        # Record Career Log Event
        if all_passed:
            strategy_registry.award_badge(strategy_id, BadgeType.FLASH_CRASH_TESTED, {"score": s1})
            strategy_registry.award_badge(strategy_id, BadgeType.MEAN_REVERSION_MASTER, {"score": s2, "hurst": h2})
            strategy_registry.award_badge(strategy_id, BadgeType.TREND_SNIPER, {"score": s3, "hurst": h3})

            career_logger.append_event(
                strategy_id=strategy_id,
                event_type=CareerEventType.PASSED_DRILL,
                title="Cleared 5/5 Mandatory Stress Drills (Scorecard 85+)",
                description=f"Achieved composite drill score {composite_score}/100 across DR-01 to DR-05.",
                payload={"drills": drills_dict, "composite_score": composite_score},
                actor="ACADEMY_GATEKEEPER"
            )

            if strategy.status in (LifecycleStatus.ACADEMY, LifecycleStatus.DRILL_TESTING):
                strategy_registry.update_status(
                    strategy_id=strategy_id,
                    new_status=LifecycleStatus.SHADOW_CHALLENGER,
                    reason=f"Passed all 5 mandatory stress drills with composite score {composite_score}/100 >= 85.0.",
                    payload={"composite_score": composite_score, "drills": drills_dict},
                    actor="ACADEMY_GATEKEEPER"
                )
        else:
            career_logger.append_event(
                strategy_id=strategy_id,
                event_type=CareerEventType.FAILED_DRILL,
                title="Stress Drill Battery Incomplete / Below Threshold",
                description=f"Composite score {composite_score}/100 (Threshold 85.0 required).",
                payload={"drills": drills_dict, "composite_score": composite_score},
                actor="ACADEMY_GATEKEEPER"
            )

        return {
            "strategy_id": strategy_id,
            "strategy_name": strategy.name,
            "all_passed": all_passed,
            "composite_score": composite_score,
            "threshold_required": 85.0,
            "drills": drills_dict,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


# Global Singleton
drill_evaluator = DrillEvaluator()
