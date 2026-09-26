"""
=========================================================
Datei:      app/execution/FeeEngine.py
Zweck:      Reale Abrechnung von Maker/Taker Fees & Funding Rates
Knoten:     Jaune (Carrera-Engine)
=========================================================
"""
from dataclasses import dataclass

@dataclass
class TradeFeeBreakdown:
    entry_fee_usd: float
    exit_fee_usd: float
    funding_fee_usd: float
    total_fees_usd: float
    gross_pnl_usd: float
    net_pnl_usd: float

class FeeEngine:
    def __init__(self, maker_fee_rate: float = 0.0002, taker_fee_rate: float = 0.0005):
        self.maker_fee_rate = maker_fee_rate
        self.taker_fee_rate = taker_fee_rate

    def calculate_net_pnl(
        self, entry_notional_usd: float, exit_notional_usd: float, gross_pnl_usd: float,
        entry_execution_type: str = "TAKER", exit_execution_type: str = "TAKER",
        funding_fee_accumulated_usd: float = 0.0
    ) -> TradeFeeBreakdown:
        entry_rate = self.maker_fee_rate if entry_execution_type.upper() == "MAKER" else self.taker_fee_rate
        exit_rate = self.maker_fee_rate if exit_execution_type.upper() == "MAKER" else self.taker_fee_rate

        entry_fee = entry_notional_usd * entry_rate
        exit_fee = exit_notional_usd * exit_rate
        total_fees = entry_fee + exit_fee + funding_fee_accumulated_usd
        net_pnl = gross_pnl_usd - total_fees

        return TradeFeeBreakdown(
            entry_fee_usd=round(entry_fee, 4), exit_fee_usd=round(exit_fee, 4),
            funding_fee_usd=round(funding_fee_accumulated_usd, 4),
            total_fees_usd=round(total_fees, 4), gross_pnl_usd=round(gross_pnl_usd, 4),
            net_pnl_usd=round(net_pnl, 4)
        )
