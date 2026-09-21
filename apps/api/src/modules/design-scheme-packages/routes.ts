import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  beginDesignSchemePackageUploadSchema,
  decideDesignSchemePackageStageSchema,
  designSchemePackageStageSchema,
  designSchemePackageRecoveryQuerySchema,
  designSchemePackageRecoverySchema,
  designSchemePackageRecoveryPageSchema,
  opaqueIdSchema,
} from '@musefold/contracts';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import { AppError } from '../../lib/errors.js';
import type { DesignSchemePackageService } from './service.js';

/** Raw binary upload avoids unbounded multipart/formData materialization. */
export function designSchemePackageRoutes(service: DesignSchemePackageService) {
  const app = createAuthedRouter();
  const limitJson: MiddlewareHandler = async (c, next) => {
    if (c.req.method !== 'POST') return next();
    const headers = new Headers(c.req.raw.headers);
    headers.delete('content-length');
    c.req.raw = new Request(c.req.raw, { body: c.req.raw.body, duplex: 'half', headers });
    return bodyLimit({
      maxSize: 8192,
      onError: () => {
        throw new AppError('VALIDATION_FAILED', '方案包请求过大', 413);
      },
    })(c, next);
  };
  app.use('/design-schemes/packages', limitJson);
  app.use('/design-schemes/packages/:id/decision', limitJson);
  const params = z.object({ id: opaqueIdSchema }).strict();
  const tags = ['design-schemes'];
  route(
    app,
    {
      method: 'get',
      path: '/design-schemes/packages',
      tags,
      query: designSchemePackageRecoveryQuerySchema,
      response: designSchemePackageRecoveryPageSchema,
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
      path: '/design-schemes/packages/{id}/recovery',
      tags,
      params,
      response: designSchemePackageRecoverySchema,
    },
    async (c, input) => {
      c.header('Cache-Control', 'private, no-store');
      return c.json(await service.recovery(c.get('userId'), c.get('sessionId'), input.params.id));
    },
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/packages',
      tags,
      body: beginDesignSchemePackageUploadSchema,
      response: designSchemePackageStageSchema,
    },
    async (c, input) =>
      c.json(await service.begin(c.get('userId'), c.get('sessionId'), input.body)),
  );
  route(
    app,
    {
      method: 'get',
      path: '/design-schemes/packages/{id}',
      tags,
      params,
      response: designSchemePackageStageSchema,
    },
    async (c, input) => c.json(await service.get(c.get('userId'), input.params.id)),
  );
  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/packages/{id}/decision',
      tags,
      params,
      body: decideDesignSchemePackageStageSchema,
      response: designSchemePackageStageSchema,
    },
    async (c, input) =>
      c.json(
        await service.decide(c.get('userId'), c.get('sessionId'), input.params.id, input.body),
      ),
  );
  route(
    app,
    {
      method: 'delete',
      path: '/design-schemes/packages/{id}',
      tags,
      params,
      response: designSchemePackageStageSchema,
    },
    async (c, input) =>
      c.json(await service.cancel(c.get('userId'), c.get('sessionId'), input.params.id)),
  );
  app.put('/design-schemes/packages/:id/content', async (c) => {
    const id = opaqueIdSchema.safeParse(c.req.param('id'));
    if (!id.success || c.req.header('content-type')?.split(';')[0] !== 'application/octet-stream')
      throw new AppError('VALIDATION_FAILED', '请上传二进制方案包', 400);
    return c.json(
      await service.upload(
        c.get('userId'),
        c.get('sessionId'),
        id.data,
        c.req.raw.body,
        c.req.raw.signal,
      ),
    );
  });
  app.openAPIRegistry.registerPath({
    method: 'put',
    path: '/design-schemes/packages/{id}/content',
    tags,
    request: {
      params,
      body: {
        required: true,
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      },
    },
    responses: {
      200: {
        description: 'Validated package ready for explicit review',
        content: { 'application/json': { schema: designSchemePackageStageSchema } },
      },
    },
  });
  return app;
}
