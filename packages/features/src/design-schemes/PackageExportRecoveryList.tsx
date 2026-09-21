'use client';

import type { DesignSchemePackageExportRecovery } from '@musefold/contracts';
import { useGateway, queryKeys } from '@musefold/platform';
import { Button } from '@musefold/ui/components/button';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { accountEpoch, assertAccountEpoch } from '../account/account-session';

export function packageExportRecoveryMessage(item: DesignSchemePackageExportRecovery) {
  switch (item.blockedReason) {
    case 'session_changed':
      return '登录状态已变化，原归档不能继续下载；请重新核对方案后新建导出。';
    case 'export_unavailable':
      return '原归档已过期、失败或取消，不能继续下载。';
    case 'export_in_progress':
      return '服务器仍在准备原归档，请稍后刷新核对。';
    case 'basis_changed':
      return '正式版本、试运行、封面或素材已变化，请回到方案重新核对。';
    default:
      return '原归档仍可下载。无法核实此前下载是否完成，请先检查下载列表，再决定是否保存。';
  }
}

/** Mounted only by an explicit history gesture; discovery cannot create or download an archive. */
export function PackageExportRecoveryList({ onSelect }: { onSelect(id: string): void }) {
  const transport = useGateway().designSchemes?.packageExport?.recovery;
  const client = useQueryClient();
  const epoch = accountEpoch(client);
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.designSchemes.all(), 'package-export-history', epoch],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      if (!transport) throw new Error('当前宿主不提供导出记录');
      assertAccountEpoch(client, epoch);
      const result = await transport.list({ limit: 20, cursor: pageParam });
      assertAccountEpoch(client, epoch);
      return result;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const labels = {
    ready: '已准备，需重新核对下载资格',
    preparing: '准备中',
    cancelled: '已取消',
    failed: '准备失败',
    expired: '已过期',
  };
  return (
    <section className="space-y-3" data-testid="scheme-package-export-history-list">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">此账号的导出记录</h3>
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          刷新记录
        </Button>
      </div>
      {query.isPending ? (
        <p role="status">正在核对导出记录…</p>
      ) : query.isError ? (
        <p role="alert">暂时无法核对记录，请重试。不会自动创建或下载归档。</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">没有导出记录。</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.export.exportId}
              className="space-y-2 rounded-md border border-border p-3"
            >
              <p className="break-words font-medium">{item.schemeName ?? '原方案已不可用'}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(item.createdAt).toLocaleString()} · 版本 {item.expectedVersion}
              </p>
              <p className="text-muted-foreground">{labels[item.export.status]}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSelect(item.export.exportId)}
                data-testid={`scheme-package-export-recover-${item.export.exportId}`}
              >
                核对此记录
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!query.isError && query.hasNextPage ? (
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          加载更早记录
        </Button>
      ) : null}
    </section>
  );
}
