'use client';

import type { GenerationAsset, GenerationJob, PromptReferenceSnapshot } from '@musefold/contracts';
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
import { Badge } from '@musefold/ui/components/badge';
import { MusefoldMark } from '@musefold/ui/components/brand-mark';
import { Button } from '@musefold/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@musefold/ui/components/dialog';
import { FadeImage } from '@musefold/ui/components/fade-image';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { toast } from '@musefold/ui/components/sonner';
import { Spinner } from '@musefold/ui/components/spinner';
import {
  ArrowDown,
  BookmarkPlus,
  Copy,
  Download,
  FileText,
  ImageOff,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from '@musefold/ui/icons';
import { skipMotion } from '@musefold/ui/lib/motion';
import { cn } from '@musefold/ui/lib/utils';
import { useRef, useState } from 'react';
import {
  jobToSavePromptSource,
  SavePromptDialog,
  type SavePromptSource,
} from '../prompts/SavePromptDialog';
import { assetSaveName, useSaveAsset } from './hooks';

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
/** 终态回合展示动作行(复制提示词/重试/删除,V25-UI-SPEC §3.5)。 */
const SETTLED = new Set<GenerationJob['status']>([
  'succeeded',
  'failed',
  'cancelled',
  'rejected',
  'expired',
]);

/** 骨架占位格的宽高比:承契约 aspectRatio 预设,auto 按方形占位。 */
function skeletonAspectRatio(job: GenerationJob): string {
  const ratio = job.request.aspectRatio;
  return ratio ? ratio.replace(':', ' / ') : '1 / 1';
}

function JobStatusBadge({ status }: { status: GenerationJob['status'] }) {
  const active = ACTIVE.has(status) || status === 'cancelling';
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

/**
 * 用户原始文本:新任务一律以 `job.userPrompt`(宿主合成前的原文)为准,
 * 可能为空串(纯引用任务);旧任务没有该字段,回落 `job.request.prompt`(当时未合成,即原文)。
 * 绝不把宿主合成后的 provider prompt 当用户文本展示。
 */
export function jobUserPromptText(job: GenerationJob): string {
  return job.userPrompt ?? job.request.prompt;
}

/** 复制语义:优先原文;纯引用任务原文为空时,复制冻结引用正文(参考感知回落,不取合成稿)。 */
export function jobCopyablePromptText(job: GenerationJob): string {
  const raw = jobUserPromptText(job);
  if (raw.trim().length > 0) return raw;
  return job.promptReferences.map((reference) => reference.text).join('\n\n');
}

/** 图片 alt / 灯箱提示行:原文优先;纯引用任务用中性的参考感知回落(引用标题,非合成稿)。 */
export function jobPromptFallback(job: GenerationJob): string {
  const raw = jobUserPromptText(job).trim();
  if (raw) return jobUserPromptText(job);
  if (job.promptReferences.length > 0) {
    return `引用提示词：${job.promptReferences.map((reference) => reference.title).join('、')}`;
  }
  return job.request.prompt;
}

async function copyPrompt(prompt: string) {
  try {
    await navigator.clipboard.writeText(prompt);
    toast.success('已复制提示词');
  } catch {
    toast.error('复制失败,剪贴板不可用');
  }
}

/**
 * 时间线引用卡(不可变快照):title/text 是生成发生时的冻结内容,不随源记录编辑漂移;
 * promptId 为 null 仅表示源已被历史硬删除。点击展开/收起全文(可检视)。
 */
function JobPromptReference({ reference }: { reference: PromptReferenceSnapshot }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="rounded-lg border border-border bg-muted/30 p-2.5"
      data-testid="job-prompt-reference"
      data-scope={reference.scope}
    >
      <div className="flex items-center gap-1.5">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate font-medium text-foreground text-xs">
          {reference.title}
        </span>
        <Badge variant="secondary" className="ml-auto shrink-0 px-1.5 text-[11px]">
          {reference.scope === 'full' ? '整条' : '选中片段'}
        </Badge>
      </div>
      <button
        type="button"
        className="mt-1 block w-full rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring/45"
        aria-expanded={expanded}
        aria-label={
          expanded ? `收起引用全文:${reference.title}` : `查看引用全文:${reference.title}`
        }
        data-testid="job-prompt-reference-toggle"
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          className={cn(
            'block whitespace-pre-wrap break-words text-muted-foreground text-xs',
            !expanded && 'line-clamp-2',
          )}
          data-testid="job-prompt-reference-text"
        >
          {reference.text}
        </span>
      </button>
      {reference.promptId === null && (
        <p className="pt-0.5 text-[11px] text-muted-foreground/80">源提示词已删除</p>
      )}
    </div>
  );
}

function JobTurn({
  job,
  editDisabled,
  onCancel,
  onRetry,
  onRequestRemove,
  onPreview,
  onEditMessage,
  onSavePrompt,
  onSaveAsset,
}: {
  job: GenerationJob;
  /** 生成中禁用「编辑」(旧版语义:running 时不允许改稿重填)。 */
  editDisabled: boolean;
  onCancel(job: GenerationJob): void;
  onRetry(job: GenerationJob): void;
  onRequestRemove(job: GenerationJob): void;
  onPreview(job: GenerationJob, asset: GenerationAsset): void;
  onEditMessage(job: GenerationJob): void;
  onSavePrompt(job: GenerationJob): void;
  onSaveAsset(asset: GenerationAsset): void;
}) {
  // 结果就位 reveal(03-C6):只在本次会话内经历「生成中→成图」的回合播;
  // 历史初载(挂载即 succeeded)不播,一次生成只 reveal 一次(类常驻,动画不重触发)。
  const sawActiveRef = useRef(ACTIVE.has(job.status));
  if (ACTIVE.has(job.status)) sawActiveRef.current = true;
  const reveal = sawActiveRef.current && job.status === 'succeeded' && job.assets.length > 0;
  // 用户原文(新任务可为空串 = 纯引用);旧任务回落 request.prompt。
  const userText = jobUserPromptText(job);

  return (
    <article
      className="mf-workbench-bubble-in group flex flex-col gap-2"
      data-testid={`job-${job.id}`}
    >
      {job.request.referenceImages.length > 0 && (
        <div
          className="ml-auto flex max-w-[85%] flex-wrap justify-end gap-1.5"
          data-testid="job-references"
        >
          {job.request.referenceImages.map((reference) => (
            <FadeImage
              key={reference.id}
              src={reference.url}
              alt={reference.name}
              title={reference.name}
              loading="lazy"
              className="size-12 rounded-md border border-border bg-muted object-cover"
            />
          ))}
        </div>
      )}
      {/* 用户消息 + 动作组(03 §4):旧版「点击激活」升级为 hover/focus 渐显常驻组(§8-I2 口径,与助手动作行同构)。
          不可变引用快照随用户消息展示(冻结原文,可检视);纯引用任务无气泡。 */}
      <div className="group/user ml-auto flex max-w-[85%] flex-col items-end gap-1">
        {job.promptReferences.length > 0 && (
          <div className="flex w-full flex-col gap-1.5" data-testid="job-prompt-references">
            {job.promptReferences.map((reference, index) => (
              <JobPromptReference
                key={`${reference.promptId ?? 'deleted'}-${index}`}
                reference={reference}
              />
            ))}
          </div>
        )}
        {userText.trim().length > 0 && (
          <div className="rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-primary-foreground text-sm">
            <p className="whitespace-pre-wrap break-words">{userText}</p>
          </div>
        )}
        <div className="flex items-center gap-0.5 transition-opacity md:opacity-0 md:group-focus-within/user:opacity-100 md:group-hover/user:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label="复制消息"
            data-testid="job-copy-message"
            onClick={() => void copyPrompt(jobCopyablePromptText(job))}
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label="编辑消息"
            title={editDisabled ? '生成中不可编辑' : '编辑消息(回填到输入框)'}
            disabled={editDisabled}
            data-testid="job-edit-message"
            onClick={() => onEditMessage(job)}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mr-auto flex w-full max-w-[85%] flex-col gap-2">
        <div className="flex items-center gap-2">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
            role="img"
            aria-label="Musefold"
          >
            <MusefoldMark className="size-3.5" aria-hidden />
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
        </div>

        {ACTIVE.has(job.status) && (
          <div
            className="w-full max-w-xs overflow-hidden rounded-xl border border-border"
            style={{ aspectRatio: skeletonAspectRatio(job) }}
            data-testid="job-placeholder"
          >
            <Skeleton className="size-full rounded-none" />
          </div>
        )}

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
            {job.assets.map((asset, index) => (
              <button
                key={asset.id}
                type="button"
                className={cn(
                  'overflow-hidden rounded-xl border border-border bg-muted transition-opacity hover:opacity-95',
                  reveal && 'mf-workbench-result-reveal',
                )}
                style={reveal && index > 0 ? { animationDelay: `${index * 60}ms` } : undefined}
                onClick={() => onPreview(job, asset)}
                aria-label="放大预览"
                data-testid="job-asset"
              >
                <FadeImage
                  src={asset.url}
                  alt={jobPromptFallback(job).slice(0, 60)}
                  loading="lazy"
                  className="max-h-96 w-full object-contain"
                />
              </button>
            ))}
          </div>
        )}

        {job.status === 'succeeded' && job.assets.length === 0 && (
          <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <ImageOff className="size-3.5" aria-hidden /> 图片文件缺失
          </p>
        )}

        {SETTLED.has(job.status) && (
          <div className="flex items-center gap-0.5 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              aria-label="复制提示词"
              data-testid="job-copy-prompt"
              onClick={() => void copyPrompt(jobCopyablePromptText(job))}
            >
              <Copy className="size-3.5" />
            </Button>
            {job.status === 'succeeded' && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label="存为提示词"
                data-testid="job-save-prompt"
                onClick={() => onSavePrompt(job)}
              >
                <BookmarkPlus className="size-3.5" />
              </Button>
            )}
            {job.status === 'succeeded' && job.assets.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label="保存图片"
                data-testid="job-save-asset"
                onClick={() => {
                  const first = job.assets[0];
                  if (first) onSaveAsset(first);
                }}
              >
                <Download className="size-3.5" />
              </Button>
            )}
            {(RETRYABLE.has(job.status) || job.status === 'succeeded') && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label="重试生成"
                data-testid="job-retry"
                onClick={() => onRetry(job)}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              aria-label="删除回合"
              data-testid="job-remove"
              onClick={() => onRequestRemove(job)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

export interface GenerationTimelineProps {
  jobs: readonly GenerationJob[];
  /** 会话存在进行中任务:用户消息「编辑」禁用。 */
  editDisabled?: boolean;
  onCancel(job: GenerationJob): void;
  onRetry(job: GenerationJob): void;
  onRemove(job: GenerationJob): void;
  /** 用户消息「编辑」:回填草稿并聚焦输入尾部(03 §4)。 */
  onEditMessage(job: GenerationJob): void;
  /** 「存为提示词」成功 toast「查看」的切屏回调(宿主注入,03/05 §7 共用链路)。 */
  onOpenPrompts?(): void;
}

/**
 * 会话生成时间线(V25-UI-SPEC §3.5):用户提示词右对齐、品牌助手帧左对齐。
 * 新回合/状态推进自动贴底;用户上滚超过 80px 暂停贴底,回底恢复;
 * 离底时底部悬浮「回到最新」pill(03 §4,承旧 useWorkbenchTimelineController)。
 */
export function GenerationTimeline({
  jobs,
  editDisabled = false,
  onCancel,
  onRetry,
  onRemove,
  onEditMessage,
  onOpenPrompts,
}: GenerationTimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastJobKeyRef = useRef('');
  // pill 显隐走 state(ref 不触发渲染);滚动意图仍以 ref 为准,避免渲染期读写竞态。
  const [pinned, setPinned] = useState(true);
  const [removeTarget, setRemoveTarget] = useState<GenerationJob | null>(null);
  const [preview, setPreview] = useState<{ job: GenerationJob; asset: GenerationAsset } | null>(
    null,
  );
  const [savePromptSource, setSavePromptSource] = useState<SavePromptSource | null>(null);
  const saveAsset = useSaveAsset();

  /** 保存图片(03 §5):桌面走系统对话框(取消不提示),Web 走浏览器下载。 */
  function handleSaveAsset(asset: GenerationAsset) {
    saveAsset.mutate(
      { url: asset.url, name: assetSaveName(asset) },
      {
        onSuccess: (result) => {
          if (result === 'saved') toast.success('图片已保存');
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : '保存图片失败');
        },
      },
    );
  }

  const lastJobKey = jobs.length > 0 ? `${jobs.length}:${jobs[jobs.length - 1]?.status}` : '';
  // 渲染期间同步滚动意图,commit 后贴底(避免依赖 effect 时序丢首帧)。
  if (lastJobKey !== lastJobKeyRef.current) {
    lastJobKeyRef.current = lastJobKey;
    if (pinnedRef.current) {
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      });
    }
  }

  function handleScroll() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const next = distance <= 80;
    pinnedRef.current = next;
    setPinned(next);
  }

  function scrollToLatest() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    pinnedRef.current = true;
    setPinned(true);
    if (typeof viewport.scrollTo === 'function') {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: skipMotion() ? 'auto' : 'smooth',
      });
    } else {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }

  if (jobs.length === 0) {
    return null;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 底部留白承旧 timeline-content(172/220px):内容可滚到悬浮 Composer 背后而不被遮住。 */}
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 pb-[172px] md:pb-[220px]"
        data-testid="timeline"
      >
        <div className="mx-auto flex w-full max-w-[728px] flex-col gap-6">
          {jobs.map((job) => (
            <JobTurn
              key={job.id}
              job={job}
              editDisabled={editDisabled}
              onCancel={onCancel}
              onRetry={onRetry}
              onRequestRemove={setRemoveTarget}
              onPreview={(target, asset) => setPreview({ job: target, asset })}
              onEditMessage={onEditMessage}
              onSavePrompt={(target) => setSavePromptSource(jobToSavePromptSource(target))}
              onSaveAsset={handleSaveAsset}
            />
          ))}
        </div>
      </div>

      {!pinned && (
        <Button
          variant="outline"
          size="sm"
          className="-translate-x-1/2 absolute bottom-40 left-1/2 z-10 h-7 gap-1 rounded-full bg-background/95 px-3 text-xs shadow-sm backdrop-blur md:bottom-[188px]"
          onClick={scrollToLatest}
          data-testid="timeline-back-to-latest"
        >
          <ArrowDown className="size-3.5" /> 回到最新
        </Button>
      )}

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个回合？</AlertDialogTitle>
            <AlertDialogDescription>
              生成记录将移入历史回收站,可在生成历史中恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="job-remove-confirm"
              onClick={() => {
                if (removeTarget) onRemove(removeTarget);
                setRemoveTarget(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SavePromptDialog
        source={savePromptSource}
        onOpenChange={(open) => {
          if (!open) setSavePromptSource(null);
        }}
        onOpenPrompts={onOpenPrompts}
      />

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent
          className="max-w-[min(92vw,64rem)] p-2 sm:p-3"
          aria-describedby={undefined}
          data-testid="job-lightbox"
        >
          <DialogTitle className="sr-only">图片预览</DialogTitle>
          {preview && (
            <>
              <FadeImage
                src={preview.asset.url}
                alt={jobPromptFallback(preview.job).slice(0, 60)}
                className="max-h-[80vh] w-full rounded-xl object-contain"
              />
              <div className="flex items-center justify-between gap-3 px-1 pb-1">
                <p className="line-clamp-1 min-w-0 text-muted-foreground text-xs">
                  {jobPromptFallback(preview.job)}
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    data-testid="lightbox-copy-prompt"
                    onClick={() => void copyPrompt(jobCopyablePromptText(preview.job))}
                  >
                    <Copy className="size-3.5" /> 复制提示词
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    data-testid="lightbox-save-asset"
                    onClick={() => handleSaveAsset(preview.asset)}
                  >
                    <Download className="size-3.5" /> 保存图片
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
