// V05-ACC-01 契约测试：golden 驱动（fixtures 取自 2026-08-13 生产实测）。
// 契约变更必须先改 golden 再改实现（契约先行纪律）。

import { describe, expect, it, vi } from 'vitest';
import authGolden from '../../../../../tests/fixtures/newapi/auth-golden.json';
import redemptionGolden from '../../../../../tests/fixtures/newapi/redemption-golden.json';
import { createNewApiClient, noticeId, normalizeAccountServerUrl, RelayApiError } from '../api-client';

const BASE = 'https://relay.test';

type GoldenCase = { status: number; set_cookie?: string; body: unknown };

function responseOf(golden: GoldenCase): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (golden.set_cookie) headers.append('set-cookie', golden.set_cookie);
  return new Response(JSON.stringify(golden.body), { status: golden.status, headers });
}

/** 按 `${method} ${path}` 路由 golden 响应的 mock fetch；记录请求供断言。 */
function goldenFetch(routes: Record<string, GoldenCase>) {
  const calls: Array<{ method: string; path: string; headers: Record<string, string>; body: unknown }> = [];
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    expect(url.startsWith(BASE)).toBe(true);
    const path = url.slice(BASE.length);
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      path,
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const golden = routes[`${method} ${path}`];
    if (!golden) throw new Error(`golden 路由缺失: ${method} ${path}`);
    return responseOf(golden);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const AUTH = authGolden.cases as Record<string, GoldenCase>;
const REDEEM = redemptionGolden.cases as Record<string, { status: number; body: unknown }>;

async function expectRelayError(promise: Promise<unknown>, code: string): Promise<RelayApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RelayApiError);
  expect((error as RelayApiError).code).toBe(code);
  return error as RelayApiError;
}

describe('normalizeAccountServerUrl', () => {
  it('剥离尾斜杠并保留路径前缀', () => {
    expect(normalizeAccountServerUrl('https://relay.test/')).toBe('https://relay.test');
    expect(normalizeAccountServerUrl('https://relay.test/sub/')).toBe('https://relay.test/sub');
  });

  it('拒绝非 http(s)、内嵌凭据与查询参数', () => {
    expect(() => normalizeAccountServerUrl('ftp://x')).toThrow(RelayApiError);
    expect(() => normalizeAccountServerUrl('https://user:pw@x.test')).toThrow(RelayApiError);
    expect(() => normalizeAccountServerUrl('https://x.test/?a=1')).toThrow(RelayApiError);
  });
});

describe('login', () => {
  it('成功：解析 JWT + user，并从 Set-Cookie 提取 refresh 凭据', async () => {
    const { impl, calls } = goldenFetch({ 'POST /api/user/login': AUTH.login_success });
    const client = createNewApiClient(BASE, { fetchImpl: impl });
    const session = await client.login({ username: 'smoke01', password: 'pw' });

    expect(session.jwt).toContain('eyJhbGciOiJIUzI1NiIs');
    expect(session.jwtExpiresAt).toBe(1786618510);
    expect(session.refreshToken).toBe(
      'dfb28cd2-7de6-4db7-995e-439666d24244.5G5PTJQeyDfrAl2IfponEKuVUvP4XusTxaRWeshRxY7l5z5VqJj7UuqERpTOPUsw',
    );
    expect(session.user).toMatchObject({ id: 4, username: 'smoke01', quota: 2468895, group: 'default' });
    expect(calls[0].body).toEqual({ username: 'smoke01', password: 'pw' });
  });

  it('凭据错误 → ACCOUNT/CREDENTIALS（message 用服务器原文）', async () => {
    const { impl } = goldenFetch({ 'POST /api/user/login': AUTH.login_bad_credentials });
    const client = createNewApiClient(BASE, { fetchImpl: impl });
    const error = await expectRelayError(client.login({ username: 'x', password: 'y' }), 'ACCOUNT/CREDENTIALS');
    expect(error.message).toBe('用户名或密码错误');
  });
});

