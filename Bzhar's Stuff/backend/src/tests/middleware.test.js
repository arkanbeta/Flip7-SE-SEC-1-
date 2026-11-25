import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireAuth } from '../middleware/requireAuth.js';
import { createCsrfProtection, safeEqual } from '../middleware/csrf.js';
import { createErrorHandler } from '../middleware/errorHandler.js';
import { getPendingProfile, PENDING_PROFILE_TTL_MS } from '../utils/session.js';
import { silentLogger } from './helpers.js';

// A tiny app where `session` is faked by a header-driven middleware.
function appWith(session) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.get('/private', requireAuth, (req, res) => res.json({ userId: req.userId }));
  app.use(createCsrfProtection({ allowedOrigin: 'http://localhost:5173' }));
  app.get('/read', (req, res) => res.json({ ok: true }));
  app.post('/write', (req, res) => res.json({ ok: true }));
  app.use(createErrorHandler({ logger: silentLogger }));
  return app;
}

describe('requireAuth (protected routes)', () => {
  it('rejects anonymous visitors with 401', async () => {
    const res = await request(appWith({})).get('/private');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('rejects a session that only has a pending Google identity', async () => {
    const res = await request(appWith({ pending: { googleId: 'g', email: 'a@b.c' } })).get('/private');
    expect(res.status).toBe(401);
  });

  it('lets a logged-in session through and exposes the id from the SESSION', async () => {
    const res = await request(appWith({ userId: 42 })).get('/private?userId=999').set('x-user-id', '999');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(42); // query/header user ids are ignored
  });
});

describe('CSRF protection', () => {
  const session = { csrfToken: 'a'.repeat(64) };

  it('does not require a token for safe (read-only) methods', async () => {
    expect((await request(appWith(session)).get('/read')).status).toBe(200);
  });

  it('rejects state-changing requests without a token', async () => {
    const res = await request(appWith(session)).post('/write').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a wrong token, including one of the right length', async () => {
    const res = await request(appWith(session)).post('/write').set('X-CSRF-Token', 'b'.repeat(64)).send({});
    expect(res.status).toBe(403);
  });

  it('rejects any token when the session has none', async () => {
    const res = await request(appWith({})).post('/write').set('X-CSRF-Token', 'anything').send({});
    expect(res.status).toBe(403);
  });

  it('accepts the correct token', async () => {
    const res = await request(appWith(session)).post('/write').set('X-CSRF-Token', session.csrfToken).send({});
    expect(res.status).toBe(200);
  });

  it('accepts the correct token from our own origin, rejects it from another origin', async () => {
    const ok = await request(appWith(session))
      .post('/write').set('Origin', 'http://localhost:5173').set('X-CSRF-Token', session.csrfToken).send({});
    expect(ok.status).toBe(200);
    const bad = await request(appWith(session))
      .post('/write').set('Origin', 'http://evil.example').set('X-CSRF-Token', session.csrfToken).send({});
    expect(bad.status).toBe(403);
  });

  it('safeEqual compares strings of different length without throwing', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
});

describe('pending profile expiry', () => {
  it('is available shortly after sign-in and gone after the time limit', () => {
    const pending = { googleId: 'g', email: 'a@b.c', createdAt: 1_000 };
    expect(getPendingProfile({ pending }, 1_000 + 1_000)).toBe(pending);
    expect(getPendingProfile({ pending }, 1_000 + PENDING_PROFILE_TTL_MS + 1)).toBeNull();
    expect(getPendingProfile({}, 0)).toBeNull();
  });
});
