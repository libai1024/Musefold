import { afterEach, describe, expect, it } from 'vitest';
import { buildWebApi } from '../app.js';
import { webApiConfigSchema } from '../config.js';
import type { ReadinessProbe } from '../database/runtime.js';
import { AppError } from '../errors.js';

const apps: Awaited<ReturnType<typeof buildWebApi>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function config() {
  return webApiConfigSchema.parse({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    OPENAPI_ENABLED: 'false',
  });
}

async function appWith(probe: ReadinessProbe) {
  const app = await buildWebApi({ config: config(), readinessProbe: probe });
  apps.push(app);
  return app;
}

describe('Web API foundation', () => {
  it('provides a dependency-free liveness endpoint', async () => {
    const app = await appWith({
      check: async () => ({ ok: true, latencyMs: 1 }),
    });
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'musefold-web-api',
    });
  });

  it('reports readiness from PostgreSQL without turning it into liveness', async () => {
    const app = await appWith({
      check: async () => ({
        ok: false,
        latencyMs: 4,
        detail: 'database unavailable',
      }),
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      checks: {
        database: { ok: false, latencyMs: 4, detail: 'database unavailable' },
      },
    });
  });

  it('returns the shared error envelope for unknown routes', async () => {
    const app = await appWith({
      check: async () => ({ ok: true, latencyMs: 1 }),
    });
    const response = await app.inject({ method: 'GET', url: '/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', retryable: false, details: {} },
    });
    expect(response.json().error.requestId).toBeTypeOf('string');
  });

  it('returns Retry-After with the shared rate-limit envelope', async () => {
    const app = await appWith({
      check: async () => ({ ok: true, latencyMs: 1 }),
    });
    app.get('/test/rate-limit', async () => {
      throw new AppError('RATE_LIMITED', '稍后重试', 429, true, {
        retryAfterSeconds: 7.2,
      });
    });
    const response = await app.inject({
      method: 'GET',
      url: '/test/rate-limit',
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('8');
    expect(response.json()).toMatchObject({
      error: {
        code: 'RATE_LIMITED',
        retryable: true,
        details: { retryAfterSeconds: 7.2 },
      },
    });
  });

  it('only trusts explicitly named reverse proxies', () => {
    expect(
      webApiConfigSchema.parse({ TRUST_PROXY: 'loopback' }).TRUST_PROXY,
    ).toBe('loopback');
    expect(webApiConfigSchema.parse({ TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(
      false,
    );
    expect(webApiConfigSchema.safeParse({ TRUST_PROXY: 'true' }).success).toBe(
      false,
    );
    expect(webApiConfigSchema.safeParse({ TRUST_PROXY: '*' }).success).toBe(
      false,
    );
  });
});
