import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateImage,
  imageChecksum,
  UpstreamImageError,
} from '../image-gateway.js';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const request = {
  prompt: 'a red paper boat',
  size: '1024x1024' as const,
  quality: 'low' as const,
  count: 1 as const,
};

afterEach(() => vi.restoreAllMocks());

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

    const [image] = await generateImage(
      'https://newapi.example',
      'secret',
      request,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(image).toMatchObject({ mimeType: 'image/png', width: 1, height: 1 });
    expect(image.bytes).toEqual(onePixelPng);
    expect(imageChecksum(image.bytes)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('maps upstream quota failures without retrying them locally', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { message: 'insufficient balance' } }),
            { status: 402 },
          ),
      ),
    );

    const promise = generateImage('https://newapi.example', 'secret', request);

    await expect(promise).rejects.toMatchObject({
      code: 'quota',
      message: 'insufficient balance',
    });
  });

  it('streams a URL result exactly once before validating the image', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ url: 'https://assets.example/generated.png' }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(onePixelPng, {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': String(onePixelPng.length),
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const [image] = await generateImage(
      'https://newapi.example',
      'secret',
      request,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toEqual(
      new URL('https://assets.example/generated.png'),
    );
    expect(image.bytes).toEqual(onePixelPng);
  });

  it('rejects unsupported image payloads before persisting them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                { b64_json: Buffer.from('not an image').toString('base64') },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      generateImage('https://newapi.example', 'secret', request),
    ).rejects.toMatchObject({
      code: 'rejected',
      message: '上游返回了不支持的图像格式',
    });
  });
});
