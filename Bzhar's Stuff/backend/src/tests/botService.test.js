// "Fill empty seats with bots": the server's own computer players (services/botService.js), through
// the real room manager, game manager and room service. The database is a small fake: bot accounts
// are kept in an array and every other query succeeds without rows.
import { describe, it, expect, afterEach } from 'vitest';
import { createRoomManager } from '../realtime/roomManager.js';
import { createGameManager } from '../game/gameManager.js';
import { createRoomService } from '../services/roomService.js';
import { createBotService, BOT_GOOGLE_PREFIX } from '../services/botService.js';
import { silentLogger } from './helpers.js';

const HOST = 1;
const plainDeck = () => Array.from({ length: 94 }, (_, id) => ({ id, kind: 'number', value: (id % 12) + 1 }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await sleep(5);
  }
}

// existingBots: bot accounts already in the database ("dev-bot-1" ... "dev-bot-n")
function fakePool({ existingBots = 0 } = {}) {
  const accounts = Array.from({ length: existingBots }, (_, i) => ({ user_id: 100 + i, google_id: `${BOT_GOOGLE_PREFIX}${i + 1}` }));
  const inserts = [];
  let next = 200;
  return {
    accounts,
    inserts,
    async query(sql, params = []) {
      if (sql.includes('FROM Users WHERE google_id LIKE')) return [accounts.map(({ user_id }) => ({ user_id }))];
      if (sql.startsWith('INSERT INTO Users')) {
        const row = { user_id: (next += 1), google_id: params[0] };
        accounts.push(row);
        inserts.push(params);
        return [{ insertId: row.user_id }];
      }
      if (sql.includes('FROM Users WHERE user_id IN')) {
        return [params[0].map((id) => ({ user_id: id, nickname: `u${id}`, avatar: 'fox', google_id: accounts.some((a) => a.user_id === id) ? `${BOT_GOOGLE_PREFIX}x` : `g${id}` }))];
      }
      return [[]];
    },
  };
}

