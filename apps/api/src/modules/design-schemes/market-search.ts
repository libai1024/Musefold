import { createHash } from 'node:crypto';
import {
  type MarketCandidate,
  type MarketSearchResult,
  type ParsedMarketSearchQuery,
  marketCandidateSchema,
  marketSearchQuerySchema,
  marketSearchResultSchema,
} from '@musefold/contracts';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { RATE_LIMIT_POLICIES, type RateLimiter } from '../rate-limit/service.js';

/** Public, anonymous discovery only. Never resolve/download repository contents here.
 * GitHub documents 100/page, 1,000/search and 10 anonymous searches/minute:
 * https://docs.github.com/en/rest/search/search#search-repositories
 */
export const MARKET_SEARCH_LIMITS = {
  timeoutMs: 10_000,
  responseBytes: 2 * 1024 * 1024,
  cacheTtlMs: 5 * 60_000,
  staleMs: 15 * 60_000,
  cacheEntries: 128,
  cacheBytes: 8 * 1024 * 1024,
  concurrentRequests: 4,
  failureCooldownMs: 5_000,
} as const;

type Limits = { [K in keyof typeof MARKET_SEARCH_LIMITS]: number };
type MarketErrorCode =
  | 'MARKET_INVALID_QUERY'
  | 'MARKET_INVALID_CURSOR'
  | 'MARKET_QUERY_REJECTED'
  | 'MARKET_RATE_LIMITED'
  | 'MARKET_TIMEOUT'
  | 'MARKET_UPSTREAM_ERROR'
  | 'MARKET_INVALID_RESPONSE'
  | 'MARKET_INCOMPLETE_RESULTS';

class MarketError extends AppError {
  constructor(
    marketError: MarketErrorCode,
    message: string,
    status: number,
    readonly allowStale = false,
    retryAfterSeconds?: number,
  ) {
    super(
      status === 429 ? 'RATE_LIMITED' : status === 400 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR',
      message,
      status,
      status === 429 || allowStale,
      {
        operation: 'searchMarket',
        marketError,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      },
    );
  }
}

const invalidResponse = () =>
  new MarketError('MARKET_INVALID_RESPONSE', 'GitHub 搜索返回了无效数据，暂时无法展示', 502);

// External transport shapes are validated and stripped; only canonical fields reach the cache.
const githubItemSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  full_name: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/),
  html_url: z.string().max(2048),
  private: z.boolean(),
  visibility: z.enum(['public', 'private', 'internal']).optional(),
  fork: z.boolean(),
  description: z.string().max(1000).nullable(),
  license: z.object({ spdx_id: z.string().min(1).max(256).nullable() }).nullable(),
  default_branch: z.string().min(1).max(200),
  pushed_at: z.string().datetime({ offset: true }).nullable(),
  updated_at: z.string().datetime({ offset: true }),
  stargazers_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  topics: z.array(z.string().min(1).max(80)).max(30),
});
const githubResultSchema = z.object({
  total_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  incomplete_results: z.boolean(),
  items: z.array(githubItemSchema).max(100),
});
const cursorSchema = z
  .object({
    v: z.literal(1),
    q: z.string().regex(/^[a-f0-9]{64}$/),
    limit: z.number().int().min(1).max(100),
    page: z.number().int().min(2).max(1000),
  })
  .strict();
type CachedPage = Omit<MarketSearchResult, 'query' | 'fromCache'>;
type CacheEntry = { page: CachedPage; fetchedAt: number; bytes: number };

export interface DesignSchemeMarketSearchDependencies {
  rateLimiter: Pick<RateLimiter, 'assertAllowed'>;
  /** Tests may substitute transport; the production URL is never configurable. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Tests can tighten, never enlarge, production budgets. */
  limits?: Partial<Limits>;
}

/** Bounded process-local public cache. Restart/multiple replicas may miss cache;
 * the existing PG limiter shares the outbound budget across all replicas.
 * No token, owner identity, raw upstream JSON or private source is cached.
 */
export class DesignSchemeMarketSearchService {
  private readonly limits: Limits;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;
  private readonly pending = new Map<string, Promise<CachedPage>>();
  private readonly failures = new Map<string, { error: MarketError; until: number }>();
  private upstreamCooldownUntil = 0;

