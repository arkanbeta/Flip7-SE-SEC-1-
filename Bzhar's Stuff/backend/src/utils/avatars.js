// The built-in avatar collection. `Users.avatar` stores one of these ids.
// The matching images live in frontend/src/assets/avatars/<id>.svg.
// A test (avatars.test.js) fails if this list and that folder ever disagree.
export const AVATAR_IDS = Object.freeze([
  'fox', 'cat', 'bear', 'owl', 'frog', 'rabbit', 'penguin',
  'panda', 'pig', 'lion', 'mouse', 'chick', 'koala', 'raccoon',
]);

const allowed = new Set(AVATAR_IDS);

// The backend never trusts an avatar value from the browser: it must be on the allowlist.
export const isValidAvatar = (value) => typeof value === 'string' && allowed.has(value);
