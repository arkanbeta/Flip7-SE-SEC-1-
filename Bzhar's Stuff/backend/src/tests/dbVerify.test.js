import { describe, it, expect, vi } from 'vitest';
import { verifyDatabase, parseMysqlVersion, REQUIRED_TABLES } from '../db/verify.js';

function fakePool({ version, tables = REQUIRED_TABLES }) {
  return {
    query: vi
      .fn()
      .mockResolvedValueOnce([[{ version }]])
      .mockResolvedValueOnce([tables.map((name) => ({ name }))]),
  };
}

describe('parseMysqlVersion', () => {
  it('parses plain and suffixed versions', () => {
    expect(parseMysqlVersion('8.0.46')).toEqual([8, 0, 46]);
    expect(parseMysqlVersion('8.0.46-0ubuntu0.24.04.4')).toEqual([8, 0, 46]);
  });
  it('returns null for garbage', () => {
    expect(parseMysqlVersion('unknown')).toBeNull();
  });
});

describe('verifyDatabase', () => {
  it('accepts MySQL 8.0.16+ with all tables', async () => {
    await expect(verifyDatabase(fakePool({ version: '8.0.16' }))).resolves.toEqual({ version: '8.0.16' });
    await expect(verifyDatabase(fakePool({ version: '8.4.0' }))).resolves.toEqual({ version: '8.4.0' });
  });

  it('rejects MySQL older than 8.0.16', async () => {
    await expect(verifyDatabase(fakePool({ version: '8.0.15' }))).rejects.toThrow('too old');
    await expect(verifyDatabase(fakePool({ version: '5.7.44' }))).rejects.toThrow('too old');
  });

  it('rejects MariaDB', async () => {
    await expect(verifyDatabase(fakePool({ version: '10.11.6-MariaDB' }))).rejects.toThrow('MariaDB');
  });

  it('lists missing tables', async () => {
    const pool = fakePool({ version: '8.0.46', tables: ['Users', 'GameModes'] });
    await expect(verifyDatabase(pool)).rejects.toThrow(/MatchHistories, MatchPlayers, GameRooms/);
  });

  // MySQL on Windows/macOS (lower_case_table_names=1/2) reports "users" for `Users`.
  it('accepts lowercase table names (Windows / macOS MySQL)', async () => {
    const pool = fakePool({ version: '8.0.46', tables: REQUIRED_TABLES.map((t) => t.toLowerCase()) });
    await expect(verifyDatabase(pool)).resolves.toEqual({ version: '8.0.46' });
  });
});
