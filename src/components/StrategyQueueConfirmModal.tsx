import React from 'react';
import { ShieldAlert, Zap, X, ArrowRight, AlertTriangle, ShieldCheck, Cpu } from 'lucide-react';
import { TradingStrategy } from '../types';

interface StrategyQueueConfirmModalProps {
  isOpen: boolean;
  strategy: TradingStrategy | null;
  targetQueue: 'paper' | 'live';
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const StrategyQueueConfirmModal: React.FC<StrategyQueueConfirmModalProps> = ({
  isOpen,
  strategy,
  targetQueue,
  onConfirm,
  onCancel,
  isLoading = false
}) => {
  if (!isOpen || !strategy) return null;

  const currentQueue = strategy.executionMode || 'paper';
  const isMovingToLive = targetQueue === 'live';

  return (
    <div
      id="strategy-queue-confirm-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) onCancel();
      }}
    >
      <div
        id="strategy-queue-confirm-dialog"
        className={`w-full max-w-lg rounded-xl border bg-zinc-900 p-6 shadow-2xl space-y-5 font-mono ${
          isMovingToLive
            ? 'border-rose-600/70 shadow-rose-950/40 ring-1 ring-rose-500/20'
            : 'border-amber-600/70 shadow-amber-950/40 ring-1 ring-amber-500/20'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div
              className={`p-2.5 rounded-lg border ${
                isMovingToLive
                  ? 'bg-rose-950/80 border-rose-700 text-rose-400'
                  : 'bg-amber-950/80 border-amber-700 text-amber-400'
              }`}
            >
              {isMovingToLive ? (
                <ShieldAlert className="w-6 h-6 animate-pulse" />
              ) : (
                <ShieldCheck className="w-6 h-6" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                {isMovingToLive ? 'Promote to Live Execution (L4)' : 'Move to Paper Simulation (L2)'}
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Confirmation required before altering strategy execution queue.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Strategy Context Card */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3.5 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">Target Strategy:</span>
            <span className="font-bold text-white flex items-center space-x-1.5">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span>{strategy.name}</span>
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">Asset Pair & Interval:</span>
            <span className="font-mono text-zinc-200">{strategy.assetPair} • {strategy.interval}s interval</span>
          </div>

          {/* Queue Transition Visualizer */}
          <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between">
            <div className="flex flex-col items-start">
              <span className="text-[9px] uppercase tracking-wider text-zinc-500">Current Queue</span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 mt-0.5 rounded border uppercase ${
                  currentQueue === 'live'
                    ? 'bg-rose-950/80 border-rose-700 text-rose-300'
                    : 'bg-amber-950/80 border-amber-700 text-amber-300'
                }`}
              >
                {currentQueue === 'live' ? 'LIVE QUEUE (L4)' : 'PAPER QUEUE (L2)'}
              </span>
            </div>

            <ArrowRight className="w-4 h-4 text-zinc-500" />

            <div className="flex flex-col items-end">
              <span className="text-[9px] uppercase tracking-wider text-zinc-500">Target Queue</span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 mt-0.5 rounded border uppercase ${
                  isMovingToLive
                    ? 'bg-rose-950 text-rose-300 border-rose-600 shadow-[0_0_8px_rgba(244,63,94,0.4)]'
                    : 'bg-amber-950 text-amber-300 border-amber-600 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                }`}
              >
                {isMovingToLive ? 'LIVE QUEUE (L4)' : 'PAPER QUEUE (L2)'}
              </span>
            </div>
          </div>
        </div>

        {/* Warning / Explanation Box */}
        {isMovingToLive ? (
          <div className="bg-rose-950/40 border border-rose-800/80 rounded-lg p-3.5 space-y-2 text-xs text-rose-200">
            <div className="flex items-center space-x-2 font-bold text-rose-300">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>Real Capital Execution Warning</span>
            </div>
            <p className="leading-relaxed text-[11px] text-rose-200/90">
              By promoting this strategy to <strong>Level 4 Live Queue</strong>, all future buy and sell signals triggered by this worker will be routed directly to the <strong>Kraken Pro Exchange</strong> matching engine. Real account capital will be deployed.
            </p>
            <ul className="list-disc list-inside text-[10px] text-rose-300/80 space-y-0.5 pt-1">
              <li>Requires valid Kraken API Key with trading permissions.</li>
              <li>Stop-loss rules configured in strategy parameters remain active.</li>
              <li>Other strategies in the Paper Queue will continue running independently.</li>
            </ul>
          </div>
        ) : (
          <div className="bg-amber-950/40 border border-amber-800/80 rounded-lg p-3.5 space-y-2 text-xs text-amber-200">
            <div className="flex items-center space-x-2 font-bold text-amber-300">
              <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Guarded Paper Simulation</span>
            </div>
            <p className="leading-relaxed text-[11px] text-amber-200/90">
              Moving this strategy to <strong>Level 2 Paper Queue</strong> transfers all executions to the simulated paper engine (or Kraken API validate=true). No real capital will be risked.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-xs font-bold text-white transition-all flex items-center space-x-1.5 shadow-md ${
              isMovingToLive
                ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-900/50'
                : 'bg-amber-600 hover:bg-amber-500 text-zinc-950 font-extrabold shadow-amber-900/50'
            } disabled:opacity-50`}
          >
            {isLoading ? (
              <span>Switching Queue...</span>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5" />
                <span>Confirm & Switch to {isMovingToLive ? 'Live (L4)' : 'Paper (L2)'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StrategyQueueConfirmModal;
