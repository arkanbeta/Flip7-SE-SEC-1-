import { useEffect, useState } from 'react';

// Whole seconds left until `targetMs` (server time). Re-renders once a second.
export function useCountdown(targetMs, clockOffset = 0) {
  const calc = () => (targetMs == null ? null : Math.max(0, Math.ceil((targetMs - (Date.now() + clockOffset)) / 1000)));
  const [seconds, setSeconds] = useState(calc);
  useEffect(() => {
    setSeconds(calc());
    if (targetMs == null) return undefined;
    const id = setInterval(() => setSeconds(calc()), 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMs, clockOffset]);
  return seconds;
}

export const formatClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
