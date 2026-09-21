// 共享 new-api REST 客户端：信封解析、JWT/refresh Cookie、公开定价与公告。
// 错误码保持短码（credentials/auth/…），供 web-api duck-type；桌面经 createError 映射成 RelayApiError。
// 设备令牌的 keychain/双栈写入属调用方编排，本包只提供 HTTP 面。

import {
  cloudModelNamesSchema,
  newApiPricingResponseSchema,
  type RelayPricing,
} from '@musefold/contracts/cloud-model-pricing';
import {
  type RelayLoginGrant,
  type RelayLoginReview,
  type RelaySessionPage,
  type RelaySessionSelection,
  relayLoginGrantSchema,
  relayLoginReviewSchema,
  relaySessionPageSchema,
  relaySessionReleaseSchema,
  relaySessionsRevokeSchema,
  relayRevokedSessionIdsSchema,
} from '@musefold/contracts/relay-login-sessions';
export type { RelayModelPricing, RelayPricing } from '@musefold/contracts/cloud-model-pricing';
import { accountNoticeListSchema, type AccountNotice } from '@musefold/contracts/account-notices';

export type NewApiErrorCode =
  | 'credentials'
  | 'conflict'
  | 'auth'
  | 'redeem'
  | 'network'
  | 'server'
  | 'AUTH_2FA_REQUIRED'
  | 'AUTH_SESSION_LIMIT'
  | 'AUTH_SESSION_ISSUANCE_LIMIT'
  | 'AUTH_SESSION_REVIEW_CHANGED'
  | 'AUTH_LOGIN_CHALLENGE_EXPIRED'
  | 'AUTH_OPERATION_CONFLICT'
  | 'AUTH_SESSION_MANAGEMENT_UNAVAILABLE';

export class NewApiClientError extends Error {
  constructor(
    readonly code: NewApiErrorCode,
    message: string,
    readonly httpStatus: number | null = null,
    readonly retryAt: string | null = null,
  ) {
    super(message);
    this.name = 'NewApiClientError';
  }
}

export interface RelayUser {
  id: number;
  username: string;
  /** 余额（点；500000 点 = $1） */
  quota: number;
  group: string;
}

export interface RelayAuthSession {
  jwt: string;
  jwtExpiresAt: number;
  refreshToken: string;
  user: RelayUser;
  /** Revoke-only, stable across refresh. Kept encrypted server-side. */
  cleanup?: { sid: string; token: string };
  /** Server-only fixed-selection revocation receipt, including exact replay. */
  revokedSessionIds?: string[];
}

export interface RelayApiToken {
  id: number;
  name: string;
  /** 1=启用 2=禁用 3=过期 4=耗尽 */
  status: number;
  /** 列表接口返回的掩码 key，仅供展示 */
  keyMasked: string;
}

export type RelayNotice = AccountNotice;

export interface NewApiClient {
  managedSessions?: {
    begin(input: {
      username: string;
      password: string;
      twoFactorCode?: string;
    }): Promise<RelayLoginGrant>;
    review(token: string): Promise<RelayLoginReview>;
    complete(
      token: string,
      operation: string,
      selected: RelaySessionSelection[],
      userAgent?: string,
    ): Promise<RelayAuthSession>;
    cancel(token: string): Promise<void>;
    release(input: { sid: string; token: string }): Promise<void>;
    list(jwt: string): Promise<RelaySessionPage>;
    touch(jwt: string, activate: boolean): Promise<void>;
    revoke(
      jwt: string,
      input: {
        operationId: string;
        selected: RelaySessionSelection[];
        password?: string;
        twoFactorCode?: string;
      },
    ): Promise<number>;
  };
  logout?(input: { jwt: string; refreshToken: string }): Promise<void>;
  register(input: { username: string; password: string }): Promise<void>;
  login(input: { username: string; password: string }): Promise<RelayAuthSession>;
  refresh(refreshToken: string): Promise<RelayAuthSession>;
  getSelf(jwt: string): Promise<RelayUser>;
  listUserModels(jwt: string): Promise<string[]>;
  createToken(jwt: string, input: { name: string }): Promise<void>;
  listTokens(jwt: string): Promise<RelayApiToken[]>;
  fetchTokenKey(jwt: string, tokenId: number): Promise<string>;
  redeem(jwt: string, code: string): Promise<{ quotaAdded: number }>;
  /** Pass the verified account JWT for account-specific group ratios; omit only for public data. */
  getPricing(jwt?: string): Promise<RelayPricing>;
  getNotices(options?: { strict?: boolean }): Promise<RelayNotice[]>;
}

