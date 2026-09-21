'use client';

import type { GenerationJob } from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { Button } from '@musefold/ui/components/button';
import { toast } from '@musefold/ui/components/sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { accountEpoch, assertAccountEpoch } from '../account/account-session';

/** Only the host may reconcile the original durable request or restore its assets. */
export function GenerationRecoveryNotice({ job }: { job: GenerationJob }) {
  const gateway = useGateway();
  const client = useQueryClient();
  const refresh = useMutation({
    mutationFn: async () => {
      const epoch = accountEpoch(client);
      const updated =
        gateway.accountCloud && job.recovery
          ? await gateway.accountCloud.reconcile({ requestId: job.recovery.requestId })
          : null;
      if (!updated) await gateway.generation.get(job.id);
      assertAccountEpoch(client, epoch);
      return updated?.recovery.message;
    },
    onSuccess: (message) => {
      void client.invalidateQueries({ queryKey: queryKeys.generation.all() });
      void client.invalidateQueries({ queryKey: queryKeys.accountCloud.recovery() });
      toast.success(message ?? '已请求核对原任务，不会重新生成');
    },
    onError: (error) => toast.error(error.message),
  });
  if (!job.recovery) return null;
  const { recovery } = job;
  if (recovery.result === 'available' && recovery.costKnown) return null;
  return (
    <div
      className="flex flex-col gap-2 text-muted-foreground text-xs"
      data-testid="generation-recovery-notice"
      role="status"
    >
      <p>{recovery.message}</p>
      {!recovery.costKnown && <p>费用尚未核对完成，未知金额不会记作零。</p>}
      {(recovery.result === 'missing' ||
        recovery.result === 'download_pending' ||
        !recovery.costKnown) && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          核对原任务
        </Button>
      )}
    </div>
  );
}
