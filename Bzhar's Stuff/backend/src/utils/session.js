import crypto from 'node:crypto';

// express-session uses callbacks; these wrappers let us use async/await.
const run = (action) =>
  new Promise((resolve, reject) => action((error) => (error ? reject(error) : resolve())));

export const saveSession = (req) => run((done) => req.session.save(done));
export const regenerateSession = (req) => run((done) => req.session.regenerate(done));
export const destroySession = (req) => run((done) => req.session.destroy(done));

export const randomToken = () => crypto.randomBytes(32).toString('hex');

// How long someone may take to choose a nickname after Google sign-in.
export const PENDING_PROFILE_TTL_MS = 15 * 60 * 1000;

// SECURITY (session fixation): whenever a visitor's privileges change we start a
// brand-new session id, so an id an attacker may have planted before login is useless.
// A fresh CSRF token is issued with each new session.
export async function startAuthenticatedSession(req, userId) {
  await regenerateSession(req);
  req.session.userId = userId;
  req.session.csrfToken = randomToken();
  await saveSession(req);
}

// A verified Google identity with no Users row yet. It waits in the SERVER-side
// session until the person picks a nickname and avatar.
export async function startPendingSession(req, identity) {
  await regenerateSession(req);
  req.session.pending = {
    googleId: identity.googleId,
    email: identity.email,
    createdAt: Date.now(),
  };
  req.session.csrfToken = randomToken();
  await saveSession(req);
}

export function getPendingProfile(session, now = Date.now()) {
  const pending = session?.pending;
  if (!pending) return null;
  if (now - pending.createdAt > PENDING_PROFILE_TTL_MS) return null;
  return pending;
}
