// DEVELOPMENT TOOL: bot players for trying the game alone on your own PC.
//
//   node scripts/bots.js <ROOM_CODE> [number of bots, default 2]
//
// Each bot is a local-only Users row (google_id "dev-bot-N", email @bots.localhost) with a
// login session written straight into the `sessions` table. That skips Google sign-in,
// which is only possible because this script runs on the server with its SESSION_SECRET.
// The bots then use the normal HTTP API (joining, moves, "Play again") exactly like a
// browser, and listen on Socket.IO for their turn. Ctrl+C makes them leave the room.
//
// Refuses to run with NODE_ENV=production.
import 'dotenv/config';
import crypto from 'node:crypto';
import { io } from 'socket.io-client';
import { loadConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';

const config = loadConfig();
if (config.isProduction) {
  console.error('bots.js is a development tool and refuses to run in production.');
  process.exit(1);
}

const code = (process.argv[2] ?? '').trim().toUpperCase();
const count = Math.min(Math.max(Number(process.argv[3] ?? 2), 1), 12);
if (!code) {
  console.error('Usage: node scripts/bots.js <ROOM_CODE> [number of bots]');
  process.exit(1);
}

const BASE = `http://localhost:${config.port}`;
const THINK_MS = 1200; // so humans can follow what the bots do
// only ids from the app's avatar allowlist (backend/src/utils/avatars.js): anything else shows as a blank circle
const AVATARS = ['owl', 'frog', 'panda', 'koala', 'raccoon', 'penguin', 'cat', 'fox', 'bear', 'lion', 'mouse', 'pig', 'rabbit', 'chick'];
const pool = createPool(config.db);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureBotUser(n) {
  const googleId = `dev-bot-${n}`;
  const [rows] = await pool.query('SELECT user_id FROM Users WHERE google_id = ?', [googleId]);
  if (rows.length) return rows[0].user_id;
  const [result] = await pool.query(
    'INSERT INTO Users (google_id, email, nickname, avatar) VALUES (?, ?, ?, ?)',
    [googleId, `bot${n}@bots.localhost`, `Bot_${n}`, AVATARS[(n - 1) % AVATARS.length]]
  );
  return result.insertId;
}

// A session exactly like the one express-session would save after a real login.
async function createSession(userId) {
  const sid = crypto.randomBytes(24).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.session.maxAgeMs);
  const data = {
    cookie: { originalMaxAge: config.session.maxAgeMs, expires, httpOnly: true, path: '/', sameSite: 'lax', secure: false },
    userId,
    csrfToken,
  };
  await pool.query('INSERT INTO sessions (session_id, expires, data) VALUES (?, ?, ?)', [
    sid, Math.floor(expires.getTime() / 1000), JSON.stringify(data),
  ]);
  const signature = crypto.createHmac('sha256', config.session.secret).update(sid).digest('base64').replace(/=+$/, '');
  return { sid, csrfToken, cookie: `flip7.sid=${encodeURIComponent(`s:${sid}.${signature}`)}` };
}

const score = (game, id) => game.players.find((p) => p.id === id)?.roundScore ?? 0;

// Simple strategy: stay once the hand is worth a fair amount, otherwise hit.
function chooseMove(game, me) {
  const d = game.decision;
  const mine = game.players.find((p) => p.id === me);
  if (d.type === 'hit_or_stay') {
    const risky = mine.numbers.length >= 5 || mine.roundScore >= 25;
    return { type: risky && !mine.hasSecondChance ? 'stay' : 'hit' };
  }
  if (d.type === 'choose_target') {
    // Freeze / Flip Three: aim at the opponent with the best round so far.
    const others = d.options.filter((id) => id !== me);
    const pick = others.sort((a, b) => score(game, b) - score(game, a))[0] ?? me;
    return { type: 'target', targetId: pick };
  }
  return { type: 'gift', targetId: d.options[0] };
}

async function startBot(n) {
  const userId = await ensureBotUser(n);
  const { sid, csrfToken, cookie } = await createSession(userId);
  const name = `Bot_${n}`;
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json.error?.code ?? ''}`);
    return json;
  };

  await api('POST', '/rooms/join', { code });
  console.log(`${name} joined room ${code}`);

  let busy = false;
  let lastAnswered = null;
  let readied = false;
  const socket = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'] });
  socket.on('connect_error', (e) => console.error(`${name}: socket error ${e.message}`));
  // The newest state, so a question that arrives while a move is still being sent
  // (e.g. a Freeze drawn by our own Hit) is answered as soon as that move finishes.
  let latest = null;
  socket.on('room:state', ({ room }) => {
    latest = room;
    handle(room);
  });
  async function handle(room) {
    if (!room) return console.log(`${name}: no longer in a room`);
    if (!room.matchOver) readied = false;
    if (room.matchOver && !readied) {
      readied = true;
      await sleep(THINK_MS);
      await api('POST', '/rooms/current/ready', { ready: true }).catch((e) => console.error(`${name}: ${e.message}`));
      return console.log(`${name} is ready for another match`);
    }
    const game = room.game;
    const d = game?.decision;
    if (!d || d.playerId !== userId || busy || lastAnswered === d.id) return;
    busy = true;
    lastAnswered = d.id;
    await sleep(THINK_MS);
    const move = chooseMove(game, userId);
    try {
      await api('POST', '/rooms/current/game/action', { ...move, decisionId: d.id });
      console.log(`${name}: ${move.type}${move.targetId ? ` -> player ${move.targetId}` : ''}`);
    } catch (e) {
      console.error(`${name}: ${e.message}`);
    } finally {
      busy = false;
    }
    if (latest && latest !== room) handle(latest);
  }

  return async function stop() {
    await api('POST', '/rooms/current/leave', { confirm: true }).catch(() => {});
    socket.close();
    await pool.query('DELETE FROM sessions WHERE session_id = ?', [sid]);
  };
}

const stops = [];
try {
  for (let n = 1; n <= count; n += 1) stops.push(await startBot(n));
  console.log(`${count} bot(s) playing. Press Ctrl+C to make them leave.`);
} catch (error) {
  console.error('Could not start the bots:', error.message);
  for (const stop of stops) await stop();
  await pool.end();
  process.exit(1);
}

process.on('SIGINT', async () => {
  for (const stop of stops) await stop();
  await pool.end();
  process.exit(0);
});
