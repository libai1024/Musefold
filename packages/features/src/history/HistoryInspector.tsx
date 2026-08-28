'use client';

import type { GenerationJob } from '@musefold/contracts';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import { Separator } from '@musefold/ui/components/separator';
import {
  Check,
  Copy,
  MessageSquare,
  RotateCcw,
  Square,
  Trash2,
  Undo2,
  X,
} from '@musefold/ui/icons';
import { useEffect, useState } from 'react';
import {
  formatDateTime,
  formatDuration,
  isActiveStatus,
  STATUS_LABELS,
  statusBadgeVariant,
} from './format';

function CopyButton({ text, label, testId }: { text: string; label: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={label}
      data-testid={testId}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  );
}

export interface HistoryInspectorProps {
  job: GenerationJob;
  onClose(): void;
  onCancel(): void;
  onRetry(): void;
  onRemove(): void;
  onRestore(): void;
  /** 跳到所属会话(宿主注入导航);无 sessionId 时不展示入口。 */
  onOpenSession?(sessionId: string): void;
}

/** 历史详情面板(V25-UI-SPEC §5.1):lg+ 内嵌右栏,窄屏由 Screen 装入 Sheet。 */
export function HistoryInspector({
  job,
  onClose,
  onCancel,
  onRetry,
  onRemove,
  onRestore,
  onOpenSession,
}: HistoryInspectorProps) {
  const asset = job.assets[0];
  const deleted = job.deletedAt != null;
  const active = isActiveStatus(job.status);
  const duration = formatDuration(job);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="history-inspector">
      <div className="flex items-center gap-2 border-border border-b px-4 py-2.5">
        <Badge variant={statusBadgeVariant(job.status)} className="px-1.5 py-0 text-[10px]">
          {STATUS_LABELS[job.status]}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          {formatDateTime(job.createdAt)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="关闭详情"
          data-testid="history-inspector-close"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {asset && (
          <div className="overflow-hidden rounded-lg border border-border bg-muted">
            <img
              src={asset.url}
              alt={job.request.prompt}
              className="max-h-80 w-full object-contain"
              data-testid="history-inspector-image"
            />
          </div>
        )}
        {job.error && (
          <p
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs"
            data-testid="history-inspector-error"
          >
            {job.error.message}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-muted-foreground text-xs">提示词</span>
            <CopyButton
              text={job.request.prompt}
              label="复制提示词"
              testId="history-inspector-copy-prompt"
            />
          </div>
          <p
            className="whitespace-pre-wrap break-words text-foreground text-sm"
            data-testid="history-inspector-prompt"
          >
            {job.request.prompt}
          </p>
        </div>

        {job.request.negative && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-muted-foreground text-xs">反向提示词</span>
              <CopyButton
                text={job.request.negative}
                label="复制反向提示词"
                testId="history-inspector-copy-negative"
              />
            </div>
            <p className="whitespace-pre-wrap break-words text-muted-foreground text-sm">
              {job.request.negative}
            </p>
          </div>
        )}

        <Separator />

        <div className="flex flex-col gap-1.5" data-testid="history-inspector-params">
          {job.providerModel && <ParamRow label="模型" value={job.providerModel} />}
          <ParamRow label="比例" value={job.request.aspectRatio ?? '自动'} />
          <ParamRow label="质量" value={job.request.quality ?? '自动'} />
          {asset && <ParamRow label="尺寸" value={`${asset.width}×${asset.height}`} />}
          {duration && <ParamRow label="耗时" value={duration} />}
          {job.costPoints != null && <ParamRow label="消耗点数" value={String(job.costPoints)} />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-border border-t px-4 py-3">
        {deleted ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            data-testid="history-inspector-restore"
            onClick={onRestore}
          >
            <Undo2 className="size-3.5" /> 恢复
          </Button>
        ) : (
          <>
            {active ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                data-testid="history-inspector-cancel"
                onClick={onCancel}
              >
                <Square className="size-3.5" /> 取消生成
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                data-testid="history-inspector-retry"
                onClick={onRetry}
              >
                <RotateCcw className="size-3.5" /> 重试
              </Button>
            )}
            {job.sessionId && onOpenSession && (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                data-testid="history-inspector-open-session"
                onClick={() => onOpenSession(job.sessionId as string)}
              >
                <MessageSquare className="size-3.5" /> 查看会话
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto gap-1.5 text-muted-foreground hover:text-destructive"
              data-testid="history-inspector-remove"
              onClick={onRemove}
            >
              <Trash2 className="size-3.5" /> 移入回收站
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
