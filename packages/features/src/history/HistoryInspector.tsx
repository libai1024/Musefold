'use client';

import type { GenerationJob } from '@musefold/contracts';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import { FadeImage } from '@musefold/ui/components/fade-image';
import { Separator } from '@musefold/ui/components/separator';
import {
  BookmarkPlus,
  Check,
  Copy,
  CornerDownRight,
  Download,
  FolderOpen,
  ImageIcon,
  MessageSquare,
  RotateCcw,
  Square,
  Trash2,
  Undo2,
  X,
} from '@musefold/ui/icons';
import { useEffect, useState } from 'react';
import { canRetryGeneration, historyErrorPresentation } from './error';
import {
  formatCostPoints,
  formatDateTime,
  formatDuration,
  formatFullDateTime,
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
      <span className="truncate text-foreground tabular-nums">{value}</span>
    </div>
  );
}

/** 谱系节点(承旧 HistoryLineagePanel 的可点跳行)。 */
function LineageNode({
  job,
  label,
  child,
  onSelect,
}: {
  job: GenerationJob;
  label: string;
  child: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-muted"
      onClick={onSelect}
      title={job.request.prompt}
      data-testid="history-lineage-node"
      data-job-id={job.id}
    >
      {child && <CornerDownRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-[11px] text-foreground">{label}</span>
        <span className="block truncate text-[10px] text-muted-foreground tabular-nums">
          {job.request.prompt || '(无提示词)'}
        </span>
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
        {formatDateTime(job.createdAt)}
      </span>
    </button>
  );
}

export interface HistoryInspectorProps {
  job: GenerationJob;
  onClose(): void;
  onCancel(): void;
  onRetry(): void;
  onRemove(): void;
  onRestore(): void;
  /** 「存为提示词」(03/05 §7 共用链路):Dialog 由 Screen 层持有。 */
  onSavePrompt(): void;
  /** 「保存图片」(05 §3):mutation 与 toast 由 Screen 层持有(Lightbox 复用)。 */
  onSaveAsset(): void;
  /** 检视图点击放大(05 §7 Lightbox);未注入(无成图)时图不可点。 */
  onOpenLightbox?(): void;
  /** 跳到所属会话(宿主注入导航);无 sessionId 时不展示入口。 */
  onOpenSession?(sessionId: string): void;
  /** 桌面文件操作(05 §7):按 capabilities.canRevealLocalFile 门控注入,Web 不渲染。 */
  onRevealAsset?(): void;
  onCopyAsset?(): void;
  /** 谱系区(05 §7):父记录与直接子记录;点击切换选中(由 Screen 层解析当前结果集)。 */
  parentJob?: GenerationJob | null;
  childJobs?: readonly GenerationJob[];
  /** 有 parentRunId 但父记录不在结果集里(已删除或被筛掉)。 */
  orphan?: boolean;
  onSelectJob?(id: string): void;
}

/** 历史详情面板(V25-UI-SPEC §5.1):lg+ 内嵌右栏,窄屏由 Screen 装入 Sheet。 */
export function HistoryInspector({
  job,
  onClose,
  onCancel,
  onRetry,
  onRemove,
  onRestore,
  onSavePrompt,
  onSaveAsset,
  onOpenLightbox,
  onOpenSession,
  onRevealAsset,
  onCopyAsset,
  parentJob = null,
  childJobs = [],
  orphan = false,
  onSelectJob,
}: HistoryInspectorProps) {
  const asset = job.assets[0];
  const deleted = job.deletedAt != null;
  const active = isActiveStatus(job.status);
  const duration = formatDuration(job);
  const cost = formatCostPoints(job.costPoints);
  const error = historyErrorPresentation(job.error);
  const canRetry = canRetryGeneration(job);
  const showLineage = Boolean(parentJob) || childJobs.length > 0 || orphan;
  // 归一标题掩盖了上游原文时把原始码/文案作为诊断行补回;标题已是原文则不重复。
  const errorDetails =
    job.error && job.error.message !== error?.title
      ? [job.error.code, job.error.message].filter(Boolean).join(' · ')
      : null;

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
        {asset &&
          (onOpenLightbox ? (
            <button
              type="button"
              className="overflow-hidden rounded-xl border border-border bg-muted transition-opacity hover:opacity-95"
              onClick={onOpenLightbox}
              aria-label="放大预览"
              data-testid="history-inspector-image-open"
            >
              <FadeImage
                src={asset.url}
                alt={job.request.prompt}
                className="max-h-80 w-full object-contain"
                data-testid="history-inspector-image"
              />
            </button>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-muted">
              <FadeImage
                src={asset.url}
                alt={job.request.prompt}
                className="max-h-80 w-full object-contain"
                data-testid="history-inspector-image"
              />
            </div>
          ))}
        {error && (
          <div
            className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
            data-testid="history-inspector-error"
          >
            <p className="font-medium text-destructive text-xs">{error.title}</p>
            <p className="text-muted-foreground text-xs leading-snug">{error.hint}</p>
            {error.action && (
              <p
                className="font-medium text-[11px] text-foreground"
                data-testid="history-detail-error-action"
              >
                建议:{error.action}
              </p>
            )}
            {/* 原始错误码 + 上游文案留作诊断线索(承旧 details),标题已归一时也不丢。 */}
            {errorDetails && (
              <p
                className="break-words text-[10px] text-muted-foreground"
                data-testid="history-inspector-error-details"
              >
                {errorDetails}
              </p>
            )}
          </div>
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

        {/* 参数区(承旧 HistoryDetail):模型/尺寸/比例/质量/种子/成本/用时/创建时间。 */}
        <div className="flex flex-col gap-1.5" data-testid="history-inspector-params">
          {job.providerModel && <ParamRow label="模型" value={job.providerModel} />}
          <ParamRow
            label="尺寸"
            value={asset ? `${asset.width}×${asset.height}` : (job.request.size ?? '自动')}
          />
          <ParamRow label="比例" value={job.request.aspectRatio ?? '自动'} />
          <ParamRow label="质量" value={job.request.quality ?? '自动'} />
          {job.seed != null && <ParamRow label="种子" value={String(job.seed)} />}
          {cost && <ParamRow label="成本" value={cost} />}
          {duration && <ParamRow label="用时" value={duration} />}
          <ParamRow label="创建时间" value={formatFullDateTime(job.createdAt)} />
        </div>

        {showLineage && (
          <>
            <Separator />
            <div className="flex flex-col gap-1.5" data-testid="history-lineage">
              <span className="font-medium text-muted-foreground text-xs">微调链</span>
              {orphan && (
                <p
                  className="text-[11px] text-muted-foreground leading-snug"
                  data-testid="history-lineage-missing-parent"
                >
                  微调(来源记录已删除)
                </p>
              )}
              <div className="overflow-hidden rounded-md border border-border">
                {parentJob && onSelectJob && (
                  <LineageNode
                    job={parentJob}
                    label="来自"
                    child={false}
                    onSelect={() => onSelectJob(parentJob.id)}
                  />
                )}
                {childJobs.length > 0 && (
                  <p className="border-border border-t bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground first:border-t-0">
                    派生 {childJobs.length} 条
                  </p>
                )}
                {onSelectJob &&
                  childJobs.map((child, index) => (
                    <LineageNode
                      key={child.id}
                      job={child}
                      label={`微调 ${index + 1}`}
                      child
                      onSelect={() => onSelectJob(child.id)}
                    />
                  ))}
              </div>
            </div>
          </>
        )}
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
              canRetry && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  data-testid="history-inspector-retry"
                  onClick={onRetry}
                >
                  <RotateCcw className="size-3.5" /> 重试
                </Button>
              )
            )}
            {job.status === 'succeeded' && (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                data-testid="history-inspector-save-prompt"
                onClick={onSavePrompt}
              >
                <BookmarkPlus className="size-3.5" /> 存为提示词
              </Button>
            )}
            {job.status === 'succeeded' && asset && (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                data-testid="history-inspector-save-asset"
                onClick={onSaveAsset}
              >
                <Download className="size-3.5" /> 保存图片
              </Button>
            )}
            {asset && onRevealAsset && (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                data-testid="history-inspector-reveal-asset"
                onClick={onRevealAsset}
              >
                <FolderOpen className="size-3.5" /> 在文件夹中显示
              </Button>
            )}
            {asset && onCopyAsset && (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground"
                data-testid="history-inspector-copy-asset"
                onClick={onCopyAsset}
              >
                <ImageIcon className="size-3.5" /> 复制图片
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
