import { useState, useEffect, useMemo, useRef } from "react";
import { 
  ResponsiveContainer, 
  ComposedChart, 
  Area, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ReferenceDot, 
  CartesianGrid,
  AreaChart
} from "recharts";
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Activity, 
  RotateCcw, 
  Globe, 
  Filter, 
  Eye, 
  ArrowUpRight, 
  ArrowDownRight,
  Layers, 
  Clock, 
  Sparkles, 
  BarChart2, 
  CheckCircle2, 
  SlidersHorizontal,
  ChevronRight,
  Tag
} from "lucide-react";
import { MarketTicker, TradeOrder, KrakenSymbolInfo } from "../types";
import KrakenSymbolModal from "./KrakenSymbolModal";
import { safeFetchJson } from "../lib/api";

interface MarketPanelProps {
  tickers: MarketTicker[];
  orders: TradeOrder[];
  portfolioHistory: { time: string; balance: number }[];
  onResetHistory?: () => void;
}

interface PricePoint {
  time: string;
  fullTimestamp: string;
  timestampMs: number;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  hasBuyOrder?: boolean;
  hasSellOrder?: boolean;
  ordersCount?: number;
}

export default function MarketPanel({ tickers, orders, portfolioHistory, onResetHistory }: MarketPanelProps) {
  const [prevPrices, setPrevPrices] = useState<Record<string, number>>({});
  const [flashStates, setFlashStates] = useState<Record<string, 'up' | 'down' | null>>({});
  const [isResetting, setIsResetting] = useState(false);

  // Active chart view mode: 'price-executions' | 'equity'
  const [chartViewMode, setChartViewMode] = useState<'price-executions' | 'equity'>('price-executions');
  
  // Selected pair for price chart & order execution overlay
  const [selectedPair, setSelectedPair] = useState<string>(() => {
    return tickers[0]?.pair || "BTC/USD";
  });

  // Timeframe interval for candles: 1 (1m), 5 (5m), 15 (15m), 60 (1h)
  const [interval, setInterval] = useState<number>(15);

  // Marker visibility & filter states
  const [showBuyMarkers, setShowBuyMarkers] = useState<boolean>(true);
  const [showSellMarkers, setShowSellMarkers] = useState<boolean>(true);
  const [queueFilter, setQueueFilter] = useState<'all' | 'paper' | 'live'>('all');
  
  // Selected/highlighted order
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Historical price chart data
  const [chartCandles, setChartCandles] = useState<PricePoint[]>([]);
  const [isLoadingChart, setIsLoadingChart] = useState(false);

  // Kraken Symbols Directory Modal state
  const [isSymbolModalOpen, setIsSymbolModalOpen] = useState(false);
  const [krakenSymbols, setKrakenSymbols] = useState<KrakenSymbolInfo[]>([]);
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);

  // Make sure selectedPair is valid when tickers change
  useEffect(() => {
    if (tickers.length > 0 && !tickers.some(t => t.pair === selectedPair)) {
      setSelectedPair(tickers[0].pair);
    }
  }, [tickers, selectedPair]);

  // Fetch OHLC candles for the selected pair
  const fetchOHLC = async (pair: string, intervalMin: number) => {
    setIsLoadingChart(true);
    try {
      const data = await safeFetchJson<{
        pair: string;
        interval: number;
        total: number;
        candles: Array<{
          time: number;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
          timestamp: string;
        }>;
      }>(`/api/backtest/ohlc?pair=${encodeURIComponent(pair)}&interval=${intervalMin}&count=80`, undefined, 5000);

      if (data && Array.isArray(data.candles) && data.candles.length > 0) {
        const points: PricePoint[] = data.candles.map(c => {
          const dateObj = new Date(c.timestamp || c.time * 1000);
          const timeLabel = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
          return {
            time: timeLabel,
            fullTimestamp: dateObj.toISOString(),
            timestampMs: dateObj.getTime(),
            price: c.close,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume || 0
          };
        });
        setChartCandles(points);
      } else {
        // Synthesize fallback baseline points around the ticker price if API returns empty
        const curTicker = tickers.find(t => t.pair === pair);
        const basePrice = curTicker?.price || (pair.includes('BTC') ? 85000 : pair.includes('ETH') ? 2900 : 160);
        const now = Date.now();
        const fallbackPoints: PricePoint[] = [];
        for (let i = 40; i >= 0; i--) {
          const t = new Date(now - i * intervalMin * 60 * 1000);
          const noise = (Math.sin(i / 3) * 0.008 + (Math.random() - 0.5) * 0.004) * basePrice;
          const p = Number((basePrice + noise).toFixed(2));
          fallbackPoints.push({
            time: t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
            fullTimestamp: t.toISOString(),
            timestampMs: t.getTime(),
            price: p,
            open: p * 0.999,
            high: p * 1.002,
            low: p * 0.998,
            close: p,
            volume: Math.floor(Math.random() * 50 + 10)
          });
        }
        setChartCandles(fallbackPoints);
      }
    } catch (err) {
      console.error("Failed to load OHLC chart candles:", err);
    } finally {
      setIsLoadingChart(false);
    }
  };

  useEffect(() => {
    fetchOHLC(selectedPair, interval);
  }, [selectedPair, interval]);

  const fetchKrakenSymbols = async () => {
    setIsLoadingSymbols(true);
    try {
      const data = await safeFetchJson<{ symbols?: KrakenSymbolInfo[] }>("/api/kraken/symbols", undefined, 4000);
      if (data && Array.isArray(data.symbols)) {
        setKrakenSymbols(data.symbols);
      }
    } catch (err) {
      console.error("Failed to load Kraken symbols:", err);
    } finally {
      setIsLoadingSymbols(false);
    }
  };

  useEffect(() => {
    fetchKrakenSymbols();
  }, []);

  const handleResetHistory = async () => {
    if (isResetting) return;
    setIsResetting(true);
    try {
      await fetch("/api/history/reset", { method: "POST" });
      if (onResetHistory) {
        onResetHistory();
      }
      setSelectedOrderId(null);
      fetchOHLC(selectedPair, interval);
    } catch (err) {
      console.error("Failed to reset history:", err);
    } finally {
      setIsResetting(false);
    }
  };

  // Flash prices on ticker update
  useEffect(() => {
    const newFlashStates: Record<string, 'up' | 'down' | null> = {};
    let changed = false;

    tickers.forEach((t) => {
      const prevPrice = prevPrices[t.pair];
      if (prevPrice !== undefined && prevPrice !== t.price) {
        newFlashStates[t.pair] = t.price > prevPrice ? 'up' : 'down';
        changed = true;
      } else {
        newFlashStates[t.pair] = null;
      }
    });

    if (changed) {
      setFlashStates(newFlashStates);
      
      const currentPrices: Record<string, number> = {};
      tickers.forEach(t => { currentPrices[t.pair] = t.price; });
      setPrevPrices(currentPrices);

      const timer = setTimeout(() => {
        setFlashStates({});
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      const currentPrices: Record<string, number> = {};
      tickers.forEach(t => { currentPrices[t.pair] = t.price; });
      setPrevPrices(currentPrices);
    }
  }, [tickers]);

  // Filter orders for the selected pair and execution queue
  const pairOrders = useMemo(() => {
    return orders.filter(o => {
      if (o.pair !== selectedPair) return false;
      if (queueFilter === 'paper' && o.executionMode === 'live') return false;
      if (queueFilter === 'live' && o.executionMode !== 'live') return false;
      return true;
    });
  }, [orders, selectedPair, queueFilter]);

  // Filtered orders to display as markers based on toggle controls
  const visibleOrderMarkers = useMemo(() => {
    return pairOrders.filter(o => {
      if (o.type === 'buy' && !showBuyMarkers) return false;
      if (o.type === 'sell' && !showSellMarkers) return false;
      return true;
    });
  }, [pairOrders, showBuyMarkers, showSellMarkers]);

  // Map each order to the nearest chart candle timestamp label for exact XAxis placement
  const positionedMarkers = useMemo(() => {
    if (chartCandles.length === 0) return [];

    return visibleOrderMarkers.map(order => {
      const orderMs = new Date(order.timestamp).getTime();
      
      // Find candle with closest timestamp
      let closestCandle = chartCandles[0];
      let minDiff = Math.abs(chartCandles[0].timestampMs - orderMs);

      for (let i = 1; i < chartCandles.length; i++) {
        const diff = Math.abs(chartCandles[i].timestampMs - orderMs);
        if (diff < minDiff) {
          minDiff = diff;
          closestCandle = chartCandles[i];
        }
      }

      return {
        order,
        chartX: closestCandle.time,
        chartY: order.price,
        timestampMs: orderMs
      };
    });
  }, [visibleOrderMarkers, chartCandles]);

  // Selected order details object
  const activeSelectedOrder = useMemo(() => {
    if (!selectedOrderId) return null;
    return orders.find(o => o.id === selectedOrderId) || null;
  }, [selectedOrderId, orders]);

  // Currently selected ticker info
  const currentTicker = useMemo(() => {
    return tickers.find(t => t.pair === selectedPair) || tickers[0];
  }, [tickers, selectedPair]);

  // Calculate Price Range (Min & Max for domain)
  const priceDomain = useMemo(() => {
    if (chartCandles.length === 0) return ['auto', 'auto'];
    const prices = chartCandles.map(c => c.price);
    // Include order marker prices so markers never fall outside the chart
    positionedMarkers.forEach(m => {
      if (m.order.price) prices.push(m.order.price);
    });

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padding = (max - min) * 0.08 || min * 0.01;
    return [Math.max(0, Number((min - padding).toFixed(2))), Number((max + padding).toFixed(2))];
  }, [chartCandles, positionedMarkers]);

  return (
    <div className="space-y-4">
      {/* 1. Live Market Tickers Feed */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 shadow-sm">
        <h4 className="text-xs font-mono font-semibold text-zinc-400 tracking-wider uppercase mb-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span>Kraken Public Market Feed</span>
            <button
              onClick={() => setIsSymbolModalOpen(true)}
              className="text-[9px] font-mono text-emerald-400 hover:text-emerald-300 bg-emerald-950/60 hover:bg-emerald-950 border border-emerald-800/40 px-1.5 py-0.5 rounded normal-case flex items-center space-x-1 transition-colors cursor-pointer"
              title="Open Kraken and Kraken Pro symbol catalog directory"
            >
              <Globe className="w-2.5 h-2.5 mr-0.5" />
              <span>Catalog ({krakenSymbols.length > 0 ? `${krakenSymbols.length.toLocaleString()}` : '1,400+'})</span>
            </button>
          </div>
          <span className="flex items-center text-[10px] text-emerald-400 font-bold bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-900/30">
            <Activity className="w-3 h-3 mr-1 animate-pulse" /> Live Exchange Data
          </span>
        </h4>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {tickers.map((ticker) => {
            const flash = flashStates[ticker.pair];
            const isUp = ticker.change24h >= 0;
            const isSelected = ticker.pair === selectedPair;
            
            return (
              <button
                key={ticker.pair}
                type="button"
                onClick={() => {
                  setSelectedPair(ticker.pair);
                  setSelectedOrderId(null);
                }}
                className={`border rounded p-2.5 text-left transition-all duration-200 cursor-pointer ${
                  isSelected 
                    ? 'bg-zinc-800/90 border-emerald-500/80 shadow-sm ring-1 ring-emerald-500/30' 
                    : flash === 'up' ? 'bg-emerald-950/40 border-emerald-500/50' :
                      flash === 'down' ? 'bg-rose-950/40 border-rose-500/50' :
                      'bg-zinc-950/50 border-zinc-800/90 hover:border-zinc-700 hover:bg-zinc-900/60'
                }`}
              >
                <div className="flex justify-between items-start">
                  <span className={`text-[11px] font-mono font-bold ${isSelected ? 'text-emerald-400' : 'text-zinc-300'}`}>
                    {ticker.pair}
                  </span>
                  <span className={`text-[10px] font-mono font-semibold flex items-center ${
                    isUp ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {isUp ? <TrendingUp className="w-2.5 h-2.5 mr-0.5" /> : <TrendingDown className="w-2.5 h-2.5 mr-0.5" />}
                    {isUp ? '+' : ''}{ticker.change24h}%
                  </span>
                </div>

                <div className="mt-1">
                  <span className="text-xs font-mono font-bold text-white tracking-tight">
                    ${ticker.price.toLocaleString(undefined, { 
                      minimumFractionDigits: ticker.pair.includes('XRP') ? 4 : 2,
                      maximumFractionDigits: ticker.pair.includes('XRP') ? 4 : 2
                    })}
                  </span>
                  <div className="flex justify-between items-center text-[8px] font-mono text-zinc-500 mt-0.5">
                    <span>Vol: {ticker.volume > 1000 ? `${(ticker.volume / 1000).toFixed(1)}k` : ticker.volume}</span>
                    {isSelected && (
                      <span className="text-emerald-400/90 font-semibold uppercase">ACTIVE</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Interactive Charts Section with Visual Buy/Sell Execution Overlays */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 shadow-sm">
        {/* Header with Mode Switcher & Asset Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3.5 pb-3 border-b border-zinc-800/80">
          <div className="flex items-center space-x-2">
            <div className="flex items-center bg-zinc-950 p-0.5 rounded border border-zinc-800">
              <button
                type="button"
                onClick={() => setChartViewMode('price-executions')}
                className={`px-2.5 py-1 text-[10px] font-mono font-semibold rounded transition-all flex items-center space-x-1.5 ${
                  chartViewMode === 'price-executions'
                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <BarChart2 className="w-3 h-3" />
                <span>Price & Order Overlays</span>
              </button>
              <button
                type="button"
                onClick={() => setChartViewMode('equity')}
                className={`px-2.5 py-1 text-[10px] font-mono font-semibold rounded transition-all flex items-center space-x-1.5 ${
                  chartViewMode === 'equity'
                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <TrendingUp className="w-3 h-3" />
                <span>Equity Performance</span>
              </button>
            </div>

            {chartViewMode === 'price-executions' && (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-zinc-950 text-zinc-300 border border-zinc-800">
                {selectedPair}
              </span>
            )}
          </div>

          {/* Timeframe & Refresh Controls for Price Chart */}
          {chartViewMode === 'price-executions' ? (
            <div className="flex items-center space-x-2 text-[10px] font-mono">
              <span className="text-zinc-500 text-[9px] uppercase tracking-wider hidden sm:inline">Interval:</span>
              <div className="flex items-center bg-zinc-950 rounded border border-zinc-800 p-0.5">
                {[
                  { label: "1m", val: 1 },
                  { label: "5m", val: 5 },
                  { label: "15m", val: 15 },
                  { label: "1h", val: 60 }
                ].map(tf => (
                  <button
                    key={tf.val}
                    type="button"
                    onClick={() => setInterval(tf.val)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                      interval === tf.val 
                        ? 'bg-zinc-800 text-white shadow-xs' 
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => fetchOHLC(selectedPair, interval)}
                disabled={isLoadingChart}
                className="p-1 rounded bg-zinc-950 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors disabled:opacity-50"
                title="Refresh Price Timeseries"
              >
                <RotateCcw className={`w-3 h-3 ${isLoadingChart ? 'animate-spin text-emerald-400' : ''}`} />
              </button>
            </div>
          ) : (
            <div className="text-[10px] font-mono text-zinc-500">
              Real-time Portfolio Balance Stream
            </div>
          )}
        </div>

        {/* Chart View 1: Price Timeseries with Visual Buy/Sell Execution Overlays */}
        {chartViewMode === 'price-executions' ? (
          <div>
            {/* Filter Toolbar for Markers & Queues */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 bg-zinc-950/60 p-2 rounded border border-zinc-800/80 text-[10px] font-mono">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-zinc-500 flex items-center mr-1">
                  <SlidersHorizontal className="w-2.5 h-2.5 mr-1 text-zinc-400" />
                  <span>Markers:</span>
                </span>

                {/* Toggle Buy Markers */}
                <button
                  type="button"
                  onClick={() => setShowBuyMarkers(!showBuyMarkers)}
                  className={`flex items-center space-x-1 px-2 py-0.5 rounded border transition-all ${
                    showBuyMarkers 
                      ? 'bg-emerald-950/70 border-emerald-600/80 text-emerald-300 shadow-xs' 
                      : 'bg-zinc-900 border-zinc-800 text-zinc-500 opacity-60'
                  }`}
                  title="Toggle visual Buy execution triangles on chart"
                >
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-0.5" />
                  <span>▲ Buy ({pairOrders.filter(o => o.type === 'buy').length})</span>
                </button>

                {/* Toggle Sell Markers */}
                <button
                  type="button"
                  onClick={() => setShowSellMarkers(!showSellMarkers)}
                  className={`flex items-center space-x-1 px-2 py-0.5 rounded border transition-all ${
                    showSellMarkers 
                      ? 'bg-rose-950/70 border-rose-600/80 text-rose-300 shadow-xs' 
                      : 'bg-zinc-900 border-zinc-800 text-zinc-500 opacity-60'
                  }`}
                  title="Toggle visual Sell execution triangles on chart"
                >
                  <span className="inline-block w-2 h-2 rounded-full bg-rose-400 mr-0.5" />
                  <span>▼ Sell ({pairOrders.filter(o => o.type === 'sell').length})</span>
                </button>
              </div>

              {/* Queue Isolator Filter */}
              <div className="flex items-center space-x-1.5">
                <span className="text-zinc-500 text-[9px] uppercase">Queue:</span>
                {(['all', 'paper', 'live'] as const).map(q => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQueueFilter(q)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase transition-colors ${
                      queueFilter === q
                        ? q === 'live'
                          ? 'bg-rose-950 text-rose-300 border border-rose-700'
                          : q === 'paper'
                          ? 'bg-amber-950 text-amber-300 border border-amber-700'
                          : 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                        : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Price Chart with Overlay Markers */}
            <div className="h-56 w-full text-xs font-mono relative">
              {isLoadingChart && chartCandles.length === 0 && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/70 backdrop-blur-xs rounded">
                  <div className="flex items-center space-x-2 text-zinc-400 text-xs">
                    <RotateCcw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    <span>Loading {selectedPair} timeseries...</span>
                  </div>
                </div>
              )}

              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartCandles} margin={{ top: 12, right: 10, left: -15, bottom: 5 }}>
                  <defs>
                    <linearGradient id="colorPriceArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" vertical={false} opacity={0.4} />
                  <XAxis dataKey="time" stroke="#52525b" fontSize={9} tickLine={false} />
                  <YAxis 
                    stroke="#52525b" 
                    fontSize={9} 
                    tickLine={false} 
                    domain={priceDomain as any} 
                    tickFormatter={(val) => `$${Number(val).toLocaleString()}`}
                  />
                  
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "#18181b", 
                      borderColor: "#27272a", 
                      borderRadius: "6px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.5)"
                    }}
                    labelStyle={{ color: "#a1a1aa", fontFamily: "monospace", fontSize: "11px", fontWeight: "bold" }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const point = payload[0].payload as PricePoint;
                      
                      // Check if there are matching order markers at this time point
                      const matchingMarkers = positionedMarkers.filter(m => m.chartX === label);

                      return (
                        <div className="bg-zinc-900 border border-zinc-700/80 rounded p-2.5 text-xs font-mono shadow-xl space-y-1.5 min-w-44">
                          <div className="flex justify-between items-center text-zinc-400 text-[10px] border-b border-zinc-800 pb-1">
                            <span>{label}</span>
                            <span className="text-zinc-500 font-bold">{selectedPair}</span>
                          </div>

                          <div className="flex justify-between items-center text-zinc-200">
                            <span className="text-zinc-400">Price:</span>
                            <span className="font-bold text-sky-400">${point.price?.toLocaleString()}</span>
                          </div>

                          {point.high !== undefined && (
                            <div className="grid grid-cols-2 gap-x-2 text-[10px] text-zinc-400 pt-0.5">
                              <div>High: <span className="text-zinc-300">${point.high?.toLocaleString()}</span></div>
                              <div>Low: <span className="text-zinc-300">${point.low?.toLocaleString()}</span></div>
                            </div>
                          )}

                          {/* Render executed order badge in tooltip if order exists here */}
                          {matchingMarkers.length > 0 && (
                            <div className="mt-2 pt-1.5 border-t border-zinc-800 space-y-1.5">
                              <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                                <span>🎯 Executed Orders ({matchingMarkers.length})</span>
                              </div>
                              {matchingMarkers.map((m, i) => (
                                <div 
                                  key={i} 
                                  className={`p-1.5 rounded text-[10px] border ${
                                    m.order.type === 'buy'
                                      ? 'bg-emerald-950/70 border-emerald-700 text-emerald-300'
                                      : 'bg-rose-950/70 border-rose-700 text-rose-300'
                                  }`}
                                >
                                  <div className="flex justify-between items-center font-bold">
                                    <span>{m.order.type === 'buy' ? '▲ BUY' : '▼ SELL'}</span>
                                    <span>${m.order.price?.toLocaleString()}</span>
                                  </div>
                                  <div className="flex justify-between text-[9px] opacity-80 mt-0.5">
                                    <span>{m.order.amount} {selectedPair.split('/')[0]}</span>
                                    <span>${m.order.total?.toLocaleString()} USD</span>
                                  </div>
                                  <div className="flex justify-between items-center text-[8px] opacity-70 mt-0.5">
                                    <span>{m.order.strategyName}</span>
                                    <span className="uppercase">{m.order.executionMode || 'paper'}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />

                  {/* Shaded Price Area under curve */}
                  <Area 
                    type="monotone" 
                    dataKey="price" 
                    stroke="#0284c7" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorPriceArea)" 
                    isAnimationActive={false}
                  />

                  {/* VISUALLY OVERLAID ORDER EXECUTION MARKERS */}
                  {positionedMarkers.map((marker, idx) => {
                    const isBuy = marker.order.type === 'buy';
                    const isSelected = selectedOrderId === marker.order.id;
                    const markerKey = `order-marker-${marker.order.id || idx}-${marker.chartX}`;

                    return (
                      <ReferenceDot
                        key={markerKey}
                        x={marker.chartX}
                        y={marker.chartY}
                        r={8}
                        shape={(props: any) => {
                          const { cx, cy } = props;
                          if (cx === undefined || cy === undefined || isNaN(cx) || isNaN(cy)) return null;

                          return (
                            <g 
                              className="cursor-pointer transition-transform duration-150 hover:scale-125"
                              onClick={() => {
                                setSelectedOrderId(marker.order.id === selectedOrderId ? null : marker.order.id);
                              }}
                            >
                              {/* Selected ring / pulsing aura */}
                              {isSelected && (
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r={14}
                                  fill="none"
                                  stroke={isBuy ? "#10b981" : "#f43f5e"}
                                  strokeWidth={2}
                                  strokeDasharray="3 3"
                                  opacity={0.9}
                                />
                              )}

                              {/* Marker Background Drop Shadow Disc */}
                              <circle
                                cx={cx}
                                cy={cy}
                                r={9}
                                fill="#09090b"
                                stroke={isBuy ? "#059669" : "#e11d48"}
                                strokeWidth={1.5}
                              />

                              {/* Upward Triangle for BUY / Downward Triangle for SELL */}
                              {isBuy ? (
                                <polygon
                                  points={`${cx},${cy - 5} ${cx - 4.5},${cy + 3.5} ${cx + 4.5},${cy + 3.5}`}
                                  fill="#10b981"
                                />
                              ) : (
                                <polygon
                                  points={`${cx},${cy + 5} ${cx - 4.5},${cy - 3.5} ${cx + 4.5},${cy - 3.5}`}
                                  fill="#f43f5e"
                                />
                              )}

                              {/* Center Bright Dot */}
                              <circle
                                cx={cx}
                                cy={isBuy ? cy + 0.5 : cy - 0.5}
                                r={1.5}
                                fill="#ffffff"
                              />
                            </g>
                          );
                        }}
                      />
                    );
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Visual Markers Legend & Inspector */}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/80 text-[10px] font-mono text-zinc-400">
              <div className="flex items-center space-x-3">
                <span className="flex items-center space-x-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-950 border border-emerald-500 flex items-center justify-center text-[7px] text-emerald-400 font-bold">
                    ▲
                  </span>
                  <span>Buy Order Execution</span>
                </span>
                <span className="flex items-center space-x-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-950 border border-rose-500 flex items-center justify-center text-[7px] text-rose-400 font-bold">
                    ▼
                  </span>
                  <span>Sell Order Execution</span>
                </span>
              </div>

              <div className="text-[9px] text-zinc-500">
                Plotted: <strong className="text-zinc-300">{positionedMarkers.length}</strong> markers on {selectedPair}
              </div>
            </div>

            {/* Pinned Order Inspector Card when an order marker is clicked */}
            {activeSelectedOrder && (
              <div className="mt-3 p-3 rounded-lg bg-zinc-950 border border-zinc-700/80 shadow-md text-xs font-mono animate-fadeIn">
                <div className="flex justify-between items-start mb-2 pb-1.5 border-b border-zinc-800">
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      activeSelectedOrder.type === 'buy'
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700'
                        : 'bg-rose-950/80 text-rose-300 border border-rose-700'
                    }`}>
                      {activeSelectedOrder.type === 'buy' ? '▲ BUY EXECUTION' : '▼ SELL EXECUTION'}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                      activeSelectedOrder.executionMode === 'live'
                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                        : 'bg-amber-950 text-amber-300 border border-amber-800'
                    }`}>
                      {activeSelectedOrder.executionMode === 'live' ? 'LIVE L4' : 'PAPER L2'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedOrderId(null)}
                    className="text-zinc-500 hover:text-zinc-300 text-xs px-1"
                  >
                    ✕ Close
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div>
                    <span className="text-zinc-500 block text-[9px] uppercase">Execution Price</span>
                    <span className="font-bold text-white">${activeSelectedOrder.price.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[9px] uppercase">Order Amount</span>
                    <span className="font-bold text-zinc-200">{activeSelectedOrder.amount} {activeSelectedOrder.pair.split('/')[0]}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[9px] uppercase">USD Volume</span>
                    <span className="font-bold text-emerald-400">${activeSelectedOrder.total.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[9px] uppercase">Strategy</span>
                    <span className="font-medium text-zinc-300 truncate block">{activeSelectedOrder.strategyName}</span>
                  </div>
                </div>
                <div className="mt-2 pt-1 text-[9px] text-zinc-500 flex justify-between">
                  <span>Timestamp: {new Date(activeSelectedOrder.timestamp).toLocaleString()}</span>
                  <span className="text-zinc-400">ID: {activeSelectedOrder.id}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Chart View 2: Simulated Portfolio Equity Performance */
          <div>
            <div className="h-56 w-full text-xs font-mono">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={portfolioHistory} margin={{ top: 10, right: 5, left: -20, bottom: 5 }}>
                  <defs>
                    <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" vertical={false} opacity={0.4} />
                  <XAxis dataKey="time" stroke="#52525b" fontSize={9} tickLine={false} />
                  <YAxis stroke="#52525b" fontSize={9} tickLine={false} domain={['auto', 'auto']} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "6px" }}
                    labelStyle={{ color: "#a1a1aa", fontFamily: "monospace" }}
                    itemStyle={{ color: "#10b981", fontFamily: "monospace" }}
                    formatter={(value: any) => [`$${Number(value).toLocaleString()}`, "Equity Balance"]}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="balance" 
                    stroke="#10b981" 
                    strokeWidth={1.5}
                    fillOpacity={1} 
                    fill="url(#colorBalance)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* 3. Filled Trades History Log with Interactive Overlay Locator */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <h4 className="text-xs font-mono font-semibold text-zinc-400 tracking-wider uppercase">
              Trade Filled Logs
            </h4>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
              {orders.length} total
            </span>
          </div>
          <button
            id="btn-reset-trade-history"
            onClick={handleResetHistory}
            disabled={isResetting}
            title="Reset trade history and strategy P&L scorecards to zero baseline"
            className="flex items-center space-x-1 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700/80 px-2 py-1 rounded transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RotateCcw className={`w-3 h-3 ${isResetting ? 'animate-spin text-emerald-400' : ''}`} />
            <span>{isResetting ? 'Resetting...' : 'Reset History'}</span>
          </button>
        </div>

        <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1 terminal-scroll">
          {orders.length === 0 ? (
            <div className="p-4 text-center border border-dashed border-zinc-800/80 rounded">
              <p className="text-[11px] font-mono text-zinc-500">No trading orders logged in ledger queue.</p>
            </div>
          ) : (
            orders.map((order, idx) => {
              const orderTime = new Date(order.timestamp).toLocaleTimeString();
              const isBuy = order.type === 'buy';
              const uniqueKey = `${order.id || 'order'}-${order.timestamp || ''}-${idx}`;
              const isHighlighted = selectedOrderId === order.id;
              
              return (
                <div 
                  key={uniqueKey} 
                  onClick={() => {
                    setSelectedPair(order.pair);
                    setSelectedOrderId(order.id === selectedOrderId ? null : order.id);
                    setChartViewMode('price-executions');
                  }}
                  className={`border rounded p-2.5 text-xs font-mono transition-all cursor-pointer ${
                    isHighlighted
                      ? 'bg-zinc-800/90 border-emerald-500/90 shadow-md ring-1 ring-emerald-500/30'
                      : 'bg-zinc-950/40 border-zinc-800/80 hover:bg-zinc-900/80 hover:border-zinc-700'
                  }`}
                  title="Click to locate and overlay this order on the Price Chart"
                >
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center space-x-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isBuy ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-900/40' : 'bg-rose-950/60 text-rose-400 border border-rose-900/40'
                      }`}>
                        {isBuy ? '▲ BUY' : '▼ SELL'}
                      </span>
                      <span className="text-[10px] font-bold text-zinc-300">{order.pair}</span>
                      {order.executionMode && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                          order.executionMode === 'live'
                            ? 'bg-rose-950/80 border border-rose-800 text-rose-300'
                            : 'bg-amber-950/80 border border-amber-800 text-amber-300'
                        }`}>
                          {order.executionMode === 'live' ? 'LIVE L4' : 'PAPER L2'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] text-zinc-500">{orderTime}</span>
                      <span className="text-[9px] text-sky-400/80 hover:text-sky-300 flex items-center">
                        <Tag className="w-2.5 h-2.5 mr-0.5" />
                        <span>Chart</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between items-baseline">
                    <span className="text-zinc-300 font-semibold">{order.amount} {order.pair.split('/')[0]}</span>
                    <span className="text-zinc-400">@ ${order.price.toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-zinc-500 mt-1 border-t border-zinc-900/90 pt-1">
                    <span className="truncate max-w-[180px]">{order.strategyName}</span>
                    <span className="text-zinc-400 font-medium">${order.total.toLocaleString()} USD</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* KRAKEN & KRAKEN PRO SYMBOL DIRECTORY MODAL */}
      <KrakenSymbolModal
        isOpen={isSymbolModalOpen}
        onClose={() => setIsSymbolModalOpen(false)}
        onSelectSymbol={(sym: string) => {
          setSelectedPair(sym);
          setIsSymbolModalOpen(false);
        }}
        symbols={krakenSymbols}
        isLoading={isLoadingSymbols}
        onRefreshSymbols={fetchKrakenSymbols}
      />
    </div>
  );
}
