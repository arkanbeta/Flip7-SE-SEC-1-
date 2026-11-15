// These tests talk to a REAL MySQL database and are skipped unless
// RUN_DB_TESTS=true is set in backend/.env. They only create uniquely named
// temporary rows and always clean them up, so they are safe to run against
// your development database.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { verifyDatabase } from '../db/verify.js';

const enabled = process.env.RUN_DB_TESTS === 'true';

describe.skipIf(!enabled)('database (integration)', () => {
  let pool;
  const modeName = `TEST_MODE_${Date.now()}`;

  const countModes = async () => {
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM GameModes WHERE name = ?', [modeName]);
    return Number(rows[0].n);
  };

  beforeAll(() => {
    pool = createPool(loadConfig().db);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM GameModes WHERE name = ?', [modeName]);
    await pool.end();
  });

  it('passes the startup verification (version + 5 tables)', async () => {
    await expect(verifyDatabase(pool)).resolves.toHaveProperty('version');
  });

  it('contains the seeded Normal game mode', async () => {
    const [rows] = await pool.query('SELECT name FROM GameModes WHERE name = ?', ['Normal']);
    expect(rows).toHaveLength(1);
  });

  it('uses UTC for CURRENT_TIMESTAMP', async () => {
    const [rows] = await pool.query("SELECT @@session.time_zone AS tz");
    expect(rows[0].tz).toBe('+00:00');
  });

  it('withTransaction rolls back every write when the work throws', async () => {
    await expect(
      withTransaction(pool, async (conn) => {
        await conn.query('INSERT INTO GameModes (name, description) VALUES (?, ?)', [modeName, 'temp']);
        throw new Error('simulated failure');
      })
    ).rejects.toThrow('simulated failure');
    expect(await countModes()).toBe(0);
  });

  it('withTransaction commits when the work succeeds and returns its result', async () => {
    const result = await withTransaction(pool, async (conn) => {
      await conn.query('INSERT INTO GameModes (name, description) VALUES (?, ?)', [modeName, 'temp']);
      return 'finished';
    });
    expect(result).toBe('finished');
    expect(await countModes()).toBe(1);
  });

  it('enforces the room capacity CHECK (3-7) and the unique room code', async () => {
    const [user] = await pool.query(
      'INSERT INTO Users (google_id, email, nickname, avatar) VALUES (?, ?, ?, ?)',
      [`g_${modeName}`, `${modeName}@example.test`, `t${Date.now() % 1e9}`, 'avatar-test']
    );
    const userId = user.insertId;
    const [[mode]] = await pool.query('SELECT game_mode_id AS id FROM GameModes WHERE name = ?', ['Normal']);
    const insertRoom = (code, max) =>
      pool.query(
        'INSERT INTO GameRooms (room_code, creator_id, game_mode_id, max_players) VALUES (?, ?, ?, ?)',
        [code, userId, mode.id, max]
      );
    const code = `T${String(Date.now()).slice(-6)}`;
    try {
      await expect(insertRoom(`${code}A`, 2)).rejects.toMatchObject({ errno: 3819 }); // CHECK violated
      await expect(insertRoom(`${code}B`, 8)).rejects.toMatchObject({ errno: 3819 });
      await insertRoom(code, 5);
      await expect(insertRoom(code.toLowerCase(), 5)).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    } finally {
      await pool.query('DELETE FROM GameRooms WHERE creator_id = ?', [userId]);
      await pool.query('DELETE FROM Users WHERE user_id = ?', [userId]);
    }
  });
});
