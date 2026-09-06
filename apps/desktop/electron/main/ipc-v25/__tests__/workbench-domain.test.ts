// workbench/generation 域桥守护:回收站永久删除只对已软删终态行合法,
// 删除后 run 行与磁盘资产文件一并消失(资产行外键级联);
// 参考图上传进 staging 目录、create 时由契约引用重建受管路径。

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
import { BridgeError } from '../envelope';

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

type Methods = Record<
  string,
  { input: { parse(input: unknown): unknown }; handle(input: unknown): Promise<unknown> }
>;

interface CapturedRequest {
  jobId: string;
  providerId: string;
  model?: string;
  prompt: string;
  negative?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  promptId?: string;
  referenceImages?: unknown[];
  promptReferences?: unknown[];
}

interface CapturedOptions {
  retryOfRunId?: string;
  promptAlreadyComposed?: boolean;
  userPrompt?: string;
}

function activateTestAccount(ownerId: string, withWorkspace = true): string | null {
  const db = getDb();
  db.prepare('UPDATE cloud_sync_accounts SET active = 0, enabled = 0').run();
  db.prepare(
    `INSERT INTO cloud_sync_accounts
       (owner_id, username, device_id, device_name, platform, client_version, active, enabled,
        cursor, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'macos', 'test', 1, 1, '0', ?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET active = 1, enabled = 1, updated_at = excluded.updated_at`,
  ).run(ownerId, ownerId, `device-${ownerId}`, '测试设备', Date.now(), Date.now());
  if (!withWorkspace) return null;
  const workspaceId = `account:${ownerId}`;
  db.prepare(
    `INSERT INTO local_workspaces (id, owner_id, kind, created_at, updated_at)
     VALUES (?, ?, 'account', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(workspaceId, ownerId, Date.now(), Date.now());
  return workspaceId;
}

function activateTestWorkspace(ownerId: string): string {
  const workspaceId = activateTestAccount(ownerId);
  if (!workspaceId) throw new Error(`test workspace missing for ${ownerId}`);
  return workspaceId;
}

function insertPrompt(
  workspaceId: string,
  id: string,
  title: string,
  content: string,
  deletedAt: number | null = null,
): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO prompts (workspace_id, id, title, content, rating, is_pinned, source,
         usage_count, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 0, 0, 'manual', 0, ?, ?, ?)`,
    )
    .run(workspaceId, id, title, content, now, now, deletedAt);
}