describe('refresh（静默续期）', () => {
  it('成功：携带 Cookie 请求，返回新 JWT 与轮换后的 refresh 值', async () => {
    const { impl, calls } = goldenFetch({ 'POST /api/user/auth/refresh': AUTH.refresh_success_rotated });
    const client = createNewApiClient(BASE, { fetchImpl: impl });
    const session = await client.refresh('old-refresh-value');

    expect(calls[0].headers.Cookie).toBe('new_api_refresh=old-refresh-value');
    expect(session.jwt).toContain('ROTATED');
    expect(session.refreshToken).toMatch(/\.bd19f18a/);
    expect(session.refreshToken).not.toBe('old-refresh-value');
  });

  it('refresh 过期/吊销 → ACCOUNT/AUTH', async () => {
    const { impl } = goldenFetch({ 'POST /api/user/auth/refresh': AUTH.refresh_expired });
    const client = createNewApiClient(BASE, { fetchImpl: impl });
    await expectRelayError(client.refresh('stale'), 'ACCOUNT/AUTH');
  });
});

describe('设备令牌（OQ-01 冻结路径）', () => {
  it('列表返回掩码 key；POST /api/token/{id}/key 取回完整明文并归一化 sk- 前缀', async () => {
    const { impl, calls } = goldenFetch({
      'GET /api/token/?p=0&page_size=20': AUTH.token_list_masked,
      'POST /api/token/2/key': AUTH.token_key_full,
    });
    const client = createNewApiClient(BASE, { fetchImpl: impl });

    const tokens = await client.listTokens('jwt');
    expect(tokens).toEqual([{ id: 2, name: 'smoke-device', status: 1, keyMasked: 'tP1**********LmzM' }]);

    const key = await client.fetchTokenKey('jwt', 2);
    expect(key.startsWith('sk-')).toBe(true);
    expect(key.endsWith('LmzM')).toBe(true);
    expect(calls.every((c) => c.headers.Authorization === 'Bearer jwt')).toBe(true);
  });

  it('创建令牌固定为不限额度 + 永不过期（额度控制收敛在账号层）', async () => {
    const { impl, calls } = goldenFetch({ 'POST /api/token/': AUTH.token_create });
    const client = createNewApiClient(BASE, { fetchImpl: impl });
    await client.createToken('jwt', { name: 'musefold-mac-ab12' });
    expect(calls[0].body).toEqual({
      name: 'musefold-mac-ab12',
      remain_quota: 0,
      unlimited_quota: true,
      expired_time: -1,
    });
  });
});

describe('兑换（golden：redemption-golden.json）', () => {
  it('成功：data = 到账点数', async () => {
    const { impl } = goldenFetch({ 'POST /api/user/topup': REDEEM.redeem_success });
    const client = createNewApiClient(BASE, { fetchImpl: impl });
    await expect(client.redeem('jwt', 'CODE')).resolves.toEqual({ quotaAdded: 500000 });
  });

  it.each(['redeem_already_used', 'redeem_invalid', 'redeem_empty'] as const)(
    '失败统一映射 ACCOUNT/REDEEM_INVALID（服务器防枚举）：%s',
    async (name) => {
      const { impl } = goldenFetch({ 'POST /api/user/topup': REDEEM[name] });
      const client = createNewApiClient(BASE, { fetchImpl: impl });
      const error = await expectRelayError(client.redeem('jwt', 'X'), 'ACCOUNT/REDEEM_INVALID');
      expect(error.message).toBe('兑换失败，请检查兑换码后重试');
    },
  );
});

