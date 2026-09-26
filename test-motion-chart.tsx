import React, { useState } from 'react';
import { motion } from 'motion/react';

export const FramerMotionTrendline = ({ data, color }) => {
  const [hoverIdx, setHoverIdx] = useState(null);
  
  if (!data || data.length === 0) return null;
  
  const min = Math.min(...data.map(d => d.pnl), 0);
  const max = Math.max(...data.map(d => d.pnl), 0);
  const padding = (max - min) * 0.1 || 10;
  const domainMin = min - padding;
  const domainMax = max + padding;
  const range = domainMax - domainMin;

  const getX = (i) => (i / Math.max(data.length - 1, 1)) * 100;
  const getY = (val) => 100 - ((val - domainMin) / range) * 100;

  const pathD = `M ${data.map((d, i) => `${getX(i)},${getY(d.pnl)}`).join(' L ')}`;
  const zeroY = getY(0);

  return (
    <div className="relative w-full h-full font-mono text-[9px] text-zinc-500 select-none">
      <svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none">
         <line x1="0" y1={`${zeroY}%`} x2="100%" y2={`${zeroY}%`} stroke="#52525b" strokeDasharray="4 4" strokeWidth={1} />
         <motion.path 
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            animate={{ d: pathD }}
            transition={{ type: "spring", bounce: 0.1, duration: 0.7 }}
         />
      </svg>
      {/* ... */}
    </div>
  )
}
