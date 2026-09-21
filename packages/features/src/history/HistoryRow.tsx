'use client';

import type { GenerationJob } from '@musefold/contracts';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import { FadeImage } from '@musefold/ui/components/fade-image';
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
import { Fragment, type ReactNode, useState } from 'react';
import { canRetryGeneration, historyErrorPresentation } from './error';
import {
  formatCostPoints,
  formatDateTime,
  formatDuration,
  isActiveStatus,
  refinementLabel,
  refinementTitle,
  STATUS_LABELS,
  statusBadgeVariant,
  type ThreadedJob,
} from './format';

/**
 * 元信息项之间的「·」(承旧 `.mf-history-meta-item::before`)。
 * 旧版点色取 `--border-strong`,v2.5 无对应 token,用 muted-foreground/50 —— 双主题下都比正文淡一档又看得见;
 * 纯装饰,读屏跳过。
 */
function MetaDot() {
  return (
    <span aria-hidden className="text-muted-foreground/50">
      ·
    </span>
  );
}

export interface HistoryRowProps {
  job: GenerationJob;
  /** 线程归组元信息(缩进层级、微调序号、线程规模、孤儿标记)。 */
  thread: ThreadedJob;
  selected: boolean;
  deletedView: boolean;
  onOpen(): void;
  onCancel(): void;
  onRetry(): void;
  retryPending?: boolean;
  onRemove(): void;
  onRestore(): void;
  /** 回收站行「永久删除」;确认对话框由屏幕层持有。 */
  onPurge(): void;
  /** 缩略点击放大(05 §7 Lightbox);未注入(无成图)时缩略点击走开详情。 */
  onOpenLightbox?(): void;
}

/** 历史列表行(承旧 GenerationHistoryRow):缩略图 + 提示词/元信息 + 常驻操作组;线程缩进。 */
export function HistoryRow({
  job,
  thread,
  selected,
  deletedView,
  onOpen,
  onCancel,
  onRetry,
  retryPending = false,
  onRemove,
  onRestore,
  onPurge,
  onOpenLightbox,
}: HistoryRowProps) {
  const [imageBroken, setImageBroken] = useState(false);
  const asset = job.assets[0];
  const active = isActiveStatus(job.status);
  // 成本 · 用时只在成功行给(承旧行元信息);失败行那个位置留给错误标题。
  const succeeded = job.status === 'succeeded';
  const duration = succeeded ? formatDuration(job) : null;
  const cost = succeeded ? formatCostPoints(job.costPoints) : null;
  const error = historyErrorPresentation(job.error);
  const canRetry = canRetryGeneration(job);
  const depth = thread.depth;
  const label = refinementLabel(thread);
  // 根行的「+n 微调」计数(承旧 refinementCount = threadSize - 1)。
  const refinementCount = depth === 0 ? thread.threadSize - 1 : 0;

  // 元信息序列(承旧 metadata 数组次序):模型 · 成本 · 用时 · 错误 · 微调计数 · 时间。
  const metaItems: Array<{ key: string; node: ReactNode }> = [
    ...(job.providerModel
      ? [{ key: 'model', node: <span className="truncate">{job.providerModel}</span> }]
      : []),
    ...(cost ? [{ key: 'cost', node: <span>{cost}</span> }] : []),
    ...(duration ? [{ key: 'duration', node: <span>{duration}</span> }] : []),
    ...(error
      ? [
          {
            key: 'error',
            node: <span className="truncate text-destructive">{error.title}</span>,
          },
        ]
      : []),
    ...(refinementCount > 0
      ? [
          {
            key: 'refinements',
            node: <span data-testid="history-thread-count">+{refinementCount} 微调</span>,
          },
        ]
      : []),
    {
      key: 'time',
      node: <span data-testid="history-row-time">{formatDateTime(job.createdAt)}</span>,
    },
  ];

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
        data-thread-root={thread.threadRootId}
        data-orphan={thread.orphan ? 'true' : 'false'}
        className={cn(
          'group flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-3 py-2 transition-colors [[data-density=compact]_&]:px-[var(--density-row-padding)] [[data-density=compact]_&]:py-[var(--density-row-padding)]',
          selected
            ? 'border-border bg-card'
            : 'border-transparent hover:border-border hover:bg-card',
          deletedView && 'opacity-70',
        )}
      >
        <button
          type="button"
          className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground [[data-density=compact]_&]:size-[var(--density-history-thumb)]"
          onClick={!imageBroken && onOpenLightbox ? onOpenLightbox : onOpen}
          aria-label={!imageBroken && onOpenLightbox ? '放大预览' : '查看详情'}
          data-testid="history-thumb"
        >
          {active ? (
            <Spinner className="size-4" />
          ) : asset && !imageBroken ? (
            <FadeImage
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
          <span className="flex min-w-0 items-center gap-1.5">
            {label && (
              <span
                className="shrink-0 rounded border border-border px-1 py-px text-[10px] text-muted-foreground"
                title={refinementTitle(thread)}
                data-testid="history-refinement-tag"
              >
                {label}
              </span>
            )}
            <span className="truncate font-medium text-foreground text-sm">
              {job.request.prompt || '(无提示词)'}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
            <Badge
              variant={statusBadgeVariant(job.status)}
              className="px-1.5 py-0 text-[10px]"
              data-testid="history-row-status"
            >
              {STATUS_LABELS[job.status]}
            </Badge>
            {metaItems.map((item) => (
              <Fragment key={item.key}>
                <MetaDot />
                {item.node}
              </Fragment>
            ))}
          </span>
        </button>

        {/* 触屏常显;md+ hover/聚焦渐显(V25-UI-SPEC §8-I2)。 */}
        <div className="flex shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          {deletedView ? (
            <>
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
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                aria-label="永久删除"
                data-testid="history-row-purge"
                onClick={onPurge}
              >
                <Trash2 className="size-4" />
              </Button>
            </>
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
              {/* 重试只在宿主真会受理的记录上出现(失败且错误码可重试 / 已取消)。 */}
              {canRetry && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  data-testid="history-row-retry"
                  disabled={retryPending}
                  aria-busy={retryPending}
                  aria-label={retryPending ? '正在提交重试' : '重试生成'}
                  onClick={onRetry}
                >
                  <RotateCcw className="size-4" />
                </Button>
              )}
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
