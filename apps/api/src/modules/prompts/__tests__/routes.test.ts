import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import type { AuthedEnv } from '../../../auth/middleware.js';
import { promptRoutes } from '../routes.js';
import type { PromptService } from '../service.js';

function testApp(service: PromptService) {
  const app = new OpenAPIHono<AuthedEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', 'prompt-routes-user');
    c.set('sessionId', 'prompt-routes-session');
    await next();
  });
  app.route('/', promptRoutes(service));
  return app;
}

describe('prompt route query parsing', () => {
  it.each([
    ['false', false],
    ['true', true],
  ])('parses includeDeleted=%s as %s', async (wireValue, expected) => {
    const listFolders = vi.fn(async () => []);
    const app = testApp({ listFolders } as unknown as PromptService);

    const response = await app.request(`/folders?includeDeleted=${wireValue}`);

    expect(response.status).toBe(200);
    expect(listFolders).toHaveBeenCalledWith('prompt-routes-user', expected);
  });
});
