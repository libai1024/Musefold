import { OpenAPIHono } from '@hono/zod-openapi';
import { expect, it, vi } from 'vitest';
import type { AuthedEnv } from '../../../auth/middleware.js';
import { AppError, toErrorBody } from '../../../lib/errors.js';
import { designSchemePackageRoutes } from '../routes.js';
import type { DesignSchemePackageService } from '../service.js';

it('keeps recovery read-only and uncached, and rejects unbounded or owner-injected queries before reading', async () => {
  const page = { items: [], nextCursor: null };
  const service = {
    listRecovery: vi.fn(async () => page),
    recovery: vi.fn(async () => {
      throw new AppError('VALIDATION_FAILED', '方案包不存在', 404);
    }),
    begin: vi.fn(),
    cancel: vi.fn(),
    decide: vi.fn(),
    upload: vi.fn(),
  };
  const app = new OpenAPIHono<AuthedEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', 'normal-owner');
    c.set('sessionId', 'normal-session');
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof AppError)
      return c.json(toErrorBody(error, 'test-request'), error.status as 400);
    throw error;
  });
  app.route('/', designSchemePackageRoutes(service as unknown as DesignSchemePackageService));
  const response = await app.request('/design-schemes/packages');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(page);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(service.listRecovery).toHaveBeenCalledWith('normal-owner', 'normal-session', {
    limit: 20,
  });
  for (const query of ['limit=0', 'limit=51', 'cursor=../other', 'userId=other'])
    expect((await app.request(`/design-schemes/packages?${query}`)).status).toBe(400);
  expect(service.listRecovery).toHaveBeenCalledOnce();
  const missing = await app.request('/design-schemes/packages/stage_1/recovery');
  expect(missing.status).toBe(404);
  expect(missing.headers.get('cache-control')).toBe('private, no-store');
  for (const mutation of [service.begin, service.cancel, service.decide, service.upload])
    expect(mutation).not.toHaveBeenCalled();
});
