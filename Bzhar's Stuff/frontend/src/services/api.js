// The ONLY place the frontend makes HTTP calls to the backend.
// Components never call fetch() directly; they call functions from services.

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// Error thrown for any failed API call. `code` matches the backend's error codes
// (e.g. 'NICKNAME_TAKEN'), so the UI can show a precise message.
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// CSRF token: the backend hands it out in GET /auth/me. We keep it in memory (never in
// localStorage) and attach it to every state-changing request as a header.
let csrfToken = null;
export function setCsrfToken(token) {
  csrfToken = token ?? null;
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      // Send the session cookie. Safe: the backend only allows our own origin.
      credentials: 'include',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
  }

  const data = await response.json().catch(() => null); // 204 responses have no body

  if (!response.ok) {
    const error = data?.error;
    throw new ApiError(
      response.status,
      error?.code || 'UNKNOWN_ERROR',
      error?.message || 'Something went wrong.',
      error?.details
    );
  }
  return data;
}

// Not an API call: a normal browser navigation that starts the Google sign-in.
// intent: 'login' | 'register'
export const googleSignInUrl = (intent) => `${BASE_URL}/auth/google?intent=${encodeURIComponent(intent)}`;

export const getHealth = () => request('/health');
export const getMe = () => request('/auth/me');
export const registerAccount = ({ nickname, avatar }) =>
  request('/auth/register', { method: 'POST', body: { nickname, avatar } });
export const getProfile = () => request('/users/me');
export const getMyMatches = (limit = 10) => request(`/users/me/matches?limit=${limit}`);
export const updateProfile = (changes) => request('/users/me', { method: 'PATCH', body: changes });
export const logout = () => request('/auth/logout', { method: 'POST' });
export const checkNickname = (nickname) =>
  request(`/auth/nickname-available?nickname=${encodeURIComponent(nickname)}`);

// ---- Rooms (Phase 4) ----
export const getRoomModes = () => request('/rooms/modes');
export const getCurrentRoom = () => request('/rooms/current');
export const createRoom = ({ gameModeId, maxPlayers }) =>
  request('/rooms', { method: 'POST', body: { gameModeId, maxPlayers } });
export const joinRoom = (code) => request('/rooms/join', { method: 'POST', body: { code } });
// `confirm: true` is required while a match is running (leaving then costs the player their points).
export const leaveRoom = (confirm = false) => request('/rooms/current/leave', { method: 'POST', body: { confirm } });
// Host only: put a player out of the room. `ban: true` also stops them joining this room again.
export const removePlayer = (playerId, ban = false) => request('/rooms/current/remove', { method: 'POST', body: { playerId, ban } });
// One game move: { type: 'hit' | 'stay', decisionId } or { type: 'target' | 'gift', decisionId, targetId }.
export const sendGameAction = (action) => request('/rooms/current/game/action', { method: 'POST', body: action });
// Results screen: say whether you want another match with the same room.
export const setReady = (ready) => request('/rooms/current/ready', { method: 'POST', body: { ready } });
// Host only, results screen: start the next match with the players who are ready; the rest watch.
export const startRematch = () => request('/rooms/current/rematch', { method: 'POST' });
export const startGame = () => request('/rooms/current/start', { method: 'POST' });
// Host only, waiting room: computer players take every empty seat (the server counts them).
export const fillWithBots = () => request('/rooms/current/fill-bots', { method: 'POST' });
export const answerStartPrompt = (answer) =>
  request('/rooms/current/start-response', { method: 'POST', body: { answer } });