export interface NewApiClientOptions {
  fetchImpl?: typeof fetch;
  /** 完整响应（含响应体）的 deadline，默认 10 秒。 */
  timeoutMs?: number;
  /** 实际响应体字节上限；只能收紧默认 2 MiB 上限。 */
  maxResponseBytes?: number;
  /**
   * 构造器级错误工厂。默认抛 NewApiClientError。
   * 桌面注入 RelayApiError，避免逐方法适配层。
   */
  createError?: (code: NewApiErrorCode, message: string, httpStatus: number | null) => Error;
}

interface Envelope {
  code?: string;
  retry_at?: unknown;
  success?: boolean;
  message?: string;
  data?: unknown;
}

const REFRESH_COOKIE = 'new_api_refresh';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** 内容哈希派生稳定公告 id（djb2），用于已读记忆。 */
export function noticeId(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i += 1) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) >>> 0;
  }
  return `n-${hash.toString(36)}`;
}

export function normalizeNewApiUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new NewApiClientError('server', '账号服务器地址不是有效 URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new NewApiClientError('server', '账号服务器地址不符合安全约束');
  }
  url.pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function createNewApiClient(
  serverUrl: string,
  options: NewApiClientOptions = {},
): NewApiClient {
  const base = normalizeNewApiUrl(serverUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new NewApiClientError('server', '账号服务器超时配置无效');
  }
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes <= 0 ||
    maxResponseBytes > MAX_RESPONSE_BYTES
  ) {
    throw new NewApiClientError('server', '账号服务器响应大小配置无效');
  }

  function fail(
    code: NewApiErrorCode,
    message: string,
    httpStatus: number | null = null,
    retryAt: string | null = null,
  ): never {
    const error = (options.createError ?? ((c, m, s) => new NewApiClientError(c, m, s, retryAt)))(
      code,
      message,
      httpStatus,
    );
    if (retryAt) Object.assign(error, { retryAt });
    throw error;
  }

  async function request(
    method: 'GET' | 'POST',
    path: string,
    init: { body?: unknown; jwt?: string; cookie?: string; userAgent?: string } = {},
  ): Promise<{ envelope: Envelope; response: Response }> {
    const controller = new AbortController();
    const deadlineAt = performance.now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let completed = false;

    function checkDeadline(): void {
      if (performance.now() >= deadlineAt) controller.abort();
      controller.signal.throwIfAborted();
    }

    async function beforeDeadline<T>(operation: Promise<T>): Promise<T> {
      let onAbort: (() => void) | undefined;
      try {
        return await Promise.race([
          operation,
          new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', onAbort, { once: true });
            if (controller.signal.aborted) onAbort();
          }),
        ]);
      } finally {
        if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      }
    }

    function discard(body: ReadableStream<Uint8Array> | null): void {
      // Abort/cancel 不等待不可信的自定义 stream 清理回调，避免清理本身绕过 deadline。
      try {
        void body?.cancel().catch(() => undefined);
      } catch {
        // 清理失败不能覆盖已脱敏的业务错误。
      }
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (init.jwt) headers.Authorization = `Bearer ${init.jwt}`;
      if (init.cookie) headers.Cookie = init.cookie;
      if (init.userAgent) headers['User-Agent'] = init.userAgent;
      try {
        const pending = Promise.resolve().then(() => {
          checkDeadline();
          return fetchImpl(`${base}${path}`, {
            method,
            headers,
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
            redirect: 'error',
            signal: controller.signal,
          });
        });
        // 注入的 fetch 即使不遵守 AbortSignal，迟到的响应也必须释放。
        void pending.then(
          (late) => {
            if (controller.signal.aborted) discard(late.body);
          },
          () => undefined,
        );
        response = await beforeDeadline(pending);
        checkDeadline();
      } catch (error) {
        const aborted = controller.signal.aborted || (error as Error)?.name === 'AbortError';
        fail('network', aborted ? '连接账号服务器超时' : '无法连接账号服务器');
      }

      if (response.status === 404 && path.startsWith('/api/user/managed'))
        fail('AUTH_SESSION_MANAGEMENT_UNAVAILABLE', '账号服务器尚未支持登录设备管理', 404);
      if (response.status === 429 && !path.startsWith('/api/user/managed')) {
        fail('network', '账号服务器请求过于频繁，请稍后再试', 429);
      }
      if (response.status >= 500) {
        fail('server', `账号服务器错误（${response.status}）`, response.status);
      }
      const declaredSize = response.headers.get('content-length');
      if (declaredSize !== null && Number(declaredSize) > maxResponseBytes) {
        fail('server', '账号服务器响应超过大小限制', response.status);
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let tooLarge = false;
      try {
        reader = response.body?.getReader();
        while (reader) {
          checkDeadline();
          const { done, value } = await beforeDeadline(reader.read());
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > maxResponseBytes) {
            tooLarge = true;
            break;
          }
          chunks.push(value);
        }
        checkDeadline();
      } catch {
        fail(
          'network',
          controller.signal.aborted ? '连接账号服务器超时' : '账号服务器响应传输中断',
          response.status,
        );
      }
      if (tooLarge) fail('server', '账号服务器响应超过大小限制', response.status);

      let parsed: unknown;
      try {
        const bytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        if (response.status === 429) {
          fail('network', '账号服务器请求过于频繁，请稍后再试', 429);
        }
        fail('server', '账号服务器响应无法解析', response.status);
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        ('success' in parsed && typeof parsed.success !== 'boolean') ||
        ('message' in parsed && typeof parsed.message !== 'string')
      ) {
        fail('server', '账号服务器响应无法解析', response.status);
      }
      if (performance.now() >= deadlineAt) fail('network', '连接账号服务器超时', response.status);
      completed = true;
      return { envelope: parsed as Envelope, response };
    } finally {
      clearTimeout(timer);
      if (!completed) controller.abort();
      if (reader) {
        if (!completed) void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      } else if (response) {
        discard(response.body);
      }
    }
  }

  function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  function user(value: unknown): RelayUser {
    const data = record(value);
    return {
      id: Number(data.id ?? 0),
      username: String(data.username ?? ''),
      quota: Math.max(0, Number(data.quota ?? 0)),
      // Missing group cannot silently become a differently priced account group.
      group: typeof data.group === 'string' ? data.group : '',
    };
  }

  function extractRefreshToken(response: Response): string | null {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const cookies =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : ([headers.get('set-cookie')].filter(Boolean) as string[]);
    for (const cookie of cookies) {
      const match =
        /(?:^|,\s*)new_api_refresh=([^;]+)/.exec(cookie) ??
        new RegExp(`${REFRESH_COOKIE}=([^;]+)`).exec(cookie);
      if (match?.[1]) return match[1];
    }
    return null;
  }

  function session(envelope: Envelope, response: Response, fallback?: string): RelayAuthSession {
    const data = record(envelope.data);
    const jwt = typeof data.access_token === 'string' ? data.access_token : '';
    if (!jwt) fail('server', '登录响应缺少 access_token');
    const refreshToken = extractRefreshToken(response) ?? fallback ?? '';
    if (!refreshToken) fail('server', '登录响应缺少 refresh 凭据');
    return {
      jwt,
      jwtExpiresAt: Number(data.access_expires_at ?? 0),
      refreshToken,
      user: user(data.user),
      ...(typeof data.cleanup_token === 'string' &&
      /^[a-f0-9]{64}$/.test(data.cleanup_token) &&
      typeof record(data.session).sid === 'string'
        ? { cleanup: { sid: String(record(data.session).sid), token: data.cleanup_token } }
        : {}),
    };
  }

  function assertSuccess(
    envelope: Envelope,
    response: Response,
    fallback: NewApiErrorCode,
    message: string,
  ): void {
    if (envelope.success) return;
    fail(fallback, message, response.status);
  }

  async function managedRequest(
    path: string,
    input: { body?: unknown; jwt?: string; userAgent?: string },
    method: 'GET' | 'POST' = 'POST',
  ) {
    const result = await request(method, path, input);
    const { envelope, response } = result;
    if (response.ok && envelope.success === true) return result;
    const codes = new Set<NewApiErrorCode>([
      'AUTH_2FA_REQUIRED',
      'AUTH_SESSION_LIMIT',
      'AUTH_SESSION_ISSUANCE_LIMIT',
      'AUTH_SESSION_REVIEW_CHANGED',
      'AUTH_LOGIN_CHALLENGE_EXPIRED',
      'AUTH_OPERATION_CONFLICT',
    ]);
    if (typeof envelope.code === 'string' && codes.has(envelope.code as NewApiErrorCode)) {
      const seconds = envelope.retry_at;
      const retryAt =
        envelope.code === 'AUTH_SESSION_ISSUANCE_LIMIT' &&
        typeof seconds === 'number' &&
        Number.isSafeInteger(seconds) &&
        seconds > 0 &&
        seconds < 32_503_680_000
          ? new Date(seconds * 1000).toISOString()
          : null;
      fail(
        envelope.code as NewApiErrorCode,
        '登录设备操作未完成，请核对后重试',
        response.status,
        retryAt,
      );
    }
    if (envelope.code === 'AUTH_CREDENTIALS_INVALID')
      fail('credentials', '用户名或密码不正确', response.status);
    if (response.status === 401 || response.status === 403)
      fail('auth', '登录验证已失效，请重新登录', response.status);
    if (response.status === 429) fail('network', '操作过于频繁，请稍后重试', response.status);
    fail('server', '账号服务器登录设备操作未完成', response.status);
  }

  return {
    managedSessions: {
      async begin(input) {
        const { envelope, response } = await managedRequest('/api/user/managed-login/begin', {
          body: { username: input.username, password: input.password, code: input.twoFactorCode },
        });
        const parsed = relayLoginGrantSchema.safeParse(envelope.data);
        if (!parsed.success) fail('server', '账号服务器登录验证响应无效', response.status);
        return parsed.data;
      },
      async review(token) {
        const { envelope } = await managedRequest('/api/user/managed-login/review', {
          body: { flow_token: token },
        });
        const parsed = relayLoginReviewSchema.safeParse(envelope.data);
        if (!parsed.success) fail('server', '账号服务器会话响应无效');
        return parsed.data;
      },
      async complete(token, operation, selected, userAgent) {
        const { envelope, response } = await managedRequest('/api/user/managed-login/complete', {
          body: { flow_token: token, operation, selected },
          userAgent,
        });
        const result = session(envelope, response);
        if (!result.cleanup) fail('server', '账号服务器缺少会话释放凭据');
        const revoked = relayRevokedSessionIdsSchema.safeParse(
          record(envelope.data).revoked_session_ids,
        );
        if (
          !revoked.success ||
          revoked.data.some((sid) => !selected.some((item) => item.sid === sid))
        )
          fail('server', '账号服务器会话撤销回执无效');
        result.revokedSessionIds = revoked.data;
        return result;
      },
      async cancel(token) {
        await managedRequest('/api/user/managed-login/cancel', { body: { flow_token: token } });
      },
      async release(input) {
        const { envelope } = await managedRequest('/api/user/managed-login/release', {
          body: { sid: input.sid, cleanup_token: input.token },
        });
        if (!relaySessionReleaseSchema.safeParse(envelope.data).success)
          fail('server', '远端会话释放尚未确认');
      },
      async list(jwt) {
        const { envelope } = await managedRequest('/api/user/managed-sessions', { jwt }, 'GET');
        const parsed = relaySessionPageSchema.safeParse(envelope.data);
        if (!parsed.success) fail('server', '账号服务器会话列表无效');
        return parsed.data;
      },
      async touch(jwt, activate) {
        await managedRequest('/api/user/managed-sessions/touch', { jwt, body: { activate } });
      },
      async revoke(jwt, input) {
        const { envelope } = await managedRequest('/api/user/managed-sessions/revoke', {
          jwt,
          body: {
            operation: input.operationId,
            selected: input.selected,
            password: input.password,
            code: input.twoFactorCode,
          },
        });
        const parsed = relaySessionsRevokeSchema.safeParse(envelope.data);
        if (!parsed.success) fail('server', '远端会话释放尚未确认');
        return parsed.data.revoked_count;
      },
    },
    async logout(input) {
      const { envelope, response } = await request('POST', '/api/user/auth/logout', {
        jwt: input.jwt,
        cookie: `${REFRESH_COOKIE}=${input.refreshToken}`,
        body: {},
      });
      assertSuccess(envelope, response, 'server', '远端退出尚未确认');
    },
    async register(input) {
      const { envelope, response } = await request('POST', '/api/user/register', { body: input });
      if (envelope.success) return;
      const message = envelope.message || '注册失败';
      const conflict = /已存在|已被|exist|taken|duplicate/i.test(message);
      fail(
        conflict ? 'conflict' : 'credentials',
        conflict ? '用户名已存在' : '注册失败',
        response.status,
      );
    },
    async login(input) {
      const { envelope, response } = await request('POST', '/api/user/login', { body: input });
      // Real upstreams can reject a concurrent login with 409, without evaluating
      // the password. Keep it retryable and never expose the upstream error body.
      if (response.status === 409)
        fail('server', '账号服务器登录冲突，请稍后重试', response.status);
      if (!envelope.success) {
        const message = envelope.message || '用户名或密码不正确';
        const needs2fa = /2fa|两步|二步|totp|passkey/i.test(message);
        fail(
          'credentials',
          needs2fa
            ? '该账号开启了两步验证，请使用网页控制台登录后关闭，再在 App 内登录'
            : '用户名或密码不正确',
          response.status,
        );
      }
      return session(envelope, response);
    },
    async refresh(token) {
      const { envelope, response } = await request('POST', '/api/user/auth/refresh', {
        cookie: `${REFRESH_COOKIE}=${token}`,
      });
      if (response.status === 401 || response.status === 403 || !envelope.success) {
        fail('auth', '登录状态已失效，请重新登录', response.status);
      }
      return session(envelope, response, token);
    },
    async getSelf(jwt) {
      const { envelope, response } = await request('GET', '/api/user/self', { jwt });
      if (response.status === 401) fail('auth', '登录状态已失效', 401);
      assertSuccess(envelope, response, 'server', '获取账号信息失败');
      return user(envelope.data);
    },
    async listUserModels(jwt) {
      const { envelope, response } = await request('GET', '/api/user/models', { jwt });
      if (response.status === 401 || response.status === 403)
        fail('auth', '登录状态已失效', response.status);
      assertSuccess(envelope, response, 'server', '获取模型列表失败');
      const parsed = cloudModelNamesSchema.safeParse(envelope.data);
      if (!parsed.success) fail('server', '账号服务器模型列表格式无效', response.status);
      return parsed.data;
    },
    async createToken(jwt, input) {
      const { envelope, response } = await request('POST', '/api/token/', {
        jwt,
        body: { ...input, remain_quota: 0, unlimited_quota: true, expired_time: -1 },
      });
      if (response.status === 401) fail('auth', '登录状态已失效', 401);
      assertSuccess(envelope, response, 'server', '创建设备令牌失败');
    },
    async listTokens(jwt) {
      const { envelope, response } = await request('GET', '/api/token/?p=0&page_size=20', { jwt });
      if (response.status === 401) fail('auth', '登录状态已失效', 401);
      assertSuccess(envelope, response, 'server', '获取令牌列表失败');
      const data = record(envelope.data);
      const items = Array.isArray(data.items)
        ? data.items
        : Array.isArray(envelope.data)
          ? envelope.data
          : [];
      return items.map((item) => {
        const token = record(item);
        return {
          id: Number(token.id ?? 0),
          name: String(token.name ?? ''),
          status: Number(token.status ?? 0),
          keyMasked: String(token.key ?? ''),
        };
      });
    },
    async fetchTokenKey(jwt, tokenId) {
      const { envelope, response } = await request('POST', `/api/token/${tokenId}/key`, {
        jwt,
        body: {},
      });
      if (response.status === 401) fail('auth', '登录状态已失效', 401);
      const key = String(record(envelope.data).key ?? '');
      if (!envelope.success || !key) fail('server', '取回令牌失败', response.status);
      return key.startsWith('sk-') ? key : `sk-${key}`;
    },
    async redeem(jwt, code) {
      const { envelope, response } = await request('POST', '/api/user/topup', {
        jwt,
        body: { key: code },
      });
      if (response.status === 401) fail('auth', '登录状态已失效', 401);
      if (!envelope.success) fail('redeem', '兑换失败，请检查兑换码后重试', response.status);
      return { quotaAdded: Number(envelope.data ?? 0) };
    },
    async getPricing(jwt) {
      const { envelope, response } = await request('GET', '/api/pricing', { jwt });
      if (response.status === 401 || response.status === 403)
        fail('auth', '登录状态已失效', response.status);
      assertSuccess(envelope, response, 'server', '获取定价失败');
      const parsed = newApiPricingResponseSchema.safeParse(envelope);
      // Never expose Zod input/error details: an upstream response may contain private data.
      if (!parsed.success) fail('server', '账号服务器定价格式无效', response.status);
      const root = parsed.data;
      return {
        version: root.pricing_version ?? '',
        groupRatio: root.group_ratio,
        models: root.data.map((row) => ({
          modelName: row.model_name,
          quotaType: row.quota_type,
          modelRatio: row.model_ratio ?? null,
          completionRatio: row.completion_ratio ?? null,
          modelPrice: row.model_price ?? null,
          enableGroups: row.enable_groups,
          supportedEndpointTypes: row.supported_endpoint_types ?? [],
          billingMode: row.billing_mode || null,
        })),
      };
    },
    async getNotices(options) {
      const notices: RelayNotice[] = [];
      const append = (content: unknown, at: unknown = null, legacyId?: string) => {
        if (typeof content !== 'string') fail('server', '账号服务器公告格式无效');
        const text = (content as string).trim();
        if (!text) return;
        const parsedAt = at === null ? Number.NaN : Date.parse(String(at));
        const item: RelayNotice = {
          id: noticeId(text),
          content: text,
          publishedAt: Number.isFinite(parsedAt) && parsedAt >= 0 ? parsedAt : null,
        };
        const existing = notices.find(
          (notice) => notice.id === item.id && notice.content === item.content,
        );
        const target = existing ?? item;
        if (legacyId && legacyId !== target.id)
          target.legacyReadIds = [...new Set([...(target.legacyReadIds ?? []), legacyId])];
        if (!existing) notices.push(item);
        if (!accountNoticeListSchema.safeParse(notices).success)
          fail('server', '账号服务器公告格式无效');
      };
      try {
        const { envelope, response } = await request('GET', '/api/status');
        assertSuccess(envelope, response, 'server', '读取服务公告失败');
        const data = record(envelope.data);
        if (data.announcements !== undefined && !Array.isArray(data.announcements))
          fail('server', '账号服务器公告格式无效');
        const announcements = Array.isArray(data.announcements) ? data.announcements : [];
        for (const entry of announcements) {
          if (typeof entry === 'string') {
            append(entry, null, noticeId(entry));
          } else {
            const row = record(entry);
            append(
              row.content ?? row.text,
              row.publishDate ?? row.publish_date ?? row.time ?? null,
            );
          }
        }
      } catch (error) {
        if (options?.strict) throw error;
      }
      try {
        const { envelope, response } = await request('GET', '/api/notice');
        assertSuccess(envelope, response, 'server', '读取服务公告失败');
        append(envelope.data);
      } catch (error) {
        if (options?.strict) throw error;
      }
      // Legacy best-effort callers still cannot fail their account/login operation.
      return accountNoticeListSchema.safeParse(notices).success ? notices : [];
    },
  };
}
