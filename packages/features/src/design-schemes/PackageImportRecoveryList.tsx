'use client';

import type { DesignSchemePackageRecovery } from '@musefold/contracts';
import { useGateway, queryKeys } from '@musefold/platform';
import { Button } from '@musefold/ui/components/button';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { accountEpoch, assertAccountEpoch } from '../account/account-session';

export function packageRecoveryMessage(item: DesignSchemePackageRecovery) {
  if (item.receipt) return '导入已完成，可以核对原草稿；如果草稿已删除，不会重新创建。';
  switch (item.blockedReason) {
    case 'session_changed':
      return '登录状态已变化，原请求不能继续；可以取消旧上传后重新选择文件。';
    case 'stage_unavailable':
      return '原上传已失效或取消，请重新选择文件开始新的导入。';
    case 'upload_in_progress':
      return '服务器仍在处理原上传，请稍后刷新核对。';
    case 'import_in_progress':
      return '原请求正在导入，请稍后刷新核对结果。';
    case 'retry_limit':
      return '原请求已达到重试上限，请取消旧上传后重新选择文件。';
    case 'incompatible_version':
    case 'confirmation_changed':
      return '原请求的格式或确认信息已变化，无法继续此请求。';
    default:
      return item.stage.status === 'awaiting_upload'
        ? '请选择原方案包，完整文件核对一致后才能继续上传。'
        : '请核对原方案内容，再明确继续同一次导入。';
  }
}

/** This list is mounted only after the user opens history under a freshly checked account. */
export function PackageImportRecoveryList({ onSelect }: { onSelect(id: string): void }) {
  const transport = useGateway().designSchemes?.packageImport?.recovery;
  const client = useQueryClient();
  const epoch = accountEpoch(client);
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.designSchemes.all(), 'package-recovery', epoch],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      if (!transport) throw new Error('当前宿主不提供导入记录');
      assertAccountEpoch(client, epoch);
      const result = await transport.list({ limit: 20, cursor: pageParam });
      assertAccountEpoch(client, epoch);
      return result;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="space-y-3" data-testid="scheme-package-recovery-list">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">此账号的导入记录</h3>
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
        <p role="status">正在核对导入记录…</p>
      ) : query.isError ? (
        <p role="alert">暂时无法核对记录，请重试。不会自动创建新的导入。</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">没有导入记录。</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.stage.stagedPackageId}
              className="space-y-2 rounded-md border border-border p-3"
            >
              <p className="break-words font-medium">
                {item.stage.preview?.name || '尚未上传内容的方案包'}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(item.createdAt).toLocaleString()} ·{' '}
                {(item.stage.sizeBytes / 1024 / 1024).toFixed(2)} MiB
              </p>
              <p className="text-muted-foreground">{packageRecoveryMessage(item)}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSelect(item.stage.stagedPackageId)}
                data-testid={`scheme-package-recover-${item.stage.stagedPackageId}`}
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
