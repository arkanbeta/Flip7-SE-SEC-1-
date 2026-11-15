// Saving matches and the rematch flow: real HTTP, real MySQL. Skipped unless RUN_DB_TESTS=true.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, integrationEnabled } from './integrationHarness.js';
import { createRoomManager } from '../realtime/roomManager.js';
import { createGameManager } from '../game/gameManager.js';
import { silentLogger } from './helpers.js';

const plainDeck = () => Array.from({ length: 94 }, (_, id) => ({ id, kind: 'number', value: (id % 12) + 1 }));

describe.skipIf(!integrationEnabled)('match results and rematch (integration)', () => {
  let h;
  let modeId;

  const roomPost = (u, path, body = {}) => u.agent.post(`/api/rooms${path}`).set('X-CSRF-Token', u.csrfToken).send(body);
  const stateOf = async (u) => (await u.agent.get('/api/rooms/current')).body.room;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(check, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = await check();
      if (value) return value;
      await sleep(20);
    }
    return false;
  }

  async function startedRoom(n = 3) {
    const people = await Promise.all(Array.from({ length: n }, () => h.createSignedInUser()));
    const { body } = await roomPost(people[0], '', { gameModeId: modeId, maxPlayers: 7 });
    for (const u of people.slice(1)) await roomPost(u, '/join', { code: body.room.code });
    expect((await roomPost(people[0], '/current/start')).status).toBe(200);
    return { people, code: body.room.code };
  }
  // Everybody stays; with a target of 1 point the match is over after one round.
  async function playToEnd(people) {
    for (let i = 0; i < 20; i += 1) {
      const game = (await stateOf(people[0])).game;
      if (game.phase === 'finished') return game;
      const d = game.decision;
      const player = people.find((u) => u.user.id === d?.playerId);
      if (player) await roomPost(player, '/current/game/action', { type: 'stay', decisionId: d.id });
    }
    throw new Error('match did not finish');
  }
  const matchRows = async (userId) => {
    const [rows] = await h.pool.query(
      `SELECT mp.*, mh.status, mh.number_of_rounds, mh.started_at, mh.finished_at
         FROM MatchPlayers mp JOIN MatchHistories mh ON mh.match_id = mp.match_id WHERE mp.user_id = ? ORDER BY mp.match_id`,
      [userId]
    );
    return rows;
  };
  const totalPoints = async (userId) => (await h.pool.query('SELECT total_points FROM Users WHERE user_id = ?', [userId]))[0][0].total_points;

  beforeAll(async () => {
    const manager = createRoomManager({ startPromptMs: 60_000, logger: silentLogger });
    const games = createGameManager({
      manager, turnMs: 60_000, roundEndMs: 60_000, targetScore: 1, makeDeck: plainDeck, logger: silentLogger,
    });
    h = createHarness({ roomManager: manager, gameManager: games });
    await h.startRealtime({ graceMs: 60_000 });
    modeId = (await h.pool.query("SELECT game_mode_id AS id FROM GameModes WHERE name = 'Normal'"))[0][0].id;
  });
  afterAll(async () => {
    await h.cleanup();
  });

  describe('saving a finished match', () => {
    it('writes one history row and one row per player, with ranking points = final points', async () => {
      const { people } = await startedRoom(3);
      const game = await playToEnd(people);
      const rows = await until(async () => {
        const r = await matchRows(people[0].user.id);
        return r.length ? r : false;
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'Completed', number_of_rounds: game.result.rounds });
      expect(new Date(rows[0].finished_at) >= new Date(rows[0].started_at)).toBe(true);
      for (const s of game.result.standings) {
        const [mine] = await matchRows(s.userId);
        expect(mine).toMatchObject({ final_points: s.finalPoints, ranking_points: s.finalPoints, hits: s.hits, busts: s.busts });
        expect(Number(await totalPoints(s.userId))).toBe(s.finalPoints);
      }
      expect(game.result.standings.some((s) => s.finalPoints > 0)).toBe(true);
    });

    it('all players share one match, and the match appears in each profile', async () => {
      const { people } = await startedRoom(3);
      await playToEnd(people);
      await until(async () => (await matchRows(people[2].user.id)).length > 0);
      const ids = await Promise.all(people.map(async (u) => (await matchRows(u.user.id))[0].match_id));
      expect(new Set(ids).size).toBe(1);
      const history = await people[1].agent.get('/api/users/me/matches');
      expect(history.status).toBe(200);
      expect(history.body.matches).toHaveLength(1);
      expect(history.body.matches[0].matchId).toBe(ids[0]);
    });

    it('the results screen shows while the match is saved only once, however often it is fetched', async () => {
      const { people } = await startedRoom(3);
      await playToEnd(people);
      for (let i = 0; i < 3; i += 1) await stateOf(people[0]);
      await sleep(150);
      expect(await matchRows(people[0].user.id)).toHaveLength(1);
    });

    it('a player who left gets a row with 0 points, and the match is still saved', async () => {
      const { people } = await startedRoom(3);
      // two players walk out of a running match: the third is the last one standing
      expect((await roomPost(people[1], '/current/leave', { confirm: true })).status).toBe(200);
      expect((await roomPost(people[2], '/current/leave', { confirm: true })).status).toBe(200);
      const rows = await until(async () => {
        const r = await matchRows(people[0].user.id);
        return r.length ? r : false;
      });
      expect(rows).toHaveLength(1);
      for (const leaver of [people[1], people[2]]) {
        const [row] = await matchRows(leaver.user.id);
        expect(row).toMatchObject({ final_points: 0, ranking_points: 0, status: 'Completed' });
        expect(row.match_id).toBe(rows[0].match_id);
        expect(Number(await totalPoints(leaver.user.id))).toBe(0);
      }
    });
  });

  describe('ready system and rematch', () => {
    it('cannot get ready while the match is still being played', async () => {
      const { people } = await startedRoom(3);
      const res = await roomPost(people[0], '/current/ready', { ready: true });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MATCH_NOT_OVER');
    });

    it('checks the request', async () => {
      const { people } = await startedRoom(3);
      for (const bad of [{}, { ready: 'yes' }, { ready: 1 }]) {
        const res = await roomPost(people[0], '/current/ready', bad);
        expect(res.status).toBe(400);
      }
    });

    it('needs a signed-in user and a CSRF token', async () => {
      const { people } = await startedRoom(3);
      const noToken = await people[0].agent.post('/api/rooms/current/ready').send({ ready: true });
      expect(noToken.status).toBe(403);
    });

    it('shows who is ready, and starts a new match only when everyone is', async () => {
      const { people } = await startedRoom(3);
      await playToEnd(people);
      const first = await roomPost(people[0], '/current/ready', { ready: true });
      expect(first.body.room).toMatchObject({ matchOver: true, readyIds: [people[0].user.id], canRematch: true });
      expect(first.body.room.game.phase).toBe('finished');
      await roomPost(people[1], '/current/ready', { ready: true });
      const last = await roomPost(people[2], '/current/ready', { ready: true });
      expect(last.body.room).toMatchObject({ matchOver: false, readyIds: [] });
      expect(last.body.room.game).toMatchObject({ phase: 'playing', roundNumber: 1, result: null });
    });

    it('can be undone before the last player is ready', async () => {
      const { people } = await startedRoom(3);
      await playToEnd(people);
      await roomPost(people[0], '/current/ready', { ready: true });
      const undone = await roomPost(people[0], '/current/ready', { ready: false });
      expect(undone.body.room.readyIds).toEqual([]);
    });

    it('the second match is saved separately from the first', async () => {
      const { people } = await startedRoom(3);
      await playToEnd(people);
      await until(async () => (await matchRows(people[0].user.id)).length === 1);
      for (const u of people) await roomPost(u, '/current/ready', { ready: true });
      await playToEnd(people);
      const rows = await until(async () => {
        const r = await matchRows(people[0].user.id);
        return r.length === 2 ? r : false;
      });
      expect(rows[0].match_id).not.toBe(rows[1].match_id);
      const total = (await matchRows(people[0].user.id)).reduce((sum, r) => sum + r.ranking_points, 0);
      expect(Number(await totalPoints(people[0].user.id))).toBe(total);
    });

    it('leaving the results screen needs no confirmation, and the last unready player leaving starts the rematch', async () => {
      const { people } = await startedRoom(4);
      await playToEnd(people);
      for (const u of people.slice(0, 3)) await roomPost(u, '/current/ready', { ready: true });
      expect((await stateOf(people[0])).matchOver).toBe(true); // person 4 is not ready yet
      const leave = await roomPost(people[3], '/current/leave');
      expect(leave.status).toBe(200);
      const room = await stateOf(people[0]);
      expect(room.matchOver).toBe(false);
      expect(room.game).toMatchObject({ phase: 'playing', roundNumber: 1 });
      expect(room.game.players).toHaveLength(3);
      expect(room.playerCount).toBe(3);
    });

    it('a newcomer between matches joins as a plain member who is not ready', async () => {
      const { people, code } = await startedRoom(3);
      await playToEnd(people);
      const late = await h.createSignedInUser();
      const res = await roomPost(late, '/join', { code });
      expect(res.status).toBe(200);
      expect(res.body.room).toMatchObject({ isSpectator: false, matchOver: true, playerCount: 4 });
    });

    it('with fewer than three players left there is no rematch', async () => {
      const { people } = await startedRoom(3);
      await playToEnd(people);
      await roomPost(people[2], '/current/leave');
      const room = await stateOf(people[0]);
      expect(room).toMatchObject({ matchOver: true, canRematch: false });
    });
  });

  describe('spectators', () => {
    async function withSpectator() {
      const room = await startedRoom(3); // capacity is 7
      const watcher = await h.createSignedInUser();
      const joined = await roomPost(watcher, '/join', { code: room.code });
      expect(joined.status).toBe(200);
      return { ...room, watcher, joined: joined.body.room };
    }

    it('sees the same table but is not dealt in, and is marked as watching', async () => {
      const { people, watcher, joined } = await withSpectator();
      expect(joined).toMatchObject({ isSpectator: true, playerCount: 4 });
      expect(joined.game.players.map((p) => p.id).sort()).toEqual(people.map((u) => u.user.id).sort());
      expect(joined.players.find((p) => p.id === watcher.user.id).isSpectator).toBe(true);
      const seenByPlayer = await stateOf(people[0]);
      expect(seenByPlayer.isSpectator).toBe(false);
      expect(seenByPlayer.game.seq).toBe((await stateOf(watcher)).game.seq);
    });

    it('cannot play, even when it looks like their turn', async () => {
      const { watcher, people } = await withSpectator();
      const d = (await stateOf(people[0])).game.decision;
      const res = await roomPost(watcher, '/current/game/action', { type: 'stay', decisionId: d.id });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect((await stateOf(people[0])).game.decision.id).toBe(d.id); // nothing happened
    });

    it('can leave without a warning and without disturbing the match', async () => {
      const { watcher, people } = await withSpectator();
      const res = await roomPost(watcher, '/current/leave'); // no confirm
      expect(res.status).toBe(200);
      const room = await stateOf(people[0]);
      expect(room.game.phase).toBe('playing');
      expect(room.playerCount).toBe(3);
    });

    it('is not counted as a player in the saved match', async () => {
      const { watcher, people } = await withSpectator();
      await playToEnd(people);
      await until(async () => (await matchRows(people[0].user.id)).length > 0);
      expect(await matchRows(watcher.user.id)).toHaveLength(0);
    });

    it('takes part in the next match once ready, with everyone else', async () => {
      const { watcher, people } = await withSpectator();
      await playToEnd(people);
      const results = await stateOf(watcher);
      expect(results).toMatchObject({ matchOver: true, isSpectator: false, playerCount: 4 }); // a member again
      for (const u of [...people, watcher]) await roomPost(u, '/current/ready', { ready: true });
      const next = await stateOf(watcher);
      expect(next.game.players).toHaveLength(4);
      expect(next.game.players.map((p) => p.id)).toContain(watcher.user.id);
    });
  });

  describe('the host starts with the players who are ready', () => {
    async function resultsOf(n) {
      const room = await startedRoom(n);
      await playToEnd(room.people);
      return room;
    }

    it('starts a new match with the ready players; the others watch it', async () => {
      const { people } = await resultsOf(4);
      await roomPost(people[1], '/current/ready', { ready: true });
      await roomPost(people[2], '/current/ready', { ready: true });
      const hostView = await stateOf(people[0]);
      expect(hostView).toMatchObject({ isCreator: true, canStartWithReady: true });
      const res = await roomPost(people[0], '/current/rematch');
      expect(res.status).toBe(200);
      expect(res.body.room.game).toMatchObject({ phase: 'playing', roundNumber: 1 });
      expect(res.body.room.game.players.map((p) => p.id).sort()).toEqual(people.slice(0, 3).map((u) => u.user.id).sort());
      expect(res.body.room.matchOver).toBe(false);
      const skipped = await stateOf(people[3]);
      expect(skipped).toMatchObject({ isSpectator: true, playerCount: 4 });
      // watching is free: leaving needs no confirmation, and the others carry on
      expect((await roomPost(people[3], '/current/leave')).status).toBe(200);
    });

    it('the skipped player can get ready for the match after', async () => {
      const { people } = await resultsOf(4);
      for (const u of people.slice(1, 3)) await roomPost(u, '/current/ready', { ready: true });
      await roomPost(people[0], '/current/rematch');
      await playToEnd(people.slice(0, 3));
      const results = await stateOf(people[3]);
      expect(results).toMatchObject({ matchOver: true, isSpectator: false });
      const ready = await roomPost(people[3], '/current/ready', { ready: true });
      expect(ready.status).toBe(200);
    });

    it('is refused with fewer than three ready (the host counts)', async () => {
      const { people } = await resultsOf(4);
      await roomPost(people[1], '/current/ready', { ready: true });
      expect((await stateOf(people[0])).canStartWithReady).toBe(false);
      const res = await roomPost(people[0], '/current/rematch');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NOT_ENOUGH_PLAYERS');
      expect((await stateOf(people[0])).matchOver).toBe(true);
    });

    it('is for the host only', async () => {
      const { people } = await resultsOf(4);
      for (const u of people.slice(1)) await roomPost(u, '/current/ready', { ready: true });
      // everyone but the host being ready: a non-host may not force anything
      const res = await roomPost(people[1], '/current/rematch');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NOT_CREATOR');
      expect((await stateOf(people[1])).canStartWithReady).toBe(false);
    });

    it('cannot be used while a match is being played, or without a CSRF token', async () => {
      const { people } = await startedRoom(3);
      const during = await roomPost(people[0], '/current/rematch');
      expect(during.status).toBe(409);
      expect(during.body.error.code).toBe('MATCH_NOT_OVER');
      expect((await people[0].agent.post('/api/rooms/current/rematch')).status).toBe(403);
    });
  });

  describe('the creator leaves while the match is still running', () => {
    it('hands the room on even when their leaving is what ends the match', async () => {
      const { people, code } = await startedRoom(3);
      expect((await roomPost(people[1], '/current/leave', { confirm: true })).status).toBe(200);
      // the creator walks out too: the last player standing wins, and becomes the host
      expect((await roomPost(people[0], '/current/leave', { confirm: true })).status).toBe(200);
      const room = await stateOf(people[2]);
      expect(room).toMatchObject({ creatorId: people[2].user.id, isCreator: true, matchOver: true });
      const [gr] = (await h.pool.query('SELECT creator_id FROM GameRooms WHERE room_code = ?', [code]))[0];
      expect(gr.creator_id).toBe(people[2].user.id);
    });
  });

  describe('the creator leaves on the results screen', () => {
    it('the room stays, nobody is promoted, and the points are kept', async () => {
      const { people, code } = await startedRoom(4);
      await playToEnd(people);
      await until(async () => (await matchRows(people[0].user.id)).length > 0);
      const out = await roomPost(people[0], '/current/leave');
      expect(out.status).toBe(200);
      expect(out.body.closed).toBe(false);
      const room = await stateOf(people[1]);
      expect(room).toMatchObject({ code, creatorId: people[0].user.id, isCreator: false, matchOver: true });
      expect(room.players.some((p) => p.isCreator)).toBe(false);
      const [gr] = (await h.pool.query('SELECT creator_id FROM GameRooms WHERE room_code = ?', [code]))[0];
      expect(gr.creator_id).toBe(people[0].user.id);
      expect((await matchRows(people[0].user.id))).toHaveLength(1);
    });

    it('if the rest play again, the first who joined becomes the host (also in the database)', async () => {
      const { people, code } = await startedRoom(4);
      await playToEnd(people);
      await roomPost(people[0], '/current/leave');
      for (const u of people.slice(1)) await roomPost(u, '/current/ready', { ready: true });
      const room = await stateOf(people[2]);
      expect(room).toMatchObject({ matchOver: false, creatorId: people[1].user.id, isCreator: false });
      expect((await stateOf(people[1])).isCreator).toBe(true);
      const [gr] = (await h.pool.query('SELECT creator_id FROM GameRooms WHERE room_code = ?', [code]))[0];
      expect(gr.creator_id).toBe(people[1].user.id);
    });

    it('everyone leaving closes the room and removes its row', async () => {
      const { people, code } = await startedRoom(3);
      await playToEnd(people);
      for (const u of people) await roomPost(u, '/current/leave');
      const [rows] = await h.pool.query('SELECT 1 FROM GameRooms WHERE room_code = ?', [code]);
      expect(rows).toHaveLength(0);
    });
  });
});
