'use client';

import type { GenerationJob } from '@musefold/contracts';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import { Spinner } from '@musefold/ui/components/spinner';
import {
  CornerDownRight,
  History as HistoryIcon,
  ImageOff,
  RotateCcw,
  Square,
  Trash2,
  Undo2,
} from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useState } from 'react';
import {
  formatDateTime,
  formatDuration,
  isActiveStatus,
  STATUS_LABELS,
  statusBadgeVariant,
} from './format';

export interface HistoryRowProps {
  job: GenerationJob;
  depth: number;
  selected: boolean;
  deletedView: boolean;
  onOpen(): void;
  onCancel(): void;
  onRetry(): void;
  onRemove(): void;
  onRestore(): void;
}

/** 历史列表行(承旧 GenerationHistoryRow):缩略图 + 提示词/元信息 + 常驻操作组;线程缩进。 */
export function HistoryRow({
  job,
  depth,
  selected,
  deletedView,
  onOpen,
  onCancel,
  onRetry,
  onRemove,
  onRestore,
}: HistoryRowProps) {
  const [imageBroken, setImageBroken] = useState(false);
  const asset = job.assets[0];
  const active = isActiveStatus(job.status);
  const duration = formatDuration(job);

  return (
    <div
      className="flex items-center gap-2"
      style={depth > 0 ? { paddingInlineStart: depth * 26 } : undefined}
      role="listitem"
    >
      {depth > 0 && (
        <CornerDownRight
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
          data-testid="history-thread-connector"
        />
      )}
      <article
        data-testid="history-row"
        data-status={job.status}
        className={cn(
          'group flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
          selected
            ? 'border-border bg-card'
            : 'border-transparent hover:border-border hover:bg-card',
          deletedView && 'opacity-70',
        )}
      >
        <button
          type="button"
          className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground"
          onClick={onOpen}
          aria-label="查看详情"
          data-testid="history-thumb"
        >
          {active ? (
            <Spinner className="size-4" />
          ) : asset && !imageBroken ? (
            <img
              src={asset.url}
              alt=""
              loading="lazy"
              className="size-full object-cover"
              onError={() => setImageBroken(true)}
            />
          ) : asset ? (
            <ImageOff className="size-5" aria-hidden />
          ) : (
            <HistoryIcon className="size-5" aria-hidden />
          )}
        </button>

        <button
          type="button"
          className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
          onClick={onOpen}
          data-testid="history-row-open"
        >
          <span className="truncate font-medium text-foreground text-sm">
            {job.request.prompt || '(无提示词)'}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <Badge
              variant={statusBadgeVariant(job.status)}
              className="px-1.5 py-0 text-[10px]"
              data-testid="history-row-status"
            >
              {STATUS_LABELS[job.status]}
            </Badge>
            {job.providerModel && <span className="truncate">{job.providerModel}</span>}
            {duration && <span>{duration}</span>}
            <span data-testid="history-row-time">{formatDateTime(job.createdAt)}</span>
          </span>
        </button>

        {/* 触屏常显;md+ hover/聚焦渐显(V25-UI-SPEC §8-I2)。 */}
        <div className="flex shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          {deletedView ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              aria-label="恢复记录"
              data-testid="history-row-restore"
              onClick={onRestore}
            >
              <Undo2 className="size-4" />
            </Button>
          ) : active ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              aria-label="取消生成"
              data-testid="history-row-cancel"
              onClick={onCancel}
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label="重试生成"
                data-testid="history-row-retry"
                onClick={onRetry}
              >
                <RotateCcw className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                aria-label="移入回收站"
                data-testid="history-row-remove"
                onClick={onRemove}
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
        </div>
      </article>
    </div>
  );
}
