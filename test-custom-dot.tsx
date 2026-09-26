import { motion } from 'motion/react';

export const MotionDot = (props: any) => {
  const { cx, cy, payload, value, index } = props;
  if (cx === undefined || cy === undefined) return null;
  
  const isPos = value >= 0;
  const fill = isPos ? "#34d399" : "#fb7185";

  return (
    <motion.circle
      cx={cx}
      cy={cy}
      r={3}
      fill={fill}
      stroke="#18181b"
      strokeWidth={1}
      initial={{ r: 0, opacity: 0 }}
      animate={{ r: 3, opacity: 1, cx, cy }}
      transition={{ 
        type: "spring", 
        stiffness: 300, 
        damping: 20, 
        mass: 0.8 
      }}
    />
  );
}
