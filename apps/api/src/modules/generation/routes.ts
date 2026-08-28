import {
  createGenerationInputSchema,
  generationHistoryPageSchema,
  generationHistoryQuerySchema,
  generationJobSchema,
} from '@musefold/contracts';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import type { GenerationService } from './service.js';

const idParams = z.object({ id: z.string().trim().min(1).max(64) });
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'rejected', 'expired']);

function requireIdempotencyKey(header: string | undefined): string {
  if (!header || !/^[\x20-\x7e]{8,128}$/.test(header)) {
    throw new AppError('VALIDATION_FAILED', 'Idempotency-Key 请求头缺失或无效');
  }
  return header;
}

export function generationRoutes(service: GenerationService) {
  const app = createAuthedRouter();
  const tags = ['generation'];

  route(
    app,
    {
      method: 'post',
      path: '/generations',
      tags,
      body: createGenerationInputSchema,
      status: 201,
      response: generationJobSchema,
    },
    async (c, input) => {
      const idempotencyKey = requireIdempotencyKey(c.req.header('idempotency-key'));
      return c.json(await service.create(c.get('userId'), input.body, idempotencyKey), 201);
    },
  );

  route(
    app,
    {
      method: 'get',
      path: '/generations',
      tags,
      query: generationHistoryQuerySchema,
      response: generationHistoryPageSchema,
    },
    async (c, input) => c.json(await service.history(c.get('userId'), input.query)),
  );

  route(
    app,
    {
      method: 'get',
      path: '/generations/{id}',
      tags,
      params: idParams,
      response: generationJobSchema,
    },
    async (c, input) => c.json(await service.get(c.get('userId'), input.params.id)),
  );

  // SSE 事件流:轮询 generation_events,终态或约 25 秒后收尾,客户端可用 Last-Event-ID 续传。
  app.get('/generations/:id/events', async (c) => {
    const id = idParams.parse({ id: c.req.param('id') }).id;
    const userId = c.get('userId');
    const queryAfter = z.coerce.number().int().nonnegative().default(0).parse(c.req.query('after'));
    const lastEventId = c.req.header('last-event-id');
    const headerAfter =
      lastEventId && /^\d+$/.test(lastEventId) ? Number.parseInt(lastEventId, 10) : 0;
    let cursor = Math.max(queryAfter, Number.isSafeInteger(headerAfter) ? headerAfter : 0);
    return streamSSE(c, async (stream) => {
      for (let attempt = 0; attempt < 25 && !stream.aborted; attempt += 1) {
        const events = await service.events(userId, id, cursor);
        for (const event of events) {
          cursor = event.seq;
          await stream.writeSSE({
            id: String(event.seq),
            event: event.type,
            data: JSON.stringify(event.payload),
          });
        }
        const current = await service.get(userId, id);
        if (TERMINAL.has(current.status)) break;
        await stream.write(': keep-alive\n\n');
        await stream.sleep(1_000);
      }
    });
  });

  route(
    app,
    {
      method: 'post',
      path: '/generations/{id}/cancel',
      tags,
      params: idParams,
      response: generationJobSchema,
    },
    async (c, input) => c.json(await service.cancel(c.get('userId'), input.params.id)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/generations/{id}/retry',
      tags,
      params: idParams,
      status: 201,
      response: generationJobSchema,
    },
    async (c, input) => {
      const idempotencyKey = requireIdempotencyKey(c.req.header('idempotency-key'));
      return c.json(await service.retry(c.get('userId'), input.params.id, idempotencyKey), 201);
    },
  );

  route(
    app,
    {
      method: 'delete',
      path: '/generations/{id}',
      tags,
      params: idParams,
      response: generationJobSchema,
    },
    async (c, input) => c.json(await service.remove(c.get('userId'), input.params.id)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/generations/{id}/restore',
      tags,
      params: idParams,
      response: generationJobSchema,
    },
    async (c, input) => c.json(await service.restore(c.get('userId'), input.params.id)),
  );

  app.get('/assets/:id/url', async (c) => {
    const id = idParams.parse({ id: c.req.param('id') }).id;
    const signed = await service.assetSignedUrl(c.get('userId'), id);
    return c.redirect(signed.url, 302);
  });

  return app;
}
