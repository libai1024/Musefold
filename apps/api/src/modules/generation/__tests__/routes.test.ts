import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import type { AuthedEnv } from '../../../auth/middleware.js';
import { AppError, toErrorBody } from '../../../lib/errors.js';
import { generationRoutes } from '../routes.js';
import type { GenerationService } from '../service.js';
import type { ExecutionBinding } from '@musefold/contracts';

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

/**
 * §9-D3 云端解锁的判定依据(服务端侧):
 * 张数不经本地成本估算 —— `apps/api` 全链没有 `estimateCost`/预检额度闸,
 * `cost_points` 由上游账单回填(worker 不写),额度不足以上游 402 → `ACCOUNT_QUOTA_INSUFFICIENT` 冒泡。
 * 所以路由层只需保证:目录内 count 原样进 service(落库 request.count / 参与幂等指纹),
 * 目录外 count 在触达 service 前就被契约拒成 400。
 */
describe('generation create route 张数透传', () => {
  const job = { id: 'run-1' } as never;

  it.each([1, 2, 4] as const)('count %i 原样透传给 service', async (count) => {
    const create = vi.fn().mockResolvedValue(job);
    const app = testApp({ create } as unknown as GenerationService);

    const response = await app.request('http://localhost/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'intent-0001' },
      body: JSON.stringify({ prompt: 'four up', count }),
    });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      'generation-routes-user',
      expect.objectContaining({ count }),
      'intent-0001',
      'generation-routes-session',
    );
  });

  it('目录外 count 3 在触达 service 前被拒成 400', async () => {
    const create = vi.fn();
    const app = testApp({ create } as unknown as GenerationService);

    const response = await app.request('http://localhost/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'intent-0001' },
      body: JSON.stringify({ prompt: 'three up', count: 3 }),
    });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
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

describe('generation history query', () => {
  it('forwards promptId to service.history', async () => {
    const history = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const app = testApp({ history } as unknown as GenerationService);
    const response = await app.request(
      'http://localhost/generations?promptId=prompt-related-1&status=succeeded&limit=20',
    );
    expect(response.status).toBe(200);
    expect(history).toHaveBeenCalledWith(
      'generation-routes-user',
      expect.objectContaining({ promptId: 'prompt-related-1', status: 'succeeded' }),
    );
  });
});

const binding: ExecutionBinding = {
  apiIssuer: 'https://api.example.test',
  principalId: 'generation-routes-user',
  payer: { issuer: 'https://provider.example.test', ownerId: '42' },
  credential: { ref: 'fixture-credential', version: 1 },
  providerId: 'cloud-default',
  model: 'musefold-image-pro',
  capabilities: { image: true, text: false },
};

describe('trusted generation authorization transport', () => {
  it('keeps the workbench session separate from the host-authenticated BA session', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'run' });
    const response = await testApp({ create } as unknown as GenerationService).request(
      '/generations',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'intent-authority' },
        body: JSON.stringify({
          prompt: 'Poster',
          sessionId: 'workbench-only',
          expectedBinding: binding,
        }),
      },
    );
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      'generation-routes-user',
      expect.objectContaining({
        sessionId: 'workbench-only',
        expectedBinding: binding,
      }),
      'intent-authority',
      'generation-routes-session',
    );
  });

  it.each([undefined, '{}'])('accepts the legacy empty retry body %s', async (body) => {
    const retry = vi.fn().mockResolvedValue({ id: 'retry' });
    const response = await testApp({ retry } as unknown as GenerationService).request(
      '/generations/source/retry',
      {
        method: 'POST',
        headers: { 'idempotency-key': 'retry-intent' },
        ...(body === undefined ? {} : { body }),
      },
    );
    expect(response.status).toBe(201);
    expect(retry).toHaveBeenCalledWith(
      'generation-routes-user',
      'source',
      'retry-intent',
      'generation-routes-session',
      {},
    );
  });

  it('forwards an explicit retry binding and rejects malformed JSON instead of treating it as an empty body', async () => {
    const retry = vi.fn().mockResolvedValue({ id: 'retry' });
    const app = testApp({ retry } as unknown as GenerationService);
    const call = (body: string) =>
      app.request('/generations/source/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'retry-intent' },
        body,
      });
    expect((await call(JSON.stringify({ expectedBinding: binding }))).status).toBe(201);
    expect(retry).toHaveBeenLastCalledWith(
      'generation-routes-user',
      'source',
      'retry-intent',
      'generation-routes-session',
      { expectedBinding: binding },
    );
    expect((await call('{')).status).toBe(400);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('provides an owner-scoped, read-only receipt lookup including the reserved scheme namespace', async () => {
    const getReceipt = vi.fn().mockResolvedValue({ id: 'receipt' });
    const create = vi.fn();
    const get = vi.fn();
    const response = await testApp({
      getReceipt,
      create,
      get,
    } as unknown as GenerationService).request(
      '/generations/receipts/by-key?key=scheme%3Aexecution-1',
    );
    expect(response.status).toBe(200);
    expect(getReceipt).toHaveBeenCalledWith('generation-routes-user', 'scheme:execution-1');
    expect(create).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects receipt query arrays before calling the service', async () => {
    const getReceipt = vi.fn();
    const response = await testApp({ getReceipt } as unknown as GenerationService).request(
      '/generations/receipts/by-key?key=valid-key1&key=valid-key2',
    );
    expect(response.status).toBe(400);
    expect(getReceipt).not.toHaveBeenCalled();
  });
});
