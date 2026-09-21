import type { ExecutionBinding, ParsedDesignSchemeRunInput } from '@musefold/contracts';
import { isManagedUploadPath } from '@musefold/core/providers/local-image';
import {
  cancelManagedDurableRun,
  startManagedDurableRun,
  scheduleManagedRunReconciliation,
} from '../../system/managed-run-runtime';
import { BridgeError } from '../ipc-v25/envelope';
import { runDesignScheme, type RunSessionDeps } from './run-session';

/** Canonical local scheme orchestration with the same durable account transport as R/S. */
export async function runManagedDesignScheme(
  input: ParsedDesignSchemeRunInput,
  binding: ExecutionBinding,
  request: Parameters<typeof runDesignScheme>[0],
  deps: RunSessionDeps,
): ReturnType<typeof runDesignScheme> {
  if (deps.signal.aborted) throw new BridgeError('CANCELLED', '已取消');
  let resolveResult!: (value: Awaited<ReturnType<typeof runDesignScheme>>) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<Awaited<ReturnType<typeof runDesignScheme>>>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // Attach rejection handling before registration; registration itself can fail synchronously.
  void result.catch(() => undefined);
  const cancel = () => {
    void cancelManagedDurableRun(input.executionId).catch(() => undefined);
  };
  deps.signal.addEventListener('abort', cancel, { once: true });
  try {
    const started = await startManagedDurableRun({
      runKind: 'run_scheme',
      providerId: input.executionSettings.providerId,
      model: binding.model,
      expectedBinding: binding,
      callerKey: `desktop-scheme:${input.executionId}`,
      caller: 'desktop-workbench',
      executionId: input.executionId,
      originalJobIds: request.generation.jobIds,
      input: JSON.parse(JSON.stringify(input)),
      frozenRun: JSON.parse(JSON.stringify(request)),
      textBinding: null,
      consent: 'interactive',
      localProjection: {
        workbench: request.generation.requestTemplate.workbench,
        promptReferences: request.generation.requestTemplate.promptReferences,
      },
      authorizePath: isManagedUploadPath,
      authorize: async () => {
        throw new BridgeError('DESIGN_SCHEME_CONFIRMATION_UNEXPECTED', '请重新准备本次运行');
      },
      drive: async ({ images }) => {
        try {
          if (deps.signal.aborted) await cancelManagedDurableRun(input.executionId);
          images.onReferences(request.generation.requestTemplate.referenceImages ?? []);
          const retained = await runDesignScheme(request, { ...deps, generate: images.generate });
          resolveResult(retained);
          return deps.signal.aborted ? 'cancelled' : retained.ok ? 'success' : 'failed';
        } catch (error) {
          rejectResult(error);
          return deps.signal.aborted ? 'cancelled' : 'failed';
        }
      },
      // Canonical UI status is finalized by its adapter; receipts alone own spend settlement.
      onTerminal: () => undefined,
    });
    if (started.replayed) {
      scheduleManagedRunReconciliation(input.executionId);
      throw new BridgeError('DESIGN_SCHEME_EXECUTION_TERMINAL', '该执行已受理，请查看原运行记录');
    }
    return await result;
  } finally {
    deps.signal.removeEventListener('abort', cancel);
  }
}
