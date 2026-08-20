import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchSessionListResult } from '@musefold/desktop-contracts/workbench';
import { DEFAULT_WORKBENCH_PARAMS } from '../draftController';
import { type WorkbenchIO, resetWorkbenchIOForTests, setWorkbenchIOForTests } from '../io';
import { DesktopWorkbenchSessionController } from '../sessionController';
import type { GenerationTurn } from '../types';

function turn(id: string): GenerationTurn {
  return {
    id,
    prompt: 'prompt',
    userPrompt: 'prompt',
    references: [],
    negativePrompt: '',
    source: { kind: 'manual' },
    providerId: 'p1',
    params: { ...DEFAULT_WORKBENCH_PARAMS },
    status: 'running',
    results: [],
    referenceImages: [],
    createdAt: 1,
  };
}

function result(id: string): WorkbenchSessionListResult {
  return {
    items: [
      {
        id,
        title: id,
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
        deletedAt: null,
        turnCount: 0,
        runCount: 0,
        latestAssetPath: null,
        conversationKind: 'prompt',
        latestStatus: null,
      },
    ],
    total: 1,
    limit: 200,
    offset: 0,
  };
}

function io(patch: Partial<WorkbenchIO>): WorkbenchIO {
  return {
    listDesktopWorkbenchSessions: vi.fn(),
    getDesktopWorkbenchSession: vi.fn(),
    ensureWorkbenchSession: vi.fn(),
    renameWorkbenchSession: vi.fn(),
    archiveWorkbenchSession: vi.fn(),
    deleteWorkbenchSession: vi.fn(),
    generateImage: vi.fn(),
    cancelImage: vi.fn(),
    retryImage: vi.fn(),
    onImageGenerationProgress: vi.fn(() => () => undefined),
    ...patch,
  } as unknown as WorkbenchIO;
}

afterEach(() => resetWorkbenchIOForTests());

describe('desktop workbench session controller', () => {
  it('drops an older list response after a newer request wins', async () => {
    let resolveFirst!: (value: WorkbenchSessionListResult) => void;
    const list = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(result('new'));
    setWorkbenchIOForTests(io({ listDesktopWorkbenchSessions: list }));
    const controller = new DesktopWorkbenchSessionController();

    const first = controller.list(false);
    await expect(controller.list(false)).resolves.toMatchObject({
      status: 'success',
      value: { items: [{ id: 'new' }] },
    });
    resolveFirst(result('old'));
    await expect(first).resolves.toEqual({ status: 'stale' });
  });

  it('restores cached turns without issuing a desktop document read', () => {
    const get = vi.fn();
    setWorkbenchIOForTests(io({ getDesktopWorkbenchSession: get }));
    const controller = new DesktopWorkbenchSessionController();
    controller.cacheTurns('s1', [turn('t1')]);

    expect(controller.open('s1')).toMatchObject({
      source: 'cache',
      turns: [{ id: 't1' }],
    });
    expect(get).not.toHaveBeenCalled();
  });
});
