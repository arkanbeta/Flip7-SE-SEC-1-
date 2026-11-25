import { AppError } from '../utils/AppError.js';
import { validateNickname, validateAvatar } from './authValidators.js';

const EDITABLE_FIELDS = new Set(['nickname', 'avatar']);

function validationError(field, message) {
  return new AppError(400, 'VALIDATION_ERROR', message, { field });
}

// PATCH /api/users/me. A strict allowlist: anything other than nickname/avatar is
// refused, so a client can never sneak in email, total_points or any other column.
export function validateProfileUpdate(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError('body', 'Request body must be a JSON object.');
  }
  for (const key of Object.keys(body)) {
    if (!EDITABLE_FIELDS.has(key)) {
      throw validationError(
        key.slice(0, 40),
        key === 'email'
          ? 'Your email comes from your Google account and cannot be changed.'
          : 'Only your nickname and avatar can be changed.'
      );
    }
  }
  const updates = {};
  if ('nickname' in body) updates.nickname = validateNickname(body.nickname);
  if ('avatar' in body) updates.avatar = validateAvatar(body.avatar);
  if (Object.keys(updates).length === 0) throw validationError('body', 'Nothing to update.');
  return updates;
}

// ?limit=  (whole number from 1 to `max`; `fallback` when absent)
export function validateLimit(value, { fallback = 10, max = 50 } = {}) {
  if (value === undefined) return fallback;
  const message = `limit must be a whole number from 1 to ${max}.`;
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value)) throw validationError('limit', message);
  const limit = Number(value);
  if (limit < 1 || limit > max) throw validationError('limit', message);
  return limit;
}
