'use client';

import type { DesignSchemeSummary } from '@musefold/contracts';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@musefold/ui/components/dialog';
import { Input } from '@musefold/ui/components/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@musefold/ui/components/sheet';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { toast } from '@musefold/ui/components/sonner';
import { RefreshCw, Trash2 } from '@musefold/ui/icons';
import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../history/hooks';
import { useSchemeTrash } from './use-scheme-trash';

export function SchemeTrashDialog({
  onClose,
  onRestoreFocus,
}: {
  onClose(): void;
  onRestoreFocus(): void;
}) {
  const desktop = useMediaQuery('(min-width: 768px)');
  const [query, setQuery] = useState('');
  const { list, purge, changedAccount, isCurrent } = useSchemeTrash(query);
  const [target, setTarget] = useState<DesignSchemeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const confirmationVisible = useRef(false);
  const targetRef = useRef(target);
  targetRef.current = target;
  const returnFocus = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const items = [
    ...new Map(
      (list.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.id, item]),
    ).values(),
  ];
  const readable = !changedAccount && (!list.isError || list.isFetchNextPageError);
  const busy = purge.isPending;
  const close = () => {
    if (!inFlight.current && (changedAccount || (!target && !confirmationVisible.current)))
      onClose();
  };
  async function confirm() {
    if (!target || inFlight.current || !isCurrent()) return;
    inFlight.current = true;
    setError(null);
    try {
      await purge.mutateAsync({ schemeId: target.id, expectedVersion: target.version });
      if (!mounted.current || !isCurrent()) return;
      returnFocus.current = searchRef.current;
      setTarget(null);
      toast.success('方案已永久删除', {
        description: '生成历史、图片与费用记录仍保留；无引用的方案文件将由系统清理。',
      });
    } catch (cause) {
      if (mounted.current && isCurrent())
        setError(cause instanceof Error ? cause.message : '删除未完成，请重试');
    } finally {
      inFlight.current = false;
    }
  }
  const Title = desktop ? DialogTitle : SheetTitle;
  const Description = desktop ? DialogDescription : SheetDescription;
  const body = (
    <>
      <div className="space-y-2">
        <Title>已移除的方案</Title>
        <Description>
          仅列出已从我的方案移除的内容。永久删除无法恢复，生成历史、图片与费用记录仍保留。
        </Description>
      </div>
      {changedAccount ? (
        <p role="alert" className="text-sm text-muted-foreground">
          账号已变化，请关闭后重新打开，核对当前账号的方案。
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Input
              ref={searchRef}
              aria-label="搜索已移除的方案"
              placeholder="搜索名称、来源或说明"
              maxLength={200}
              value={query}
              disabled={busy || target !== null}
              onChange={(event) => setQuery(event.target.value)}
              data-testid="scheme-trash-search"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 md:size-8"
              aria-label="刷新已移除的方案"
              disabled={list.isFetching || busy || target !== null}
              onClick={() => void list.refetch()}
              data-testid="scheme-trash-refresh"
            >
              <RefreshCw className="size-4" aria-hidden />
            </Button>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            aria-busy={list.isFetching}
            data-testid="scheme-trash-list"
          >
            {list.isPending && (
              <div className="space-y-2" data-testid="scheme-trash-loading">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            )}
            {list.isError && (
              <div role="alert" className="space-y-2 py-3 text-sm">
                <p>
                  {list.isFetchNextPageError
                    ? '后续方案加载失败，已加载的内容仍保留。'
                    : '已移除的方案读取失败，请重试。'}
                </p>
                <Button
                  variant="outline"
                  className="min-h-11 md:min-h-8"
                  disabled={list.isFetching || busy}
                  onClick={() =>
                    void (list.isFetchNextPageError ? list.fetchNextPage() : list.refetch())
                  }
                >
                  重试读取
                </Button>
              </div>
            )}
            {readable && list.isSuccess && items.length === 0 && (
              <div
                className="space-y-2 py-5 text-sm text-muted-foreground"
                data-testid="scheme-trash-empty"
              >
                <p>{query.trim() ? '没有匹配的已移除方案' : '没有已移除的方案'}</p>
                {query.trim() && (
                  <Button variant="outline" onClick={() => setQuery('')}>
                    清除筛选
                  </Button>
                )}
              </div>
            )}
            {readable && items.length > 0 && (
              <>
                <p className="py-2 text-xs text-muted-foreground" data-testid="scheme-trash-count">
                  已加载 {items.length}
                  {list.hasNextPage ? '+' : ''} 个方案
                </p>
                <ul aria-label="已移除的方案列表" className="divide-y divide-border">
                  {items.map((scheme) => (
                    <li
                      key={scheme.id}
                      className="flex flex-wrap items-center gap-2 py-3"
                      data-testid={`scheme-trash-row-${scheme.id}`}
                    >
                      <div className="min-w-0 basis-full md:flex-1 md:basis-auto">
                        <p className="break-words text-sm font-medium">{scheme.name}</p>
                        <p className="break-words text-xs text-muted-foreground">
                          {scheme.status === 'draft' ? '草稿' : '正式方案'} · {scheme.sourceLabel}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 shrink-0 text-destructive md:min-h-8"
                        disabled={busy}
                        aria-label={`永久删除方案「${scheme.name}」`}
                        data-testid={`scheme-trash-purge-${scheme.id}`}
                        onClick={(event) => {
                          returnFocus.current = event.currentTarget;
                          confirmationVisible.current = true;
                          setError(null);
                          setTarget(scheme);
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden />
                        永久删除
                      </Button>
                    </li>
                  ))}
                </ul>
                {list.hasNextPage && !list.isFetchNextPageError && (
                  <Button
                    variant="outline"
                    className="my-2 min-h-11 w-full md:min-h-8"
                    disabled={list.isFetching || busy}
                    onClick={() => void list.fetchNextPage()}
                    data-testid="scheme-trash-load-more"
                  >
                    {list.isFetchingNextPage ? '加载中…' : '加载更多'}
                  </Button>
                )}
              </>
            )}
          </div>
        </>
      )}
      <div className="flex shrink-0 justify-end">
        <Button variant="outline" className="min-h-11 md:min-h-8" disabled={busy} onClick={close}>
          关闭
        </Button>
      </div>
      <AlertDialog
        open={target !== null && !changedAccount}
        onOpenChange={(open) => {
          if (!open && !inFlight.current) setTarget(null);
        }}
      >
        <AlertDialogContent
          className="max-w-md"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (targetRef.current && isCurrent()) return;
            confirmationVisible.current = false;
            const trigger = returnFocus.current;
            (trigger?.isConnected ? trigger : searchRef.current)?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除方案？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除「{target?.name}
              」及其版本和专用来源，无法恢复。生成历史、图片、运行与费用记录仍保留。其他方案共用或任务仍需使用的文件不会删除；清理无引用文件可能稍后完成。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} className="min-h-11 md:min-h-8">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="min-h-11 md:min-h-8"
              disabled={busy || changedAccount}
              aria-busy={busy}
              data-testid="scheme-trash-confirm"
              onClick={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              {busy ? '删除中…' : error ? '重试永久删除' : '永久删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  const onCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    onRestoreFocus();
  };
  return desktop ? (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="flex max-h-[85dvh] flex-col"
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
        data-testid="scheme-trash-dialog"
      >
        {body}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="bottom"
        className="flex max-h-[90dvh] flex-col px-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
        data-testid="scheme-trash-dialog"
      >
        {body}
      </SheetContent>
    </Sheet>
  );
}
