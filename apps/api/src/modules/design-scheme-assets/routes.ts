import {
  MAX_DESIGN_SCHEME_UPLOAD_BYTES,
  stagedDesignSchemeAssetSchema,
} from '@musefold/contracts/design-scheme-assets';
import { opaqueIdSchema } from '@musefold/contracts';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import type { DesignSchemeAssetService } from './service.js';

const limitUpload: MiddlewareHandler = async (c, next) => {
  const headers = new Headers(c.req.raw.headers);
  headers.delete('content-length');
  c.req.raw = new Request(c.req.raw, { body: c.req.raw.body, duplex: 'half', headers });
  return bodyLimit({
    maxSize: MAX_DESIGN_SCHEME_UPLOAD_BYTES + 1024 * 1024,
    onError: () => {
      throw new AppError('VALIDATION_FAILED', '图片不能超过 20 MiB', 413);
    },
  })(c, next);
};

/** Mounted only beneath the authenticated API router. */
export function designSchemeAssetRoutes(service: DesignSchemeAssetService) {
  const app = createAuthedRouter();
  app.post('/design-schemes/assets', limitUpload, async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (
      !form ||
      !(file instanceof File) ||
      [...form.keys()].some((key) => key !== 'file') ||
      form.getAll('file').length !== 1
    ) {
      throw new AppError('VALIDATION_FAILED', '请上传一个方案参考图片文件');
    }
    return c.json(
      await service.stage(c.get('userId'), {
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }),
      201,
    );
  });
  route(
    app,
    {
      method: 'get',
      path: '/design-schemes/assets/{id}',
      tags: ['design-schemes'],
      params: z.object({ id: opaqueIdSchema }).strict(),
      response: stagedDesignSchemeAssetSchema,
    },
    async (c, input) => c.json(await service.getStage(c.get('userId'), input.params.id)),
  );
  app.get('/design-schemes/assets/:id/content', async (c) => {
    const parsed = opaqueIdSchema.safeParse(c.req.param('id'));
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', '图片标识无效');
    const result = await service.content(c.get('userId'), parsed.data);
    return new Response(new Uint8Array(result.bytes), {
      headers: {
        'content-type': result.mimeType,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      },
    });
  });
  app.delete('/design-schemes/assets/:id', async (c) => {
    const parsed = opaqueIdSchema.safeParse(c.req.param('id'));
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', '图片标识无效');
    await service.discard(c.get('userId'), parsed.data);
    return c.body(null, 204);
  });
  return app;
}
