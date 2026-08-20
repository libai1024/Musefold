// electron/account/api-client.ts
// new-api REST 客户端（V05-ACC-02）—— 纯网络层：输入 serverUrl + 凭据，输出领域对象。
// 不触碰 keychain / electron-store / 数据库；所有副作用编排在 account-service。
//
// 契约来源：2026-08-13 生产实测冻结（docs/v0.5/V05-ARCHITECTURE.md §3；
// golden：tests/fixtures/newapi/*.json）。目标服务器 new-api v1.0.0-rc.24。
//
// 凭据红线：本模块的返回值只在主进程内存流转；调用方负责入 keychain。
// 日志纪律（FR-ERR-04）：本模块不打日志——message 原文由上层脱敏后决定去向。

import type { AccountErrorCode } from '@musefold/desktop-contracts/account';

export class RelayApiError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = 'RelayApiError';
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
  /** 管理面 JWT（约 30 分钟；仅内存，不落盘） */
  jwt: string;
  /** epoch 秒 */
  jwtExpiresAt: number;
  /** new_api_refresh 凭据（约 30 天；每次续期轮换，调用方须立即回存） */
  refreshToken: string;
  user: RelayUser;
}

export interface RelayApiToken {
  id: number;
  name: string;
  /** 1=启用 2=禁用 3=过期 4=耗尽 */
  status: number;
  /** 列表接口返回的掩码 key（形如 tP1…LmzM），仅供展示 */
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
  /** POST /api/token/{id}/key —— 完整明文 key 的唯一来源（OQ-01 冻结） */
  fetchTokenKey(jwt: string, tokenId: number): Promise<string>;
  /** 失败统一 ACCOUNT/REDEEM_INVALID（服务器防枚举，不区分原因） */
  redeem(jwt: string, code: string): Promise<{ quotaAdded: number }>;
  /** 公开接口，无鉴权 */
  getPricing(): Promise<RelayPricing>;
  /** 公开接口：/api/notice + /api/status announcements 合并 */
  getNotices(): Promise<RelayNotice[]>;
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

const DEFAULT_TIMEOUT_MS = 10_000;
const REFRESH_COOKIE = 'new_api_refresh';

/** 内容哈希派生稳定公告 id（djb2），用于渲染层已读记忆。 */
export function noticeId(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i += 1) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) >>> 0;
  }
  return `n-${hash.toString(36)}`;
}

