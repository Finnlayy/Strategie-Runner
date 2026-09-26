import React, { useState } from 'react';
import { motion } from 'motion/react';
import { PnLHistoryPoint } from './MetricsPanel';

interface Props {
  data: PnLHistoryPoint[];
  color: string;
}

export const FramerMotionTrendline: React.FC<Props> = ({ data, color }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) return null;

  const min = Math.min(...data.map(d => d.pnl), 0);
  const max = Math.max(...data.map(d => d.pnl), 0);
  const padding = (max - min) * 0.1 || 10;
  const domainMin = min - padding;
  const domainMax = max + padding;
  const range = domainMax - domainMin;

  const getX = (i: number) => (i / Math.max(data.length - 1, 1)) * 100;
  const getY = (val: number) => 100 - ((val - domainMin) / range) * 100;

  const pathD = `M ${data.map((d, i) => `${getX(i)},${getY(d.pnl)}`).join(' L ')}`;
  const zeroY = getY(0);

  return (
    <div className="relative w-full h-full font-mono text-[9px] text-zinc-500 select-none">
      {/* Y-Axis Grid Lines */}
      <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-40">
        <div className="w-full border-t border-dashed border-zinc-700" />
        <div className="w-full border-t border-dashed border-zinc-700" />
        <div className="w-full border-t border-dashed border-zinc-700" />
        <div className="w-full border-t border-dashed border-zinc-700" />
      </div>

      <svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none">
         {/* Zero line */}
         <line x1="0" y1={`${zeroY}%`} x2="100%" y2={`${zeroY}%`} stroke="#52525b" strokeDasharray="2 2" strokeWidth={1} />
         
         <motion.path 
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            initial={{ d: pathD }}
            animate={{ d: pathD }}
            transition={{ type: "spring", bounce: 0.1, duration: 0.7 }}
         />
         
         {/* Animate Dots for Data Point Updates */}
         {data.map((d, i) => (
           <motion.circle
             key={`dot-${i}`}
             cx={`${getX(i)}%`}
             cy={`${getY(d.pnl)}%`}
             r={hoverIdx === i ? 4 : 2}
             fill={hoverIdx === i ? color : "#18181b"}
             stroke={color}
             strokeWidth={hoverIdx === i ? 0 : 1.5}
             initial={false}
             animate={{ cx: `${getX(i)}%`, cy: `${getY(d.pnl)}%`, r: hoverIdx === i ? 4 : 0 }}
             transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
           />
         ))}
      </svg>
      
      {/* Interactive Hover Zones */}
      <div className="absolute inset-0 flex">
        {data.map((d, i) => (
          <div 
            key={i}
            className="flex-1 h-full relative"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {hoverIdx === i && (
              <>
                <div className="absolute top-0 bottom-0 w-[1px] bg-zinc-600 left-1/2 -translate-x-1/2 pointer-events-none" />
                
                {/* Tooltip */}
                <div className="absolute z-10 bottom-[110%] mb-1 left-1/2 -translate-x-1/2 bg-zinc-950 border border-zinc-800 p-2 rounded shadow-xl min-w-[130px] pointer-events-none">
                  <div className="text-zinc-400 text-[10px] border-b border-zinc-850 pb-1 flex justify-between gap-3">
                    <span>Time: {d.time}</span>
                  </div>
                  <div className="flex justify-between items-center gap-3 font-semibold mt-1">
                    <span className="text-zinc-300">Cum. P&L:</span>
                    <span className={d.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(2)} USD
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Axis Labels */}
      <div className="absolute -left-6 bottom-0 translate-y-full pt-1 text-zinc-500">
        {data[0]?.time}
      </div>
      <div className="absolute -right-2 bottom-0 translate-y-full pt-1 text-zinc-500">
        {data[data.length - 1]?.time}
      </div>
      <div className="absolute left-0 top-0 -translate-x-full pr-2 text-right text-zinc-600">
        ${domainMax.toFixed(0)}
      </div>
      <div className="absolute left-0 bottom-0 -translate-x-full pr-2 text-right text-zinc-600">
        ${domainMin.toFixed(0)}
      </div>
    </div>
  );
};
