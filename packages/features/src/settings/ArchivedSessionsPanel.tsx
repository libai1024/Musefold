'use client';

import type { WorkbenchSession } from '@musefold/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@musefold/ui/components/alert-dialog';
import { Button } from '@musefold/ui/components/button';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { toast } from '@musefold/ui/components/sonner';
import { Archive, ArchiveRestore, ChevronDown, RefreshCw, Trash2 } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useRef, useState } from 'react';
import { useAutoLoadMore } from '../history/hooks';
import { useArchivedSessions, useRemoveSession, useRestoreSession } from '../workbench/hooks';

/** 每页最多100条,更多归档沿服务端游标追加。 */
const ARCHIVED_QUERY = { archivedOnly: true, limit: 100 } as const;

/**
 * 归档时间恒带年份 + 时分(承 history/format.ts 的 zh-CN locale 语法):
 * 归档是冷存储语义,跨年常见,省年份会像 formatDateTime 那样产生歧义。
 */
export function formatArchivedAt(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

function archivedErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * 设置「数据」卡内的已归档对话面板(U05):就地展开,不新增屏幕/意图。
 * 只支持恢复(versioned update,archived:false)与删除(AlertDialog 确认后软删);
 * 恢复/删除走既有 workbench hooks,成功经 workbench.all() 失效即时刷新本列表。
 */
export function ArchivedSessionsPanel() {
  const [expanded, setExpanded] = useState(false);
  const archived = useArchivedSessions(ARCHIVED_QUERY);
  const restoreSession = useRestoreSession();
  const removeSession = useRemoveSession();
  const [restoringIds, setRestoringIds] = useState<Set<string>>(() => new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<WorkbenchSession | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const items = archived.data?.pages.flatMap((page) => page.items) ?? [];
  const hasMore = archived.hasNextPage === true;
  useAutoLoadMore(loadMoreRef, expanded && hasMore && !archived.isFetchingNextPage, () => {
    void archived.fetchNextPage();
  });

  function restore(session: WorkbenchSession) {
    setRestoringIds((current) => new Set(current).add(session.id));
    restoreSession.mutate(
      { id: session.id, expectedVersion: session.version },
      {
        onSuccess: () => toast.success(`聊天已恢复 · ${session.title}`),
        onError: (error) => toast.error(archivedErrorMessage(error, '恢复对话失败,请重试')),
        onSettled: () =>
          setRestoringIds((current) => {
            const next = new Set(current);
            next.delete(session.id);
            return next;
          }),
      },
    );
  }

  function confirmRemove() {
    if (!deleteTarget) return;
    const session = deleteTarget;
    setRemovingIds((current) => new Set(current).add(session.id));
    removeSession.mutate(session.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        toast.success('聊天已删除');
      },
      onError: (error) => toast.error(archivedErrorMessage(error, '删除对话失败,请重试')),
      onSettled: () =>
        setRemovingIds((current) => {
          const next = new Set(current);
          next.delete(session.id);
          return next;
        }),
    });
  }

  function rowDisabled(session: WorkbenchSession): boolean {
    return restoringIds.has(session.id) || removingIds.has(session.id);
  }

  return (
    <div className="flex flex-col" data-testid="archived-panel">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? 'archived-panel-body' : undefined}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm transition-colors hover:bg-muted"
          data-testid="archived-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          <Archive className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1 text-foreground">已归档对话</span>
          {archived.isSuccess && (
            <span
              className="shrink-0 text-muted-foreground text-xs tabular-nums"
              data-testid="archived-count"
            >
              {hasMore ? `${items.length}+` : items.length}
            </span>
          )}
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-(--dur-fast)',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="刷新已归档对话"
          title="刷新已归档对话"
          data-testid="archived-refresh"
          disabled={archived.isFetching}
          onClick={() => void archived.refetch()}
        >
          <RefreshCw className={cn('size-4', archived.isFetching && 'animate-spin')} aria-hidden />
        </Button>
      </div>

      {expanded && (
        <div id="archived-panel-body" className="px-2 pt-1 pb-2" data-testid="archived-body">
          {archived.isPending && (
            <div className="flex flex-col gap-2" data-testid="archived-loading">
              {[0, 1].map((index) => (
                <Skeleton key={index} className="h-9 w-full rounded-md" />
              ))}
            </div>
          )}
          {archived.isError && (
            <div
              className="flex items-center justify-between gap-3 py-1"
              data-testid="archived-error"
            >
              <p className="text-muted-foreground text-xs">归档列表读取失败</p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => void archived.refetch()}
                data-testid="archived-retry"
              >
                重试
              </Button>
            </div>
          )}
          {archived.isSuccess && items.length === 0 && (
            <p className="py-2 text-muted-foreground text-xs" data-testid="archived-empty">
              没有已归档的对话。归档用于收起暂不用的创作,随时可恢复。
            </p>
          )}
          {archived.isSuccess && items.length > 0 && (
            <ul className="flex flex-col" aria-label="已归档对话列表">
              {items.map((session) => (
                <li
                  key={session.id}
                  className="flex items-center gap-2 rounded-md py-1.5"
                  data-testid={`archived-session-${session.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-foreground text-sm">{session.title}</p>
                    <p
                      className="text-muted-foreground text-xs tabular-nums"
                      data-testid={`archived-time-${session.id}`}
                    >
                      归档于 {formatArchivedAt(session.archivedAt ?? session.updatedAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={`恢复对话「${session.title}」`}
                    data-testid={`archived-restore-${session.id}`}
                    disabled={rowDisabled(session)}
                    onClick={() => restore(session)}
                  >
                    <ArchiveRestore className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`删除对话「${session.title}」`}
                    data-testid={`archived-remove-${session.id}`}
                    disabled={rowDisabled(session)}
                    onClick={() => setDeleteTarget(session)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {archived.isSuccess && hasMore && (
            <div ref={loadMoreRef} className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-full text-xs"
                data-testid="archived-load-more"
                disabled={archived.isFetchingNextPage}
                onClick={() => void archived.fetchNextPage()}
              >
                {archived.isFetchingNextPage ? '加载中…' : '加载更多'}
              </Button>
            </div>
          )}
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          // pending 中不允许关闭(Esc/遮罩),避免删除中状态丢失;成功后由回调关。
          if (!open && !removeSession.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>删除对话?</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.title}」将被删除。已经生成的图片仍保留在生成历史中。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeSession.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="archived-remove-confirm"
              disabled={removeSession.isPending}
              onClick={(event) => {
                // 阻止默认立即关闭:onSuccess 才关,失败保留对话框可重试。
                event.preventDefault();
                confirmRemove();
              }}
            >
              {removeSession.isPending ? '删除中…' : '删除对话'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
