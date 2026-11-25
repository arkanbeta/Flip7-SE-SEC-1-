import { useEffect, useRef, useState } from 'react';

// Events of the given types that arrived AFTER this table was first shown, each kept for `ms`
// milliseconds. Used to play short table animations (e.g. a Second Chance saving a player)
// exactly once, and never to replay old moves after a page refresh.
export function useRecentEvents(events, types, ms) {
  const lastSeen = useRef(null);
  const timers = useRef(new Set());
  const [recent, setRecent] = useState([]);
  const typeKey = types.join(',');

  useEffect(() => {
    const newest = events.reduce((max, e) => Math.max(max, e.id), 0);
    if (lastSeen.current === null) {
      lastSeen.current = newest;
      return;
    }
    const wanted = new Set(typeKey.split(','));
    const fresh = events.filter((e) => e.id > lastSeen.current && wanted.has(e.type));
    lastSeen.current = Math.max(lastSeen.current, newest);
    if (fresh.length === 0) return;
    setRecent((current) => [...current, ...fresh]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      const ids = new Set(fresh.map((e) => e.id));
      setRecent((current) => current.filter((e) => !ids.has(e.id)));
    }, ms);
    timers.current.add(timer);
  }, [events, typeKey, ms]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return recent;
}
