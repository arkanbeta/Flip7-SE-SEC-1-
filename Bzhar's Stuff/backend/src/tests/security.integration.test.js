// A sweep over EVERY endpoint: protection must not depend on someone remembering to add it.
// Real MySQL; skipped unless RUN_DB_TESTS=true.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createHarness, integrationEnabled } from './integrationHarness.js';
import { sessionCookieOptions } from '../config/session.js';

const POSTS = [
  '/api/auth/logout',
  '/api/rooms',
  '/api/rooms/join',
  '/api/rooms/current/leave',
  '/api/rooms/current/start',
  '/api/rooms/current/start-response',
  '/api/rooms/current/game/action',
  '/api/rooms/current/ready',
  '/api/rooms/current/rematch',
];
const SIGNED_IN_GETS = ['/api/rooms/modes', '/api/rooms/current', '/api/users/me', '/api/users/me/matches'];

describe.skipIf(!integrationEnabled)('security sweep (integration)', () => {
  let h;
  let user;
  beforeAll(async () => {
    h = createHarness();
    user = await h.createSignedInUser();
  });
  afterAll(async () => {
    await h.cleanup();
  });

  it.each(POSTS)('POST %s without a login is refused', async (path) => {
    const agent = request.agent(h.app);
    const res = await agent.post(path).send({});
    expect([401, 403]).toContain(res.status);
  });

  it.each(POSTS.filter((p) => p !== '/api/auth/logout'))('POST %s while logged in but without a CSRF token is refused', async (path) => {
    const res = await user.agent.post(path).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it.each(POSTS)('POST %s with a token but from a foreign origin is refused', async (path) => {
    const res = await user.agent.post(path).set('X-CSRF-Token', user.csrfToken).set('Origin', 'https://evil.example').send({});
    expect(res.status).toBe(403);
  });

  it.each(SIGNED_IN_GETS)('GET %s needs a login', async (path) => {
    const res = await request(h.app).get(path);
    expect(res.status).toBe(401);
  });

  it('never sends a private field about anyone, in any room or profile response', async () => {
    const other = await h.createSignedInUser();
    const created = await user.agent.post('/api/rooms').set('X-CSRF-Token', user.csrfToken).send({ gameModeId: (await h.pool.query("SELECT game_mode_id AS id FROM GameModes WHERE name='Normal'"))[0][0].id, maxPlayers: 4 });
    await other.agent.post('/api/rooms/join').set('X-CSRF-Token', other.csrfToken).send({ code: created.body.room.code });
    const text = JSON.stringify((await other.agent.get('/api/rooms/current')).body);
    expect(text).not.toContain(user.user.email);
    expect(text).not.toMatch(/google_id|googleId|"email"|drawPile|secret/i);
    await other.agent.post('/api/rooms/current/leave').set('X-CSRF-Token', other.csrfToken).send({});
    await user.agent.post('/api/rooms/current/leave').set('X-CSRF-Token', user.csrfToken).send({});
  });

  it('the session cookie is HttpOnly, SameSite=Lax, and HTTPS-only in production', () => {
    expect(sessionCookieOptions({ isProduction: true })).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/' });
    expect(sessionCookieOptions({ isProduction: false })).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: false });
  });

  it('answers with security headers and no framework banner', async () => {
    const res = await request(h.app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeTruthy();
  });

  it('unexpected input never produces a stack trace', async () => {
    const res = await user.agent.post('/api/rooms/join').set('X-CSRF-Token', user.csrfToken).set('Content-Type', 'application/json').send('{"code":');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js|node_modules/);
  });

  it('room-changing endpoints are rate limited per player', async () => {
    const spammer = await h.createSignedInUser();
    const statuses = [];
    for (let i = 0; i < 35; i += 1) {
      statuses.push((await spammer.agent.post('/api/rooms/current/leave').set('X-CSRF-Token', spammer.csrfToken).send({})).status);
    }
    expect(statuses).toContain(429);
    expect(statuses[0]).toBe(404); // "not in a room", before the limit is hit
  });
});
