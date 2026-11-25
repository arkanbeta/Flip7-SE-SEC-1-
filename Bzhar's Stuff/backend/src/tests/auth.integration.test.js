// End-to-end HTTP tests of the whole login system against a REAL MySQL database.
// Only Google itself is faked (we cannot sign in to a real Google account in a test).
// Skipped unless RUN_DB_TESTS=true in backend/.env. Test users use a unique prefix
// and are deleted afterwards.
import 'dotenv/config';
import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { createPool } from '../db/pool.js';
import { createMySqlSessionStore } from '../db/sessionStore.js';
import { loadConfig } from '../config/env.js';
import { makeConfig, silentLogger } from './helpers.js';

const enabled = process.env.RUN_DB_TESTS === 'true';
const ORIGIN = 'http://localhost:5173';

describe.skipIf(!enabled)('authentication flows (integration)', () => {
  let pool;
  let config;
  let google;
  let app;
  const prefix = `it${Date.now()}`;
  let counter = 0;
  const newIdentity = (overrides = {}) => {
    counter += 1;
    return { googleId: `${prefix}_g${counter}`, email: `${prefix}_${counter}@example.test`, emailVerified: true, ...overrides };
  };
  const nick = () => `u${Date.now() % 1e7}${(counter += 1)}`;

  // A fake Google: it remembers which identity belongs to which one-time code.
  function createFakeGoogle() {
    const codes = new Map();
    return {
      getAuthorizationUrl: ({ state, nonce }) => `https://accounts.google.test/auth?state=${state}&nonce=${nonce}`,
      async exchangeCode({ code }) {
        const identity = codes.get(code);
        if (!identity) throw new Error('unknown code');
        return identity;
      },
      issueCode(identity) {
        const code = crypto.randomBytes(8).toString('hex');
        codes.set(code, identity);
        return code;
      },
    };
  }

  // Performs "click Continue with Google -> approve at Google -> return to us".
  async function signInWithGoogle(agent, identity, { intent = 'login' } = {}) {
    const start = await agent.get(`/api/auth/google?intent=${intent}`);
    const state = new URL(start.headers.location).searchParams.get('state');
    const code = google.issueCode(identity);
    return agent.get(`/api/auth/google/callback?code=${code}&state=${state}`);
  }

  const me = async (agent) => (await agent.get('/api/auth/me')).body;

  async function registerAs(agent, { nickname = nick(), avatar = 'fox' } = {}) {
    const { csrfToken } = await me(agent);
    return agent.post('/api/auth/register').set('X-CSRF-Token', csrfToken).send({ nickname, avatar });
  }

  async function createAccount(identity = newIdentity(), nickname = nick()) {
    const agent = request.agent(app);
    await signInWithGoogle(agent, identity);
    const res = await registerAs(agent, { nickname });
    expect(res.status).toBe(201);
    return { identity, nickname, user: res.body.user };
  }

  const countUsers = async (googleId) => {
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM Users WHERE google_id = ?', [googleId]);
    return Number(rows[0].n);
  };

  beforeAll(() => {
    config = makeConfig();
    pool = createPool(loadConfig().db);
    google = createFakeGoogle();
    app = createApp({ config, pool, googleOAuth: google, logger: silentLogger });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM Users WHERE google_id LIKE ?', [`${prefix}%`]);
    await pool.end();
  });

  describe('starting sign-in', () => {
    it('redirects to Google with state+nonce and sets an HttpOnly, SameSite=Lax session cookie', async () => {
      const res = await request(app).get('/api/auth/google?intent=login');
      expect(res.status).toBe(302);
      const location = new URL(res.headers.location);
      expect(location.origin).toBe('https://accounts.google.test');
      expect(location.searchParams.get('state')).toHaveLength(64);
      const cookie = res.headers['set-cookie'].join(';');
      expect(cookie).toContain('flip7.sid=');
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    });
  });

  describe('new Google account (registration)', () => {
    it('creates NO user at the callback; the identity waits in the session', async () => {
      const identity = newIdentity();
      const agent = request.agent(app);
      const res = await signInWithGoogle(agent, identity, { intent: 'register' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${ORIGIN}/create-account/profile`);
      expect(await countUsers(identity.googleId)).toBe(0);
      const body = await me(agent);
      expect(body.user).toBeNull();
      expect(body.pendingProfile).toEqual({ email: identity.email });
      expect(body.csrfToken).toHaveLength(64);
    });

    it('adds ?from=login when the person used the Login page', async () => {
      const res = await signInWithGoogle(request.agent(app), newIdentity(), { intent: 'login' });
      expect(res.headers.location).toBe(`${ORIGIN}/create-account/profile?from=login`);
    });

    it('register creates the account, stores the Google email, and signs the person in', async () => {
      const identity = newIdentity();
      const agent = request.agent(app);
      await signInWithGoogle(agent, identity);
      const res = await registerAs(agent, { nickname: 'Maya_1', avatar: 'owl' });
      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({ nickname: 'Maya_1', avatar: 'owl', email: identity.email, totalPoints: 0 });
      expect(res.body.user).not.toHaveProperty('googleId');
      expect(res.body.user).not.toHaveProperty('google_id');
      expect(await countUsers(identity.googleId)).toBe(1);
      const body = await me(agent);
      expect(body.user.nickname).toBe('Maya_1');
      expect(body.pendingProfile).toBeNull();
    });

    it('issues a NEW session id at login (prevents session fixation)', async () => {
      const agent = request.agent(app);
      const pendingRes = await signInWithGoogle(agent, newIdentity());
      const before = pendingRes.headers['set-cookie']?.join(';');
      const { csrfToken: pendingToken } = await me(agent);
      const res = await registerAs(agent);
      const after = res.headers['set-cookie'].join(';');
      expect(after).toContain('flip7.sid=');
      expect(after).not.toBe(before);
      expect((await me(agent)).csrfToken).not.toBe(pendingToken); // token rotated too
    });

    it.each([
      [{ nickname: 'ab', avatar: 'fox' }, 'nickname'],
      [{ nickname: 'has space', avatar: 'fox' }, 'nickname'],
      [{ nickname: 'GoodName', avatar: 'not-an-avatar' }, 'avatar'],
      [{ nickname: 'GoodName' }, 'avatar'],
      [{}, 'nickname'],
    ])('rejects invalid input %j', async (payload, field) => {
      const agent = request.agent(app);
      await signInWithGoogle(agent, newIdentity());
      const { csrfToken } = await me(agent);
      const res = await agent.post('/api/auth/register').set('X-CSRF-Token', csrfToken).send(payload);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.field).toBe(field);
    });

    it('rejects a taken nickname, including different capitalisation/accents (409)', async () => {
      const taken = await createAccount(newIdentity(), `Zoé${Date.now() % 1e6}`);
      const variants = [taken.nickname, taken.nickname.toUpperCase(), taken.nickname.replace('é', 'e')];
      for (const nickname of variants) {
        const agent = request.agent(app);
        await signInWithGoogle(agent, newIdentity());
        const res = await registerAs(agent, { nickname });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('NICKNAME_TAKEN');
      }
    });

    it('after NICKNAME_TAKEN the person can retry with another nickname', async () => {
      const taken = await createAccount();
      const agent = request.agent(app);
      await signInWithGoogle(agent, newIdentity());
      expect((await registerAs(agent, { nickname: taken.nickname })).status).toBe(409);
      expect((await registerAs(agent, { nickname: nick() })).status).toBe(201);
    });
  });

  describe('existing Google account (login)', () => {
    it('signs in from the Login page and redirects to the lobby', async () => {
      const { identity, nickname } = await createAccount();
      const agent = request.agent(app);
      const res = await signInWithGoogle(agent, identity, { intent: 'login' });
      expect(res.headers.location).toBe(`${ORIGIN}/lobby`);
      expect((await me(agent)).user.nickname).toBe(nickname);
    });

    it('signs in (no duplicate) when the Create-account page is used with an existing account', async () => {
      const { identity, nickname } = await createAccount();
      const agent = request.agent(app);
      const res = await signInWithGoogle(agent, identity, { intent: 'register' });
      expect(res.headers.location).toBe(`${ORIGIN}/lobby`);
      expect((await me(agent)).user.nickname).toBe(nickname);
      expect(await countUsers(identity.googleId)).toBe(1);
    });

    it('never changes the stored email, even if Google reports a different one later', async () => {
      const { identity, user } = await createAccount();
      const agent = request.agent(app);
      await signInWithGoogle(agent, { ...identity, email: `changed_${identity.email}` });
      expect((await me(agent)).user.email).toBe(user.email);
    });
  });

  describe('duplicate account prevention', () => {
    it('two simultaneous registrations for one Google account create exactly ONE user', async () => {
      const identity = newIdentity();
      const [a, b] = [request.agent(app), request.agent(app)];
      await signInWithGoogle(a, identity);
      await signInWithGoogle(b, identity);
      const [ra, rb] = await Promise.all([registerAs(a, { nickname: nick() }), registerAs(b, { nickname: nick() })]);
      expect([ra.status, rb.status].sort()).toEqual([200, 201]);
      expect(ra.body.user.id).toBe(rb.body.user.id); // both end up in the SAME account
      expect(await countUsers(identity.googleId)).toBe(1);
    });

    it('refuses a different Google account that uses an already-registered email', async () => {
      const { identity } = await createAccount();
      const res = await signInWithGoogle(request.agent(app), newIdentity({ email: identity.email }));
      expect(res.headers.location).toBe(`${ORIGIN}/login?error=EMAIL_IN_USE`);
    });
  });

  describe('failed or forged sign-in attempts', () => {
    it('rejects an unverified Google email', async () => {
      const res = await signInWithGoogle(request.agent(app), newIdentity({ emailVerified: false }));
      expect(res.headers.location).toBe(`${ORIGIN}/login?error=GOOGLE_EMAIL_UNVERIFIED`);
    });

    it('rejects a callback whose state does not match', async () => {
      const agent = request.agent(app);
      await agent.get('/api/auth/google');
      const code = google.issueCode(newIdentity());
      const res = await agent.get(`/api/auth/google/callback?code=${code}&state=${'0'.repeat(64)}`);
      expect(res.headers.location).toBe(`${ORIGIN}/login?error=OAUTH_STATE_INVALID`);
      expect((await me(agent)).user).toBeNull();
    });

    it('rejects a callback in a browser that never started sign-in', async () => {
      const code = google.issueCode(newIdentity());
      const res = await request(app).get(`/api/auth/google/callback?code=${code}&state=${'a'.repeat(64)}`);
      expect(res.headers.location).toBe(`${ORIGIN}/login?error=OAUTH_STATE_INVALID`);
    });

    it('a callback URL can only be used once (replay fails)', async () => {
      const identity = newIdentity();
      const agent = request.agent(app);
      const start = await agent.get('/api/auth/google');
      const state = new URL(start.headers.location).searchParams.get('state');
      const url = `/api/auth/google/callback?code=${google.issueCode(identity)}&state=${state}`;
      expect((await agent.get(url)).headers.location).toContain('/create-account/profile');
      expect((await agent.get(url)).headers.location).toBe(`${ORIGIN}/login?error=OAUTH_STATE_INVALID`);
    });

    it('handles the person pressing Cancel on the Google screen', async () => {
      const agent = request.agent(app);
      await agent.get('/api/auth/google');
      const res = await agent.get('/api/auth/google/callback?error=access_denied');
      expect(res.headers.location).toBe(`${ORIGIN}/login?error=OAUTH_ACCESS_DENIED`);
    });

    it('turns an unexpected Google failure into a login-page error, never a crash', async () => {
      const agent = request.agent(app);
      const start = await agent.get('/api/auth/google');
      const state = new URL(start.headers.location).searchParams.get('state');
      const res = await agent.get(`/api/auth/google/callback?code=not-a-known-code&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${ORIGIN}/login?error=GOOGLE_AUTH_FAILED`);
    });
  });

  describe('protected endpoints and CSRF', () => {
    it('/me answers anonymous visitors with user:null (not an error) and no token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ user: null, pendingProfile: null, csrfToken: null });
    });

    it('register without a pending Google sign-in is refused', async () => {
      const { identity } = await createAccount();
      const agent = request.agent(app);
      await signInWithGoogle(agent, identity); // already registered -> logged in, nothing pending
      const { csrfToken } = await me(agent);
      const res = await agent.post('/api/auth/register').set('X-CSRF-Token', csrfToken).send({ nickname: nick(), avatar: 'fox' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NO_PENDING_REGISTRATION');
    });

    it('register without a CSRF token, with a wrong one, or from a foreign origin is refused', async () => {
      const agent = request.agent(app);
      await signInWithGoogle(agent, newIdentity());
      const { csrfToken } = await me(agent);
      const body = { nickname: nick(), avatar: 'fox' };
      expect((await agent.post('/api/auth/register').send(body)).status).toBe(403);
      expect((await agent.post('/api/auth/register').set('X-CSRF-Token', 'x'.repeat(64)).send(body)).status).toBe(403);
      const foreign = await agent.post('/api/auth/register').set('Origin', 'http://evil.example').set('X-CSRF-Token', csrfToken).send(body);
      expect(foreign.status).toBe(403);
      expect(foreign.body.error.code).toBe('CSRF_INVALID');
      // ...and none of those attempts created anything:
      expect((await agent.post('/api/auth/register').set('X-CSRF-Token', csrfToken).send(body)).status).toBe(201);
    });

    it('register from an anonymous browser is refused', async () => {
      const res = await request(app).post('/api/auth/register').send({ nickname: nick(), avatar: 'fox' });
      expect(res.status).toBe(403);
    });

    it('nickname-available needs a session, reports availability, and treats your own nickname as free', async () => {
      expect((await request(app).get('/api/auth/nickname-available?nickname=abcdef')).status).toBe(401);

      const taken = await createAccount();
      const agent = request.agent(app);
      await signInWithGoogle(agent, newIdentity());
      expect((await agent.get(`/api/auth/nickname-available?nickname=${encodeURIComponent(taken.nickname)}`)).body.available).toBe(false);
      expect((await agent.get(`/api/auth/nickname-available?nickname=${nick()}`)).body.available).toBe(true);
      expect((await agent.get('/api/auth/nickname-available?nickname=a b')).status).toBe(400);

      const owner = request.agent(app);
      await signInWithGoogle(owner, taken.identity);
      expect((await owner.get(`/api/auth/nickname-available?nickname=${encodeURIComponent(taken.nickname)}`)).body.available).toBe(true);
    });
  });

  describe('logout', () => {
    it('ends the session on the server: the old cookie stops working', async () => {
      const { identity } = await createAccount();
      const agent = request.agent(app);
      const login = await signInWithGoogle(agent, identity);
      const cookie = login.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
      const { csrfToken } = await me(agent);

      expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).body.user).not.toBeNull();
      expect((await agent.post('/api/auth/logout')).status).toBe(403); // CSRF needed
      expect((await agent.post('/api/auth/logout').set('X-CSRF-Token', csrfToken)).status).toBe(204);
      expect((await me(agent)).user).toBeNull();
      expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).body.user).toBeNull(); // replaying the stolen cookie fails
    });
  });

  describe('rate limiting', () => {
    it('answers 429 after too many sign-in attempts from one client', async () => {
      const limited = createApp({
        config: makeConfig({ AUTH_RATE_LIMIT_MAX: '3' }),
        pool,
        googleOAuth: createFakeGoogle(),
        logger: silentLogger,
      });
      const statuses = [];
      for (let i = 0; i < 5; i += 1) statuses.push((await request(limited).get('/api/auth/google')).status);
      expect(statuses).toEqual([302, 302, 302, 429, 429]);
      const blocked = await request(limited).get('/api/auth/google');
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
    });
  });

  describe('MySQL-backed sessions', () => {
    it('keep people logged in across a backend restart, and are stored in the sessions table', async () => {
      const { identity } = await createAccount();
      const makeApp = async () => {
        const store = await createMySqlSessionStore(pool, config);
        return { store, app: createApp({ config, pool, sessionStore: store, googleOAuth: google, logger: silentLogger }) };
      };
      const first = await makeApp();
      const login = await signInWithGoogle(request.agent(first.app), identity);
      expect(login.headers.location).toBe(`${ORIGIN}/lobby`);
      const cookie = login.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
      first.store.close(); // "backend stops"

      const second = await makeApp(); // "backend starts again" with an empty process memory
      const res = await request(second.app).get('/api/auth/me').set('Cookie', cookie);
      expect(res.body.user).not.toBeNull();

      const [rows] = await pool.query('SELECT COUNT(*) AS n FROM sessions');
      expect(Number(rows[0].n)).toBeGreaterThan(0);

      const { csrfToken } = res.body;
      await request(second.app).post('/api/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', csrfToken); // clean up
      second.store.close();
    });
  });
});
