import { AppError } from '../utils/AppError.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '../config/session.js';
import { validateNickname, validateRegistration } from '../validators/authValidators.js';
import {
  saveSession,
  destroySession,
  startAuthenticatedSession,
  startPendingSession,
  getPendingProfile,
} from '../utils/session.js';

export function createAuthController({ config, authService, userService, logger = console }) {
  // Browser-facing redirects go to the FRONTEND (CLIENT_ORIGIN), e.g. /lobby.
  function frontendUrl(path, params = {}) {
    const url = new URL(path, config.clientOrigin);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  }

  function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions(config));
  }

  // GET /api/auth/google?intent=login|register
  // The browser navigates here (a plain link) and is bounced to Google.
  async function googleStart(req, res) {
    const { attempt, url } = authService.beginGoogleSignIn(req.query.intent);
    req.session.oauth = attempt; // remembered server-side, to be checked in the callback
    await saveSession(req); // make sure it is stored BEFORE the browser leaves
    res.redirect(url);
  }

  // GET /api/auth/google/callback  (Google sends the browser here)
  // This is a browser navigation, so failures redirect to the login page with an error
  // code instead of returning JSON.
  async function googleCallback(req, res) {
    const attempt = req.session.oauth;
    delete req.session.oauth; // one-time use: a replayed callback cannot succeed

    try {
      const result = await authService.completeGoogleSignIn({ query: req.query, attempt });

      if (result.type === 'existing') {
        // Works from both the Login and the Create-account page: no duplicate account is made.
        await startAuthenticatedSession(req, result.user.id);
        return res.redirect(frontendUrl('/lobby'));
      }

      await startPendingSession(req, result.identity);
      const params = result.intent === 'login' ? { from: 'login' } : {};
      return res.redirect(frontendUrl('/create-account/profile', params));
    } catch (error) {
      let code = 'GOOGLE_AUTH_FAILED';
      if (error instanceof AppError) {
        code = error.code;
        if (error.cause) logger.error('Google sign-in failed:', error.cause);
      } else {
        logger.error('Unexpected error in Google callback:', error);
      }
      await saveSession(req).catch(() => {});
      return res.redirect(frontendUrl('/login', { error: code }));
    }
  }

  // GET /api/auth/dev?player=1..8   DEVELOPMENT ONLY (the route exists only when
  // DEV_LOGIN_ENABLED=true and NODE_ENV is not production). Signs the browser in as a
  // local test player, skipping Google, so the game can be played on one computer.
  async function devLogin(req, res) {
    if (!config.devLogin) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    const n = Number(req.query.player ?? 1);
    const player = Number.isInteger(n) && n >= 1 && n <= 8 ? n : 1;
    const identity = { googleId: `dev-local-${player}`, email: `player${player}@local.localhost` };

    const existing = await userService.findByGoogleId(identity.googleId);
    if (existing) {
      await startAuthenticatedSession(req, existing.id);
      return res.redirect(frontendUrl('/lobby'));
    }
    await startPendingSession(req, identity);
    return res.redirect(frontendUrl('/create-account/profile', { from: 'login' }));
  }

  // GET /api/auth/me - "who am I?" The frontend calls this on every page load.
  // Never returns 401 for visitors: { user: null } is a normal answer.
  async function me(req, res) {
    const userId = req.session.userId;
    if (userId) {
      const user = await userService.findById(userId);
      if (user) {
        return res.json({ user, pendingProfile: null, csrfToken: req.session.csrfToken });
      }
      // The session points at a user that no longer exists: end it.
      await destroySession(req);
      clearSessionCookie(res);
      return res.json({ user: null, pendingProfile: null, csrfToken: null });
    }

    const pending = getPendingProfile(req.session);
    if (pending) {
      return res.json({
        user: null,
        pendingProfile: { email: pending.email },
        csrfToken: req.session.csrfToken,
      });
    }
    return res.json({ user: null, pendingProfile: null, csrfToken: null });
  }

  // GET /api/auth/nickname-available?nickname=...  (advisory only: the UNIQUE constraint
  // in the database is what really guarantees uniqueness when the account is created)
  async function nicknameAvailable(req, res) {
    const exceptUserId = req.session.userId ?? null;
    if (!exceptUserId && !getPendingProfile(req.session)) {
      throw new AppError(401, 'AUTH_REQUIRED', 'You need to sign in to do that.');
    }
    const nickname = validateNickname(req.query.nickname);
    res.json({ nickname, available: await userService.isNicknameAvailable(nickname, exceptUserId) });
  }

  // POST /api/auth/register  { nickname, avatar }
  // Creates the Users row for the Google identity waiting in the session.
  async function register(req, res) {
    const pending = getPendingProfile(req.session);
    if (!pending) {
      throw new AppError(403, 'NO_PENDING_REGISTRATION', 'Sign in with Google first.');
    }
    const { nickname, avatar } = validateRegistration(req.body);
    const { user, created } = await authService.registerAccount({ identity: pending, nickname, avatar });

    await startAuthenticatedSession(req, user.id);
    res.status(created ? 201 : 200).json({ user, csrfToken: req.session.csrfToken });
  }

  // POST /api/auth/logout
  async function logout(req, res) {
    const userId = req.session?.userId;
    await destroySession(req);
    clearSessionCookie(res);
    req.app.locals.realtime?.disconnectUser(userId); // a logged-out browser must stop receiving room updates
    res.status(204).end();
  }

  return { googleStart, googleCallback, devLogin, me, nicknameAvailable, register, logout };
}
