import { describe, it, expect, vi } from 'vitest';
import { createAuthService } from '../services/authService.js';
import { AppError } from '../utils/AppError.js';

const identity = { googleId: 'g1', email: 'a@example.com', emailVerified: true };
const user = { id: 7, nickname: 'Ann' };

function build({ existing = null, emailOwner = null, exchange = identity, createUser } = {}) {
  const userService = {
    findByGoogleId: vi.fn().mockResolvedValue(existing),
    findByEmail: vi.fn().mockResolvedValue(emailOwner),
    createUser: createUser ?? vi.fn().mockResolvedValue(user),
  };
  const googleOAuth = {
    getAuthorizationUrl: vi.fn(({ state }) => `https://google.test/?state=${state}`),
    exchangeCode: vi.fn().mockResolvedValue(exchange),
  };
  return { service: createAuthService({ userService, googleOAuth }), userService, googleOAuth };
}

const startAttempt = (service, intent) => service.beginGoogleSignIn(intent).attempt;
const code = (error) => error.code;

describe('beginGoogleSignIn', () => {
  it('creates random single-use state and nonce and passes them to Google', () => {
    const { service, googleOAuth } = build();
    const a = service.beginGoogleSignIn('login');
    const b = service.beginGoogleSignIn('login');
    expect(a.attempt.state).not.toBe(b.attempt.state);
    expect(a.attempt.state).toHaveLength(64);
    expect(googleOAuth.getAuthorizationUrl).toHaveBeenCalledWith(expect.objectContaining({ state: a.attempt.state, nonce: a.attempt.nonce }));
  });

  it('only accepts the intents login and register (default login)', () => {
    const { service } = build();
    expect(service.beginGoogleSignIn('register').attempt.intent).toBe('register');
    expect(service.beginGoogleSignIn('hacker').attempt.intent).toBe('login');
    expect(service.beginGoogleSignIn(undefined).attempt.intent).toBe('login');
  });
});

describe('completeGoogleSignIn', () => {
  it('signs in an existing account', async () => {
    const { service } = build({ existing: user });
    const attempt = startAttempt(service);
    const result = await service.completeGoogleSignIn({ query: { code: 'c', state: attempt.state }, attempt });
    expect(result).toMatchObject({ type: 'existing', user });
  });

  it('reports a new Google account (no Users row is created yet)', async () => {
    const { service, userService } = build();
    const attempt = startAttempt(service, 'register');
    const result = await service.completeGoogleSignIn({ query: { code: 'c', state: attempt.state }, attempt });
    expect(result).toMatchObject({ type: 'new', identity, intent: 'register' });
    expect(userService.createUser).not.toHaveBeenCalled();
  });

  it('passes the attempt nonce to the Google exchange', async () => {
    const { service, googleOAuth } = build();
    const attempt = startAttempt(service);
    await service.completeGoogleSignIn({ query: { code: 'c', state: attempt.state }, attempt });
    expect(googleOAuth.exchangeCode).toHaveBeenCalledWith({ code: 'c', nonce: attempt.nonce });
  });

  it.each([
    ['no attempt in the session', () => ({ query: { code: 'c', state: 'x' }, attempt: undefined })],
    ['wrong state', (s) => ({ query: { code: 'c', state: 'wrong'.repeat(13) }, attempt: startAttempt(s) })],
    ['missing state', (s) => ({ query: { code: 'c' }, attempt: startAttempt(s) })],
    ['expired attempt', (s) => {
      const attempt = { ...startAttempt(s), createdAt: Date.now() - 11 * 60 * 1000 };
      return { query: { code: 'c', state: attempt.state }, attempt };
    }],
  ])('rejects: %s', async (label, arrange) => {
    const { service, googleOAuth } = build();
    const input = arrange(service);
    await expect(service.completeGoogleSignIn(input)).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
    expect(googleOAuth.exchangeCode).not.toHaveBeenCalled(); // never talks to Google with an unproven callback
  });

  it('maps a cancelled Google screen to OAUTH_ACCESS_DENIED', async () => {
    const { service } = build();
    await expect(
      service.completeGoogleSignIn({ query: { error: 'access_denied' }, attempt: startAttempt(service) })
    ).rejects.toMatchObject({ code: 'OAUTH_ACCESS_DENIED' });
  });

  it('rejects a callback with no code', async () => {
    const { service } = build();
    const attempt = startAttempt(service);
    await expect(service.completeGoogleSignIn({ query: { state: attempt.state }, attempt })).rejects.toMatchObject({ code: 'GOOGLE_AUTH_FAILED' });
  });

  it('refuses an unverified Google email', async () => {
    const { service } = build({ exchange: { ...identity, emailVerified: false } });
    const attempt = startAttempt(service);
    await expect(
      service.completeGoogleSignIn({ query: { code: 'c', state: attempt.state }, attempt })
    ).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_UNVERIFIED' });
  });

  it('refuses a new Google id whose email already belongs to another account', async () => {
    const { service } = build({ emailOwner: { id: 3 } });
    const attempt = startAttempt(service);
    await expect(
      service.completeGoogleSignIn({ query: { code: 'c', state: attempt.state }, attempt })
    ).rejects.toMatchObject({ code: 'EMAIL_IN_USE' });
  });
});

describe('registerAccount', () => {
  const input = { identity, nickname: 'Ann', avatar: 'fox' };

  it('creates the account with the identity from the session', async () => {
    const { service, userService } = build();
    expect(await service.registerAccount(input)).toEqual({ user, created: true });
    expect(userService.createUser).toHaveBeenCalledWith({ googleId: 'g1', email: 'a@example.com', nickname: 'Ann', avatar: 'fox' });
  });

  it('signs in the existing account if a parallel request already created it (no duplicate)', async () => {
    const createUser = vi.fn().mockRejectedValue(new AppError(409, 'ACCOUNT_EXISTS', 'exists'));
    const { service } = build({ existing: user, createUser });
    expect(await service.registerAccount(input)).toEqual({ user, created: false });
  });

  it.each(['NICKNAME_TAKEN', 'EMAIL_IN_USE'])('passes %s through to the caller', async (errorCode) => {
    const createUser = vi.fn().mockRejectedValue(new AppError(409, errorCode, 'x'));
    const { service } = build({ createUser });
    await expect(service.registerAccount(input)).rejects.toMatchObject({ code: errorCode });
  });
});
