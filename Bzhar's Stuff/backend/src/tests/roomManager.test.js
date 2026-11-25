import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoomManager } from '../realtime/roomManager.js';
import { silentLogger } from './helpers.js';

const DELAY = 120_000; // the agreed two minutes
const ALPHA = 1, BOB = 2, CY = 3, DEE = 4, EVE = 5;

let manager;
let autoStart;

function setup() {
  autoStart = vi.fn().mockResolvedValue(undefined);
  manager = createRoomManager({ startPromptMs: DELAY, hooks: { autoStart }, logger: silentLogger });
}
const makeRoom = (maxPlayers = 5, code = 'ROOM42') =>
  manager.createRoom({ roomId: 1, code, creatorId: ALPHA, gameModeId: 1, maxPlayers });
const fill = (code, ids) => ids.forEach((id) => manager.join(code, id));
const errorCode = (fn) => {
  try { fn(); } catch (e) { return e.code; }
  return null;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  setup();
});
afterEach(() => {
  manager.shutdown();
  vi.useRealTimers();
});

describe('creating and joining', () => {
  it('puts the creator in a Waiting room with no start question yet', () => {
    const room = makeRoom();
    expect(room.status).toBe('Waiting');
    expect([...room.members.keys()]).toEqual([ALPHA]);
    expect(room.startPrompt).toBeNull();
    expect(manager.getRoomOfUser(ALPHA)).toBe(room);
  });

  it('adds players and keeps join order', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    expect([...manager.getRoom('ROOM42').members.keys()]).toEqual([ALPHA, BOB, CY]);
  });

  it('reports an unknown code', () => {
    expect(errorCode(() => manager.join('NOPE00', BOB))).toBe('ROOM_NOT_FOUND');
  });

  it('refuses a player when the room is full (capacity 3, the minimum)', () => {
    makeRoom(3);
    fill('ROOM42', [BOB, CY]);
    expect(errorCode(() => manager.join('ROOM42', DEE))).toBe('ROOM_FULL');
    expect(manager.getRoom('ROOM42').members.size).toBe(3);
    expect(manager.getRoomOfUser(DEE)).toBeNull();
  });

  it('only one of several people grabbing the last slot gets it', () => {
    makeRoom(4);
    fill('ROOM42', [BOB, CY]);
    const results = [DEE, EVE, 6].map((id) => errorCode(() => manager.join('ROOM42', id)));
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === 'ROOM_FULL')).toHaveLength(2);
    expect(manager.getRoom('ROOM42').members.size).toBe(4);
  });

  it('is idempotent for someone already in that room (page refresh)', () => {
    makeRoom();
    manager.join('ROOM42', BOB);
    const again = manager.join('ROOM42', BOB);
    expect(again.alreadyMember).toBe(true);
    expect(manager.getRoom('ROOM42').members.size).toBe(2);
  });

  it('refuses someone who is already in a different room', () => {
    makeRoom(5, 'ROOM42');
    manager.createRoom({ roomId: 2, code: 'ROOM77', creatorId: BOB, gameModeId: 1, maxPlayers: 4 });
    expect(errorCode(() => manager.join('ROOM77', ALPHA))).toBe('ALREADY_IN_OTHER_ROOM');
    expect(errorCode(() => manager.createRoom({ roomId: 3, code: 'ROOM88', creatorId: ALPHA, gameModeId: 1, maxPlayers: 4 }))).toBe('ALREADY_IN_OTHER_ROOM');
  });

  it('lets someone join a game that has started, as a spectator, while there is a free seat', () => {
    makeRoom(4);
    fill('ROOM42', [BOB, CY]);
    manager.markStarted('ROOM42');
    const { room } = manager.join('ROOM42', DEE);
    expect(room.members.has(DEE)).toBe(true);
    expect(room.spectators.has(DEE)).toBe(true);
    expect(room.spectators.has(BOB)).toBe(false);
  });

  it('a full room admits nobody to a running game, not even to watch', () => {
    makeRoom(4);
    fill('ROOM42', [BOB, CY, DEE]);
    manager.markStarted('ROOM42');
    expect(errorCode(() => manager.join('ROOM42', 'EVE'))).toBe('ROOM_FULL');
  });
});

