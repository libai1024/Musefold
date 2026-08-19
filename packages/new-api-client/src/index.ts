export class NewApiClientError extends Error {
  constructor(
    readonly code: 'credentials' | 'conflict' | 'auth' | 'redeem' | 'network' | 'server',
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
  status: number;
  keyMasked: string;
}

export interface NewApiClient {
  register(input: { username: string; password: string }): Promise<void>;
  login(input: { username: string; password: string }): Promise<RelayAuthSession>;
  refresh(refreshToken: string): Promise<RelayAuthSession>;
  getSelf(jwt: string): Promise<RelayUser>;
  createToken(jwt: string, input: { name: string }): Promise<void>;
  listTokens(jwt: string): Promise<RelayApiToken[]>;
  fetchTokenKey(jwt: string, tokenId: number): Promise<string>;
  redeem(jwt: string, code: string): Promise<{ quotaAdded: number }>;
}

export interface NewApiClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface Envelope {
  success?: boolean;
  message?: string;
  data?: unknown;
}

const REFRESH_COOKIE = 'new_api_refresh';

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

  async function request(
    method: 'GET' | 'POST',
    path: string,
    init: { body?: unknown; jwt?: string; cookie?: string } = {},
  ): Promise<{ envelope: Envelope; response: Response }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (init.jwt) headers.Authorization = `Bearer ${init.jwt}`;
      if (init.cookie) headers.Cookie = init.cookie;
      const response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status >= 500) throw new NewApiClientError('server', '账号服务器暂时不可用', response.status);
      let envelope: Envelope;
      try {
        envelope = await response.json() as Envelope;
      } catch {
        throw new NewApiClientError('server', '账号服务器响应无法解析', response.status);
      }
      return { envelope, response };
    } catch (error) {
      if (error instanceof NewApiClientError) throw error;
      throw new NewApiClientError('network', '无法连接账号服务器');
    } finally {
      clearTimeout(timer);
    }
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

  function refreshToken(response: Response, fallback?: string): string {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const cookies = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : ([headers.get('set-cookie')].filter(Boolean) as string[]);
    for (const cookie of cookies) {
      const match = new RegExp(`${REFRESH_COOKIE}=([^;]+)`).exec(cookie);
      if (match?.[1]) return match[1];
    }
    if (fallback) return fallback;
    throw new NewApiClientError('server', '登录响应缺少 refresh 凭据');
  }

  function session(envelope: Envelope, response: Response, fallback?: string): RelayAuthSession {
    const data = record(envelope.data);
    const jwt = typeof data.access_token === 'string' ? data.access_token : '';
    if (!jwt) throw new NewApiClientError('server', '登录响应缺少 access_token');
    return {
      jwt,
      jwtExpiresAt: Number(data.access_expires_at ?? 0),
      refreshToken: refreshToken(response, fallback),
      user: user(data.user),
    };
  }

  function assertSuccess(envelope: Envelope, response: Response, fallback: NewApiClientError['code'], message: string): void {
    if (envelope.success) return;
    throw new NewApiClientError(fallback, envelope.message || message, response.status);
  }

  return {
    async register(input) {
      const { envelope, response } = await request('POST', '/api/user/register', { body: input });
      if (envelope.success) return;
      const conflict = /已存在|已被|exist|taken|duplicate/i.test(envelope.message ?? '');
      throw new NewApiClientError(conflict ? 'conflict' : 'credentials', envelope.message || '注册失败', response.status);
    },
    async login(input) {
      const { envelope, response } = await request('POST', '/api/user/login', { body: input });
      if (!envelope.success) throw new NewApiClientError('credentials', envelope.message || '用户名或密码不正确', response.status);
      return session(envelope, response);
    },
    async refresh(token) {
      const { envelope, response } = await request('POST', '/api/user/auth/refresh', {
        cookie: `${REFRESH_COOKIE}=${token}`,
      });
      if (response.status === 401 || response.status === 403 || !envelope.success) {
        throw new NewApiClientError('auth', '登录状态已失效，请重新登录', response.status);
      }
      return session(envelope, response, token);
    },
    async getSelf(jwt) {
      const { envelope, response } = await request('GET', '/api/user/self', { jwt });
      if (response.status === 401) throw new NewApiClientError('auth', '登录状态已失效', 401);
      assertSuccess(envelope, response, 'server', '获取账号信息失败');
      return user(envelope.data);
    },
    async createToken(jwt, input) {
      const { envelope, response } = await request('POST', '/api/token/', {
        jwt,
        body: { ...input, remain_quota: 0, unlimited_quota: true, expired_time: -1 },
      });
      if (response.status === 401) throw new NewApiClientError('auth', '登录状态已失效', 401);
      assertSuccess(envelope, response, 'server', '创建设备令牌失败');
    },
    async listTokens(jwt) {
      const { envelope, response } = await request('GET', '/api/token/?p=0&page_size=20', { jwt });
      if (response.status === 401) throw new NewApiClientError('auth', '登录状态已失效', 401);
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
      if (response.status === 401) throw new NewApiClientError('auth', '登录状态已失效', 401);
      const key = String(record(envelope.data).key ?? '');
      if (!envelope.success || !key) throw new NewApiClientError('server', envelope.message || '取回令牌失败', response.status);
      return key.startsWith('sk-') ? key : `sk-${key}`;
    },
    async redeem(jwt, code) {
      const { envelope, response } = await request('POST', '/api/user/topup', { jwt, body: { key: code } });
      if (response.status === 401) throw new NewApiClientError('auth', '登录状态已失效', 401);
      if (!envelope.success) throw new NewApiClientError('redeem', '兑换失败，请检查兑换码后重试', response.status);
      return { quotaAdded: Number(envelope.data ?? 0) };
    },
  };
}
