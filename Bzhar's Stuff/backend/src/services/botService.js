import { chooseMove } from '../game/botStrategy.js';
import { AVATAR_IDS } from '../utils/avatars.js';
import { getDuplicateKey } from '../db/errors.js';

// Bot accounts are ordinary Users rows whose google_id starts with this (no Google account
// can have it). The developer script scripts/bots.js uses the same accounts.
export const BOT_GOOGLE_PREFIX = 'dev-bot-';
const THINK_MS = 1200; // a short pause before each move, so people can follow what the bots do

// Computer players run by the server itself ("Fill empty seats with bots").
//
// A bot is seated with manager.join like anyone else and plays through games.act like anyone
// else, so the rules engine checks every move. It never opens a connection: the socket server
// asks isBot() to skip its "did they disconnect?" timer for these players.
//
// Only bots seated by THIS service are played here; bots run by scripts/bots.js play themselves.
// Owner's decisions: bots earn no ranking points, stay for the rematch and ready up, and can
// be kicked by the host like anyone else.
export function createBotService({
  pool,
  manager,
  games,
  thinkMs = THINK_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  logger = console,
}) {
  const seated = new Set(); // bot user ids this service put into a room
  const pending = new Map(); // room code -> { key, timer }: the one thing a bot will do next there
  // Filled in by app.js (they live in roomService, which itself uses this service):
  //   hooks.setReady(userId)  "Play again"   hooks.leave(userId)  leave the room
  const hooks = {};

  const isBot = (userId) => seated.has(userId);

  // Free bot accounts (not in any room), creating new ones when there are not enough.
  async function freeBotIds(count) {
    const [rows] = await pool.query('SELECT user_id FROM Users WHERE google_id LIKE ? ORDER BY user_id', [`${BOT_GOOGLE_PREFIX}%`]);
    const free = rows.map((r) => r.user_id).filter((id) => !manager.getRoomOfUser(id));
    let n = rows.length;
    for (let attempts = 0; free.length < count && attempts < count + 20; attempts += 1) {
      n += 1;
      try {
        const [result] = await pool.query('INSERT INTO Users (google_id, email, nickname, avatar) VALUES (?, ?, ?, ?)', [
          `${BOT_GOOGLE_PREFIX}${n}`, `bot${n}@bots.localhost`, `Bot_${n}`, AVATAR_IDS[(n - 1) % AVATAR_IDS.length],
        ]);
        free.push(result.insertId);
      } catch (error) {
        if (!getDuplicateKey(error)) throw error; // that number or nickname is taken: try the next one
      }
    }
    return free;
  }

  // Seats up to `count` bots. The room may change while the accounts are being fetched,
  // so the capacity is checked again for every seat; returns how many were seated.
  async function fill(code, count) {
    const ids = await freeBotIds(count);
    let added = 0;
    for (const id of ids) {
      const room = manager.getRoom(code);
      if (added >= count || !room || room.status !== 'Waiting' || room.members.size >= room.maxPlayers) break;
      try {
        seated.add(id); // before join: join announces the change, and the listener must know it is a bot
        manager.join(code, id);
        added += 1;
      } catch (error) {
        seated.delete(id);
        if (error.code === 'ROOM_FULL') break;
        if (error.code !== 'ALREADY_IN_OTHER_ROOM') throw error; // taken by another room meanwhile: next one
      }
    }
    return added;
  }

  // Remembers ONE upcoming action per room; a newer one replaces it.
  function later(code, key, delay, run) {
    const current = pending.get(code);
    if (current?.key === key) return;
    if (current) clearTimer(current.timer);
    const timer = setTimer(() => {
      pending.delete(code);
      Promise.resolve()
        .then(run)
        .catch((error) => logger.error('A bot could not act:', error));
    }, delay);
    timer?.unref?.();
    pending.set(code, { key, timer });
  }
  function cancel(code) {
    const current = pending.get(code);
    if (current) clearTimer(current.timer);
    pending.delete(code);
  }

  function onRoomChange({ type, room }) {
    for (const id of seated) if (!manager.getRoomOfUser(id)) seated.delete(id); // kicked, banned or room closed
    if (type === 'closed') return cancel(room.code);
    const memberIds = [...room.members.keys()];
    const bots = memberIds.filter(isBot);
    if (bots.length === 0) return cancel(room.code);

    // Only bots left: they leave too, so the room closes instead of playing forever.
    if (bots.length === memberIds.length) {
      return later(room.code, 'leave', 0, async () => {
        for (const id of bots) if (manager.getRoomOfUser(id)) await hooks.leave(id);
      });
    }
    // Results screen: each bot presses "Play again".
    if (room.matchOver) {
      const waiting = bots.find((id) => !room.ready.has(id));
      if (waiting) later(room.code, `ready:${waiting}`, thinkMs, () => hooks.setReady(waiting));
      return undefined;
    }
    // The game asks a bot something: answer after a short pause (Flip Three cards are drawn by the clock).
    const game = games.view(room.code);
    const d = game?.phase === 'playing' ? game.decision : null;
    if (!d || !isBot(d.playerId) || d.type === 'flip_three_draw') return undefined;
    return later(room.code, `move:${d.id}`, thinkMs, () => {
      const now = games.view(room.code);
      if (now?.decision?.id !== d.id) return; // already answered (or timed out)
      games.act(d.playerId, { ...chooseMove(now, d.playerId), decisionId: d.id });
    });
  }
  const unsubscribe = manager.subscribe(onRoomChange);

  // Owner's decision: bots earn no ranking points. Called with the engine's result as the match
  // ends, before it is shown or saved, so the results screen and the database agree.
  function stripRanking(result) {
    for (const row of result.standings) if (isBot(row.userId)) row.rankingPoints = 0;
    return result;
  }

  function shutdown() {
    unsubscribe();
    for (const { timer } of pending.values()) clearTimer(timer);
    pending.clear();
  }

  return { hooks, isBot, fill, stripRanking, shutdown };
}