  constructor(private readonly deps: DesignSchemeMarketSearchDependencies) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? Date.now;
    this.limits = { ...MARKET_SEARCH_LIMITS, ...deps.limits };
    for (const key of Object.keys(MARKET_SEARCH_LIMITS) as Array<keyof Limits>) {
      if (
        !Number.isSafeInteger(this.limits[key]) ||
        this.limits[key] < 1 ||
        this.limits[key] > MARKET_SEARCH_LIMITS[key]
      ) {
        throw new Error('Invalid market search resource limit');
      }
    }
  }

  async search(userId: string, rawQuery: ParsedMarketSearchQuery): Promise<MarketSearchResult> {
    const parsed = marketSearchQuerySchema.safeParse(rawQuery);
    if (
      !parsed.success ||
      [...parsed.data.query].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    ) {
      throw new MarketError('MARKET_INVALID_QUERY', '搜索词或分页参数无效', 400);
    }
    if (!userId) throw new AppError('AUTH_REQUIRED', '请先登录');
    const query = parsed.data.query.replace(/\s+/g, ' ');
    const hash = createHash('sha256').update(query).digest('hex');
    const { limit, cursor } = parsed.data;
    const page = cursor ? decodeCursor(cursor, hash, limit) : 1;
    const key = `${hash}:${limit}:${page}`;
    // Entry limit applies to every caller, including cache hits and shared in-flight reads.
    try {
      await this.deps.rateLimiter.assertAllowed(
        'market-user',
        userId,
        RATE_LIMIT_POLICIES.marketSearch,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === 'RATE_LIMITED') {
        throw localRateError(error);
      }
      throw error;
    }
    const cached = this.readCache(key);
    if (cached && this.now() - cached.fetchedAt < this.limits.cacheTtlMs) {
      return this.result(query, cached.page, true);
    }

    try {
      const cooldown = this.failures.get(key);
      if (cooldown && cooldown.until > this.now()) throw cooldown.error;
      this.failures.delete(key);
      let pending = this.pending.get(key);
      if (!pending) {
        if (this.pending.size >= this.limits.concurrentRequests) {
          throw new MarketError('MARKET_RATE_LIMITED', '市场搜索繁忙，请稍后重试', 429, true, 1);
        }
        // Defer refresh so registration precedes its first asynchronous operation.
        pending = Promise.resolve().then(() => this.refresh(query, hash, limit, page, key));
        this.pending.set(key, pending);
        void pending.finally(() => this.pending.delete(key)).catch(() => undefined);
      }
      return this.result(query, await pending, false);
    } catch (error) {
      // Recheck age after the network wait; fallback never renews fetchedAt/expiry.
      const fallback = this.readCache(key);
      if (error instanceof MarketError && error.allowStale && fallback) {
        return this.result(query, fallback.page, true);
      }
      throw error;
    }
  }

  private result(query: string, page: CachedPage, fromCache: boolean): MarketSearchResult {
    return marketSearchResultSchema.parse({ ...structuredClone(page), query, fromCache });
  }

  private readCache(key: string): CacheEntry | undefined {
    const now = this.now();
    for (const [savedKey, value] of this.cache) {
      const age = now - value.fetchedAt;
      if (age < 0 || age >= this.limits.cacheTtlMs + this.limits.staleMs)
        this.deleteCache(savedKey);
    }
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
    }
    return cached;
  }

  private deleteCache(key: string) {
    const saved = this.cache.get(key);
    if (saved) this.cacheBytes -= saved.bytes;
    this.cache.delete(key);
  }

  private saveCache(key: string, page: CachedPage, fetchedAt: number) {
    this.deleteCache(key);
    const bytes = Buffer.byteLength(JSON.stringify(page)) + Buffer.byteLength(key);
    if (bytes > this.limits.cacheBytes) return;
    while (
      this.cache.size >= this.limits.cacheEntries ||
      this.cacheBytes + bytes > this.limits.cacheBytes
    ) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.deleteCache(oldest);
    }
    this.cache.set(key, { page, fetchedAt, bytes });
    this.cacheBytes += bytes;
  }

  private async refresh(
    query: string,
    hash: string,
    limit: number,
    page: number,
    key: string,
  ): Promise<CachedPage> {
    if (this.upstreamCooldownUntil > this.now()) {
      throw new MarketError(
        'MARKET_RATE_LIMITED',
        'GitHub 搜索限流，请稍后重试',
        429,
        true,
        Math.ceil((this.upstreamCooldownUntil - this.now()) / 1000),
      );
    }
    try {
      await this.deps.rateLimiter.assertAllowed(
        'market-github-public',
        'anonymous',
        RATE_LIMIT_POLICIES.marketGithub,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === 'RATE_LIMITED')
        throw localRateError(error, true);
      throw error;
    }
    const offset = (page - 1) * limit;
    // Never ask GitHub for a range extending past its first 1,000 results. For
    // limit=60/page=17, read 901..1000 once, then select 961..1000 (40 entries).
    const finalPartialPage = offset + limit > 1000;
    const perPage = finalPartialPage ? 100 : limit;
    const upstreamPage = finalPartialPage ? 10 : page;
    const sliceStart = finalPartialPage ? offset - 900 : 0;
    const url = new URL('https://api.github.com/search/repositories');
    url.search = new URLSearchParams({
      q: `${query} is:public fork:false`,
      per_page: String(perPage),
      page: String(upstreamPage),
    }).toString();
    const signal = AbortSignal.timeout(this.limits.timeoutMs);
    let response: Response | undefined;
    try {
      response = await abortable(
        this.fetchImpl(url, {
          method: 'GET',
          redirect: 'error',
          signal,
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Musefold-Market-Explorer',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }),
        signal,
      );
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get('x-ratelimit-remaining') === '0' ||
            response.headers.has('retry-after')))
      ) {
        const seconds = retryAfter(response.headers, this.now());
        this.upstreamCooldownUntil = Math.max(
          this.upstreamCooldownUntil,
          this.now() + seconds * 1000,
        );
        throw new MarketError(
          'MARKET_RATE_LIMITED',
          'GitHub 搜索限流，请稍后重试',
          429,
          true,
          seconds,
        );
      }
      if (response.status === 422) {
        throw new MarketError(
          'MARKET_QUERY_REJECTED',
          'GitHub 无法执行此查询，请简化搜索词或检查公开仓库范围',
          400,
        );
      }
      if (response.status !== 200) {
        throw new MarketError(
          'MARKET_UPSTREAM_ERROR',
          'GitHub 搜索暂时不可用，请稍后重试',
          502,
          response.status >= 500,
        );
      }
      if (
        !/^application\/(?:json|vnd\.github\+json)(?:\s*;|$)/i.test(
          response.headers.get('content-type') ?? '',
        )
      ) {
        throw invalidResponse();
      }
      const raw = await readJson(response, signal, this.limits.responseBytes);
      const payload = githubResultSchema.safeParse(raw);
      if (
        !payload.success ||
        payload.data.items.length > perPage ||
        payload.data.items.length > payload.data.total_count
      )
        throw invalidResponse();
      if (payload.data.incomplete_results) {
        throw new MarketError(
          'MARKET_INCOMPLETE_RESULTS',
          'GitHub 搜索未完成，请缩小搜索范围后重试',
          503,
          true,
          5,
        );
      }
      const seen = new Set<number>();
      const candidates: MarketCandidate[] = [];
      for (const item of payload.data.items.slice(
        sliceStart,
        sliceStart + Math.min(limit, 1000 - offset),
      )) {
        if (seen.has(item.id)) throw invalidResponse();
        seen.add(item.id);
        if (
          item.private ||
          item.fork ||
          (item.visibility !== undefined && item.visibility !== 'public')
        )
          continue;
        candidates.push(toCandidate(query, item));
      }
      const fetchedAt = this.now();
      const nextCursor =
        !finalPartialPage &&
        payload.data.items.length === perPage &&
        offset + limit < Math.min(payload.data.total_count, 1000)
          ? encodeCursor(hash, limit, page + 1)
          : null;
      const result: CachedPage = { fetchedAt, candidates, nextCursor };
      this.saveCache(key, result, fetchedAt);
      return result;
    } catch (error) {
      const failure =
        error instanceof MarketError
          ? error
          : signal.aborted
            ? new MarketError('MARKET_TIMEOUT', 'GitHub 搜索超时，请稍后重试', 504, true, 5)
            : new MarketError(
                'MARKET_UPSTREAM_ERROR',
                '无法连接 GitHub 搜索，请稍后重试',
                502,
                true,
                5,
              );
      // Bounded negative cache prevents repeated bad payload/network requests; it
      // stores fixed error metadata only, never the query or upstream exception.
      while (this.failures.size >= this.limits.cacheEntries) {
        const first = this.failures.keys().next().value;
        if (first === undefined) break;
        this.failures.delete(first);
      }
      this.failures.set(key, { error: failure, until: this.now() + this.limits.failureCooldownMs });
      throw failure;
    } finally {
      if (response?.body && !response.body.locked)
        void response.body.cancel().catch(() => undefined);
    }
  }
}

