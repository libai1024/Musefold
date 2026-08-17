import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureTestCoreRuntime } from '../../testing';

const root = mkdtempSync(join(tmpdir(), 'musefold-generation-assets-'));
const doubaoRuntime = {
  validate: vi.fn(),
  generateImage: vi.fn(),
};
configureTestCoreRuntime(root, { doubaoWeb: doubaoRuntime });

import { closeDb, getDb, initDb } from '../../db/index';
import { createWorkbenchRepositories } from '../../db/repositories/workbench';
import { generate } from '../generation';

beforeAll(() => {
  initDb();
  getDb().prepare(
    `INSERT INTO providers
       (id, name, type, base_url, model, has_key, is_active, created_at, updated_at)
     VALUES ('doubao-test', '豆包测试', 'doubao-web', 'https://www.doubao.com/chat/create-image',
       'seedream-4.5', 1, 1, 1, 1)`,
  ).run();

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
      referenceImages: [{
        source: 'history',
        historyId: 'doubao-parent',
        assetId: 'doubao-parent-2',
        path: '/tmp/doubao-parent-2.png',
      }],
    });

    expect(result.status).toBe('success');
    expect(doubaoRuntime.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [expect.objectContaining({
          assetId: 'doubao-parent-2',
          path: '/tmp/doubao-parent-2.png',
        })],
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
      referenceImages: [{
        source: 'history',
        historyId: 'doubao-parent',
        assetId: 'doubao-parent-2',
        path: '/tmp/not-the-stored-asset.png',
      }],
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'IMAGE_HISTORY_MISSING' },
    });
    expect(doubaoRuntime.generateImage).not.toHaveBeenCalled();
  });
});
