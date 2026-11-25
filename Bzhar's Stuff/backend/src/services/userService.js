import { AppError } from '../utils/AppError.js';
import { getDuplicateKey } from '../db/errors.js';

// Converts a database row into the object the API returns. We choose the fields
// explicitly so internal columns (google_id) never leak to the browser.
export function toPublicUser(row) {
  return {
    id: row.user_id,
    email: row.email,
    nickname: row.nickname,
    avatar: row.avatar,
    totalPoints: Number(row.total_points),
    createdAt: row.created_at,
  };
}

export function createUserService(pool) {
  async function findOne(whereSql, value) {
    // whereSql is always a fixed string written in this file; only `value` varies,
    // and it is passed as a parameter.
    const [rows] = await pool.query(`SELECT * FROM Users WHERE ${whereSql} LIMIT 1`, [value]);
    return rows.length > 0 ? toPublicUser(rows[0]) : null;
  }

  const findById = (id) => findOne('user_id = ?', id);
  const findByGoogleId = (googleId) => findOne('google_id = ?', googleId);
  const findByEmail = (email) => findOne('email = ?', email);

  async function isNicknameAvailable(nickname, exceptUserId = null) {
    const [rows] = await pool.query(
      'SELECT user_id FROM Users WHERE nickname = ? AND (? IS NULL OR user_id <> ?) LIMIT 1',
      [nickname, exceptUserId, exceptUserId]
    );
    return rows.length === 0;
  }

  // The UNIQUE constraints are the real protection against duplicates, including two
  // requests racing each other. We just translate their errors into friendly ones.
  function translateDuplicate(error) {
    switch (getDuplicateKey(error)) {
      case 'nickname':
        return new AppError(409, 'NICKNAME_TAKEN', 'That nickname is already taken.');
      case 'google_id':
        return new AppError(409, 'ACCOUNT_EXISTS', 'An account for this Google account already exists.');
      case 'email':
        return new AppError(409, 'EMAIL_IN_USE', 'This email address is already used by another account.');
      default:
        return error;
    }
  }

  async function createUser({ googleId, email, nickname, avatar }) {
    try {
      const [result] = await pool.query(
        'INSERT INTO Users (google_id, email, nickname, avatar) VALUES (?, ?, ?, ?)',
        [googleId, email, nickname, avatar]
      );
      return await findById(result.insertId);
    } catch (error) {
      throw translateDuplicate(error);
    }
  }

  // Changes nickname and/or avatar (the only editable fields). Returns the updated user.
  // The SQL text is assembled from fixed fragments only; every value is a parameter.
  async function updateProfile(userId, { nickname, avatar }) {
    const assignments = [];
    const values = [];
    if (nickname !== undefined) {
      assignments.push('nickname = ?');
      values.push(nickname);
    }
    if (avatar !== undefined) {
      assignments.push('avatar = ?');
      values.push(avatar);
    }
    try {
      await pool.query(`UPDATE Users SET ${assignments.join(', ')} WHERE user_id = ?`, [...values, userId]);
    } catch (error) {
      throw translateDuplicate(error);
    }
    return findById(userId);
  }

  return { findById, findByGoogleId, findByEmail, isNicknameAvailable, createUser, updateProfile };
}
