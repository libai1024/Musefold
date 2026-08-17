// src/features/history/components/HistoryList.tsx
// 生成历史列表 —— 线程化（微调链）+ Codex 式内容优先行（TASK-HIS-01/03）
//
// 结构：原始生成为根，微调按时间正序缩进挂在其下（↳），
// 行内容以提示词为主行，状态只在异常时发声；选中态为中性色。

import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Image as ImageIcon,
  ImageOff,
  CornerDownRight,
  XCircle,
  RotateCcw,
  Trash2,
} from '../../../components/ui/icons';
import { useHistoryStore } from '../store';
import { historyStatusMeta } from '../status';
import { historyErrorPresentation } from '../error';
import { formatHistoryCost } from '../format';
import { flattenHistoryThreads, type HistoryThreadItem } from '../lineage';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { Spinner } from '../../../components/ui/spinner';
import { formatTime, formatDuration } from '../../../lib/format';
import { displayModelName } from '../../../lib/model-catalog';
import { toImageSrc } from '../../../lib/media';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../stores/app';

export function HistoryList({ onOpenLightbox }: { onOpenLightbox?: (id: string) => void }) {
  const {
    records,
    load,
    remove,
    retry,
    retryingIds,
    loading,
    error,
    filtered,
    clearFilters,
    selectedId,
    select,
  } = useHistoryStore();
  const parentRef = useRef<HTMLDivElement>(null);
  const density = useAppStore((s) => s.density);

  useEffect(() => {
    void load({ limit: 200 });
  }, [load]);

  const items = useMemo(() => flattenHistoryThreads(records), [records]);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (density === 'compact' ? 62 : 72),
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto px-4 py-2" data-testid="history-list">
      {error && records.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <XCircle className="h-8 w-8 text-danger" />
          <p className="text-sm font-medium text-secondary">历史加载失败</p>
          <p className="max-w-[280px] text-xs text-tertiary">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void load({ limit: 200 })} className="mt-1 rounded-full">
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> 重试
          </Button>
        </div>
      ) : records.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={ImageIcon}
            title={loading ? '正在加载…' : '没有匹配的记录'}
            hint="试试放宽条件，或清除筛选查看全部。"
            data-testid="history-empty-filtered"
            action={
              !loading ? (
                <button
                  type="button"
                  className="text-[11px] font-medium text-primary underline decoration-border-strong underline-offset-2 hover:decoration-primary"
                  data-testid="history-empty-clear-filters"
                  onClick={() => clearFilters()}
                >
                  清除筛选
                </button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            icon={ImageIcon}
            title={loading ? '正在加载…' : '还没有生成记录'}
            hint="从「新设计」开始制作，生成的图像会出现在这里。"
            data-testid="history-empty"
          />
        )
      ) : (
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((v) => {
            const item = items[v.index];
            if (!item) return null;
            const r = item.record;
            return (
              <div
                key={r.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${v.start}px)`,
                }}
                className="pb-[var(--density-list-gap)]"
              >
                <div className="mx-auto w-full max-w-[860px]">
                  <HistoryRow
                    item={item}
                    selected={selectedId === r.id}
                    retrying={retryingIds.has(r.id)}
                    onSelect={() => select(r.id)}
                    onOpenLightbox={() => onOpenLightbox?.(r.id)}
                    onRetry={() => void retry(r.id)}
                    onDelete={() => void remove(r.id)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Thumb({ path, onOpen }: { path?: string | null; onOpen?: () => void }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [path]);
  if (!path) {
    return <ImageOff className="h-full w-full p-3.5 text-quaternary" />;
  }
  const content = broken ? (
    <ImageOff className="h-full w-full p-3.5 text-quaternary" />
  ) : (
    <img
      src={toImageSrc(path)}
      alt=""
      onError={() => setBroken(true)}
      className="h-full w-full object-cover"
    />
  );
  return (
    <button
      type="button"
      className="block h-full w-full cursor-zoom-in"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.();
      }}
      title="放大预览"
      data-testid="history-thumb-open"
    >
      {content}
    </button>
  );
}

function HistoryRow({
  item,
  selected,
  retrying,
  onSelect,
  onOpenLightbox,
  onRetry,
  onDelete,
}: {
  item: HistoryThreadItem;
  selected: boolean;
  retrying: boolean;
  onSelect: () => void;
  onOpenLightbox: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const r = item.record;
  const meta = historyStatusMeta(r.status);
  const error = meta.showError ? historyErrorPresentation(r.errorCode, r.errorMessage) : null;
  const showRetry = meta.status === 'failed' && Boolean(error?.canRetry);
  const isRefinement = item.depth > 0 || item.orphan;
  const refinementCount = item.depth === 0 ? item.threadSize - 1 : 0;

  return (
    <div className="flex items-stretch" style={{ paddingLeft: `${Math.min(item.depth, 4) * 26}px` }}>
      {item.depth > 0 && (
        <span
          className="flex w-[26px] shrink-0 items-start justify-center pt-[calc(var(--density-row-padding)+0.45rem)] text-quaternary"
          aria-hidden="true"
          data-testid="history-thread-connector"
        >
          <CornerDownRight className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          'group flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg border p-[var(--density-row-padding)] transition-[border-color,background-color] duration-[var(--dur-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]',
          selected
            ? 'border-border-strong bg-inset'
            : 'border-transparent bg-transparent hover:border-border-subtle hover:bg-hover',
        )}
        data-testid="history-row"
        data-status={meta.status}
        data-selected={selected ? 'true' : 'false'}
        data-depth={item.depth}
        data-thread-root={item.threadRootId}
        aria-selected={selected}
      >
        <div className="h-[var(--density-history-thumb)] w-[var(--density-history-thumb)] shrink-0 overflow-hidden rounded-md border border-border-subtle bg-inset">
          <Thumb path={r.status === 'success' ? r.imagePath : null} onOpen={onOpenLightbox} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {isRefinement && (
              <span
                className="shrink-0 rounded-full border border-border-subtle px-1.5 py-px font-mono text-[9px] leading-[14px] text-tertiary"
                data-testid="history-refinement-tag"
                title={item.orphan ? '微调（来源记录已删除）' : '基于上一张图微调'}
              >
                微调{item.depth > 0 ? ` ${item.refinementIndex}` : ''}
              </span>
            )}
            <span className="truncate text-[12.5px] font-medium leading-5 text-primary">
              {r.promptText || '（无提示词）'}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-quaternary">
              {formatTime(r.createdAt)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] leading-4 text-tertiary">
            {retrying ? (
              <span className="inline-flex items-center gap-1 text-primary" data-testid="history-retrying">
                <Spinner size={10} /> 重试中…
              </span>
            ) : meta.status !== 'success' ? (
              <span
                className={cn('shrink-0 font-medium', meta.colorClass)}
                data-testid="history-status-label"
              >
                {meta.label}
              </span>
            ) : null}
            {(retrying || meta.status !== 'success') && <Dot />}
            <span className="truncate" title={r.model}>{displayModelName(r.model)}</span>
            {meta.status === 'success' && (
              <>
                <Dot />
                <span className="tabular-nums">{formatHistoryCost(r.cost, r.costUnit)}</span>
                <Dot />
                <span className="tabular-nums">{formatDuration(r.durationMs)}</span>
              </>
            )}
            {refinementCount > 0 && (
              <>
                <Dot />
                <span className="shrink-0" data-testid="history-thread-count">
                  {refinementCount} 次微调
                </span>
              </>
            )}
            {!retrying && meta.showError && error && (
              <>
                <Dot />
                <span className="truncate text-danger" title={error.hint}>
                  {error.displayTitle}
                </span>
              </>
            )}
            {!retrying && meta.status === 'failed' && error?.primaryAction && (
              <span className="shrink-0 text-quaternary">建议：{error.primaryAction.label}</span>
            )}
          </div>
        </div>
        <div
          className={cn(
            'flex items-center gap-0.5 transition-opacity',
            retrying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {showRetry && (
            <Button
              size={retrying ? 'xs' : 'iconSm'}
              variant="ghost"
              disabled={retrying}
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              title={retrying ? '重试中…' : '重试'}
              data-testid="history-retry"
            >
              {retrying ? (
                <>
                  <Spinner size={12} /> 重试中…
                </>
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          <Button
            size="iconSm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="删除"
            className="hover:bg-danger/10 hover:text-danger"
            data-testid="history-delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="text-border-strong">·</span>;
}
