// Shared test helpers.
import { loadConfig } from '../config/env.js';

export const testEnv = {
  NODE_ENV: 'test',
  PORT: '4000',
  CLIENT_ORIGIN: 'http://localhost:5173',
  DB_HOST: 'localhost',
  DB_PORT: '3306',
  DB_USER: 'tester',
  DB_PASSWORD: 'secret',
  DB_NAME: 'flip7_online',
  SESSION_SECRET: 'test_secret_that_is_definitely_longer_than_32_chars',
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:5173/api/auth/google/callback',
  AUTH_RATE_LIMIT_MAX: '1000', // effectively off, except in the rate-limit test
};

export const makeConfig = (overrides = {}) => loadConfig({ ...testEnv, ...overrides });

// A silent logger so expected errors do not clutter test output.
export const silentLogger = { error() {}, warn() {}, info() {}, log() {} };
