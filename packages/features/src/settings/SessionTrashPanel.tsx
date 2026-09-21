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
import { ArchiveRestore, ChevronDown, RefreshCw, Trash2 } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useId, useRef, useState } from 'react';
import {
  useEmptySessionTrash,
  usePurgeSession,
  useRestoreTrashedSession,
  useSessionTrash,
} from '../workbench/session-trash-hooks';
import { formatArchivedAt } from './ArchivedSessionsPanel';

type CleanupTarget = { kind: 'one'; session: WorkbenchSession } | { kind: 'all' };

function message(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试';
}

/** Shared settings surface. All filtering/pagination and cleanup belong to the gateway. */
export function SessionTrashPanel() {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const requestInFlight = useRef(false);
  const trash = useSessionTrash(expanded);
  const restore = useRestoreTrashedSession();
  const purge = usePurgeSession();
  const empty = useEmptySessionTrash();
  const [target, setTarget] = useState<CleanupTarget | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const busy = restore.isPending || purge.isPending || empty.isPending;
  const items = [
    ...new Map(
      (trash.data?.pages.flatMap((page) => page.items) ?? []).map((session) => [
        session.id,
        session,
      ]),
    ).values(),
  ];
  const hasMore = trash.hasNextPage === true;

  function ask(next: CleanupTarget, trigger: HTMLElement) {
    returnFocus.current = trigger;
    setActionError(null);
    setTarget(next);
  }

  async function restoreRow(session: WorkbenchSession) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const result = await restore.mutateAsync(session.id);
      toggleRef.current?.focus();
      toast.success(result.archivedAt ? '对话已恢复到已归档对话' : '对话已恢复到对话列表');
    } catch (error) {
      toast.error(message(error));
    } finally {
      requestInFlight.current = false;
    }
  }

  async function confirmCleanup() {
    if (!target || requestInFlight.current) return;
    requestInFlight.current = true;
    setActionError(null);
    try {
      const result =
        target.kind === 'all'
          ? await empty.mutateAsync()
          : await purge.mutateAsync(target.session.id);
      returnFocus.current = toggleRef.current;
      setTarget(null);
      toast.success(
        result.purged === 0 ? '没有需要永久删除的对话' : `已永久删除 ${result.purged} 条对话`,
      );
    } catch (error) {
      setActionError(message(error));
    } finally {
      requestInFlight.current = false;
    }
  }

  return (
    <div className="flex flex-col" data-testid="session-trash-panel">
      <div className="flex items-center gap-1">
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm transition-colors hover:bg-muted"
          data-testid="session-trash-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          <Trash2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1">会话回收站</span>
          {trash.data && (
            <span
              className="text-muted-foreground text-xs tabular-nums"
              data-testid="session-trash-count"
            >
              {items.length}
              {hasMore ? '+' : ''}
            </span>
          )}
          <ChevronDown
            className={cn(
              'size-4 text-muted-foreground transition-transform',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
        {expanded && (
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 md:size-8"
            aria-label="刷新会话回收站"
            data-testid="session-trash-refresh"
            disabled={trash.isFetching || busy}
            onClick={() => void trash.refetch()}
          >
            <RefreshCw className={cn('size-4', trash.isFetching && 'animate-spin')} aria-hidden />
          </Button>
        )}
      </div>
      {expanded && (
        <div id={bodyId} className="px-2 pt-1 pb-2" data-testid="session-trash-body">
          <p className="pb-2 text-muted-foreground text-xs">
            恢复保留原归档位置。永久删除只清理会话和草稿，生成历史、图片与费用记录仍保留。
          </p>
          {trash.isPending && (
            <div className="space-y-2" data-testid="session-trash-loading">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          )}
          {trash.isError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 py-2">
              <p className="text-muted-foreground text-xs">
                {trash.isFetchNextPageError ? '后续对话加载失败' : '会话回收站读取失败'}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 md:min-h-7"
                disabled={trash.isFetching}
                data-testid="session-trash-retry"
                onClick={() =>
                  void (trash.isFetchNextPageError ? trash.fetchNextPage() : trash.refetch())
                }
              >
                重试
              </Button>
            </div>
          )}
          {trash.isSuccess && items.length === 0 && (
            <p className="py-2 text-muted-foreground text-xs" data-testid="session-trash-empty">
              回收站为空。删除的对话会显示在这里。
            </p>
          )}
          {items.length > 0 && (
            <>
              <ul aria-label="会话回收站列表" className="flex flex-col">
                {items.map((session) => (
                  <li
                    key={session.id}
                    className="flex flex-wrap items-center gap-2 border-border border-b py-2"
                    data-testid={`session-trash-row-${session.id}`}
                  >
                    <div className="min-w-0 basis-full md:flex-1 md:basis-auto">
                      <p className="break-words text-sm">{session.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {session.archivedAt ? '已归档 · ' : ''}删除于{' '}
                        {formatArchivedAt(session.deletedAt ?? session.updatedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 md:min-h-7"
                        disabled={busy}
                        aria-label={`恢复对话「${session.title}」`}
                        data-testid={`session-trash-restore-${session.id}`}
                        onClick={() => void restoreRow(session)}
                      >
                        <ArchiveRestore className="size-4" aria-hidden />
                        {restore.isPending && restore.variables === session.id ? '恢复中…' : '恢复'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 text-destructive md:min-h-7"
                        disabled={busy}
                        aria-label={`永久删除对话「${session.title}」`}
                        data-testid={`session-trash-purge-${session.id}`}
                        onClick={(event) => ask({ kind: 'one', session }, event.currentTarget)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                        永久删除
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              {hasMore && !trash.isFetchNextPageError && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 min-h-11 w-full md:min-h-7"
                  data-testid="session-trash-load-more"
                  disabled={trash.isFetching || busy}
                  onClick={() => void trash.fetchNextPage()}
                >
                  {trash.isFetchingNextPage ? '加载中…' : '加载更多'}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-3 min-h-11 text-destructive md:min-h-7"
                disabled={busy}
                data-testid="session-trash-empty-all"
                onClick={(event) => ask({ kind: 'all' }, event.currentTarget)}
              >
                清空会话回收站
              </Button>
            </>
          )}
        </div>
      )}
      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !requestInFlight.current) setTarget(null);
        }}
      >
        <AlertDialogContent
          className="max-w-sm"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = returnFocus.current;
            (trigger?.isConnected ? trigger : toggleRef.current)?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {target?.kind === 'all' ? '清空会话回收站？' : '永久删除对话？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {target?.kind === 'all'
                ? '将永久删除回收站内的全部会话，包括尚未加载的会话。'
                : `将永久删除「${target?.session.title ?? ''}」。`}
              会话和草稿无法恢复，生成历史、图片与费用记录仍保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError && (
            <p role="alert" className="text-destructive text-sm">
              {actionError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              data-testid="session-trash-confirm"
              onClick={(event) => {
                event.preventDefault();
                void confirmCleanup();
              }}
            >
              {busy
                ? '删除中…'
                : actionError
                  ? '重试永久删除'
                  : target?.kind === 'all'
                    ? '清空回收站'
                    : '永久删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
