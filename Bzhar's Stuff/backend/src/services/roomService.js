import { AppError } from '../utils/AppError.js';
import { getDuplicateKey } from '../db/errors.js';
import { generateRoomCode } from '../utils/roomCode.js';
import { MIN_PLAYERS } from '../utils/roomRules.js';
import { BOT_GOOGLE_PREFIX } from './botService.js';

const MAX_CODE_ATTEMPTS = 10;

// Business rules for rooms. It combines the two stores:
//   - MySQL (GameRooms): the permanent record that a room exists, with its unique code
//   - roomManager: the live in-memory state (players, timers)
// `bots` (services/botService.js) is optional: without it the "fill with bots" button is not offered.
export function createRoomService({ pool, manager, games, bots = null, generateCode = generateRoomCode, logger = console }) {
  async function listModes() {
    const [rows] = await pool.query('SELECT game_mode_id, name, description FROM GameModes ORDER BY game_mode_id');
    return rows.map((row) => ({ id: row.game_mode_id, name: row.name, description: row.description }));
  }

  // Inserts the room row with a fresh code. The UNIQUE constraint on room_code is what
  // really prevents duplicates (also between two simultaneous requests): if the insert
  // collides we simply draw another code and try again.
  async function insertRoomRow({ creatorId, gameModeId, maxPlayers }) {
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt += 1) {
      const code = generateCode();
      try {
        const [result] = await pool.query(
          'INSERT INTO GameRooms (room_code, creator_id, game_mode_id, max_players) VALUES (?, ?, ?, ?)',
          [code, creatorId, gameModeId, maxPlayers]
        );
        return { roomId: result.insertId, code };
      } catch (error) {
        if (getDuplicateKey(error) === 'room_code') continue; // taken: try another code
        throw error;
      }
    }
    throw new AppError(503, 'ROOM_CODE_UNAVAILABLE', 'Could not create a room right now. Please try again.');
  }

  async function deleteRoomRow(roomId) {
    try {
      await pool.query('DELETE FROM GameRooms WHERE room_id = ?', [roomId]);
    } catch (error) {
      // The room is already gone from memory. A leftover row is removed at the next startup.
      logger.error(`Could not delete GameRooms row ${roomId}:`, error);
    }
  }

  async function createRoom(userId, { gameModeId, maxPlayers }) {
    if (manager.getRoomOfUser(userId)) {
      throw new AppError(409, 'ALREADY_IN_OTHER_ROOM', 'You are already in a room.', {
        code: manager.getRoomOfUser(userId).code,
      });
    }
    const [modes] = await pool.query('SELECT game_mode_id FROM GameModes WHERE game_mode_id = ?', [gameModeId]);
    if (modes.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'That game mode does not exist.', { field: 'gameModeId' });
    }

    const { roomId, code } = await insertRoomRow({ creatorId: userId, gameModeId, maxPlayers });
    try {
      // Re-checks "not already in a room": two simultaneous requests from one account
      // can both pass the check above, but only one can pass this synchronous one.
      manager.createRoom({ roomId, code, creatorId: userId, gameModeId, maxPlayers });
    } catch (error) {
      await deleteRoomRow(roomId);
      throw error;
    }
    return getCurrentRoom(userId);
  }

  async function joinRoom(userId, code) {
    manager.join(code, userId); // all rules (exists, open, space, not elsewhere) are checked there
    return getCurrentRoom(userId);
  }

  // Every change is sent to all the members at the same moment: they share ONE Users query
  // instead of each running their own. Nothing is kept once it has answered, so a changed
  // nickname shows up with the next change.
  function loadUsers(room, ids) {
    const key = ids.join();
    if (room.usersQuery?.key !== key) {
      const rows = pool.query('SELECT user_id, nickname, avatar, google_id FROM Users WHERE user_id IN (?)', [ids]).then(([users]) => users);
      const done = () => {
        if (room.usersQuery?.rows === rows) room.usersQuery = null;
      };
      rows.then(done, done);
      room.usersQuery = { key, rows };
    }
    return room.usersQuery.rows;
  }

  // Everything the browser needs to draw the room, from the point of view of `userId`.
  async function present(room, viewerId) {
    const ids = [...room.members.keys()];
    const users = await loadUsers(room, ids);
    const byId = new Map(users.map((u) => [u.user_id, u]));
    // A room's game mode never changes, so its name is read once.
    if (!room.gameModeName) {
      const [modes] = await pool.query('SELECT name FROM GameModes WHERE game_mode_id = ?', [room.gameModeId]);
      room.gameModeName = modes[0]?.name;
    }
    const isCreator = room.creatorId === viewerId;
    const game = games.view(room.code);

    return {
      code: room.code,
      status: room.status,
      gameMode: { id: room.gameModeId, name: room.gameModeName ?? 'Unknown' },
      maxPlayers: room.maxPlayers,
      minPlayers: MIN_PLAYERS,
      playerCount: room.members.size,
      creatorId: room.creatorId,
      isCreator,
      canStart: isCreator && room.status === 'Waiting' && room.members.size >= MIN_PLAYERS,
      emptySeats: room.maxPlayers - room.members.size,
      // Host only: the empty seats of a waiting room can be filled with computer players.
      canFillBots: Boolean(bots) && isCreator && room.status === 'Waiting' && room.members.size < room.maxPlayers,
      players: ids.map((id) => ({
        id,
        nickname: byId.get(id)?.nickname ?? 'Unknown',
        avatar: byId.get(id)?.avatar ?? '',
        isCreator: id === room.creatorId,
        isSpectator: room.spectators.has(id),
        isBot: Boolean(byId.get(id)?.google_id?.startsWith(BOT_GOOGLE_PREFIX)),
        // Host only: false greys out "Kick" for this player (banning is always possible).
        canKick: isCreator && id !== viewerId && !kickLocked(room, game, id),
      })),
      // Only the creator is asked; times are server clock values (the browser only counts down).
      startPrompt: isCreator && room.startPrompt ? { autoStartAt: room.startPrompt.autoStartAt } : null,
      nextPromptAt: isCreator ? room.nextPromptAt : null,
      // After a match: who wants to play again. `canRematch` = enough players are still here.
      matchOver: room.matchOver,
      // The host may start without the players who are not ready (needs 3 ready, themselves included).
      canStartWithReady: isCreator && room.matchOver && new Set([...room.ready, viewerId]).size >= MIN_PLAYERS,
      isSpectator: room.spectators.has(viewerId),
      readyIds: room.matchOver ? [...room.ready] : [],
      canRematch: room.matchOver && room.members.size >= MIN_PLAYERS,
      serverNow: Date.now(),
      version: room.version,
      // The game in progress (same for every player: all cards are face-up), or null.
      game,
    };
  }

  // A running match needs MIN_PLAYERS: at that size nobody who is playing can be kicked.
  // (The waiting room, the results screen and people who only watch are never locked.)
  function kickLocked(room, game, targetId) {
    if (!game || game.phase === 'finished' || room.spectators.has(targetId)) return false;
    return game.players.filter((p) => !p.left).length <= MIN_PLAYERS;
  }

  // The host puts a player out of the room. `ban` also keeps them out of THIS room for good.
  // Unlike walking out, a removed player keeps the points they had banked (it was not their choice).
  async function removePlayer(hostId, targetId, { ban = false } = {}) {
    const room = manager.assertCanRemove(hostId, targetId);
    if (!ban && kickLocked(room, games.view(room.code), targetId)) {
      throw new AppError(409, 'KICK_NEEDS_MORE_PLAYERS', `A match needs at least ${MIN_PLAYERS} players, so nobody can be kicked right now.`);
    }
    if (games.isRunning(room.code) && !room.spectators.has(targetId)) {
      games.removePlayer(room.code, targetId, { keepPoints: true });
    }
    manager.leave(targetId, { removed: ban ? 'banned' : 'kicked' });
    await rematchIfReady(room.code); // they may have been the one everybody was waiting for
    return getCurrentRoom(hostId);
  }

  async function getCurrentRoom(userId) {
    const room = manager.getRoomOfUser(userId);
    return room ? present(room, userId) : null;
  }

  // `confirmed` is true when the player agreed to the warning, or when the server itself
  // removes someone (a disconnect that did not recover). Walking out of a running match
  // costs the player their points, so a plain request is refused until it is confirmed.
  async function leaveRoom(userId, { confirmed = false } = {}) {
    const current = manager.getRoomOfUser(userId);
    if (!current) throw new AppError(404, 'NOT_IN_ROOM', 'You are not in a room.');
    // Asked BEFORE removing the player from the game: their own departure can be what ends the
    // match, and then they still left DURING it (ownership passes on).
    const matchWasOver = current.matchOver;
    // Someone who is only watching loses nothing by leaving.
    if (games.isRunning(current.code) && !current.spectators.has(userId)) {
      if (!confirmed) {
        throw new AppError(409, 'LEAVE_CONFIRMATION_REQUIRED', 'Leaving a game in progress means you get no points. Confirm to leave.');
      }
      games.removePlayer(current.code, userId);
    }
    const code = current.code;
    const result = manager.leave(userId, { matchWasOver });
    if (!result.closed) await rematchIfReady(code); // the one who was holding things up has gone
    if (result.closed) {
      await deleteRoomRow(result.room.roomId);
    } else if (result.newCreatorId) {
      try {
        await pool.query('UPDATE GameRooms SET creator_id = ? WHERE room_id = ?', [result.newCreatorId, result.room.roomId]);
      } catch (error) {
        logger.error('Could not save the new room creator:', error);
      }
    }
    return { closed: result.closed };
  }

  // Starts the next match when everyone still in the room is ready. The old game is dropped
  // and a fresh one is dealt; a creator who left on the results screen is replaced now.
  async function rematchIfReady(code) {
    const started = manager.beginRematch(code);
    if (!started) return false;
    return launchRematch(started);
  }

  async function launchRematch({ room, playerIds, newCreatorId }) {
    games.drop(room.code);
    games.start(room, playerIds); // the new match is dealt first; saving the host can wait
    if (newCreatorId) {
      try {
        await pool.query('UPDATE GameRooms SET creator_id = ? WHERE room_id = ?', [newCreatorId, room.roomId]);
      } catch (error) {
        logger.error('Could not save the new room creator:', error);
      }
    }
    return true;
  }

  // The host starts the next match with whoever is ready; the rest watch.
  async function startRematchWithReady(userId) {
    const started = manager.startWithReady(userId);
    await launchRematch(started);
    return getCurrentRoom(userId);
  }

  async function setReady(userId, ready) {
    const room = manager.setReady(userId, ready);
    await rematchIfReady(room.code);
    return getCurrentRoom(userId);
  }

  // Memory first, then the database; undone if the database write fails.
  async function persistStart(code) {
    const room = manager.markStarted(code);
    if (!room) return null;
    try {
      await pool.query("UPDATE GameRooms SET status = 'In Progress' WHERE room_id = ?", [room.roomId]);
    } catch (error) {
      manager.revertStart(code);
      throw error;
    }
    games.start(room); // deal the first round
    return room;
  }

  // The host fills every empty seat of the waiting room with computer players. The number of
  // empty seats is counted here, at the moment of the request, never taken from the browser.
  async function fillWithBots(userId) {
    const room = manager.getRoomOfUser(userId);
    if (!room) throw new AppError(404, 'NOT_IN_ROOM', 'You are not in a room.');
    if (room.creatorId !== userId) throw new AppError(403, 'NOT_CREATOR', 'Only the room creator can do that.');
    if (room.status !== 'Waiting') throw new AppError(409, 'ROOM_NOT_WAITING', 'The game has already started.');
    const empty = room.maxPlayers - room.members.size;
    if (empty <= 0) throw new AppError(409, 'ROOM_FULL', 'That room is full.');
    if (!bots) throw new AppError(503, 'BOTS_UNAVAILABLE', 'Computer players are not available right now.');
    await bots.fill(room.code, empty);
    return getCurrentRoom(userId);
  }

  // One move in the running game (Hit, Stay, or choosing a player). All checking is done by
  // the rules engine; the user id comes from the session.
  async function gameAction(userId, action) {
    games.act(userId, action);
    return getCurrentRoom(userId);
  }

  async function startGame(userId) {
    const room = manager.assertCanStart(userId);
    await persistStart(room.code);
    return getCurrentRoom(userId);
  }

  async function respondToStartPrompt(userId, answer) {
    const { start } = manager.respond(userId, answer);
    if (start) await persistStart(manager.getRoomOfUser(userId).code);
    return getCurrentRoom(userId);
  }

  // Called by the manager's timer when the creator did not answer in time.
  async function autoStart(code) {
    await persistStart(code);
  }

  // Memory is empty after a restart, so every stored room is stale: remove them all.
  async function clearAllRooms() {
    const [result] = await pool.query('DELETE FROM GameRooms');
    return result.affectedRows;
  }

  return {
    listModes, createRoom, joinRoom, getCurrentRoom, leaveRoom, removePlayer,
    startGame, respondToStartPrompt, autoStart, gameAction, setReady, startRematchWithReady, clearAllRooms, fillWithBots,
  };
}
