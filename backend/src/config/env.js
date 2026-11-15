// Reads and validates environment variables in ONE place.
// The rest of the backend receives the resulting `config` object and never
// touches process.env directly. This keeps configuration easy to find and test.
//
// loadConfig() is a pure function (it only reads the object you give it), so
// tests can pass fake variables without touching the real environment.

const PLACEHOLDER_PREFIX = 'replace_with';

function readRequired(env, name) {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name} (see backend/.env.example)`
    );
  }
  return value.trim();
}

function readInt(env, name, fallback, { min }) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    const kind = min === 0 ? 'a non-negative' : 'a positive';
    throw new Error(`Environment variable ${name} must be ${kind} integer (got "${raw}")`);
  }
  return value;
}
const readPositiveInt = (env, name, fallback) => readInt(env, name, fallback, { min: 1 });
const readNonNegativeInt = (env, name, fallback) => readInt(env, name, fallback, { min: 0 });

function readUrl(env, name) {
  const raw = readRequired(env, name);
  try {
    return new URL(raw);
  } catch {
    throw new Error(`Environment variable ${name} must be a valid URL (got "${raw}")`);
  }
}

function readSessionSecret(env, name) {
  const value = readRequired(env, name);
  if (value.startsWith(PLACEHOLDER_PREFIX)) {
    throw new Error(`${name} still has the placeholder value from .env.example. Generate a real secret.`);
  }
  if (value.length < 32) {
    throw new Error(`${name} must be at least 32 characters long.`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  // new URL(...).origin strips any path or trailing slash, which is what the
  // CORS check compares against.
  const clientUrl = readUrl(env, 'CLIENT_ORIGIN');
  const googleRedirectUrl = readUrl(env, 'GOOGLE_REDIRECT_URI');

  if (isProduction) {
    // Login cookies and the OAuth redirect must never travel over plain HTTP in production.
    if (clientUrl.protocol !== 'https:') {
      throw new Error('CLIENT_ORIGIN must use https:// when NODE_ENV=production.');
    }
    if (googleRedirectUrl.protocol !== 'https:') {
      throw new Error('GOOGLE_REDIRECT_URI must use https:// when NODE_ENV=production.');
    }
  }

  const authRateLimitMax = readPositiveInt(env, 'AUTH_RATE_LIMIT_MAX', 30);

  return Object.freeze({
    nodeEnv,
    isProduction,
    port: readPositiveInt(env, 'PORT', 4000),
    clientOrigin: clientUrl.origin,
    // Number of reverse proxies in front of the backend (0 = none). Needed so
    // rate limiting sees real client IPs and "Secure" cookies work behind a proxy.
    trustProxy: readNonNegativeInt(env, 'TRUST_PROXY', 0),
    db: Object.freeze({
      host: readRequired(env, 'DB_HOST'),
      port: readPositiveInt(env, 'DB_PORT', 3306),
      user: readRequired(env, 'DB_USER'),
      // An empty password is allowed so local development databases work,
      // but the variable must still be set deliberately in production.
      password: env.DB_PASSWORD ?? '',
      database: readRequired(env, 'DB_NAME'),
      connectionLimit: readPositiveInt(env, 'DB_CONNECTION_LIMIT', 10),
    }),
    session: Object.freeze({
      secret: readSessionSecret(env, 'SESSION_SECRET'),
      maxAgeMs: readPositiveInt(env, 'SESSION_MAX_AGE_HOURS', 168) * 60 * 60 * 1000,
    }),
    google: Object.freeze({
      clientId: readRequired(env, 'GOOGLE_CLIENT_ID'),
      clientSecret: readRequired(env, 'GOOGLE_CLIENT_SECRET'),
      redirectUri: googleRedirectUrl.toString(),
    }),
    rooms: Object.freeze({
      // How long the creator has to answer "start now?", and how long to wait before asking
      // again after a "No". The agreed value is 2 minutes; shorter values are for testing.
      startPromptMs: readPositiveInt(env, 'ROOM_START_PROMPT_SECONDS', 120) * 1000,
      // How long a player may be disconnected before they are removed from their room
      // (covers page refreshes and flaky connections). Interim value until the owner decides.
      disconnectGraceMs: readPositiveInt(env, 'ROOM_DISCONNECT_GRACE_SECONDS', 30) * 1000,
    }),
    game: Object.freeze({
      // Time to answer a question (Hit/Stay and card choices). On time-out the player Stays.
      turnMs: readPositiveInt(env, 'GAME_TURN_SECONDS', 15) * 1000,
      // Pause between rounds so players can read the scores.
      roundEndMs: readPositiveInt(env, 'GAME_ROUND_END_SECONDS', 8) * 1000,
    }),
    rateLimit: Object.freeze({
      windowMs: 15 * 60 * 1000,
      authMax: authRateLimitMax,
      // Cheap lookups such as "is this nickname free?" get a more generous allowance.
      lookupMax: authRateLimitMax * 4,
    }),
  });
}
