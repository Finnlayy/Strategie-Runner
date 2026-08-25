import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Terminal, Shield, ChevronRight, Play, Square, RefreshCw, Trash2, Filter } from "lucide-react";
import { ExecutionLog } from "../types";

interface TerminalPanelProps {
  logs: ExecutionLog[];
  onSendCommand: (cmd: string) => Promise<string>;
  onClearLogs: () => void;
  onRefresh: () => void;
}

export default function TerminalPanel({ logs, onSendCommand, onClearLogs, onRefresh }: TerminalPanelProps) {
  const [inputValue, setInputValue] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(false);
  const [viewLimit, setViewLimit] = useState<'3' | 'all'>('3');
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Slice logs according to limit setting (defaults to last 3 messages)
  const displayedLogs = viewLimit === '3' ? logs.slice(-3) : logs;

  // Auto Scroll within container only if autoScroll is active
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [displayedLogs, autoScroll]);

  const handleSubmit = async () => {
    if (!inputValue.trim()) return;

    const command = inputValue.trim();
    setCommandHistory(prev => [command, ...prev]);
    setHistoryIndex(-1);
    setInputValue("");

    await onSendCommand(command);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0 && historyIndex < commandHistory.length - 1) {
        const nextIdx = historyIndex + 1;
        setHistoryIndex(nextIdx);
        setInputValue(commandHistory[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setInputValue(commandHistory[nextIdx]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInputValue("");
      }
    }
  };

  const getLogColorClass = (level: string) => {
    switch (level) {
      case 'trade':
        return 'text-emerald-400 font-semibold';
      case 'warn':
        return 'text-amber-400 font-semibold';
      case 'error':
        return 'text-rose-400 font-bold';
      default:
        return 'text-zinc-300';
    }
  };

  return (
    <div className="bg-black border border-zinc-800 rounded-lg h-full flex flex-col overflow-hidden shadow-2xl relative">
      {/* Terminal Title Bar */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-emerald-500" />
          <span className="text-xs font-mono text-zinc-300 font-bold">kraken-cli@headless:~</span>
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* View Limit Selector (Default: Last 3 messages) */}
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded p-0.5 text-[11px] font-mono">
            <button
              id="terminal-filter-last-3"
              onClick={() => setViewLimit('3')}
              title="Only show the last 3 runner log messages"
              className={`px-2 py-0.5 rounded transition-all flex items-center space-x-1 ${
                viewLimit === '3'
                  ? 'bg-emerald-950/80 text-emerald-400 font-bold border border-emerald-800/70 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Filter className="w-2.5 h-2.5" />
              <span>Last 3</span>
            </button>
            <button
              id="terminal-filter-all"
              onClick={() => setViewLimit('all')}
              title="Show all recorded logs"
              className={`px-2 py-0.5 rounded transition-all ${
                viewLimit === 'all'
                  ? 'bg-zinc-800 text-white font-bold border border-zinc-700 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span>All ({logs.length})</span>
            </button>
          </div>

          <button 
            onClick={() => setAutoScroll(!autoScroll)}
            title="Toggle auto-scrolling terminal logs"
            className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${
              autoScroll 
                ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-400' 
                : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Scroll: {autoScroll ? 'ON' : 'OFF'}
          </button>
          <button 
            onClick={onRefresh}
            title="Force synchronization"
            className="p-1 text-zinc-500 hover:text-emerald-400 transition-colors rounded hover:bg-zinc-800"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={onClearLogs}
            title="Flush buffer screen"
            className="p-1 text-zinc-500 hover:text-rose-400 transition-colors rounded hover:bg-zinc-800"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Help Header */}
      <div className="bg-zinc-950/70 border-b border-zinc-900 px-4 py-1.5 text-[11px] font-mono text-zinc-500 flex justify-between items-center">
        <span className="flex items-center space-x-2">
          <span>Displaying {viewLimit === '3' ? 'latest 3 messages' : `all ${logs.length} messages`}</span>
          {viewLimit === '3' && logs.length > 3 && (
            <span className="text-[10px] text-zinc-500 bg-zinc-900 border border-zinc-800 px-1.5 py-0.2 rounded">
              +{logs.length - 3} older buffered
            </span>
          )}
        </span>
        <span className="flex items-center text-emerald-600">
          <Shield className="w-3 h-3 mr-1" /> sandbox mode
        </span>
      </div>

      {/* Log Output Buffer */}
      <div ref={logContainerRef} className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-2 terminal-scroll bg-black/95">
        {displayedLogs.length === 0 ? (
          <div className="text-zinc-600 text-xs py-4 text-center select-none flex flex-col items-center justify-center space-y-1">
            <span className="text-zinc-500 font-medium">Ready. Awaiting runner executions or manual CLI commands...</span>
            <span className="text-[11px] text-zinc-600">Type <code className="text-zinc-400">help</code> or trigger a strategy to generate output.</span>
          </div>
        ) : (
          displayedLogs.map((log, index) => {
            const timestamp = new Date(log.timestamp).toLocaleTimeString();
            return (
              <div key={`${log.id || 'log'}-${log.timestamp || ''}-${index}`} className="leading-5 tracking-wide flex items-start space-x-2 p-1 rounded hover:bg-zinc-900/40 transition-colors">
                <span className="text-zinc-600 select-none shrink-0 font-medium">[{timestamp}]</span>
                <span className={`uppercase shrink-0 text-[10px] px-1.5 py-0.2 rounded border font-mono font-semibold ${
                  log.level === 'trade' ? 'bg-emerald-950/70 border-emerald-800/60 text-emerald-400' :
                  log.level === 'warn' ? 'bg-amber-950/70 border-amber-800/60 text-amber-400' :
                  log.level === 'error' ? 'bg-rose-950/70 border-rose-800/60 text-rose-400' :
                  'bg-zinc-900 border-zinc-800 text-zinc-400'
                }`}>
                  {log.level}
                </span>
                <span className={`flex-1 break-all ${getLogColorClass(log.level)}`}>{log.message}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Terminal Interactive Prompt Input */}
      <div className="bg-zinc-900 border-t border-zinc-800 p-3 flex items-center space-x-2 shrink-0">
        <ChevronRight className="w-4 h-4 text-emerald-400 animate-pulse shrink-0" />
        <span className="text-zinc-500 font-mono text-xs select-none shrink-0">kraken-cli &gt;</span>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter shell script or CLI prompt..."
          className="flex-1 bg-transparent border-0 outline-0 ring-0 focus:outline-none focus:ring-0 text-white font-mono text-xs placeholder-zinc-600 caret-emerald-400"
        />
        <button
          onClick={handleSubmit}
          className="bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-800/60 hover:border-emerald-700/80 px-2.5 py-1 rounded text-emerald-400 text-[11px] font-mono transition-all flex items-center space-x-1 shrink-0"
        >
          <Play className="w-3 h-3" />
          <span>RUN</span>
        </button>
      </div>
    </div>
  );
}
