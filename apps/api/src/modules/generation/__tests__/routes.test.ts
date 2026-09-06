import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import type { AuthedEnv } from '../../../auth/middleware.js';
import { AppError, toErrorBody } from '../../../lib/errors.js';
import { generationRoutes } from '../routes.js';
import type { GenerationService } from '../service.js';

function testApp(service: GenerationService) {
  const app = new OpenAPIHono<AuthedEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', 'generation-routes-user');
    c.set('sessionId', 'generation-routes-session');
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(toErrorBody(error, 'generation-routes-request'), error.status as 400);
    }
    throw error;
  });
  app.route('/', generationRoutes(service));
  return app;
}

function oversizedBody(): ReadableStream<Uint8Array> {
  let chunks = 0;
  return new ReadableStream({
    pull(controller) {
      if (chunks >= 22) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(1024 * 1024));
      chunks += 1;
    },
  });
}

describe('reference image upload body limit', () => {
  it('uses streamed bytes even when Content-Length is forged smaller', async () => {
    const uploadReferenceImage = vi.fn();
    const app = testApp({ uploadReferenceImage } as unknown as GenerationService);
    const request = new Request('http://localhost/reference-images', {
      method: 'POST',
      headers: {
        'content-length': '1',
        'content-type': 'multipart/form-data; boundary=musefold-test',
      },
      body: oversizedBody(),
      duplex: 'half',
    });

    const response = await app.request(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: '图片不能超过 20 MiB',
        retryable: false,
      },
    });
    expect(uploadReferenceImage).not.toHaveBeenCalled();
  });
});

describe('batch cleanup route', () => {
  it('accepts each scope and returns the affected count (ui-parity 05 §7)', async () => {
    const cleanup = vi.fn().mockResolvedValue({ affected: 4 });
    const app = testApp({ cleanup } as unknown as GenerationService);

    for (const scope of ['older-than-30d', 'failed-and-cancelled', 'empty-trash'] as const) {
      const response = await app.request('http://localhost/generations/cleanup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ affected: 4 });
    }

    expect(cleanup.mock.calls.map(([, input]) => input)).toEqual([
      { scope: 'older-than-30d' },
      { scope: 'failed-and-cancelled' },
      { scope: 'empty-trash' },
    ]);
    expect(cleanup.mock.calls.every(([userId]) => userId === 'generation-routes-user')).toBe(true);
  });

  it('rejects unknown scopes before touching the service', async () => {
    const cleanup = vi.fn();
    const app = testApp({ cleanup } as unknown as GenerationService);

    const response = await app.request('http://localhost/generations/cleanup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'everything' }),
    });

    expect(response.status).toBe(400);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('does not shadow the cleanup path with the /generations/{id} detail route', async () => {
    const get = vi.fn();
    const cleanup = vi.fn().mockResolvedValue({ affected: 0 });
    const app = testApp({ get, cleanup } as unknown as GenerationService);

    const response = await app.request('http://localhost/generations/cleanup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'empty-trash' }),
    });

    expect(response.status).toBe(200);
    expect(get).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
