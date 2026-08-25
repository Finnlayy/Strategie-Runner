import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Calendar as CalendarIcon, TrendingUp, TrendingDown, Target, 
  Activity, RefreshCw, Layers, Zap, Info, ChevronRight, CheckCircle2,
  XCircle, MinusCircle, DollarSign, ChevronLeft, ChevronRight as ChevronRightIcon,
  ChevronDown, Filter, Check, SlidersHorizontal, Eye
} from "lucide-react";
import { DailyPnLDay, DailyPnLHeatmapData, TradingStrategy, StrategyPnL } from "../types";

export type ViewScopeType = 'single' | 'combined_all' | 'combined_live' | 'combined_paper' | 'custom_multi';

interface CalendarHeatmapProps {
  selectedStrategy: TradingStrategy | null;
  strategies?: TradingStrategy[];
  strategyPnL?: StrategyPnL[];
  onSelectStrategy?: (strategyId: string) => void;
  onSelectDate?: (date: string) => void;
}

const AVAILABLE_YEARS = [2025, 2026, 2027, 2028];
const MONTHS_LIST = [
  { index: 1, short: "Jan", full: "January" },
  { index: 2, short: "Feb", full: "February" },
  { index: 3, short: "Mar", full: "March" },
  { index: 4, short: "Apr", full: "April" },
  { index: 5, short: "May", full: "May" },
  { index: 6, short: "Jun", full: "June" },
  { index: 7, short: "Jul", full: "July" },
  { index: 8, short: "Aug", full: "August" },
  { index: 9, short: "Sep", full: "September" },
  { index: 10, short: "Oct", full: "October" },
  { index: 11, short: "Nov", full: "November" },
  { index: 12, short: "Dec", full: "December" }
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarHeatmap({
  selectedStrategy,
  strategies = [],
  strategyPnL = [],
  onSelectStrategy,
  onSelectDate
}: CalendarHeatmapProps) {
  const now = useMemo(() => new Date(), []);
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const currentY = new Date().getFullYear();
    return AVAILABLE_YEARS.includes(currentY) ? currentY : 2026;
  });
  const [selectedMonth, setSelectedMonth] = useState<number>(() => {
    return new Date().getMonth() + 1; // 1-12
  });

  // Dropdown View Scope State: 'single' | 'combined_all' | 'combined_live' | 'combined_paper' | 'custom_multi'
  const [viewScope, setViewScope] = useState<ViewScopeType>('single');
  const [selectedMultiIds, setSelectedMultiIds] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [heatmapData, setHeatmapData] = useState<DailyPnLHeatmapData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedDay, setSelectedDay] = useState<DailyPnLDay | null>(null);
  const [hoveredDay, setHoveredDay] = useState<DailyPnLDay | null>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Initialize selected multi IDs when switching or when strategies load
  useEffect(() => {
    if (strategies.length > 0 && selectedMultiIds.length === 0) {
      if (selectedStrategy) {
        setSelectedMultiIds([selectedStrategy.id]);
      } else {
        setSelectedMultiIds(strategies.slice(0, 2).map(s => s.id));
      }
    }
  }, [strategies, selectedStrategy]);

  // Keep single view synchronized if external selectedStrategy changes
  useEffect(() => {
    if (viewScope === 'single' && selectedStrategy) {
      if (!selectedMultiIds.includes(selectedStrategy.id)) {
        setSelectedMultiIds([selectedStrategy.id]);
      }
    }
  }, [selectedStrategy?.id]);

  // Target strategies currently active in this heatmap view
  const activeStrategies = useMemo(() => {
    if (viewScope === 'combined_all') return strategies;
    if (viewScope === 'combined_live') return strategies.filter(s => s.executionMode === 'live');
    if (viewScope === 'combined_paper') return strategies.filter(s => (s.executionMode || 'paper') === 'paper');
    if (viewScope === 'custom_multi') {
      const filtered = strategies.filter(s => selectedMultiIds.includes(s.id));
      return filtered.length > 0 ? filtered : strategies.slice(0, 1);
    }
    // Single mode:
    if (selectedStrategy) return [selectedStrategy];
    return strategies.length > 0 ? [strategies[0]] : [];
  }, [viewScope, strategies, selectedStrategy, selectedMultiIds]);

  // Live aggregate session PnL for active scope
  const aggregateActivePnL = useMemo(() => {
    const targetIds = new Set(activeStrategies.map(s => s.id));
    const matched = strategyPnL.filter(p => targetIds.has(p.strategyId));
    const totalPnL = matched.reduce((acc, p) => acc + (p.totalPnL || 0), 0);
    const realizedPnL = matched.reduce((acc, p) => acc + (p.realizedPnL || 0), 0);
    const unrealizedPnL = matched.reduce((acc, p) => acc + (p.unrealizedPnL || 0), 0);
    const totalTrades = matched.reduce((acc, p) => acc + (p.totalTrades || 0), 0);
    const wins = matched.reduce((acc, p) => acc + (p.winningTrades || 0), 0);
    const losses = matched.reduce((acc, p) => acc + (p.losingTrades || 0), 0);
    const volumeUSD = matched.reduce((acc, p) => acc + (p.volumeTradedUSD || 0), 0);
    return { totalPnL, realizedPnL, unrealizedPnL, totalTrades, wins, losses, volumeUSD };
  }, [activeStrategies, strategyPnL]);

  // Fetch or compute monthly daily P&L heatmap data for selected scope, year and month
  const loadDailyHeatmap = async () => {
    if (activeStrategies.length === 0) {
      setHeatmapData(null);
      setSelectedDay(null);
      return;
    }

    setIsLoading(true);
    let targetEndpointId = "combined_all";
    let queryParams = `year=${selectedYear}&month=${selectedMonth}`;

    if (viewScope === 'single') {
      targetEndpointId = activeStrategies[0].id;
    } else if (viewScope === 'combined_all') {
      targetEndpointId = "combined_all";
    } else if (viewScope === 'combined_live') {
      targetEndpointId = "combined_live";
    } else if (viewScope === 'combined_paper') {
      targetEndpointId = "combined_paper";
    } else if (viewScope === 'custom_multi') {
      targetEndpointId = "custom_multi";
      queryParams += `&strategies=${activeStrategies.map(s => s.id).join(',')}`;
    }

    try {
      const res = await fetch(`/api/pnl/daily/${targetEndpointId}?${queryParams}`);
      if (res.ok) {
        const json = await res.json();
        setHeatmapData(json);
        
        if (json.days && json.days.length > 0) {
          const todayItem = json.days.find((d: DailyPnLDay) => d.isToday);
          const firstActive = json.days.find((d: DailyPnLDay) => d.tradesCount > 0 || d.pnl !== 0);
          setSelectedDay(todayItem || firstActive || json.days[0]);
        }
        setIsLoading(false);
        return;
      }
    } catch {
      // Fallback
    }

    // Client-side fallback generator
    const localYear = now.getFullYear();
    const localMonth = String(now.getMonth() + 1).padStart(2, '0');
    const localDay = String(now.getDate()).padStart(2, '0');
    const todayStr = `${localYear}-${localMonth}-${localDay}`;
    const todayUtcStr = now.toISOString().split("T")[0];

    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
    const monthObj = MONTHS_LIST.find(m => m.index === selectedMonth) || MONTHS_LIST[selectedMonth - 1];
    const monthLabel = monthObj.short;

    const days: DailyPnLDay[] = [];
    const todayPnL = aggregateActivePnL.totalPnL;
    const todayTrades = aggregateActivePnL.totalTrades;
    const todayWins = aggregateActivePnL.wins;
    const todayLosses = aggregateActivePnL.losses;
    const todayVolume = aggregateActivePnL.volumeUSD;

    const activeWorkersCount = strategies.filter(s => s.status === 'active').length;
    const hasLiveStrategy = activeStrategies.some(s => s.executionMode === 'live');

    for (let dNum = 1; dNum <= daysInMonth; dNum++) {
      const d = new Date(selectedYear, selectedMonth - 1, dNum);
      const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
      const isToday = dateStr === todayStr || dateStr === todayUtcStr;
      const isFuture = d.getTime() > now.getTime() && !isToday;
      const dayOfWeek = d.getDay();
      const formattedDate = `${monthLabel} ${String(dNum).padStart(2, '0')}, ${selectedYear}`;

      const pnl = isToday ? Number(todayPnL.toFixed(2)) : 0;
      const realizedPnL = isToday ? Number(aggregateActivePnL.realizedPnL.toFixed(2)) : 0;
      const unrealizedPnL = isToday ? Number(aggregateActivePnL.unrealizedPnL.toFixed(2)) : 0;
      const tradesCount = isToday ? todayTrades : 0;
      const wins = isToday ? todayWins : 0;
      const losses = isToday ? todayLosses : 0;
      const volumeUSD = isToday ? Number(todayVolume.toFixed(2)) : 0;
      const winRate = tradesCount > 0 ? Number(((wins / tradesCount) * 100).toFixed(1)) : 0;

      days.push({
        date: dateStr,
        formattedDate,
        dayOfWeek,
        dayLabel: WEEKDAYS[dayOfWeek],
        dayOfMonth: dNum,
        monthLabel,
        pnl,
        realizedPnL,
        unrealizedPnL,
        tradesCount,
        wins,
        losses,
        winRate,
        volumeUSD,
        isToday,
        isFuture,
        machineState: {
          automationLevel: hasLiveStrategy ? 4 : 2,
          executionMode: hasLiveStrategy ? 'live' : 'paper',
          engineStatus: activeWorkersCount > 0 ? 'active' : 'idle',
          activeWorkersCount,
          daemonHealth: 'CL-ACTIVE (Daemon Live)'
        }
      });
    }

    const total30DPnL = Number(days.reduce((acc, d) => acc + d.pnl, 0).toFixed(2));
    const greenDays = days.filter(d => d.pnl > 0).length;
    const redDays = days.filter(d => d.pnl < 0).length;
    const flatDays = days.filter(d => d.pnl === 0).length;

    const activeDays = days.filter(d => d.tradesCount > 0 || d.pnl !== 0 || d.isToday);
    const candidateDays = activeDays.length > 0 ? activeDays : [days[0]];

    let bestDay = { date: candidateDays[0].date, formattedDate: candidateDays[0].formattedDate, pnl: candidateDays[0].pnl };
    let worstDay = { date: candidateDays[0].date, formattedDate: candidateDays[0].formattedDate, pnl: candidateDays[0].pnl };
    for (const d of candidateDays) {
      if (d.pnl > bestDay.pnl) bestDay = { date: d.date, formattedDate: d.formattedDate, pnl: d.pnl };
      if (d.pnl < worstDay.pnl) worstDay = { date: d.date, formattedDate: d.formattedDate, pnl: d.pnl };
    }

    const activeDayCount = greenDays + redDays;
    const displayName = viewScope === 'single'
      ? activeStrategies[0]?.name || "Strategy"
      : viewScope === 'combined_all'
      ? "All Strategies (Combined Portfolio)"
      : viewScope === 'combined_live'
      ? "All Live Strategies (L4 Combined)"
      : viewScope === 'combined_paper'
      ? "All Paper Strategies (L2 Combined)"
      : `Combined (${activeStrategies.length} Strategies)`;

    const displayPair = viewScope === 'single'
      ? activeStrategies[0]?.assetPair || "ASSET"
      : viewScope === 'combined_live'
      ? "LIVE Q"
      : viewScope === 'combined_paper'
      ? "PAPER Q"
      : "PORTFOLIO";

    const mockData: DailyPnLHeatmapData = {
      strategyId: targetEndpointId,
      strategyName: displayName,
      assetPair: displayPair,
      year: selectedYear,
      month: selectedMonth,
      monthLabel,
      days,
      total30DPnL,
      totalMonthPnL: total30DPnL,
      greenDays,
      redDays,
      flatDays,
      bestDay,
      worstDay,
      winRatePercent: activeDayCount > 0 ? Number(((greenDays / activeDayCount) * 100).toFixed(1)) : 0,
      avgDailyPnL: Number((total30DPnL / Math.max(1, activeDayCount || 1)).toFixed(2)),
      profitFactor: todayPnL >= 0 ? 99.0 : 0.0
    };

    setHeatmapData(mockData);
    if (days.length > 0) {
      const todayItem = days.find(d => d.isToday);
      setSelectedDay(todayItem || days[0]);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadDailyHeatmap();
  }, [viewScope, selectedStrategy?.id, selectedMultiIds, selectedYear, selectedMonth]);

  // Sync today's live session in real-time
  useEffect(() => {
    if (heatmapData && heatmapData.days.length > 0) {
      setHeatmapData(prev => {
        if (!prev) return prev;
        const todayIdx = prev.days.findIndex(d => d.isToday);
        if (todayIdx === -1) return prev;

        const updatedDays = [...prev.days];
        const today = updatedDays[todayIdx];
        const newPnL = Number((today.realizedPnL + aggregateActivePnL.unrealizedPnL).toFixed(2));
        updatedDays[todayIdx] = {
          ...today,
          pnl: newPnL,
          unrealizedPnL: aggregateActivePnL.unrealizedPnL,
          tradesCount: aggregateActivePnL.totalTrades > 0 ? aggregateActivePnL.totalTrades : today.tradesCount,
          wins: aggregateActivePnL.wins > 0 ? aggregateActivePnL.wins : today.wins,
          losses: aggregateActivePnL.losses > 0 ? aggregateActivePnL.losses : today.losses,
          volumeUSD: aggregateActivePnL.volumeUSD > 0 ? aggregateActivePnL.volumeUSD : today.volumeUSD
        };

        return {
          ...prev,
          days: updatedDays,
          total30DPnL: Number(updatedDays.reduce((acc, d) => acc + d.pnl, 0).toFixed(2)),
          totalMonthPnL: Number(updatedDays.reduce((acc, d) => acc + d.pnl, 0).toFixed(2))
        };
      });
    }
  }, [aggregateActivePnL.unrealizedPnL, aggregateActivePnL.totalPnL]);

  // Heatmap Color Categorization
  const getCellStyling = (day: DailyPnLDay, isSelected: boolean) => {
    const val = day.pnl;
    let bgClasses = "bg-zinc-950/70 border-zinc-850/60 text-zinc-600";
    let glow = "";

    if (day.isFuture) {
      bgClasses = "bg-zinc-950/40 border-zinc-900/60 text-zinc-700 opacity-60";
    } else if (val >= 75) {
      bgClasses = "bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold border-emerald-400";
      glow = "shadow-[0_0_10px_rgba(16,185,129,0.35)]";
    } else if (val >= 30) {
      bgClasses = "bg-emerald-600 hover:bg-emerald-500 text-white font-semibold border-emerald-500";
      glow = "shadow-[0_0_6px_rgba(16,185,129,0.2)]";
    } else if (val >= 10) {
      bgClasses = "bg-emerald-700/90 hover:bg-emerald-600 text-emerald-100 border-emerald-600";
    } else if (val > 0) {
      bgClasses = "bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border-emerald-800/80";
    } else if (val === 0) {
      if (day.isToday) {
        bgClasses = "bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 border-zinc-700";
      } else {
        bgClasses = "bg-zinc-950/60 hover:bg-zinc-900/80 text-zinc-600 border-zinc-850/50";
      }
    } else if (val > -15) {
      bgClasses = "bg-rose-950/70 hover:bg-rose-900 text-rose-300 border-rose-900/60";
    } else if (val > -50) {
      bgClasses = "bg-rose-800/90 hover:bg-rose-700 text-rose-100 font-semibold border-rose-700";
    } else {
      bgClasses = "bg-rose-600 hover:bg-rose-500 text-white font-bold border-rose-400";
      glow = "shadow-[0_0_10px_rgba(244,63,94,0.35)]";
    }

    const selectionRing = isSelected ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-zinc-950 scale-105 z-10 font-bold" : "";
    const todayIndicator = day.isToday ? "outline outline-1 outline-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.3)]" : "";

    return `${bgClasses} ${glow} ${selectionRing} ${todayIndicator}`;
  };

  const activeDay = hoveredDay || selectedDay;
  const currentMonthName = MONTHS_LIST.find(m => m.index === selectedMonth)?.full || "August";

  const firstDayOfMonthOffset = useMemo(() => {
    if (!heatmapData || !heatmapData.days || heatmapData.days.length === 0) return 0;
    return heatmapData.days[0].dayOfWeek;
  }, [heatmapData]);

  // Handle Strategy Multi-Select Toggle
  const handleToggleMultiStrategy = (stratId: string) => {
    setSelectedMultiIds(prev => {
      if (prev.includes(stratId)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter(id => id !== stratId);
      } else {
        return [...prev, stratId];
      }
    });
  };

  // Label for the active dropdown selector button
  const dropdownButtonLabel = useMemo(() => {
    if (viewScope === 'combined_all') return "Combined (All Strategies)";
    if (viewScope === 'combined_live') return "Combined (All Live L4 Strategies)";
    if (viewScope === 'combined_paper') return "Combined (All Paper L2 Strategies)";
    if (viewScope === 'custom_multi') return `Multi-Select (${selectedMultiIds.length} Strategies)`;
    return selectedStrategy ? selectedStrategy.name : (activeStrategies[0]?.name || "Select Strategy");
  }, [viewScope, selectedStrategy, activeStrategies, selectedMultiIds]);

  return (
    <div id="calendar-heatmap-card" className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg shadow-md space-y-3 font-mono">
      {/* Header with Title & Strategy Performance Dropdown Selector */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3 flex-wrap gap-2">
        <div className="space-y-1.5 flex-1 min-w-[280px]">
          <div className="flex items-center space-x-1.5">
            <CalendarIcon className="w-4 h-4 text-emerald-400" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Daily P&amp;L Performance Heatmap
            </h4>
          </div>

          {/* Interactive Strategy & Combined Performance Dropdown Menu */}
          <div className="relative inline-block text-left" ref={dropdownRef}>
            <div className="text-[10px] text-zinc-400 flex items-center space-x-1.5">
              <span id="target-strategy-label" className="text-zinc-500 font-medium">Target View:</span>
              
              <button
                type="button"
                id="heatmap-scope-dropdown-button"
                onClick={() => setIsDropdownOpen(prev => !prev)}
                className="bg-zinc-950 hover:bg-zinc-850 border border-zinc-750 hover:border-emerald-500/70 px-2.5 py-1 rounded text-[11px] font-semibold text-emerald-300 flex items-center space-x-2 transition-all shadow-sm cursor-pointer"
              >
                <span id="heatmap-target-strategy-name" className="truncate max-w-[200px] sm:max-w-[240px]">
                  {dropdownButtonLabel}
                </span>
                <span id="heatmap-target-asset-pair" className="bg-zinc-900 border border-zinc-800 px-1 py-0.2 rounded text-[9px] text-zinc-300 uppercase">
                  {heatmapData?.assetPair || "PORTFOLIO"}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${isDropdownOpen ? 'rotate-180 text-emerald-400' : ''}`} />
              </button>
            </div>

            {/* Dropdown Menu Overlay */}
            <AnimatePresence>
              {isDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0 top-full mt-1.5 w-80 max-w-[90vw] bg-zinc-950 border border-zinc-750 rounded-lg shadow-2xl z-50 p-2 font-mono space-y-2"
                >
                  {/* Preset Combined Modes */}
                  <div className="space-y-1">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold px-1.5 flex items-center justify-between">
                      <span>Combined Performance Views</span>
                      <Layers className="w-3 h-3 text-emerald-400" />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setViewScope('combined_all');
                        setIsDropdownOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded text-[11px] flex items-center justify-between transition-all cursor-pointer ${
                        viewScope === 'combined_all'
                          ? 'bg-emerald-950/80 border border-emerald-700/80 text-emerald-200 font-bold'
                          : 'hover:bg-zinc-900 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span>All Strategies Combined</span>
                      </div>
                      <span className="text-[9px] text-zinc-500 font-mono">Portfolio</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setViewScope('combined_live');
                        setIsDropdownOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded text-[11px] flex items-center justify-between transition-all cursor-pointer ${
                        viewScope === 'combined_live'
                          ? 'bg-rose-950/80 border border-rose-700/80 text-rose-200 font-bold'
                          : 'hover:bg-zinc-900 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 rounded-full bg-rose-400" />
                        <span>All Live (L4) Strategies Combined</span>
                      </div>
                      <span className="text-[9px] text-rose-400/80 font-mono">Live Q</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setViewScope('combined_paper');
                        setIsDropdownOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded text-[11px] flex items-center justify-between transition-all cursor-pointer ${
                        viewScope === 'combined_paper'
                          ? 'bg-amber-950/80 border border-amber-700/80 text-amber-200 font-bold'
                          : 'hover:bg-zinc-900 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 rounded-full bg-amber-400" />
                        <span>All Paper (L2) Strategies Combined</span>
                      </div>
                      <span className="text-[9px] text-amber-400/80 font-mono">Paper Q</span>
                    </button>
                  </div>

                  {/* Multi-Strategy Toggle Selector */}
                  <div className="pt-2 border-t border-zinc-800/80 space-y-1">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold px-1.5 flex items-center justify-between">
                      <span>Compare Specific Strategies (Toggle)</span>
                      <SlidersHorizontal className="w-3 h-3 text-amber-400" />
                    </div>

                    <div className="max-h-36 overflow-y-auto terminal-scroll space-y-1 pr-1">
                      {strategies.map((strat) => {
                        const isChecked = selectedMultiIds.includes(strat.id);
                        const isSingleActive = viewScope === 'single' && selectedStrategy?.id === strat.id;

                        return (
                          <div 
                            key={strat.id}
                            className="flex items-center justify-between px-2 py-1 rounded bg-zinc-900/60 hover:bg-zinc-900 text-[11px]"
                          >
                            {/* Checkbox for custom multi-compare */}
                            <label className="flex items-center space-x-2 cursor-pointer flex-1 min-w-0">
                              <input 
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setViewScope('custom_multi');
                                  handleToggleMultiStrategy(strat.id);
                                }}
                                className="w-3.5 h-3.5 rounded bg-zinc-950 border-zinc-700 text-emerald-500 focus:ring-0 cursor-pointer accent-emerald-500"
                              />
                              <div className="min-w-0">
                                <span className="font-semibold text-zinc-200 truncate block text-[11px]">
                                  {strat.name}
                                </span>
                                <span className="text-[9px] text-zinc-500 font-mono">
                                  {strat.assetPair} • {strat.executionMode === 'live' ? 'Live Q' : 'Paper Q'}
                                </span>
                              </div>
                            </label>

                            {/* Direct single selection button */}
                            <button
                              type="button"
                              onClick={() => {
                                setViewScope('single');
                                setSelectedMultiIds([strat.id]);
                                if (onSelectStrategy) onSelectStrategy(strat.id);
                                setIsDropdownOpen(false);
                              }}
                              title="View single strategy stats"
                              className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold border transition-colors cursor-pointer ${
                                isSingleActive
                                  ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                                  : 'bg-zinc-950 text-zinc-400 hover:text-white border-zinc-800'
                              }`}
                            >
                              Solo
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Multi Mode Apply Button */}
                  {viewScope === 'custom_multi' && (
                    <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                      <span className="text-[9px] text-zinc-400">
                        {selectedMultiIds.length} strategies selected
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsDropdownOpen(false)}
                        className="px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold text-[10px] transition-colors"
                      >
                        Apply View
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-emerald-400">
            {currentMonthName} {selectedYear}
          </span>
          <button
            onClick={loadDailyHeatmap}
            disabled={isLoading || activeStrategies.length === 0}
            title="Refresh heatmap for selected month/year"
            className="p-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </div>

      {activeStrategies.length > 0 && heatmapData ? (
        <div className="space-y-3">
          {/* Active View Scope Details Pill */}
          <div className="flex items-center justify-between text-[10px] text-zinc-400 bg-zinc-950/60 px-2.5 py-1 rounded border border-zinc-850 flex-wrap gap-1">
            <div className="flex items-center space-x-1.5">
              <span className="text-zinc-500">Active Aggregate:</span>
              <span className="text-emerald-300 font-bold">{heatmapData.strategyName}</span>
            </div>
            <div className="flex items-center space-x-2 text-zinc-500 font-mono text-[9px]">
              <span>Strategies: <strong className="text-zinc-300">{activeStrategies.length}</strong></span>
              <span>•</span>
              <span>Live Unrealized: <strong className={aggregateActivePnL.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {aggregateActivePnL.unrealizedPnL >= 0 ? '+' : ''}${aggregateActivePnL.unrealizedPnL.toFixed(2)}
              </strong></span>
            </div>
          </div>

          {/* Top Performance Summary Bar for Selected Month */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-zinc-950/80 border border-zinc-850 p-2.5 rounded">
              <span className="text-[9px] text-zinc-500 block uppercase font-medium">Month Net P&amp;L</span>
              <div className="flex items-baseline space-x-1 mt-0.5">
                <span className={`text-sm font-bold ${heatmapData.total30DPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {heatmapData.total30DPnL >= 0 ? '+' : ''}${heatmapData.total30DPnL.toFixed(2)}
                </span>
                <span className="text-[9px] text-zinc-500">USD</span>
              </div>
              <span className="text-[9px] text-zinc-400">Avg: ${heatmapData.avgDailyPnL.toFixed(2)}/active d</span>
            </div>

            <div className="bg-zinc-950/80 border border-zinc-850 p-2.5 rounded">
              <span className="text-[9px] text-zinc-500 block uppercase font-medium">Win Ratio (Days)</span>
              <div className="flex items-baseline space-x-1 mt-0.5">
                <span className="text-sm font-bold text-white">
                  {heatmapData.winRatePercent}%
                </span>
                <span className="text-[9px] text-emerald-400 font-semibold">Green</span>
              </div>
              <span className="text-[9px] text-zinc-400">
                {heatmapData.greenDays}W / {heatmapData.redDays}L / {heatmapData.flatDays}F
              </span>
            </div>

            <div className="bg-zinc-950/80 border border-zinc-850 p-2.5 rounded">
              <span className="text-[9px] text-zinc-500 block uppercase font-medium">Best Day</span>
              <div className="flex items-baseline space-x-1 mt-0.5">
                <span className="text-sm font-bold text-emerald-400">
                  {heatmapData.bestDay.pnl > 0 ? '+' : ''}${heatmapData.bestDay.pnl.toFixed(2)}
                </span>
              </div>
              <span className="text-[9px] text-zinc-400 truncate block">
                {heatmapData.bestDay.formattedDate.split(',')[0]}
              </span>
            </div>

            <div className="bg-zinc-950/80 border border-zinc-850 p-2.5 rounded">
              <span className="text-[9px] text-zinc-500 block uppercase font-medium">Worst Day</span>
              <div className="flex items-baseline space-x-1 mt-0.5">
                <span className={`text-sm font-bold ${heatmapData.worstDay.pnl < 0 ? 'text-rose-400' : 'text-zinc-300'}`}>
                  {heatmapData.worstDay.pnl >= 0 ? '+' : ''}${heatmapData.worstDay.pnl.toFixed(2)}
                </span>
              </div>
              <span className="text-[9px] text-zinc-400 truncate block">
                {heatmapData.worstDay.formattedDate.split(',')[0]}
              </span>
            </div>
          </div>

          {/* CALENDAR HEATMAP MATRIX & DATE SELECTORS */}
          <div className="bg-zinc-950/90 border border-zinc-800/80 p-3 rounded-lg space-y-3">
            
            {/* ROW 1: YEAR SELECTION (2025, 2026, 2027, 2028) */}
            <div className="flex items-center justify-between border-b border-zinc-850 pb-2.5 flex-wrap gap-2">
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-zinc-400 uppercase font-semibold tracking-wider">Year:</span>
                <div className="inline-flex rounded-md p-0.5 bg-zinc-900 border border-zinc-800 space-x-1">
                  {AVAILABLE_YEARS.map((year) => {
                    const isSelected = selectedYear === year;
                    return (
                      <button
                        key={year}
                        onClick={() => setSelectedYear(year)}
                        className={`px-2.5 py-0.5 text-xs font-semibold rounded transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-500 text-zinc-950 shadow-sm font-bold'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80'
                        }`}
                      >
                        {year}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="text-[10px] text-zinc-500 hidden sm:flex items-center space-x-1">
                <span>Selected:</span>
                <span className="text-zinc-300 font-bold">{currentMonthName} {selectedYear}</span>
              </div>
            </div>

            {/* ROW 2: MONTH SELECTION (LEFT TO RIGHT: JAN - DEC) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-zinc-400">
                <span className="uppercase font-semibold tracking-wider text-zinc-400">Month:</span>
                <span className="text-[9px] text-zinc-500">Select month to view daily P&amp;L</span>
              </div>
              <div className="grid grid-cols-6 sm:grid-cols-12 gap-1 overflow-x-auto pb-0.5">
                {MONTHS_LIST.map((m) => {
                  const isSelected = selectedMonth === m.index;
                  return (
                    <button
                      key={m.index}
                      onClick={() => setSelectedMonth(m.index)}
                      className={`px-1.5 py-1 text-[11px] font-semibold rounded border text-center transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.25)] font-bold'
                          : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850 border-zinc-800'
                      }`}
                    >
                      {m.short}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ROW 3: DAILY PERFORMANCE CALENDAR GRID */}
            <div className="space-y-1.5 pt-1 border-t border-zinc-850">
              {/* Weekday Header Columns */}
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-zinc-500 pb-1">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="py-0.5">
                    {day}
                  </div>
                ))}
              </div>

              {/* Month Days Grid with Day-of-Week Alignment */}
              <div className="grid grid-cols-7 gap-1.5">
                {/* Empty placeholder cells for days before the 1st of month */}
                {Array.from({ length: firstDayOfMonthOffset }).map((_, idx) => (
                  <div 
                    key={`empty-${idx}`} 
                    className="h-12 rounded-md bg-zinc-950/20 border border-transparent opacity-20 pointer-events-none" 
                  />
                ))}

                {/* Actual Days of the Month */}
                {heatmapData.days.map((day) => {
                  const isSelected = selectedDay?.date === day.date;
                  const isHovered = hoveredDay?.date === day.date;
                  const cellClasses = getCellStyling(day, isSelected);

                  return (
                    <button
                      key={day.date}
                      onClick={() => {
                        setSelectedDay(day);
                        if (onSelectDate) onSelectDate(day.date);
                      }}
                      onMouseEnter={() => setHoveredDay(day)}
                      onMouseLeave={() => setHoveredDay(null)}
                      className={`h-12 p-1 rounded-md border flex flex-col justify-between items-center transition-all cursor-pointer text-center relative ${cellClasses}`}
                    >
                      <div className="w-full flex justify-between items-center text-[9px] leading-none px-0.5">
                        <span className="opacity-70 font-mono text-[8px]">{day.dayLabel}</span>
                        <span className="font-bold">{day.dayOfMonth}</span>
                      </div>

                      <div className="text-[10px] font-mono leading-tight font-bold">
                        {day.isFuture ? (
                          <span className="opacity-30">—</span>
                        ) : day.pnl === 0 ? (
                          <span className="opacity-40">{day.isToday || day.tradesCount > 0 ? "$0" : "—"}</span>
                        ) : (
                          <span>
                            {day.pnl > 0 ? '+' : ''}${Math.abs(day.pnl) >= 100 ? day.pnl.toFixed(0) : day.pnl.toFixed(0)}
                          </span>
                        )}
                      </div>

                      {/* Machine state indicator dot on stone */}
                      {day.isToday ? (
                        <span className="w-1.5 h-1.5 bg-amber-400 rounded-full absolute -top-0.5 -right-0.5 ring-1 ring-zinc-950 shadow-[0_0_6px_rgba(251,191,36,0.8)]" title="Today (Machine Active Live Session)" />
                      ) : day.tradesCount > 0 ? (
                        <span className="w-1 h-1 bg-emerald-400 rounded-full absolute -top-0.5 -right-0.5 opacity-80" title="Machine Trades Recorded" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* INTENSITY SCALE LEGEND */}
            <div className="flex items-center justify-between text-[9px] text-zinc-500 pt-2 border-t border-zinc-850 flex-wrap gap-2">
              <span className="uppercase tracking-wider font-semibold">P&amp;L Scale:</span>
              <div className="flex items-center space-x-1">
                <span className="text-[8px] text-rose-400 mr-1">&lt; -$50</span>
                <span className="w-3 h-3 rounded-xs bg-rose-600 border border-rose-400" title="Heavy Loss (< -$50)" />
                <span className="w-3 h-3 rounded-xs bg-rose-800 border border-rose-700" title="Moderate Loss (-$50 to -$15)" />
                <span className="w-3 h-3 rounded-xs bg-rose-950 border border-rose-900" title="Mild Loss (-$15 to -$0.01)" />
                <span className="w-3 h-3 rounded-xs bg-zinc-950 border border-zinc-800" title="Flat / Untraded ($0.00)" />
                <span className="w-3 h-3 rounded-xs bg-emerald-950 border border-emerald-800" title="Mild Profit (+$0.01 to +$10)" />
                <span className="w-3 h-3 rounded-xs bg-emerald-700 border border-emerald-600" title="Moderate Profit (+$10 to +$30)" />
                <span className="w-3 h-3 rounded-xs bg-emerald-600 border border-emerald-500" title="Strong Profit (+$30 to +$75)" />
                <span className="w-3 h-3 rounded-xs bg-emerald-500 border border-emerald-400" title="Top Profit (> +$75)" />
                <span className="text-[8px] text-emerald-400 ml-1">&gt; +$75</span>
              </div>
            </div>
          </div>

          {/* ACTIVE DAY BREAKDOWN INSPECTOR */}
          {activeDay && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-zinc-950/80 border border-zinc-800 p-3 rounded-lg space-y-2.5 text-xs"
            >
              <div className="flex items-center justify-between border-b border-zinc-850 pb-1.5 flex-wrap gap-1">
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="font-bold text-white">
                    {activeDay.dayLabel}, {activeDay.formattedDate}
                  </span>
                  {activeDay.isToday && (
                    <span className="text-[9px] px-1.5 py-0.2 bg-amber-950/80 text-amber-300 border border-amber-800/60 rounded font-semibold uppercase">
                      Today (Live Session)
                    </span>
                  )}
                  {activeDay.isFuture && (
                    <span className="text-[9px] px-1.5 py-0.2 bg-zinc-900 text-zinc-400 border border-zinc-800 rounded font-medium">
                      Future Date
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-1">
                  <span className="text-[10px] text-zinc-500">Day Return:</span>
                  <span className={`font-bold px-2 py-0.5 rounded border text-xs ${
                    activeDay.pnl > 0
                      ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-400'
                      : activeDay.pnl < 0
                      ? 'bg-rose-950/60 border-rose-800/60 text-rose-400'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                  }`}>
                    {activeDay.pnl > 0 ? '+' : ''}${activeDay.pnl.toFixed(2)} USD
                  </span>
                </div>
              </div>

              {/* Machine State Presence Bar for Selected Date */}
              <div className="bg-zinc-900/90 border border-zinc-800 p-2 rounded flex items-center justify-between flex-wrap gap-2 text-[10px] font-mono">
                <div className="flex items-center space-x-2">
                  <span className="text-zinc-500 uppercase font-semibold">Machine State:</span>
                  <span className={`px-1.5 py-0.5 rounded font-bold uppercase ${
                    (activeDay.machineState?.executionMode || 'paper') === 'live'
                      ? 'bg-rose-950 text-rose-300 border border-rose-700'
                      : 'bg-amber-950 text-amber-300 border border-amber-700'
                  }`}>
                    {(activeDay.machineState?.executionMode || 'paper') === 'live' ? 'Level 4 Live Autonomous' : 'Level 2 Paper Guarded'}
                  </span>
                </div>

                <div className="flex items-center space-x-3 text-zinc-400">
                  <span className="flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{activeDay.machineState?.daemonHealth || 'CL-ACTIVE (Daemon Live)'}</span>
                  </span>
                  <span>•</span>
                  <span>Engine: <strong className="text-white">{activeDay.machineState?.engineStatus === 'active' ? 'Active Workers' : 'Cluster Standby'}</strong></span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-0.5">
                <div className="flex justify-between border-r border-zinc-850/60 pr-2">
                  <span className="text-zinc-500">Closed Trades:</span>
                  <span className="font-semibold text-zinc-200">{activeDay.tradesCount}</span>
                </div>
                <div className="flex justify-between border-r border-zinc-850/60 pr-2">
                  <span className="text-zinc-500">Win Rate:</span>
                  <span className={`font-semibold ${activeDay.winRate >= 50 ? 'text-emerald-400' : 'text-zinc-300'}`}>
                    {activeDay.winRate}% ({activeDay.wins}W / {activeDay.losses}L)
                  </span>
                </div>
                <div className="flex justify-between border-r border-zinc-850/60 pr-2">
                  <span className="text-zinc-500">Volume Traded:</span>
                  <span className="font-semibold text-zinc-200">${activeDay.volumeUSD.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Realized P&amp;L:</span>
                  <span className={`font-semibold ${activeDay.realizedPnL > 0 ? 'text-emerald-400' : activeDay.realizedPnL < 0 ? 'text-rose-400' : 'text-zinc-400'}`}>
                    {activeDay.realizedPnL > 0 ? '+' : ''}${activeDay.realizedPnL.toFixed(2)}
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      ) : (
        <div className="p-6 bg-zinc-950/40 border border-dashed border-zinc-800 rounded text-center text-zinc-500 text-xs font-mono space-y-1">
          <CalendarIcon className="w-6 h-6 mx-auto text-zinc-600 mb-1" />
          <p>No strategies configured to display in heatmap.</p>
        </div>
      )}
    </div>
  );
}
