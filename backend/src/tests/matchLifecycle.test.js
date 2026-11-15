// What happens to a match when it ends (no database needed): the finished match is reported
// exactly once, an emptied room reports "abandoned", and the results screen / ready system
// in the room manager. Saving to MySQL is tested in match.integration.test.js.
import { describe, it, expect, afterEach } from 'vitest';
import { createRoomManager } from '../realtime/roomManager.js';
import { createGameManager } from '../game/gameManager.js';
import { createMatchService } from '../services/matchService.js';
import { silentLogger } from './helpers.js';

const plainDeck = () => Array.from({ length: 94 }, (_, id) => ({ id, kind: 'number', value: (id % 12) + 1 }));

describe('match lifecycle', () => {
  const toClean = [];
  afterEach(() => {
    while (toClean.length) toClean.pop()();
  });

  function setup(playerIds = [1, 2, 3]) {
    const finished = [];
    const abandoned = [];
    const manager = createRoomManager({ startPromptMs: 60_000, logger: silentLogger });
    const games = createGameManager({
      manager, turnMs: 60_000, roundEndMs: 60_000, targetScore: 1, makeDeck: plainDeck, logger: silentLogger,
      hooks: { onFinished: (r) => finished.push(r), onAbandoned: (r) => abandoned.push(r) },
    });
    toClean.push(() => { games.shutdown(); manager.shutdown(); });
    manager.createRoom({ roomId: 7, code: 'ABCD', creatorId: playerIds[0], gameModeId: 1, maxPlayers: 7 });
    for (const id of playerIds.slice(1)) manager.join('ABCD', id);
    const room = manager.markStarted('ABCD');
    games.start(room);
    return { manager, games, finished, abandoned, room };
  }
  // everybody stays at once -> the round ends -> with a target of 1 the match ends
  function finishMatch({ games }) {
    for (let i = 0; i < 20 && games.view('ABCD').phase === 'playing'; i += 1) {
      const d = games.view('ABCD').decision;
      games.act(d.playerId, { type: 'stay', decisionId: d.id });
    }
    expect(games.view('ABCD').phase).toBe('finished');
  }

  it('reports a finished match exactly once, with its times and result', () => {
    const s = setup();
    finishMatch(s);
    s.manager.touch('ABCD', 'game'); // later changes must not report it again
    s.games.removePlayer('ABCD', 3);
    expect(s.finished).toHaveLength(1);
    const [report] = s.finished;
    expect(report.room.gameModeId).toBe(1);
    expect(report.finishedAt).toBeGreaterThanOrEqual(report.startedAt);
    expect(report.result.standings).toHaveLength(3);
    expect(s.abandoned).toHaveLength(0);
  });

  it('a room that empties out in the middle of a match reports it as abandoned, once', () => {
    const s = setup();
    for (const id of [1, 2, 3]) s.manager.leave(id); // straight through the manager: nobody is "removed" from the game
    expect(s.abandoned).toHaveLength(1);
    expect(s.abandoned[0]).toMatchObject({ rounds: 1 });
    expect(s.finished).toHaveLength(0);
    expect(s.games.size()).toBe(0);
  });

  it('a room closing AFTER the match finished is not reported as abandoned', () => {
    const s = setup();
    finishMatch(s);
    for (const id of [1, 2, 3]) s.manager.leave(id);
    expect(s.abandoned).toHaveLength(0);
    expect(s.finished).toHaveLength(1);
  });

  describe('results screen and ready system', () => {
    it('the room is marked as over; readiness cannot be set during the match', () => {
      const s = setup();
      expect(() => s.manager.setReady(1, true)).toThrow(expect.objectContaining({ code: 'MATCH_NOT_OVER' }));
      expect(s.manager.getRoom('ABCD').matchOver).toBe(false);
      finishMatch(s);
      expect(s.manager.getRoom('ABCD').matchOver).toBe(true);
    });

    it('a rematch needs every player still here, and at least three', () => {
      const s = setup([1, 2, 3, 4]);
      finishMatch(s);
      s.manager.setReady(1, true);
      s.manager.setReady(2, true);
      s.manager.setReady(3, true);
      expect(s.manager.rematchReady('ABCD')).toBe(false); // 4 is not ready
      s.manager.setReady(3, false);
      s.manager.setReady(4, true);
      expect(s.manager.rematchReady('ABCD')).toBe(false); // 3 changed their mind
      s.manager.setReady(3, true);
      expect(s.manager.rematchReady('ABCD')).toBe(true);
    });

    it('two ready players are not enough', () => {
      const s = setup([1, 2, 3]);
      finishMatch(s);
      s.manager.leave(3);
      s.manager.setReady(1, true);
      s.manager.setReady(2, true);
      expect(s.manager.rematchReady('ABCD')).toBe(false);
      expect(s.manager.beginRematch('ABCD')).toBeNull();
    });

    it('the creator leaving on the results screen changes nothing: no transfer, no closing', () => {
      const s = setup([1, 2, 3, 4]);
      finishMatch(s);
      const left = s.manager.leave(1);
      expect(left).toMatchObject({ closed: false, newCreatorId: null });
      expect(s.manager.getRoom('ABCD').creatorId).toBe(1);
    });

    it('a creator whose own leaving ENDS the match still hands the room on', () => {
      const s = setup([1, 2, 3]);
      s.games.removePlayer('ABCD', 2);
      s.manager.leave(2);
      s.games.removePlayer('ABCD', 1); // the game ends here ...
      expect(s.manager.getRoom('ABCD').matchOver).toBe(true);
      const left = s.manager.leave(1, { matchWasOver: false }); // ... but they left DURING the match
      expect(left.newCreatorId).toBe(3);
    });

    it('if the others play again without the creator, the first who joined takes over', () => {
      const s = setup([1, 2, 3, 4]);
      finishMatch(s);
      s.manager.leave(1);
      for (const id of [2, 3, 4]) s.manager.setReady(id, true);
      const started = s.manager.beginRematch('ABCD');
      expect(started.newCreatorId).toBe(2);
      expect(s.manager.getRoom('ABCD')).toMatchObject({ creatorId: 2, matchOver: false });
      expect(s.manager.getRoom('ABCD').ready.size).toBe(0);
    });

    it('when the creator is still here ownership does not change', () => {
      const s = setup([1, 2, 3]);
      finishMatch(s);
      for (const id of [1, 2, 3]) s.manager.setReady(id, true);
      expect(s.manager.beginRematch('ABCD').newCreatorId).toBeNull();
    });

    describe('spectators and "start with those who are ready"', () => {
      it('someone who joins a running match watches; on the results screen they are an ordinary member', () => {
        const s = setup([1, 2, 3]);
        s.manager.join('ABCD', 9);
        expect(s.manager.getRoom('ABCD').spectators.has(9)).toBe(true);
        finishMatch(s);
        expect(s.manager.getRoom('ABCD').spectators.size).toBe(0);
        expect(s.manager.getRoom('ABCD').members.has(9)).toBe(true);
      });

      it('the host starts with the ready players; the others watch the new match', () => {
        const s = setup([1, 2, 3, 4]);
        finishMatch(s);
        s.manager.setReady(2, true);
        s.manager.setReady(3, true);
        const started = s.manager.startWithReady(1); // the host counts as ready: 1, 2, 3
        expect(started.playerIds).toEqual([1, 2, 3]);
        expect([...started.room.spectators]).toEqual([4]);
        expect(started.room).toMatchObject({ matchOver: false });
        expect(started.room.ready.size).toBe(0);
      });

      it('needs three ready players, the host included', () => {
        const s = setup([1, 2, 3, 4]);
        finishMatch(s);
        s.manager.setReady(2, true);
        expect(() => s.manager.startWithReady(1)).toThrow(expect.objectContaining({ code: 'NOT_ENOUGH_PLAYERS' }));
        expect(s.manager.getRoom('ABCD').matchOver).toBe(true);
        expect(s.manager.getRoom('ABCD').ready.has(1)).toBe(false); // a refused attempt changes nothing
      });

      it('only the host can, and only on the results screen', () => {
        const s = setup([1, 2, 3, 4]);
        expect(() => s.manager.startWithReady(1)).toThrow(expect.objectContaining({ code: 'MATCH_NOT_OVER' }));
        finishMatch(s);
        expect(() => s.manager.startWithReady(2)).toThrow(expect.objectContaining({ code: 'NOT_CREATOR' }));
      });

      it('a spectator who becomes the oldest member is the last choice for host', () => {
        const s = setup([1, 2, 3, 4]);
        finishMatch(s);
        for (const id of [1, 2, 3]) s.manager.setReady(id, true);
        s.manager.startWithReady(1); // 4 now watches
        s.manager.leave(2);
        s.manager.leave(3);
        // 1 (host) and 4 (spectator) remain; the host leaves mid-match
        const left = s.manager.leave(1);
        expect(left.newCreatorId).toBe(4); // the only one left, a spectator after all
      });

      it('the new match is dealt to the chosen players only, in join order', () => {
        const s = setup([1, 2, 3, 4]);
        finishMatch(s);
        for (const id of [1, 3, 4]) s.manager.setReady(id, true);
        const started = s.manager.startWithReady(1);
        s.games.drop('ABCD');
        s.games.start(started.room, started.playerIds);
        expect(s.games.view('ABCD').players.map((p) => p.id)).toEqual([1, 3, 4]);
      });
    });

    it('someone who leaves is removed from the ready list', () => {
      const s = setup([1, 2, 3, 4]);
      finishMatch(s);
      s.manager.setReady(4, true);
      s.manager.leave(4);
      expect(s.manager.getRoom('ABCD').ready.has(4)).toBe(false);
    });
  });
});

