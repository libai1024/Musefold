'use client';

import { Button } from '@musefold/ui/components/button';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Spinner } from '@musefold/ui/components/spinner';
import { ArrowRight, Search, X } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import type { ReactNode } from 'react';

/** 搜索框(承旧 SchemeSearchField):mine 本地过滤;discover 带显式提交钮(市场不自动加载)。 */
export function SchemeSearchField({
  value,
  onChange,
  placeholder,
  onSubmit,
  submitting = false,
}: {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  onSubmit?(): void;
  submitting?: boolean;
}) {
  return (
    <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5">
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">搜索方案</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onSubmit) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder ?? '搜索方案、作者或仓库'}
        aria-label="搜索方案"
        className="min-w-0 flex-1 bg-transparent text-foreground text-xs outline-none placeholder:text-muted-foreground/70"
        data-testid="scheme-search"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="清空搜索"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
      {onSubmit ? (
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label="搜索市场"
          title="搜索市场"
          data-testid="market-search-run"
        >
          {submitting ? (
            <Spinner className="size-3.5" />
          ) : (
            <ArrowRight className="size-3.5" aria-hidden />
          )}
        </button>
      ) : null}
    </div>
  );
}

/** 分节(承旧 SchemeListSection):草稿/正式或市场候选;count 为 0 不渲染。 */
export function SchemeListSection({
  title,
  count,
  showHeading = true,
  singleColumn = false,
  children,
}: {
  title: string;
  count: number;
  showHeading?: boolean;
  singleColumn?: boolean;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="mt-7 first:mt-0">
      {showHeading ? (
        <div className="mb-2 flex items-center gap-2 border-border border-b pb-2">
          <h2 className="font-semibold text-foreground text-sm">{title}</h2>
          <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
        </div>
      ) : null}
      <div
        className={cn(
          'grid gap-x-7 gap-y-1',
          singleColumn ? 'grid-cols-1' : 'grid-cols-2 max-[980px]:grid-cols-1',
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** 列表 loading(I1 结构化骨架,与行同形)。 */
export function SchemeListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="grid gap-y-1" data-testid="scheme-list-skeleton" aria-label="正在读取方案">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="grid min-h-[76px] grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2"
        >
          <Skeleton className="size-14 rounded-md" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-8 w-12 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** 就地错误条(I4):标题 + 消息 + 重试。 */
export function SchemeInlineError({
  title,
  message,
  onRetry,
  testId,
}: {
  title: string;
  message?: string | null;
  onRetry(): void;
  testId: string;
}) {
  return (
    <div
      className="mx-auto flex max-w-[420px] flex-col items-center gap-1.5 py-14 text-center"
      data-testid={testId}
      role="alert"
    >
      <p className="font-medium text-foreground text-sm">{title}</p>
      {message ? <p className="text-[11px] text-muted-foreground leading-5">{message}</p> : null}
      <Button variant="outline" size="sm" className="mt-2.5" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

/** 空态(承旧 EmptyList 文案,I5 可创建场景带主 CTA)。 */
export function SchemeEmptyState({
  icon,
  title,
  hint,
  cta,
  testId,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  cta?: ReactNode;
  testId: string;
}) {
  return (
    <div className="col-span-full py-16 text-center" data-testid={testId}>
      <div className="mx-auto flex justify-center text-muted-foreground/60">{icon}</div>
      <p className="mt-3 text-muted-foreground text-xs">{title}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground/80">{hint}</p> : null}
      {cta ? <div className="mt-4 flex justify-center">{cta}</div> : null}
    </div>
  );
}
