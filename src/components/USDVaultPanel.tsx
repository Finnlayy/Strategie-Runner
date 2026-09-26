import React, { useEffect, useState } from "react";
import { collection, onSnapshot, query, limit } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Wallet, ArrowDownRight, ArrowUpRight, DollarSign } from "lucide-react";

export function USDVaultPanel() {
  const [vaultData, setVaultData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "usd_vault"), limit(1));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          setVaultData(snapshot.docs[0].data());
        } else {
          setVaultData({
            total_balance: 0,
            free_capital: 0,
            withdrawn_profits: 0
          });
        }
        setLoading(false);
      },
      (err) => {
        console.error("Error fetching USD Vault data:", err);
        setError("Failed to sync vault");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-center min-h-[140px]">
        <span className="text-zinc-500 font-mono text-xs animate-pulse">Syncing Vault...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-950/20 border border-rose-900/50 rounded-lg p-4 flex items-center justify-center min-h-[140px]">
        <span className="text-rose-400 font-mono text-xs">{error}</span>
      </div>
    );
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val || 0);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Wallet className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-white">
            USD Vault
          </span>
        </div>
        <div className="text-[10px] font-mono text-zinc-500 flex items-center">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
          Live Sync
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-950/50 rounded p-3 border border-zinc-800/60">
          <div className="flex items-center space-x-1 mb-1">
            <DollarSign className="w-3 h-3 text-zinc-400" />
            <span className="text-[10px] font-mono text-zinc-400 uppercase">Total Balance</span>
          </div>
          <div className="text-lg font-bold text-white font-mono">
            {formatCurrency(vaultData?.total_balance)}
          </div>
        </div>

        <div className="bg-zinc-950/50 rounded p-3 border border-zinc-800/60">
          <div className="flex items-center space-x-1 mb-1">
            <ArrowUpRight className="w-3 h-3 text-emerald-400" />
            <span className="text-[10px] font-mono text-zinc-400 uppercase">Free Capital</span>
          </div>
          <div className="text-lg font-bold text-emerald-400 font-mono">
            {formatCurrency(vaultData?.free_capital)}
          </div>
        </div>

        <div className="bg-zinc-950/50 rounded p-3 border border-zinc-800/60">
          <div className="flex items-center space-x-1 mb-1">
            <ArrowDownRight className="w-3 h-3 text-purple-400" />
            <span className="text-[10px] font-mono text-zinc-400 uppercase">Withdrawn</span>
          </div>
          <div className="text-lg font-bold text-purple-400 font-mono">
            {formatCurrency(vaultData?.withdrawn_profits)}
          </div>
        </div>
      </div>
    </div>
  );
}
