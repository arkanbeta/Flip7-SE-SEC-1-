// The ONLY place the frontend opens a Socket.IO connection (like api.js for HTTP).
// The server pushes each player's room state; actions still go through api.js.
import { io } from 'socket.io-client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
// Same origin as the API (in development the Vite proxy forwards /socket.io too).
const SOCKET_ORIGIN = BASE_URL.startsWith('http') ? new URL(BASE_URL).origin : undefined;

// status: 'connecting' | 'live' | 'reconnecting' | 'offline'
// Returns { close }. The login cookie is sent automatically; the server decides who we are.
export function openRoomSocket({ onState, onStatus }) {
  const socket = io(SOCKET_ORIGIN, { withCredentials: true });
  onStatus('connecting');

  socket.on('connect', () => onStatus('live'));
  socket.on('room:state', (payload) => onState(payload?.room ?? null, payload?.reason));
  socket.on('disconnect', (reason) => {
    // 'io server disconnect' = the server closed us on purpose (for example after logout):
    // the client will not retry by itself.
    onStatus(reason === 'io server disconnect' ? 'offline' : 'reconnecting');
  });
  socket.on('connect_error', () => onStatus(socket.active ? 'reconnecting' : 'offline'));

  return { close: () => socket.close() };
}