describe('matchService saving', () => {
  // A pool whose connection fails `failures` times before it works.
  function fakePool(failures) {
    const queries = [];
    let calls = 0;
    const connection = {
      beginTransaction: async () => {}, commit: async () => { queries.push('COMMIT'); }, rollback: async () => { queries.push('ROLLBACK'); },
      release() {},
      query: async (sql) => { queries.push(sql.trim().split(/\s+/).slice(0, 3).join(' ')); return [{ insertId: 42 }]; },
    };
    return { queries, getCalls: () => calls, getConnection: async () => { calls += 1; if (calls <= failures) throw new Error('db down'); return connection; } };
  }
  const input = {
    gameModeId: 1, startedAt: 1000, finishedAt: 2000,
    result: { rounds: 2, standings: [
      { userId: 1, finalPoints: 30, rankingPoints: 30, hits: 4, busts: 0 },
      { userId: 2, finalPoints: 0, rankingPoints: 0, hits: 1, busts: 1, left: true },
    ] },
  };

  it('writes the match, every player (leavers too) and adds ranking points only where earned', async () => {
    const pool = fakePool(0);
    const id = await createMatchService({ pool, logger: silentLogger }).saveCompleted(input);
    expect(id).toBe(42);
    expect(pool.queries.filter((q) => q.startsWith('INSERT INTO MatchPlayers'))).toHaveLength(2);
    expect(pool.queries.filter((q) => q.startsWith('UPDATE Users'))).toHaveLength(1); // the leaver earned 0
    expect(pool.queries.at(-1)).toBe('COMMIT');
  });

  it('tries again when the database hiccups, then succeeds', async () => {
    const pool = fakePool(2);
    await createMatchService({ pool, logger: silentLogger, retryDelayMs: 1 }).saveCompleted(input);
    expect(pool.getCalls()).toBe(3);
  });

  it('gives up after three attempts and says so', async () => {
    const pool = fakePool(99);
    await expect(createMatchService({ pool, logger: silentLogger, retryDelayMs: 1 }).saveCompleted(input)).rejects.toThrow('db down');
    expect(pool.getCalls()).toBe(3);
  });
});

