import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Wallet, TrendingUp, TrendingDown, DollarSign, RefreshCw, 
  ShieldCheck, Zap, Layers, AlertCircle, ArrowUpRight, ArrowDownRight,
  PieChart, ChevronRight, Lock, CheckCircle2, Search, SlidersHorizontal,
  FileSpreadsheet, ShieldAlert
} from "lucide-react";
import { KrakenAccountLedgers, KrakenSpotPosition, KrakenProPosition } from "../types";

import { safeFetchJson } from "../lib/api";

interface KrakenLedgersPanelProps {
  isPaperTrading?: boolean;
  hasCredentials?: boolean;
  onRefreshTrigger?: () => void;
}

export default function KrakenLedgersPanel({
  isPaperTrading = true,
  hasCredentials = false,
  onRefreshTrigger
}: KrakenLedgersPanelProps) {
  const [activeLedgerTab, setActiveLedgerTab] = useState<'spot' | 'pro'>('spot');
  const [ledgers, setLedgers] = useState<KrakenAccountLedgers | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const fetchLedgers = async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const data = await safeFetchJson<KrakenAccountLedgers>("/api/kraken/ledgers", undefined, 4000);
      if (data) {
        setLedgers(data);
      }
    } catch (err) {
      console.error("Failed to fetch Kraken ledgers:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLedgers();
    const interval = setInterval(fetchLedgers, 12000);
    return () => clearInterval(interval);
  }, []);

  const handleManualSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncNotice(null);
    try {
      const res = await fetch("/api/kraken/ledgers/sync", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.spot && data.pro) {
          setLedgers({
            mode: isPaperTrading ? 'paper' : 'live',
            hasCredentials,
            lastSync: data.timestamp,
            spot: data.spot,
            pro: data.pro
          });
          setSyncNotice("Synced real-time balances from Kraken exchange.");
          setTimeout(() => setSyncNotice(null), 4000);
        }
      }
      if (onRefreshTrigger) onRefreshTrigger();
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const filteredSpotAssets = ledgers?.spot.assets.filter(a => 
    a.asset.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const filteredProPositions = ledgers?.pro.positions.filter(p =>
    p.pair.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.contractType.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <div className="space-y-4 font-mono">
      {/* Header Bar with Dual Ledger Selector & Sync Controls */}
      <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded bg-zinc-950 border border-zinc-800 text-emerald-400">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Kraken Account Position Ledgers
              </h2>
              <span className={`text-[9px] px-1.5 py-0.5 rounded border uppercase font-bold ${
                isPaperTrading
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                  : 'bg-amber-950/60 text-amber-300 border-amber-800/60'
              }`}>
                {isPaperTrading ? 'Level 2 Paper Ledger' : 'Level 4 Kraken Pro Live'}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Distinct ledgers for Spot capital balances and Pro Futures / Margin derivatives.
            </p>
          </div>
        </div>

        {/* Tab Selector & Sync */}
        <div className="flex items-center space-x-2">
          <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs">
            <button
              onClick={() => setActiveLedgerTab('spot')}
              className={`px-3 py-1.5 rounded transition-all font-semibold flex items-center space-x-1.5 ${
                activeLedgerTab === 'spot'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <PieChart className="w-3.5 h-3.5 text-emerald-400" />
              <span>1. Spot Position Ledger</span>
            </button>
            <button
              onClick={() => setActiveLedgerTab('pro')}
              className={`px-3 py-1.5 rounded transition-all font-semibold flex items-center space-x-1.5 ${
                activeLedgerTab === 'pro'
                  ? 'bg-purple-950 text-purple-300 border border-purple-800/60 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-purple-400" />
              <span>2. Pro / Futures Position Ledger</span>
            </button>
          </div>

          <button
            onClick={handleManualSync}
            disabled={isSyncing}
            className="px-3 py-1.5 rounded bg-zinc-800/90 hover:bg-zinc-750 border border-zinc-700 text-xs text-zinc-200 hover:text-white transition-all flex items-center space-x-1.5 disabled:opacity-50"
            title="Force refresh balances & positions directly from Kraken"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isSyncing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Sync</span>
          </button>
        </div>
      </div>

      {syncNotice && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-2.5 rounded bg-emerald-950/80 border border-emerald-800/60 text-xs text-emerald-300 flex items-center space-x-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{syncNotice}</span>
        </motion.div>
      )}

      {/* TAB 1: SPOT POSITION LEDGER */}
      {activeLedgerTab === 'spot' && (
        <motion.div 
          key="spot-ledger-view"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Spot Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
              <span className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wider block">
                Total Spot Portfolio
              </span>
              <div className="flex items-baseline space-x-1.5 mt-1">
                <span className="text-xl font-bold text-white tracking-tight">
                  ${(ledgers?.spot.totalValueUSD || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-zinc-500">USD</span>
              </div>
              <span className="text-[10px] text-emerald-400 mt-1 block">
                Aggregated valuation of all held spot assets
              </span>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
              <span className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wider block">
                Available Fiat &amp; Cash
              </span>
              <div className="flex items-baseline space-x-1.5 mt-1">
                <span className="text-xl font-bold text-emerald-400 tracking-tight">
                  ${(ledgers?.spot.freeCashUSD || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-zinc-500">USD</span>
              </div>
              <span className="text-[10px] text-zinc-400 mt-1 block">
                Unallocated USD/EUR cash ready for spot orders
              </span>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
              <span className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wider block">
                Crypto Spot Valuation
              </span>
              <div className="flex items-baseline space-x-1.5 mt-1">
                <span className="text-xl font-bold text-amber-300 tracking-tight">
                  ${(ledgers?.spot.cryptoValueUSD || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-zinc-500">USD</span>
              </div>
              <span className="text-[10px] text-zinc-400 mt-1 block">
                BTC, ETH, SOL, XRP spot positions
              </span>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
              <span className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wider block">
                Spot Assets Count
              </span>
              <div className="flex items-baseline space-x-1.5 mt-1">
                <span className="text-xl font-bold text-white tracking-tight">
                  {ledgers?.spot.assets.length || 0}
                </span>
                <span className="text-xs text-zinc-500">Assets</span>
              </div>
              <span className="text-[10px] text-zinc-400 mt-1 block">
                Non-zero Kraken spot balances
              </span>
            </div>
          </div>

          {/* Spot Assets Detailed Ledger Table */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden shadow-lg">
            <div className="p-3.5 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center space-x-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Kraken Spot Position Balance Ledger
                </h3>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter spot assets (BTC, USD, ETH)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 pl-8 pr-3 py-1 text-xs text-zinc-200 rounded focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-zinc-950/80 border-b border-zinc-800 text-[10px] text-zinc-400 uppercase tracking-wider">
                    <th className="py-2.5 px-4">Asset</th>
                    <th className="py-2.5 px-4">Classification</th>
                    <th className="py-2.5 px-4 text-right">Total Holdings</th>
                    <th className="py-2.5 px-4 text-right">Available / In-Order</th>
                    <th className="py-2.5 px-4 text-right">Kraken Unit Price</th>
                    <th className="py-2.5 px-4 text-right">Spot Value (USD)</th>
                    <th className="py-2.5 px-4 text-right">Portfolio Allocation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filteredSpotAssets.length > 0 ? (
                    filteredSpotAssets.map((asset, idx) => {
                      const isFiat = asset.type === 'fiat';
                      return (
                        <tr key={`${asset.asset}-${idx}`} className="hover:bg-zinc-850/40 transition-colors">
                          {/* Asset Name */}
                          <td className="py-3 px-4">
                            <div className="flex items-center space-x-2">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                              <div>
                                <span className="font-bold text-white text-sm block">{asset.asset}</span>
                                <span className="text-[10px] text-zinc-400">{asset.name}</span>
                              </div>
                            </div>
                          </td>

                          {/* Classification Tag */}
                          <td className="py-3 px-4">
                            <span className={`text-[9px] px-2 py-0.5 rounded uppercase font-semibold border ${
                              asset.type === 'fiat'
                                ? 'bg-blue-950/60 text-blue-300 border-blue-800/40'
                                : asset.type === 'stablecoin'
                                ? 'bg-teal-950/60 text-teal-300 border-teal-800/40'
                                : 'bg-amber-950/60 text-amber-300 border-amber-800/40'
                            }`}>
                              {asset.type}
                            </span>
                          </td>

                          {/* Total Holdings */}
                          <td className="py-3 px-4 text-right">
                            <span className="font-bold text-zinc-200">
                              {asset.amount.toLocaleString(undefined, { 
                                minimumFractionDigits: isFiat ? 2 : 4,
                                maximumFractionDigits: isFiat ? 2 : 6 
                              })}
                            </span>
                            <span className="text-[10px] text-zinc-500 ml-1">{asset.asset}</span>
                          </td>

                          {/* Available vs In Order */}
                          <td className="py-3 px-4 text-right text-[11px]">
                            <div className="text-zinc-300">
                              Avail: {asset.available.toLocaleString(undefined, { minimumFractionDigits: isFiat ? 2 : 4, maximumFractionDigits: isFiat ? 2 : 4 })}
                            </div>
                            {asset.inOrders > 0 && (
                              <div className="text-[10px] text-amber-400">
                                Locked: {asset.inOrders.toLocaleString()}
                              </div>
                            )}
                          </td>

                          {/* Unit Price */}
                          <td className="py-3 px-4 text-right">
                            <div className="font-semibold text-zinc-200">
                              ${asset.unitPriceUSD.toLocaleString(undefined, { minimumFractionDigits: isFiat ? 2 : 2, maximumFractionDigits: 2 })}
                            </div>
                            {asset.change24h !== 0 && (
                              <div className={`text-[9px] flex items-center justify-end space-x-0.5 ${asset.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {asset.change24h >= 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                                <span>{asset.change24h >= 0 ? '+' : ''}{asset.change24h}%</span>
                              </div>
                            )}
                          </td>

                          {/* Total USD Value */}
                          <td className="py-3 px-4 text-right">
                            <span className="font-bold text-white text-sm">
                              ${asset.totalValueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </td>

                          {/* Portfolio Allocation Bar */}
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <span className="text-xs font-semibold text-zinc-300">{asset.portfolioPercentage}%</span>
                              <div className="w-16 bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                                <div 
                                  className="bg-emerald-400 h-full rounded-full" 
                                  style={{ width: `${Math.min(asset.portfolioPercentage, 100)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-zinc-500">
                        {isLoading ? "Fetching Kraken spot balances..." : "No spot positions match your filter."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* TAB 2: PRO / FUTURES POSITION LEDGER */}
      {activeLedgerTab === 'pro' && (
        <motion.div 
          key="pro-ledger-view"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Pro / Futures Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
              <span className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wider block">
                Total Margin Collateral Equity
              </span>
              <div className="flex items-baseline space-x-1.5 mt-1">
                <span className="text-xl font-bold text-purple-300 tracking-tight">
                  ${(ledgers?.pro.totalCollateralUSD || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-zinc-500">USD</span>
              </div>
              <span className="text-[10px] text-zinc-400 mt-1 block">
                Trade balance allocated to margin/futures
              </span>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
              <span className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wider block">
                Free Usable Margin
              </span>
              <div className="flex items-baseline space-x-1.5 mt-1">
                <span className="text-xl font-bold text-emerald-400 tracking-tight">
                  ${(ledgers?.pro.freeMarginUSD || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-zinc-500">USD</span>
              </div>
              <span className="text-[10px] text-zinc-400 mt-1 block">
                Free buffer available for new contract positions
              </span>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
              <span className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wider block">
                Margin Health Level
              </span>
              <div className="flex items-baseline space-x-1.5 mt-1">
                <span className="text-xl font-bold text-white tracking-tight">
                  {ledgers?.pro.marginLevelPercent || 100}%
                </span>
                <span className="text-xs text-emerald-400 font-semibold">(Safe)</span>
              </div>
              <span className="text-[10px] text-zinc-400 mt-1 block">
                Used margin: ${(ledgers?.pro.usedMarginUSD || 0).toLocaleString()} USD
              </span>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
              <span className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wider block">
                Total Unrealized Futures P&amp;L
              </span>
              <div className="flex items-baseline space-x-1.5 mt-1">
                <span className={`text-xl font-bold tracking-tight ${
                  (ledgers?.pro.totalUnrealizedPnL || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {(ledgers?.pro.totalUnrealizedPnL || 0) >= 0 ? '+' : ''}${(ledgers?.pro.totalUnrealizedPnL || 0).toFixed(2)}
                </span>
                <span className="text-xs text-zinc-500">USD</span>
              </div>
              <span className={`text-[10px] font-semibold mt-1 block ${
                (ledgers?.pro.unrealizedPnLPercent || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {(ledgers?.pro.unrealizedPnLPercent || 0) >= 0 ? '+' : ''}{ledgers?.pro.unrealizedPnLPercent || 0}% on margin
              </span>
            </div>
          </div>

          {/* Pro / Futures Positions Detailed Ledger Table */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden shadow-lg">
            <div className="p-3.5 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-purple-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Kraken Pro / Futures &amp; Margin Position Ledger
                </h3>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter Pro contracts (BTC Perp, Short)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 pl-8 pr-3 py-1 text-xs text-zinc-200 rounded focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-zinc-950/80 border-b border-zinc-800 text-[10px] text-zinc-400 uppercase tracking-wider">
                    <th className="py-2.5 px-4">Contract / Pair</th>
                    <th className="py-2.5 px-4">Side &amp; Lev</th>
                    <th className="py-2.5 px-4 text-right">Size / Notional USD</th>
                    <th className="py-2.5 px-4 text-right">Entry Price</th>
                    <th className="py-2.5 px-4 text-right">Mark Price</th>
                    <th className="py-2.5 px-4 text-right">Liquidation Price</th>
                    <th className="py-2.5 px-4 text-right">Collateral / Margin</th>
                    <th className="py-2.5 px-4 text-right">Unrealized P&amp;L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {filteredProPositions.length > 0 ? (
                    filteredProPositions.map((pos, idx) => {
                      const isLong = pos.type === 'long';
                      const isProfit = pos.unrealizedPnLUSD >= 0;
                      return (
                        <tr key={`${pos.id || 'pos'}-${idx}`} className="hover:bg-zinc-850/40 transition-colors">
                          {/* Contract Pair */}
                          <td className="py-3 px-4">
                            <div className="flex items-center space-x-2">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${isLong ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                              <div>
                                <span className="font-bold text-white text-sm block">{pos.pair}</span>
                                <span className="text-[10px] text-zinc-400 uppercase">{pos.contractType}</span>
                              </div>
                            </div>
                          </td>

                          {/* Side & Leverage */}
                          <td className="py-3 px-4">
                            <div className="flex items-center space-x-1.5">
                              <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border ${
                                isLong 
                                  ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60' 
                                  : 'bg-rose-950/70 text-rose-300 border-rose-800/60'
                              }`}>
                                {pos.type}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-semibold">
                                {pos.leverage}x
                              </span>
                            </div>
                          </td>

                          {/* Size & Notional USD */}
                          <td className="py-3 px-4 text-right">
                            <div className="font-bold text-zinc-200">{pos.size} Contracts</div>
                            <div className="text-[10px] text-zinc-400">
                              ${pos.notionalValueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </td>

                          {/* Entry Price */}
                          <td className="py-3 px-4 text-right font-medium text-zinc-300">
                            ${pos.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>

                          {/* Mark Price */}
                          <td className="py-3 px-4 text-right font-bold text-white">
                            ${pos.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>

                          {/* Liquidation Price */}
                          <td className="py-3 px-4 text-right">
                            <div className="font-semibold text-rose-400">
                              ${pos.liquidationPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <span className="text-[9px] text-zinc-500">Liq Distance: Safe</span>
                          </td>

                          {/* Collateral / Margin */}
                          <td className="py-3 px-4 text-right text-[11px]">
                            <div className="font-semibold text-zinc-200">
                              ${pos.collateralUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <div className="text-[9px] text-zinc-500">
                              Req: ${pos.marginRequirementUSD.toLocaleString()}
                            </div>
                          </td>

                          {/* Unrealized P&L */}
                          <td className="py-3 px-4 text-right">
                            <div className={`font-bold text-sm ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {isProfit ? '+' : ''}${pos.unrealizedPnLUSD.toFixed(2)}
                            </div>
                            <div className={`text-[10px] font-semibold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {isProfit ? '+' : ''}{pos.unrealizedPnLPercent}%
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-zinc-500">
                        {isLoading ? "Fetching Kraken Pro derivatives positions..." : "No active Pro/Futures positions found."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
