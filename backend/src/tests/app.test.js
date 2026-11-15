import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../app.js';
import { createErrorHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { loadConfig } from '../config/env.js';
import { testEnv, silentLogger } from './helpers.js';

const config = loadConfig(testEnv);

function buildApp(pool = { query: vi.fn().mockResolvedValue([[{ 1: 1 }]]) }) {
  return createApp({ config, pool, logger: silentLogger });
}

describe('health endpoints', () => {
  it('GET /api/health reports the server is up', async () => {
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/health/db reports the database is up', async () => {
    const res = await request(buildApp()).get('/api/health/db');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('GET /api/health/db returns 503 when the database fails, without leaking details', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:3306')) };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(buildApp(pool)).get('/api/health/db');
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
  });
});

describe('security headers and CORS', () => {
  it('sends Helmet headers and hides x-powered-by', async () => {
    const res = await request(buildApp()).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows the configured frontend origin with credentials', async () => {
    const res = await request(buildApp()).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not grant CORS access to other origins', async () => {
    const res = await request(buildApp()).get('/api/health').set('Origin', 'http://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('error handling', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(buildApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 INVALID_JSON for a malformed body', async () => {
    const res = await request(buildApp())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 for an oversized body', async () => {
    const res = await request(buildApp())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ filler: 'x'.repeat(20_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('formats AppError with its status, code and message', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new AppError(409, 'ROOM_FULL', 'This room is full.');
    });
    app.use(createErrorHandler({ logger: silentLogger }));
    const res = await request(app).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'ROOM_FULL', message: 'This room is full.' } });
  });

  it('hides unexpected error details behind a generic 500', async () => {
    const app = express();
    app.get('/bug', () => {
      throw new Error('SELECT * FROM Users failed: password=hunter2');
    });
    app.use(createErrorHandler({ logger: silentLogger }));
    const res = await request(app).get('/bug');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});
