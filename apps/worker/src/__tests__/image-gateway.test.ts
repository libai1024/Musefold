import { createServer, type IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type GenerateImageOptions,
  type ImageDispatchSnapshot,
  UpstreamImageError,
  generateImage,
  imageChecksum,
} from '../image-gateway.js';

function dispatchOptions(
  baseUrl = 'https://newapi.example',
  apiKey = 'secret',
): GenerateImageOptions {
  return { claimUpstreamRequest: async () => ({ baseUrl, apiKey, model: 'musefold-image-pro' }) };
}

const networkMocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  requestHttp: vi.fn(),
  requestHttps: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({ lookup: networkMocks.lookup }));
vi.mock('node:http', async () => ({
  ...(await vi.importActual<typeof import('node:http')>('node:http')),
  request: networkMocks.requestHttp,
}));
vi.mock('node:https', async () => ({
  ...(await vi.importActual<typeof import('node:https')>('node:https')),
  request: networkMocks.requestHttps,
}));

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const request = {
  prompt: 'a red paper boat',
  size: '1024x1024' as const,
  quality: 'low' as const,
  count: 1 as const,
  referenceImages: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  networkMocks.lookup.mockReset();
  networkMocks.requestHttp.mockReset();
  networkMocks.requestHttps.mockReset();
});

