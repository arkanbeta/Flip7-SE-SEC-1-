import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config/env.js';
import { testEnv } from './helpers.js';

describe('loadConfig', () => {
  it('parses a complete environment', () => {
    const config = loadConfig(testEnv);
    expect(config.port).toBe(4000);
    expect(config.clientOrigin).toBe('http://localhost:5173');
    expect(config.db).toMatchObject({ host: 'localhost', port: 3306, user: 'tester', database: 'flip7_online' });
    expect(config.isProduction).toBe(false);
  });

  it('applies defaults for optional values', () => {
    const { PORT, DB_PORT, ...rest } = testEnv;
    const config = loadConfig(rest);
    expect(config.port).toBe(4000);
    expect(config.db.port).toBe(3306);
    expect(config.db.connectionLimit).toBe(10);
  });

  it.each([
    'CLIENT_ORIGIN', 'DB_HOST', 'DB_USER', 'DB_NAME',
    'SESSION_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
  ])('throws when %s is missing', (name) => {
    const env = { ...testEnv };
    delete env[name];
    expect(() => loadConfig(env)).toThrow(name);
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadConfig({ ...testEnv, PORT: 'abc' })).toThrow('PORT');
  });

  it('rejects an invalid client origin', () => {
    expect(() => loadConfig({ ...testEnv, CLIENT_ORIGIN: 'not a url' })).toThrow('CLIENT_ORIGIN');
  });

  it('normalises the client origin (drops path and trailing slash)', () => {
    const config = loadConfig({ ...testEnv, CLIENT_ORIGIN: 'http://localhost:5173/' });
    expect(config.clientOrigin).toBe('http://localhost:5173');
  });

  it('detects production', () => {
    const production = {
      ...testEnv,
      NODE_ENV: 'production',
      CLIENT_ORIGIN: 'https://flip7.example',
      GOOGLE_REDIRECT_URI: 'https://flip7.example/api/auth/google/callback',
    };
    expect(loadConfig(production).isProduction).toBe(true);
  });

  describe('session and Google settings', () => {
    it('rejects a short session secret', () => {
      expect(() => loadConfig({ ...testEnv, SESSION_SECRET: 'too_short' })).toThrow('at least 32');
    });

    it('rejects the placeholder session secret from .env.example', () => {
      expect(() =>
        loadConfig({ ...testEnv, SESSION_SECRET: 'replace_with_at_least_32_random_characters' })
      ).toThrow('placeholder');
    });

    it('converts the session lifetime from hours to milliseconds', () => {
      expect(loadConfig({ ...testEnv, SESSION_MAX_AGE_HOURS: '2' }).session.maxAgeMs).toBe(2 * 3600 * 1000);
    });

    it('reads the Google OAuth settings', () => {
      const { google } = loadConfig(testEnv);
      expect(google.clientId).toBe(testEnv.GOOGLE_CLIENT_ID);
      expect(google.redirectUri).toBe(testEnv.GOOGLE_REDIRECT_URI);
    });

    it('allows plain http outside production', () => {
      expect(() => loadConfig(testEnv)).not.toThrow();
    });

    it('requires https for the client origin and redirect URI in production', () => {
      const prod = { ...testEnv, NODE_ENV: 'production' };
      expect(() => loadConfig(prod)).toThrow('CLIENT_ORIGIN must use https');
      expect(() =>
        loadConfig({ ...prod, CLIENT_ORIGIN: 'https://flip7.example' })
      ).toThrow('GOOGLE_REDIRECT_URI must use https');
      expect(() =>
        loadConfig({
          ...prod,
          CLIENT_ORIGIN: 'https://flip7.example',
          GOOGLE_REDIRECT_URI: 'https://flip7.example/api/auth/google/callback',
        })
      ).not.toThrow();
    });

    it('derives the lookup rate limit from the auth limit', () => {
      const { rateLimit } = loadConfig({ ...testEnv, AUTH_RATE_LIMIT_MAX: '10' });
      expect(rateLimit.authMax).toBe(10);
      expect(rateLimit.lookupMax).toBe(40);
    });

    it('reads TRUST_PROXY as a non-negative integer', () => {
      expect(loadConfig({ ...testEnv, TRUST_PROXY: '1' }).trustProxy).toBe(1);
      expect(loadConfig(testEnv).trustProxy).toBe(0);
      expect(() => loadConfig({ ...testEnv, TRUST_PROXY: '-1' })).toThrow('TRUST_PROXY');
    });
  });
});
