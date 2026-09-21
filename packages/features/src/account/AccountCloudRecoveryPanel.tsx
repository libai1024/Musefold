'use client';

import { queryKeys, type MusefoldGateway } from '@musefold/platform';
import type { AccountCloudRecoveryList, AccountCloudLegacyList } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import { toast } from '@musefold/ui/components/sonner';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountEpoch, assertAccountEpoch } from './account-session';

type Cloud = NonNullable<MusefoldGateway['accountCloud']>;
export function AccountCloudRecoveryPanel({ cloud, enabled }: { cloud: Cloud; enabled: boolean }) {
  const client = useQueryClient();
  const tasks = useInfiniteQuery({
    queryKey: queryKeys.accountCloud.recovery(),
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: AccountCloudRecoveryList) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const epoch = accountEpoch(client);
      const page = await cloud.listRecovery(pageParam ? { cursor: pageParam } : {});
      assertAccountEpoch(client, epoch);
      return page;
    },
  });
  const legacy = useInfiniteQuery({
    queryKey: queryKeys.accountCloud.legacy(),
    retry: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: AccountCloudLegacyList) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const epoch = accountEpoch(client);
      const page = await cloud.listLegacy(pageParam ? { cursor: pageParam } : {});
      assertAccountEpoch(client, epoch);
      return page;
    },
  });
  const recover = useMutation({
    mutationFn: async ({ requestId, cancel }: { requestId: string; cancel: boolean }) => {
      const epoch = accountEpoch(client);
      const result = cancel
        ? await cloud.cancel({ requestId })
        : await cloud.reconcile({ requestId });
      assertAccountEpoch(client, epoch);
      return result;
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: queryKeys.accountCloud.recovery() });
      void client.invalidateQueries({ queryKey: queryKeys.generation.all() });
      void client.invalidateQueries({ queryKey: queryKeys.workbench.all() });
      toast.success(result.recovery.message);
    },
    onError: (error) => toast.error(error.message),
  });
  // Deduplicate if new records arrived while earlier pages were being refreshed.
  const rows = [
    ...new Map(
      tasks.data?.pages.flatMap((page) => page.items).map((item) => [item.requestId, item]) ?? [],
    ).values(),
  ];
  const oldRows = [
    ...new Map(
      legacy.data?.pages.flatMap((page) => page.items).map((item) => [item.requestId, item]) ?? [],
    ).values(),
  ];
  const legacyKinds = {
    image: '图像生成',
    scheme: '设计方案',
    skill: 'Skill运行',
    other: '旧任务',
  };
  const legacyReasons = {
    unknown_cost: '费用未知',
    in_progress: '执行或确认尚未结束',
    unfinished_call: '仍有未结调用或预留',
  };

  return (
    <>
      {enabled && tasks.isPending && (
        <p className="text-muted-foreground text-sm">正在读取原云任务…</p>
      )}
      {enabled && tasks.isError && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <p>原任务读取失败，请刷新后重试。</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void client.resetQueries({ queryKey: queryKeys.accountCloud.recovery() })
            }
          >
            刷新任务列表
          </Button>
        </div>
      )}
      {enabled && rows.length > 0 && (
        <div
          className="flex flex-col gap-3 border-border border-t pt-3"
          data-testid="account-cloud-recovery"
        >
          <p className="text-muted-foreground text-xs">
            当前账号的云任务记录。核对只查询原任务；停止不保证零费用。
          </p>
          {rows.map((item) => (
            <div
              key={item.requestId}
              className="flex flex-wrap items-center gap-2"
              data-testid="account-cloud-recovery-item"
            >
              <div className="min-w-0 flex-1 text-sm">
                <time className="text-muted-foreground text-xs">
                  {new Date(item.createdAt).toLocaleString()}
                </time>
                <p>{item.recovery.message}</p>
                {!item.recovery.costKnown && (
                  <p className="text-muted-foreground text-xs">费用未知，尚未结清。</p>
                )}
                <code className="block break-all text-muted-foreground text-xs">
                  {item.requestId}
                </code>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={recover.isPending}
                onClick={() => recover.mutate({ requestId: item.requestId, cancel: false })}
              >
                核对原任务
              </Button>
              {item.canCancel && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={recover.isPending}
                  onClick={() => recover.mutate({ requestId: item.requestId, cancel: true })}
                >
                  停止原任务
                </Button>
              )}
            </div>
          ))}
          {tasks.hasNextPage && (
            <Button
              size="sm"
              variant="outline"
              disabled={tasks.isFetchingNextPage}
              onClick={() => void tasks.fetchNextPage()}
              data-testid="account-cloud-load-more"
            >
              加载更早的任务
            </Button>
          )}
        </div>
      )}
      {legacy.isError && (
        <p className="text-destructive text-sm">本机旧任务诊断读取失败，请重新检查连接。</p>
      )}
      {oldRows.length > 0 && (
        <div
          className="flex flex-col gap-3 border-border border-t pt-3"
          data-testid="account-cloud-legacy"
        >
          <p className="font-medium text-sm">本机旧托管记录</p>
          <p className="text-muted-foreground text-xs">
            这些记录未绑定当前云账号，需要按原任务核对；不会自动清零费用或重新发送。记录ID可用于查找原调用记录。
          </p>
          {oldRows.map((item) => (
            <div key={item.requestId} className="text-xs" data-testid="account-cloud-legacy-item">
              <p>
                {legacyKinds[item.kind]} · {legacyReasons[item.reason]} ·{' '}
                {new Date(item.createdAt).toLocaleString()}
              </p>
              <code className="block break-all text-muted-foreground">{item.requestId}</code>
            </div>
          ))}
          {legacy.hasNextPage && (
            <Button
              size="sm"
              variant="outline"
              disabled={legacy.isFetchingNextPage}
              onClick={() => void legacy.fetchNextPage()}
              data-testid="account-cloud-legacy-more"
            >
              加载更早的旧记录
            </Button>
          )}
        </div>
      )}
    </>
  );
}
