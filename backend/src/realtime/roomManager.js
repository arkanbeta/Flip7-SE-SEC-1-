import { AppError } from '../utils/AppError.js';
import { MIN_PLAYERS } from '../utils/roomRules.js';

// The live (in-memory) state of every active room: who is in it, the start-prompt timers
// and the room status. GameRooms rows in MySQL only record that a room EXISTS (code,
// creator, mode, capacity, status); WHO is inside lives here, as the specification asks.
//
// LIMITATION: memory is lost on restart, so the backend deletes all GameRooms rows at
// startup (roomService.clearAllRooms). Everything here is behind this small interface so
// Redis can replace it if the backend is ever run as several instances.
//
// Every method is synchronous. Node runs one piece of JavaScript at a time, so "is there
// room left? then add the player" cannot be interleaved with another request: two people
// grabbing the last slot can never both succeed.
//
// START PROMPT (all timing is decided here, never by the browser):
//   - when a Waiting room reaches MIN_PLAYERS the creator is asked "start now?"
//   - Yes  -> start immediately
//   - No   -> ask again after `startPromptMs`, again and again until Yes (or the creator leaves)
//   - no answer -> the game starts automatically `startPromptMs` after the question was asked
//   - dropping below MIN_PLAYERS cancels the timers; reaching it again asks afresh
export function createRoomManager({
  startPromptMs,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  hooks = {}, // hooks.autoStart(code) is called when an unanswered prompt times out
  logger = console,
} = {}) {
  const rooms = new Map(); // code -> room
  const roomOfUser = new Map(); // userId -> code
  const listeners = new Set();

  const err = (status, code, message, details) => new AppError(status, code, message, details);

  // `userIds`: people who are no longer in room.members but must still hear about the change.
  function emit(type, room, userIds = []) {
    room.version += 1;
    for (const listener of listeners) {
      try {
        listener({ type, room, userIds });
      } catch (error) {
        logger.error('Room listener failed:', error);
      }
    }
  }

  function clearTimers(room) {
    if (room.promptTimer) clearTimer(room.promptTimer);
    if (room.snoozeTimer) clearTimer(room.snoozeTimer);
    room.promptTimer = null;
    room.snoozeTimer = null;
    room.startPrompt = null;
    room.nextPromptAt = null;
  }

  function unref(timer) {
    timer?.unref?.(); // a pending room timer must never keep the process alive
    return timer;
  }

  function issuePrompt(room) {
    const issuedAt = now();
    room.startPrompt = { issuedAt, autoStartAt: issuedAt + startPromptMs };
    room.promptTimer = unref(
      setTimer(() => {
        room.promptTimer = null;
        Promise.resolve(hooks.autoStart?.(room.code)).catch((error) =>
          logger.error('Automatic start failed:', error)
        );
      }, startPromptMs)
    );
  }

  // Called after anything that can change whether the creator should be asked.
  function evaluatePrompt(room) {
    if (room.status !== 'Waiting' || room.members.size < MIN_PLAYERS) {
      clearTimers(room);
      return;
    }
    if (!room.startPrompt && !room.snoozeTimer) issuePrompt(room);
  }

  function getRoom(code) {
    return rooms.get(code) ?? null;
  }
  const getRoomOfUser = (userId) => getRoom(roomOfUser.get(userId));

  function createRoom({ roomId, code, creatorId, gameModeId, maxPlayers }) {
    if (roomOfUser.has(creatorId)) {
      throw err(409, 'ALREADY_IN_OTHER_ROOM', 'You are already in a room.', { code: roomOfUser.get(creatorId) });
    }
    const room = {
      roomId, code, creatorId, gameModeId, maxPlayers,
      status: 'Waiting',
      members: new Map([[creatorId, { userId: creatorId, joinedAt: now() }]]),
      startPrompt: null, nextPromptAt: null, promptTimer: null, snoozeTimer: null,
      matchOver: false, // true while the finished match's results screen is showing
      ready: new Set(), // who wants another match (only used while matchOver)
      spectators: new Set(), // members who joined a running match: they watch until the next one
      banned: new Set(), // user ids the host banned: they cannot join THIS room again (gone when the room closes)
      version: 0,
    };
    rooms.set(code, room);
    roomOfUser.set(creatorId, code);
    emit('created', room);
    return room;
  }

  // Returns { room, alreadyMember }. Opening the room again from the same account is
  // allowed (page refresh); being in a DIFFERENT room is not.
  function join(code, userId) {
    const room = getRoom(code);
    if (!room) throw err(404, 'ROOM_NOT_FOUND', 'No room with that code exists.');
    const currentCode = roomOfUser.get(userId);
    if (currentCode === code) return { room, alreadyMember: true };
    if (currentCode) {
      throw err(409, 'ALREADY_IN_OTHER_ROOM', 'You are already in another room. Leave it first.', { code: currentCode });
    }
    if (room.banned.has(userId)) throw err(403, 'BANNED', 'The host banned you from this room.');
    // A full room admits nobody, not even to watch. Joining a match that is being played means
    // watching it until the next one (spectators take a seat, so they can play the next match).
    if (room.members.size >= room.maxPlayers) throw err(409, 'ROOM_FULL', 'That room is full.');

    room.members.set(userId, { userId, joinedAt: now() });
    if (room.status === 'In Progress' && !room.matchOver) room.spectators.add(userId);
    roomOfUser.set(userId, code);
    evaluatePrompt(room);
    emit('joined', room);
    return { room, alreadyMember: false };
  }

  function closeRoom(room, reason) {
    clearTimers(room);
    const memberIds = [...room.members.keys()];
    for (const id of memberIds) roomOfUser.delete(id);
    rooms.delete(room.code);
    room.members.clear();
    emit('closed', room, memberIds);
    return { closed: true, reason, room, memberIds };
  }

  // An intentional leave. Rules (agreed with the project owner):
  //  - creator leaves BEFORE the match starts -> the room is terminated
  //  - creator leaves DURING a match -> ownership moves to the longest-present remaining player
  //  - the last player leaving always closes the room
  // `matchWasOver`: whether the match had already ended BEFORE this player's departure started.
  // `removed`: 'kicked' | 'banned' when the host put them out (see assertCanRemove).
  function leave(userId, { matchWasOver = undefined, removed = null } = {}) {
    const room = getRoomOfUser(userId);
    if (!room) throw err(404, 'NOT_IN_ROOM', 'You are not in a room.');
    if (removed === 'banned') room.banned.add(userId);
    const wasCreator = room.creatorId === userId;
    const onResultsScreen = matchWasOver ?? room.matchOver;

    if (wasCreator && room.status === 'Waiting') return { ...closeRoom(room, 'creator_left'), wasCreator };

    room.members.delete(userId);
    room.ready.delete(userId);
    room.spectators.delete(userId);
    roomOfUser.delete(userId);
    if (room.members.size === 0) return { ...closeRoom(room, 'empty'), wasCreator };

    let newCreatorId = null;
    // On the results screen the match is over and its points are saved, so the creator leaving
    // changes nothing yet; ownership only moves if the others play again without them (beginRematch).
    if (wasCreator && !onResultsScreen) {
      // Map keeps join order: the longest-present player; someone who is only watching is a last resort
      const ids = [...room.members.keys()];
      // a person is preferred over a server-run bot (hooks.isBot, set in app.js)
      newCreatorId = ids.find((id) => !room.spectators.has(id) && !hooks.isBot?.(id)) ?? ids.find((id) => !room.spectators.has(id)) ?? ids[0];
      room.creatorId = newCreatorId;
    }
    evaluatePrompt(room);
    emit(removed ?? 'left', room, [userId]);
    return { closed: false, room, wasCreator, newCreatorId };
  }

  // Checks that `hostId` may kick or ban `targetId`: the creator only, someone else in their room.
  function assertCanRemove(hostId, targetId) {
    const room = getRoomOfUser(hostId);
    assertCreator(room, hostId);
    if (targetId === hostId || !room.members.has(targetId)) {
      throw err(404, 'PLAYER_NOT_IN_ROOM', 'That player is not in your room.');
    }
    return room;
  }

  function assertCreator(room, userId) {
    if (!room) throw err(404, 'NOT_IN_ROOM', 'You are not in a room.');
    if (room.creatorId !== userId) throw err(403, 'NOT_CREATOR', 'Only the room creator can do that.');
  }

  // The creator answers the "start now?" question.
  function respond(userId, answer) {
    const room = getRoomOfUser(userId);
    assertCreator(room, userId);
    if (!room.startPrompt) throw err(409, 'NO_PENDING_PROMPT', 'There is no start question to answer right now.');
    if (answer === 'yes') return { room, start: true };

    // "No": clear the question and ask again after the full waiting period.
    clearTimers(room);
    room.nextPromptAt = now() + startPromptMs;
    room.snoozeTimer = unref(
      setTimer(() => {
        room.snoozeTimer = null;
        room.nextPromptAt = null;
        evaluatePrompt(room);
        emit('prompt', room);
      }, startPromptMs)
    );
    emit('declined', room);
    return { room, start: false };
  }

  // Checks that `userId` may start the game now (creator only, Waiting, enough players).
  function assertCanStart(userId) {
    const room = getRoomOfUser(userId);
    assertCreator(room, userId);
    if (room.status !== 'Waiting') throw err(409, 'ROOM_NOT_WAITING', 'The game has already started.');
    if (room.members.size < MIN_PLAYERS) {
      throw err(409, 'NOT_ENOUGH_PLAYERS', `At least ${MIN_PLAYERS} players are needed to start.`);
    }
    return room;
  }

  // Memory is changed first (synchronously, so it cannot race); the caller then saves it to
  // the database and calls revertStart if that fails.
  function markStarted(code) {
    const room = getRoom(code);
    if (!room || room.status !== 'Waiting' || room.members.size < MIN_PLAYERS) return null;
    clearTimers(room);
    room.status = 'In Progress';
    emit('started', room);
    return room;
  }
  function revertStart(code) {
    const room = getRoom(code);
    if (!room || room.status !== 'In Progress') return;
    room.status = 'Waiting';
    evaluatePrompt(room);
    emit('start_reverted', room);
  }

  // Tells every listener that something about the room changed (used by the game: each move
  // changes what the players must see, but not who is in the room).
  function touch(code, type = 'game') {
    const room = getRoom(code);
    if (room) emit(type, room);
  }

  // ---- Results screen and rematch --------------------------------------------------------
  // Called by the game manager when the match ends. Nobody can join (status stays In Progress);
  // the players still here decide whether to play again.
  function markMatchOver(code) {
    const room = getRoom(code);
    if (!room) return;
    room.matchOver = true;
    room.ready.clear();
    room.spectators.clear(); // on the results screen everybody is just a member again
  }

  // A player says "I want another match" (or changes their mind).
  function setReady(userId, ready) {
    const room = getRoomOfUser(userId);
    if (!room) throw err(404, 'NOT_IN_ROOM', 'You are not in a room.');
    if (!room.matchOver) throw err(409, 'MATCH_NOT_OVER', 'You can only get ready once the match has finished.');
    if (ready) room.ready.add(userId);
    else room.ready.delete(userId);
    emit('ready', room);
    return room;
  }

  // True when everybody still here is ready and there are enough of them.
  function rematchReady(code) {
    const room = getRoom(code);
    return Boolean(
      room && room.matchOver && room.members.size >= MIN_PLAYERS && [...room.members.keys()].every((id) => room.ready.has(id))
    );
  }

  // Starts the next match in the same room. If the creator left on the results screen the
  // room goes to the longest-present remaining player (project owner's rule).
  // Returns { room, newCreatorId } (newCreatorId is null when the creator is still here).
  // `force`: the host starts with only the players who are ready; everyone else watches.
  // Returns { room, playerIds, newCreatorId } (newCreatorId is null when the creator is still here).
  function beginRematch(code, { force = false } = {}) {
    const room = getRoom(code);
    if (!room || !room.matchOver) return null;
    if (!force && !rematchReady(code)) return null;
    const playerIds = [...room.members.keys()].filter((id) => !force || room.ready.has(id));
    if (playerIds.length < MIN_PLAYERS) return null;
    let newCreatorId = null;
    if (!room.members.has(room.creatorId)) {
      // the longest-present player who is taking part, a person before a bot
      newCreatorId = playerIds.find((id) => !hooks.isBot?.(id)) ?? playerIds[0];
      room.creatorId = newCreatorId;
    }
    room.spectators = new Set([...room.members.keys()].filter((id) => !playerIds.includes(id)));
    room.matchOver = false;
    room.ready.clear();
    emit('rematch', room);
    return { room, playerIds, newCreatorId };
  }

  // The host presses "start with the players who are ready" (they count as ready themselves).
  function startWithReady(userId) {
    const room = getRoomOfUser(userId);
    assertCreator(room, userId);
    if (!room.matchOver) throw err(409, 'MATCH_NOT_OVER', 'You can only do that once the match has finished.');
    const readyCount = new Set([...room.ready, userId]).size;
    if (readyCount < MIN_PLAYERS) {
      throw err(409, 'NOT_ENOUGH_PLAYERS', `At least ${MIN_PLAYERS} players must be ready to start.`);
    }
    room.ready.add(userId);
    return beginRematch(room.code, { force: true });
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function shutdown() {
    for (const room of rooms.values()) clearTimers(room);
  }

  return {
    hooks, // the owner of the manager fills in hooks.autoStart (see app.js)
    touch, markMatchOver, setReady, rematchReady, beginRematch, startWithReady,
    createRoom, join, leave, assertCanRemove, respond, assertCanStart, markStarted, revertStart,
    getRoom, getRoomOfUser, subscribe, shutdown,
    get size() { return rooms.size; },
  };
}
