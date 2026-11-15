import { Game } from './flip7Game.js';
import { AppError } from '../utils/AppError.js';

// Runs the live games, one per room, in memory (like the RoomManager). It adds what the pure
// rules engine does not do: TIME. Every question has a time limit; when it runs out the engine
// takes its default answer (Hit/Stay -> Stay). Between rounds there is a short pause so
// everyone can read the round summary, then the next round starts by itself.
//
// Everything here is synchronous and Node runs one thing at a time, so two requests can never
// answer the same question twice (the second one is told its question is out of date).
export function createGameManager({
  manager,
  turnMs = 15_000,
  roundEndMs = 8_000,
  flipThreeMs = 1_100, // gap between Flip Three cards (a bit longer than the card's flight animation)
  rng,
  targetScore = null, // tests: a low target ends a match quickly
  makeDeck = null, // tests: () => cards in draw order, instead of a random shuffle
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  hooks = {}, // hooks.onFinished({room,result,startedAt,finishedAt}) and hooks.onAbandoned({room,startedAt,finishedAt,rounds}): the match is saved there (app.js)
  logger = console,
}) {
  const entries = new Map(); // room code -> { game, timer, timerKind, deadline, reported }

  function clear(entry) {
    if (entry.timer) clearTimer(entry.timer);
    entry.timer = null;
    entry.timerKind = null;
    entry.deadline = null;
  }

  // Starts the right clock for whatever the game is waiting for now.
  function schedule(code, entry) {
    const { game } = entry;
    // Still waiting for the same thing (someone else left, say): its clock keeps running
    // instead of starting again.
    const waitingFor = game.finished ? null : game.phase === 'round_over' ? `round ${game.roundNumber}` : game.decision && `decision ${game.decision.id}`;
    if (entry.timer && waitingFor && waitingFor === entry.waitingFor) return;
    clear(entry);
    entry.waitingFor = waitingFor;
    if (game.finished) return;
    let ms;
    let run;
    if (game.phase === 'round_over') {
      entry.timerKind = 'next_round';
      ms = roundEndMs;
      run = () => game.beginNextRound();
    } else if (game.decision) {
      const drawing = game.decision.type === 'flip_three_draw';
      entry.timerKind = drawing ? 'flip_three' : 'turn';
      ms = drawing ? flipThreeMs : turnMs;
      const questionId = game.decision.id;
      run = () => {
        if (game.decision?.id === questionId) game.timeout(); // still the same unanswered question
      };
    } else {
      return;
    }
    entry.deadline = now() + ms;
    entry.timer = setTimer(() => {
      entry.timer = null;
      try {
        run();
      } catch (error) {
        logger.error('Game timer failed:', error);
      }
      changed(code, entry);
    }, ms);
    entry.timer.unref?.();
  }

  // Call after ANY change to a game: restarts the clock, reports a finished match once, and
  // tells the room manager so everyone gets the new state.
  function changed(code, entry) {
    schedule(code, entry);
    if (entry.game.finished && !entry.reported) {
      entry.reported = true;
      entry.finishedAt = now();
      manager.markMatchOver?.(code); // the room now shows the results screen / ready system
      try {
        hooks.onFinished?.({ room: manager.getRoom(code), result: entry.game.result, startedAt: entry.startedAt, finishedAt: entry.finishedAt });
      } catch (error) {
        logger.error('Game finished hook failed:', error);
      }
    }
    manager.touch(code, 'game');
  }

  const entryOf = (code) => entries.get(code);

  // Called once the room has been marked "In Progress". Seat order = join order.
  function start(room, playerIds = [...room.members.keys()]) {
    if (entries.has(room.code)) return;
    const game = new Game({
      playerIds,
      ...(rng ? { rng } : {}),
      ...(targetScore ? { targetScore } : {}),
      ...(makeDeck ? { deck: makeDeck() } : {}),
    });
    const entry = { game, timer: null, timerKind: null, deadline: null, reported: false, startedAt: now(), finishedAt: null };
    entries.set(room.code, entry);
    changed(room.code, entry);
  }

  function act(userId, action) {
    const room = manager.getRoomOfUser(userId);
    const entry = room && entryOf(room.code);
    if (!entry) throw new AppError(409, 'GAME_NOT_RUNNING', 'There is no game running in your room.');
    entry.game.act(userId, action);
    changed(room.code, entry);
  }

  // A player left the match (they get nothing, unless the host removed them: `keepPoints`).
  function removePlayer(code, userId, options) {
    const entry = entryOf(code);
    if (!entry) return;
    entry.game.removePlayer(userId, options);
    changed(code, entry);
  }

  // True while a match is being played (a finished one no longer needs a "really leave?").
  function isRunning(code) {
    const entry = entryOf(code);
    return Boolean(entry && !entry.game.finished);
  }

  // The state every player in the room receives (all cards are face-up in Flip 7).
  function view(code) {
    const entry = entryOf(code);
    if (!entry) return null;
    return {
      ...entry.game.view(),
      timer: entry.deadline ? { kind: entry.timerKind, endsAt: entry.deadline } : null,
      turnSeconds: Math.round(turnMs / 1000),
    };
  }

  function drop(code) {
    const entry = entryOf(code);
    if (!entry) return;
    clear(entry);
    entries.delete(code);
  }

  // A closed room takes its game with it. If that game was still being played (everybody
  // walked out) it is recorded as Abandoned: no player rows, no points.
  const unsubscribe = manager.subscribe(({ type, room }) => {
    if (type !== 'closed') return;
    const entry = entryOf(room.code);
    if (entry && !entry.game.finished && !entry.reported) {
      entry.reported = true;
      try {
        hooks.onAbandoned?.({ room, startedAt: entry.startedAt, finishedAt: now(), rounds: entry.game.roundNumber });
      } catch (error) {
        logger.error('Game abandoned hook failed:', error);
      }
    }
    drop(room.code);
  });

  function shutdown() {
    unsubscribe();
    for (const entry of entries.values()) clear(entry);
    entries.clear();
  }

  return { hooks, start, act, removePlayer, isRunning, view, drop, shutdown, size: () => entries.size };
}
