import { prepareDesignSchemeRunInputSchema, type RunResult } from '@musefold/contracts';
import { queryKeys, usePlatform } from '@musefold/platform';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import type { SchemeComposerHandlers, SchemeRunSubmission } from './integration-store';

/** Submit only user choices; the gateway prepares and freezes the authoritative plan. */
export function toPrepareSchemeRunInput(submission: SchemeRunSubmission) {
  if (submission.attachment.mode === 'modify') throw new Error('修改要求不走运行管线');
  if (!submission.providerId) throw new Error('请先连接可用的生图服务');
  return prepareDesignSchemeRunInputSchema.parse({
    executionId: submission.executionId,
    schemeId: submission.attachment.schemeId,
    revisionId: submission.attachment.revisionId,
    mode: submission.attachment.mode,
    brief: submission.brief,
    inputValues: submission.inputValues,
    executionSettings: {
      providerId: submission.providerId,
      ...(submission.model ? { model: submission.model } : {}),
      ...(submission.expectedBinding ? { expectedBinding: submission.expectedBinding } : {}),
      size: 'auto',
      aspectRatio: submission.params.aspectRatio,
      quality: submission.params.quality,
      negativePrompt: submission.params.negative,
      outputCount: submission.params.count ?? 1,
      referenceAssetIds: [...new Set(submission.referenceImages.map((image) => image.id))],
      promptReferenceSelections: submission.promptReferenceSelections,
      workbenchSessionId: submission.workbenchSessionId,
    },
  });
}

/** Shared product lifecycle; hosts opt in only when their run service is deployed. */
export function useSchemeRunHandlers(): SchemeComposerHandlers {
  const { gateway, capabilities } = usePlatform();
  const schemes = gateway.designSchemes;
  const queryClient = useQueryClient();
  const active = useRef(new Set<string>());
  const cancelled = useRef(new Set<string>());
  return useMemo(() => {
    const prepareRun = schemes?.prepareRun;
    if (!capabilities.hasDesignSchemes || !schemes || !prepareRun) return {};
    const refresh = () => {
      for (const queryKey of [
        queryKeys.designSchemes.all(),
        queryKeys.workbench.all(),
        queryKeys.generation.all(),
        queryKeys.account.status(),
      ])
        void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
    };
    return {
      runInputSupport: 'text-and-images',
      onRun: async (submission): Promise<RunResult> => {
        const { executionId } = submission;
        const input = toPrepareSchemeRunInput(submission);
        if (active.current.has(executionId)) throw new Error('该方案运行正在进行中');
        active.current.add(executionId);
        let unsubscribe = () => {};
        let refreshTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          unsubscribe = schemes.subscribeEvents((event) => {
            if (event.executionId !== executionId || refreshTimer !== undefined) return;
            // A page of durable events can contain many steps. Progress is already delivered
            // to observers; batch ledger refreshes and read balance/scheme assets only at end.
            refreshTimer = setTimeout(() => {
              refreshTimer = undefined;
              for (const queryKey of [queryKeys.workbench.all(), queryKeys.generation.all()])
                void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
            }, 5_000);
          });
          const prepared = await prepareRun(input);
          if (cancelled.current.has(executionId)) throw new Error('方案运行已取消');
          return await schemes.run(prepared);
        } finally {
          unsubscribe();
          if (refreshTimer !== undefined) clearTimeout(refreshTimer);
          active.current.delete(executionId);
          cancelled.current.delete(executionId);
          refresh();
        }
      },
      onCancelRun: async (executionId) => {
        if (!active.current.has(executionId)) return;
        cancelled.current.add(executionId);
        try {
          await schemes.cancel({ executionId });
        } catch (error) {
          cancelled.current.delete(executionId);
          throw error;
        }
      },
    } satisfies SchemeComposerHandlers;
  }, [schemes, queryClient, capabilities.hasDesignSchemes]);
}
