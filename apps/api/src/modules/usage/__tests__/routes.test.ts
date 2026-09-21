import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import type { AuthedEnv } from '../../../auth/middleware.js';
import { AppError, toErrorBody } from '../../../lib/errors.js';
import { usageRoutes } from '../routes.js';
import type { UsageService } from '../service.js';

const SUMMARY = {
  range: '30d' as const,
  from: '2026-08-08T12:00:00.000+00:00',
  to: '2026-09-06T12:00:00.000+00:00',
  generationCount: 2,
  succeededCount: 1,
  failedCount: 1,
  cancelledCount: 0,
  imageCount: 1,
  costPoints: 4,
  successRate: 0.5,
  byProvider: [
    {
      providerId: null,
      label: 'musefold-image-pro',
      generationCount: 2,
      costPoints: 4,
    },
  ],
  byDay: [
    {
      date: '2026-09-06',
      generationCount: 2,
      succeededCount: 1,
      failedCount: 1,
      cancelledCount: 0,
      costPoints: 4,
      successRate: 0.5,
    },
  ],
  byModel: [{ model: 'musefold-image-pro', generationCount: 2, costPoints: 4 }],
};

function testApp(service: UsageService) {
  const app = new OpenAPIHono<AuthedEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', 'usage-routes-user');
    c.set('sessionId', 'usage-routes-session');
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(toErrorBody(error, 'usage-routes-request'), error.status as 400);
    }
    throw error;
  });
  app.route('/', usageRoutes(service));
  return app;
}

describe('usage summary route', () => {
  it('passes the owner and range to the service', async () => {
    const summary = vi.fn().mockResolvedValue(SUMMARY);
    const app = testApp({ summary } as unknown as UsageService);

    const response = await app.request('http://localhost/usage/summary?range=7d');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(SUMMARY);
    expect(summary).toHaveBeenCalledWith('usage-routes-user', '7d');
  });

  it('rejects an unknown range before touching the service', async () => {
    const summary = vi.fn();
    const app = testApp({ summary } as unknown as UsageService);

    const response = await app.request('http://localhost/usage/summary?range=all');
    expect(response.status).toBe(400);
    expect(summary).not.toHaveBeenCalled();
  });

  it('requires a range query', async () => {
    const summary = vi.fn();
    const app = testApp({ summary } as unknown as UsageService);

    const response = await app.request('http://localhost/usage/summary');
    expect(response.status).toBe(400);
    expect(summary).not.toHaveBeenCalled();
  });
});
