"""
Sequential Event-Driven Backtester & Order Simulator (Modul 2: 02_SIMULATION_SLIPPAGE).
Implements tick-by-tick / bar-by-bar sequential execution with latency queue,
realistic fill matching against OHLCV envelopes, and market impact accounting.
"""

from datetime import datetime, timezone
from enum import Enum
import math
from typing import Any, Dict, List, Optional, Tuple, Union

from app.core.directives import ExecutionPath, system_directive
from app.engine.market_impact import MarketImpactModel, market_impact


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP_LOSS = "STOP_LOSS"
    TAKE_PROFIT = "TAKE_PROFIT"


class OrderSide(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class PositionSide(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"


class SimulatedOrder:
    def __init__(
        self,
        order_id: str,
        symbol: str,
        side: OrderSide,
        order_type: OrderType,
        qty: float,
        price: Optional[float] = None,
        stop_price: Optional[float] = None,
        created_bar_idx: int = 0,
        latency_bars: int = 1
    ):
        self.order_id = order_id
        self.symbol = symbol
        self.side = side
        self.order_type = order_type
        self.qty = qty
        self.price = price
        self.stop_price = stop_price
        self.created_bar_idx = created_bar_idx
        self.executable_bar_idx = created_bar_idx + latency_bars
        self.filled = False
        self.fill_price: float = 0.0
        self.fill_time: str = ""
        self.fees_usd: float = 0.0
        self.slippage_usd: float = 0.0


class EventBacktestEngine:
    """
    Sequential Event-Driven Simulation Engine with no lookahead bias.
    """

    def __init__(
        self,
        initial_capital: float = 10000.0,
        impact_model: Optional[MarketImpactModel] = None,
        latency_bars: int = 1
    ):
        self.initial_capital = initial_capital
        self.impact_model = impact_model or market_impact
        self.latency_bars = latency_bars

    def run_backtest(
        self,
        candles: List[Dict[str, Any]],
        strategy_signal_fn: Any,
        daily_volume_usd: float = 50000000.0,
        volatility_annualized: float = 0.65
    ) -> Dict[str, Any]:
        """
        Executes deterministic event-by-event backtest.

        Args:
            candles: List of OHLCV dictionaries.
            strategy_signal_fn: Function (bar_idx, open_positions, cash, history) -> List[OrderAction].
            daily_volume_usd: Reference liquidity volume.
            volatility_annualized: Reference volatility.

        Returns:
            Dictionary with trades, equity curve, Sharpe, Max Drawdown, and slippage breakdown.
        """
        system_directive.record_path_execution(ExecutionPath.WARM_PATH)
        n = len(candles)
        if n < 10:
            return {"error": "Insufficient candle sample for backtest."}

        capital = self.initial_capital
        peak_capital = self.initial_capital
        max_drawdown_pct = 0.0

        current_position: Optional[Dict[str, Any]] = None
        closed_trades: List[Dict[str, Any]] = []
        equity_curve: List[float] = [capital]
        pending_orders: List[SimulatedOrder] = []
        total_slippage_usd = 0.0
        total_fees_usd = 0.0

        order_seq = 0

        for i in range(n):
            candle = candles[i]
            c_open = float(candle["open"])
            c_high = float(candle["high"])
            c_low = float(candle["low"])
            c_close = float(candle["close"])
            c_vol = float(candle.get("volume", 1000.0))
            c_time = candle.get("timestamp", f"bar_{i}")

            # 1. Process pending orders arriving at this bar (simulated latency delay)
            remaining_orders: List[SimulatedOrder] = []
            for order in pending_orders:
                if i >= order.executable_bar_idx and not order.filled:
                    # Execute Order against current bar
                    fill_res = self._attempt_fill(
                        order=order,
                        candle=candle,
                        daily_vol_usd=daily_volume_usd,
                        vol_ann=volatility_annualized
                    )
                    if fill_res["filled"]:
                        order.filled = True
                        order.fill_price = fill_res["fill_price"]
                        order.fees_usd = fill_res["fee_usd"]
                        order.slippage_usd = fill_res["slippage_usd"]
                        total_fees_usd += order.fees_usd
                        total_slippage_usd += order.slippage_usd

                        # Update Position
                        if order.side == OrderSide.BUY:
                            if current_position is None:
                                current_position = {
                                    "side": PositionSide.LONG,
                                    "entry_price": order.fill_price,
                                    "qty": order.qty,
                                    "entry_bar": i,
                                    "entry_time": c_time
                                }
                            elif current_position["side"] == PositionSide.SHORT:
                                # Close short
                                entry_p = current_position["entry_price"]
                                pnl = (entry_p - order.fill_price) * current_position["qty"]
                                net_pnl = pnl - order.fees_usd
                                capital += net_pnl
                                closed_trades.append({
                                    "side": "SHORT",
                                    "entry_price": entry_p,
                                    "exit_price": order.fill_price,
                                    "qty": current_position["qty"],
                                    "net_pnl": round(net_pnl, 2),
                                    "return_pct": round(net_pnl / (entry_p * current_position["qty"]) * 100, 2),
                                    "bars_held": i - current_position["entry_bar"],
                                    "fees_usd": round(order.fees_usd, 4),
                                    "slippage_usd": round(order.slippage_usd, 4)
                                })
                                current_position = None

                        elif order.side == OrderSide.SELL:
                            if current_position is None:
                                current_position = {
                                    "side": PositionSide.SHORT,
                                    "entry_price": order.fill_price,
                                    "qty": order.qty,
                                    "entry_bar": i,
                                    "entry_time": c_time
                                }
                            elif current_position["side"] == PositionSide.LONG:
                                # Close long
                                entry_p = current_position["entry_price"]
                                pnl = (order.fill_price - entry_p) * current_position["qty"]
                                net_pnl = pnl - order.fees_usd
                                capital += net_pnl
                                closed_trades.append({
                                    "side": "LONG",
                                    "entry_price": entry_p,
                                    "exit_price": order.fill_price,
                                    "qty": current_position["qty"],
                                    "net_pnl": round(net_pnl, 2),
                                    "return_pct": round(net_pnl / (entry_p * current_position["qty"]) * 100, 2),
                                    "bars_held": i - current_position["entry_bar"],
                                    "fees_usd": round(order.fees_usd, 4),
                                    "slippage_usd": round(order.slippage_usd, 4)
                                })
                                current_position = None
                    else:
                        remaining_orders.append(order)
                else:
                    remaining_orders.append(order)
            pending_orders = remaining_orders

            # 2. Strategy Signal Generation (No Future Lookahead)
            history_slice = candles[: i + 1]
            signals = strategy_signal_fn(i, current_position, capital, history_slice)
            if signals:
                for sig in signals:
                    order_seq += 1
                    ord_obj = SimulatedOrder(
                        order_id=f"ord_{order_seq}",
                        symbol=candle.get("symbol", "BTC/USD"),
                        side=OrderSide(sig.get("side", "BUY")),
                        order_type=OrderType(sig.get("order_type", "MARKET")),
                        qty=float(sig.get("qty", 0.0)),
                        price=sig.get("price"),
                        stop_price=sig.get("stop_price"),
                        created_bar_idx=i,
                        latency_bars=self.latency_bars
                    )
                    pending_orders.append(ord_obj)

            # 3. Mark to Market Equity
            unrealized_pnl = 0.0
            if current_position is not None:
                qty = current_position["qty"]
                if current_position["side"] == PositionSide.LONG:
                    unrealized_pnl = (c_close - current_position["entry_price"]) * qty
                else:
                    unrealized_pnl = (current_position["entry_price"] - c_close) * qty

            cur_equity = capital + unrealized_pnl
            if cur_equity > peak_capital:
                peak_capital = cur_equity
            dd = ((peak_capital - cur_equity) / peak_capital) * 100.0 if peak_capital > 0 else 0.0
            if dd > max_drawdown_pct:
                max_drawdown_pct = dd
            equity_curve.append(cur_equity)

        # Final cleanup: close any remaining open position at the last bar
        if current_position is not None:
            last_c = candles[-1]
            last_p = float(last_c["close"])
            qty = current_position["qty"]
            side = current_position["side"]
            pnl = (last_p - current_position["entry_price"]) * qty if side == PositionSide.LONG else (current_position["entry_price"] - last_p) * qty
            capital += pnl
            closed_trades.append({
                "side": side.value,
                "entry_price": current_position["entry_price"],
                "exit_price": last_p,
                "qty": qty,
                "net_pnl": round(pnl, 2),
                "return_pct": round(pnl / (current_position["entry_price"] * qty) * 100, 2),
                "bars_held": len(candles) - current_position["entry_bar"],
                "fees_usd": 0.0,
                "slippage_usd": 0.0,
                "exit_reason": "SIMULATION_END"
            })

        total_return_pct = ((capital - self.initial_capital) / self.initial_capital) * 100.0
        winning_trades = [t for t in closed_trades if t["net_pnl"] > 0]
        losing_trades = [t for t in closed_trades if t["net_pnl"] <= 0]
        win_rate = (len(winning_trades) / len(closed_trades) * 100.0) if closed_trades else 0.0
        profit_factor = (
            sum(t["net_pnl"] for t in winning_trades) / abs(sum(t["net_pnl"] for t in losing_trades))
            if losing_trades and sum(t["net_pnl"] for t in losing_trades) != 0
            else (999.0 if winning_trades else 0.0)
        )

        return {
            "initial_capital": self.initial_capital,
            "final_capital": round(capital, 2),
            "total_return_pct": round(total_return_pct, 2),
            "max_drawdown_pct": round(max_drawdown_pct, 2),
            "total_trades": len(closed_trades),
            "win_rate_pct": round(win_rate, 2),
            "profit_factor": round(profit_factor, 2),
            "total_fees_usd": round(total_fees_usd, 2),
            "total_slippage_usd": round(total_slippage_usd, 2),
            "trades": closed_trades,
            "equity_curve": [round(e, 2) for e in equity_curve]
        }

    def _attempt_fill(
        self,
        order: SimulatedOrder,
        candle: Dict[str, Any],
        daily_vol_usd: float,
        vol_ann: float
    ) -> Dict[str, Any]:
        """Evaluates whether order executes against candle envelope."""
        c_open = float(candle["open"])
        c_high = float(candle["high"])
        c_low = float(candle["low"])
        c_close = float(candle["close"])

        if order.order_type == OrderType.MARKET:
            # Market orders execute at Open + Square Root Slippage
            impact = self.impact_model.calculate_execution_price(
                side=order.side.value,
                mid_price=c_open,
                order_qty=order.qty,
                daily_volume_usd=daily_vol_usd,
                volatility_annualized=vol_ann
            )
            return {
                "filled": True,
                "fill_price": impact["fill_price"],
                "fee_usd": impact["fee_usd"],
                "slippage_usd": impact["slippage_usd"]
            }

        elif order.order_type == OrderType.LIMIT:
            if order.side == OrderSide.BUY and c_low <= (order.price or c_open):
                fill_p = min(c_open, order.price or c_open)
                return {
                    "filled": True,
                    "fill_price": fill_p,
                    "fee_usd": fill_p * order.qty * self.impact_model.base_fee_pct,
                    "slippage_usd": 0.0
                }
            elif order.side == OrderSide.SELL and c_high >= (order.price or c_open):
                fill_p = max(c_open, order.price or c_open)
                return {
                    "filled": True,
                    "fill_price": fill_p,
                    "fee_usd": fill_p * order.qty * self.impact_model.base_fee_pct,
                    "slippage_usd": 0.0
                }

        elif order.order_type == OrderType.STOP_LOSS:
            if order.side == OrderSide.SELL and c_low <= (order.stop_price or c_open):
                impact = self.impact_model.calculate_execution_price(
                    side="SELL",
                    mid_price=order.stop_price or c_open,
                    order_qty=order.qty,
                    daily_volume_usd=daily_vol_usd,
                    volatility_annualized=vol_ann
                )
                return {
                    "filled": True,
                    "fill_price": impact["fill_price"],
                    "fee_usd": impact["fee_usd"],
                    "slippage_usd": impact["slippage_usd"]
                }

        return {"filled": False, "fill_price": 0.0, "fee_usd": 0.0, "slippage_usd": 0.0}
