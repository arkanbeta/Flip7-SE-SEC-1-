// Socket.IO against a real HTTP server and a REAL database. Skipped unless RUN_DB_TESTS=true.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, integrationEnabled } from './integrationHarness.js';
import { createRoomManager } from '../realtime/roomManager.js';
import { makeConfig, silentLogger } from './helpers.js';

describe.skipIf(!integrationEnabled)('real-time rooms (integration)', () => {
  let h;
  let modeId;
  const GRACE = 250;

  const post = (u, path, body = {}) => u.agent.post(`/api/rooms${path}`).set('X-CSRF-Token', u.csrfToken).send(body);
  const users = (n) => Promise.all(Array.from({ length: n }, () => h.createSignedInUser()));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(check, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return true;
      await sleep(20);
    }
    return false;
  }
  async function online(user) {
    const socket = h.connect(user);
    await h.opened(socket);
    return socket;
  }

  beforeAll(async () => {
    const manager = createRoomManager({ startPromptMs: 60_000, logger: silentLogger });
    h = createHarness({ roomManager: manager });
    await h.startRealtime({ graceMs: GRACE });
    const [rows] = await h.pool.query("SELECT game_mode_id AS id FROM GameModes WHERE name = 'Normal'");
    modeId = rows[0].id;
  });
  afterAll(async () => {
    await h.cleanup();
  });

  describe('who may connect', () => {
    it('refuses a connection without a login', async () => {
      const socket = h.connect(null, { cookie: undefined });
      await expect(h.opened(socket)).rejects.toThrow(/AUTH_REQUIRED/);
    });

    it('refuses a forged or unknown session cookie', async () => {
      const socket = h.connect(null, { cookie: 'flip7.sid=s%3Aforged.abc' });
      await expect(h.opened(socket)).rejects.toThrow(/AUTH_REQUIRED/);
    });

    it('refuses a browser connection from another website', async () => {
      const [u] = await users(1);
      const socket = h.connect(u, { headers: { origin: 'https://evil.example' } });
      await expect(h.opened(socket)).rejects.toBeTruthy();
    });

    it('accepts a signed-in player from our own origin', async () => {
      const [u] = await users(1);
      const socket = h.connect(u, { headers: { origin: makeConfig().clientOrigin } });
      await h.opened(socket);
      expect(socket.connected).toBe(true);
    });

    it('stops a logged-out browser: its sockets are closed on logout', async () => {
      const [u] = await users(1);
      const socket = await online(u);
      const closed = new Promise((resolve) => socket.once('disconnect', resolve));
      await u.agent.post('/api/auth/logout').set('X-CSRF-Token', u.csrfToken);
      await closed;
      expect(socket.connected).toBe(false);
    });

    it('limits how many connections one account can hold', async () => {
      const [u] = await users(1);
      const sockets = [];
      for (let i = 0; i < 5; i += 1) sockets.push(await online(u));
      const sixth = h.connect(u);
      const dropped = new Promise((resolve) => sixth.once('disconnect', resolve));
      await h.opened(sixth).catch(() => {});
      await dropped;
      expect(sixth.connected).toBe(false);
      expect(sockets.every((s) => s.connected)).toBe(true);
    });
  });

  describe('live room state', () => {
    it('sends the current state (or null) as soon as a player connects', async () => {
      const [owner, idle] = await users(2);
      const idleSocket = await online(idle);
      expect(await h.waitForState(idleSocket, (r) => r === null)).toBeNull();
      const created = await post(owner, '', { gameModeId: modeId, maxPlayers: 4 });
      const socket = await online(owner);
      const state = await h.waitForState(socket, (r) => r !== null);
      expect(state.code).toBe(created.body.room.code);
      expect(state.isCreator).toBe(true);
    });

    it('creating, joining and leaving reach everyone in the room without polling', async () => {
      const [owner, a, b] = await users(3);
      const ownerSocket = await online(owner);
      const { body } = await post(owner, '', { gameModeId: modeId, maxPlayers: 5 });
      const code = body.room.code;
      await h.waitForState(ownerSocket, (r) => r?.code === code && r.playerCount === 1);

      const aSocket = await online(a);
      await post(a, '/join', { code });
      await h.waitForState(ownerSocket, (r) => r?.playerCount === 2);
      const aState = await h.waitForState(aSocket, (r) => r?.playerCount === 2);
      expect(aState.players.map((p) => p.nickname)).toContain(owner.user.nickname);

      const bSocket = await online(b);
      await post(b, '/join', { code });
      await h.waitForState(aSocket, (r) => r?.playerCount === 3);

      await post(b, '/current/leave');
      await h.waitForState(ownerSocket, (r) => r?.playerCount === 2);
      expect(await h.waitForState(bSocket, (r) => r === null)).toBeNull(); // the leaver is told too
    });

    it('each player gets their OWN view: only the host sees the start question', async () => {
      const [owner, a, b] = await users(3);
      const o = await online(owner);
      const sa = await online(a);
      const { body } = await post(owner, '', { gameModeId: modeId, maxPlayers: 4 });
      await post(a, '/join', { code: body.room.code });
      await post(b, '/join', { code: body.room.code });
      const host = await h.waitForState(o, (r) => r?.playerCount === 3);
      const guest = await h.waitForState(sa, (r) => r?.playerCount === 3);
      expect(host.startPrompt).not.toBeNull();
      expect(host.isCreator).toBe(true);
      expect(guest.startPrompt).toBeNull();
      expect(guest.isCreator).toBe(false);
      expect(JSON.stringify(guest)).not.toContain('autoStartAt');
    });

    it('does not leak other rooms: outsiders hear nothing about a room', async () => {
      const [owner, a, outsider] = await users(3);
      const out = await online(outsider);
      await h.waitForState(out, (r) => r === null);
      const before = out.states.length;
      const { body } = await post(owner, '', { gameModeId: modeId, maxPlayers: 4 });
      await post(a, '/join', { code: body.room.code });
      await sleep(150);
      expect(out.states.length).toBe(before);
    });

    it('starting the game is pushed to the whole room', async () => {
      const [owner, a, b] = await users(3);
      const { body } = await post(owner, '', { gameModeId: modeId, maxPlayers: 4 });
      await post(a, '/join', { code: body.room.code });
      await post(b, '/join', { code: body.room.code });
      const sa = await online(a);
      await post(owner, '/current/start');
      expect((await h.waitForState(sa, (r) => r?.status === 'In Progress')).status).toBe('In Progress');
    });

    it('closing the room (host leaves a waiting room) tells every member', async () => {
      const [owner, a] = await users(2);
      const { body } = await post(owner, '', { gameModeId: modeId, maxPlayers: 4 });
      await post(a, '/join', { code: body.room.code });
      const sa = await online(a);
      await h.waitForState(sa, (r) => r?.playerCount === 2);
      await post(owner, '/current/leave');
      expect(await h.waitForState(sa, (r) => r === null)).toBeNull();
    });

    it('state versions never go backwards for one room', async () => {
      const [owner, a] = await users(2);
      const o = await online(owner);
      const { body } = await post(owner, '', { gameModeId: modeId, maxPlayers: 4 });
      await post(a, '/join', { code: body.room.code });
      await h.waitForState(o, (r) => r?.playerCount === 2);
      const versions = o.states.filter((r) => r?.code === body.room.code).map((r) => r.version);
      expect(versions.length).toBeGreaterThan(1);
      expect(Math.max(...versions)).toBe(versions[versions.length - 1] ?? 0);
    });
  });

  describe('disconnects and reconnects', () => {
    it('keeps the seat during a short disconnect (page refresh)', async () => {
      const [owner, a] = await users(2);
      const { body } = await post(owner, '', { gameModeId: modeId, maxPlayers: 4 });
      await post(a, '/join', { code: body.room.code });
      const o = await online(owner);
      const s1 = await online(a);
      await h.waitForState(s1, (r) => r?.playerCount === 2);
      s1.close();
      await sleep(GRACE / 3);
      const s2 = await online(a); // back in time
      expect((await h.waitForState(s2, (r) => r?.playerCount === 2)).playerCount).toBe(2);
      await sleep(GRACE * 2); // the old timer must have been cancelled
      expect(h.manager.getRoomOfUser(a.user.id)).toBeTruthy();
      expect(o.connected).toBe(true);
    });

    it('removes a player who does not come back, and tells the others', async () => {
      const [owner, a, b] = await users(3);
      const { body } = await post(owner, '', { gameModeId: modeId, maxPlayers: 5 });
      await post(a, '/join', { code: body.room.code });
      await post(b, '/join', { code: body.room.code });
      const o = await online(owner);
      const sa = await online(a);
      const sb = await online(b);
      await h.waitForState(sb, (r) => r?.playerCount === 3);
      sa.close();
      expect(await until(() => h.manager.getRoomOfUser(a.user.id) === undefined || h.manager.getRoomOfUser(a.user.id) === null)).toBe(true);
      expect((await h.waitForState(o, (r) => r?.playerCount === 2)).players.map((p) => p.id)).not.toContain(a.user.id);
    });

    it('a waiting-room host who disconnects for good terminates the room', async () => {
      const [owner, a] = await users(2);
      const { body } = await post(owner, '', { gameModeId: modeId, maxPlayers: 4 });
      await post(a, '/join', { code: body.room.code });
      const o = await online(owner);
      const sa = await online(a);
      await h.waitForState(sa, (r) => r?.playerCount === 2);
      o.close();
      expect(await h.waitForState(sa, (r) => r === null)).toBeNull();
      const [rows] = await h.pool.query('SELECT 1 FROM GameRooms WHERE room_code = ?', [body.room.code]);
      expect(rows).toHaveLength(0);
    });

    it('a host who disconnects DURING a match passes the room on', async () => {
      const [owner, a, b] = await users(3);
      const { body } = await post(owner, '', { gameModeId: modeId, maxPlayers: 4 });
      await post(a, '/join', { code: body.room.code });
      await post(b, '/join', { code: body.room.code });
      await post(owner, '/current/start');
      const o = await online(owner);
      const sa = await online(a);
      await h.waitForState(sa, (r) => r?.status === 'In Progress');
      o.close();
      const state = await h.waitForState(sa, (r) => r?.isCreator === true);
      expect(state.creatorId).toBe(a.user.id);
    });

    it('someone who creates a room over HTTP and never connects is removed after the grace period', async () => {
      const [ghost] = await users(1);
      const { body } = await post(ghost, '', { gameModeId: modeId, maxPlayers: 4 });
      expect(await until(() => !h.manager.getRoom(body.room.code))).toBe(true);
    });

    it('a second tab keeps the player present when the first closes', async () => {
      const [owner, a] = await users(2);
      const { body } = await post(owner, '', { gameModeId: modeId, maxPlayers: 4 });
      await post(a, '/join', { code: body.room.code });
      const o = await online(owner);
      const tab1 = await online(a);
      const tab2 = await online(a);
      tab1.close();
      await sleep(GRACE * 2);
      expect(h.manager.getRoomOfUser(a.user.id)).toBeTruthy();
      expect(tab2.connected && o.connected).toBe(true);
    });
  });

  it('ignores anything the browser sends (no input handlers to abuse)', async () => {
    const [u] = await users(1);
    const socket = await online(u);
    socket.emit('room:state', { room: { code: 'HACK' } });
    socket.emit('join', { code: 'X' });
    await sleep(100);
    expect(socket.connected).toBe(true);
    expect(h.manager.getRoomOfUser(u.user.id) ?? null).toBeNull();
  });
});
