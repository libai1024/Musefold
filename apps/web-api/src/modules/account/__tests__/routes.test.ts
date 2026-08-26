import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountRoutes } from '../routes.js';

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('account HTTP boundary', () => {
  it('accepts registration as username and password only', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(cookie);

    const accountService = {
      register: vi.fn().mockResolvedValue({
        rawSessionId: 'opaque-session',
        csrfToken: 'csrf-token-000000000000000000000000',
        account: {
          id: '7',
          username: 'musefold',
          displayName: null,
          quota: 9_000,
          quotaUnit: '点',
          canGenerate: true,
        },
      }),
    };
    await app.register(accountRoutes, {
      accountService: accountService as never,
      config: {
        NODE_ENV: 'test',
        SESSION_COOKIE_NAME: 'musefold_session',
        SESSION_ABSOLUTE_TTL_SECONDS: 86_400,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/musefold/v1/auth/register',
      payload: {
        username: 'musefold',
        password: 'secret-password',
        displayName: 'not persisted',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(accountService.register).toHaveBeenCalledWith({
      username: 'musefold',
      password: 'secret-password',
    });
    expect(response.json()).not.toHaveProperty('rawSessionId');
  });
});
