import { describe, expect, it } from 'vitest';
import {
  SHARE_DEEPLINK_MAX_BYTES,
  buildShareDeeplink,
  decodeSharePayload,
  parseShareDeeplink,
  sanitizeSharePayload,
} from '../share';

describe('share deeplink payload', () => {
  it('roundtrips unicode payloads and omits previewDataUrl from deeplinks', () => {
    const deeplink = buildShareDeeplink({
      title: '日系人像',
      content: 'cinematic portrait, soft light, 85mm，樱花',
      contentNegative: 'lowres, watermark',
      params: {
        schemaVersion: 1,
        size: '1024x1536',
        quality: 'high',
        n: 2,
        ratioId: '2:3',
        promptTarget: 'openai',
        apiKey: 'sk-should-drop',
      },
      target: 'openai',
      previewDataUrl: 'data:image/png;base64,AAAA',
    });

    expect(deeplink).toMatch(/^musefold:\/\/import\?data=/);
    const parsed = parseShareDeeplink(deeplink);
    expect(parsed).toMatchObject({
      title: '日系人像',
      content: 'cinematic portrait, soft light, 85mm，樱花',
      contentNegative: 'lowres, watermark',
      target: 'openai',
    });
    expect(parsed.previewDataUrl).toBeUndefined();
    expect(parsed.params?.size).toBe('1024x1536');
    expect(parsed.params?.quality).toBe('high');
    expect(parsed.params?.ratioId).toBe('2:3');
    expect(parsed.params?.apiKey).toBeUndefined();
  });

  it('keeps only allowlisted top-level fields and known param keys', () => {
    const sanitized = sanitizeSharePayload({
      title: '  Safe title  ',
      content: '  prompt body  ',
      sourcePath: '/Users/me/secret.png',
      apiKey: 'sk-secret',
      params: {
        schemaVersion: 1,
        size: 'bad-size',
        quality: 'medium',
        cfg: 99,
        ratioId: '16:9',
        localPath: '/tmp/image.png',
      },
    });

    expect(sanitized).toEqual({
      title: 'Safe title',
      content: 'prompt body',
      params: {
        schemaVersion: 1,
        quality: 'medium',
        cfg: 30,
        ratioId: '16:9',
      },
    });
  });

  it('rejects malformed urls and malformed base64', () => {
    expect(() => parseShareDeeplink('https://example.com/import?data=abc')).toThrow(
      /INVALID_DEEPLINK/,
    );
    expect(() => parseShareDeeplink('musefold://import?data=@@@')).toThrow(
      /INVALID_DEEPLINK/,
    );
    expect(() => parseShareDeeplink('musefold://import')).toThrow(/INVALID_DEEPLINK/);
  });

  it('rejects over-large encoded payloads before decoding', () => {
    const maxBase64Length = Math.ceil(SHARE_DEEPLINK_MAX_BYTES / 3) * 4 + 4;
    expect(() => decodeSharePayload('A'.repeat(maxBase64Length + 8))).toThrow(
      /PAYLOAD_TOO_LARGE/,
    );
  });
});
