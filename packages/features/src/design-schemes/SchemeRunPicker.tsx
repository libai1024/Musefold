'use client';

import type { DesignSchemeSummary } from '@musefold/contracts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@musefold/ui/components/dialog';
import { Input } from '@musefold/ui/components/input';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Blocks, Search } from '@musefold/ui/icons';
import { useMemo, useState } from 'react';
import { useSchemeList } from './hooks';
import { FIDELITY_LABEL, schemeTime } from './scheme-labels';
import { SchemeInlineError } from './SchemeListPrimitives';

/**
 * 方案选择器(承旧 SchemeRunPickerPopover,UI 规范 §6.2):
 * Composer「+」菜单「设计方案」打开,列出正式方案(草稿的试运行走方案中心),
 * 无查询时最近运行的 4 个置顶(承旧 recent 分组),其余按更新时间倒序。
 * 选取结果交给调用方解析附件(resolveSchemeAttachment),本组件不直接写 Composer。
 */
export function SchemeRunPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 选中某个正式方案;附件解析与挂载由调用方负责(可能异步,失败自行报错)。 */
  onPick(scheme: DesignSchemeSummary): void;
}) {
  const list = useSchemeList();
  const [query, setQuery] = useState('');

  const formal = useMemo(
    () => (list.data?.items ?? []).filter((scheme) => scheme.status === 'formal'),
    [list.data],
  );
  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      formal.filter(
        (scheme) =>
          !normalized ||
          [scheme.name, scheme.summary, scheme.sourceLabel]
            .join(' ')
            .toLowerCase()
            .includes(normalized),
      ),
    [formal, normalized],
  );
  const ordered = useMemo(() => {
    if (normalized) {
      return filtered
        .slice()
        .sort(
          (a, b) =>
            (schemeTime(b.updatedAt)?.getTime() ?? 0) - (schemeTime(a.updatedAt)?.getTime() ?? 0),
        );
    }
    const recent = filtered
      .filter((scheme) => scheme.lastRunAt != null)
      .sort(
        (a, b) =>
          (schemeTime(b.lastRunAt)?.getTime() ?? 0) - (schemeTime(a.lastRunAt)?.getTime() ?? 0),
      )
      .slice(0, 4);
    const rest = filtered
      .filter((scheme) => !recent.some((item) => item.id === scheme.id))
      .sort(
        (a, b) =>
          (schemeTime(b.updatedAt)?.getTime() ?? 0) - (schemeTime(a.updatedAt)?.getTime() ?? 0),
      );
    return [...recent, ...rest];
  }, [filtered, normalized]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(560px,86dvh)] max-w-md flex-col overflow-hidden"
        data-testid="scheme-run-picker"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Blocks className="size-4 text-muted-foreground" aria-hidden />
            选择设计方案
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            正式方案会挂载到 Composer，决定这次生成的视觉方向。
          </p>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            placeholder="搜索方案、来源或说明"
            className="pl-8"
            data-testid="scheme-run-picker-search"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.isPending ? (
            <div className="flex flex-col gap-2 py-1" data-testid="scheme-run-picker-loading">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : list.isError ? (
            <SchemeInlineError
              title="读取设计方案失败"
              message={list.error instanceof Error ? list.error.message : null}
              onRetry={() => void list.refetch()}
              testId="scheme-run-picker-error"
            />
          ) : ordered.length === 0 ? (
            <p
              className="py-10 text-center text-[11px] text-muted-foreground"
              data-testid="scheme-run-picker-empty"
            >
              {normalized
                ? '没有找到匹配的方案'
                : '还没有正式方案；草稿需要先在方案中心完成一次试运行。'}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5 py-1" role="listbox" aria-label="正式方案">
              {ordered.map((scheme) => (
                <button
                  key={scheme.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => onPick(scheme)}
                  className="flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring/45"
                  data-testid={`scheme-run-pick-${scheme.id}`}
                >
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
                    aria-hidden
                  >
                    <Blocks className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground text-xs">
                      {scheme.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {scheme.sourceLabel} · {FIDELITY_LABEL[scheme.fidelity] ?? scheme.fidelity}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
