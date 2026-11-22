// The room system over real HTTP and a REAL database. Skipped unless RUN_DB_TESTS=true.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createHarness, integrationEnabled } from './integrationHarness.js';
import { createRoomManager } from '../realtime/roomManager.js';
import { silentLogger } from './helpers.js';

const PROMPT_MS = 60_000; // long: timers must not fire in ordinary tests

describe.skipIf(!integrationEnabled)('rooms (integration)', () => {
  let h;
  let modeId;
  let codeQueue = [];
  const nextCode = () => codeQueue.shift() ?? `Z${Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[01OIL]/g, 'X')}`;

  const post = (u, path, body = {}) => u.agent.post(`/api/rooms${path}`).set('X-CSRF-Token', u.csrfToken).send(body);
  const get = (u, path) => u.agent.get(`/api/rooms${path}`);
  const create = (u, maxPlayers = 5) => post(u, '', { gameModeId: modeId, maxPlayers });
  const roomRow = async (code) => {
    const [rows] = await h.pool.query('SELECT * FROM GameRooms WHERE room_code = ?', [code]);
    return rows[0] ?? null;
  };
  const users = (n) => Promise.all(Array.from({ length: n }, () => h.createSignedInUser()));
  // Makes a room owned by `owner` with the given extra players already joined.
  async function roomWith(owner, others, maxPlayers = 5) {
    const { body } = await create(owner, maxPlayers);
    for (const u of others) expect((await post(u, '/join', { code: body.room.code })).status).toBe(200);
    return body.room.code;
  }
  const waitFor = async (check, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  };

  beforeAll(async () => {
    const manager = createRoomManager({ startPromptMs: PROMPT_MS, logger: silentLogger });
    h = createHarness({ roomManager: manager, generateRoomCode: () => nextCode() });
    const [rows] = await h.pool.query("SELECT game_mode_id AS id FROM GameModes WHERE name = 'Normal'");
    modeId = rows[0].id;
  });
  afterAll(async () => {
    await h.cleanup();
  });

  describe('access control', () => {
    it.each([
      ['get', '/modes'], ['get', '/current'], ['post', ''], ['post', '/join'],
      ['post', '/current/leave'], ['post', '/current/start'], ['post', '/current/start-response'],
    ])('%s /api/rooms%s refuses visitors', async (method, path) => {
      const res = await request(h.app)[method](`/api/rooms${path}`).send({});
      expect([401, 403]).toContain(res.status); // 401 for GET; POST is stopped by CSRF first
    });

    it('POST endpoints demand a CSRF token', async () => {
      const u = await h.createSignedInUser();
      for (const path of ['', '/join', '/current/leave', '/current/start']) {
        const res = await u.agent.post(`/api/rooms${path}`).send({});
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('CSRF_INVALID');
      }
    });

    it('lists the predefined game modes (Normal only)', async () => {
      const u = await h.createSignedInUser();
      const res = await get(u, '/modes');
      expect(res.status).toBe(200);
      expect(res.body.modes.map((m) => m.name)).toEqual(['Normal']);
    });
  });

  describe('creating a room', () => {
    it('stores the room with its creator, mode and capacity, and returns the waiting-room state', async () => {
      const [owner] = await users(1);
      codeQueue = ['CRTE22'];
      const res = await create(owner, 6);
      expect(res.status).toBe(201);
      expect(res.body.room).toMatchObject({
        code: 'CRTE22', status: 'Waiting', maxPlayers: 6, minPlayers: 3, playerCount: 1,
        isCreator: true, canStart: false, creatorId: owner.user.id,
        gameMode: { id: modeId, name: 'Normal' },
      });
      expect(res.body.room.players).toEqual([{ id: owner.user.id, nickname: owner.user.nickname, avatar: 'fox', isCreator: true, isSpectator: false, canKick: false }]);
      const row = await roomRow('CRTE22');
      expect(row).toMatchObject({ creator_id: owner.user.id, game_mode_id: modeId, max_players: 6, status: 'Waiting' });
    });

    it.each([2, 13, 3.5, '5', null])('rejects capacity %j', async (maxPlayers) => {
      const [owner] = await users(1);
      const res = await post(owner, '', { gameModeId: modeId, maxPlayers });
      expect(res.status).toBe(400);
      expect(res.body.error.details.field).toBe('maxPlayers');
      expect((await get(owner, '/current')).body.room).toBeNull();
    });

    it('accepts both ends of the allowed range', async () => {
      const [a, b] = await users(2);
      expect((await create(a, 3)).status).toBe(201);
      expect((await create(b, 12)).status).toBe(201);
    });

    it('rejects a missing or unknown game mode', async () => {
      const [owner] = await users(1);
      expect((await post(owner, '', { maxPlayers: 4 })).status).toBe(400);
      const res = await post(owner, '', { gameModeId: 999999, maxPlayers: 4 });
      expect(res.status).toBe(400);
      expect(res.body.error.details.field).toBe('gameModeId');
    });

    it('does not let someone create a second room while in one', async () => {
      const [owner] = await users(1);
      const first = await create(owner);
      const res = await create(owner);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_IN_OTHER_ROOM');
      expect(res.body.error.details.code).toBe(first.body.room.code);
    });

    it('two simultaneous requests from ONE account create exactly one room', async () => {
      const [owner] = await users(1);
      codeQueue = ['SAME01', 'SAME02'];
      const [a, b] = await Promise.all([create(owner), create(owner)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const [rows] = await h.pool.query('SELECT COUNT(*) AS n FROM GameRooms WHERE creator_id = ?', [owner.user.id]);
      expect(Number(rows[0].n)).toBe(1); // the loser's row was removed again
    });
  });

  describe('room-code uniqueness', () => {
    it('draws another code when the first one is taken (duplicate-key retry)', async () => {
      const [a, b] = await users(2);
      codeQueue = ['DUPL42'];
      expect((await create(a)).body.room.code).toBe('DUPL42');
      codeQueue = ['DUPL42', 'DUPL42', 'FRSH77']; // collides twice, then succeeds
      const res = await create(b);
      expect(res.status).toBe(201);
      expect(res.body.room.code).toBe('FRSH77');
      const [rows] = await h.pool.query("SELECT COUNT(*) AS n FROM GameRooms WHERE room_code IN ('DUPL42','FRSH77')");
      expect(Number(rows[0].n)).toBe(2);
    });

    it('treats codes as case-insensitive (the database collation catches look-alikes)', async () => {
      const [a, b] = await users(2);
      codeQueue = ['CASE55'];
      await create(a);
      codeQueue = ['case55', 'CASE66'];
      expect((await create(b)).body.room.code).toBe('CASE66');
    });

    it('gives up cleanly with 503 if it can never find a free code', async () => {
      const [a, b] = await users(2);
      codeQueue = ['FULL11'];
      await create(a);
      codeQueue = Array(10).fill('FULL11');
      const res = await create(b);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('ROOM_CODE_UNAVAILABLE');
      expect((await get(b, '/current')).body.room).toBeNull();
    });

    it('simultaneous creations that collide both succeed, with different codes', async () => {
      const [a, b, c] = await users(3);
      codeQueue = ['RACE11', 'RACE11', 'RACE11', 'RACE22', 'RACE33'];
      const results = await Promise.all([create(a), create(b), create(c)]);
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
      const codes = results.map((r) => r.body.room.code);
      expect(new Set(codes).size).toBe(3);
      expect(codes).toContain('RACE11');
    });

    it('many simultaneous creations all get distinct real codes', async () => {
      const people = await users(8);
      codeQueue = [];
      const results = await Promise.all(people.map((p) => create(p)));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.room.code)).size).toBe(8);
    });
  });

  describe('joining a room', () => {
    it('joins with the code (any capitalisation, with spaces) and shows up in the player list', async () => {
      const [owner, guest] = await users(2);
      codeQueue = ['JOIN22'];
      const code = await roomWith(owner, []);
      const res = await post(guest, '/join', { code: ' join22 ' });
      expect(res.status).toBe(200);
      expect(res.body.room).toMatchObject({ code, playerCount: 2, isCreator: false, canStart: false });
      expect(res.body.room.players.map((p) => p.nickname)).toEqual([owner.user.nickname, guest.user.nickname]);
      const ownerView = (await get(owner, '/current')).body.room;
      expect(ownerView.playerCount).toBe(2);
    });

    it.each(['abc', 'TOOLONGCODE1', 'AB CD!', '', '<script>'])('rejects the malformed code %j', async (code) => {
      const [guest] = await users(1);
      const res = await post(guest, '/join', { code });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ROOM_CODE');
    });

    it('says "not found" for a well-formed code with no room', async () => {
      const [guest] = await users(1);
      const res = await post(guest, '/join', { code: 'NOROOM' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ROOM_NOT_FOUND');
    });

    it('refuses a full room (capacity 3)', async () => {
      const [owner, a, b, late] = await users(4);
      const code = await roomWith(owner, [a, b], 3);
      const res = await post(late, '/join', { code });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ROOM_FULL');
      expect((await get(owner, '/current')).body.room.playerCount).toBe(3);
    });

    it('lets only one of several simultaneous joiners take the last slot', async () => {
      const [owner, a, x, y, z] = await users(5);
      const code = await roomWith(owner, [a], 4); // 2 of 4 taken -> room for exactly 2 more... fill to 3 first
      const [b] = await users(1);
      await post(b, '/join', { code }); // now 3 of 4
      const results = await Promise.all([x, y, z].map((u) => post(u, '/join', { code })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.body.error?.code === 'ROOM_FULL')).toHaveLength(2);
      expect((await get(owner, '/current')).body.room.playerCount).toBe(4);
    });

    it('is idempotent for a member opening the same room again (no duplicate)', async () => {
      const [owner, guest] = await users(2);
      const code = await roomWith(owner, [guest]);
      const again = await post(guest, '/join', { code });
      expect(again.status).toBe(200);
      expect(again.body.room.playerCount).toBe(2);
    });

    it('refuses someone who is in another room and tells them which one', async () => {
      const [o1, o2] = await users(2);
      const c1 = await roomWith(o1, []);
      const c2 = await roomWith(o2, []);
      const res = await post(o1, '/join', { code: c2 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_IN_OTHER_ROOM');
      expect(res.body.error.details.code).toBe(c1);
    });

    it('lets a late arrival watch a game in progress (capacity 5: three players + 1 spectator)', async () => {
      const [owner, a, b, late] = await users(4);
      const code = await roomWith(owner, [a, b]);
      expect((await post(owner, '/current/start')).status).toBe(200);
      const res = await post(late, '/join', { code });
      expect(res.status).toBe(200);
      expect(res.body.room).toMatchObject({ isSpectator: true, status: 'In Progress' });
      expect(res.body.room.game.players).toHaveLength(3); // the spectator is not dealt in
    });

    it('refuses a late arrival when the room is full', async () => {
      const [owner, a, b, c, late] = await users(5);
      const code = await roomWith(owner, [a, b, c], 4); // capacity 4 is full
      expect((await post(owner, '/current/start')).status).toBe(200);
      const res = await post(late, '/join', { code });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ROOM_FULL');
    });
  });

  describe('GET /current', () => {
    it('is null for someone not in a room', async () => {
      const [u] = await users(1);
      expect((await get(u, '/current')).body).toEqual({ room: null });
    });

    it('shows each person their own viewpoint, and the creator-only start question', async () => {
      const [owner, a, b] = await users(3);
      const code = await roomWith(owner, [a, b]);
      const ownerView = (await get(owner, '/current')).body.room;
      expect(ownerView).toMatchObject({ code, isCreator: true, canStart: true, playerCount: 3 });
      expect(ownerView.startPrompt.autoStartAt).toBeGreaterThan(ownerView.serverNow);
      expect(ownerView.startPrompt.autoStartAt - ownerView.serverNow).toBeLessThanOrEqual(PROMPT_MS);
      const guestView = (await get(a, '/current')).body.room;
      expect(guestView).toMatchObject({ isCreator: false, canStart: false, startPrompt: null, nextPromptAt: null });
    });

    it('shows current nicknames and avatars (a profile change appears in the room)', async () => {
      const [owner, guest] = await users(2);
      await roomWith(owner, [guest]);
      const nickname = h.uniqueNickname();
      await guest.agent.patch('/api/users/me').set('X-CSRF-Token', guest.csrfToken).send({ nickname, avatar: 'owl' });
      const view = (await get(owner, '/current')).body.room;
      expect(view.players.find((p) => p.id === guest.user.id)).toMatchObject({ nickname, avatar: 'owl' });
    });
  });

  describe('starting the game', () => {
    it('is refused for a non-creator (403) and below 3 players (409)', async () => {
      const [owner, a, b] = await users(3);
      const code = await roomWith(owner, [a]);
      expect((await post(owner, '/current/start')).body.error.code).toBe('NOT_ENOUGH_PLAYERS');
      await post(b, '/join', { code });
      const res = await post(a, '/current/start');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NOT_CREATOR');
      expect((await roomRow(code)).status).toBe('Waiting');
    });

    it('lets the creator start: status becomes In Progress in memory and in the database', async () => {
      const [owner, a, b] = await users(3);
      const code = await roomWith(owner, [a, b]);
      const res = await post(owner, '/current/start');
      expect(res.status).toBe(200);
      expect(res.body.room.status).toBe('In Progress');
      expect((await roomRow(code)).status).toBe('In Progress');
      expect((await get(a, '/current')).body.room.status).toBe('In Progress');
    });

    it('cannot be started twice', async () => {
      const [owner, a, b] = await users(3);
      await roomWith(owner, [a, b]);
      await post(owner, '/current/start');
      expect((await post(owner, '/current/start')).body.error.code).toBe('ROOM_NOT_WAITING');
    });

    it('a player cannot start by pretending to be the creator (the user comes from the session)', async () => {
      const [owner, a, b] = await users(3);
      await roomWith(owner, [a, b]);
      const res = await a.agent.post('/api/rooms/current/start').set('X-CSRF-Token', a.csrfToken).send({ userId: owner.user.id, creatorId: owner.user.id });
      expect(res.status).toBe(403);
    });
  });

  describe('the start question', () => {
    it('"yes" starts immediately', async () => {
      const [owner, a, b] = await users(3);
      const code = await roomWith(owner, [a, b]);
      const res = await post(owner, '/current/start-response', { answer: 'yes' });
      expect(res.body.room.status).toBe('In Progress');
      expect((await roomRow(code)).status).toBe('In Progress');
    });

    it('"no" clears the question and schedules the next one', async () => {
      const [owner, a, b] = await users(3);
      const code = await roomWith(owner, [a, b]);
      const res = await post(owner, '/current/start-response', { answer: 'no' });
      expect(res.status).toBe(200);
      expect(res.body.room.status).toBe('Waiting');
      expect(res.body.room.startPrompt).toBeNull();
      expect(res.body.room.nextPromptAt).toBeGreaterThan(res.body.room.serverNow);
      expect((await roomRow(code)).status).toBe('Waiting');
    });

    it('is creator-only, validated, and only while a question is pending', async () => {
      const [owner, a, b] = await users(3);
      await roomWith(owner, [a, b]);
      expect((await post(a, '/current/start-response', { answer: 'yes' })).status).toBe(403);
      expect((await post(owner, '/current/start-response', { answer: 'maybe' })).status).toBe(400);
      await post(owner, '/current/start-response', { answer: 'no' });
      expect((await post(owner, '/current/start-response', { answer: 'yes' })).body.error.code).toBe('NO_PENDING_PROMPT');
    });

    it('starts the game on its own when the creator does not answer in time (real timer)', async () => {
      const fast = createRoomManager({ startPromptMs: 150, hooks: {}, logger: silentLogger });
      const fh = createHarness({ roomManager: fast, generateRoomCode: () => nextCode() });
      try {
        const [owner, a, b] = await Promise.all([1, 2, 3].map(() => fh.createSignedInUser()));
        const mk = (u, path, body) => u.agent.post(`/api/rooms${path}`).set('X-CSRF-Token', u.csrfToken).send(body);
        const { body } = await mk(owner, '', { gameModeId: modeId, maxPlayers: 4 });
        await mk(a, '/join', { code: body.room.code });
        await mk(b, '/join', { code: body.room.code });
        expect(await waitFor(async () => {
          const [rows] = await fh.pool.query('SELECT status FROM GameRooms WHERE room_code = ?', [body.room.code]);
          return rows[0]?.status === 'In Progress';
        })).toBe(true);
        expect((await owner.agent.get('/api/rooms/current')).body.room.status).toBe('In Progress');
      } finally {
        await fh.cleanup();
      }
    });
  });

  describe('leaving', () => {
    it('a player leaving frees their slot and updates the others', async () => {
      const [owner, a, b] = await users(3);
      const code = await roomWith(owner, [a, b], 3);
      const res = await post(a, '/current/leave');
      expect(res.body).toEqual({ closed: false });
      expect((await get(a, '/current')).body.room).toBeNull();
      const view = (await get(owner, '/current')).body.room;
      expect(view.playerCount).toBe(2);
      expect(view.startPrompt).toBeNull(); // below 3 again: the question is cancelled
      const [late] = await users(1);
      expect((await post(late, '/join', { code })).status).toBe(200); // the slot is free again
    });

    it('the creator leaving before the game starts terminates the room and deletes its row', async () => {
      const [owner, a, b] = await users(3);
      const code = await roomWith(owner, [a, b]);
      const res = await post(owner, '/current/leave');
      expect(res.body).toEqual({ closed: true });
      expect(await roomRow(code)).toBeNull();
      expect((await get(a, '/current')).body.room).toBeNull();
      expect((await get(b, '/current')).body.room).toBeNull();
      const [late] = await users(1);
      expect((await post(late, '/join', { code })).body.error.code).toBe('ROOM_NOT_FOUND');
    });

    it('the last player leaving deletes the room row', async () => {
      const [owner, a] = await users(2);
      const code = await roomWith(owner, [a]);
      await post(a, '/current/leave');
      expect(await roomRow(code)).not.toBeNull(); // the creator is still inside
      await post(owner, '/current/leave');
      expect(await roomRow(code)).toBeNull();
    });

    it('a deleted room frees its code for a new room', async () => {
      const [a, b] = await users(2);
      codeQueue = ['REUSE9'];
      await create(a);
      await post(a, '/current/leave');
      codeQueue = ['REUSE9'];
      expect((await create(b)).body.room.code).toBe('REUSE9');
    });

    it('the creator leaving DURING the game passes ownership to the longest-present player', async () => {
      const [owner, a, b, c] = await users(4);
      const code = await roomWith(owner, [a, b, c]);
      await post(owner, '/current/start');
      const res = await post(owner, '/current/leave', { confirm: true }); // a running match needs confirmation
      expect(res.body).toEqual({ closed: false });
      const row = await roomRow(code);
      expect(row.creator_id).toBe(a.user.id);
      expect((await get(a, '/current')).body.room).toMatchObject({ isCreator: true, creatorId: a.user.id });
      expect((await get(b, '/current')).body.room.isCreator).toBe(false);
    });

    it('says so when you are not in a room, and a leaver can join another room', async () => {
      const [owner, guest, other] = await users(3);
      expect((await post(guest, '/current/leave')).body.error.code).toBe('NOT_IN_ROOM');
      const code = await roomWith(owner, [guest]);
      await post(guest, '/current/leave');
      const code2 = await roomWith(other, []);
      expect((await post(guest, '/join', { code: code2 })).status).toBe(200);
      expect(code).not.toBe(code2);
    });
  });
});
