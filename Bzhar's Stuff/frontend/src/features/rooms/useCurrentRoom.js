import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentRoom } from '../../services/api.js';
import { openRoomSocket } from '../../services/socket.js';

// While the live connection is down we ask the server every few seconds instead.
export const FALLBACK_POLL_MS = 5000;

// Keeps the player's current room up to date.
//   live: false -> one request (the lobby only needs to know whether you are in a room)
//   live: true  -> the server pushes every change over Socket.IO; if the connection drops we
//                  poll slowly until it is back.
// Returns { room, loading, error, status, refresh, setRoom, clockOffset, removed }.
// clockOffset = server time - browser time, so countdowns match the server's clock.
export function useCurrentRoom({ live = false } = {}) {
  const [state, setState] = useState({ room: null, loading: true, error: null, clockOffset: 0 });
  const [status, setStatus] = useState(live ? 'connecting' : 'offline');
  const mounted = useRef(true);

  // Accept a room unless it is OLDER than what we already show (updates can arrive out of order).
  // `removed` ('kicked' | 'banned'): the host put us out; remembered while we have no room.
  const accept = useCallback((room, removed) => {
    if (!mounted.current) return;
    setState((s) => {
      if (room && s.room && room.code === s.room.code && room.version < s.room.version) return s;
      return { room, loading: false, error: null, clockOffset: room ? room.serverNow - Date.now() : 0, removed: room ? null : (removed ?? s.removed) };
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { room } = await getCurrentRoom();
      accept(room);
    } catch (error) {
      if (mounted.current) setState((s) => ({ ...s, loading: false, error }));
    }
  }, [accept]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    let connection = null;
    if (live) connection = openRoomSocket({ onState: accept, onStatus: (s) => mounted.current && setStatus(s) });
    return () => {
      mounted.current = false;
      connection?.close();
    };
  }, [live, refresh, accept]);

  useEffect(() => {
    if (!live || status === 'live' || status === 'connecting') return undefined;
    const timer = setInterval(refresh, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [live, status, refresh]);

  return { ...state, status, refresh, setRoom: accept };
}
