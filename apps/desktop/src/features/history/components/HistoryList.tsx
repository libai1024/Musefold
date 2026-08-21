// src/features/history/components/HistoryList.tsx
// 生成历史列表 —— 线程化（微调链）+ Codex 式内容优先行（TASK-HIS-01/03）
//
// 结构：原始生成为根，微调按时间正序缩进挂在其下（↳），
// 行内容以提示词为主行，状态只在异常时发声；选中态为中性色。

import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  GenerationHistoryRow,
  type GenerationHistoryItemViewModel,
} from '@musefold/product-ui';
import {
  Image,
  XCircle,
  RotateCcw,
  Trash2,
} from '../../../components/ui/icons';
import { useHistoryStore } from '../store';
import { historyStatusMeta } from '@musefold/domain/history-status';
import { historyErrorPresentation } from '../error';
import { formatHistoryCost } from '../format';
import { flattenHistoryThreads, type HistoryThreadItem } from '@musefold/domain/history-lineage';
import type { DesktopGenerationEntry } from '@musefold/desktop-contracts/history-documents';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { Spinner } from '@musefold/ui';
import { formatTime, formatDuration } from '../../../lib/format';
import { displayModelName } from '../../../lib/model-catalog';
import { toImageSrc } from '../../../lib/media';
import { useAppStore } from '../../../stores/app';

export function HistoryList({
  onOpenLightbox,
}: {
  onOpenLightbox?: (id: string) => void;
}) {
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
    <div
      ref={parentRef}
      className="h-full overflow-auto px-4 py-2"
      data-testid="history-list"
    >
      {error && records.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <XCircle className="h-8 w-8 text-danger" />
          <p className="text-sm font-medium text-secondary">历史加载失败</p>
          <p className="max-w-[280px] text-xs text-tertiary">{error}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load({ limit: 200 })}
            className="mt-1 rounded-full"
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> 重试
          </Button>
        </div>
      ) : records.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Image}
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
            icon={Image}
            title={loading ? '正在加载…' : '还没有生成记录'}
            hint="从「新设计」开始制作，生成的图像会出现在这里。"
            data-testid="history-empty"
          />
        )
      ) : (
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
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

function HistoryRow({
  item,
  selected,
  retrying,
  onSelect,
  onOpenLightbox,
  onRetry,
  onDelete,
}: {
  item: HistoryThreadItem<DesktopGenerationEntry>;
  selected: boolean;
  retrying: boolean;
  onSelect: () => void;
  onOpenLightbox: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const r = item.record;
  const meta = historyStatusMeta(r.status);
  const error = meta.showError
    ? historyErrorPresentation(r.errorCode, r.errorMessage)
    : null;
  const showRetry = meta.status === 'failed' && Boolean(error?.canRetry);
  const isRefinement = item.depth > 0 || item.orphan;
  const refinementCount = item.depth === 0 ? item.threadSize - 1 : 0;
  const metadata = [
    displayModelName(r.providerModel),
    ...(meta.status === 'succeeded'
      ? [formatHistoryCost(r.cost, r.costUnit), formatDuration(r.durationMs)]
      : []),
    ...(error ? [error.displayTitle] : []),
    formatTime(r.createdAtMs),
  ];
  const viewModel: GenerationHistoryItemViewModel = {
    id: r.id,
    prompt: r.request.prompt,
    imageUrl:
      r.status === 'succeeded' && r.imagePath ? toImageSrc(r.imagePath) : null,
    statusKey: meta.status,
    statusLabel: retrying ? '重试中…' : meta.label,
    statusTone:
      meta.status === 'succeeded'
        ? 'success'
        : meta.status === 'failed'
          ? 'danger'
          : 'neutral',
    metadata,
    selected,
    depth: item.depth,
    threadRootId: item.threadRootId,
    isRetrying: retrying,
    refinementLabel: isRefinement
      ? `微调${item.depth > 0 ? ` ${item.refinementIndex}` : ''}`
      : undefined,
    refinementTitle: item.orphan
      ? '微调（来源记录已删除）'
      : isRefinement
        ? '基于上一张图微调'
        : undefined,
    refinementCount,
  };

  return (
    <GenerationHistoryRow
      item={viewModel}
      onOpen={onSelect}
      onOpenImage={
        r.status === 'succeeded' && r.imagePath ? onOpenLightbox : undefined
      }
      actions={
        <>
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
        </>
      }
    />
  );
}
