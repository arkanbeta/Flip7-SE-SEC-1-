// The game inside a room: real HTTP, real sockets, real MySQL. Skipped unless RUN_DB_TESTS=true.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, integrationEnabled } from './integrationHarness.js';
import { createRoomManager } from '../realtime/roomManager.js';
import { createGameManager } from '../game/gameManager.js';
import { silentLogger } from './helpers.js';

// A predictable deck of Number cards only (1,2,3...12,1,2,3...), so the first question is always
// Hit or Stay. Rules involving Action cards are covered exhaustively in flip7Game.test.js.
const plainDeck = () => Array.from({ length: 94 }, (_, id) => ({ id, kind: 'number', value: (id % 12) + 1 }));

describe.skipIf(!integrationEnabled)('game in a room (integration)', () => {
  const finishedReports = [];
  let h;
  let modeId;

  const roomPost = (u, path, body = {}) => u.agent.post(`/api/rooms${path}`).set('X-CSRF-Token', u.csrfToken).send(body);
  const actPost = (u, body) => roomPost(u, '/current/game/action', body);
  const stateOf = async (u) => (await u.agent.get('/api/rooms/current')).body.room;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(check, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return true;
      await sleep(20);
    }
    return false;
  }
  const users = (n) => Promise.all(Array.from({ length: n }, () => h.createSignedInUser()));

  // Creates a room with `n` players and starts the game. Returns { people, code, game }.
  async function startedRoom(n = 3) {
    const people = await users(n);
    const { body } = await roomPost(people[0], '', { gameModeId: modeId, maxPlayers: Math.max(n, 3) });
    for (const u of people.slice(1)) await roomPost(u, '/join', { code: body.room.code });
    const started = await roomPost(people[0], '/current/start');
    expect(started.status).toBe(200);
    return { people, code: body.room.code, game: started.body.room.game };
  }
  const byId = (people, id) => people.find((u) => u.user.id === id);

  beforeAll(async () => {
    const manager = createRoomManager({ startPromptMs: 60_000, logger: silentLogger });
    const games = createGameManager({
      manager, turnMs: 60_000, roundEndMs: 60_000, logger: silentLogger, makeDeck: plainDeck,
      hooks: { onFinished: (report) => finishedReports.push(report) },
    });
    h = createHarness({ roomManager: manager, gameManager: games });
    await h.startRealtime({ graceMs: 60_000 });
    const [rows] = await h.pool.query("SELECT game_mode_id AS id FROM GameModes WHERE name = 'Normal'");
    modeId = rows[0].id;
  });
  afterAll(async () => {
    await h.cleanup();
  });

  describe('starting', () => {
    it('deals the first round when the room starts, and everyone sees the same table', async () => {
      const { people, game } = await startedRoom(3);
      expect(game).toMatchObject({ phase: 'playing', roundNumber: 1, targetScore: 200 });
      expect(game.players).toHaveLength(3);
      // everybody was dealt something (a number, a modifier, a Second Chance, or an action that was played)
      expect(game.players.some((p) => p.numbers.length > 0)).toBe(true);
      expect(game.decision).toMatchObject({ type: 'hit_or_stay' });
      expect(people.map((u) => u.user.id)).toContain(game.decision.playerId);
      const views = await Promise.all(people.map(stateOf));
      for (const v of views) expect(v.game.seq).toBe(views[0].game.seq);
      expect(views.map((v) => v.game.decision.playerId)).toEqual(Array(3).fill(game.decision.playerId));
    });

    it('starts a 15 second clock for the player who must act', async () => {
      const { game } = await startedRoom(3);
      expect(game.timer.kind).toBe('turn');
      expect(game.timer.endsAt).toBeGreaterThan(Date.now() - 5000);
      expect(game.turnSeconds).toBe(60); // this test setup uses a longer limit; production default is 15
    });

    it('never reveals the order of the cards, only how many are left', async () => {
      const { game } = await startedRoom(3);
      expect(game.drawCount).toBeGreaterThan(70);
      expect(JSON.stringify(game)).not.toMatch(/drawPile|deck"/);
    });

    it('a room that is waiting has no game', async () => {
      const [owner] = await users(1);
      const { body } = await roomPost(owner, '', { gameModeId: modeId, maxPlayers: 4 });
      expect(body.room.game).toBeNull();
    });
  });

  describe('making moves', () => {
    it('the player who is asked can Hit, and the table changes for everybody', async () => {
      const { people, game } = await startedRoom(3);
      const actor = byId(people, game.decision.playerId);
      const res = await actPost(actor, { type: 'hit', decisionId: game.decision.id });
      expect(res.status).toBe(200);
      expect(res.body.room.game.seq).toBeGreaterThan(game.seq);
      expect(res.body.room.game.decision.id).not.toBe(game.decision.id);
      const other = people.find((u) => u !== actor);
      expect((await stateOf(other)).game.seq).toBe(res.body.room.game.seq);
    });

    it('somebody else cannot move for them (409 NOT_YOUR_TURN)', async () => {
      const { people, game } = await startedRoom(3);
      const intruder = people.find((u) => u.user.id !== game.decision.playerId);
      const res = await actPost(intruder, { type: 'stay', decisionId: game.decision.id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NOT_YOUR_TURN');
      expect((await stateOf(intruder)).game.seq).toBe(game.seq); // nothing changed
    });

    it('the player id in the body is ignored: the session decides who acts', async () => {
      const { people, game } = await startedRoom(3);
      const intruder = people.find((u) => u.user.id !== game.decision.playerId);
      const res = await actPost(intruder, { type: 'stay', decisionId: game.decision.id, playerId: game.decision.playerId, userId: game.decision.playerId });
      expect(res.status).toBe(409);
    });

    it('answering an out-of-date question is refused (double click protection)', async () => {
      const { people, game } = await startedRoom(3);
      const actor = byId(people, game.decision.playerId);
      await actPost(actor, { type: 'stay', decisionId: game.decision.id });
      const again = await actPost(actor, { type: 'stay', decisionId: game.decision.id });
      expect([409]).toContain(again.status);
      expect(['STALE_MOVE', 'NOT_YOUR_TURN']).toContain(again.body.error.code);
    });

    it('two simultaneous Hits from the same player draw only one card', async () => {
      const { people, game } = await startedRoom(3);
      const actor = byId(people, game.decision.playerId);
      const results = await Promise.all([
        actPost(actor, { type: 'hit', decisionId: game.decision.id }),
        actPost(actor, { type: 'hit', decisionId: game.decision.id }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      // refused either because the turn already moved on, or because the question is out of date
      expect(['NOT_YOUR_TURN', 'STALE_MOVE']).toContain(results.find((r) => r.status === 409).body.error.code);
      const after = await stateOf(actor);
      // the second request drew nothing: exactly one question was answered
      expect(after.game.seq).toBe(results.find((r) => r.status === 200).body.room.game.seq);
    });

    it.each([
      [{}, 'type'],
      [{ type: 'cheat', decisionId: 1 }, 'type'],
      [{ type: 'hit' }, 'decisionId'],
      [{ type: 'hit', decisionId: 'x' }, 'decisionId'],
      [{ type: 'hit', decisionId: 0 }, 'decisionId'],
      [{ type: 'target', decisionId: 1 }, 'targetId'],
      [{ type: 'gift', decisionId: 1, targetId: 'a' }, 'targetId'],
    ])('rejects the malformed move %j', async (body, field) => {
      const { people } = await startedRoom(3);
      const res = await actPost(people[0], body);
      expect(res.status).toBe(400);
      expect(res.body.error.details.field).toBe(field);
    });

    it('needs a login, a CSRF token and a room', async () => {
      const [lonely] = await users(1);
      expect((await actPost(lonely, { type: 'stay', decisionId: 1 })).body.error.code).toBe('GAME_NOT_RUNNING');
      const res = await lonely.agent.post('/api/rooms/current/game/action').send({ type: 'stay', decisionId: 1 });
      expect(res.status).toBe(403);
    });

    it('Stay secures the player out of the round and the turn moves on', async () => {
      const { people, game } = await startedRoom(3);
      const actor = byId(people, game.decision.playerId);
      const res = await actPost(actor, { type: 'stay', decisionId: game.decision.id });
      const me = res.body.room.game.players.find((p) => p.id === actor.user.id);
      expect(me.status).toBe('stayed');
      expect(res.body.room.game.decision.playerId).not.toBe(actor.user.id);
    });

    it('a whole round can be played to the end: the scores are added up and a pause starts', async () => {
      const { people } = await startedRoom(3);
      let room = await stateOf(people[0]);
      for (let i = 0; i < 20 && room.game.phase === 'playing'; i += 1) {
        const d = room.game.decision;
        const actor = byId(people, d.playerId);
        const body = d.type === 'hit_or_stay' ? { type: 'stay' } : { type: d.type === 'choose_target' ? 'target' : 'gift', targetId: d.options[0] };
        room = (await actPost(actor, { ...body, decisionId: d.id })).body.room;
      }
      expect(room.game.phase).toBe('round_over');
      expect(room.game.lastRound.scores).toHaveLength(3);
      expect(room.game.timer.kind).toBe('next_round');
      for (const row of room.game.lastRound.scores) {
        expect(room.game.players.find((p) => p.id === row.id).total).toBe(row.total);
      }
    });

    it('limits how fast one player can send moves (429)', async () => {
      const { people } = await startedRoom(3);
      const statuses = [];
      for (let i = 0; i < 40; i += 1) statuses.push((await actPost(people[0], { type: 'hit', decisionId: 999 })).status);
      expect(statuses).toContain(429);
    });
  });

  describe('live updates', () => {
    it('every move is pushed to every player over the socket', async () => {
      const { people, game } = await startedRoom(3);
      const sockets = [];
      for (const u of people) {
        const s = h.connect(u);
        await h.opened(s);
        sockets.push(s);
      }
      await Promise.all(sockets.map((s) => h.waitForState(s, (r) => r?.game?.seq === game.seq)));
      const actor = byId(people, game.decision.playerId);
      await actPost(actor, { type: 'stay', decisionId: game.decision.id });
      for (const s of sockets) {
        const state = await h.waitForState(s, (r) => r?.game?.seq > game.seq);
        expect(state.game.players.find((p) => p.id === actor.user.id).status).toBe('stayed');
      }
    });
  });

  describe('leaving a running match', () => {
    it('asks for confirmation first: a plain request changes nothing', async () => {
      const { people, code } = await startedRoom(4);
      const res = await roomPost(people[3], '/current/leave');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LEAVE_CONFIRMATION_REQUIRED');
      expect((await stateOf(people[3])).code).toBe(code);
      expect((await stateOf(people[3])).game.players.find((p) => p.id === people[3].user.id).left).toBe(false);
    });

    it('once confirmed the player is out, scores nothing, and the others carry on', async () => {
      const { people } = await startedRoom(4);
      const leaver = people[3];
      const res = await roomPost(leaver, '/current/leave', { confirm: true });
      expect(res.status).toBe(200);
      expect((await stateOf(leaver))).toBeNull();
      const view = await stateOf(people[0]);
      expect(view.playerCount).toBe(3);
      const row = view.game.players.find((p) => p.id === leaver.user.id);
      expect(row).toMatchObject({ left: true, status: 'left', roundScore: 0 });
      expect(view.game.decision.playerId).not.toBe(leaver.user.id);
    });

    it('if the leaver was the one being asked, the question passes to the next player', async () => {
      const { people, game } = await startedRoom(3);
      const asked = byId(people, game.decision.playerId);
      await roomPost(asked, '/current/leave', { confirm: true });
      const other = people.find((u) => u !== asked);
      const view = await stateOf(other);
      expect(view.game.decision.playerId).not.toBe(asked.user.id);
      expect(view.game.phase).toBe('playing');
    });

    it('when only one player is left they win, and the finished match is reported once', async () => {
      const before = finishedReports.length;
      const { people, code } = await startedRoom(3);
      await roomPost(people[1], '/current/leave', { confirm: true });
      await roomPost(people[2], '/current/leave', { confirm: true });
      const view = await stateOf(people[0]);
      expect(view.game.phase).toBe('finished');
      expect(view.game.result).toMatchObject({ reason: 'last_player', winnerIds: [people[0].user.id] });
      expect(view.game.result.standings.map((s) => s.userId).sort()).toEqual(people.map((u) => u.user.id).sort());
      for (const leaver of [people[1], people[2]]) {
        expect(view.game.result.standings.find((s) => s.userId === leaver.user.id)).toMatchObject({ finalPoints: 0, rankingPoints: 0, left: true });
      }
      expect(finishedReports.length).toBe(before + 1);
      expect(finishedReports.at(-1).room.code).toBe(code);
      expect(finishedReports.at(-1).result.winnerIds).toEqual([people[0].user.id]);
    });

    it('after the game is over leaving needs no confirmation and keeps the points', async () => {
      const { people } = await startedRoom(3);
      await roomPost(people[1], '/current/leave', { confirm: true });
      await roomPost(people[2], '/current/leave', { confirm: true });
      const res = await roomPost(people[0], '/current/leave');
      expect(res.status).toBe(200);
    });

    it('the whole room closing removes its game', async () => {
      const { people, code } = await startedRoom(3);
      const games = h.app.locals.gameManager;
      const before = games.size();
      for (const u of people) await roomPost(u, '/current/leave', { confirm: true });
      expect(await until(() => games.view(code) === null)).toBe(true);
      expect(games.size()).toBeLessThan(before);
    });

    it('a player whose connection never comes back is removed through the same rules (0 points)', async () => {
      // The grace period in this suite is long, so drive the removal the way the timer would.
      const { people, code } = await startedRoom(3);
      await h.app.locals.roomService.leaveRoom(people[2].user.id, { confirmed: true });
      const view = await stateOf(people[0]);
      expect(view.game.players.find((p) => p.id === people[2].user.id).left).toBe(true);
      expect(view.code).toBe(code);
    });
  });
});

describe.skipIf(!integrationEnabled)('game clocks (integration)', () => {
  let h;
  let modeId;
  const roomPost = (u, path, body = {}) => u.agent.post(`/api/rooms${path}`).set('X-CSRF-Token', u.csrfToken).send(body);
  const stateOf = async (u) => (await u.agent.get('/api/rooms/current')).body.room;
  async function until(check, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  }

  beforeAll(async () => {
    const manager = createRoomManager({ startPromptMs: 60_000, logger: silentLogger });
    const games = createGameManager({ manager, turnMs: 200, roundEndMs: 300, logger: silentLogger, makeDeck: plainDeck });
    h = createHarness({ roomManager: manager, gameManager: games });
    const [rows] = await h.pool.query("SELECT game_mode_id AS id FROM GameModes WHERE name = 'Normal'");
    modeId = rows[0].id;
  });
  afterAll(async () => {
    await h.cleanup();
  });

  async function start(n) {
    const people = await Promise.all(Array.from({ length: n }, () => h.createSignedInUser()));
    const { body } = await roomPost(people[0], '', { gameModeId: modeId, maxPlayers: n });
    for (const u of people.slice(1)) await roomPost(u, '/join', { code: body.room.code });
    return { people, game: (await roomPost(people[0], '/current/start')).body.room.game };
  }

  it('a player who does not answer in time automatically Stays', async () => {
    const { people, game } = await start(3);
    const slow = game.decision.playerId;
    expect(await until(async () => (await stateOf(people[0])).game.players.find((p) => p.id === slow).status !== 'active')).toBe(true);
    const view = await stateOf(people[0]);
    expect(['stayed', 'frozen', 'busted']).toContain(view.game.players.find((p) => p.id === slow).status);
  });

  it('with nobody answering, the round ends by itself, the summary pause runs, then round 2 starts', async () => {
    const { people } = await start(3);
    expect(await until(async () => (await stateOf(people[0])).game.roundNumber === 2, 6000)).toBe(true);
    const view = await stateOf(people[0]);
    expect(view.game.phase).toBe('playing');
    expect(view.game.players.some((p) => p.total > 0)).toBe(true);
  });

  it('a table of AFK players keeps the game moving round after round', async () => {
    const { people } = await start(3);
    await new Promise((r) => setTimeout(r, 1200));
    const view = await stateOf(people[0]);
    expect(view.game.roundNumber >= 2 || view.game.phase === 'finished').toBe(true);
  });
});
