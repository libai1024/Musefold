import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORKBENCH_PARAMS } from '../draftController';
import {
  applyGenerationProgress,
  applyImageResult,
  resultStatus,
  withRunRegistered,
  withRunReleased,
} from '../generationSyncController';
import { workbenchSessionController } from '../sessionController';
import type { GenerationResultItem, GenerationTurn } from '../types';

function turn(results: GenerationResultItem[]): GenerationTurn {
  return {
    id: 't1',
    prompt: 'prompt',
    userPrompt: 'prompt',
    references: [],
    negativePrompt: '',
    source: { kind: 'manual' },
    providerId: 'p1',
    params: { ...DEFAULT_WORKBENCH_PARAMS, n: results.length },
    status: 'running',
    results,
    referenceImages: [],
    createdAt: 1,
  };
}

beforeEach(() => workbenchSessionController.clearCache());

describe('workbench generation sync controller', () => {
  it('expands a provider batch without losing result order or status', () => {
    const current = turn([{ id: 'r1', jobId: 'j1', status: 'pending' }]);
    const next = applyImageResult([current], 't1', 'r1', {
      historyId: 'h1',
      status: 'success',
      images: [
        { assetId: 'a1', imagePath: '/tmp/1.png' },
        { assetId: 'a2', imagePath: '/tmp/2.png' },
      ],
    });

    expect(next[0].status).toBe('success');
    expect(next[0].params.n).toBe(2);
    expect(next[0].results.map((result) => result.imagePath)).toEqual(['/tmp/1.png', '/tmp/2.png']);
  });

  it('patches retry progress in cached background sessions', () => {
    workbenchSessionController.cacheTurns('s1', [
      turn([{ id: 'r1', jobId: 'j1', status: 'pending' }]),
    ]);

    applyGenerationProgress([], {
      jobId: 'j1',
      phase: 'retrying',
      attempt: 2,
      maxRetries: 3,
      delayMs: 500,
    });

    expect(workbenchSessionController.cachedTurns('s1')?.[0].results[0]).toMatchObject({
      retrying: true,
      retryAttempt: 2,
      retryMax: 3,
      retryDelayMs: 500,
    });
  });

  it('preserves partial status and releases per-session run locks', () => {
    expect(
      resultStatus([
        { id: 'ok', jobId: 'j1', status: 'success' },
        { id: 'bad', jobId: 'j2', status: 'failed' },
      ]),
    ).toBe('partial');

    const registered = withRunRegistered({ runningTurns: {} }, 't1', {
      sessionId: 's1',
      jobId: 'j1',
      cancelRequested: false,
      kind: 'image',
    });
    expect(withRunReleased(registered, 't1')).toMatchObject({
      runningTurns: {},
      isGenerating: false,
      activeTurnId: null,
    });
  });
});
