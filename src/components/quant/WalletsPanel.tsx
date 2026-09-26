import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Wallet, ArrowRightLeft, PieChart, Activity, 
  ArrowDownToLine, ArrowUpFromLine, RefreshCw, Layers, ShieldCheck, Eye
} from 'lucide-react';
import { PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis } from 'recharts';
import { auth, db } from '../../lib/firebase';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

import { safeFetchJson } from '../../lib/api';

export function WalletsPanel() {
  const [environment, setEnvironment] = useState<'paper' | 'live'>('paper');
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferFrom, setTransferFrom] = useState<'spot' | 'futures'>('spot');
  const [transferTo, setTransferTo] = useState<'spot' | 'futures'>('futures');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [ledgerData, setLedgerData] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchLedgers = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const data = await safeFetchJson<any>(`/api/kraken/ledgers?mode=${environment}`, undefined, 4000);
      if (data) {
        setLedgerData(data);
      }
    };
    fetchLedgers();
    const interval = setInterval(fetchLedgers, 5000);
    return () => clearInterval(interval);
  }, [environment]);

  const handleTransfer = async () => {
    if (!user) {
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        console.error("Sign in failed", err);
      }
      return;
    }

    if (!transferAmount || isNaN(Number(transferAmount)) || Number(transferAmount) <= 0) {
       alert("Please enter a valid amount");
       return;
    }

    setIsProcessing(true);
    try {
      await addDoc(collection(db, 'users', user.uid, 'transfers'), {
        amount: Number(transferAmount),
        asset: 'USDT',
        from: transferFrom,
        to: transferTo,
        environment,
        timestamp: serverTimestamp()
      });
      setShowTransferModal(false);
      setTransferAmount('');
    } catch (err) {
      console.error("Transfer failed", err);
      alert("Transfer failed: Insufficient permissions or network error.");
    } finally {
      setIsProcessing(false);
    }
  };

  const current = useMemo(() => {
    if (!ledgerData) {
      return {
        totalValueUSD: 0,
        todayProfit: 0,
        profitPerc: 0,
        spot: { value: 0, assets: [] },
        futures: { value: 0, equity: 0, marginRate: 0, maintMargin: 0, assets: [], positions: [] },
        history: []
      };
    }
    
    const spot = ledgerData.spot || { totalValueUSD: 0, assets: [] };
    const pro = ledgerData.pro || { totalCollateralUSD: 0, totalUnrealizedPnL: 0, unrealizedPnLPercent: 0, freeMarginUSD: 0, usedMarginUSD: 0, marginLevelPercent: 0, positions: [] };

    return {
      totalValueUSD: (spot.totalValueUSD || 0) + (pro.totalCollateralUSD || 0),
      todayProfit: (spot.change24hUSD || 0) + (pro.totalUnrealizedPnL || 0),
      profitPerc: pro.unrealizedPnLPercent || 0,
      spot: {
        value: spot.totalValueUSD || 0,
        assets: (spot.assets || []).map((a: any) => ({
          coin: a.asset,
          symbol: a.asset,
          qty: a.amount || 0,
          value: a.totalValueUSD || 0,
          prop: a.portfolioPercentage || 0,
          frozen: a.inOrders || 0
        }))
      },
      futures: {
        value: pro.totalCollateralUSD || 0,
        equity: pro.totalCollateralUSD || 0,
        marginRate: pro.marginLevelPercent || 0,
        maintMargin: pro.usedMarginUSD || 0,
        assets: [
          { coin: 'USD', symbol: 'USD', qty: pro.totalCollateralUSD || 0, transferrable: pro.freeMarginUSD || 0 }
        ],
        positions: (pro.positions || []).map((p: any) => ({
          ...p,
          margin: p.marginRequirementUSD || 0,
          pnl: p.unrealizedPnLUSD || 0,
          mode: p.contractType || 'perpetual'
        }))
      },
      history: Array.from({length: 30}).map((_, i) => ({ day: i, val: (spot.totalValueUSD || 0) + (pro.totalCollateralUSD || 0) }))
    };
  }, [ledgerData]);

  const pieData = current.spot.assets.map(a => ({
    name: a.coin,
    value: a.value,
    color: a.coin === 'ZEC' || a.coin === 'USDT' ? '#F59E0B' : a.coin === 'BTC' ? '#F7931A' : a.coin === 'ETH' ? '#627EEA' : a.coin === 'XRP' ? '#4F46E5' : '#10B981'
  }));

  const distPieData = [
    { name: 'Primary Account', value: current.spot.value, color: '#F59E0B' },
    { name: 'Futures Account', value: current.futures.equity, color: '#6366F1' }
  ];

  return (
    <div className="space-y-4 font-mono pb-8">
      {/* Header Tabs */}
      <div className="flex gap-4 mb-6 border-b border-zinc-800 pb-2">
        <button 
          onClick={() => setEnvironment('paper')}
          className={`flex items-center gap-2 pb-2 px-1 border-b-2 transition-colors ${
            environment === 'paper' ? 'border-purple-500 text-purple-400 font-bold' : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Layers className="w-4 h-4" />
          Paper Budget
        </button>
        <button 
          onClick={() => setEnvironment('live')}
          className={`flex items-center gap-2 pb-2 px-1 border-b-2 transition-colors ${
            environment === 'live' ? 'border-emerald-500 text-emerald-400 font-bold' : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Activity className="w-4 h-4" />
          Live Budget
        </button>
      </div>

      {/* Top Row: Total Value & Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Est Total Value */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-5 flex flex-col">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-zinc-400 text-sm mb-1 flex items-center gap-1.5">Est. total value <Eye className="w-3.5 h-3.5 text-zinc-400" /></h3>
              <div className="text-2xl font-bold text-zinc-100">{current.totalValueUSD.toLocaleString(undefined, {minimumFractionDigits: 3, maximumFractionDigits: 3})} USD</div>
              <div className={`text-xs mt-1 font-bold ${current.todayProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                Today's profit: {current.todayProfit >= 0 ? '+' : ''}{current.todayProfit} ({current.profitPerc >= 0 ? '+' : ''}{current.profitPerc}%)
              </div>
            </div>
            <div className="text-[10px] text-rose-500 bg-rose-500/10 px-2 py-1 rounded">
              7D balance change: {environment === 'live' ? '-93.35%' : '+12.4%'}
            </div>
          </div>
          
          <div className="h-32 w-full mt-auto">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={current.history}>
                <Line type="stepAfter" dataKey="val" stroke={environment === 'live' ? '#EF4444' : '#10B981'} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Balance Distribution */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-5">
          <h3 className="text-zinc-300 text-sm font-bold mb-4">Balance Distribution</h3>
          <div className="flex items-center gap-8 h-32">
            <div className="w-32 h-32 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie
                    data={distPieData}
                    innerRadius={30}
                    outerRadius={45}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {distPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </RechartsPieChart>
              </ResponsiveContainer>
            </div>
            
            <div className="flex-1 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-1 h-8 bg-amber-500 rounded-full" />
                <div>
                  <div className="text-[10px] text-zinc-400">Primary Account (Spot)</div>
                  <div className="text-sm font-bold text-zinc-200">{current.spot.value.toLocaleString(undefined, {minimumFractionDigits: 4})} USD</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1 h-8 bg-indigo-500 rounded-full" />
                <div>
                  <div className="text-[10px] text-zinc-400">Futures account value</div>
                  <div className="text-sm font-bold text-zinc-200">{current.futures.equity.toLocaleString(undefined, {minimumFractionDigits: 4})} USD</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Spot Wallet (Primary) */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-5 mt-4">
        <div className="flex justify-between items-center mb-6 border-b border-zinc-800/50 pb-4">
          <h3 className="text-zinc-200 font-bold text-lg flex items-center gap-2">
            <Wallet className="w-5 h-5 text-amber-500" /> Primary Account (Spot)
          </h3>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] uppercase font-bold rounded flex items-center gap-1.5 transition-colors">
              <ArrowDownToLine className="w-3.5 h-3.5" /> Deposit
            </button>
            <button className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] uppercase font-bold rounded flex items-center gap-1.5 transition-colors">
              <ArrowUpFromLine className="w-3.5 h-3.5" /> Withdraw
            </button>
            <button 
              onClick={() => setShowTransferModal(true)}
              className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 border border-indigo-500/30 text-[10px] uppercase font-bold rounded flex items-center gap-1.5 transition-colors"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> Transfer
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1 border-r border-zinc-800/50 pr-4">
            <div className="text-xs text-zinc-500 mb-1">Total balance</div>
            <div className="text-xl font-bold text-zinc-200 mb-4">{current.spot.value.toLocaleString(undefined, {minimumFractionDigits: 4})} USD</div>
            
            <div className="h-32 w-full mt-6 relative">
               <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie
                    data={pieData}
                    innerRadius={40}
                    outerRadius={55}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </RechartsPieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <PieChart className="w-5 h-5 text-zinc-600" />
              </div>
            </div>
          </div>
          
          <div className="lg:col-span-3">
             <div className="flex justify-between items-center mb-4">
                <h4 className="text-sm font-bold text-zinc-300">Portfolio</h4>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer hover:text-zinc-300">
                    <input type="checkbox" className="accent-zinc-600 rounded-sm bg-zinc-800 border-zinc-700" />
                    Hide small balance
                  </label>
                  <button className="text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> Convert Small Balances
                  </button>
                </div>
             </div>

             <div className="overflow-x-auto">
               <table className="w-full text-left text-xs">
                 <thead className="text-[10px] text-zinc-500 font-normal border-b border-zinc-800">
                   <tr>
                     <th className="pb-2 font-normal">Coin</th>
                     <th className="pb-2 font-normal text-right">Quantity</th>
                     <th className="pb-2 font-normal text-right">Value(USD)</th>
                     <th className="pb-2 font-normal">Proportion</th>
                     <th className="pb-2 font-normal text-right">Tradable/Frozen</th>
                     <th className="pb-2 font-normal text-right">Action</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-zinc-800/30">
                   {current.spot.assets.map(asset => (
                     <tr key={asset.coin} className="hover:bg-zinc-900/30 transition-colors">
                       <td className="py-3 font-bold text-zinc-300">
                         {asset.coin} <span className="text-zinc-600 font-normal text-[10px]">({asset.symbol})</span>
                       </td>
                       <td className="py-3 text-right font-mono text-zinc-400">{asset.qty.toLocaleString(undefined, {minimumFractionDigits: 4})}</td>
                       <td className="py-3 text-right font-mono text-zinc-400">{asset.value.toLocaleString(undefined, {minimumFractionDigits: 4})}</td>
                       <td className="py-3">
                         <div className="flex items-center gap-2">
                           <div className="w-16 h-1 bg-zinc-800 rounded-full overflow-hidden">
                             <div className="h-full bg-amber-500/70" style={{width: `${asset.prop}%`}} />
                           </div>
                           <span className="text-[10px] font-mono text-zinc-500">{asset.prop.toFixed(2)}%</span>
                         </div>
                       </td>
                       <td className="py-3 text-right font-mono text-zinc-500">
                         <span className="text-zinc-400">{asset.qty.toLocaleString(undefined, {minimumFractionDigits: 4})}</span> / {asset.frozen}
                       </td>
                       <td className="py-3 text-right">
                         <div className="flex justify-end gap-1">
                           <button className="px-1.5 py-0.5 text-[9px] border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors">Trade</button>
                           <button className="px-1.5 py-0.5 text-[9px] border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors">Convert</button>
                         </div>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
          </div>
        </div>
      </div>

      {/* Futures Wallet */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-5 mt-4">
        <div className="flex justify-between items-center mb-6 border-b border-zinc-800/50 pb-4">
          <h3 className="text-zinc-200 font-bold text-lg flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-500" /> Futures Account
          </h3>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] uppercase font-bold rounded transition-colors">
              Futures PnL
            </button>
            <button 
              onClick={() => setShowTransferModal(true)}
              className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 border border-indigo-500/30 text-[10px] uppercase font-bold rounded flex items-center gap-1.5 transition-colors"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> Transfer
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1 border-r border-zinc-800/50 pr-4 space-y-4">
            <div>
              <div className="text-xs text-zinc-500 mb-1">Account Equity</div>
              <div className="text-xl font-bold text-zinc-200">{current.futures.equity.toLocaleString(undefined, {minimumFractionDigits: 2})} USD</div>
            </div>
            
            <div className="pt-2 border-t border-zinc-800/50">
               <div className="text-[10px] text-zinc-500 mb-1 border-b border-dashed border-zinc-700 inline-block">Margin Rate (USDT)</div>
               <div className="text-sm font-bold text-emerald-400">{current.futures.marginRate.toFixed(2)}%</div>
            </div>
            
            <div className="pt-2 border-t border-zinc-800/50">
               <div className="text-[10px] text-zinc-500 mb-1 border-b border-dashed border-zinc-700 inline-block">Maintenance Margin (USDT)</div>
               <div className="text-sm font-bold text-zinc-300">{current.futures.maintMargin.toLocaleString()}</div>
            </div>
          </div>
          
          <div className="lg:col-span-3 space-y-6">
             {/* Balance details */}
             <div>
               <h4 className="text-sm font-bold text-zinc-300 mb-3">Balance details</h4>
               <table className="w-full text-left text-xs">
                 <thead className="text-[10px] text-zinc-500 font-normal border-b border-zinc-800">
                   <tr>
                     <th className="pb-2 font-normal">Coin</th>
                     <th className="pb-2 font-normal text-right">Total quantity</th>
                     <th className="pb-2 font-normal text-right">Transferable</th>
                     <th className="pb-2 font-normal text-right">Action</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-zinc-800/30">
                   {current.futures.assets.map(asset => (
                     <tr key={asset.coin} className="hover:bg-zinc-900/30 transition-colors">
                       <td className="py-2.5 font-bold text-emerald-400 flex items-center gap-1.5">
                         <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center text-[8px] text-emerald-500 border border-emerald-500/30">T</div>
                         {asset.coin} <span className="text-zinc-600 font-normal text-[10px] ml-1">Tether {asset.coin}</span>
                       </td>
                       <td className="py-2.5 text-right font-mono text-zinc-300">{asset.qty.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                       <td className="py-2.5 text-right font-mono text-zinc-300">{asset.transferrable.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                       <td className="py-2.5 text-right">
                         <div className="flex justify-end gap-1">
                           <button onClick={() => setShowTransferModal(true)} className="px-1.5 py-0.5 text-[9px] border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors">Transfer</button>
                           <button className="px-1.5 py-0.5 text-[9px] border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors">Go trading</button>
                         </div>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>

             {/* Positions */}
             <div>
               <div className="flex justify-between items-center mb-3">
                 <h4 className="text-sm font-bold text-zinc-300">Current Positions</h4>
                 <div className="text-[10px] text-zinc-400">
                   Total Unrealized PnL: <span className="text-emerald-500 font-bold">+{(current.futures.positions as any[]).reduce((acc: number, p: any) => acc + p.pnl, 0).toFixed(2)} USD</span>
                 </div>
               </div>
               
               {current.futures.positions.length > 0 ? (
                 <table className="w-full text-left text-xs">
                   <thead className="text-[10px] text-zinc-500 font-normal border-b border-zinc-800">
                     <tr>
                       <th className="pb-2 font-normal">Positions</th>
                       <th className="pb-2 font-normal">Position Mode</th>
                       <th className="pb-2 font-normal text-right">Margin</th>
                       <th className="pb-2 font-normal text-right">Unrealized PnL</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-zinc-800/30">
                     {current.futures.positions.map(pos => (
                       <tr key={pos.pair} className="hover:bg-zinc-900/30 transition-colors">
                         <td className="py-2.5 font-bold text-zinc-200">{pos.pair}</td>
                         <td className="py-2.5 text-zinc-400">{pos.mode}</td>
                         <td className="py-2.5 text-right font-mono text-zinc-300">{pos.margin.toFixed(2)}</td>
                         <td className={`py-2.5 text-right font-mono font-bold ${pos.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                           {pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(2)}
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               ) : (
                 <div className="py-8 flex flex-col items-center justify-center text-zinc-600 border-t border-zinc-800/50">
                   <Activity className="w-8 h-8 mb-2 opacity-20" />
                   <span className="text-[10px]">No data</span>
                 </div>
               )}
             </div>
          </div>
        </div>
      </div>

      {/* Transfer Modal */}
      <AnimatePresence>
        {showTransferModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-700 shadow-2xl rounded-xl w-full max-w-md overflow-hidden font-mono"
            >
              <div className="px-5 py-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950">
                <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-indigo-400" />
                  Transfer Assets
                </h3>
                <button 
                  onClick={() => setShowTransferModal(false)}
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  ✕
                </button>
              </div>
              
              <div className="p-5 space-y-6">
                <div className="flex flex-col gap-2 relative">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex justify-between items-center">
                    <div className="text-[10px] text-zinc-500 uppercase font-bold w-16">From</div>
                    <select value={transferFrom} onChange={(e) => setTransferFrom(e.target.value as 'spot'|'futures')} className="bg-transparent text-sm font-bold text-zinc-200 outline-none flex-1 text-right cursor-pointer">
                      <option value="spot">Primary Account</option>
                      <option value="futures">Futures Account</option>
                    </select>
                  </div>
                  
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                    <button 
                      onClick={() => {
                        setTransferFrom(transferTo);
                        setTransferTo(transferFrom);
                      }}
                      className="w-8 h-8 rounded-full bg-zinc-800 border-4 border-zinc-900 flex items-center justify-center text-zinc-400 hover:text-indigo-400 hover:bg-zinc-700 transition-colors"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5 rotate-90" />
                    </button>
                  </div>

                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex justify-between items-center">
                    <div className="text-[10px] text-zinc-500 uppercase font-bold w-16">To</div>
                    <select value={transferTo} onChange={(e) => setTransferTo(e.target.value as 'spot'|'futures')} className="bg-transparent text-sm font-bold text-zinc-200 outline-none flex-1 text-right cursor-pointer">
                      <option value="futures">Futures Account</option>
                      <option value="spot">Primary Account</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] text-zinc-500 uppercase font-bold">Coin</label>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                    <select className="w-full bg-transparent text-sm font-bold text-zinc-200 outline-none cursor-pointer">
                      <option>USDT</option>
                      <option>BTC</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] text-zinc-500 uppercase font-bold">Amount</label>
                    <span className="text-[10px] text-zinc-400">Available: <span className="font-mono text-zinc-300">2,150.00 USDT</span></span>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex justify-between items-center focus-within:border-indigo-500 transition-colors">
                    <input 
                      type="text" 
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                      placeholder="0.00" 
                      className="bg-transparent text-sm font-mono font-bold text-zinc-200 outline-none flex-1 placeholder:text-zinc-700" 
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-zinc-500">USDT</span>
                      <button onClick={() => setTransferAmount('2150.00')} className="text-[9px] font-bold text-indigo-400 uppercase">Max</button>
                    </div>
                  </div>
                </div>
                
                <button 
                  onClick={handleTransfer}
                  disabled={isProcessing}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg uppercase tracking-wider text-xs transition-colors flex items-center justify-center gap-2"
                >
                  {!user ? (
                     <>Sign In to Transfer</>
                  ) : isProcessing ? (
                     <><RefreshCw className="w-4 h-4 animate-spin" /> Authorizing...</>
                  ) : (
                     <><ShieldCheck className="w-4 h-4" /> Secure Transfer</>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}


const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 p-2 rounded shadow-xl font-mono text-xs">
        <div className="text-zinc-400 mb-1">{payload[0].name}</div>
        <div className="font-bold text-zinc-100">{payload[0].value.toFixed(4)} USD</div>
      </div>
    );
  }
  return null;
};
