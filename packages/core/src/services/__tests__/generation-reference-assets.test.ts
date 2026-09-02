import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureTestCoreRuntime, testCorePaths } from '../../testing';

const root = mkdtempSync(join(tmpdir(), 'musefold-generation-assets-'));
const doubaoRuntime = {
  validate: vi.fn(),
  generateImage: vi.fn(),
};
configureTestCoreRuntime(root, { doubaoWeb: doubaoRuntime });

import { closeDb, getDb, initDb } from '../../db/index';
import { createWorkbenchRepositories } from '../../db/repositories/workbench';
import { cancelGeneration, generate } from '../generation';

beforeAll(() => {
  initDb();
  getDb()
    .prepare(
      `INSERT INTO providers
       (id, name, type, base_url, model, has_key, is_active, created_at, updated_at)
     VALUES ('doubao-test', '豆包测试', 'doubao-web', 'https://www.doubao.com/chat/create-image',
       'seedream-4.5', 1, 1, 1, 1)`,
    )
    .run();

  const repositories = createWorkbenchRepositories();
  const run = repositories.runs.create({
    id: 'doubao-parent',
    providerId: 'doubao-test',
    model: 'seedream-4.5',
    userPrompt: '原始请求',
    basePrompt: '原始请求',
    finalPrompt: '原始请求',
    params: { schemaVersion: 1, size: '1024x1024', n: 1 },
    createdAt: 10,
  });
  repositories.runs.start(run.id, run.id, 11);
  repositories.runs.complete(run.id, {
    finishedAt: 12,
    assets: [
      { id: 'doubao-parent', position: 0, mediaPath: '/tmp/doubao-parent-1.png', createdAt: 12 },
      { id: 'doubao-parent-2', position: 1, mediaPath: '/tmp/doubao-parent-2.png', createdAt: 12 },
    ],
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  doubaoRuntime.generateImage.mockResolvedValue({
    historyId: 'child-job',
    status: 'success',
    imagePath: '/tmp/doubao-child.png',
  });
});

afterAll(() => {
  closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe('generation reference asset authorization', () => {
  it('authorizes a non-primary image from a multi-image Doubao history by asset id', async () => {
    const result = await generate({
      jobId: 'child-job',
      providerId: 'doubao-test',
      prompt: '增强晨光',
      size: '1024x1024',
      quality: 'medium',
      n: 1,
      referenceImages: [
        {
          source: 'history',
          historyId: 'doubao-parent',
          assetId: 'doubao-parent-2',
          path: '/tmp/doubao-parent-2.png',
        },
      ],
    });

    expect(result.status).toBe('success');
    expect(doubaoRuntime.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [
          expect.objectContaining({
            assetId: 'doubao-parent-2',
            path: '/tmp/doubao-parent-2.png',
          }),
        ],
      }),
      expect.any(AbortSignal),
    );
  });

  it('rejects an asset id whose stored path does not match the requested path', async () => {
    const result = await generate({
      jobId: 'invalid-child-job',
      providerId: 'doubao-test',
      prompt: '增强晨光',
      size: '1024x1024',
      quality: 'medium',
      n: 1,
      referenceImages: [
        {
          source: 'history',
          historyId: 'doubao-parent',
          assetId: 'doubao-parent-2',
          path: '/tmp/not-the-stored-asset.png',
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'IMAGE_HISTORY_MISSING' },
    });
    expect(doubaoRuntime.generateImage).not.toHaveBeenCalled();
  });

  it('composes 16:9 ratio and multi-image numbering while preserving the user prompt', async () => {
    const result = await generate({
      jobId: 'composed-prompt-job',
      providerId: 'doubao-test',
      prompt: '图 1 用构图，图 2 用配色',
      size: '1536x1024',
      aspectRatio: '16:9',
      quality: 'medium',
      n: 1,
      referenceImages: [
        {
          source: 'history',
          historyId: 'doubao-parent',
          assetId: 'doubao-parent',
          path: '/tmp/doubao-parent-1.png',
        },
        {
          source: 'history',
          historyId: 'doubao-parent',
          assetId: 'doubao-parent-2',
          path: '/tmp/doubao-parent-2.png',
        },
      ],
    });

    expect(result.status).toBe('success');
    const providerRequest = doubaoRuntime.generateImage.mock.calls.at(-1)?.[0];
    expect(providerRequest?.prompt).toContain('参考图按上传顺序编号为图 1、图 2');
    expect(providerRequest?.prompt).toContain('严格按照 16:9 画幅构图');
    const run = createWorkbenchRepositories().runs.get('composed-prompt-job');
    expect(run).toMatchObject({
      userPrompt: '图 1 用构图，图 2 用配色',
      finalPrompt: providerRequest?.prompt,
      promptSnapshot: {
        userPrompt: '图 1 用构图，图 2 用配色',
        finalPrompt: providerRequest?.prompt,
      },
    });
  });

  it('keeps cancellation terminal, removes late managed outputs, and preserves outside paths', async () => {
    const picturesDir = testCorePaths(root).pictures;
    const managedLatePath = join(picturesDir, 'late-success.png');
    const outsideLatePath = join(root, 'late-success-outside.png');
    mkdirSync(picturesDir, { recursive: true });
    writeFileSync(managedLatePath, 'managed-late-output');
    writeFileSync(outsideLatePath, 'outside-late-output');
    let resolveProvider: (value: {
      historyId: string;
      status: 'success';
      imagePath: string;
      images: Array<{ imagePath: string }>;
    }) => void = () => {
      throw new Error('provider resolver missing');
    };
    doubaoRuntime.generateImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProvider = resolve;
        }),
    );

    const pending = generate({
      jobId: 'late-success-job',
      providerId: 'doubao-test',
      prompt: '迟到成功不应覆盖取消',
      size: '1024x1024',
      quality: 'medium',
      n: 1,
    });
    await vi.waitFor(() => expect(doubaoRuntime.generateImage).toHaveBeenCalledOnce());
    expect(cancelGeneration('late-success-job')).toBe(true);
    resolveProvider({
      historyId: 'late-success-job',
      status: 'success',
      imagePath: managedLatePath,
      images: [{ imagePath: managedLatePath }, { imagePath: outsideLatePath }],
    });

    await expect(pending).resolves.toMatchObject({
      status: 'cancelled',
      error: { code: 'CANCELLED' },
    });
    expect(createWorkbenchRepositories().runs.get('late-success-job')?.status).toBe('cancelled');
    expect(existsSync(managedLatePath)).toBe(false);
    expect(existsSync(outsideLatePath)).toBe(true);
    expect(
      getDb()
        .prepare('SELECT count(*) AS value FROM generated_assets WHERE run_id = ?')
        .get('late-success-job'),
    ).toEqual({ value: 0 });
  });

  it('preserves a late output file when another ledger asset references it', async () => {
    const picturesDir = testCorePaths(root).pictures;
    const referencedLatePath = join(picturesDir, 'late-referenced.png');
    mkdirSync(picturesDir, { recursive: true });
    writeFileSync(referencedLatePath, 'referenced-late-output');
    const repositories = createWorkbenchRepositories();
    const holder = repositories.runs.create({
      id: 'late-output-holder',
      providerId: 'doubao-test',
      model: 'seedream-4.5',
      basePrompt: 'holder',
      finalPrompt: 'holder',
      params: { schemaVersion: 1, size: '1024x1024', n: 1 },
      createdAt: 20,
    });
    repositories.runs.start(holder.id, holder.id, 21);
    repositories.runs.complete(holder.id, {
      finishedAt: 22,
      assets: [{ id: 'late-output-holder-asset', position: 0, mediaPath: referencedLatePath }],
    });

    let resolveProvider: (value: {
      historyId: string;
      status: 'success';
      imagePath: string;
    }) => void = () => {
      throw new Error('provider resolver missing');
    };
    doubaoRuntime.generateImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProvider = resolve;
        }),
    );

    const pending = generate({
      jobId: 'late-referenced-job',
      providerId: 'doubao-test',
      prompt: '迟到结果复用已有文件',
      size: '1024x1024',
      quality: 'medium',
      n: 1,
    });
    await vi.waitFor(() => expect(doubaoRuntime.generateImage).toHaveBeenCalledOnce());
    expect(cancelGeneration('late-referenced-job')).toBe(true);
    resolveProvider({
      historyId: 'late-referenced-job',
      status: 'success',
      imagePath: referencedLatePath,
    });

    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    expect(existsSync(referencedLatePath)).toBe(true);
  });
  it('returns cancelled when a provider failure arrives after cancellation', async () => {
    let rejectProvider: (error: Error & { code?: string }) => void = () => {
      throw new Error('provider rejector missing');
    };
    doubaoRuntime.generateImage.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectProvider = reject;
        }),
    );

    const pending = generate({
      jobId: 'late-failure-job',
      providerId: 'doubao-test',
      prompt: '迟到失败不应覆盖取消',
      size: '1024x1024',
      quality: 'medium',
      n: 1,
    });
    await vi.waitFor(() => expect(doubaoRuntime.generateImage).toHaveBeenCalledOnce());
    expect(cancelGeneration('late-failure-job')).toBe(true);
    const lateFailure = Object.assign(new Error('provider failed late'), {
      code: 'LATE_FAILURE',
    });
    rejectProvider(lateFailure);

    await expect(pending).resolves.toMatchObject({
      status: 'cancelled',
      error: { code: 'CANCELLED' },
    });
    expect(createWorkbenchRepositories().runs.get('late-failure-job')).toMatchObject({
      status: 'cancelled',
      errorCode: null,
      errorMessage: null,
    });
  });

  it('returns cancelled without starting the provider when the caller signal is already aborted', async () => {
    const signalController = new AbortController();
    signalController.abort();

    const result = await generate(
      {
        jobId: 'pre-aborted-job',
        providerId: 'doubao-test',
        prompt: '调用前取消',
        size: '1024x1024',
        quality: 'medium',
        n: 1,
      },
      undefined,
      { signal: signalController.signal },
    );

    expect(result).toMatchObject({
      status: 'cancelled',
      error: { code: 'CANCELLED' },
    });
    expect(doubaoRuntime.generateImage).not.toHaveBeenCalled();
    expect(createWorkbenchRepositories().runs.get('pre-aborted-job')?.status).toBe('cancelled');
  });

  it('links caller cancellation to the provider signal and keeps cancellation terminal', async () => {
    const signalController = new AbortController();
    let providerSignal: AbortSignal | undefined;
    let resolveProvider: (value: {
      historyId: string;
      status: 'success';
      imagePath: string;
    }) => void = () => {
      throw new Error('provider resolver missing');
    };
    doubaoRuntime.generateImage.mockImplementationOnce(
      (_request, signal) =>
        new Promise((resolve) => {
          providerSignal = signal;
          resolveProvider = resolve;
        }),
    );

    const pending = generate(
      {
        jobId: 'caller-cancel-job',
        providerId: 'doubao-test',
        prompt: '请求中取消',
        size: '1024x1024',
        quality: 'medium',
        n: 1,
      },
      undefined,
      { signal: signalController.signal },
    );
    await vi.waitFor(() => expect(doubaoRuntime.generateImage).toHaveBeenCalledOnce());
    expect(providerSignal).toBeInstanceOf(AbortSignal);
    signalController.abort();
    expect(providerSignal?.aborted).toBe(true);
    resolveProvider({
      historyId: 'caller-cancel-job',
      status: 'success',
      imagePath: join(testCorePaths(root).pictures, 'caller-late-success.png'),
    });

    await expect(pending).resolves.toMatchObject({
      status: 'cancelled',
      error: { code: 'CANCELLED' },
    });
    expect(createWorkbenchRepositories().runs.get('caller-cancel-job')?.status).toBe('cancelled');
  });
  it('retries only from a terminal source and preserves its prompt and request snapshots', async () => {
    const repositories = createWorkbenchRepositories();
    repositories.sessions.ensure({ id: 'retry-session', title: '重试会话', createdAt: 1 });
    const rootRun = repositories.runs.create({
      id: 'retry-lineage-root',
      providerId: 'doubao-test',
      model: 'root-model',
      basePrompt: 'root',
      finalPrompt: 'root',
      params: { schemaVersion: 1, size: '1024x1024', n: 1 },
      createdAt: 2,
    });
    repositories.runs.start(rootRun.id, rootRun.id, 3);
    repositories.runs.fail(rootRun.id, 'ROOT_FAILURE', 'root failed', 4);
    const prompt = { id: 'retry-prompt' };
    getDb()
      .prepare(
        `INSERT INTO prompts (workspace_id, id, title, content, created_at, updated_at)
         VALUES ('local-only-legacy', ?, ?, ?, ?, ?)`,
      )
      .run(prompt.id, '重试提示词', 'source prompt', 4, 4);
    const sourceParams = {
      schemaVersion: 1 as const,
      size: '1536x1024' as const,
      aspectRatio: '16:9',
      quality: 'high' as const,
      n: 1,
      frozenMarker: 'source-snapshot',
    };
    const sourceSnapshot = {
      schemaVersion: 1 as const,
      userPrompt: 'source user prompt',
      basePrompt: 'source base prompt',
      refinementInstruction: null,
      finalPrompt: 'source frozen final prompt',
      negativePrompt: 'source negative prompt',
    };
    const source = repositories.runs.create({
      id: 'retry-source',
      runKind: 'free_generation',
      workbenchSessionId: 'retry-session',
      workbenchTurnId: 'retry-turn',
      turnIndex: 4,
      resultIndex: 2,
      parentRunId: rootRun.id,
      promptId: prompt.id,
      providerId: 'doubao-test',
      model: 'source-model',
      userPrompt: sourceSnapshot.userPrompt,
      basePrompt: sourceSnapshot.basePrompt,
      finalPrompt: sourceSnapshot.finalPrompt,
      negativePrompt: sourceSnapshot.negativePrompt,
      params: sourceParams,
      promptSnapshot: sourceSnapshot,
      createdAt: 5,
    });
    repositories.runs.start(source.id, source.id, 6);
    repositories.runs.fail(source.id, 'SOURCE_FAILURE', 'source failed', 7);

    const result = await generate(
      {
        jobId: 'retry-child',
        providerId: 'missing-provider',
        model: 'caller-model',
        prompt: 'caller prompt must be ignored',
        negative: 'caller negative must be ignored',
        size: '1024x1024',
        aspectRatio: '1:1',
        quality: 'low',
        n: 1,
      },
      undefined,
      { retryOfRunId: source.id },
    );

    expect(result.status).toBe('success');
    const providerRequest = doubaoRuntime.generateImage.mock.calls.at(-1)?.[0];
    expect(providerRequest).toMatchObject({
      providerId: 'doubao-test',
      model: 'source-model',
      prompt: 'source frozen final prompt',
      negative: 'source negative prompt',
      size: '1536x1024',
      quality: 'high',
      n: 1,
    });
    expect(providerRequest?.prompt).not.toContain('画面比例约束：');
    expect(repositories.runs.get('retry-child')).toMatchObject({
      runKind: 'retry',
      retryOfRunId: source.id,
      parentRunId: rootRun.id,
      workbenchSessionId: 'retry-session',
      workbenchTurnId: 'retry-turn',
      turnIndex: 4,
      resultIndex: 2,
      promptId: prompt.id,
      providerId: 'doubao-test',
      model: 'source-model',
      userPrompt: sourceSnapshot.userPrompt,
      basePrompt: sourceSnapshot.basePrompt,
      finalPrompt: sourceSnapshot.finalPrompt,
      negativePrompt: sourceSnapshot.negativePrompt,
      params: sourceParams,
      promptSnapshot: sourceSnapshot,
    });
    expect(repositories.runs.get('retry-child')?.params.aspectRatio).toBe('16:9');
  });

  it('preserves the parent final prompt as refinement lineage', async () => {
    const result = await generate({
      jobId: 'refinement-child-job',
      providerId: 'doubao-test',
      prompt: '图 1 为本次微调目标。\n\n原始请求\n\n微调要求：\n增强晨光',
      size: '1024x1024',
      quality: 'medium',
      n: 1,
      parentHistoryId: 'doubao-parent',
      sourceAssetId: 'doubao-parent-2',
      refinementInstruction: '增强晨光',
      referenceImages: [
        {
          source: 'history',
          historyId: 'doubao-parent',
          assetId: 'doubao-parent-2',
          path: '/tmp/doubao-parent-2.png',
        },
      ],
      workbench: {
        sessionId: 'refinement-session',
        sessionTitle: '微调测试',
        turnId: 'refinement-turn',
        turnIndex: 1,
        resultIndex: 0,
        userPrompt: '增强晨光',
      },
    });

    expect(result.status).toBe('success');
    const run = createWorkbenchRepositories().runs.get('refinement-child-job');
    expect(run).toMatchObject({
      runKind: 'refinement',
      parentRunId: 'doubao-parent',
      basePrompt: '原始请求',
      refinementInstruction: '增强晨光',
      finalPrompt: '图 1 为本次微调目标。\n\n原始请求\n\n微调要求：\n增强晨光',
      promptSnapshot: {
        userPrompt: '增强晨光',
        basePrompt: '原始请求',
        refinementInstruction: '增强晨光',
        finalPrompt: '图 1 为本次微调目标。\n\n原始请求\n\n微调要求：\n增强晨光',
      },
    });
  });
});
