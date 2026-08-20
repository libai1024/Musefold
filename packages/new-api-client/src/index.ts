// 共享 new-api REST 客户端：信封解析、JWT/refresh Cookie、公开定价与公告。
// 错误码保持短码（credentials/auth/…），供 web-api duck-type；桌面经 createError 映射成 RelayApiError。
// 设备令牌的 keychain/双栈写入属调用方编排，本包只提供 HTTP 面。

export type NewApiErrorCode = 'credentials' | 'conflict' | 'auth' | 'redeem' | 'network' | 'server';

export class NewApiClientError extends Error {
  constructor(
    readonly code: NewApiErrorCode,
    message: string,
    readonly httpStatus: number | null = null,
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
}

export interface RelayApiToken {
  id: number;
  name: string;
  /** 1=启用 2=禁用 3=过期 4=耗尽 */
  status: number;
  /** 列表接口返回的掩码 key，仅供展示 */
  keyMasked: string;
}

export interface RelayModelPricing {
  modelName: string;
  /** 0 = 按量（ratio），1 = 按次（price） */
  quotaType: 0 | 1;
  modelRatio: number;
  completionRatio: number;
  /** 按次单价（美元/次）；点数 = modelPrice × 500000 */
  modelPrice: number;
  enableGroups: string[];
}

export interface RelayPricing {
  /** pricing_version 指纹：未变化可跳过应用 */
  version: string;
  groupRatio: Record<string, number>;
  models: RelayModelPricing[];
}

export interface RelayNotice {
  id: string;
  content: string;
  publishedAt: number | null;
}

export interface NewApiClient {
  register(input: { username: string; password: string }): Promise<void>;
  login(input: { username: string; password: string }): Promise<RelayAuthSession>;
  refresh(refreshToken: string): Promise<RelayAuthSession>;
  getSelf(jwt: string): Promise<RelayUser>;
  listUserModels(jwt: string): Promise<string[]>;
  createToken(jwt: string, input: { name: string }): Promise<void>;
  listTokens(jwt: string): Promise<RelayApiToken[]>;
  fetchTokenKey(jwt: string, tokenId: number): Promise<string>;
  redeem(jwt: string, code: string): Promise<{ quotaAdded: number }>;
  getPricing(): Promise<RelayPricing>;
  getNotices(): Promise<RelayNotice[]>;
}

export interface NewApiClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * 构造器级错误工厂。默认抛 NewApiClientError。
   * 桌面注入 RelayApiError，避免逐方法适配层。
   */
  createError?: (code: NewApiErrorCode, message: string, httpStatus: number | null) => Error;
}

interface Envelope {
  success?: boolean;
  message?: string;
  data?: unknown;
}

