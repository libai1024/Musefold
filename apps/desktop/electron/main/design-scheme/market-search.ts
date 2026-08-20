/**
 * Explorer（开发规范 §5.1）：用户显式搜索市场时整理候选仓库。
 * 只返回候选元数据与匹配理由，不下载、不安装、不执行；
 * 结果写入 market_candidates 缓存，网络失败时回退缓存候选，不伪造结果。
 */
import type Database from 'better-sqlite3';
import { appError, fail, ok, type AppResult } from '@musefold/domain/app-result';
import type { MarketCandidate, MarketSearchResult } from '@musefold/desktop-contracts/design-scheme';

const SEARCH_TIMEOUT_MS = 15_000;
const CANDIDATE_LIMIT = 8;
/** 缓存有效期：候选只是发现入口，安装时会重新解析仓库，可以放宽到一天。 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface GithubSearchItem {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  topics?: string[];
  pushed_at?: string;
  updated_at?: string;
  fork?: boolean;
  license?: { spdx_id?: string | null } | null;
}

export interface MarketSearchDeps {
  db: Database.Database;
  /** 测试注入；缺省用全局 fetch。 */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** 与 skill-import 相同的 E2E 约定：仅在 E2E 模式接受本机回环地址覆盖 GitHub API。 */
function githubApiOrigin(): string {
  const configured = process.env.MUSEFOLD_E2E_GITHUB_API_BASE?.trim();
  if (process.env.MUSEFOLD_E2E === '1' && configured) {
    try {
      const url = new URL(configured);
      const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
      if (url.protocol === 'http:' && isLoopback) return configured.replace(/\/+$/, '');
    } catch {
      // 配置无效则忽略，回落到真实 API。
    }
  }
  return 'https://api.github.com';
}

/** 搜索词命中的字段构成确定性的匹配理由（不使用模型生成，避免伪造）。 */
function buildMatchReason(query: string, item: GithubSearchItem): string {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: string[] = [];
  const name = item.full_name.toLowerCase();
  const description = (item.description ?? '').toLowerCase();
  const topics = (item.topics ?? []).map((topic) => topic.toLowerCase());
  if (tokens.some((token) => name.includes(token))) hits.push('名称');
  if (tokens.some((token) => description.includes(token))) hits.push('描述');
  if (tokens.some((token) => topics.some((topic) => topic.includes(token)))) hits.push('主题标签');
  return hits.length > 0 ? `${hits.join('、')}命中搜索词` : 'GitHub 相关度排序推荐';
}

function buildRiskSummary(item: GithubSearchItem, license: string | null): string | null {
  const risks: string[] = [];
  if (!license) risks.push('未声明开源许可证，转正前请确认可用性');
  if (item.stargazers_count < 5) risks.push('社区使用较少，效果还原度未知');
  return risks.length > 0 ? risks.join('；') : null;
}

function toCandidate(query: string, item: GithubSearchItem): MarketCandidate {
  const spdx = item.license?.spdx_id ?? null;
  const license = spdx && spdx !== 'NOASSERTION' ? spdx : null;
  return {
    candidateId: `mc_${item.id}`,
    repositoryUrl: item.html_url,
    fullName: item.full_name,
    description: item.description,
    license,
    ref: item.default_branch,
    updatedAt: Date.parse(item.pushed_at ?? item.updated_at ?? '') || 0,
    stars: item.stargazers_count,
    topics: item.topics ?? [],
    matchReason: buildMatchReason(query, item),
    riskSummary: buildRiskSummary(item, license),
  };
}

function readCache(db: Database.Database, query: string): MarketCandidate[] {
  const rows = db.prepare(
    'SELECT metadata_json FROM market_candidates WHERE query = ? ORDER BY created_at DESC, rowid ASC LIMIT ?',
  ).all(query, CANDIDATE_LIMIT) as Array<{ metadata_json: string }>;
  const candidates: MarketCandidate[] = [];
  for (const row of rows) {
    try {
      candidates.push(JSON.parse(row.metadata_json) as MarketCandidate);
    } catch {
      // 忽略损坏行；缓存只是降级路径。
    }
  }
  return candidates;
}

function writeCache(db: Database.Database, query: string, candidates: MarketCandidate[], now: number): void {
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM market_candidates WHERE query = ? OR expires_at < ?').run(query, now);
    const insert = db.prepare(
      `INSERT OR REPLACE INTO market_candidates (candidate_id, query, repository_url, metadata_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const candidate of candidates) {
      insert.run(candidate.candidateId, query, candidate.repositoryUrl, JSON.stringify(candidate), now, now + CACHE_TTL_MS);
    }
  });
  replace();
}

export async function searchMarketCandidates(
  rawQuery: string,
  deps: MarketSearchDeps,
): Promise<AppResult<MarketSearchResult>> {
  const query = rawQuery.trim().replace(/\s+/g, ' ');
  if (!query) {
    return fail(appError('REQUIRED', '输入想找的方案方向，例如「插画 海报」', { recoveryAction: 'edit-input' }));
  }
  const now = deps.now ? deps.now() : Date.now();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const normalized = query.toLowerCase();

  try {
    const params = new URLSearchParams({
      q: `${query} fork:false`,
      per_page: String(CANDIDATE_LIMIT),
    });
    const response = await fetchImpl(`${githubApiOrigin()}/search/repositories?${params.toString()}`, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Musefold-Market-Explorer',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub 搜索返回 ${response.status}`);
    }
    const payload = await response.json() as { items?: GithubSearchItem[] };
    const candidates = (payload.items ?? [])
      .filter((item) => !item.fork)
      .slice(0, CANDIDATE_LIMIT)
      .map((item) => toCandidate(query, item));
    writeCache(deps.db, normalized, candidates, now);
    return ok({ query, fromCache: false, fetchedAt: now, candidates });
  } catch (error) {
    const cached = readCache(deps.db, normalized);
    if (cached.length > 0) {
      return ok({ query, fromCache: true, fetchedAt: now, candidates: cached });
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail(appError('NETWORK_ERROR', `搜索市场失败：${message}`, { recoveryAction: 'retry' }));
  }
}
