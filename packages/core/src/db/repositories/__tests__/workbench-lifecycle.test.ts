import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureTestCoreRuntime } from '../../../testing';
import { closeDb, getDb, initDb } from '../../index';
import { createWorkbenchRepositories } from '../workbench';

const root = mkdtempSync(join(tmpdir(), 'musefold-workbench-lifecycle-'));
configureTestCoreRuntime(root);

function createRun(id: string) {
  return createWorkbenchRepositories().runs.create({
    id,
    providerId: 'provider',
    model: 'model',
    userPrompt: 'prompt',
    basePrompt: 'prompt',
    finalPrompt: 'prompt',
    params: { schemaVersion: 1, size: '1024x1024', n: 1 },
    createdAt: 1,
  });
}

function assetCount(runId: string): number {
  return Number(
    (
      getDb()
        .prepare('SELECT COUNT(*) AS value FROM generated_assets WHERE run_id = ?')
        .get(runId) as { value: number }
    ).value,
  );
}

beforeAll(() => {
  initDb();
});

afterAll(() => {
  closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe('GenerationRunRepository lifecycle transitions', () => {
  it('cancels a queued run and rejects a later start or completion', () => {
    const repositories = createWorkbenchRepositories();
    const run = createRun('queued-cancel');

    expect(repositories.runs.cancel(run.id, 2)).toMatchObject({
      id: run.id,
      status: 'cancelled',
      finishedAt: 2,
    });
    expect(repositories.runs.start(run.id, 'request', 3).status).toBe('cancelled');
    expect(
      repositories.runs.complete(run.id, {
        finishedAt: 4,
        assets: [{ id: 'queued-cancel-asset', mediaPath: '/tmp/queued-cancel.png' }],
      }).status,
    ).toBe('cancelled');
    expect(assetCount(run.id)).toBe(0);
  });

  it('cancels a running run and rejects late failure without overwriting cancellation', () => {
    const repositories = createWorkbenchRepositories();
    const run = createRun('running-cancel');
    repositories.runs.start(run.id, 'request', 2);

    expect(repositories.runs.cancel(run.id, 3).status).toBe('cancelled');
    expect(
      repositories.runs.fail(run.id, 'LATE_FAILURE', 'late provider failure', 4),
    ).toMatchObject({
      status: 'cancelled',
      errorCode: null,
      errorMessage: null,
      finishedAt: 3,
    });
    expect(
      repositories.runs.complete(run.id, {
        finishedAt: 5,
        assets: [{ id: 'running-cancel-asset', mediaPath: '/tmp/running-cancel.png' }],
      }).status,
    ).toBe('cancelled');
    expect(assetCount(run.id)).toBe(0);
  });

  it('keeps the first terminal result across duplicate complete, fail, and cancel calls', () => {
    const repositories = createWorkbenchRepositories();
    const run = createRun('duplicate-terminal');
    repositories.runs.start(run.id, 'request', 2);

    const completed = repositories.runs.complete(run.id, {
      actualCost: 2,
      durationMs: 10,
      finishedAt: 3,
      assets: [{ id: 'duplicate-terminal-asset', mediaPath: '/tmp/first.png' }],
    });
    expect(completed).toMatchObject({ status: 'success', actualCost: 2, durationMs: 10 });

    expect(
      repositories.runs.complete(run.id, {
        actualCost: 99,
        durationMs: 999,
        finishedAt: 4,
        assets: [{ id: 'duplicate-terminal-late-asset', mediaPath: '/tmp/late.png' }],
      }),
    ).toMatchObject({ status: 'success', actualCost: 2, durationMs: 10, finishedAt: 3 });
    expect(repositories.runs.fail(run.id, 'LATE_FAILURE', 'late failure', 5)).toMatchObject({
      status: 'success',
      errorCode: null,
      errorMessage: null,
      finishedAt: 3,
    });
    expect(repositories.runs.cancel(run.id, 6)).toMatchObject({
      status: 'success',
      finishedAt: 3,
    });
    expect(assetCount(run.id)).toBe(1);
    expect(repositories.runs.getAsset('duplicate-terminal-late-asset')).toBeNull();
  });
});
