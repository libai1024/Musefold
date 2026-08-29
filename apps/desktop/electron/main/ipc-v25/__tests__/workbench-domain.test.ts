// workbench/generation 域桥守护:回收站永久删除只对已软删终态行合法,
// 删除后 run 行与磁盘资产文件一并消失(资产行外键级联);
// 参考图上传进 staging 目录、create 时由契约引用重建受管路径。

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const tempDir = mkdtempSync(join(tmpdir(), 'musefold-workbench-domain-'));

vi.mock('electron', () => ({
  app: { getPath: () => tempDir, getVersion: () => '2.5.0-test' },
  dialog: { showSaveDialog: vi.fn() },
}));
vi.mock('../../../system/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@musefold/core/services/generation', () => ({
  generate: vi.fn(async () => undefined),
  cancelGeneration: vi.fn(),
}));

import { getDb } from '@musefold/core/db';
import { configureCoreRuntime } from '@musefold/core/runtime';
import { generate } from '@musefold/core/services/generation';
import { dialog } from 'electron';
import { buildWorkbenchDomainMethods } from '../workbench-domain';

configureCoreRuntime({
  getPaths: () => ({
    userData: tempDir,
    db: join(tempDir, 'test.db'),
    backups: tempDir,
    previews: tempDir,
    pictures: tempDir,
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

type Methods = Record<string, { handle(input: unknown): Promise<unknown> }>;

function insertRun(id: string, status: string, deletedAt: number | null): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO generation_runs
         (id, run_kind, provider_id, model, base_prompt, final_prompt,
          params_json, prompt_snapshot_json, status, created_at, deleted_at)
       VALUES (?, 'free_generation', 'p1', 'test-model', 'a prompt', 'a prompt', '{}', '{}', ?, ?, ?)`,
    )
    .run(id, status, now, deletedAt);
}

function insertAsset(id: string, runId: string, mediaPath: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO generated_assets (id, run_id, position, status, media_path, created_at)
       VALUES (?, ?, 0, 'available', ?, ?)`,
    )
    .run(id, runId, mediaPath, Date.now());
}

describe('workbench 域桥:生成记录永久删除', () => {
  let methods: Methods;

  beforeAll(() => {
    methods = buildWorkbenchDomainMethods() as Methods;
  });

  it('活跃行与进行中行拒绝 purge', async () => {
    insertRun('run-active', 'success', null);
    await expect(methods['generation.purge'].handle('run-active')).rejects.toThrow(
      '只能永久删除回收站中的记录',
    );
    insertRun('run-running', 'running', Date.now());
    await expect(methods['generation.purge'].handle('run-running')).rejects.toThrow(
      '任务仍在进行中',
    );
  });

  it('软删终态行 purge:run 行、资产行、磁盘文件一并消失', async () => {
    const mediaPath = join(tempDir, 'asset-purge-target.png');
    writeFileSync(mediaPath, 'fake-image-bytes');
    insertRun('run-purge', 'failed', Date.now());
    insertAsset('asset-purge', 'run-purge', mediaPath);

    await expect(methods['generation.purge'].handle('run-purge')).resolves.toBeUndefined();

    const run = getDb().prepare('SELECT 1 FROM generation_runs WHERE id = ?').get('run-purge');
    expect(run).toBeUndefined();
    const asset = getDb().prepare('SELECT 1 FROM generated_assets WHERE id = ?').get('asset-purge');
    expect(asset).toBeUndefined();
    expect(existsSync(mediaPath)).toBe(false);
  });
});

/** 最小 PNG 魔数 + 填充(staging 只嗅前 12 字节)。 */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

interface ContractReference {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  byteSize: number;
}

describe('workbench 域桥:参考图输入链(ui-parity 03 §7 P0)', () => {
  let methods: Record<string, { handle(input: unknown): Promise<unknown> }>;

  beforeAll(() => {
    methods = buildWorkbenchDomainMethods() as typeof methods;
    const now = Date.now();
    getDb()
      .prepare(
        `INSERT INTO providers (id, name, type, base_url, model, created_at, updated_at)
         VALUES ('prov-ref', '测试连接', 'openai-compatible', 'https://gw.example', 'flux', ?, ?)`,
      )
      .run(now, now);
  });

  it('上传:字节进 staging 目录,返回契约引用(media:// 展示 URL)', async () => {
    const reference = (await methods['generation.uploadReferenceImage'].handle({
      name: 'ref.png',
      bytes: PNG_BYTES,
    })) as ContractReference;

    expect(reference.mimeType).toBe('image/png');
    expect(reference.name).toBe('ref.png');
    expect(reference.byteSize).toBe(PNG_BYTES.byteLength);
    expect(reference.url.startsWith('media://local/?p=')).toBe(true);
    const stagedPath = join(tempDir, 'uploads', `${reference.id}.png`);
    expect(existsSync(stagedPath)).toBe(true);
  });

  it('上传:非图片字节被拒(魔数嗅探)', async () => {
    await expect(
      methods['generation.uploadReferenceImage'].handle({
        name: 'fake.png',
        bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
      }),
    ).rejects.toThrow('请选择 PNG、JPG 或 WebP 图片');
  });

  it('create:契约引用重建受管路径传给 core;回读回合带参考图缩略', async () => {
    const reference = (await methods['generation.uploadReferenceImage'].handle({
      name: 'style.png',
      bytes: PNG_BYTES,
    })) as ContractReference;

    const generateMock = vi.mocked(generate);
    generateMock.mockClear();

    const pending = methods['generation.create'].handle({
      prompt: 'remix with style',
      providerId: 'prov-ref',
      referenceImages: [reference],
    });
    // 桥不 await 生成完成;mock generate 不落 run 行,由测试代插使 waitForRun 命中。
    await vi.waitFor(() => {
      expect(generateMock).toHaveBeenCalledTimes(1);
    });
    const req = generateMock.mock.calls[0]?.[0] as {
      jobId?: string;
      referenceImages?: Array<{ path: string; source: string; name?: string }>;
    };
    expect(req.referenceImages).toHaveLength(1);
    expect(req.referenceImages?.[0]?.source).toBe('upload');
    expect(req.referenceImages?.[0]?.name).toBe('style.png');
    expect(basename(req.referenceImages?.[0]?.path ?? '')).toBe(`${reference.id}.png`);

    const now = Date.now();
    getDb()
      .prepare(
        `INSERT INTO generation_runs
           (id, run_kind, provider_id, model, base_prompt, final_prompt,
            params_json, prompt_snapshot_json, status, created_at)
         VALUES (?, 'free_generation', 'prov-ref', 'flux', 'remix with style', 'remix with style', ?, '{}', 'queued', ?)`,
      )
      .run(
        req.jobId,
        JSON.stringify({
          size: 'auto',
          quality: 'auto',
          referenceImages: req.referenceImages,
        }),
        now,
      );

    const job = (await pending) as {
      request: { referenceImages: ContractReference[] };
    };
    expect(job.request.referenceImages).toHaveLength(1);
    expect(job.request.referenceImages[0]?.id).toBe(reference.id);
    expect(job.request.referenceImages[0]?.url.startsWith('media://local/?p=')).toBe(true);
  });

  it('create:引用不存在(staging 缺文件)直接拒,不发起生成', async () => {
    const generateMock = vi.mocked(generate);
    generateMock.mockClear();
    await expect(
      methods['generation.create'].handle({
        prompt: 'bad reference',
        providerId: 'prov-ref',
        referenceImages: [
          {
            id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
            url: 'media://local/?p=%2Fnope.png',
            name: 'nope.png',
            mimeType: 'image/png',
            byteSize: 12,
          },
        ],
      }),
    ).rejects.toThrow('已不可用');
    expect(generateMock).not.toHaveBeenCalled();
  });
});

describe('workbench 域桥:保存图片(ui-parity 03/05 结果消费)', () => {
  let methods: Methods;
  const showSaveDialog = vi.mocked(dialog.showSaveDialog);

  beforeAll(() => {
    methods = buildWorkbenchDomainMethods() as Methods;
  });

  it('确认保存:默认名承入参,文件复制到所选路径,返回 saved', async () => {
    const sourcePath = join(tempDir, 'asset-save-source.png');
    writeFileSync(sourcePath, 'saved-bytes');
    const destPath = join(tempDir, 'asset-save-copy.png');
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: destPath });

    await expect(
      methods['generation.saveAsset'].handle({
        url: `media://local/?p=${encodeURIComponent(sourcePath)}`,
        name: 'musefold-abc123.png',
      }),
    ).resolves.toBe('saved');

    expect(readFileSync(destPath, 'utf8')).toBe('saved-bytes');
    expect(showSaveDialog.mock.calls.at(-1)?.[0]?.defaultPath).toBe(
      join(tempDir, 'musefold-abc123.png'),
    );
  });

  it('取消系统对话框:返回 cancelled,不视为错误', async () => {
    const sourcePath = join(tempDir, 'asset-save-cancel.png');
    writeFileSync(sourcePath, 'x');
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' });

    await expect(
      methods['generation.saveAsset'].handle({
        url: `media://local/?p=${encodeURIComponent(sourcePath)}`,
        name: 'cancelled.png',
      }),
    ).resolves.toBe('cancelled');
  });

  it('受管根目录之外或非 media:// 的来源拒绝(防目录穿越)', async () => {
    showSaveDialog.mockClear();
    await expect(
      methods['generation.saveAsset'].handle({
        url: 'media://local/?p=%2Fetc%2Fhosts',
        name: 'escape.png',
      }),
    ).rejects.toThrow('不存在或不可访问');
    await expect(
      methods['generation.saveAsset'].handle({
        url: 'https://cdn.example/remote.png',
        name: 'remote.png',
      }),
    ).rejects.toThrow('不存在或不可访问');
    expect(showSaveDialog).not.toHaveBeenCalled();
  });
});
