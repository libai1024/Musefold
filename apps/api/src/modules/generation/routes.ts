import {
  MAX_REFERENCE_IMAGE_BYTES,
  releaseReferenceImageInputSchema,
  createGenerationInputSchema,
  generationCleanupInputSchema,
  generationCleanupResultSchema,
  generationHistoryPageSchema,
  generationHistoryQuerySchema,
  generationJobSchema,
  generationExecutionReceiptSchema,
  generationReceiptQuerySchema,
  retryGenerationInputSchema,
  providerOptionSchema,
} from '@musefold/contracts';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import { type GenerationService, PROVIDER_MODEL } from './service.js';
import { CLOUD_GENERATION_PROVIDER_ID } from '@musefold/domain/cloud-generation-policy';

const idParams = z.object({ id: z.string().trim().min(1).max(64) });
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'rejected', 'expired']);
const REFERENCE_UPLOAD_BODY_BYTES = MAX_REFERENCE_IMAGE_BYTES + 1024 * 1024;

const limitReferenceUploadBody: MiddlewareHandler = async (c, next) => {
  const headers = new Headers(c.req.raw.headers);
  headers.delete('content-length');
  c.req.raw = new Request(c.req.raw, {
    body: c.req.raw.body,
    duplex: 'half',
    headers,
  });
  return bodyLimit({
    maxSize: REFERENCE_UPLOAD_BODY_BYTES,
    onError: () => {
      throw new AppError('VALIDATION_FAILED', '图片不能超过 20 MiB', 413);
    },
  })(c, next);
};

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
      method: 'get',
      path: '/generations/receipts/by-key',
      tags,
      query: generationReceiptQuerySchema,
      response: generationExecutionReceiptSchema,
    },
    async (c, input) => c.json(await service.getReceipt(c.get('userId'), input.query.key)),
  );

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
      return c.json(
        await service.create(c.get('userId'), input.body, idempotencyKey, c.get('sessionId')),
        201,
      );
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

  // Provider 目录:云端当前只有服务端固定模型;桌面宿主由本地 AI 连接实现同名接口。
  route(
    app,
    {
      method: 'get',
      path: '/generations/providers',
      tags,
      response: z.array(providerOptionSchema),
    },
    async (c) =>
      c.json([
        {
          id: CLOUD_GENERATION_PROVIDER_ID,
          label: 'Musefold 云生图',
          model: PROVIDER_MODEL,
          kind: 'cloud' as const,
          available: true,
        },
      ]),
  );

  // 批量清理(ui-parity 05 §7):声明在 /generations/{id} 之前,避免 cleanup 被吃成 id。
  route(
    app,
    {
      method: 'post',
      path: '/generations/cleanup',
      tags,
      body: generationCleanupInputSchema,
      response: generationCleanupResultSchema,
    },
    async (c, input) => c.json(await service.cleanup(c.get('userId'), input.body)),
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
      body: retryGenerationInputSchema.default({}),
      status: 201,
      response: generationJobSchema,
    },
    async (c, input) => {
      const idempotencyKey = requireIdempotencyKey(c.req.header('idempotency-key'));
      return c.json(
        await service.retry(
          c.get('userId'),
          input.params.id,
          idempotencyKey,
          c.get('sessionId'),
          input.body,
        ),
        201,
      );
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

  route(
    app,
    {
      method: 'post',
      path: '/generations/{id}/purge',
      tags,
      params: idParams,
      response: z.object({ ok: z.literal(true) }),
    },
    async (c, input) => {
      await service.purge(c.get('userId'), input.params.id);
      return c.json({ ok: true as const });
    },
  );

  app.get('/assets/:id/url', async (c) => {
    const id = idParams.parse({ id: c.req.param('id') }).id;
    const signed = await service.assetSignedUrl(c.get('userId'), id);
    return c.redirect(signed.url, 302);
  });

  app.get('/assets/:id/content', async (c) => {
    c.header('cache-control', 'no-store');
    c.header('x-content-type-options', 'nosniff');
    const params = idParams.safeParse({ id: c.req.param('id') });
    if (!params.success || new URL(c.req.url).search)
      throw new AppError('VALIDATION_FAILED', '资产下载仅接受有效的资产标识');
    const id = params.data.id;
    const content = await service.assetContent(c.get('userId'), id, c.req.raw.signal);
    const extension =
      content.mimeType === 'image/jpeg' ? 'jpg' : content.mimeType.slice('image/'.length);
    c.header('content-type', content.mimeType);
    c.header('content-disposition', `attachment; filename="musefold-image.${extension}"`);
    c.header('content-length', String(content.bytes.byteLength));
    return c.body(new Uint8Array(content.bytes));
  });

  // 参考图上传(multipart,字段 file):魔数与尺寸在 service 校验,返回可随 create 提交的引用。
  app.post('/reference-images', limitReferenceUploadBody, async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', '缺少图片文件(multipart 字段 file)');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await service.uploadReferenceImage(c.get('userId'), {
      name: file.name || 'reference.png',
      bytes,
    });
    return c.json(uploaded, 201);
  });

  app.delete('/reference-images/:id', async (c) => {
    const parsed = releaseReferenceImageInputSchema.safeParse({ id: c.req.param('id') });
    if (!parsed.success || new URL(c.req.url).search)
      throw new AppError('VALIDATION_FAILED', '参考图释放仅接受有效标识');
    await service.releaseReferenceImage(c.get('userId'), parsed.data);
    c.header('cache-control', 'no-store');
    return c.body(null, 204);
  });

  // 与 /assets/:id/url 同款 302:cookie 鉴权下 <img src> 直接可用。
  app.get('/reference-images/:id/url', async (c) => {
    const id = idParams.parse({ id: c.req.param('id') }).id;
    const signed = await service.referenceImageSignedUrl(c.get('userId'), id);
    return c.redirect(signed.url, 302);
  });

  return app;
}
