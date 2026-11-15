import session from 'express-session';

export const SESSION_COOKIE_NAME = 'flip7.sid';

// Shared by the session middleware and by res.clearCookie() on logout
// (the browser only deletes a cookie when these options match).
export function sessionCookieOptions(config) {
  return {
    httpOnly: true, // JavaScript in the page can never read the session cookie
    secure: config.isProduction, // HTTPS only in production
    // "lax" still lets the cookie come back after Google redirects to us (a top-level
    // GET) but blocks it on cross-site POSTs, which is the first CSRF defence.
    sameSite: 'lax',
    path: '/',
  };
}

export function createSessionMiddleware({ config, store }) {
  return session({
    name: SESSION_COOKIE_NAME,
    secret: config.session.secret,
    store, // undefined -> express-session's MemoryStore (used by tests only)
    resave: false,
    saveUninitialized: false, // no cookie for visitors who never log in
    rolling: true, // activity keeps the session alive; idle sessions expire
    cookie: { ...sessionCookieOptions(config), maxAge: config.session.maxAgeMs },
  });
}
