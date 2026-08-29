// providers 域桥守护:「测试连接」探测请求的结果翻译(§7.2)。
// probeProvider 纯函数(fetch 注入),不触 SQLite;electron 仅为 import 链 mock。

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../security/keychain', () => ({
  saveApiKey: vi.fn(),
  loadApiKey: vi.fn(() => null),
  deleteApiKey: vi.fn(),
  hasApiKey: vi.fn(() => false),
  getKeySuffix: vi.fn(() => null),
}));

import { probeProvider } from '../providers-domain';

function fetchReturning(status: number): typeof fetch {
  return vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch;
}

describe('probeProvider(测试连接)', () => {
  it('200 → 连接正常并带延迟;请求打到 /models 且带 bearer', async () => {
    const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://gw.test/v1/models');
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBe('Bearer sk-test');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const result = await probeProvider('https://gw.test/v1/', 'sk-test', impl);
    expect(result.ok).toBe(true);
    expect(result.message).toBe('连接正常');
    expect(result.latencyMs).not.toBeNull();
  });

  it('401/403 → 密钥无效;其他非 2xx → HTTP 状态码', async () => {
    expect((await probeProvider('https://gw.test/v1', null, fetchReturning(401))).message).toBe(
      'API Key 无效或无权限',
    );
    expect((await probeProvider('https://gw.test/v1', null, fetchReturning(500))).message).toBe(
      '服务返回 HTTP 500',
    );
  });

  it('超时与网络错误 → 可读引导文案', async () => {
    const timeoutError = new Error('timed out');
    timeoutError.name = 'TimeoutError';
    const timeoutFetch = vi.fn(async () => {
      throw timeoutError;
    }) as unknown as typeof fetch;
    const timedOut = await probeProvider('https://gw.test/v1', null, timeoutFetch);
    expect(timedOut).toMatchObject({ ok: false, latencyMs: null });
    expect(timedOut.message).toContain('超时');

    const networkFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const failed = await probeProvider('https://gw.test/v1', null, networkFetch);
    expect(failed.message).toContain('无法连接');
  });
});
