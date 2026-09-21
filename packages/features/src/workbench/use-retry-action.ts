'use client';

import type { GenerationJob } from '@musefold/contracts';
import { toast } from '@musefold/ui/components/sonner';
import { type QueryClient, useMutationState, useQueryClient } from '@tanstack/react-query';
import { accountEpoch } from '../account/account-session';
import { openConnectionsSettings } from '../shell/screen-intent-store';
import {
  createRetryGenerationMutationIntent,
  retryGenerationMutationKey,
  useRetryGeneration,
} from './hooks';

// UI admission only. The host/server still owns durable authorization and idempotency.
// Scope by renderer session and account epoch; never share a previous account's promise.
type RetryOutcome = { ok: true; job: GenerationJob } | { ok: false; error: unknown };
const active = new WeakMap<QueryClient, Map<string, Promise<RetryOutcome>>>();

/** One unfinished user interaction, shared by workbench/history, including network retries. */
export function useRetryAction(onOpenSettings?: () => void) {
  const client = useQueryClient();
  const mutation = useRetryGeneration();
  const epoch = accountEpoch(client);
  const pending = useMutationState({
    filters: {
      mutationKey: retryGenerationMutationKey,
      status: 'pending',
      predicate: (entry) => entry.state.context === epoch,
    },
    select: (entry) => (entry.state.variables as [string] | undefined)?.[0],
  });
  function requestAsync(job: Pick<GenerationJob, 'id' | 'recovery'>): Promise<RetryOutcome> {
    const capturedEpoch = accountEpoch(client);
    const key = JSON.stringify([capturedEpoch, job.id]);
    let flights = active.get(client);
    if (!flights) {
      flights = new Map();
      active.set(client, flights);
    }
    const previous = flights.get(key);
    if (previous) return previous;
    const owner = flights;
    const intent = createRetryGenerationMutationIntent(job.id);
    // Register synchronously, before React renders disabled controls or onMutate completes.
    const work = mutation
      .mutateAsync(intent)
      .then((result): RetryOutcome => ({ ok: true, job: result }))
      .catch((error: unknown): RetryOutcome => {
        if (accountEpoch(client) !== capturedEpoch) return { ok: false, error };
        toast.error('重试未完成', {
          description: error instanceof Error ? error.message : '暂时无法确认结果，请核对原任务。',
          ...(job.recovery && onOpenSettings
            ? {
                action: {
                  label: '核对原任务',
                  onClick: () => {
                    if (accountEpoch(client) === capturedEpoch)
                      openConnectionsSettings(onOpenSettings);
                  },
                },
              }
            : {}),
        });
        return { ok: false, error };
      })
      .finally(() => {
        if (owner.get(key) === work) owner.delete(key);
      });
    owner.set(key, work);
    return work;
  }
  return {
    // Event handlers retain their void contract. Recovery orchestration can await the
    // same interaction without creating a second request or swallowing its outcome.
    request: (job: Pick<GenerationJob, 'id' | 'recovery'>): void => {
      void requestAsync(job);
    },
    requestAsync,
    isPending: (id: string) => pending.includes(id),
  };
}
