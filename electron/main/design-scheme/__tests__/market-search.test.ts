/**
 * Explorer 市场搜索单测：mock GitHub 搜索接口，验证候选映射、
 * 缓存写入与网络失败时的缓存回退（开发规范 §5.1）。
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { searchMarketCandidates } from '../market-search';

function githubItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    full_name: 'helloianneo/ian-xiaohei-illustrations',
    html_url: 'https://github.com/helloianneo/ian-xiaohei-illustrations',
    description: '小黑猫插画 skill',
    default_branch: 'main',
    stargazers_count: 12,
    topics: ['illustration', 'skill'],
    pushed_at: '2026-08-01T00:00:00Z',
    fork: false,
    license: { spdx_id: 'MIT' },
    ...overrides,
  };
}

function fetchOk(items: unknown[]): typeof fetch {
  return (async () => new Response(JSON.stringify({ items }), { status: 200 })) as unknown as typeof fetch;
}

describe('searchMarketCandidates', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runDesignSchemeDbMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it('把 GitHub 搜索结果映射为候选并写入缓存', async () => {
    const result = await searchMarketCandidates('插画 illustration', {
      db,
      fetchImpl: fetchOk([githubItem(), githubItem({ id: 102, full_name: 'a/b', license: null, stargazers_count: 1, topics: [] })]),
      now: () => 1_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fromCache).toBe(false);
    expect(result.data.candidates).toHaveLength(2);

    const [first, second] = result.data.candidates;
    expect(first).toMatchObject({
      candidateId: 'mc_101',
      fullName: 'helloianneo/ian-xiaohei-illustrations',
      license: 'MIT',
      ref: 'main',
      stars: 12,
      riskSummary: null,
    });
    expect(first.matchReason).toContain('命中搜索词');
    // 无许可证 + 低星标 → 风险摘要聚合两条。
    expect(second.license).toBeNull();
    expect(second.riskSummary).toContain('许可证');
    expect(second.riskSummary).toContain('还原度');

    const rows = db.prepare('SELECT query, repository_url FROM market_candidates ORDER BY candidate_id').all() as Array<{ query: string; repository_url: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].query).toBe('插画 illustration');
  });

  it('网络失败时回退缓存候选；无缓存时报网络错误', async () => {
    const failingFetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;

    const missed = await searchMarketCandidates('插画', { db, fetchImpl: failingFetch });
    expect(missed.ok).toBe(false);
    if (!missed.ok) expect(missed.error.code).toBe('NETWORK_ERROR');

    // 先成功一次写缓存，再断网 → 返回缓存并标记 fromCache。
    await searchMarketCandidates('插画', { db, fetchImpl: fetchOk([githubItem()]), now: () => 2_000 });
    const cached = await searchMarketCandidates('插画', { db, fetchImpl: failingFetch, now: () => 3_000 });
    expect(cached.ok).toBe(true);
    if (!cached.ok) return;
    expect(cached.data.fromCache).toBe(true);
    expect(cached.data.candidates[0].candidateId).toBe('mc_101');
  });

  it('空搜索词直接拒绝，不触发网络请求', async () => {
    let called = false;
    const spyFetch = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
    const result = await searchMarketCandidates('   ', { db, fetchImpl: spyFetch });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('fork 仓库被过滤，NOASSERTION 许可证归一为 null', async () => {
    const result = await searchMarketCandidates('poster', {
      db,
      fetchImpl: fetchOk([
        githubItem({ id: 201, fork: true }),
        githubItem({ id: 202, license: { spdx_id: 'NOASSERTION' }, stargazers_count: 30 }),
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidates).toHaveLength(1);
    expect(result.data.candidates[0].candidateId).toBe('mc_202');
    expect(result.data.candidates[0].license).toBeNull();
  });
});