describe('定价与公告（公开接口）', () => {
  it('getPricing：解析 pricing_version 指纹与双计费类型', async () => {
    const { impl, calls } = goldenFetch({ 'GET /api/pricing': AUTH.pricing });
    const client = createNewApiClient(BASE, { fetchImpl: impl });
    const pricing = await client.getPricing();

    expect(pricing.version).toBe('5a9c');
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(pricing.models).toEqual([
      {
        modelName: 'musefold-agent',
        quotaType: 0,
        modelRatio: 2.5,
        completionRatio: 8,
        modelPrice: 0,
        enableGroups: ['default'],
      },
      {
        modelName: 'musefold-image-pro',
        quotaType: 1,
        modelRatio: 0,
        completionRatio: 0,
        modelPrice: 0.04,
        enableGroups: ['default'],
      },
    ]);
  });

  it('getNotices：status announcements 与 /api/notice 合并、稳定 id、失败不抛错', async () => {
    const { impl } = goldenFetch({
      'GET /api/status': AUTH.status_announcements,
      'GET /api/notice': AUTH.notice_markdown,
    });
    const client = createNewApiClient(BASE, { fetchImpl: impl });
    const notices = await client.getNotices();

    expect(notices).toHaveLength(2);
    expect(notices[0].content).toContain('服务器维护');
    expect(notices[0].publishedAt).toBe(Date.parse('2026-08-14T10:00:00Z'));
    expect(notices[1].content).toBe('欢迎使用 Musefold Cloud 内测。');
    expect(notices[0].id).toBe(noticeId(notices[0].content));

    const failing = createNewApiClient(BASE, {
      fetchImpl: (async () => {
        throw new Error('down');
      }) as unknown as typeof fetch,
    });
    await expect(failing.getNotices()).resolves.toEqual([]);
  });
});

describe('传输层错误分类', () => {
  it('网络失败 → ACCOUNT/NETWORK', async () => {
    const client = createNewApiClient(BASE, {
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expectRelayError(client.getSelf('jwt'), 'ACCOUNT/NETWORK');
  });

  it('超时 → ACCOUNT/NETWORK（AbortError 分支）', async () => {
    const client = createNewApiClient(BASE, {
      timeoutMs: 10,
      fetchImpl: ((_: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })) as unknown as typeof fetch,
    });
    const error = await expectRelayError(client.getSelf('jwt'), 'ACCOUNT/NETWORK');
    expect(error.message).toContain('超时');
  });

  it('5xx → ACCOUNT/SERVER（带状态码）', async () => {
    const { impl } = goldenFetch({
      'GET /api/user/self': { status: 502, body: { raw: 'bad gateway' } },
    });
    const client = createNewApiClient(BASE, { fetchImpl: impl });
    const error = await expectRelayError(client.getSelf('jwt'), 'ACCOUNT/SERVER');
    expect(error.httpStatus).toBe(502);
  });

  it('管理接口 401 → ACCOUNT/AUTH', async () => {
    const { impl } = goldenFetch({
      'GET /api/user/self': { status: 401, body: { success: false, message: 'Unauthorized' } },
    });
    const client = createNewApiClient(BASE, { fetchImpl: impl });
    await expectRelayError(client.getSelf('jwt'), 'ACCOUNT/AUTH');
  });
});

describe('register', () => {
  it('用户名占用 → ACCOUNT/CONFLICT', async () => {
    const { impl } = goldenFetch({
      'POST /api/user/register': { status: 200, body: { success: false, message: '用户名已存在！' } },
    });
    const client = createNewApiClient(BASE, { fetchImpl: impl });
    await expectRelayError(client.register({ username: 'a', password: 'b' }), 'ACCOUNT/CONFLICT');
  });

  it('其他校验失败 → ACCOUNT/CREDENTIALS', async () => {
    const { impl } = goldenFetch({
      'POST /api/user/register': { status: 200, body: { success: false, message: '密码长度至少为8个字符' } },
    });
    const client = createNewApiClient(BASE, { fetchImpl: impl });
    await expectRelayError(client.register({ username: 'a', password: 'b' }), 'ACCOUNT/CREDENTIALS');
  });
});
