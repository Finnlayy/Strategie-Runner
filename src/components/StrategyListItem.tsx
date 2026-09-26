import { memo } from "react";
import { motion } from "motion/react";
import { Archive, Dna, ArchiveRestore, Play, Square, FolderGit2 } from "lucide-react";
import { TradingStrategy, formatTimeframe } from "../types";

export interface StrategyListItemProps {
  strategy: TradingStrategy;
  isSelected: boolean;
  onSelect: (strategy: TradingStrategy) => void;
  onRestore: (id: string) => void;
  onToggleRun: (id: string, action: 'start' | 'stop') => void;
}

export const StrategyListItem = memo(function StrategyListItem({
  strategy,
  isSelected,
  onSelect,
  onRestore,
  onToggleRun,
}: StrategyListItemProps) {
  const isActive = strategy.status === 'active';
  const isArchived = strategy.status === 'archived';

  return (
    <motion.div
      id={`orchestrator-strategy-item-${strategy.id}`}
      onClick={() => onSelect(strategy)}
      className={`p-3 rounded-lg border transition-all cursor-pointer select-none relative ${
        isSelected 
          ? isArchived
            ? 'bg-amber-950/30 border-amber-500/60 text-white shadow-md'
            : 'bg-zinc-800/90 border-emerald-500/60 text-white shadow-md' 
          : isArchived
            ? 'bg-zinc-950/40 hover:bg-zinc-950 border-zinc-850 text-zinc-400'
            : 'bg-zinc-950/50 hover:bg-zinc-950 border-zinc-800 text-zinc-300'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center space-x-1.5 flex-wrap">
            <h4 className="text-xs font-mono font-bold leading-none truncate max-w-[180px]">
              {strategy.name}
            </h4>
            <span className="bg-purple-950/70 border border-purple-800/50 text-purple-300 px-1 py-0.2 rounded text-[9px] font-mono font-bold shrink-0">
              v{strategy.version || 1}
            </span>
            {(strategy.modelSource === 'google_drive' || strategy.onnxFileName) && (
              <span className="bg-blue-950/80 border border-blue-700/60 text-blue-300 px-1 py-0.2 rounded text-[9px] font-mono font-bold shrink-0 flex items-center space-x-0.5" title={`ONNX Model: ${strategy.onnxFileName || 'Google Drive'}`}>
                <FolderGit2 className="w-2.5 h-2.5 text-blue-400" />
                <span>ONNX</span>
              </span>
            )}
            {isArchived && (
              <span className="bg-amber-950/70 border border-amber-800/50 text-amber-300 px-1 py-0.2 rounded text-[9px] font-mono shrink-0 flex items-center space-x-0.5">
                <Archive className="w-2.5 h-2.5" />
                <span>ARCHIVE</span>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
            <span>{strategy.assetPair}</span>
            <span>•</span>
            <span>{formatTimeframe(strategy.interval)}</span>
            {strategy.hardStopEnabled !== false && (
              <>
                <span>•</span>
                <span className="text-rose-400 font-semibold lowercase">
                  stop: -{strategy.hardStopPercent ?? 5.0}%
                </span>
              </>
            )}
          </div>

          {strategy.seededFromName && (
            <div 
              className="text-[10px] font-mono text-purple-400 flex items-center space-x-1 truncate pt-0.5" 
              title={`Seeded from: ${strategy.seededFromName}`}
            >
              <Dna className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">Seed: {strategy.seededFromName}</span>
            </div>
          )}
        </div>

        {/* Status indicator badge */}
        <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${
          isActive 
            ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.5)]' 
            : isArchived
              ? 'bg-amber-600'
              : 'bg-zinc-700'
        }`} />
      </div>

      <p className="text-[11px] text-zinc-400 mt-2 line-clamp-2 leading-relaxed">
        {strategy.description}
      </p>

      {/* Quick control overlay */}
      {isSelected && (
        <div className="mt-3 pt-2.5 border-t border-zinc-700/60 flex justify-between items-center text-[10px] font-mono">
          <span className="text-zinc-500 uppercase">
            {isArchived ? 'Archive State' : 'Worker Engine'}
          </span>
          {isArchived ? (
            <button
              id={`btn-restore-strategy-${strategy.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onRestore(strategy.id);
              }}
              className="px-2 py-0.5 rounded border bg-purple-950/60 border-purple-800/80 hover:bg-purple-900/60 text-purple-300 flex items-center space-x-1"
            >
              <ArchiveRestore className="w-2.5 h-2.5" />
              <span>RESTORE</span>
            </button>
          ) : (
            <button
              id={`btn-toggle-strategy-${strategy.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleRun(strategy.id, isActive ? 'stop' : 'start');
              }}
              className={`px-2 py-0.5 rounded border flex items-center space-x-1 ${
                isActive
                  ? 'bg-rose-950/40 border-rose-900/40 hover:bg-rose-900/40 text-rose-400'
                  : 'bg-emerald-950/40 border-emerald-900/40 hover:bg-emerald-900/40 text-emerald-400'
              }`}
            >
              {isActive ? <Square className="w-2.5 h-2.5 fill-rose-400" /> : <Play className="w-2.5 h-2.5 fill-emerald-400" />}
              <span>{isActive ? 'SHUTDOWN' : 'DEPLOY'}</span>
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
});
