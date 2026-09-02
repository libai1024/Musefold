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