function providerResponse(imageUrl: string): Response {
  return new Response(JSON.stringify({ data: [{ url: imageUrl }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mockImageRequest(
  statusCode = 200,
  headers: IncomingMessage['headers'] = {
    'content-type': 'image/png',
    'content-length': String(onePixelPng.length),
  },
): void {
  networkMocks.requestHttps.mockImplementation(
    (_url: URL, _options: object, callback: (response: IncomingMessage) => void) => {
      const response = Readable.from(statusCode === 200 ? [onePixelPng] : []) as IncomingMessage;
      response.statusCode = statusCode;
      response.headers = headers;
      response.complete = statusCode !== 200;
      queueMicrotask(() => callback(response));
      return {
        once: vi.fn(),
        end: vi.fn(),
      };
    },
  );
}

async function expectRejectedImageUrl(
  imageUrl: string,
  baseUrl = 'https://newapi.example',
): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => providerResponse(imageUrl)),
  );
  await expect(generateImage(request, [], dispatchOptions(baseUrl))).rejects.toMatchObject({
    code: 'rejected',
    dispatch: 'unknown',
  });
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('generation image gateway', () => {
  it.each(['generations', 'edits'] as const)(
    'sends the selected $0 model only when the late claim agrees',
    async (endpoint) => {
      const fetchMock = vi.fn(async (_input: string, init: RequestInit) => {
        const model =
          endpoint === 'edits'
            ? (init.body as FormData).get('model')
            : JSON.parse(String(init.body)).model;
        expect(model).toBe('gpt-image-2');
        return providerResponse(`data:image/png;base64,${onePixelPng.toString('base64')}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      const references =
        endpoint === 'edits'
          ? [{ bytes: onePixelPng, mimeType: 'image/png', name: 'ref.png' }]
          : [];
      await generateImage({ ...request, model: 'gpt-image-2' }, references, {
        claimUpstreamRequest: async () => ({
          baseUrl: 'https://provider.example',
          apiKey: 'synthetic-key',
          model: 'gpt-image-2',
        }),
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      fetchMock.mockClear();
      await expect(
        generateImage({ ...request, model: 'gpt-image-2' }, references, dispatchOptions()),
      ).rejects.toMatchObject({ dispatch: 'not_sent', code: 'rejected' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('defaults externally constructed errors to unknown dispatch', () => {
    expect(new UpstreamImageError('rejected', 'synthetic')).toMatchObject({
      code: 'rejected',
      dispatch: 'unknown',
    });
  });

  it.each(['generations', 'edits'] as const)(
    'prepares the body before claiming and constructs the $0 request from the late snapshot',
    async (endpoint) => {
      const entered = gate();
      const released = gate();
      const events: string[] = [];
      const originalHeaders = Headers;
      vi.stubGlobal(
        'Headers',
        class extends originalHeaders {
          constructor(init?: ConstructorParameters<typeof Headers>[0]) {
            super(init);
            events.push('headers');
          }
        },
      );
      const requestInput = { ...request };
      let current: ImageDispatchSnapshot = {
        model: 'musefold-image-pro',
        baseUrl: 'https://early.invalid',
        apiKey: 'early-key',
      };
      const snapshot: ImageDispatchSnapshot = {
        model: 'musefold-image-pro',
        get baseUrl() {
          events.push('base');
          return current.baseUrl;
        },
        get apiKey() {
          events.push('key');
          return current.apiKey;
        },
      };
      const append = vi.spyOn(FormData.prototype, 'append');
      const claimUpstreamRequest = vi.fn(async () => {
        entered.resolve();
        await released.promise;
        return snapshot;
      });
      const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
        if (!init) throw new Error('Expected generation request init');
        expect(String(input)).toBe(`https://late.example/v1/images/${endpoint}`);
        expect((init.headers as Headers).get('Authorization')).toBe('Bearer late-synthetic-key');
        expect(init.redirect).toBe('error');
        expect(
          endpoint === 'edits'
            ? (init.body as FormData).get('prompt')
            : JSON.parse(String(init.body)).prompt,
        ).toBe(request.prompt);
        return providerResponse(`data:image/png;base64,${onePixelPng.toString('base64')}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      const references =
        endpoint === 'edits'
          ? [{ bytes: onePixelPng, mimeType: 'image/png', name: 'reference.png' }]
          : [];
      const generating = generateImage(requestInput, references, { claimUpstreamRequest });
      try {
        await entered.promise;
        expect(events).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
        if (endpoint === 'edits') expect(append).toHaveBeenCalled();
        requestInput.prompt = 'changed while the claim was pending';
        current = {
          baseUrl: 'https://late.example/',
          apiKey: 'late-synthetic-key',
          model: 'musefold-image-pro',
        };
      } finally {
        released.resolve();
      }
      const images = await generating;
      expect(images[0].bytes).toEqual(onePixelPng);
      expect(events).toEqual(['base', 'key', 'headers']);
      expect(claimUpstreamRequest).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it('fails body preparation before any claim or HTTP and hides the thrown text', async () => {
    const claimUpstreamRequest = vi.fn(dispatchOptions().claimUpstreamRequest);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      generateImage(
        request,
        [
          {
            get bytes(): Buffer {
              throw new UpstreamImageError('rejected', 'synthetic-body-secret');
            },
            mimeType: 'image/png',
            name: 'reference.png',
          },
        ],
        { claimUpstreamRequest },
      ),
    ).rejects.toMatchObject({
      code: 'rejected',
      message: '生图请求未发送',
      dispatch: 'not_sent',
    });
    expect(claimUpstreamRequest).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a rejected claim unsent and never exposes its exception text', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const claimUpstreamRequest = vi.fn(async () => {
      throw new UpstreamImageError('rejected', 'synthetic-claim-secret', 'unknown');
    });
    await expect(generateImage(request, [], { claimUpstreamRequest })).rejects.toMatchObject({
      code: 'rejected',
      message: '生图请求未发送',
      dispatch: 'not_sent',
    });
    expect(claimUpstreamRequest).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { baseUrl: 'not-a-provider-url', apiKey: 'synthetic-key' },
    { baseUrl: 'https://provider.example', apiKey: 'synthetic-key\nsecret-header-canary' },
    { baseUrl: 'https://name:secret@provider.example', apiKey: 'synthetic-key' },
  ])(
    'keeps snapshot construction errors unsent without exposing the snapshot',
    async (snapshot) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const failure = await generateImage(request, [], {
        claimUpstreamRequest: async () => ({ ...snapshot, model: 'musefold-image-pro' }),
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(UpstreamImageError);
      expect(failure).toMatchObject({ dispatch: 'not_sent' });
      expect(JSON.stringify(failure).includes(snapshot.apiKey)).toBe(false);
      expect(String(failure).includes('secret')).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rechecks cancellation after snapshot construction but before HTTP', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const snapshot: ImageDispatchSnapshot = {
      model: 'musefold-image-pro',
      baseUrl: 'https://provider.example',
      get apiKey() {
        controller.abort();
        return 'synthetic-key';
      },
    };
    await expect(
      generateImage(request, [], {
        signal: controller.signal,
        claimUpstreamRequest: async () => snapshot,
      }),
    ).rejects.toMatchObject({
      code: 'rejected',
      message: '生成已取消，未发送上游请求',
      dispatch: 'not_sent',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not accept an externally supplied not_sent error after fetch was invoked', async () => {
    const fetchMock = vi.fn(() => {
      throw new UpstreamImageError('rejected', 'synthetic-fetch-secret', 'not_sent');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateImage(request, [], dispatchOptions())).rejects.toMatchObject({
      code: 'rejected',
      message: '无法确认上游生图结果',
      dispatch: 'unknown',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([400, 402, 503])(
    'HTTP %s remains unknown dispatch with one real request and fixed error text',
    async (status) => {
      const received: string[] = [];
      const server = createServer((incoming, response) => {
        received.push(incoming.url ?? '');
        incoming.resume();
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'synthetic-private-provider-error' } }));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        if (!address || typeof address === 'string')
          throw new Error('HTTP test server has no port');
        const failure = await generateImage(
          request,
          [],
          dispatchOptions(`http://127.0.0.1:${address.port}`),
        ).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(UpstreamImageError);
        expect(failure).toMatchObject({
          code: status === 402 ? 'quota' : status === 400 ? 'rejected' : 'unknown',
          dispatch: 'unknown',
        });
        expect(String(failure).includes('synthetic-private-provider-error')).toBe(false);
        expect(received).toEqual(['/v1/images/generations']);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  it('converts OpenAI-compatible base64 output and preserves request fields', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'musefold-image-pro',
        prompt: request.prompt,
        size: request.size,
        quality: request.quality,
        n: 1,
      });
      return new Response(
        JSON.stringify({
          data: [{ b64_json: onePixelPng.toString('base64') }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const [image] = await generateImage(request, [], dispatchOptions());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(image).toMatchObject({ mimeType: 'image/png', width: 1, height: 1 });
    expect(image.bytes).toEqual(onePixelPng);
    expect(imageChecksum(image.bytes)).toMatch(/^[a-f0-9]{64}$/);
  });

  // §9-D3 解锁:云端张数由上游 `n` 承载，worker 不做本地成本乘算。
  it('张数 4 直接透传上游 n 并解码 4 张，保持上游返回顺序', async () => {
    const shades = [1, 2, 3, 4].map(() => onePixelPng);
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ n: 4 });
      return new Response(
        JSON.stringify({ data: shades.map((png) => ({ b64_json: png.toString('base64') })) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const images = await generateImage({ ...request, count: 4 }, [], dispatchOptions());

    expect(images).toHaveLength(4);
    expect(images.every((image) => image.mimeType === 'image/png')).toBe(true);
  });

  it('张数 2 走参考图编辑通道时同样把 n 写进 multipart 表单', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://newapi.example/v1/images/edits');
      const form = init?.body as FormData | undefined;
      expect(form?.get('n')).toBe('2');
      return new Response(
        JSON.stringify({
          data: [
            { b64_json: onePixelPng.toString('base64') },
            { b64_json: onePixelPng.toString('base64') },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const images = await generateImage(
      { ...request, count: 2 },
      [{ bytes: onePixelPng, mimeType: 'image/png', name: 'style.png' }],
      dispatchOptions(),
    );

    expect(images).toHaveLength(2);
  });

  it('does not call the provider when the dispatch claim rejects at the request boundary', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const claimUpstreamRequest = vi.fn(async () => null);

    await expect(generateImage(request, [], { claimUpstreamRequest })).rejects.toMatchObject({
      code: 'unknown',
      message: '生成发送权限已失效',
      dispatch: 'not_sent',
    });
    expect(claimUpstreamRequest).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not claim the dispatch snapshot when cancellation precedes the dispatch claim', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    const claimUpstreamRequest = vi.fn(async () => ({
      model: 'musefold-image-pro',
      baseUrl: 'https://newapi.example',
      apiKey: 'secret',
    }));

    await expect(
      generateImage(request, [], {
        signal: controller.signal,
        claimUpstreamRequest,
      }),
    ).rejects.toMatchObject({
      code: 'rejected',
      message: '生成已取消，未发送上游请求',
      dispatch: 'not_sent',
    });
    expect(claimUpstreamRequest).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'records cancellation during the dispatch claim as unsent when the hook will %s',
    async (outcome) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const controller = new AbortController();
      const entered = gate();
      const released = gate();
      const claimUpstreamRequest = vi.fn(async () => {
        entered.resolve();
        await released.promise;
        if (outcome === 'reject') throw new Error('dispatch claim interrupted');
        return { baseUrl: 'https://newapi.example', apiKey: 'secret', model: 'musefold-image-pro' };
      });
      const generating = generateImage(request, [], {
        signal: controller.signal,
        claimUpstreamRequest,
      });
      await entered.promise;
      controller.abort();
      released.resolve();

      await expect(generating).rejects.toMatchObject({
        code: 'rejected',
        message: '生成已取消，未发送上游请求',
        dispatch: 'not_sent',
      });
      expect(claimUpstreamRequest).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('keeps cancellation after the paid fetch begins unknown', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    vi.stubGlobal('fetch', fetchMock);
    const claimUpstreamRequest = vi.fn(async () => ({
      model: 'musefold-image-pro',
      baseUrl: 'https://newapi.example',
      apiKey: 'secret',
    }));

    await expect(
      generateImage(request, [], {
        signal: controller.signal,
        claimUpstreamRequest,
      }),
    ).rejects.toMatchObject({ code: 'unknown', dispatch: 'unknown' });
    expect(claimUpstreamRequest).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 307, endpoint: 'generations' },
    { status: 308, endpoint: 'generations' },
    { status: 307, endpoint: 'edits' },
    { status: 308, endpoint: 'edits' },
  ])('does not resend a paid $endpoint POST after HTTP $status', async ({ status, endpoint }) => {
    const received: Array<{ method: string | undefined; url: string | undefined }> = [];
    const server = createServer((incoming, response) => {
      received.push({ method: incoming.method, url: incoming.url });
      incoming.resume();
      if (incoming.url === `/v1/images/${endpoint}`) {
        response.writeHead(status, { location: '/redirect-target' });
        response.end();
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: [{ b64_json: onePixelPng.toString('base64') }] }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('HTTP test server has no port');
      const claimUpstreamRequest = vi.fn(async () => ({
        model: 'musefold-image-pro',
        baseUrl: 'https://newapi.example',
        apiKey: 'secret',
      }));
      const references =
        endpoint === 'edits'
          ? [{ bytes: onePixelPng, mimeType: 'image/png', name: 'style.png' }]
          : [];

      await expect(
        generateImage(request, references, {
          claimUpstreamRequest: vi.fn(async () => {
            await claimUpstreamRequest();
            return {
              baseUrl: `http://127.0.0.1:${address.port}`,
              apiKey: 'test-only-key',
              model: 'musefold-image-pro',
            };
          }),
        }),
      ).rejects.toMatchObject({ code: 'unknown', dispatch: 'unknown' });
      expect(claimUpstreamRequest).toHaveBeenCalledOnce();
      expect(received).toEqual([{ method: 'POST', url: `/v1/images/${endpoint}` }]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('routes to /images/edits as multipart when references are provided', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://newapi.example/v1/images/edits');
      expect(init?.method).toBe('POST');
      const form = init?.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get('model')).toBe('musefold-image-pro');
      expect(form.get('prompt')).toBe(request.prompt);
      expect(form.get('size')).toBe(request.size);
      const images = form.getAll('image[]');
      expect(images).toHaveLength(2);
      expect((images[0] as File).name).toBe('style.png');
      return new Response(
        JSON.stringify({ data: [{ b64_json: onePixelPng.toString('base64') }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const [image] = await generateImage(
      request,
      [
        { bytes: onePixelPng, mimeType: 'image/png', name: 'style.png' },
        { bytes: onePixelPng, mimeType: 'image/png', name: 'pose.png' },
      ],
      dispatchOptions(),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(image).toMatchObject({ mimeType: 'image/png', width: 1, height: 1 });
  });

  it('maps upstream quota failures without retrying them locally', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'insufficient balance' } }), {
            status: 402,
          }),
      ),
    );

    const promise = generateImage(request, [], dispatchOptions());

    await expect(promise).rejects.toMatchObject({
      code: 'quota',
      message: '上游生图额度不足',
      dispatch: 'unknown',
    });
  });

  it('downloads an approved public image host using only its validated DNS address', async () => {
    const fetchMock = vi.fn(async () => providerResponse('https://assets.example/generated.png'));
    vi.stubGlobal('fetch', fetchMock);
    networkMocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    mockImageRequest();

    const [image] = await generateImage(request, [], dispatchOptions());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(networkMocks.lookup).toHaveBeenCalledWith('assets.example', {
      all: true,
      verbatim: true,
    });
    expect(networkMocks.requestHttps).toHaveBeenCalledOnce();
    const [url, options] = networkMocks.requestHttps.mock.calls[0] as unknown as [
      URL,
      {
        lookup: (
          hostname: string,
          options: { all: boolean },
          callback: (error: Error | null, address: string, family?: number) => void,
        ) => void;
      },
    ];
    expect(url).toEqual(new URL('https://assets.example/generated.png'));
    const lookupResult = await new Promise<{ address: string; family?: number }>(
      (resolve, reject) =>
        options.lookup(
          'assets.example',
          { all: false },
          (error: Error | null, address: string, family?: number) =>
            error ? reject(error) : resolve({ address, family }),
        ),
    );
    expect(lookupResult).toEqual({ address: '8.8.8.8', family: 4 });
    expect(image.bytes).toEqual(onePixelPng);
  });

  it('preserves provider image data URLs without network access', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        providerResponse(`data:image/png;base64,${onePixelPng.toString('base64')}`),
      ),
    );

    const [image] = await generateImage(request, [], dispatchOptions());

    expect(image.bytes).toEqual(onePixelPng);
    expect(networkMocks.lookup).not.toHaveBeenCalled();
    expect(networkMocks.requestHttps).not.toHaveBeenCalled();
  });

  it.each([
    ['localhost', 'http://localhost/generated.png'],
    ['127/8', 'http://127.23.45.67/generated.png'],
    ['RFC1918 10/8', 'http://10.1.2.3/generated.png'],
    ['RFC1918 172.16/12', 'http://172.31.255.254/generated.png'],
    ['RFC1918 192.168/16', 'http://192.168.4.5/generated.png'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data'],
    ['IPv6 loopback', 'http://[::1]/generated.png'],
    ['IPv6 ULA', 'http://[fd12:3456::1]/generated.png'],
    ['IPv6 link-local', 'http://[fe80::1]/generated.png'],
  ])('rejects a cross-origin %s image URL', async (_label, imageUrl) => {
    await expectRejectedImageUrl(imageUrl);

    expect(networkMocks.lookup).not.toHaveBeenCalled();
    expect(networkMocks.requestHttp).not.toHaveBeenCalled();
  });

  it('rejects a public hostname when any DNS answer is non-public', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => providerResponse('https://assets.example/generated.png')),
    );
    networkMocks.lookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);

    await expect(generateImage(request, [], dispatchOptions())).rejects.toMatchObject({
      code: 'rejected',
      message: '上游图像 URL 指向非公开网络地址',
    });
    expect(networkMocks.requestHttps).not.toHaveBeenCalled();
  });

  it('allows private image addresses only for the configured provider origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => providerResponse('http://provider.internal/image.png')),
    );
    networkMocks.lookup.mockResolvedValue([{ address: '10.0.0.8', family: 4 }]);
    networkMocks.requestHttp.mockImplementation(
      (_url: URL, _options: object, callback: (response: IncomingMessage) => void) => {
        const response = Readable.from([onePixelPng]) as IncomingMessage;
        response.statusCode = 200;
        response.headers = { 'content-length': String(onePixelPng.length) };
        response.complete = false;
        queueMicrotask(() => callback(response));
        return { once: vi.fn(), end: vi.fn() };
      },
    );

    const [image] = await generateImage(request, [], dispatchOptions('http://provider.internal'));

    expect(image.bytes).toEqual(onePixelPng);
    expect(networkMocks.requestHttp).toHaveBeenCalledOnce();
  });

  it.each([
    ['userinfo', 'https://attacker:secret@assets.example/generated.png'],
    ['file scheme', 'file:///etc/passwd'],
    ['ftp scheme', 'ftp://assets.example/generated.png'],
  ])('rejects image URLs containing %s', async (_label, imageUrl) => {
    await expectRejectedImageUrl(imageUrl);

    expect(networkMocks.lookup).not.toHaveBeenCalled();
    expect(networkMocks.requestHttps).not.toHaveBeenCalled();
  });

  it('rejects redirects without resolving or fetching the redirect target', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => providerResponse('https://assets.example/generated.png')),
    );
    networkMocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    mockImageRequest(302, { location: 'http://169.254.169.254/latest/meta-data' });

    await expect(generateImage(request, [], dispatchOptions())).rejects.toMatchObject({
      code: 'rejected',
      message: '上游图像 URL 不得重定向',
    });
    expect(networkMocks.lookup).toHaveBeenCalledOnce();
    expect(networkMocks.requestHttps).toHaveBeenCalledOnce();
  });

  it('keeps the bounded image download rejection unknown after a paid request', async () => {
    const fetchMock = vi.fn(async () => providerResponse('https://assets.example/generated.png'));
    vi.stubGlobal('fetch', fetchMock);
    networkMocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    mockImageRequest(200, { 'content-length': String(30 * 1024 * 1024 + 1) });
    await expect(generateImage(request, [], dispatchOptions())).rejects.toMatchObject({
      code: 'rejected',
      message: '图像文件过大',
      dispatch: 'unknown',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(networkMocks.requestHttps).toHaveBeenCalledOnce();
  });

  it('rejects unsupported image payloads before persisting them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [{ b64_json: Buffer.from('not an image').toString('base64') }],
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(generateImage(request, [], dispatchOptions())).rejects.toMatchObject({
      code: 'rejected',
      message: '上游返回了不支持的图像格式',
    });
  });
});