function localRateError(error: AppError, allowStale = false) {
  const seconds = error.details.retryAfterSeconds;
  return new MarketError(
    'MARKET_RATE_LIMITED',
    '市场搜索请求过于频繁，请稍后重试',
    429,
    allowStale,
    typeof seconds === 'number' && Number.isFinite(seconds)
      ? Math.max(1, Math.min(86400, Math.ceil(seconds)))
      : 60,
  );
}

function encodeCursor(hash: string, limit: number, page: number) {
  return Buffer.from(JSON.stringify({ v: 1, q: hash, limit, page })).toString('base64url');
}

function decodeCursor(cursor: string, hash: string, limit: number): number {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error();
    const parsed = cursorSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    if (parsed.q !== hash || parsed.limit !== limit || (parsed.page - 1) * limit >= 1000)
      throw new Error();
    return parsed.page;
  } catch {
    throw new MarketError('MARKET_INVALID_CURSOR', '搜索分页已失效，请重新搜索', 400);
  }
}

function toCandidate(query: string, item: z.output<typeof githubItemSchema>): MarketCandidate {
  // Exact string matching also rejects explicit :443, encoded separators, query,
  // fragments, credentials, control characters and URL-parser normalization tricks.
  const repo = item.full_name.split('/')[1];
  if (repo === '.' || repo === '..' || item.html_url !== `https://github.com/${item.full_name}`)
    throw invalidResponse();
  const tokens = query.toLowerCase().split(/\s+/);
  const hits: string[] = [];
  if (tokens.some((token) => item.full_name.toLowerCase().includes(token))) hits.push('名称');
  if (tokens.some((token) => item.description?.toLowerCase().includes(token))) hits.push('描述');
  if (tokens.some((token) => item.topics.some((topic) => topic.toLowerCase().includes(token))))
    hits.push('主题标签');
  const license = item.license?.spdx_id === 'NOASSERTION' ? null : (item.license?.spdx_id ?? null);
  const risks: string[] = [];
  if (!license) risks.push('未声明开源许可证，转正前请确认可用性');
  if (item.stargazers_count < 5) risks.push('社区使用较少，效果还原度未知');
  const parsed = marketCandidateSchema.safeParse({
    candidateId: `mc_${item.id}`,
    repositoryUrl: item.html_url,
    fullName: item.full_name,
    description: item.description,
    license,
    ref: item.default_branch,
    commit: null,
    updatedAt: item.pushed_at ?? item.updated_at,
    stars: item.stargazers_count,
    topics: item.topics,
    matchReason: hits.length ? `${hits.join('、')}命中搜索词` : 'GitHub 相关度排序推荐',
    riskSummary: risks.length ? risks.join('；') : null,
  });
  if (!parsed.success) throw invalidResponse();
  return parsed.data;
}

function retryAfter(headers: Headers, now: number): number {
  const raw = headers.get('retry-after');
  const seconds =
    raw && /^\d+$/.test(raw) ? Number(raw) : raw ? (Date.parse(raw) - now) / 1000 : Number.NaN;
  const reset = headers.get('x-ratelimit-reset');
  const resetSeconds = reset && /^\d+$/.test(reset) ? Number(reset) - now / 1000 : Number.NaN;
  const delay = Number.isFinite(seconds)
    ? seconds
    : Number.isFinite(resetSeconds)
      ? resetSeconds
      : 60;
  return Math.max(1, Math.min(86_400, Math.ceil(delay)));
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

async function readJson(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) ||
      !Number.isSafeInteger(Number(declared)) ||
      Number(declared) > maxBytes)
  )
    throw invalidResponse();
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) throw invalidResponse();
      chunks.push(chunk.value);
    }
    try {
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)),
      );
    } catch {
      throw invalidResponse();
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
