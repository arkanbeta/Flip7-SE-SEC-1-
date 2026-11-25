import { describe, it, expect } from 'vitest';
import { validateProfileUpdate, validateLimit } from '../validators/profileValidators.js';

const failsWith = (fn, field) => {
  try {
    fn();
  } catch (error) {
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.field).toBe(field);
    return error;
  }
  throw new Error('expected a validation error');
};

describe('validateProfileUpdate', () => {
  it('accepts a nickname, an avatar, or both, and cleans them', () => {
    expect(validateProfileUpdate({ nickname: ' Sam_1 ' })).toEqual({ nickname: 'Sam_1' });
    expect(validateProfileUpdate({ avatar: 'owl' })).toEqual({ avatar: 'owl' });
    expect(validateProfileUpdate({ nickname: 'Sam_1', avatar: 'owl' })).toEqual({ nickname: 'Sam_1', avatar: 'owl' });
  });

  it('refuses to change the email and explains why', () => {
    expect(failsWith(() => validateProfileUpdate({ email: 'x@y.z' }), 'email').message).toMatch(/Google account/);
  });

  it.each(['total_points', 'totalPoints', 'user_id', 'google_id', 'id'])('refuses the unexpected field %s', (key) =>
    failsWith(() => validateProfileUpdate({ [key]: 1, nickname: 'Valid_1' }), key)
  );

  it('refuses an email smuggled in next to valid fields', () => {
    failsWith(() => validateProfileUpdate({ nickname: 'Valid_1', email: 'x@y.z' }), 'email');
  });

  it('refuses an empty update', () => failsWith(() => validateProfileUpdate({}), 'body'));
  it.each([null, undefined, 'text', 7, []])('refuses body %j', (body) => failsWith(() => validateProfileUpdate(body), 'body'));

  it('applies the nickname and avatar rules', () => {
    failsWith(() => validateProfileUpdate({ nickname: 'a b' }), 'nickname');
    failsWith(() => validateProfileUpdate({ nickname: null }), 'nickname');
    failsWith(() => validateProfileUpdate({ avatar: 'nope' }), 'avatar');
  });
});

describe('validateLimit', () => {
  it('defaults to 10 and accepts 1 to 50', () => {
    expect(validateLimit(undefined)).toBe(10);
    expect(validateLimit('1')).toBe(1);
    expect(validateLimit('50')).toBe(50);
  });
  it.each(['0', '51', '-1', '1.5', 'abc', '', '1e2', '5 OR 1=1', ['5', '6'], { a: 1 }])('rejects %j', (value) =>
    failsWith(() => validateLimit(value), 'limit')
  );
});
