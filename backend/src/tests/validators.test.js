import { describe, it, expect } from 'vitest';
import { validateNickname, validateAvatar, validateRegistration } from '../validators/authValidators.js';
import { getDuplicateKey } from '../db/errors.js';

const rejects = (fn, field) => {
  try {
    fn();
  } catch (error) {
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.field).toBe(field);
    return;
  }
  throw new Error('expected a validation error');
};

describe('validateNickname', () => {
  it.each(['abc', 'Player_1', 'cool-name', 'a'.repeat(20), 'José', 'سارا', 'ڕێبوار'])('accepts %s', (nick) => {
    expect(validateNickname(nick)).toBe(nick);
  });

  it('trims surrounding whitespace and normalises Unicode (NFC)', () => {
    expect(validateNickname('  Ana  ')).toBe('Ana');
    expect(validateNickname('Jose\u0301')).toBe('Jos\u00e9'); // e + combining accent -> é
  });

  it.each(['ab', 'a'.repeat(21), 'has space', 'bad!char', '<script>', "a'b\"c", '', '   ', 'x;DROP'])(
    'rejects %j',
    (nick) => rejects(() => validateNickname(nick), 'nickname')
  );

  it.each([undefined, null, 123, {}, ['abc']])('rejects non-string %j', (value) =>
    rejects(() => validateNickname(value), 'nickname')
  );
});

describe('validateAvatar', () => {
  it('accepts allowlisted avatars', () => {
    expect(validateAvatar('fox')).toBe('fox');
  });
  it.each(['unknown', '../../etc/passwd', 'FOX', '', null, undefined, 5])('rejects %j', (value) =>
    rejects(() => validateAvatar(value), 'avatar')
  );
});

describe('validateRegistration', () => {
  it('returns cleaned values', () => {
    expect(validateRegistration({ nickname: ' Sam ', avatar: 'owl', extra: 'ignored' })).toEqual({
      nickname: 'Sam',
      avatar: 'owl',
    });
  });
  it.each([null, undefined, 'text', 42, []])('rejects body %j', (body) =>
    rejects(() => validateRegistration(body), 'body')
  );
});

describe('getDuplicateKey', () => {
  it('extracts the key name from a MySQL duplicate-entry error', () => {
    const error = { code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'x' for key 'Users.nickname'" };
    expect(getDuplicateKey(error)).toBe('nickname');
    expect(getDuplicateKey({ code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'x' for key 'room_code'" })).toBe('room_code');
  });
  it('returns unknown when the message cannot be parsed, null for other errors', () => {
    expect(getDuplicateKey({ code: 'ER_DUP_ENTRY' })).toBe('unknown');
    expect(getDuplicateKey({ code: 'ER_NO_SUCH_TABLE' })).toBeNull();
    expect(getDuplicateKey(null)).toBeNull();
  });
});
