'use client';
import { useGateway, queryKeys } from '@musefold/platform';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@musefold/ui/components/button';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { accountEpoch, assertAccountEpoch } from '../account/account-session';
import { AGENT_OPERATION_LABELS, AGENT_STATUS_LABELS } from './agent-presentation';

/** Explicitly opened discovery. No start, confirmation or model authority is reconstructed here. */
export function AgentExecutionHistory({ onSelect }: { onSelect(id: string): void }) {
  const transport = useGateway().designSchemes?.agent;
  const client = useQueryClient();
  const epoch = accountEpoch(client);
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.designSchemes.all(), 'agent-history', epoch],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      assertAccountEpoch(client, epoch);
      if (!transport) throw new Error('当前环境不提供云端方案任务');
      const result = await transport.list({ limit: 20, cursor: pageParam });
      assertAccountEpoch(client, epoch);
      return result;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const items = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [
        item.executionId,
        item,
      ]),
    ).values(),
  ];
  return (
    <section className="space-y-3" data-testid="scheme-agent-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">此账号的方案任务</h3>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-8"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          刷新记录
        </Button>
      </div>
      {query.isPending ? (
        <div role="status" aria-label="正在读取方案任务" className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : query.isError ? (
        <p role="alert">暂时无法核对方案任务，请刷新记录。不会自动重新创建任务。</p>
      ) : !items.length ? (
        <p className="py-4 text-muted-foreground">
          还没有云端方案任务。从一个想法开始创建，之后可在这里查看进度。
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li
              key={item.executionId}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0 flex-1 basis-48">
                <p className="break-words font-medium">
                  {item.schemeName ?? AGENT_OPERATION_LABELS[item.operation]}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {AGENT_STATUS_LABELS[item.status]} ·{' '}
                  <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 md:min-h-8"
                onClick={() => onSelect(item.executionId)}
                data-testid={`scheme-agent-recover-${item.executionId}`}
              >
                查看进度
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!query.isError && query.hasNextPage ? (
        <Button
          variant="outline"
          className="min-h-11 md:min-h-8"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          加载更早任务
        </Button>
      ) : null}
    </section>
  );
}
