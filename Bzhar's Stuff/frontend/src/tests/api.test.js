import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, setCsrfToken, registerAccount, getMe, logout } from '../services/api.js';

// These tests use the REAL api.js with a fake fetch.
const okJson = (body, status = 200) => Promise.resolve({ ok: true, status, json: () => Promise.resolve(body) });

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('services/api.js', () => {
  it('sends credentials with every request and NO csrf header on GET', async () => {
    const fetchMock = vi.fn().mockReturnValue(okJson({ user: null }));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('secret-token');
    await getMe();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/me');
    expect(options.credentials).toBe('include');
    expect(options.headers['X-CSRF-Token']).toBeUndefined();
  });

  it('attaches the CSRF token and JSON body to POST requests', async () => {
    const fetchMock = vi.fn().mockReturnValue(okJson({ user: {} }, 201));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('secret-token');
    await registerAccount({ nickname: 'Ann', avatar: 'fox' });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers['X-CSRF-Token']).toBe('secret-token');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({ nickname: 'Ann', avatar: 'fox' });
  });

  it('handles empty 204 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: () => Promise.reject(new Error('no body')) }));
    await expect(logout()).resolves.toBeNull();
  });

  it('turns backend error JSON into an ApiError with its code and details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { code: 'VALIDATION_ERROR', message: 'bad', details: { field: 'nickname' } } }),
    }));
    const error = await getMe().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'bad', details: { field: 'nickname' } });
  });

  it('copes with an error response that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new Error('html')) }));
    const error = await getMe().catch((e) => e);
    expect(error).toMatchObject({ status: 502, code: 'UNKNOWN_ERROR' });
  });

  it('reports network failures as NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await getMe().catch((e) => e);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});