describe('bots: filling empty seats and playing', () => {
  const toClean = [];
  afterEach(() => {
    while (toClean.length) toClean.pop()();
  });

  // Wired exactly like app.js does it.
  function setup({ maxPlayers = 5, existingBots = 0, guests = [] } = {}) {
    const pool = fakePool({ existingBots });
    const manager = createRoomManager({ startPromptMs: 60_000, logger: silentLogger });
    const games = createGameManager({ manager, turnMs: 60_000, roundEndMs: 20, flipThreeMs: 1, targetScore: 1, makeDeck: plainDeck, logger: silentLogger });
    const bots = createBotService({ pool, manager, games, thinkMs: 1, logger: silentLogger });
    manager.hooks.isBot = bots.isBot;
    games.hooks.onFinished = (report) => bots.stripRanking(report.result);
    const service = createRoomService({ pool, manager, games, bots, logger: silentLogger });
    manager.hooks.autoStart = service.autoStart;
    bots.hooks.setReady = (id) => service.setReady(id, true);
    bots.hooks.leave = (id) => service.leaveRoom(id, { confirmed: true });
    toClean.push(() => { bots.shutdown(); games.shutdown(); manager.shutdown(); });
    manager.createRoom({ roomId: 7, code: 'ABCD', creatorId: HOST, gameModeId: 1, maxPlayers });
    for (const id of guests) manager.join('ABCD', id);
    return { pool, manager, games, bots, service, room: () => manager.getRoom('ABCD') };
  }
  const code = (promise) => promise.then(() => null, (e) => e.code);
  const botIdsIn = (s) => [...s.room().members.keys()].filter(s.bots.isBot);

  it('fills exactly the empty seats, and the room says so before and after', async () => {
    const s = setup({ maxPlayers: 5, guests: [2] });
    const before = await s.service.getCurrentRoom(HOST);
    expect(before).toMatchObject({ canFillBots: true, emptySeats: 3 });
    const after = await s.service.fillWithBots(HOST);
    expect(after.playerCount).toBe(5);
    expect(after).toMatchObject({ canFillBots: false, emptySeats: 0 });
    expect(after.players.filter((p) => p.isBot)).toHaveLength(3);
    expect(botIdsIn(s)).toHaveLength(3);
    expect(await code(s.service.fillWithBots(HOST))).toBe('ROOM_FULL');
  });

  it('only the host may fill the seats, and only before the game starts', async () => {
    const s = setup({ guests: [2, 3] });
    expect(await code(s.service.fillWithBots(2))).toBe('NOT_CREATOR');
    expect((await s.service.getCurrentRoom(2)).canFillBots).toBe(false);
    expect(await code(s.service.fillWithBots(99))).toBe('NOT_IN_ROOM');
    await s.service.startGame(HOST);
    expect(await code(s.service.fillWithBots(HOST))).toBe('ROOM_NOT_WAITING');
  });

  it('reuses free bot accounts first and only creates the missing ones', async () => {
    const s = setup({ maxPlayers: 6, existingBots: 2 });
    await s.service.fillWithBots(HOST);
    expect(botIdsIn(s)).toEqual(expect.arrayContaining([100, 101]));
    expect(s.pool.inserts).toHaveLength(3); // 5 empty seats, 2 accounts already existed
    expect(s.pool.inserts.map((p) => p[2])).toEqual(['Bot_3', 'Bot_4', 'Bot_5']);
  });

  it('bots answer their own questions, earn no ranking points and press "Play again"', async () => {
    const s = setup({ maxPlayers: 3 });
    await s.service.fillWithBots(HOST);
    await s.service.startGame(HOST);
    // the host always stays; the bots play by themselves
    await until(() => {
      const d = s.games.view('ABCD').decision;
      if (d?.playerId === HOST && d.type === 'hit_or_stay') s.games.act(HOST, { type: 'stay', decisionId: d.id });
      return s.games.view('ABCD').phase === 'finished';
    });
    const { standings } = s.games.view('ABCD').result;
    for (const row of standings.filter((r) => s.bots.isBot(r.userId))) expect(row.rankingPoints).toBe(0);
    expect(standings.find((r) => r.userId === HOST).rankingPoints).toBe(standings.find((r) => r.userId === HOST).finalPoints);
    await until(() => botIdsIn(s).every((id) => s.room().ready.has(id)));
    await s.service.setReady(HOST, true); // the person is the last one: the rematch starts
    expect(s.room().matchOver).toBe(false);
    expect(s.games.view('ABCD').phase).toBe('playing');
  });

  it('when every person has left, the bots leave too and the room closes', async () => {
    const s = setup({ maxPlayers: 4, guests: [2] });
    await s.service.fillWithBots(HOST);
    await s.service.startGame(HOST);
    await s.service.leaveRoom(2, { confirmed: true });
    await s.service.leaveRoom(HOST, { confirmed: true });
    await until(() => s.manager.getRoom('ABCD') === null);
  });

  it('the host can kick a bot; it is then no longer played by the server', async () => {
    const s = setup({ maxPlayers: 4, guests: [2] });
    await s.service.fillWithBots(HOST);
    const [bot] = botIdsIn(s);
    await s.service.removePlayer(HOST, bot);
    expect(s.room().members.has(bot)).toBe(false);
    expect(s.bots.isBot(bot)).toBe(false);
  });

  it('when the host leaves during a match, the host role goes to a person, not a bot', async () => {
    const s = setup({ maxPlayers: 4 });
    await s.service.fillWithBots(HOST); // the bots joined before the second person could
    s.manager.leave(botIdsIn(s)[0]); // make a seat for them
    s.manager.join('ABCD', 2);
    await s.service.startGame(HOST);
    await s.service.leaveRoom(HOST, { confirmed: true });
    expect(s.room().creatorId).toBe(2);
  });
});
