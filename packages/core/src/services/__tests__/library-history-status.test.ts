// 服务面单测（V04-CORE-04）：Library / History / Status —— 共用主库临时实例。

import { rmSync } from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureTestCoreRuntime } from '../../testing';

const root = `/tmp/musefold-core-services-${process.pid}`;
configureTestCoreRuntime(root);

import { getDb, initDb, closeDb } from '../../db/index';
import { foldersRepo } from '../../db/repositories/folders';
import { initDesignSchemeDb, closeDesignSchemeDb, getDesignSchemeDb } from '../../db/design-scheme';
import { createLibraryService } from '../library';
import { createHistoryService, buildHistoryListSql } from '../history';
import { createStatusService } from '../status';

const library = createLibraryService();
const history = createHistoryService();

function insertHistoryRow(input: {
  id: string;
  status?: string;
  providerId?: string;
  createdAt: number;
  promptId?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO history (id, prompt_id, provider_id, model, prompt_text, status, created_at)
       VALUES (?, ?, ?, 'model-x', 'a prompt', ?, ?)`,
    )
    .run(input.id, input.promptId ?? null, input.providerId ?? 'prov-a', input.status ?? 'success', input.createdAt);
}

beforeAll(() => {
  initDb();
});

afterAll(() => {
  closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe('LibraryService', () => {
  it('create → search 全链路：新建提示词可被检索到', () => {
    const created = library.create({ title: '赛博街景', content: 'cyberpunk street, neon rain' });
    const found = library.search({ search: '赛博街景' });
    expect(found.map((p) => p.id)).toContain(created.id);
  });

  it('get 命中返回完整提示词，未命中返回 null', () => {
    const created = library.create({ title: '极简海报', content: 'minimal poster' });
    expect(library.get(created.id)?.content).toBe('minimal poster');
    expect(library.get('no-such-id')).toBeNull();
  });

  it('create 支持素笺来源（source=slip），并在检索结果中保留来源', () => {
    const slip = library.create({ title: '速记一则', content: '暮色下的青瓦', source: 'slip' });
    expect(library.get(slip.id)?.source).toBe('slip');
  });

  it('search 支持来源过滤（笺匣视图 filters.source=slip）', () => {
    library.create({ title: '普通提示词', content: 'plain one' });
    const slips = library.search({ filters: { source: 'slip' } });
    expect(slips.length).toBeGreaterThan(0);
    expect(slips.every((p) => p.source === 'slip')).toBe(true);
  });

  it('stats 返回计数快照', () => {
    const stats = library.stats();
    expect(stats.total).toBeGreaterThan(0);
  });

  it('search 支持 folderId 过滤', () => {
    const folder = foldersRepo.create({ name: '服务测试夹' });
    const inFolder = library.create({ title: '夹内提示词', content: 'in folder', folderId: folder.id });
    const ids = library.search({ folderId: folder.id }).map((p) => p.id);
    expect(ids).toEqual([inFolder.id]);
  });

  it('search 不返回已软删的提示词（get 按回收站语义仍可读详情）', () => {
    const doomed = library.create({ title: '将被删除', content: 'to be deleted' });
    getDb().prepare('UPDATE prompts SET deleted_at = ? WHERE id = ?').run(Date.now(), doomed.id);
    expect(library.search().map((p) => p.id)).not.toContain(doomed.id);
    expect(library.get(doomed.id)?.id).toBe(doomed.id);
  });
});

describe('HistoryService', () => {
  it('list 默认按创建时间倒序', () => {
    insertHistoryRow({ id: 'his-old', createdAt: 1000 });
    insertHistoryRow({ id: 'his-new', createdAt: 2000 });
    const ids = history.list().map((h) => h.id);
    expect(ids.indexOf('his-new')).toBeLessThan(ids.indexOf('his-old'));
  });

  it('list 支持 status / providerId / limit 组合过滤', () => {
    insertHistoryRow({ id: 'his-failed', status: 'failed', providerId: 'prov-b', createdAt: 3000 });
    const failed = history.list({ status: 'failed', providerId: 'prov-b' });
    expect(failed.map((h) => h.id)).toEqual(['his-failed']);
    expect(history.list({ limit: 1 })).toHaveLength(1);
  });

  it('get 返回详情并附带提示词引用；未命中返回 null', () => {
    const prompt = library.create({ title: '引用源', content: 'referenced content' });
    insertHistoryRow({ id: 'his-ref', createdAt: 4000, promptId: prompt.id });
    getDb()
      .prepare(
        `INSERT INTO history_prompt_references (history_id, prompt_id, prompt_title, excerpt, scope, sort_order)
         VALUES ('his-ref', ?, '引用源', 'referenced content', 'full', 0)`,
      )
      .run(prompt.id);

    const detail = history.get('his-ref');
    expect(detail?.promptReferences).toHaveLength(1);
    expect(detail?.promptReferences[0]).toMatchObject({ title: '引用源', scope: 'full' });
    expect(history.get('his-missing')).toBeNull();
  });

  it('buildHistoryListSql：from/to 生成含边界的 AND 组合（纯函数）', () => {
    const { sql, values } = buildHistoryListSql({ from: 100, to: 200, status: 'success' });
    expect(sql).toContain('status = ?');
    expect(sql).toContain('created_at >= ?');
    expect(sql).toContain('created_at <= ?');
    expect(values).toEqual(['success', 100, 200]);
  });

  it('list 支持 from/to 时间窗（含边界）', () => {
    insertHistoryRow({ id: 'his-window-in', createdAt: 5000 });
    insertHistoryRow({ id: 'his-window-out', createdAt: 6000 });
    const ids = history.list({ from: 5000, to: 5000 }).map((h) => h.id);
    expect(ids).toContain('his-window-in');
    expect(ids).not.toContain('his-window-out');
  });

  it('list 支持 offset 分页', () => {
    const all = history.list();
    const paged = history.list({ limit: 1, offset: 1 });
    expect(paged).toHaveLength(1);
    expect(paged[0].id).toBe(all[1].id);
  });

});

describe('SpendAuditService（V04-SEC-01 完整落库）', () => {
  it('record → list：完整提示词、放行路径、成本全部落库（迁移 0012）', async () => {
    const { createSpendAuditService } = await import('../audit');
    const audit = createSpendAuditService();
    audit.record({
      at: 1_700_000_000_000,
      caller: 'http',
      action: 'generate_image',
      promptText: '完整提示词全文，一字不落地进入本机审计表',
      params: { providerId: 'prov-a', n: 2 },
      estimatedPoints: 3.6,
      actualPoints: 4,
      approvedVia: 'budget',
      status: 'success',
      jobId: 'JOB1',
    });
    const entries = audit.list(10);
    expect(entries[0]).toMatchObject({
      caller: 'http',
      action: 'generate_image',
      promptText: '完整提示词全文，一字不落地进入本机审计表',
      approvedVia: 'budget',
      status: 'success',
      estimatedPoints: 3.6,
      actualPoints: 4,
      jobId: 'JOB1',
    });
    expect(entries[0].params).toEqual({ providerId: 'prov-a', n: 2 });
  });
});

describe('StatusService', () => {
  it('snapshot 汇总三库计数与激活 Provider', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO providers (id, name, type, base_url, model, has_key, is_active, created_at, updated_at)
       VALUES ('prov-active', '测试站', 'openai-compatible', 'https://x.example/v1', 'gpt-image-2', 1, 1, 1, 1)`,
    ).run();

    initDesignSchemeDb();
    try {
      const status = createStatusService({ library: getDb, scheme: getDesignSchemeDb });
      const snapshot = status.snapshot();
      expect(snapshot.prompts).toBeGreaterThan(0);
      expect(snapshot.formalSchemes).toBe(0);
      expect(snapshot.providers).toBeGreaterThan(0);
      expect(snapshot.activeProviderId).toBe('prov-active');
    } finally {
      closeDesignSchemeDb();
    }
  });
});
