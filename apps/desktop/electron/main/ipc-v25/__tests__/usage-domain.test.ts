import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tempDir = mkdtempSync(join(tmpdir(), 'musefold-usage-domain-'));
mkdirSync(join(tempDir, 'pictures'), { recursive: true });

vi.mock('electron', () => ({
  app: { getPath: () => tempDir, getVersion: () => '2.5.0-test' },
}));
vi.mock('../../../system/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { getDb } from '@musefold/core/db';
import { configureCoreRuntime } from '@musefold/core/runtime';
import {
  assembleDesktopUsageSummary,
  buildUsageDomainMethods,
  resolveDesktopUsageModel,
} from '../usage-domain';

configureCoreRuntime({
  getPaths: () => ({
    userData: tempDir,
    db: join(tempDir, 'test.db'),
    backups: tempDir,
    previews: join(tempDir, 'previews'),
    pictures: join(tempDir, 'pictures'),
    logs: tempDir,
  }),
  loadApiKey: () => null,
  createLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
  estimateProviderCost: () => null,
});

type Methods = Record<
  string,
  { input: { parse(input: unknown): unknown }; handle(input: unknown): Promise<unknown> }
>;

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const DAY_MS = 86_400_000;

function insertProvider(id: string, name: string): void {
  getDb()
    .prepare(
      `INSERT INTO providers (id, name, type, base_url, model, has_key, is_active, created_at, updated_at)
       VALUES (?, ?, 'openai-compatible', 'https://example.test/v1', 'test-model', 0, 0, ?, ?)`,
    )
    .run(id, name, NOW, NOW);
}

function insertRun(
  id: string,
  status: string,
  options: {
    createdAt?: number;
    deletedAt?: number | null;
    providerId?: string;
    actualCost?: number | null;
  } = {},
): void {
  getDb()
    .prepare(
      `INSERT INTO generation_runs
         (id, run_kind, prompt_id, provider_id, model, base_prompt, final_prompt,
          params_json, prompt_snapshot_json, status, actual_cost, created_at, deleted_at)
       VALUES (?, 'free_generation', NULL, ?, 'test-model', 'a prompt', 'a prompt', '{}', '{}', ?, ?, ?, ?)`,
    )
    .run(
      id,
      options.providerId ?? 'p1',
      status,
      options.actualCost ?? null,
      options.createdAt ?? NOW,
      options.deletedAt ?? null,
    );
}

function insertAsset(id: string, runId: string, status = 'available', position = 0): void {
  getDb()
    .prepare(
      `INSERT INTO generated_assets (id, run_id, position, status, media_path, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    )
    .run(id, runId, position, status, NOW);
}

describe('assembleDesktopUsageSummary(桌面口径)', () => {
  it('maps desktop success to succeeded and nulls empty cost / rate', () => {
    const summary = assembleDesktopUsageSummary(
      '30d',
      NOW,
      [
        {
          status: 'success',
          actual_cost: 2,
          provider_id: 'p1',
          created_at: NOW,
          model: 'alpha',
          params_json: '{}',
        },
        {
          status: 'failed',
          actual_cost: null,
          provider_id: 'p1',
          created_at: NOW,
          model: 'alpha',
          params_json: '{}',
        },
        {
          status: 'cancelled',
          actual_cost: null,
          provider_id: 'p2',
          created_at: NOW - DAY_MS,
          model: 'beta',
          params_json: '{}',
        },
        {
          status: 'queued',
          actual_cost: null,
          provider_id: 'p1',
          created_at: NOW,
          model: 'alpha',
          params_json: '{}',
        },
      ],
      2,
      new Map([
        ['p1', '官方中转'],
        ['p2', '自备网关'],
      ]),
    );
    expect(summary.generationCount).toBe(4);
    expect(summary.succeededCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.cancelledCount).toBe(1);
    expect(summary.successRate).toBe(1 / 3);
    expect(summary.costPoints).toBe(2);
    expect(summary.imageCount).toBe(2);
    expect(summary.byProvider).toEqual([
      { providerId: 'p1', label: '官方中转', generationCount: 3, costPoints: 2 },
      { providerId: 'p2', label: '自备网关', generationCount: 1, costPoints: null },
    ]);
    expect(summary.byModel).toEqual([
      { model: 'alpha', generationCount: 3, costPoints: 2 },
      { model: 'beta', generationCount: 1, costPoints: null },
    ]);
    expect(summary.byDay).toHaveLength(30);
    expect(summary.byDay.at(-1)).toMatchObject({
      date: '2026-09-06',
      generationCount: 3,
      costPoints: 2,
    });
    expect(summary.byDay.at(-2)).toMatchObject({
      date: '2026-09-05',
      generationCount: 1,
      costPoints: null,
      successRate: 0,
    });
  });

  it('falls back to provider_id when the providers row is missing', () => {
    const summary = assembleDesktopUsageSummary(
      '7d',
      NOW,
      [
        {
          status: 'success',
          actual_cost: null,
          provider_id: 'orphan',
          created_at: NOW,
          model: '  ',
          params_json: '{"model":"from-params"}',
        },
      ],
      0,
      new Map(),
    );
    expect(summary.costPoints).toBeNull();
    expect(summary.successRate).toBe(1);
    expect(summary.byProvider).toEqual([
      { providerId: 'orphan', label: 'orphan', generationCount: 1, costPoints: null },
    ]);
    expect(summary.byModel).toEqual([
      { model: 'from-params', generationCount: 1, costPoints: null },
    ]);
    expect(summary.byDay).toHaveLength(7);
  });

  it('reads model from the column first, then params_json', () => {
    expect(resolveDesktopUsageModel('column-model', '{"model":"ignored"}')).toBe('column-model');
    expect(resolveDesktopUsageModel('  ', '{"model":"from-params"}')).toBe('from-params');
    expect(resolveDesktopUsageModel('', '{')).toBe('未知模型');
  });
});

describe('usage 域桥:usage.summary', () => {
  let methods: Methods;

  beforeAll(() => {
    methods = buildUsageDomainMethods() as Methods;
  });

  beforeEach(() => {
    getDb().prepare('DELETE FROM generated_assets').run();
    getDb().prepare('DELETE FROM generation_runs').run();
    getDb().prepare('DELETE FROM providers').run();
    insertProvider('p1', '官方中转');
  });

  it('returns the empty shape when there are no runs', async () => {
    const summaryMethod = methods['usage.summary'];
    expect(summaryMethod).toBeDefined();
    await expect(summaryMethod.handle({ range: '30d' })).resolves.toMatchObject({
      range: '30d',
      generationCount: 0,
      imageCount: 0,
      costPoints: null,
      successRate: null,
      byProvider: [],
      byModel: [],
    });
  });

  it('aggregates in-range runs, counts available assets, and ignores trash / out-of-range', async () => {
    const now = Date.now();
    insertRun('in-success', 'success', { actualCost: 3, createdAt: now - DAY_MS });
    insertRun('in-failed', 'failed', { createdAt: now - 2 * DAY_MS });
    insertRun('in-queued', 'queued', { createdAt: now - 3 * DAY_MS });
    insertRun('trashed', 'success', { actualCost: 99, deletedAt: now, createdAt: now - DAY_MS });
    insertRun('old', 'success', { actualCost: 8, createdAt: now - 100 * DAY_MS });
    insertAsset('img-1', 'in-success', 'available', 0);
    insertAsset('img-2', 'in-success', 'available', 1);
    insertAsset('img-missing', 'in-success', 'missing', 2);
    insertAsset('img-old', 'old');

    const summaryMethod = methods['usage.summary'];
    expect(summaryMethod).toBeDefined();
    const summary = (await summaryMethod.handle({ range: '30d' })) as {
      generationCount: number;
      succeededCount: number;
      failedCount: number;
      imageCount: number;
      costPoints: number | null;
      successRate: number | null;
      byProvider: Array<{ label: string; generationCount: number }>;
    };

    expect(summary.generationCount).toBe(3);
    expect(summary.succeededCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.imageCount).toBe(2);
    expect(summary.costPoints).toBe(3);
    expect(summary.successRate).toBe(0.5);
    expect(summary.byProvider).toEqual([
      { providerId: 'p1', label: '官方中转', generationCount: 3, costPoints: 3 },
    ]);
  });

  it('rejects an unknown range before touching the table', () => {
    const summaryMethod = methods['usage.summary'];
    expect(summaryMethod).toBeDefined();
    expect(() => summaryMethod.input.parse({ range: 'all' })).toThrow();
  });
});
