import React, { useState, useMemo } from "react";
import { 
  Search, X, Check, Filter, Layers, Zap, ArrowUpDown, 
  ExternalLink, Globe, Sparkles, RefreshCw, BarChart2, ArrowRight
} from "lucide-react";
import { KrakenSymbolInfo } from "../types";
import { ExchangeSymbolNormalizer } from "../lib/symbolNormalizer";

interface KrakenSymbolModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSymbol: (symbol: string) => void;
  currentSymbol?: string;
  symbols: KrakenSymbolInfo[];
  isLoading?: boolean;
  onRefreshSymbols?: () => void;
}

export default function KrakenSymbolModal({
  isOpen,
  onClose,
  onSelectSymbol,
  currentSymbol,
  symbols,
  isLoading = false,
  onRefreshSymbols
}: KrakenSymbolModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedQuote, setSelectedQuote] = useState("ALL");
  const [leverageOnly, setLeverageOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'symbol' | 'base' | 'quote'>('symbol');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const quotes = useMemo(() => {
    const set = new Set<string>();
    symbols.forEach(s => {
      if (s.quote) set.add(s.quote);
    });
    const mainQuotes = ["ALL", "USD", "EUR", "USDT", "USDC", "BTC", "ETH", "GBP", "CAD", "AUD"];
    const otherQuotes = Array.from(set).filter(q => !mainQuotes.includes(q)).sort();
    return [...mainQuotes.filter(q => q === "ALL" || set.has(q)), ...otherQuotes];
  }, [symbols]);

  const filteredSymbols = useMemo(() => {
    let list = symbols;

    if (selectedQuote !== "ALL") {
      list = list.filter(s => s.quote.toUpperCase() === selectedQuote.toUpperCase() || s.symbol.endsWith(`/${selectedQuote}`));
    }

    if (leverageOnly) {
      list = list.filter(s => s.hasLeverage);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toUpperCase();
      list = list.filter(s => 
        s.symbol.toUpperCase().includes(q) ||
        s.altname.toUpperCase().includes(q) ||
        s.base.toUpperCase().includes(q) ||
        s.wsname.toUpperCase().includes(q)
      );
    }

    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'symbol') {
        cmp = a.symbol.localeCompare(b.symbol);
      } else if (sortBy === 'base') {
        cmp = a.base.localeCompare(b.base);
      } else if (sortBy === 'quote') {
        cmp = a.quote.localeCompare(b.quote);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [symbols, selectedQuote, leverageOnly, searchQuery, sortBy, sortOrder]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="bg-zinc-900 px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded bg-emerald-950 border border-emerald-800 flex items-center justify-center">
              <Globe className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-sm font-bold text-white uppercase tracking-wider">
                  Kraken & Kraken Pro Symbol Directory
                </span>
                <span className="bg-emerald-950 border border-emerald-800 text-emerald-400 text-[10px] font-mono px-2 py-0.5 rounded font-semibold">
                  {symbols.length > 0 ? `${symbols.length.toLocaleString()} Pairs` : 'Live API'}
                </span>
              </div>
              <span className="text-[11px] font-mono text-zinc-400">
                Direct Kraken REST/WebSocket public markets & Spot pair catalog
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {onRefreshSymbols && (
              <button
                onClick={onRefreshSymbols}
                disabled={isLoading}
                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-2.5 py-1.5 rounded text-xs font-mono transition-all flex items-center space-x-1 disabled:opacity-50"
                title="Refresh symbol catalog from Kraken API"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : 'text-zinc-400'}`} />
                <span className="hidden sm:inline">Sync</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="bg-zinc-900/60 p-4 border-b border-zinc-800 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by ticker, token name, or base asset (e.g. BTC, ETH, SOL, PEPE, EUR, DOGE)..."
                autoFocus
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-700 rounded-md pl-9 pr-8 py-2 text-xs font-mono text-white placeholder-zinc-600 focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Leverage Toggle Filter */}
            <button
              onClick={() => setLeverageOnly(!leverageOnly)}
              className={`px-3 py-2 rounded-md text-xs font-mono border transition-all flex items-center space-x-1.5 shrink-0 ${
                leverageOnly 
                  ? 'bg-amber-950/80 border-amber-700 text-amber-300' 
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
              }`}
            >
              <Zap className={`w-3.5 h-3.5 ${leverageOnly ? 'text-amber-400 fill-amber-400' : 'text-zinc-500'}`} />
              <span>Margin Pairs</span>
            </button>
          </div>

          {/* Quote Currency Pill Filters */}
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 scrollbar-thin">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mr-1 shrink-0 flex items-center">
              <Filter className="w-3 h-3 mr-1" /> Quote:
            </span>
            {quotes.slice(0, 10).map((q) => (
              <button
                key={q}
                onClick={() => setSelectedQuote(q)}
                className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all shrink-0 font-medium ${
                  selectedQuote === q
                    ? 'bg-emerald-600 text-white font-bold shadow-xs'
                    : 'bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
              >
                {q}
              </button>
            ))}
          </div>

          {/* Live Universal Symbol Parser & Auto-Mapping Preview */}
          {searchQuery.trim().length > 0 && (() => {
            const resolved = ExchangeSymbolNormalizer.resolveAll(searchQuery);
            return (
              <div className="bg-emerald-950/40 border border-emerald-800/80 rounded-md p-3 text-xs font-mono space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-emerald-300">Universal Symbol Normalizer & Auto-Mapping</span>
                  </div>
                  <button
                    onClick={() => {
                      onSelectSymbol(resolved.canonical);
                      onClose();
                    }}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded text-[11px] font-semibold flex items-center space-x-1 shadow-xs transition-colors"
                  >
                    <span>Apply {resolved.canonical}</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  <div className="bg-zinc-950/80 border border-zinc-800 p-2 rounded">
                    <div className="text-[10px] text-zinc-500 uppercase">Canonical UI</div>
                    <div className="font-bold text-white text-xs">{resolved.canonical}</div>
                  </div>
                  <div className="bg-zinc-950/80 border border-zinc-800 p-2 rounded">
                    <div className="text-[10px] text-zinc-500 uppercase">Lake Partition</div>
                    <div className="font-bold text-cyan-400 text-xs">{resolved.lakePartition}</div>
                  </div>
                  <div className="bg-zinc-950/80 border border-zinc-800 p-2 rounded">
                    <div className="text-[10px] text-zinc-500 uppercase">Kraken Spot</div>
                    <div className="font-bold text-amber-400 text-xs">{resolved.krakenSpot}</div>
                  </div>
                  <div className="bg-zinc-950/80 border border-zinc-800 p-2 rounded">
                    <div className="text-[10px] text-zinc-500 uppercase">Kraken Pro Futures</div>
                    <div className="font-bold text-purple-400 text-xs">{resolved.krakenProFutures}</div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Symbols Count & Active Filter Indicator */}
        <div className="bg-zinc-950 px-5 py-2 border-b border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-zinc-400">
          <div>
            <span>Showing </span>
            <span className="text-emerald-400 font-bold">{filteredSymbols.length.toLocaleString()}</span>
            <span> of </span>
            <span className="text-zinc-300 font-semibold">{symbols.length.toLocaleString()}</span>
            <span> Kraken & Kraken Pro market symbols</span>
          </div>

          <div className="flex items-center space-x-3 text-zinc-500 text-[10px]">
            <span>Click any symbol to apply to your strategy runner</span>
          </div>
        </div>

        {/* Symbols Table List */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-zinc-950/90 divide-y divide-zinc-850">
          {isLoading && symbols.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center space-y-3">
              <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin" />
              <p className="text-xs font-mono text-zinc-400">Fetching live Kraken & Kraken Pro symbols catalog from exchange...</p>
            </div>
          ) : filteredSymbols.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center space-y-2">
              <Layers className="w-8 h-8 text-zinc-600 mb-1" />
              <p className="text-xs font-mono text-zinc-300 font-semibold">No Kraken symbols found matching "{searchQuery}"</p>
              <p className="text-[11px] font-mono text-zinc-500">Try clearing filters or searching for alternative base coins like BTC, ETH, SOL, or EUR.</p>
              <button
                onClick={() => { setSearchQuery(""); setSelectedQuote("ALL"); setLeverageOnly(false); }}
                className="mt-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded text-xs font-mono"
              >
                Reset Search Filters
              </button>
            </div>
          ) : (
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead className="bg-zinc-900/90 sticky top-0 z-10 border-b border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Standard Symbol</th>
                  <th className="py-2.5 px-4 font-medium hidden sm:table-cell">Kraken Pro Ticker</th>
                  <th className="py-2.5 px-4 font-medium hidden md:table-cell">Internal Altname</th>
                  <th className="py-2.5 px-4 font-medium hidden sm:table-cell">Decimals (Pair / Lot)</th>
                  <th className="py-2.5 px-4 font-medium">Features</th>
                  <th className="py-2.5 px-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 text-zinc-300">
                {filteredSymbols.map((item) => {
                  const isSelected = currentSymbol === item.symbol || currentSymbol === item.altname || currentSymbol === item.wsname;
                  return (
                    <tr 
                      key={item.altname + item.symbol}
                      onClick={() => {
                        onSelectSymbol(item.symbol);
                        onClose();
                      }}
                      className={`hover:bg-zinc-900/70 transition-colors cursor-pointer group ${
                        isSelected ? 'bg-emerald-950/30' : ''
                      }`}
                    >
                      {/* Standard Symbol */}
                      <td className="py-2.5 px-4">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-white group-hover:text-emerald-400 transition-colors">
                            {item.symbol}
                          </span>
                          {isSelected && (
                            <span className="bg-emerald-900/80 text-emerald-300 text-[9px] px-1.5 py-0.5 rounded font-bold">
                              Current
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Kraken Pro WebSocket Name */}
                      <td className="py-2.5 px-4 hidden sm:table-cell">
                        <span className="text-zinc-400 text-[11px] bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                          {item.wsname || item.symbol}
                        </span>
                      </td>

                      {/* Internal Altname */}
                      <td className="py-2.5 px-4 text-zinc-500 text-[11px] hidden md:table-cell font-mono">
                        {item.altname}
                      </td>

                      {/* Decimals */}
                      <td className="py-2.5 px-4 text-zinc-400 text-[11px] hidden sm:table-cell font-mono">
                        <span>{item.pairDecimals}p / {item.lotDecimals}l</span>
                      </td>

                      {/* Features / Badges */}
                      <td className="py-2.5 px-4">
                        <div className="flex items-center space-x-1.5 flex-wrap gap-1">
                          {item.hasLeverage ? (
                            <span className="bg-amber-950/80 border border-amber-800 text-amber-400 text-[9px] px-1.5 py-0.5 rounded flex items-center font-bold">
                              <Zap className="w-2.5 h-2.5 mr-0.5 fill-amber-400" /> Margin
                            </span>
                          ) : (
                            <span className="bg-zinc-900 text-zinc-500 text-[9px] px-1.5 py-0.5 rounded">
                              Spot
                            </span>
                          )}
                          {item.status === 'online' && (
                            <span className="bg-emerald-950/60 text-emerald-400 text-[9px] px-1.5 py-0.5 rounded border border-emerald-900/40">
                              Active
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Select Action Button */}
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectSymbol(item.symbol);
                            onClose();
                          }}
                          className={`px-3 py-1 rounded text-xs font-mono font-semibold transition-all ${
                            isSelected
                              ? 'bg-emerald-600 text-white'
                              : 'bg-zinc-800 hover:bg-emerald-600 hover:text-white text-zinc-300'
                          }`}
                        >
                          {isSelected ? 'Selected' : 'Use Pair'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-zinc-900 px-5 py-3 border-t border-zinc-800 flex items-center justify-between text-xs font-mono">
          <div className="text-zinc-500 text-[11px] flex items-center space-x-2">
            <span>Powered by official Kraken Public REST API <code>/0/public/AssetPairs</code></span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-1.5 rounded text-xs font-mono transition-all"
            >
              Close Directory
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
