// Shared setup for integration tests that need signed-in users: a real MySQL pool,
// the real app, a fake Google, and helpers to create accounts and seed matches.
// (Tests using it are skipped unless RUN_DB_TESTS=true.)
import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import request from 'supertest';
import { io as connectClient } from 'socket.io-client';
import { attachRealtime } from '../realtime/socketServer.js';
import { createApp } from '../app.js';
import { createPool } from '../db/pool.js';
import { loadConfig } from '../config/env.js';
import { makeConfig, silentLogger } from './helpers.js';

export const integrationEnabled = process.env.RUN_DB_TESTS === 'true';

// options: { roomManager, generateRoomCode } let a test control timers and room codes.
export function createHarness(options = {}) {
  const prefix = `h${Date.now()}${crypto.randomBytes(2).toString('hex')}`;
  let counter = 0;
  const codes = new Map();

  const google = {
    getAuthorizationUrl: ({ state, nonce }) => `https://accounts.google.test/auth?state=${state}&nonce=${nonce}`,
    async exchangeCode({ code }) {
      const identity = codes.get(code);
      if (!identity) throw new Error('unknown code');
      return identity;
    },
  };

  const pool = createPool(loadConfig().db);
  const app = createApp({ config: makeConfig(), pool, googleOAuth: google, logger: silentLogger, ...options });
  const manager = app.locals.roomManager;
  // Random part: test files run in parallel, each with its own counter, so time + counter
  // alone can collide between files (NICKNAME_TAKEN). Max length: 1 + 6 + 4 + counter <= 20.
  const uniqueNickname = () => `n${Date.now() % 1e6}${crypto.randomBytes(2).toString('hex')}${(counter += 1)}`;

  async function signIn(agent, identity) {
    const start = await agent.get('/api/auth/google?intent=login');
    const state = new URL(start.headers.location).searchParams.get('state');
    const code = crypto.randomBytes(8).toString('hex');
    codes.set(code, identity);
    return agent.get(`/api/auth/google/callback?code=${code}&state=${state}`);
  }

  // Creates an account through the real HTTP flow; returns an agent already signed in.
  async function createSignedInUser({ nickname = uniqueNickname(), avatar = 'fox' } = {}) {
    counter += 1;
    const identity = { googleId: `${prefix}_g${counter}`, email: `${prefix}_${counter}@example.test`, emailVerified: true };
    const agent = request.agent(app);
    await signIn(agent, identity);
    const { body } = await agent.get('/api/auth/me');
    const res = await agent.post('/api/auth/register').set('X-CSRF-Token', body.csrfToken).send({ nickname, avatar });
    if (res.status !== 201) throw new Error(`registration failed: ${res.status} ${JSON.stringify(res.body)}`);
    const me = await agent.get('/api/auth/me');
    // The login cookie as a header value, for Socket.IO clients (which have no cookie jar).
    const cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
    return { agent, user: res.body.user, csrfToken: me.body.csrfToken, identity, cookie };
  }

  let normalModeId;
  async function modeId() {
    if (!normalModeId) {
      const [rows] = await pool.query("SELECT game_mode_id AS id FROM GameModes WHERE name = 'Normal'");
      normalModeId = rows[0].id;
    }
    return normalModeId;
  }

  const seededMatchIds = [];
  // players = [{ userId, finalPoints, rankingPoints, hits, busts }]
  async function seedMatch({ finishedAt, rounds = 3, players }) {
    const [result] = await pool.query(
      "INSERT INTO MatchHistories (game_mode_id, started_at, finished_at, number_of_rounds, status) VALUES (?, ?, ?, ?, 'Completed')",
      [await modeId(), new Date(finishedAt.getTime() - 600_000), finishedAt, rounds]
    );
    seededMatchIds.push(result.insertId);
    for (const p of players) {
      await pool.query(
        'INSERT INTO MatchPlayers (match_id, user_id, final_points, ranking_points, hits, busts) VALUES (?, ?, ?, ?, ?, ?)',
        [result.insertId, p.userId, p.finalPoints, p.rankingPoints, p.hits, p.busts]
      );
    }
    return result.insertId;
  }

  // Starts a real HTTP server with Socket.IO attached. connect(user) opens an authenticated
  // client; waitForState(socket, predicate) resolves with the first matching `room:state`.
  let httpServer;
  let realtime;
  const clients = [];
  async function startRealtime(overrides = {}) {
    httpServer = http.createServer(app);
    realtime = attachRealtime({
      httpServer,
      config: makeConfig(),
      sessionMiddleware: app.locals.sessionMiddleware,
      roomService: app.locals.roomService,
      manager,
      logger: silentLogger,
      ...overrides,
    });
    app.locals.realtime = realtime;
    await new Promise((resolve) => httpServer.listen(0, resolve));
    return realtime;
  }
  const url = () => `http://localhost:${httpServer.address().port}`;
  function connect(user, { cookie = user?.cookie, headers = {} } = {}) {
    const socket = connectClient(url(), {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { ...(cookie ? { cookie } : {}), ...headers },
    });
    socket.states = []; // every room:state received, in order
    socket.on('room:state', (payload) => socket.states.push(payload.room));
    clients.push(socket);
    return socket;
  }
  const opened = (socket) =>
    new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  async function waitForState(socket, predicate = () => true, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = socket.states.findLast(predicate);
      if (found !== undefined) return found;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`no matching room:state within ${ms}ms (got ${JSON.stringify(socket.states.map((r) => r && r.playerCount))})`);
  }

  // Deletes everything this harness created, in foreign-key order, and closes the pool.
  const trackedMatchIds = [];
  async function cleanup() {
    for (const c of clients) c.close();
    realtime?.close();
    app.locals.gameManager.shutdown();
    manager.shutdown();
    // Rooms reference their creator (ON DELETE RESTRICT), so they go first.
    await pool.query('DELETE gr FROM GameRooms gr JOIN Users u ON u.user_id = gr.creator_id WHERE u.google_id LIKE ?', [`${prefix}%`]);
    if (seededMatchIds.length > 0) {
      await pool.query('DELETE FROM MatchPlayers WHERE match_id IN (?)', [seededMatchIds]);
      await pool.query('DELETE FROM MatchHistories WHERE match_id IN (?)', [seededMatchIds]);
    }
    // Matches that the games saved while the tests ran (found through their players).
    const [saved] = await pool.query(
      'SELECT DISTINCT mp.match_id FROM MatchPlayers mp JOIN Users u ON u.user_id = mp.user_id WHERE u.google_id LIKE ?',
      [`${prefix}%`]
    );
    const ids = [...new Set([...saved.map((r) => r.match_id), ...trackedMatchIds])];
    if (ids.length > 0) {
      await pool.query('DELETE FROM MatchPlayers WHERE match_id IN (?)', [ids]);
      await pool.query('DELETE FROM MatchHistories WHERE match_id IN (?)', [ids]);
    }
    await pool.query('DELETE FROM Users WHERE google_id LIKE ?', [`${prefix}%`]);
    await pool.end();
  }

  const trackMatch = (id) => trackedMatchIds.push(id);
  return { app, pool, manager, trackMatch, startRealtime, connect, opened, waitForState, createSignedInUser, seedMatch, cleanup, uniqueNickname };
}
