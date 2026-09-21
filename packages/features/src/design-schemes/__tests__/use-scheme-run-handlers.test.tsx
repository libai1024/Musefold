import type {
  DesignSchemeEvent,
  ExecutionBinding,
  PrepareDesignSchemeRunResult,
  RunResult,
} from '@musefold/contracts';
import { PlatformProvider, WEB_CAPABILITIES, type MusefoldGateway } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SchemeRunSubmission } from '../integration-store';
import { toPrepareSchemeRunInput, useSchemeRunHandlers } from '../use-scheme-run-handlers';

afterEach(() => vi.useRealTimers());

function submission(): SchemeRunSubmission {
  return {
    kind: 'run',
    executionId: 'exec-1',
    workbenchSessionId: 'session-1',
    attachment: {
      schemeId: 'scheme-1',
      revisionId: 'working-rev-2',
      expectedVersion: 3,
      mode: 'trial',
      name: '海报',
      summary: '',
      fidelity: 'faithful',
      sourceLabel: '来源',
      inputs: [],
      coverAssetId: null,
      hasSuccessfulTrial: false,
    },
    brief: '保留说明',
    inputValues: { topic: '书展' },
    referenceImages: [],
    promptReferenceSelections: [],
    providerId: 'cloud-default',
    params: { quality: 'high', aspectRatio: '16:9', negative: '无水印', count: 4 },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function harness(options: { missingPrepare?: boolean; capability?: boolean } = {}) {
  const ready = deferred<PrepareDesignSchemeRunResult>();
  const finished = deferred<RunResult>();
  const listeners = new Set<(event: DesignSchemeEvent) => void>();
  const unsubscribe = vi.fn(() => listeners.clear());
  const schemes = {
    prepareRun: options.missingPrepare ? undefined : vi.fn(() => ready.promise),
    run: vi.fn((_input: PrepareDesignSchemeRunResult) => finished.promise),
    cancel: vi.fn(async () => undefined),
    subscribeEvents: vi.fn((listener: (event: DesignSchemeEvent) => void) => {
      listeners.add(listener);
      return unsubscribe;
    }),
  };
  const queryClient = new QueryClient();
  const invalidated = vi.spyOn(queryClient, 'invalidateQueries');
  const gateway = { designSchemes: schemes } as unknown as MusefoldGateway;
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider
          runtime={{
            gateway,
            capabilities: { ...WEB_CAPABILITIES, hasDesignSchemes: options.capability ?? true },
          }}
        >
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return {
    ...renderHook(useSchemeRunHandlers, { wrapper }),
    schemes,
    ready,
    finished,
    listeners,
    unsubscribe,
    invalidated,
  };
}

it('snapshots exact revision, count, parameters and reference order without constructing a plan', () => {
  const input = submission();
  input.referenceImages = ['ref-b', 'ref-a', 'ref-b'].map((id) => ({
    id,
    url: `https://example.test/${id}`,
    mimeType: 'image/png',
    name: 'reference.png',
    byteSize: 32,
  }));
  const prepared = toPrepareSchemeRunInput(input);
  input.inputValues.topic = '后来修改';
  expect(prepared.revisionId).toBe('working-rev-2');
  expect(prepared.inputValues).toEqual({ topic: '书展' });
  expect(prepared.executionSettings).toMatchObject({
    providerId: 'cloud-default',
    outputCount: 4,
    quality: 'high',
    aspectRatio: '16:9',
    negativePrompt: '无水印',
    referenceAssetIds: ['ref-b', 'ref-a'],
    workbenchSessionId: 'session-1',
  });
  expect(prepared).not.toHaveProperty('plan');
});

it.each(['trial', 'formal'] as const)(
  'freezes the selected account model for %s preparation',
  (mode) => {
    const input = submission();
    input.attachment.mode = mode;
    input.model = 'gpt-image-2';
    input.expectedBinding = {
      apiIssuer: 'https://api.test',
      principalId: 'principal-a',
      payer: { issuer: 'https://upstream.test', ownerId: 'owner-a' },
      credential: { ref: 'credential-a', version: 2 },
      providerId: 'cloud-default',
      model: input.model,
      capabilities: { image: true, text: false },
    } satisfies ExecutionBinding;
    const prepared = toPrepareSchemeRunInput(input);
    expect(prepared.executionSettings).toMatchObject({
      model: 'gpt-image-2',
      expectedBinding: input.expectedBinding,
    });
    input.expectedBinding.credential.version = 3;
    expect(prepared.executionSettings.expectedBinding?.credential.version).toBe(2);
    input.model = 'musefold-image';
    expect(() => toPrepareSchemeRunInput(input)).toThrow('Selected model must match');
  },
);

it('retains omitted model fields for legacy and self-provided connections', () => {
  const settings = toPrepareSchemeRunInput(submission()).executionSettings;
  expect(settings).not.toHaveProperty('model');
  expect(settings).not.toHaveProperty('expectedBinding');
});

it('waits for the terminal result, passes the server plan unchanged and refreshes only matching events', async () => {
  vi.useFakeTimers();
  const h = harness();
  const pending = h.result.current.onRun?.(submission());
  if (!pending) throw new Error('run handler missing');
  let done = false;
  void pending.then(() => {
    done = true;
  });
  const prepared = {
    executionId: 'exec-1',
    plan: { id: 'server-only-plan' },
  } as PrepareDesignSchemeRunResult;
  h.ready.resolve(prepared);
  await Promise.resolve();
  expect(h.schemes.run).toHaveBeenCalledWith(prepared);
  expect(h.schemes.run.mock.calls[0]?.[0]).toBe(prepared);
  expect(done).toBe(false);
  for (const executionId of ['other', 'exec-1']) {
    for (const listener of h.listeners)
      listener({ kind: 'state', executionId, state: 'executing' });
    expect(h.invalidated).not.toHaveBeenCalled();
  }
  for (let i = 0; i < 100; i++)
    for (const listener of h.listeners)
      listener({ kind: 'state', executionId: 'exec-1', state: 'executing' });
  await vi.advanceTimersByTimeAsync(4999);
  expect(h.invalidated).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(h.invalidated.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
    ['workbench'],
    ['generation'],
  ]);
  // A last event must not leave a trailing refresh after the authoritative result.
  for (const listener of h.listeners)
    listener({ kind: 'state', executionId: 'exec-1', state: 'executing' });
  const terminal = { status: 'cancelled' } as RunResult;
  h.finished.resolve(terminal);
  await expect(pending).resolves.toBe(terminal);
  expect(h.unsubscribe).toHaveBeenCalledOnce();
  expect(h.invalidated).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(h.invalidated).toHaveBeenCalledTimes(6);
});

it('cancellation during preparation keeps the identity and prevents dispatch after preparation', async () => {
  const h = harness();
  const pending = h.result.current.onRun?.(submission());
  if (!pending) throw new Error('run handler missing');
  await h.result.current.onCancelRun?.('exec-1');
  expect(h.schemes.cancel).toHaveBeenCalledWith({ executionId: 'exec-1' });
  h.ready.resolve({} as PrepareDesignSchemeRunResult);
  await expect(pending).rejects.toThrow('已取消');
  expect(h.schemes.run).not.toHaveBeenCalled();
  expect(h.unsubscribe).toHaveBeenCalledOnce();
});

it('a failed cancellation keeps the running request observable until its terminal result', async () => {
  const h = harness();
  const pending = h.result.current.onRun?.(submission());
  if (!pending) throw new Error('run handler missing');
  h.schemes.cancel.mockRejectedValueOnce(new Error('网络中断'));
  await expect(h.result.current.onCancelRun?.('exec-1')).rejects.toThrow('网络中断');
  h.ready.resolve({} as PrepareDesignSchemeRunResult);
  const terminal = { status: 'completed' } as RunResult;
  h.finished.resolve(terminal);
  await expect(pending).resolves.toBe(terminal);
});

it('preparation failure is recoverable and duplicate active submissions never dispatch twice', async () => {
  const h = harness();
  const pending = h.result.current.onRun?.(submission());
  if (!pending) throw new Error('run handler missing');
  await expect(h.result.current.onRun?.(submission())).rejects.toThrow('正在进行');
  h.ready.reject(new Error('版本已变化，请刷新'));
  await expect(pending).rejects.toThrow('版本已变化');
  expect(h.schemes.prepareRun).toHaveBeenCalledOnce();
  expect(h.schemes.run).not.toHaveBeenCalled();
  expect(h.unsubscribe).toHaveBeenCalledOnce();
});

it('exposes only available run actions and rejects non-run or missing-provider submissions', () => {
  expect(harness({ missingPrepare: true }).result.current).toEqual({});
  expect(harness({ capability: false }).result.current).toEqual({});
  const h = harness();
  expect(h.result.current.onCreate).toBeUndefined();
  expect(h.result.current.onModify).toBeUndefined();
  expect(h.result.current.runInputSupport).toBe('text-and-images');
  const input = submission();
  input.providerId = undefined;
  expect(() => toPrepareSchemeRunInput(input)).toThrow('生图服务');
  input.attachment.mode = 'modify';
  expect(() => toPrepareSchemeRunInput(input)).toThrow('修改要求');
});