const REFRESH_COOKIE = 'new_api_refresh';

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
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new NewApiClientError('server', '账号服务器地址不符合安全约束');
  }
  url.pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function createNewApiClient(serverUrl: string, options: NewApiClientOptions = {}): NewApiClient {
  const base = normalizeNewApiUrl(serverUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  function fail(code: NewApiErrorCode, message: string, httpStatus: number | null = null): never {
    throw (options.createError ?? ((c, m, s) => new NewApiClientError(c, m, s)))(code, message, httpStatus);
  }

  async function request(
    method: 'GET' | 'POST',
    path: string,
    init: { body?: unknown; jwt?: string; cookie?: string } = {},
  ): Promise<{ envelope: Envelope; response: Response }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (init.jwt) headers.Authorization = `Bearer ${init.jwt}`;
      if (init.cookie) headers.Cookie = init.cookie;
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError';
      fail('network', aborted ? '连接账号服务器超时' : '无法连接账号服务器');
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 500) {
      fail('server', `账号服务器错误（${response.status}）`, response.status);
    }
    let envelope: Envelope;
    try {
      envelope = await response.json() as Envelope;
    } catch {
      fail('server', '账号服务器响应无法解析', response.status);
    }
    return { envelope, response };
  }

  function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  }

  function user(value: unknown): RelayUser {
    const data = record(value);
    return {
      id: Number(data.id ?? 0),
      username: String(data.username ?? ''),
      quota: Math.max(0, Number(data.quota ?? 0)),
      group: String(data.group ?? 'default'),
    };
  }

  function extractRefreshToken(response: Response): string | null {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const cookies = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : ([headers.get('set-cookie')].filter(Boolean) as string[]);
    for (const cookie of cookies) {
      const match = /(?:^|,\s*)new_api_refresh=([^;]+)/.exec(cookie) ?? new RegExp(`${REFRESH_COOKIE}=([^;]+)`).exec(cookie);
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
    };
  }

  function assertSuccess(envelope: Envelope, response: Response, fallback: NewApiErrorCode, message: string): void {
    if (envelope.success) return;
    fail(fallback, envelope.message || message, response.status);
  }

  return {
    async register(input) {
      const { envelope, response } = await request('POST', '/api/user/register', { body: input });
      if (envelope.success) return;
      const message = envelope.message || '注册失败';
      const conflict = /已存在|已被|exist|taken|duplicate/i.test(message);
      fail(conflict ? 'conflict' : 'credentials', message, response.status);
    },
    async login(input) {
      const { envelope, response } = await request('POST', '/api/user/login', { body: input });
      if (!envelope.success) {
        const message = envelope.message || '用户名或密码不正确';
        const needs2fa = /2fa|两步|二步|totp|passkey/i.test(message);
        fail(
          'credentials',
          needs2fa ? '该账号开启了两步验证，请使用网页控制台登录后关闭，再在 App 内登录' : message,
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
        fail('auth', envelope.message || '登录状态已失效，请重新登录', response.status);
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
      if (response.status === 401) fail('auth', '登录状态已失效', 401);
      assertSuccess(envelope, response, 'server', '获取模型列表失败');
      return Array.isArray(envelope.data) ? envelope.data.map(String) : [];
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
      const items = Array.isArray(data.items) ? data.items : Array.isArray(envelope.data) ? envelope.data : [];
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
      const { envelope, response } = await request('POST', `/api/token/${tokenId}/key`, { jwt, body: {} });
      if (response.status === 401) fail('auth', '登录状态已失效', 401);
      const key = String(record(envelope.data).key ?? '');
      if (!envelope.success || !key) fail('server', envelope.message || '取回令牌失败', response.status);
      return key.startsWith('sk-') ? key : `sk-${key}`;
    },
    async redeem(jwt, code) {
      const { envelope, response } = await request('POST', '/api/user/topup', { jwt, body: { key: code } });
      if (response.status === 401) fail('auth', '登录状态已失效', 401);
      if (!envelope.success) fail('redeem', '兑换失败，请检查兑换码后重试', response.status);
      return { quotaAdded: Number(envelope.data ?? 0) };
    },
    async getPricing() {
      const { envelope, response } = await request('GET', '/api/pricing');
      assertSuccess(envelope, response, 'server', '获取定价失败');
      const root = record(envelope as unknown);
      const models = (Array.isArray(envelope.data) ? envelope.data : []).map((item) => {
        const row = record(item);
        return {
          modelName: String(row.model_name ?? ''),
          quotaType: (Number(row.quota_type ?? 0) === 1 ? 1 : 0) as 0 | 1,
          modelRatio: Number(row.model_ratio ?? 0),
          completionRatio: Number(row.completion_ratio ?? 0),
          modelPrice: Number(row.model_price ?? 0),
          enableGroups: Array.isArray(row.enable_groups) ? row.enable_groups.map(String) : [],
        };
      });
      return {
        version: String(root.pricing_version ?? ''),
        groupRatio: record(root.group_ratio) as Record<string, number>,
        models,
      };
    },
    async getNotices() {
      const notices: RelayNotice[] = [];
      try {
        const { envelope } = await request('GET', '/api/status');
        const data = record(envelope.data);
        const announcements = Array.isArray(data.announcements) ? data.announcements : [];
        for (const entry of announcements) {
          if (typeof entry === 'string' && entry.trim()) {
            notices.push({ id: noticeId(entry), content: entry.trim(), publishedAt: null });
          } else {
            const row = record(entry);
            const content = String(row.content ?? row.text ?? '').trim();
            if (!content) continue;
            const at = row.publishDate ?? row.publish_date ?? row.time ?? null;
            const publishedAt = at ? Date.parse(String(at)) || null : null;
            notices.push({ id: noticeId(content), content, publishedAt });
          }
        }
      } catch {
        /* 公告是增强信息：状态接口失败不阻塞任何账号操作 */
      }
      try {
        const { envelope } = await request('GET', '/api/notice');
        const content = typeof envelope.data === 'string' ? envelope.data.trim() : '';
        if (content && !notices.some((item) => item.id === noticeId(content))) {
          notices.push({ id: noticeId(content), content, publishedAt: null });
        }
      } catch {
        /* 同上 */
      }
      return notices;
    },
  };
}
