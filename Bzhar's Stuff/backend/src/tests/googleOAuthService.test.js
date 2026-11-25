import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replace Google's library with a controllable fake, so we test OUR wrapper's rules:
// what it asks Google for, and what it refuses to accept.
const mocks = vi.hoisted(() => ({
  generateAuthUrl: vi.fn(),
  getToken: vi.fn(),
  verifyIdToken: vi.fn(),
  ctor: vi.fn(),
}));
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    constructor(options) {
      mocks.ctor(options);
    }
    generateAuthUrl = mocks.generateAuthUrl;
    getToken = mocks.getToken;
    verifyIdToken = mocks.verifyIdToken;
  },
}));

const { createGoogleOAuthService } = await import('../services/googleOAuthService.js');

const settings = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://localhost:5173/cb' };
const goodPayload = { sub: '123', email: 'User@Example.com', email_verified: true, nonce: 'n1' };

describe('createGoogleOAuthService', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.generateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?client_id=cid');
    mocks.getToken.mockResolvedValue({ tokens: { id_token: 'jwt' } });
    mocks.verifyIdToken.mockResolvedValue({ getPayload: () => goodPayload });
  });

  it('gives the OAuth client its id, secret and redirect URI', () => {
    createGoogleOAuthService(settings);
    expect(mocks.ctor).toHaveBeenCalledWith(settings);
  });

  it('builds an authorization URL asking only for openid+email, with state and nonce', () => {
    const url = new URL(createGoogleOAuthService(settings).getAuthorizationUrl({ state: 's1', nonce: 'n1' }));
    expect(url.searchParams.get('nonce')).toBe('n1');
    const args = mocks.generateAuthUrl.mock.calls[0][0];
    expect(args.scope).toEqual(['openid', 'email']);
    expect(args.state).toBe('s1');
    expect(args.prompt).toBe('select_account');
  });

  it('returns a normalised identity for a valid token', async () => {
    const identity = await createGoogleOAuthService(settings).exchangeCode({ code: 'c', nonce: 'n1' });
    expect(identity).toEqual({ googleId: '123', email: 'user@example.com', emailVerified: true });
    expect(mocks.getToken).toHaveBeenCalledWith('c');
  });

  it('verifies the ID token against OUR client id (audience)', async () => {
    await createGoogleOAuthService(settings).exchangeCode({ code: 'c', nonce: 'n1' });
    expect(mocks.verifyIdToken).toHaveBeenCalledWith({ idToken: 'jwt', audience: 'cid' });
  });

  it('reports an unverified email as such (the auth service then refuses it)', async () => {
    mocks.verifyIdToken.mockResolvedValue({ getPayload: () => ({ ...goodPayload, email_verified: false }) });
    const identity = await createGoogleOAuthService(settings).exchangeCode({ code: 'c', nonce: 'n1' });
    expect(identity.emailVerified).toBe(false);
  });

  it.each([
    ['nonce mismatch', () => mocks.verifyIdToken.mockResolvedValue({ getPayload: () => ({ ...goodPayload, nonce: 'other' }) })],
    ['missing nonce', () => mocks.verifyIdToken.mockResolvedValue({ getPayload: () => ({ ...goodPayload, nonce: undefined }) })],
    ['no id_token', () => mocks.getToken.mockResolvedValue({ tokens: {} })],
    ['token exchange failure', () => mocks.getToken.mockRejectedValue(new Error('invalid_grant'))],
    ['verification failure', () => mocks.verifyIdToken.mockRejectedValue(new Error('Wrong recipient'))],
    ['no subject', () => mocks.verifyIdToken.mockResolvedValue({ getPayload: () => ({ ...goodPayload, sub: undefined }) })],
    ['no email', () => mocks.verifyIdToken.mockResolvedValue({ getPayload: () => ({ ...goodPayload, email: undefined }) })],
  ])('rejects: %s', async (label, arrange) => {
    arrange();
    await expect(createGoogleOAuthService(settings).exchangeCode({ code: 'c', nonce: 'n1' })).rejects.toMatchObject({
      statusCode: 502,
      code: 'GOOGLE_AUTH_FAILED',
    });
  });

  it('does not leak Google error details in the public message', async () => {
    mocks.getToken.mockRejectedValue(new Error('secret internal detail'));
    const error = await createGoogleOAuthService(settings).exchangeCode({ code: 'c', nonce: 'n1' }).catch((e) => e);
    expect(error.message).not.toContain('secret internal detail');
    expect(error.cause.message).toContain('secret internal detail'); // kept for server-side logs
  });
});