describe('the start question and its timers', () => {
  it('is not asked below 3 players, and is asked the moment the 3rd joins', () => {
    makeRoom();
    manager.join('ROOM42', BOB);
    expect(manager.getRoom('ROOM42').startPrompt).toBeNull();
    manager.join('ROOM42', CY);
    const prompt = manager.getRoom('ROOM42').startPrompt;
    expect(prompt.issuedAt).toBe(Date.now());
    expect(prompt.autoStartAt).toBe(Date.now() + DELAY);
  });

  it('starts automatically 2 minutes after an unanswered question (not before)', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    vi.advanceTimersByTime(DELAY - 1);
    expect(autoStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(autoStart).toHaveBeenCalledExactlyOnceWith('ROOM42');
  });

  it('Yes means start now', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    expect(manager.respond(ALPHA, 'yes').start).toBe(true);
  });

  it('No clears the question and asks again after the full 2 minutes', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    vi.advanceTimersByTime(30_000); // creator answers 30s into the first question
    const answeredAt = Date.now();
    expect(manager.respond(ALPHA, 'no').start).toBe(false);
    const room = manager.getRoom('ROOM42');
    expect(room.startPrompt).toBeNull();
    expect(room.nextPromptAt).toBe(answeredAt + DELAY);

    vi.advanceTimersByTime(DELAY - 1);
    expect(room.startPrompt).toBeNull(); // the waiting period restarted from the No
    vi.advanceTimersByTime(1);
    expect(room.startPrompt).not.toBeNull();
    expect(room.startPrompt.autoStartAt).toBe(Date.now() + DELAY);
    expect(autoStart).not.toHaveBeenCalled(); // the original auto-start was cancelled by the No
  });

  it('keeps asking again and again after every No (no limit)', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    for (let round = 0; round < 5; round += 1) {
      expect(manager.getRoom('ROOM42').startPrompt).not.toBeNull();
      manager.respond(ALPHA, 'no');
      vi.advanceTimersByTime(DELAY);
    }
    expect(manager.getRoom('ROOM42').startPrompt).not.toBeNull();
    expect(autoStart).not.toHaveBeenCalled();
  });

  it('after a re-asked question goes unanswered the game auto-starts 2 minutes later', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    manager.respond(ALPHA, 'no');
    vi.advanceTimersByTime(DELAY); // asked again
    vi.advanceTimersByTime(DELAY); // no answer
    expect(autoStart).toHaveBeenCalledExactlyOnceWith('ROOM42');
  });

  it('only the creator can answer, and only while a question is pending', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    expect(errorCode(() => manager.respond(BOB, 'yes'))).toBe('NOT_CREATOR');
    expect(errorCode(() => manager.respond(99, 'yes'))).toBe('NOT_IN_ROOM');
    manager.respond(ALPHA, 'no');
    expect(errorCode(() => manager.respond(ALPHA, 'yes'))).toBe('NO_PENDING_PROMPT');
  });

  it('dropping below 3 players cancels the question and the timers', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    manager.leave(CY);
    expect(manager.getRoom('ROOM42').startPrompt).toBeNull();
    vi.advanceTimersByTime(DELAY * 3);
    expect(autoStart).not.toHaveBeenCalled();
  });

  it('dropping below 3 during a "No" waiting period cancels the re-ask; reaching 3 asks afresh', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    manager.respond(ALPHA, 'no');
    manager.leave(CY);
    vi.advanceTimersByTime(DELAY * 2);
    expect(manager.getRoom('ROOM42').startPrompt).toBeNull();
    manager.join('ROOM42', DEE);
    expect(manager.getRoom('ROOM42').startPrompt.autoStartAt).toBe(Date.now() + DELAY);
  });

  it('a 4th player joining does not reset the question timer', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    const before = manager.getRoom('ROOM42').startPrompt.autoStartAt;
    vi.advanceTimersByTime(10_000);
    manager.join('ROOM42', DEE);
    expect(manager.getRoom('ROOM42').startPrompt.autoStartAt).toBe(before);
  });
});

