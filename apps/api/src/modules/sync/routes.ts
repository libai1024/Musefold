import {
  syncBootstrapPageSchema,
  syncBootstrapQuerySchema,
  syncDeviceRegistrationSchema,
  syncDeviceSchema,
  syncPullQuerySchema,
  syncPullResultSchema,
  syncPushRequestSchema,
  syncPushResultSchema,
  syncStatusSchema,
  syncUsagePushRequestSchema,
  syncUsagePushResultSchema,
} from '@musefold/contracts';
import { z } from 'zod';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import { RATE_LIMIT_POLICIES, type RateLimiter } from '../rate-limit/service.js';
import type { SyncService } from './service.js';

const statusQuery = z.object({ deviceId: z.string().uuid() });

export function syncRoutes(service: SyncService, rateLimiter: RateLimiter) {
  const app = createAuthedRouter();
  const tags = ['sync'];

  app.use('*', async (c, next) => {
    await rateLimiter.assertAllowed('prompt-sync', c.get('userId'), RATE_LIMIT_POLICIES.promptSync);
    await next();
  });

  route(
    app,
    {
      method: 'post',
      path: '/sync/devices',
      tags,
      body: syncDeviceRegistrationSchema,
      status: 201,
      response: syncDeviceSchema,
    },
    async (c, input) => c.json(await service.registerDevice(c.get('userId'), input.body), 201),
  );

  route(
    app,
    {
      method: 'get',
      path: '/sync/bootstrap',
      tags,
      query: syncBootstrapQuerySchema,
      response: syncBootstrapPageSchema,
    },
    async (c, input) =>
      c.json(
        await service.bootstrap(
          c.get('userId'),
          input.query.entity,
          input.query.after,
          input.query.limit,
        ),
      ),
  );

  route(
    app,
    {
      method: 'get',
      path: '/sync/pull',
      tags,
      query: syncPullQuerySchema,
      response: syncPullResultSchema,
    },
    async (c, input) =>
      c.json(
        await service.pull(
          c.get('userId'),
          input.query.cursor,
          input.query.limit,
          input.query.deviceId,
        ),
      ),
  );

  route(
    app,
    {
      method: 'post',
      path: '/sync/push',
      tags,
      body: syncPushRequestSchema,
      response: syncPushResultSchema,
    },
    async (c, input) =>
      c.json(await service.push(c.get('userId'), input.body.deviceId, input.body.mutations)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/sync/usage',
      tags,
      body: syncUsagePushRequestSchema,
      response: syncUsagePushResultSchema,
    },
    async (c, input) =>
      c.json(await service.pushUsage(c.get('userId'), input.body.deviceId, input.body.events)),
  );

  route(
    app,
    {
      method: 'get',
      path: '/sync/status',
      tags,
      query: statusQuery,
      response: syncStatusSchema,
    },
    async (c, input) => c.json(await service.status(c.get('userId'), input.query.deviceId)),
  );

  return app;
}
