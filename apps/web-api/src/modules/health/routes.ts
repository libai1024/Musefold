import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ReadinessProbe } from '../../database/runtime.js';

const liveResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('musefold-web-api'),
  version: z.string(),
});

const readyResponseSchema = z.object({
  status: z.enum(['ready', 'unavailable']),
  checks: z.object({
    database: z.object({
      ok: z.boolean(),
      latencyMs: z.number().int().nonnegative(),
      detail: z.string().optional(),
    }),
  }),
});

interface HealthRoutesOptions {
  readinessProbe: ReadinessProbe;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (
  app,
  options,
) => {
  app.get(
    '/health/live',
    {
      schema: {
        tags: ['health'],
        response: { 200: liveResponseSchema },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: 'musefold-web-api' as const,
      version: '1.1.0-dev',
    }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        response: {
          200: readyResponseSchema,
          503: readyResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const database = await options.readinessProbe.check();
      const payload = {
        status: database.ok ? ('ready' as const) : ('unavailable' as const),
        checks: { database },
      };
      return database.ok ? payload : reply.code(503).send(payload);
    },
  );
};