// The host's kick / ban, through the real room service (the database is a stub: names are not needed here).
describe('the host removes a player (kick / ban)', () => {
  const toClean = [];
  afterEach(() => {
    while (toClean.length) toClean.pop()();
  });

  async function setup(playerIds, { start = true } = {}) {
    const { createRoomService } = await import('../services/roomService.js');
    const manager = createRoomManager({ startPromptMs: 60_000, logger: silentLogger });
    const games = createGameManager({ manager, turnMs: 60_000, roundEndMs: 60_000, makeDeck: plainDeck, logger: silentLogger });
    toClean.push(() => { games.shutdown(); manager.shutdown(); });
    const service = createRoomService({ pool: { query: async () => [[]] }, manager, games, logger: silentLogger });
    manager.createRoom({ roomId: 7, code: 'ABCD', creatorId: playerIds[0], gameModeId: 1, maxPlayers: 7 });
    for (const id of playerIds.slice(1)) manager.join('ABCD', id);
    if (start) games.start(manager.markStarted('ABCD'));
    return { manager, games, service };
  }
  const code = (promise) => promise.then(() => null, (e) => e.code);

  it('in the waiting room the host can kick anyone, even with 3 players; the kicked player may come back', async () => {
    const s = await setup([1, 2, 3], { start: false });
    const seen = [];
    s.manager.subscribe((e) => seen.push([e.type, e.userIds]));
    const room = await s.service.removePlayer(1, 3);
    expect(room.players.map((p) => p.id)).toEqual([1, 2]);
    expect(seen).toContainEqual(['kicked', [3]]);
    expect(() => s.manager.join('ABCD', 3)).not.toThrow();
  });

  it('a banned player cannot join that room again, but other rooms are open to them', async () => {
    const s = await setup([1, 2, 3], { start: false });
    await s.service.removePlayer(1, 3, { ban: true });
    expect(() => s.manager.join('ABCD', 3)).toThrow(expect.objectContaining({ code: 'BANNED' }));
    s.manager.createRoom({ roomId: 8, code: 'WXYZ', creatorId: 9, gameModeId: 1, maxPlayers: 4 });
    expect(() => s.manager.join('WXYZ', 3)).not.toThrow();
  });

  it('only the host can remove, and never themselves or a stranger', async () => {
    const s = await setup([1, 2, 3], { start: false });
    expect(await code(s.service.removePlayer(2, 3))).toBe('NOT_CREATOR');
    expect(await code(s.service.removePlayer(1, 1))).toBe('PLAYER_NOT_IN_ROOM');
    expect(await code(s.service.removePlayer(1, 99))).toBe('PLAYER_NOT_IN_ROOM');
    expect(s.manager.getRoom('ABCD').members.size).toBe(3);
  });

  it('a running match of 3 cannot lose a player to a kick, but a ban still works', async () => {
    const s = await setup([1, 2, 3]);
    expect((await s.service.getCurrentRoom(1)).players.map((p) => p.canKick)).toEqual([false, false, false]);
    expect(await code(s.service.removePlayer(1, 3))).toBe('KICK_NEEDS_MORE_PLAYERS');
    expect(s.games.view('ABCD').players.find((p) => p.id === 3).left).toBe(false);
    await s.service.removePlayer(1, 3, { ban: true });
    expect(s.games.view('ABCD').players.find((p) => p.id === 3).left).toBe(true);
    expect(s.games.view('ABCD').phase).toBe('playing');
  });

  it('with 4 playing the host can kick one (then the 3 left are locked); only the host is told who can be kicked', async () => {
    const s = await setup([1, 2, 3, 4]);
    expect((await s.service.getCurrentRoom(1)).players.map((p) => p.canKick)).toEqual([false, true, true, true]);
    expect((await s.service.getCurrentRoom(2)).players.some((p) => p.canKick)).toBe(false);
    const room = await s.service.removePlayer(1, 4);
    expect(room.playerCount).toBe(3);
    expect(room.game.players.find((p) => p.id === 4).left).toBe(true);
    expect(room.players.some((p) => p.canKick)).toBe(false);
  });

  it('someone who is only watching can always be kicked', async () => {
    const s = await setup([1, 2, 3]);
    s.manager.join('ABCD', 4); // joins the running match: a spectator
    const room = await s.service.removePlayer(1, 4);
    expect(room.players.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(room.game.players.every((p) => !p.left)).toBe(true);
  });
});
