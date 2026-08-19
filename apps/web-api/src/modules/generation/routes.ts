import {
  cloudGenerationRequestSchema,
  createGenerationInputSchema,
  generationHistoryQuerySchema,
} from '@musefold/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SessionStorePort } from '../account/session-store.js';
import type { GenerationEventWaiter } from '../../database/runtime.js';
import {
  requireMusefoldCsrf,
  requireMusefoldSession,
} from '../auth/request-auth.js';
import type { GenerationServicePort } from './service.js';

interface GenerationRoutesOptions {
  service: GenerationServicePort;
  sessions: SessionStorePort;
  cookieName: string;
  events?: GenerationEventWaiter;
}

const idParams = z.object({ id: z.string().trim().min(1).max(64) });
const idempotencyHeaders = z
  .object({ 'idempotency-key': z.string().trim().min(8).max(128) })
  .passthrough();

export const generationRoutes: FastifyPluginAsync<
  GenerationRoutesOptions
> = async (app, options) => {
  const auth = requireMusefoldSession(options.sessions, options.cookieName);
  const csrfAuth = [auth, requireMusefoldCsrf];

  app.post(
    '/api/musefold/v1/generations',
    {
      preHandler: csrfAuth,
      schema: {
        tags: ['generation'],
        headers: idempotencyHeaders,
        body: createGenerationInputSchema,
      },
    },
    async (request, reply) => {
      const headers = idempotencyHeaders.parse(request.headers);
      const result = await options.service.create(
        request.musefoldPrincipal.ownerId,
        createGenerationInputSchema.parse(request.body),
        headers['idempotency-key'],
      );
      return reply.code(202).send(result);
    },
  );

  app.get(
    '/api/musefold/v1/generations',
    {
      preHandler: auth,
      schema: {
        tags: ['generation'],
        querystring: generationHistoryQuerySchema,
      },
    },
    async (request) => {
      return options.service.history(
        request.musefoldPrincipal.ownerId,
        generationHistoryQuerySchema.parse(request.query),
      );
    },
  );

  app.get(
    '/api/musefold/v1/generations/:id',
    { preHandler: auth, schema: { tags: ['generation'], params: idParams } },
    async (request) => {
      return options.service.get(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
      );
    },
  );

  app.get(
    '/api/musefold/v1/generations/:id/events',
    {
      preHandler: auth,
      schema: {
        tags: ['generation'],
        params: idParams,
        querystring: z.object({
          after: z.coerce.number().int().nonnegative().default(0),
        }),
      },
    },
    async (request, reply) => {
      const id = idParams.parse(request.params).id;
      const requestedAfter = z
        .object({ after: z.coerce.number().int().nonnegative().default(0) })
        .parse(request.query).after;
      const lastEventId = request.headers['last-event-id'];
      const headerAfter =
        typeof lastEventId === 'string' && /^\d+$/.test(lastEventId)
          ? Number(lastEventId)
          : 0;
      const after = Math.max(
        requestedAfter,
        Number.isSafeInteger(headerAfter) ? headerAfter : 0,
      );
      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      let cursor = after;
      for (let attempt = 0; attempt < 25 && !response.destroyed; attempt += 1) {
        const events = await options.service.events(
          request.musefoldPrincipal.ownerId,
          id,
          cursor,
        );
        for (const event of events) {
          cursor = event.seq;
          response.write(
            `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`,
          );
        }
        const current = await options.service.get(
          request.musefoldPrincipal.ownerId,
          id,
        );
        if (
          ['succeeded', 'failed', 'cancelled', 'rejected', 'expired'].includes(
            current.status,
          )
        )
          break;
        response.write(': keep-alive\n\n');
        if (options.events) {
          await options.events.wait(
            request.musefoldPrincipal.ownerId,
            id,
            cursor,
            1_000,
          );
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      }
      if (!response.destroyed) response.end();
    },
  );

  app.post(
    '/api/musefold/v1/generations/:id/cancel',
    {
      preHandler: csrfAuth,
      schema: { tags: ['generation'], params: idParams },
    },
    async (request) => {
      return options.service.cancel(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
      );
    },
  );

  app.post(
    '/api/musefold/v1/generations/:id/retry',
    {
      preHandler: csrfAuth,
      schema: {
        tags: ['generation'],
        params: idParams,
        headers: idempotencyHeaders,
      },
    },
    async (request, reply) => {
      const headers = idempotencyHeaders.parse(request.headers);
      const result = await options.service.retry(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
        headers['idempotency-key'],
      );
      return reply.code(202).send(result);
    },
  );

  app.delete(
    '/api/musefold/v1/generations/:id',
    {
      preHandler: csrfAuth,
      schema: { tags: ['generation'], params: idParams },
    },
    async (request) => {
      return options.service.remove(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
      );
    },
  );

  app.post(
    '/api/musefold/v1/generations/:id/restore',
    {
      preHandler: csrfAuth,
      schema: { tags: ['generation'], params: idParams },
    },
    async (request) => {
      return options.service.restore(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
      );
    },
  );

  app.post(
    '/api/musefold/v1/approvals/:id',
    {
      preHandler: csrfAuth,
      schema: {
        tags: ['generation'],
        params: idParams,
        body: z.object({ token: z.string().min(16).max(256) }),
      },
    },
    async (request) => {
      const params = idParams.parse(request.params);
      const body = z
        .object({ token: z.string().min(16).max(256) })
        .parse(request.body);
      return options.service.approveCloud(
        request.musefoldPrincipal.ownerId,
        params.id,
        body.token,
      );
    },
  );

  app.get(
    '/api/musefold/v1/assets/:id/url',
    { preHandler: auth, schema: { tags: ['generation'], params: idParams } },
    async (request, reply) => {
      const url = await options.service.assetRedirectUrl(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
      );
      return reply.redirect(url, 302);
    },
  );
};