describe('starting', () => {
  it('only the creator may start, and not below 3 players', () => {
    makeRoom();
    manager.join('ROOM42', BOB);
    expect(errorCode(() => manager.assertCanStart(ALPHA))).toBe('NOT_ENOUGH_PLAYERS');
    manager.join('ROOM42', CY);
    expect(errorCode(() => manager.assertCanStart(BOB))).toBe('NOT_CREATOR');
    expect(manager.assertCanStart(ALPHA).code).toBe('ROOM42');
  });

  it('markStarted flips to In Progress and cancels the pending auto-start', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    manager.markStarted('ROOM42');
    expect(manager.getRoom('ROOM42').status).toBe('In Progress');
    vi.advanceTimersByTime(DELAY * 2);
    expect(autoStart).not.toHaveBeenCalled();
  });

  it('cannot start twice, below 3, or an unknown room', () => {
    makeRoom();
    expect(manager.markStarted('ROOM42')).toBeNull(); // 1 player
    expect(manager.markStarted('NOPE00')).toBeNull();
    fill('ROOM42', [BOB, CY]);
    expect(manager.markStarted('ROOM42')).not.toBeNull();
    expect(manager.markStarted('ROOM42')).toBeNull();
    expect(errorCode(() => manager.assertCanStart(ALPHA))).toBe('ROOM_NOT_WAITING');
  });

  it('revertStart goes back to Waiting and asks the question again', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    manager.markStarted('ROOM42');
    manager.revertStart('ROOM42');
    const room = manager.getRoom('ROOM42');
    expect(room.status).toBe('Waiting');
    expect(room.startPrompt).not.toBeNull();
  });
});

describe('leaving', () => {
  it('terminates the room when the creator leaves before the match starts', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    const result = manager.leave(ALPHA);
    expect(result).toMatchObject({ closed: true, reason: 'creator_left', wasCreator: true });
    expect(manager.getRoom('ROOM42')).toBeNull();
    expect(manager.size).toBe(0);
    for (const id of [ALPHA, BOB, CY]) expect(manager.getRoomOfUser(id)).toBeNull(); // all freed
    vi.advanceTimersByTime(DELAY * 2);
    expect(autoStart).not.toHaveBeenCalled(); // its timers died with it
    expect(errorCode(() => manager.join('ROOM42', DEE))).toBe('ROOM_NOT_FOUND'); // code no longer reserved
  });

  it('keeps the room when an ordinary player leaves', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    const result = manager.leave(BOB);
    expect(result.closed).toBe(false);
    expect([...manager.getRoom('ROOM42').members.keys()]).toEqual([ALPHA, CY]);
    expect(manager.getRoomOfUser(BOB)).toBeNull();
  });

  it('lets a player who left join again', () => {
    makeRoom();
    manager.join('ROOM42', BOB);
    manager.leave(BOB);
    expect(manager.join('ROOM42', BOB).alreadyMember).toBe(false);
  });

  it('transfers ownership to the longest-present player when the creator leaves mid-match', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY, DEE]);
    manager.markStarted('ROOM42');
    const result = manager.leave(ALPHA);
    expect(result).toMatchObject({ closed: false, wasCreator: true, newCreatorId: BOB });
    expect(manager.getRoom('ROOM42').creatorId).toBe(BOB);
  });

  it('closes the room when the last player leaves mid-match', () => {
    makeRoom();
    fill('ROOM42', [BOB, CY]);
    manager.markStarted('ROOM42');
    manager.leave(BOB);
    manager.leave(CY);
    expect(manager.leave(ALPHA)).toMatchObject({ closed: true, reason: 'empty' });
    expect(manager.size).toBe(0);
  });

  it('says so when you are not in a room', () => {
    expect(errorCode(() => manager.leave(99))).toBe('NOT_IN_ROOM');
  });
});

describe('change notifications (used by Phase 5 live updates)', () => {
  it('announces changes with an increasing version', () => {
    const events = [];
    manager.subscribe(({ type, room }) => events.push([type, room.version]));
    makeRoom();
    manager.join('ROOM42', BOB);
    manager.leave(BOB);
    expect(events.map((e) => e[0])).toEqual(['created', 'joined', 'left']);
    expect(events.map((e) => e[1])).toEqual([1, 2, 3]);
  });

  it('a failing listener cannot break the room', () => {
    manager.subscribe(() => { throw new Error('boom'); });
    expect(() => makeRoom()).not.toThrow();
  });
});
