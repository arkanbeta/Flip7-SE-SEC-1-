import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVATAR_IDS, isValidAvatar } from '../utils/avatars.js';

const avatarDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../frontend/src/assets/avatars'
);

describe('avatar allowlist', () => {
  it('offers between 12 and 16 avatars', () => {
    expect(AVATAR_IDS.length).toBeGreaterThanOrEqual(12);
    expect(AVATAR_IDS.length).toBeLessThanOrEqual(16);
  });

  it('has no duplicate ids and every id fits Users.avatar (VARCHAR 100)', () => {
    expect(new Set(AVATAR_IDS).size).toBe(AVATAR_IDS.length);
    AVATAR_IDS.forEach((id) => expect(id).toMatch(/^[a-z]{1,30}$/));
  });

  it('matches the SVG files in frontend/src/assets/avatars exactly', () => {
    const files = fs.readdirSync(avatarDir).filter((f) => f.endsWith('.svg')).map((f) => f.replace('.svg', ''));
    expect([...files].sort()).toEqual([...AVATAR_IDS].sort());
  });

  it('isValidAvatar only accepts listed strings', () => {
    expect(isValidAvatar('fox')).toBe(true);
    expect(isValidAvatar('nope')).toBe(false);
    expect(isValidAvatar(undefined)).toBe(false);
    expect(isValidAvatar(['fox'])).toBe(false);
  });
});
