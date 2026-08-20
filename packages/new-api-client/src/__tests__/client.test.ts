import { describe, expect, it, vi } from 'vitest';
import {
  createNewApiClient,
  NewApiClientError,
  noticeId,
  normalizeNewApiUrl,
} from '../index';

describe('shared new-api client', () => {
  it('normalizes safe server URLs and rejects embedded credentials', () => {
    expect(normalizeNewApiUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(() => normalizeNewApiUrl('https://user:pass@example.com')).toThrow(NewApiClientError);
  });

  it('parses login access and refresh credentials without exposing them to logs', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        access_token: 'jwt-secret',
        access_expires_at: 1_787_000_000,
        user: { id: 7, username: 'musefold', quota: 9000, group: 'default' },
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': 'new_api_refresh=refresh-secret; HttpOnly; Path=/' },
    }));
    const client = createNewApiClient('https://api.example.com', { fetchImpl });
    const session = await client.login({ username: 'musefold', password: 'secret' });
    expect(session).toMatchObject({
      jwt: 'jwt-secret',
      refreshToken: 'refresh-secret',
      user: { id: 7, quota: 9000 },
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/api/user/login', expect.objectContaining({
      method: 'POST',
      redirect: 'error',
    }));
  });

  it('maps all redemption failures to one non-enumerating error', async () => {
    const client = createNewApiClient('https://api.example.com', {
      fetchImpl: async () => new Response(JSON.stringify({ success: false, message: 'code already used' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    });
    await expect(client.redeem('jwt', 'bad-code')).rejects.toMatchObject({ code: 'redeem' });
  });

  it('rewrites 2FA login failures without changing the credentials code', async () => {
    const client = createNewApiClient('https://api.example.com', {
      fetchImpl: async () => new Response(JSON.stringify({ success: false, message: 'please complete 2FA' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });
    await expect(client.login({ username: 'a', password: 'b' })).rejects.toMatchObject({
      code: 'credentials',
      message: '该账号开启了两步验证，请使用网页控制台登录后关闭，再在 App 内登录',
    });
  });

  it('lists user models and prefixes fetched token keys', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      const path = String(input);
      if (path.endsWith('/api/user/models')) {
        return new Response(JSON.stringify({ success: true, data: ['musefold-agent'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: { key: 'plain-token' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = createNewApiClient('https://api.example.com', { fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.listUserModels('jwt')).resolves.toEqual(['musefold-agent']);
    await expect(client.fetchTokenKey('jwt', 2)).resolves.toBe('sk-plain-token');
  });

  it('parses pricing fingerprints and merges public notices', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      const path = String(input);
      if (path.endsWith('/api/pricing')) {
        return new Response(JSON.stringify({
          success: true,
          pricing_version: '5a9c',
          group_ratio: { default: 1 },
          data: [{
            model_name: 'musefold-image-pro',
            quota_type: 1,
            model_ratio: 0,
            completion_ratio: 0,
            model_price: 0.04,
            enable_groups: ['default'],
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (path.endsWith('/api/status')) {
        return new Response(JSON.stringify({
          success: true,
          data: { announcements: [{ content: '维护窗口', publishDate: '2026-08-14T10:00:00Z' }] },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, data: '欢迎使用' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = createNewApiClient('https://api.example.com', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const pricing = await client.getPricing();
    expect(pricing).toMatchObject({
      version: '5a9c',
      models: [{ modelName: 'musefold-image-pro', quotaType: 1, modelPrice: 0.04 }],
    });
    const notices = await client.getNotices();
    expect(notices).toEqual([
      { id: noticeId('维护窗口'), content: '维护窗口', publishedAt: Date.parse('2026-08-14T10:00:00Z') },
      { id: noticeId('欢迎使用'), content: '欢迎使用', publishedAt: null },
    ]);
  });

  it('swallows notice fetch failures', async () => {
    const client = createNewApiClient('https://api.example.com', {
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(client.getNotices()).resolves.toEqual([]);
  });

  it('distinguishes timeout from generic network errors', async () => {
    const client = createNewApiClient('https://api.example.com', {
      timeoutMs: 10,
      fetchImpl: ((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })) as unknown as typeof fetch,
    });
    await expect(client.getSelf('jwt')).rejects.toMatchObject({
      code: 'network',
      message: '连接账号服务器超时',
    });
  });

  it('lets createError replace NewApiClientError without wrapping as network', async () => {
    class MappedError extends Error {
      constructor(readonly code: string, message: string) {
        super(message);
        this.name = 'MappedError';
      }
    }
    const client = createNewApiClient('https://api.example.com', {
      createError: (code, message) => new MappedError(code, message),
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    const error = await client.getSelf('jwt').then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MappedError);
    expect(error).toMatchObject({ code: 'network', message: '无法连接账号服务器' });
  });
});