function insertQueuedJob(
  request: CapturedRequest,
  options: CapturedOptions = {},
  promptSnapshot?: Record<string, unknown>,
): void {
  const userPrompt = options.userPrompt ?? request.prompt;
  const snapshot = promptSnapshot ?? {
    schemaVersion: 1,
    userPrompt,
    basePrompt: userPrompt,
    refinementInstruction: null,
    finalPrompt: request.prompt,
    negativePrompt: request.negative ?? null,
    ...(request.promptReferences?.length ? { promptReferences: request.promptReferences } : {}),
  };
  const params = {
    schemaVersion: 1,
    size: request.size ?? 'auto',
    quality: request.quality ?? 'auto',
    n: 1,
    ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
    ...(request.referenceImages?.length ? { referenceImages: request.referenceImages } : {}),
  };
  getDb()
    .prepare(
      `INSERT INTO generation_runs
         (id, run_kind, prompt_id, provider_id, model, user_prompt, base_prompt, final_prompt,
          negative_prompt, params_json, prompt_snapshot_json, status, created_at)
       VALUES (?, 'free_generation', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    )
    .run(
      request.jobId,
      request.promptId ?? null,
      request.providerId,
      request.model ?? 'test-model',
      userPrompt,
      userPrompt,
      request.prompt,
      request.negative ?? null,
      JSON.stringify(params),
      JSON.stringify(snapshot),
      Date.now(),
    );
}
function insertRun(
  id: string,
  status: string,
  deletedAt: number | null,
  promptId: string | null = null,
): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO generation_runs
         (id, run_kind, prompt_id, provider_id, model, base_prompt, final_prompt,
          params_json, prompt_snapshot_json, status, created_at, deleted_at)
       VALUES (?, 'free_generation', ?, 'p1', 'test-model', 'a prompt', 'a prompt', '{}', '{}', ?, ?, ?)`,
    )
    .run(id, promptId, status, now, deletedAt);
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

  it('generation.get 保留来源 promptId 到 job 与请求快照', async () => {
    const now = Date.now();
    getDb()
      .prepare(
        `INSERT INTO prompts
           (workspace_id, id, title, content, rating, is_pinned, source, usage_count, created_at, updated_at)
         VALUES ('local-only-legacy', 'prompt-job-source', '来源提示词', 'a prompt', 0, 0, 'manual', 0, ?, ?)`,
      )
      .run(now, now);
    insertRun('run-with-prompt', 'success', null, 'prompt-job-source');

    const job = (await methods['generation.get'].handle('run-with-prompt')) as {
      promptId: string | null;
      request: { promptId?: string };
    };

    expect(job.promptId).toBe('prompt-job-source');
    expect(job.request.promptId).toBe('prompt-job-source');
  });

  it('终态 cancel 与 retry 规则和 Web 对齐', async () => {
    insertRun('run-cancelled-idempotent', 'cancelled', null);
    insertRun('run-succeeded-terminal', 'success', null);

    await expect(
      methods['generation.cancel'].handle('run-cancelled-idempotent'),
    ).resolves.toMatchObject({ status: 'cancelled' });

    const cancelError = await methods['generation.cancel']
      .handle('run-succeeded-terminal')
      .catch((reason) => reason);
    expect(cancelError).toBeInstanceOf(BridgeError);
    expect(cancelError).toMatchObject({ code: 'CONFLICT' });

    const retryError = await methods['generation.retry']
      .handle('run-succeeded-terminal')
      .catch((reason) => reason);
    expect(retryError).toBeInstanceOf(BridgeError);
    expect(retryError).toMatchObject({
      code: 'CONFLICT',
      message: '只有失败或取消的任务可以重试',
    });
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

  it('job 带终态用时与种子:duration_ms 优先,缺列退时间戳差值,缺源不伪造 0', async () => {
    const now = Date.now();
    insertRun('run-duration-column', 'success', null);
    getDb()
      .prepare(
        `UPDATE generation_runs
           SET duration_ms = 4200, started_at = ?, finished_at = ?, params_json = ?
         WHERE id = 'run-duration-column'`,
      )
      .run(now - 9_000, now, JSON.stringify({ schemaVersion: 1, size: 'auto', seed: 987654 }));
    insertRun('run-duration-derived', 'success', null);
    getDb()
      .prepare(
        `UPDATE generation_runs SET started_at = ?, finished_at = ? WHERE id = 'run-duration-derived'`,
      )
      .run(now - 1_500, now);
    insertRun('run-duration-unknown', 'failed', null);

    // core 记录的 duration_ms 是权威口径(含上游耗时),不被时间戳差值覆盖。
    await expect(methods['generation.get'].handle('run-duration-column')).resolves.toMatchObject({
      durationMs: 4200,
      seed: 987654,
    });
    await expect(methods['generation.get'].handle('run-duration-derived')).resolves.toMatchObject({
      durationMs: 1500,
      seed: null,
    });
    // 未开跑的失败行:用时未知给 null(渲染层据此不显示「用时」)。
    await expect(methods['generation.get'].handle('run-duration-unknown')).resolves.toMatchObject({
      durationMs: null,
      seed: null,
    });
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

  it('create 对不存在或已删除的 promptId 返回 PROMPT_NOT_FOUND', async () => {
    const error = await methods['generation.create']
      .handle({
        prompt: 'missing prompt source',
        providerId: 'prov-ref',
        promptId: 'missing-prompt',
      })
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({ code: 'NOT_FOUND', message: '提示词不存在' });
    expect(vi.mocked(generate)).not.toHaveBeenCalled();
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

describe('workbench 域桥:归档会话筛选', () => {
  it('archivedOnly 覆盖 include 开关,仅返回已归档且未软删会话', async () => {
    const now = Date.now();
    const insert = getDb().prepare(
      `INSERT INTO workbench_sessions
         (id, title, created_at, updated_at, archived_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run('session-active-only', '普通', now, now, null, null);
    insert.run('session-archived-only', '归档', now, now + 1, now, null);
    insert.run('session-archived-deleted', '归档后删除', now, now + 2, now, now);
    insert.run('session-deleted-only', '仅删除', now, now + 3, null, now);

    const methods = buildWorkbenchDomainMethods() as unknown as Methods;
    const page = (await methods['workbench.listSessions'].handle({
      limit: 20,
      archivedOnly: true,
      includeArchived: true,
      includeDeleted: true,
    })) as { items: Array<{ id: string }> };

    expect(page.items.map((item) => item.id)).toEqual(['session-archived-only']);
  });
});

describe('workbench 域桥:提示词引用选择与快照', () => {
  let methods: Methods;

  beforeAll(() => {
    methods = buildWorkbenchDomainMethods() as Methods;
  });

  afterEach(() => {
    const db = getDb();
    db.prepare('UPDATE cloud_sync_accounts SET active = 0, enabled = 0').run();
    db.prepare("DELETE FROM local_workspaces WHERE owner_id LIKE 'prompt-ref-test-%'").run();
    db.prepare("DELETE FROM cloud_sync_accounts WHERE owner_id LIKE 'prompt-ref-test-%'").run();
    vi.mocked(generate).mockClear();
  });

  async function createAndReadJob(input: Record<string, unknown>): Promise<{
    job: Record<string, any>;
    request: CapturedRequest;
    options: CapturedOptions;
  }> {
    const generateMock = vi.mocked(generate);
    generateMock.mockClear();
    const pending = methods['generation.create'].handle(
      methods['generation.create'].input.parse(input),
    );
    await vi.waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));
    const call = generateMock.mock.calls[0];
    const request = call?.[0] as CapturedRequest;
    const options = (call?.[2] ?? {}) as CapturedOptions;
    insertQueuedJob(request, options);
    return {
      job: (await pending) as Record<string, any>,
      request,
      options,
    };
  }

  it('resolves full and excerpt selections with JavaScript UTF-16 coordinates', async () => {
    const workspaceId = activateTestWorkspace('prompt-ref-test-utf16');
    insertPrompt(workspaceId, 'prompt-ref-utf16', '星空提示', '前🙂后\n完整内容');

    const result = await createAndReadJob({
      prompt: 'raw request',
      providerId: 'prov-ref',
      referenceImages: [],
      promptReferenceSelections: [
        { promptId: 'prompt-ref-utf16', scope: 'full', expectedVersion: 1 },
        {
          promptId: 'prompt-ref-utf16',
          scope: 'excerpt',
          expectedVersion: 1,
          range: { start: 1, end: 4 },
        },
      ],
    });

    expect(result.request.promptReferences).toEqual([
      {
        promptId: 'prompt-ref-utf16',
        title: '星空提示',
        text: '前🙂后\n完整内容',
        scope: 'full',
        sourceVersion: 1,
      },
      {
        promptId: 'prompt-ref-utf16',
        title: '星空提示',
        text: '🙂后',
        scope: 'excerpt',
        sourceVersion: 1,
      },
    ]);
    expect(result.job.promptReferences).toEqual(result.request.promptReferences);
  });

  it('rejects excerpt boundaries that split an astral UTF-16 surrogate pair', async () => {
    const workspaceId = activateTestWorkspace('prompt-ref-test-split-surrogate');
    insertPrompt(workspaceId, 'prompt-ref-split-surrogate', '星空提示', '🙂x');

    for (const range of [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ]) {
      const error = await methods['generation.create']
        .handle(
          methods['generation.create'].input.parse({
            prompt: '',
            providerId: 'prov-ref',
            referenceImages: [],
            promptReferenceSelections: [
              {
                promptId: 'prompt-ref-split-surrogate',
                scope: 'excerpt',
                expectedVersion: 1,
                range,
              },
            ],
          }),
        )
        .catch((reason) => reason);

      expect(error).toBeInstanceOf(BridgeError);
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(vi.mocked(generate)).not.toHaveBeenCalled();
  });

  it('uses the active account workspace when the same prompt id exists in legacy data', async () => {
    const workspaceId = activateTestWorkspace('prompt-ref-test-account');
    insertPrompt('local-only-legacy', 'prompt-ref-same-id', '旧提示词', 'legacy text');
    insertPrompt(workspaceId, 'prompt-ref-same-id', '账号提示词', 'account text');

    const result = await createAndReadJob({
      prompt: '',
      providerId: 'prov-ref',
      referenceImages: [],
      promptReferenceSelections: [
        { promptId: 'prompt-ref-same-id', scope: 'full', expectedVersion: 1 },
      ],
    });

    expect(result.request.promptReferences?.[0]).toMatchObject({
      title: '账号提示词',
      text: 'account text',
    });
  });

  it('uses the legacy workspace for prompt references before explicit adoption', async () => {
    activateTestAccount('prompt-ref-test-missing-workspace', false);
    insertPrompt(
      'local-only-legacy',
      'prompt-ref-missing-workspace',
      '离线提示词',
      'offline prompt text',
    );

    const result = await createAndReadJob({
      prompt: 'raw request',
      providerId: 'prov-ref',
      referenceImages: [],
      promptReferenceSelections: [
        { promptId: 'prompt-ref-missing-workspace', scope: 'full', expectedVersion: 1 },
      ],
    });

    expect(result.request.promptReferences?.[0]).toMatchObject({
      title: '离线提示词',
      text: 'offline prompt text',
    });
  });

  it('rejects missing, deleted, and stale-version prompt references', async () => {
    const workspaceId = activateTestWorkspace('prompt-ref-test-validation');
    insertPrompt(workspaceId, 'prompt-ref-deleted', '已删除', 'deleted text', Date.now());
    insertPrompt(workspaceId, 'prompt-ref-version', '版本提示词', 'version text');

    const createError = async (selection: Record<string, unknown>) =>
      methods['generation.create']
        .handle(
          methods['generation.create'].input.parse({
            prompt: 'raw request',
            providerId: 'prov-ref',
            referenceImages: [],
            promptReferenceSelections: [selection],
          }),
        )
        .catch((reason) => reason);

    await expect(
      createError({ promptId: 'prompt-ref-absent', scope: 'full', expectedVersion: 1 }),
    ).resolves.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      createError({ promptId: 'prompt-ref-deleted', scope: 'full', expectedVersion: 1 }),
    ).resolves.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      createError({ promptId: 'prompt-ref-version', scope: 'full', expectedVersion: 2 }),
    ).resolves.toMatchObject({
      code: 'CONFLICT',
    });
    expect(vi.mocked(generate)).not.toHaveBeenCalled();
  });

  it('rejects invalid excerpt bounds and blank excerpts', async () => {
    const workspaceId = activateTestWorkspace('prompt-ref-test-range');
    insertPrompt(workspaceId, 'prompt-ref-range', '范围提示词', '   🙂   ');

    const createError = async (range: { start: number; end: number }) =>
      methods['generation.create']
        .handle(
          methods['generation.create'].input.parse({
            prompt: 'raw request',
            providerId: 'prov-ref',
            referenceImages: [],
            promptReferenceSelections: [
              { promptId: 'prompt-ref-range', scope: 'excerpt', expectedVersion: 1, range },
            ],
          }),
        )
        .catch((reason) => reason);

    await expect(createError({ start: 0, end: 99 })).resolves.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(createError({ start: 0, end: 3 })).resolves.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(vi.mocked(generate)).not.toHaveBeenCalled();
  });

  it('rejects renderer-owned prompt fields through the strict input schema', () => {
    expect(() =>
      methods['generation.create'].input.parse({
        prompt: 'raw request',
        providerId: 'prov-ref',
        referenceImages: [],
        promptReferenceSelections: [
          {
            promptId: 'prompt-ref-forged',
            scope: 'full',
            expectedVersion: 1,
            title: 'forged renderer title',
            text: 'forged renderer text',
          },
        ],
      }),
    ).toThrow();
  });

  it('passes one shared-composed prompt, raw userPrompt, and immutable references to core', async () => {
    const workspaceId = activateTestWorkspace('prompt-ref-test-compose');
    insertPrompt(workspaceId, 'prompt-ref-compose', '构图参考', 'use cinematic lighting');

    const result = await createAndReadJob({
      prompt: 'raw user request',
      providerId: 'prov-ref',
      size: '1536x1024',
      aspectRatio: '32:18',
      quality: 'high',
      referenceImages: [],
      promptReferenceSelections: [
        { promptId: 'prompt-ref-compose', scope: 'full', expectedVersion: 1 },
      ],
    }).catch((error) => {
      throw error;
    });

    expect(result.request.prompt).toContain('raw user request');
    expect(result.request.prompt).toContain('参考提示词：');
    expect(result.request.prompt).toContain('构图参考');
    expect(result.request.prompt).toContain('画面比例约束：严格按照 16:9');
    expect(result.request.prompt.indexOf('raw user request')).toBeLessThan(
      result.request.prompt.indexOf('参考提示词：'),
    );
    expect(result.request.prompt.indexOf('参考提示词：')).toBeLessThan(
      result.request.prompt.indexOf('画面比例约束：'),
    );
    expect(result.options).toEqual({ promptAlreadyComposed: true, userPrompt: 'raw user request' });
    expect(result.request.promptReferences).toEqual([
      {
        promptId: 'prompt-ref-compose',
        title: '构图参考',
        text: 'use cinematic lighting',
        scope: 'full',
        sourceVersion: 1,
      },
    ]);
  });

  it('keeps job raw text and immutable snapshots after source prompt edits and deletion', async () => {
    const workspaceId = activateTestWorkspace('prompt-ref-test-immutable');
    insertPrompt(workspaceId, 'prompt-ref-immutable', '原始标题', '原始内容');
    const result = await createAndReadJob({
      prompt: 'raw immutable request',
      providerId: 'prov-ref',
      referenceImages: [],
      promptReferenceSelections: [
        { promptId: 'prompt-ref-immutable', scope: 'full', expectedVersion: 1 },
      ],
    });

    getDb()
      .prepare(
        'UPDATE prompts SET title = ?, content = ?, deleted_at = ? WHERE workspace_id = ? AND id = ?',
      )
      .run('新标题', '新内容', Date.now(), workspaceId, 'prompt-ref-immutable');

    const job = (await methods['generation.get'].handle(result.request.jobId)) as Record<
      string,
      any
    >;
    expect(job.userPrompt).toBe('raw immutable request');
    expect(job.promptReferences).toEqual([
      {
        promptId: 'prompt-ref-immutable',
        title: '原始标题',
        text: '原始内容',
        scope: 'full',
        sourceVersion: 1,
      },
    ]);
  });

  it('retries from the stored final request and snapshot after source prompt deletion', async () => {
    const workspaceId = activateTestWorkspace('prompt-ref-test-retry');
    insertPrompt(workspaceId, 'prompt-ref-retry', '重试来源', 'live prompt');
    const sourceRequest: CapturedRequest = {
      jobId: 'prompt-ref-retry-source',
      providerId: 'prov-ref',
      model: 'frozen-model',
      prompt: 'frozen final prompt',
      negative: 'frozen negative',
      size: '1536x1024',
      aspectRatio: '16:9',
      quality: 'high',
      promptId: 'prompt-ref-retry',
      promptReferences: [
        {
          promptId: 'prompt-ref-retry',
          title: '重试来源',
          text: 'frozen reference text',
          scope: 'full',
          sourceVersion: 1,
        },
      ],
    };
    insertQueuedJob(
      sourceRequest,
      { userPrompt: 'raw retry request' },
      {
        schemaVersion: 1,
        userPrompt: 'raw retry request',
        basePrompt: 'frozen base prompt',
        refinementInstruction: null,
        finalPrompt: 'frozen final prompt',
        negativePrompt: 'frozen negative',
        promptReferences: sourceRequest.promptReferences,
      },
    );
    getDb()
      .prepare("UPDATE generation_runs SET status = 'failed' WHERE id = ?")
      .run(sourceRequest.jobId);
    getDb()
      .prepare(
        'UPDATE prompts SET title = ?, content = ?, deleted_at = ? WHERE workspace_id = ? AND id = ?',
      )
      .run('删除后标题', '删除后内容', Date.now(), workspaceId, 'prompt-ref-retry');

    const pending = methods['generation.retry'].handle(sourceRequest.jobId);
    await vi.waitFor(() => expect(vi.mocked(generate)).toHaveBeenCalledTimes(1));
    const call = vi.mocked(generate).mock.calls[0];
    const retryRequest = call?.[0] as CapturedRequest;
    const retryOptions = (call?.[2] ?? {}) as CapturedOptions;
    expect(retryRequest).toMatchObject({
      prompt: 'frozen final prompt',
      negative: 'frozen negative',
      size: '1536x1024',
      aspectRatio: '16:9',
      quality: 'high',
    });
    expect(retryOptions).toMatchObject({ retryOfRunId: sourceRequest.jobId });
    insertQueuedJob(retryRequest, retryOptions, {
      schemaVersion: 1,
      userPrompt: 'raw retry request',
      basePrompt: 'frozen base prompt',
      refinementInstruction: null,
      finalPrompt: 'frozen final prompt',
      negativePrompt: 'frozen negative',
      promptReferences: sourceRequest.promptReferences,
    });
    const retryJob = (await pending) as Record<string, any>;
    expect(retryJob.userPrompt).toBe('raw retry request');
    expect(retryJob.promptReferences).toEqual(sourceRequest.promptReferences);
  });
});
