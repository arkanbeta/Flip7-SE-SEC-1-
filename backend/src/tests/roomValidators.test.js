import { describe, it, expect } from 'vitest';
import { validateCreateRoom, validateRoomCode, validateJoinRoom, validateStartAnswer } from '../validators/roomValidators.js';
import { generateRoomCode, ROOM_CODE_LENGTH } from '../utils/roomCode.js';
import { createRoomService } from '../services/roomService.js';

const fieldOf = (fn) => {
  try { fn(); } catch (e) { expect(e.statusCode).toBe(400); return e.details.field; }
  throw new Error('expected a validation error');
};

describe('validateCreateRoom', () => {
  it.each([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('accepts capacity %i', (maxPlayers) => {
    expect(validateCreateRoom({ gameModeId: 1, maxPlayers })).toEqual({ gameModeId: 1, maxPlayers });
  });
  it.each([2, 13, 0, -1, 3.5, '5', null, undefined, NaN])('rejects capacity %j (limits are fixed 3-12)', (maxPlayers) => {
    expect(fieldOf(() => validateCreateRoom({ gameModeId: 1, maxPlayers }))).toBe('maxPlayers');
  });
  it.each([0, -1, 1.5, '1', null, undefined])('rejects game mode %j', (gameModeId) => {
    expect(fieldOf(() => validateCreateRoom({ gameModeId, maxPlayers: 4 }))).toBe('gameModeId');
  });
  it('ignores a minimum-players setting: it cannot be configured', () => {
    expect(validateCreateRoom({ gameModeId: 1, maxPlayers: 4, minPlayers: 1 })).toEqual({ gameModeId: 1, maxPlayers: 4 });
  });
  it.each([null, 'x', 5, []])('rejects body %j', (body) => {
    expect(fieldOf(() => validateCreateRoom(body))).toBe('body');
  });
});

describe('validateRoomCode', () => {
  it('trims and upper-cases', () => {
    expect(validateRoomCode('  ab3k9z ')).toBe('AB3K9Z');
  });
  it.each(['abc', 'ABCDEFGHIJK', 'AB CD', 'AB-CD1', '', '   ', "A'B\"C1", '<b>abcd</b>', 'ÅBCDEF'])('rejects %j', (value) => {
    expect(fieldOf(() => validateRoomCode(value))).toBe('code');
  });
  it.each([undefined, null, 123, ['ABCD12']])('rejects non-string %j', (value) => {
    expect(fieldOf(() => validateRoomCode(value))).toBe('code');
  });
  it('validateJoinRoom wraps it', () => {
    expect(validateJoinRoom({ code: 'abcd12' })).toEqual({ code: 'ABCD12' });
    expect(fieldOf(() => validateJoinRoom(null))).toBe('body');
  });
});

describe('validateStartAnswer', () => {
  it('accepts yes and no only', () => {
    expect(validateStartAnswer({ answer: 'yes' })).toBe('yes');
    expect(validateStartAnswer({ answer: 'no' })).toBe('no');
    for (const answer of ['YES', 'maybe', true, null, undefined, '']) {
      expect(fieldOf(() => validateStartAnswer({ answer }))).toBe('answer');
    }
  });
});

describe('generateRoomCode', () => {
  it('makes 6-character codes without look-alike characters', () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
    }
  });
  it('does not repeat in a sample of 5000 (collisions are handled by the database anyway)', () => {
    const codes = new Set(Array.from({ length: 5000 }, generateRoomCode));
    expect(codes.size).toBeGreaterThan(4990);
  });
});

describe('clearAllRooms (startup cleanup)', () => {
  it('deletes every stored room, because memory is empty after a restart', async () => {
    const queries = [];
    const pool = { query: async (sql) => { queries.push(sql); return [{ affectedRows: 3 }]; } };
    const service = createRoomService({ pool, manager: {} });
    expect(await service.clearAllRooms()).toBe(3);
    expect(queries).toEqual(['DELETE FROM GameRooms']);
  });
});
