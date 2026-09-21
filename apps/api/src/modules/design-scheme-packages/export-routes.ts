import { z } from 'zod';
import { bodyLimit } from 'hono/body-limit';
import {
  beginDesignSchemePackageExportSchema,
  designSchemePackageExportSchema,
  opaqueIdSchema,
  designSchemePackageExportHistoryQuerySchema,
  designSchemePackageExportHistorySchema,
  designSchemePackageExportRecoverySchema,
} from '@musefold/contracts';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import { AppError } from '../../lib/errors.js';
import type { DesignSchemePackageExportService } from './export-service.js';

export function designSchemePackageExportRoutes(service: DesignSchemePackageExportService) {
  const app = createAuthedRouter();
  const path = '/design-schemes/package-exports';
  const tags = ['design-schemes'];
  const params = z.object({ id: opaqueIdSchema }).strict();
  app.use(path, async (c, next) => {
    if (c.req.method !== 'POST') return next();
    const headers = new Headers(c.req.raw.headers);
    headers.delete('content-length');
    c.req.raw = new Request(c.req.raw, { body: c.req.raw.body, duplex: 'half', headers });
    return bodyLimit({
      maxSize: 8192,
      onError: () => {
        throw new AppError('VALIDATION_FAILED', '导出请求过大', 413);
      },
    })(c, next);
  });
  app.use(`${path}/*`, async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    await next();
  });
  route(
    app,
    {
      method: 'get',
      path,
      tags,
      query: designSchemePackageExportHistoryQuerySchema,
      response: designSchemePackageExportHistorySchema,
    },
    async (c, input) => {
      c.header('Cache-Control', 'private, no-store');
      return c.json(await service.listRecovery(c.get('userId'), c.get('sessionId'), input.query));
    },
  );
  route(
    app,
    {
      method: 'get',
      path: `${path}/{id}/recovery`,
      tags,
      params,
      response: designSchemePackageExportRecoverySchema,
    },
    async (c, input) =>
      c.json(await service.recovery(c.get('userId'), c.get('sessionId'), input.params.id)),
  );
  route(
    app,
    {
      method: 'post',
      path,
      tags,
      body: beginDesignSchemePackageExportSchema,
      response: designSchemePackageExportSchema,
    },
    async (c, input) =>
      c.json(
        await service.begin(c.get('userId'), c.get('sessionId'), input.body, c.req.raw.signal),
      ),
  );
  route(
    app,
    {
      method: 'get',
      path: `${path}/{id}`,
      tags,
      params,
      response: designSchemePackageExportSchema,
    },
    async (c, input) =>
      c.json(await service.get(c.get('userId'), c.get('sessionId'), input.params.id)),
  );
  route(
    app,
    {
      method: 'delete',
      path: `${path}/{id}`,
      tags,
      params,
      response: designSchemePackageExportSchema,
    },
    async (c, input) =>
      c.json(await service.cancel(c.get('userId'), c.get('sessionId'), input.params.id)),
  );
  app.get(`${path}/:id/content`, async (c) => {
    const id = opaqueIdSchema.safeParse(c.req.param('id'));
    if (!id.success) throw new AppError('VALIDATION_FAILED', '导出请求无效', 400);
    const result = await service.content(
      c.get('userId'),
      c.get('sessionId'),
      id.data,
      c.req.raw.signal,
    );
    // Hono dispatches HEAD through GET then discards the body without consuming it.
    const head = c.req.method === 'HEAD';
    if (head) await result.body.cancel();
    return new Response(head ? null : result.body, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(result.sizeBytes),
        'content-disposition': `attachment; filename="${result.filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'x-musefold-package-sha256': result.packageHash,
      },
    });
  });
  app.openAPIRegistry.registerPath({
    method: 'get',
    path: `${path}/{id}/content`,
    tags,
    request: { params },
    responses: {
      200: {
        description: 'Owned validated package bytes; host still performs delivery',
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      },
    },
  });
  return app;
}