export function normalizeAccountServerUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new RelayApiError('ACCOUNT/SERVER', '服务器地址不是有效 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RelayApiError('ACCOUNT/SERVER', '服务器地址只支持 http 或 https');
  }
  if (url.username || url.password) throw new RelayApiError('ACCOUNT/SERVER', '服务器地址不能包含用户名或密码');
  if (url.search || url.hash) throw new RelayApiError('ACCOUNT/SERVER', '服务器地址不能包含查询参数或片段');
  url.pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function extractRefreshToken(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies: string[] =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : ([headers.get('set-cookie')].filter(Boolean) as string[]);
  for (const cookie of cookies) {
    const match = /(?:^|,\s*)new_api_refresh=([^;]+)/.exec(cookie) ?? new RegExp(`${REFRESH_COOKIE}=([^;]+)`).exec(cookie);
    if (match?.[1]) return match[1];
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseUser(raw: unknown): RelayUser {
  const r = asRecord(raw);
  return {
    id: Number(r.id ?? 0),
    username: String(r.username ?? ''),
    quota: Number(r.quota ?? 0),
    group: String(r.group ?? 'default'),
  };
}

function parseSession(envelope: Envelope, response: Response, previousRefreshToken?: string): RelayAuthSession {
  const data = asRecord(envelope.data);
  const jwt = typeof data.access_token === 'string' ? data.access_token : '';
  if (!jwt) throw new RelayApiError('ACCOUNT/SERVER', '登录响应缺少 access_token');
  // 续期响应会轮换 refresh Cookie；极端情况下未携带时沿用旧值（下次续期再轮换）
  const refreshToken = extractRefreshToken(response) ?? previousRefreshToken ?? '';
  if (!refreshToken) throw new RelayApiError('ACCOUNT/SERVER', '登录响应缺少 refresh 凭据');
  return {
    jwt,
    jwtExpiresAt: Number(data.access_expires_at ?? 0),
    refreshToken,
    user: parseUser(data.user),
  };
}

export function createNewApiClient(serverUrl: string, options: NewApiClientOptions = {}): NewApiClient {
  const base = normalizeAccountServerUrl(serverUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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
      throw new RelayApiError('ACCOUNT/NETWORK', aborted ? '连接账号服务器超时' : '无法连接账号服务器');
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 500) {
      throw new RelayApiError('ACCOUNT/SERVER', `账号服务器错误（${response.status}）`, response.status);
    }
    let envelope: Envelope;
    try {
      envelope = (await response.json()) as Envelope;
    } catch {
      throw new RelayApiError('ACCOUNT/SERVER', '账号服务器响应无法解析', response.status);
    }
    return { envelope, response };
  }

  /** 断言信封 success，否则按 fallbackCode 抛错（message 用服务器原文）。 */
  function assertSuccess(envelope: Envelope, status: number, fallbackCode: AccountErrorCode, fallbackMessage: string): void {
    if (envelope.success) return;
    throw new RelayApiError(fallbackCode, envelope.message || fallbackMessage, status);
  }

  return {
    async register({ username, password }) {
      const { envelope, response } = await request('POST', '/api/user/register', {
        body: { username, password },
      });
      if (envelope.success) return;
      const message = envelope.message || '注册失败';
      const conflict = /已存在|已被|exist|taken|duplicate/i.test(message);
      throw new RelayApiError(conflict ? 'ACCOUNT/CONFLICT' : 'ACCOUNT/CREDENTIALS', message, response.status);
    },

    async login({ username, password }) {
      const { envelope, response } = await request('POST', '/api/user/login', {
        body: { username, password },
      });
      if (!envelope.success) {
        const message = envelope.message || '用户名或密码不正确';
        // 2FA/Passkey 账号：v0.5 不支持 App 内登录，引导网页（产品文档 §5）
        const needs2fa = /2fa|两步|二步|totp|passkey/i.test(message);
        throw new RelayApiError(
          'ACCOUNT/CREDENTIALS',
          needs2fa ? '该账号开启了两步验证，请使用网页控制台登录后关闭，再在 App 内登录' : message,
          response.status,
        );
      }
      return parseSession(envelope, response);
    },

    async refresh(refreshToken) {
      const { envelope, response } = await request('POST', '/api/user/auth/refresh', {
        cookie: `${REFRESH_COOKIE}=${refreshToken}`,
      });
      if (response.status === 401 || response.status === 403 || !envelope.success) {
        throw new RelayApiError('ACCOUNT/AUTH', envelope.message || '登录状态已失效，请重新登录', response.status);
      }
      return parseSession(envelope, response, refreshToken);
    },

    async getSelf(jwt) {
      const { envelope, response } = await request('GET', '/api/user/self', { jwt });
      if (response.status === 401) throw new RelayApiError('ACCOUNT/AUTH', '登录状态已失效', 401);
      assertSuccess(envelope, response.status, 'ACCOUNT/SERVER', '获取账号信息失败');
      return parseUser(envelope.data);
    },

    async listUserModels(jwt) {
      const { envelope, response } = await request('GET', '/api/user/models', { jwt });
      if (response.status === 401) throw new RelayApiError('ACCOUNT/AUTH', '登录状态已失效', 401);
      assertSuccess(envelope, response.status, 'ACCOUNT/SERVER', '获取模型列表失败');
      return Array.isArray(envelope.data) ? envelope.data.map(String) : [];
    },

    async createToken(jwt, { name }) {
      const { envelope, response } = await request('POST', '/api/token/', {
        jwt,
        body: { name, remain_quota: 0, unlimited_quota: true, expired_time: -1 },
      });
      if (response.status === 401) throw new RelayApiError('ACCOUNT/AUTH', '登录状态已失效', 401);
      assertSuccess(envelope, response.status, 'ACCOUNT/SERVER', '创建设备令牌失败');
    },

    async listTokens(jwt) {
      const { envelope, response } = await request('GET', '/api/token/?p=0&page_size=20', { jwt });
      if (response.status === 401) throw new RelayApiError('ACCOUNT/AUTH', '登录状态已失效', 401);
      assertSuccess(envelope, response.status, 'ACCOUNT/SERVER', '获取令牌列表失败');
      const data = asRecord(envelope.data);
      const items = Array.isArray(data.items) ? data.items : Array.isArray(envelope.data) ? envelope.data : [];
      return items.map((item) => {
        const r = asRecord(item);
        return {
          id: Number(r.id ?? 0),
          name: String(r.name ?? ''),
          status: Number(r.status ?? 0),
          keyMasked: String(r.key ?? ''),
        };
      });
    },

    async fetchTokenKey(jwt, tokenId) {
      const { envelope, response } = await request('POST', `/api/token/${tokenId}/key`, { jwt, body: {} });
      if (response.status === 401) throw new RelayApiError('ACCOUNT/AUTH', '登录状态已失效', 401);
      const key = String(asRecord(envelope.data).key ?? '');
      if (!envelope.success || !key) {
        throw new RelayApiError('ACCOUNT/SERVER', envelope.message || '取回令牌失败', response.status);
      }
      return key.startsWith('sk-') ? key : `sk-${key}`;
    },

    async redeem(jwt, code) {
      const { envelope, response } = await request('POST', '/api/user/topup', { jwt, body: { key: code } });
      if (response.status === 401) throw new RelayApiError('ACCOUNT/AUTH', '登录状态已失效', 401);
      if (!envelope.success) {
        // golden：redemption-golden.json —— 已用/无效/空码统一模糊响应（防枚举）
        throw new RelayApiError('ACCOUNT/REDEEM_INVALID', '兑换失败，请检查兑换码后重试', response.status);
      }
      return { quotaAdded: Number(envelope.data ?? 0) };
    },

    async getPricing() {
      const { envelope, response } = await request('GET', '/api/pricing');
      assertSuccess(envelope, response.status, 'ACCOUNT/SERVER', '获取定价失败');
      const root = asRecord(envelope as unknown);
      const models = (Array.isArray(envelope.data) ? envelope.data : []).map((item) => {
        const r = asRecord(item);
        return {
          modelName: String(r.model_name ?? ''),
          quotaType: (Number(r.quota_type ?? 0) === 1 ? 1 : 0) as 0 | 1,
          modelRatio: Number(r.model_ratio ?? 0),
          completionRatio: Number(r.completion_ratio ?? 0),
          modelPrice: Number(r.model_price ?? 0),
          enableGroups: Array.isArray(r.enable_groups) ? r.enable_groups.map(String) : [],
        };
      });
      return {
        version: String(root.pricing_version ?? ''),
        groupRatio: asRecord(root.group_ratio) as Record<string, number>,
        models,
      };
    },

    async getNotices() {
      const notices: RelayNotice[] = [];
      // /api/status 的 announcements[]（条目形状随版本演进，防御式解析）
      try {
        const { envelope } = await request('GET', '/api/status');
        const data = asRecord(envelope.data);
        const announcements = Array.isArray(data.announcements) ? data.announcements : [];
        for (const entry of announcements) {
          if (typeof entry === 'string' && entry.trim()) {
            notices.push({ id: noticeId(entry), content: entry.trim(), publishedAt: null });
          } else {
            const r = asRecord(entry);
            const content = String(r.content ?? r.text ?? '').trim();
            if (!content) continue;
            const at = r.publishDate ?? r.publish_date ?? r.time ?? null;
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
        if (content && !notices.some((n) => n.id === noticeId(content))) {
          notices.push({ id: noticeId(content), content, publishedAt: null });
        }
      } catch {
        /* 同上 */
      }
      return notices;
    },
  };
}
