'use client';

import type { GenerationJob } from '@musefold/contracts';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import { Spinner } from '@musefold/ui/components/spinner';
import { ImageOff, RotateCcw, Sparkles, X } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useEffect, useRef } from 'react';

const STATUS_LABELS: Record<GenerationJob['status'], string> = {
  pending_approval: '待审批',
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelling: '取消中',
  cancelled: '已取消',
  rejected: '已拒绝',
  expired: '已过期',
};

const ACTIVE = new Set<GenerationJob['status']>(['pending_approval', 'queued', 'running']);
const RETRYABLE = new Set<GenerationJob['status']>(['failed', 'cancelled', 'expired']);

function JobStatusBadge({ status }: { status: GenerationJob['status'] }) {
  const active = ACTIVE.has(status);
  return (
    <Badge
      variant={status === 'failed' ? 'destructive' : active ? 'default' : 'secondary'}
      data-testid="job-status"
      data-status={status}
      className="gap-1"
    >
      {active && <Spinner className="size-3" />}
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function JobTurn({
  job,
  onCancel,
  onRetry,
}: {
  job: GenerationJob;
  onCancel(job: GenerationJob): void;
  onRetry(job: GenerationJob): void;
}) {
  return (
    <article className="flex flex-col gap-2" data-testid={`job-${job.id}`}>
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-primary-foreground text-sm">
        <p className="whitespace-pre-wrap break-words">{job.request.prompt}</p>
      </div>

      <div className="mr-auto flex w-full max-w-[85%] flex-col gap-2">
        <div className="flex items-center gap-2">
          <span
            className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground"
            aria-hidden
          >
            <Sparkles className="size-3.5" />
          </span>
          <JobStatusBadge status={job.status} />
          {job.providerModel && (
            <span className="text-[11px] text-muted-foreground">{job.providerModel}</span>
          )}
          {ACTIVE.has(job.status) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-muted-foreground text-xs"
              onClick={() => onCancel(job)}
              data-testid="job-cancel"
            >
              <X className="size-3" /> 取消
            </Button>
          )}
          {RETRYABLE.has(job.status) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-muted-foreground text-xs"
              onClick={() => onRetry(job)}
              data-testid="job-retry"
            >
              <RotateCcw className="size-3" /> 重试
            </Button>
          )}
        </div>

        {job.error && (
          <p
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs"
            data-testid="job-error"
          >
            {job.error.message}
          </p>
        )}

        {job.assets.length > 0 && (
          <div className={cn('grid gap-2', job.assets.length > 1 && 'grid-cols-2')}>
            {job.assets.map((asset) => (
              <img
                key={asset.id}
                src={asset.url}
                alt={job.request.prompt.slice(0, 60)}
                loading="lazy"
                data-testid="job-asset"
                className="max-h-96 w-full rounded-lg border border-border object-contain"
              />
            ))}
          </div>
        )}

        {job.status === 'succeeded' && job.assets.length === 0 && (
          <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <ImageOff className="size-3.5" aria-hidden /> 图片文件缺失
          </p>
        )}
      </div>
    </article>
  );
}

export interface GenerationTimelineProps {
  jobs: readonly GenerationJob[];
  onCancel(job: GenerationJob): void;
  onRetry(job: GenerationJob): void;
}

/** 会话生成时间线:用户提示词右对齐、结果左对齐(承旧 chat 形态)。 */
export function GenerationTimeline({ jobs, onCancel, onRetry }: GenerationTimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastJobKey = jobs.length > 0 ? `${jobs.length}:${jobs[jobs.length - 1]?.status}` : '';

  // 新 turn 或状态推进时贴底。可选调用:jsdom 等环境无 scrollIntoView。
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastJobKey 变化才是滚动时机
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [lastJobKey]);

  if (jobs.length === 0) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground"
        data-testid="timeline-empty"
      >
        <Sparkles className="size-8" aria-hidden />
        <p className="text-sm">输入提示词,开始第一次生成</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4" data-testid="timeline">
      {jobs.map((job) => (
        <JobTurn key={job.id} job={job} onCancel={onCancel} onRetry={onRetry} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
