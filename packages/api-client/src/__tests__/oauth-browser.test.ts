import { describe, expect, it, vi } from 'vitest';
import { createCloudDataGateway } from '../gateway';

describe('OAuth browser transport', () => {
  it('keeps the signed query intact, binds approval by header, and uses cookie authentication', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ redirect: true, url: 'https://reader.example/callback?code=synthetic' }),
        ),
      );
    const flow = createCloudDataGateway({ baseUrl: 'https://musefold.example', fetch: fetchImpl })
      .cloudMcp?.authorization;
    await flow?.decide({
      oauth_query: 'state=signed%2Bvalue&sig=synthetic',
      reviewRef: 'opaque-ref',
      accept: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://musefold.example/api/auth/oauth2/consent');
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('x-musefold-oauth-review')).toBe('opaque-ref');
    expect(JSON.parse(String(init?.body))).toEqual({
      oauth_query: 'state=signed%2Bvalue&sig=synthetic',
      accept: false,
    });
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });
  it('rejects a preview containing credentials or a foreign continuation URL', async () => {
    const value = {
      client: { id: 'c', name: 'Client', origin: null },
      scopes: ['prompts:read'],
      account: null,
      loginRequired: true,
      continueUrl: null,
      reviewRef: null,
    };
    for (const extra of [
      { token: 'must-not-enter-cache' },
      { continueUrl: 'https://untrusted.example' },
    ]) {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ ...value, ...extra })));
      const flow = createCloudDataGateway({ baseUrl: '', fetch: fetchImpl }).cloudMcp
        ?.authorization;
      await expect(flow?.review({ oauth_query: 'signed=synthetic' })).rejects.toThrow();
    }
  });
  it('does not retry a failed consent POST', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network failed'));
    const flow = createCloudDataGateway({ baseUrl: '', fetch: fetchImpl }).cloudMcp?.authorization;
    await expect(
      flow?.decide({ oauth_query: 'signed=synthetic', reviewRef: 'opaque-ref', accept: true }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
