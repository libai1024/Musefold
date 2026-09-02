import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateImage, imageChecksum } from '../image-gateway.js';

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
  await expect(generateImage(baseUrl, 'secret', request)).rejects.toMatchObject({
    code: 'rejected',
  });
}

describe('generation image gateway', () => {
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

    const [image] = await generateImage('https://newapi.example', 'secret', request);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(image).toMatchObject({ mimeType: 'image/png', width: 1, height: 1 });
    expect(image.bytes).toEqual(onePixelPng);
    expect(imageChecksum(image.bytes)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not call the provider when the lease hook rejects at the request boundary', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const beforeUpstreamRequest = vi.fn(() => false);

    await expect(
      generateImage('https://newapi.example', 'secret', request, [], { beforeUpstreamRequest }),
    ).rejects.toMatchObject({ code: 'unknown', message: '生成租约已失效' });
    expect(beforeUpstreamRequest).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
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

    const [image] = await generateImage('https://newapi.example', 'secret', request, [
      { bytes: onePixelPng, mimeType: 'image/png', name: 'style.png' },
      { bytes: onePixelPng, mimeType: 'image/png', name: 'pose.png' },
    ]);

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

    const promise = generateImage('https://newapi.example', 'secret', request);

    await expect(promise).rejects.toMatchObject({
      code: 'quota',
      message: 'insufficient balance',
    });
  });

  it('downloads an approved public image host using only its validated DNS address', async () => {
    const fetchMock = vi.fn(async () => providerResponse('https://assets.example/generated.png'));
    vi.stubGlobal('fetch', fetchMock);
    networkMocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    mockImageRequest();

    const [image] = await generateImage('https://newapi.example', 'secret', request);

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

    const [image] = await generateImage('https://newapi.example', 'secret', request);

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

    await expect(generateImage('https://newapi.example', 'secret', request)).rejects.toMatchObject({
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

    const [image] = await generateImage('http://provider.internal', 'secret', request);

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

    await expect(generateImage('https://newapi.example', 'secret', request)).rejects.toMatchObject({
      code: 'rejected',
      message: '上游图像 URL 不得重定向',
    });
    expect(networkMocks.lookup).toHaveBeenCalledOnce();
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

    await expect(generateImage('https://newapi.example', 'secret', request)).rejects.toMatchObject({
      code: 'rejected',
      message: '上游返回了不支持的图像格式',
    });
  });
});
