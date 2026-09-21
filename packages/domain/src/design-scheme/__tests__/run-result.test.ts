import { runResultSchema } from '@musefold/contracts';
import { describe, expect, it } from 'vitest';
import { advanceCloudRunResult } from '../run-result';

const NOW = '2026-09-07T00:00:00.000Z';
function initial() {
  return runResultSchema.parse({
    runId: 'run_result',
    schemeId: 'scheme_result',
    revisionId: 'revision_result',
    mode: 'trial',
    status: 'planning',
    compiledPrompt: 'Frozen prompt',
    outputs: [],
    evaluation: null,
    repair: null,
    error: null,
    createdAt: NOW,
    completedAt: null,
    steps: ['inspect-input', 'compile-prompt', 'generate-image', 'evaluate-image'].map(
      (kind, index) => ({
        id: `step_${index}`,
        kind,
        dependsOn: index ? [`step_${index - 1}`] : [],
        inputRefs: [],
        outputRefs: [],
        timeoutMs: 30000,
        maxAttempts: 1,
        status: index < 2 ? 'completed' : 'pending',
        startedAt: index < 2 ? NOW : null,
        completedAt: index < 2 ? NOW : null,
        error: null,
      }),
    ),
  });
}

describe('advanceCloudRunResult', () => {
  it('advances generation and evaluation while retaining frozen completed work', () => {
    const source = initial();
    const executing = advanceCloudRunResult(source, 'executing', { now: NOW });
    expect(source.steps[2].status).toBe('pending');
    expect(executing.steps.map((step) => step.status)).toEqual([
      'completed',
      'completed',
      'running',
      'pending',
    ]);
    const evaluating = advanceCloudRunResult(executing, 'evaluating', { now: NOW });
    expect(evaluating.steps.map((step) => step.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'running',
    ]);
    expect(advanceCloudRunResult(evaluating, 'executing', { now: NOW })).toEqual(evaluating);
    const completed = advanceCloudRunResult(evaluating, 'completed', { now: NOW });
    expect(completed.steps.every((step) => step.status === 'completed')).toBe(true);
    expect(completed.completedAt).toBe(NOW);
  });

  it('cancels queued work without reverting completed inspection and compilation', () => {
    const cancelled = advanceCloudRunResult(initial(), 'cancelled', { now: NOW });
    expect(cancelled.steps.map((step) => step.status)).toEqual([
      'completed',
      'completed',
      'cancelled',
      'cancelled',
    ]);
    expect(cancelled.error).toBeNull();
    expect(cancelled.completedAt).toBe(NOW);
  });

  it('records unknown as a nonretryable active-step failure and cancels remaining work', () => {
    const error = {
      code: 'GENERATION_UPSTREAM_UNKNOWN',
      message: '结果无法确认',
      retryable: false,
      recoveryAction: 'none' as const,
    };
    const failed = advanceCloudRunResult(initial(), 'failed', { now: NOW, error });
    expect(failed.error).toEqual(error);
    expect(failed.steps.map((step) => step.status)).toEqual([
      'completed',
      'completed',
      'failed',
      'cancelled',
    ]);
    expect(failed.steps[2].error).toEqual(error);
  });

  it.each(['completed', 'failed', 'cancelled', 'blocked'] as const)(
    'never overwrites terminal %s',
    (status) => {
      const terminal = advanceCloudRunResult(initial(), status, { now: NOW });
      expect(
        advanceCloudRunResult(terminal, 'completed', { now: '2026-09-08T00:00:00.000Z' }),
      ).toEqual(terminal);
      expect(advanceCloudRunResult(terminal, 'failed', { now: NOW })).toEqual(terminal);
    },
  );
});
