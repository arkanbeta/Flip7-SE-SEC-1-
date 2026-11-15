import { AppError } from '../utils/AppError.js';
import { isValidAvatar } from '../utils/avatars.js';

// Server-side validation: the browser may validate too, but it is never trusted.

// 3-20 letters (any language), digits, underscore or hyphen. No spaces.
// (The database column allows 30; we keep the public rule stricter.)
const NICKNAME_PATTERN = /^[\p{L}\p{N}_-]{3,20}$/u;

export const NICKNAME_RULE =
  'Nickname must be 3-20 characters: letters, numbers, underscores or hyphens.';

function validationError(field, message) {
  return new AppError(400, 'VALIDATION_ERROR', message, { field });
}

// Returns the cleaned nickname or throws a 400 AppError.
export function validateNickname(value) {
  if (typeof value !== 'string') {
    throw validationError('nickname', 'Nickname is required.');
  }
  // NFC makes visually identical characters byte-identical (e.g. "e" + accent vs "é").
  const nickname = value.trim().normalize('NFC');
  if (!NICKNAME_PATTERN.test(nickname)) {
    throw validationError('nickname', NICKNAME_RULE);
  }
  return nickname;
}

export function validateAvatar(value) {
  if (!isValidAvatar(value)) {
    throw validationError('avatar', 'Please choose one of the available avatars.');
  }
  return value;
}

export function validateRegistration(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError('body', 'Request body must be a JSON object.');
  }
  return {
    nickname: validateNickname(body.nickname),
    avatar: validateAvatar(body.avatar),
  };
}
