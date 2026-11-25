import { AppError } from '../utils/AppError.js';
import { safeEqual } from '../middleware/csrf.js';
import { randomToken } from '../utils/session.js';

// How long the browser may spend on Google's screens before the attempt expires.
const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;

export function createAuthService({ userService, googleOAuth }) {
  // Step 1: create the one-time values for a login attempt and the Google URL.
  function beginGoogleSignIn(intent) {
    const attempt = {
      state: randomToken(),
      nonce: randomToken(),
      intent: intent === 'register' ? 'register' : 'login',
      createdAt: Date.now(),
    };
    return { attempt, url: googleOAuth.getAuthorizationUrl(attempt) };
  }

  // Step 2: Google sent the browser back. Prove the callback belongs to the attempt WE
  // started in this browser's session, then turn the code into a verified identity.
  // Returns { type: 'existing', user } or { type: 'new', identity }.
  async function completeGoogleSignIn({ query, attempt }) {
    if (query.error) {
      // The person pressed "Cancel" on Google's screen (or Google refused).
      throw new AppError(
        400,
        query.error === 'access_denied' ? 'OAUTH_ACCESS_DENIED' : 'GOOGLE_AUTH_FAILED',
        'Google sign-in was not completed.'
      );
    }

    const stateOk =
      attempt &&
      typeof query.state === 'string' &&
      safeEqual(attempt.state, query.state) &&
      Date.now() - attempt.createdAt <= OAUTH_ATTEMPT_TTL_MS;
    if (!stateOk) {
      throw new AppError(400, 'OAUTH_STATE_INVALID', 'The sign-in attempt expired or was not started here.');
    }
    if (typeof query.code !== 'string' || query.code.length === 0) {
      throw new AppError(400, 'GOOGLE_AUTH_FAILED', 'Google did not return a sign-in code.');
    }

    const identity = await googleOAuth.exchangeCode({ code: query.code, nonce: attempt.nonce });
    if (!identity.emailVerified) {
      throw new AppError(403, 'GOOGLE_EMAIL_UNVERIFIED', 'The Google account email is not verified.');
    }

    const existing = await userService.findByGoogleId(identity.googleId);
    if (existing) return { type: 'existing', user: existing, intent: attempt.intent };

    // Same email but a different Google id: refuse early with a clear reason.
    if (await userService.findByEmail(identity.email)) {
      throw new AppError(409, 'EMAIL_IN_USE', 'This email address is already used by another account.');
    }
    return { type: 'new', identity, intent: attempt.intent };
  }

  // Step 3 (new accounts only): create the Users row once nickname and avatar are chosen.
  // Never creates a duplicate: if a parallel request already created the account for this
  // Google id, we simply sign that account in.
  async function registerAccount({ identity, nickname, avatar }) {
    try {
      const user = await userService.createUser({
        googleId: identity.googleId,
        email: identity.email,
        nickname,
        avatar,
      });
      return { user, created: true };
    } catch (error) {
      if (error instanceof AppError && error.code === 'ACCOUNT_EXISTS') {
        const existing = await userService.findByGoogleId(identity.googleId);
        if (existing) return { user: existing, created: false };
      }
      throw error;
    }
  }

  return { beginGoogleSignIn, completeGoogleSignIn, registerAccount };
}
