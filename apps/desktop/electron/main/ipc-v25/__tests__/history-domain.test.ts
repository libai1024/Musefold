// 历史维护域桥守护(ui-parity 05 §7):批量清理的两种软删只碰终态未删行、
// 清空回收站连磁盘资产一起删;磁盘占用只回聚合数字;
// 本机文件动作只按受管资产 id 解析路径,越界路径与缺文件一律拒绝。

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tempDir = mkdtempSync(join(tmpdir(), 'musefold-history-domain-'));
const picturesDir = join(tempDir, 'pictures');
mkdirSync(picturesDir, { recursive: true });

const revealed: string[] = [];
const clipboardWrites: string[] = [];
let nextImageEmpty = false;

vi.mock('electron', () => ({
  app: { getPath: () => tempDir, getVersion: () => '2.5.0-test' },
  dialog: { showSaveDialog: vi.fn() },
  shell: { showItemInFolder: (path: string) => revealed.push(path) },
  clipboard: { writeImage: (image: { __path: string }) => clipboardWrites.push(image.__path) },
  nativeImage: {
    createFromPath: (path: string) => ({ __path: path, isEmpty: () => nextImageEmpty }),
  },
}));
vi.mock('../../../system/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { getDb } from '@musefold/core/db';
import { configureCoreRuntime } from '@musefold/core/runtime';
import { BridgeError } from '../envelope';
import { buildHistoryDomainMethods } from '../history-domain';

configureCoreRuntime({
  getPaths: () => ({
    userData: tempDir,
    db: join(tempDir, 'test.db'),
    backups: tempDir,
    previews: join(tempDir, 'previews'),
    pictures: picturesDir,
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

const DAY_MS = 24 * 60 * 60_000;

function insertRun(
  id: string,
  status: string,
  options: { deletedAt?: number | null; createdAt?: number } = {},
): void {
  getDb()
    .prepare(
      `INSERT INTO generation_runs
         (id, run_kind, prompt_id, provider_id, model, base_prompt, final_prompt,
          params_json, prompt_snapshot_json, status, created_at, deleted_at)
       VALUES (?, 'free_generation', NULL, 'p1', 'test-model', 'a prompt', 'a prompt', '{}', '{}', ?, ?, ?)`,
    )
    .run(id, status, options.createdAt ?? Date.now(), options.deletedAt ?? null);
}

function insertAsset(
  id: string,
  runId: string,
  mediaPath: string | null,
  status = 'available',
): void {
  getDb()
    .prepare(
      `INSERT INTO generated_assets (id, run_id, position, status, media_path, created_at)
       VALUES (?, ?, 0, ?, ?, ?)`,
    )
    .run(id, runId, status, mediaPath, Date.now());
}

function writeManagedImage(name: string): string {
  const path = join(picturesDir, name);
  writeFileSync(path, 'fake-image-bytes');
  return path;
}

function runIds(): string[] {
  return (
    getDb().prepare('SELECT id FROM generation_runs ORDER BY id').all() as Array<{
      id: string;
    }>
  ).map((row) => row.id);
}

describe('history 域桥:批量清理', () => {
  let methods: Methods;

  beforeAll(() => {
    methods = buildHistoryDomainMethods() as Methods;
  });

  beforeEach(() => {
    getDb().prepare('DELETE FROM generation_runs').run();
    revealed.length = 0;
    clipboardWrites.length = 0;
    nextImageEmpty = false;
  });

  it('清 30 天前:只软删创建时间过窗口的终态行,进行中与新行不动', async () => {
    insertRun('old-success', 'success', { createdAt: Date.now() - 40 * DAY_MS });
    insertRun('old-running', 'running', { createdAt: Date.now() - 40 * DAY_MS });
    insertRun('recent-success', 'success', { createdAt: Date.now() - 2 * DAY_MS });
    insertRun('old-already-trashed', 'failed', {
      createdAt: Date.now() - 40 * DAY_MS,
      deletedAt: Date.now(),
    });

    await expect(
      methods['generation.cleanup']!.handle({ scope: 'older-than-30d' }),
    ).resolves.toEqual({ affected: 1 });

    const rows = getDb()
      .prepare('SELECT id, deleted_at FROM generation_runs ORDER BY id')
      .all() as Array<{ id: string; deleted_at: number | null }>;
    const deletedAtById = Object.fromEntries(rows.map((row) => [row.id, row.deleted_at]));
    expect(deletedAtById['old-success']).not.toBeNull();
    expect(deletedAtById['old-running']).toBeNull();
    expect(deletedAtById['recent-success']).toBeNull();
    // 已在回收站的行不重复计数。
    expect(deletedAtById['old-already-trashed']).not.toBeNull();
  });

  it('清失败与已取消:软删入回收站且保留资产文件(记录可恢复)', async () => {
    const failedImage = writeManagedImage('cleanup-failed.png');
    insertRun('failed-run', 'failed');
    insertAsset('asset-failed', 'failed-run', failedImage);
    insertRun('cancelled-run', 'cancelled');
    insertRun('success-run', 'success');

    await expect(
      methods['generation.cleanup']!.handle({ scope: 'failed-and-cancelled' }),
    ).resolves.toEqual({ affected: 2 });

    // 软删语义:行还在(可恢复),图片文件不动。
    expect(runIds()).toEqual(['cancelled-run', 'failed-run', 'success-run']);
    expect(existsSync(failedImage)).toBe(true);
    const successDeletedAt = getDb()
      .prepare('SELECT deleted_at FROM generation_runs WHERE id = ?')
      .get('success-run') as { deleted_at: number | null };
    expect(successDeletedAt.deleted_at).toBeNull();
  });

  it('清空回收站:软删终态行连磁盘资产一起删,未删行与进行中行留下', async () => {
    const trashedImage = writeManagedImage('cleanup-trashed.png');
    const keptImage = writeManagedImage('cleanup-kept.png');
    insertRun('trashed-a', 'success', { deletedAt: Date.now() });
    insertAsset('asset-trashed', 'trashed-a', trashedImage);
    insertRun('trashed-b', 'cancelled', { deletedAt: Date.now() });
    insertRun('alive', 'success');
    insertAsset('asset-alive', 'alive', keptImage);
    // 软删但仍在跑的行不该被批量清掉(状态不在终态集合)。
    insertRun('trashed-running', 'running', { deletedAt: Date.now() });

    await expect(methods['generation.cleanup']!.handle({ scope: 'empty-trash' })).resolves.toEqual({
      affected: 2,
    });

    expect(runIds()).toEqual(['alive', 'trashed-running']);
    expect(existsSync(trashedImage)).toBe(false);
    expect(existsSync(keptImage)).toBe(true);
  });

  it('空回收站清理返回 0 而不是报错', async () => {
    insertRun('alive', 'success');
    await expect(methods['generation.cleanup']!.handle({ scope: 'empty-trash' })).resolves.toEqual({
      affected: 0,
    });
    expect(runIds()).toEqual(['alive']);
  });

  it('拒绝未知清理范围(契约 strict)', () => {
    expect(() => methods['generation.cleanup']!.input.parse({ scope: 'everything' })).toThrow();
    expect(() =>
      methods['generation.cleanup']!.input.parse({ scope: 'empty-trash', extra: 1 }),
    ).toThrow();
  });
});

describe('history 域桥:磁盘占用与本机文件动作', () => {
  let methods: Methods;

  beforeAll(() => {
    methods = buildHistoryDomainMethods() as Methods;
  });

  beforeEach(() => {
    getDb().prepare('DELETE FROM generation_runs').run();
    revealed.length = 0;
    clipboardWrites.length = 0;
    nextImageEmpty = false;
  });

  it('getStorageUsage 只回聚合字节数与文件数,不外露目录路径', async () => {
    writeManagedImage('usage-1.png');
    writeManagedImage('usage-2.webp');
    // 非图片扩展名不计入(承旧 collectImageDiskUsage 口径)。
    writeFileSync(join(picturesDir, 'notes.txt'), 'x');

    const usage = (await methods['generation.getStorageUsage']!.handle(undefined)) as Record<
      string,
      unknown
    >;

    expect(Object.keys(usage).sort()).toEqual(['bytes', 'fileCount']);
    expect(usage.fileCount).toBeGreaterThanOrEqual(2);
    expect(usage.bytes).toBeGreaterThan(0);
    expect(JSON.stringify(usage)).not.toContain(tempDir);
  });

  it('revealAsset 按受管资产 id 解析路径后交给系统文件管理器', async () => {
    const image = writeManagedImage('reveal-me.png');
    insertRun('run-reveal', 'success');
    insertAsset('asset-reveal', 'run-reveal', image);

    await expect(
      methods['generation.revealAsset']!.handle('asset-reveal'),
    ).resolves.toBeUndefined();
    expect(revealed).toEqual([image]);
  });

  it('copyAssetToClipboard 写入图片;解码失败给结构化错误', async () => {
    const image = writeManagedImage('copy-me.png');
    insertRun('run-copy', 'success');
    insertAsset('asset-copy', 'run-copy', image);

    await expect(
      methods['generation.copyAssetToClipboard']!.handle('asset-copy'),
    ).resolves.toBeUndefined();
    expect(clipboardWrites).toEqual([image]);

    nextImageEmpty = true;
    const error = await methods['generation.copyAssetToClipboard']!.handle('asset-copy').catch(
      (reason) => reason,
    );
    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('拒绝受管根之外的路径、缺文件与不存在的资产,错误文案不含绝对路径', async () => {
    // 目录穿越:media_path 指向受管根之外 → 一律按不可访问拒绝。
    const outsidePath = join(tempDir, '..', 'outside-secret.png');
    insertRun('run-outside', 'success');
    insertAsset('asset-outside', 'run-outside', outsidePath);
    insertRun('run-missing-file', 'success');
    insertAsset('asset-missing-file', 'run-missing-file', join(picturesDir, 'not-written.png'));
    // 非 available 资产(文件已丢)即便磁盘上还有同名文件也不放行。
    insertRun('run-unavailable', 'success');
    insertAsset('asset-unavailable', 'run-unavailable', writeManagedImage('gone.png'), 'missing');

    for (const assetId of ['asset-outside', 'asset-missing-file', 'asset-unavailable']) {
      const error = await methods['generation.revealAsset']!.handle(assetId).catch(
        (reason) => reason,
      );
      expect(error).toBeInstanceOf(BridgeError);
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((error as Error).message).not.toContain(tempDir);
    }

    const notFound = await methods['generation.revealAsset']!.handle('asset-does-not-exist').catch(
      (reason) => reason,
    );
    expect(notFound).toMatchObject({ code: 'NOT_FOUND' });
    expect(revealed).toEqual([]);
  });
});
