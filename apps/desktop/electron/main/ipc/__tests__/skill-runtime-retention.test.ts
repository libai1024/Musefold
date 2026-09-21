import type { ExecuteSkillRuntimeRequest } from '@musefold/desktop-contracts/skill-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ now: 0, read: vi.fn(), generate: vi.fn(), stage: vi.fn() }));
vi.mock('../../skill-import/github-reader', () => ({
  readPublicGithubAgentSkillRuntimeSource: state.read,
}));
vi.mock('../../generation-facade', () => ({ generate: state.generate }));
vi.mock('../../../ai/connection-store', () => ({
  getAiConnectionStore: () => ({ list: () => [], loadKey: vi.fn() }),
}));
vi.mock('../../../ai/openai-compatible-assistant', () => ({
  classifyAiError: vi.fn(),
  OpenAiCompatibleAssistant: vi.fn(),
}));
vi.mock('../../../system/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn() }),
}));
vi.mock('@musefold/core/providers/local-image', () => ({ stageLocalImageBytes: state.stage }));
vi.mock('@musefold/core/db/index', () => ({
  getDb: () => ({ prepare: () => ({ get: () => ({ type: 'doubao-web' }) }) }),
}));

const TTL = 30 * 60 * 1000;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.now = Date.UTC(2026, 8, 13);
  vi.spyOn(Date, 'now').mockImplementation(() => state.now);
  state.read.mockResolvedValue({
    ok: true,
    data: {
      scan: { name: 'Owned Skill', description: 'Owned source', files: [] },
      resolvedRef: 'main',
      commitHash: 'owned-commit',
      runtimeFiles: [
        {
          relativePath: 'SKILL.md',
          contentHash: 'declared-only',
          bytes: new TextEncoder().encode('Owned style instructions'),
        },
      ],
    },
  });
  state.generate.mockResolvedValue({ historyId: 'owned-job', status: 'success', images: [] });
});
afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const runtime = await import('../skill-runtime');
  const prepared = await runtime.prepareGithubSkillRuntime({
    repositoryUrl: 'https://github.com/owned-fixture/owned-skill',
  });
  if (!prepared.ok) throw new Error('Owned Skill preparation failed');
  const request: ExecuteSkillRuntimeRequest = {
    runtimeId: prepared.data.runtimeId,
    executionId: 'owned-execution',
    userPrompt: 'Owned image request',
    userImages: [],
    availableImageSlots: 0,
    generation: {
      requestTemplate: {
        providerId: 'owned-provider',
        prompt: '',
        size: '1024x1024',
        quality: 'auto',
        n: 1,
      },
      jobIds: ['owned-job'],
      providerName: 'Owned provider',
      ratioId: '1:1',
    },
  };
  const emitters = { emit: vi.fn(), sendProgress: vi.fn() };
  return { runtime, request, emitters };
}

describe('Skill snapshot lifetime at authorization and execution boundaries', () => {
  it('permits authorization and execution immediately before the 30-minute expiry', async () => {
    const f = await fixture();
    const digest = f.runtime.skillRuntimeSourceDigest(f.request.runtimeId);
    state.now += TTL - 1;
    expect(f.runtime.skillRuntimeSourceDigest(f.request.runtimeId)).toBe(digest);
    expect((await f.runtime.executeSkillRuntime(f.request, f.emitters)).ok).toBe(true);
    expect(state.generate).toHaveBeenCalledTimes(1);
  });

  it.each([TTL, TTL + 1])(
    'refuses expired source authorization at age %i without another prepare call',
    async (age) => {
      const f = await fixture();
      state.now += age;
      expect(() => f.runtime.skillRuntimeSourceDigest(f.request.runtimeId)).toThrow(
        'Skill runtime expired before authorization',
      );
      expect(state.generate).not.toHaveBeenCalled();
      expect(state.stage).not.toHaveBeenCalled();
    },
  );

  it.each([TTL, TTL + 1])(
    'refuses execution at age %i before staging images or invoking a provider',
    async (age) => {
      const f = await fixture();
      state.now += age;
      expect(await f.runtime.executeSkillRuntime(f.request, f.emitters)).toMatchObject({
        ok: false,
        error: { code: 'MISSING_REFERENCE' },
      });
      expect(state.generate).not.toHaveBeenCalled();
      expect(state.stage).not.toHaveBeenCalled();
    },
  );

  it('keeps an already-running execution cancellable when another prepare expires its source cache', async () => {
    const f = await fixture();
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const admission = new Promise<void>((resolve) => {
      started = resolve;
    });
    state.generate.mockImplementationOnce(
      (_request, _progress, options: { signal: AbortSignal }) => {
        signal = options.signal;
        started();
        return new Promise((resolve) =>
          options.signal.addEventListener(
            'abort',
            () => resolve({ historyId: 'owned-job', status: 'cancelled' }),
            { once: true },
          ),
        );
      },
    );
    f.request.generation.jobIds.push('must-not-send');
    const running = f.runtime.executeSkillRuntime(f.request, f.emitters);
    await admission;
    state.now += TTL + 1;
    await f.runtime.prepareGithubSkillRuntime({
      repositoryUrl: 'https://github.com/owned-fixture/second',
    });
    expect(() => f.runtime.skillRuntimeSourceDigest(f.request.runtimeId)).toThrow('expired');
    f.runtime.cancelSkillRuntimeExecution(f.request.executionId);
    const result = await running;
    expect(signal?.aborted).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.data.generations.map((item) => item.result.status)).toEqual([
        'cancelled',
        'cancelled',
      ]);
    expect(state.generate).toHaveBeenCalledTimes(1);
  });

  it('rejects a changed authorized source digest before any provider invocation', async () => {
    const f = await fixture();
    await expect(
      f.runtime.executeSkillRuntime(f.request, {
        ...f.emitters,
        execution: {
          sourceDigest: 'not-the-source-digest',
          text: null,
          generate: state.generate,
          onReferences: vi.fn(),
        },
      }),
    ).rejects.toThrow('Skill snapshot changed after authorization');
    expect(state.generate).not.toHaveBeenCalled();
  });

  it('removes the execution controller after a provider failure so late cancellation has no stale target', async () => {
    const f = await fixture();
    let signal: AbortSignal | undefined;
    state.generate.mockImplementationOnce(
      (_request, _progress, options: { signal: AbortSignal }) => {
        signal = options.signal;
        throw new Error('Owned provider failure');
      },
    );
    await expect(f.runtime.executeSkillRuntime(f.request, f.emitters)).rejects.toThrow(
      'Owned provider failure',
    );
    expect(signal?.aborted).toBe(false);
    f.runtime.cancelSkillRuntimeExecution(f.request.executionId);
    expect(signal?.aborted).toBe(false);
    expect(state.generate).toHaveBeenCalledTimes(1);
  });
});
