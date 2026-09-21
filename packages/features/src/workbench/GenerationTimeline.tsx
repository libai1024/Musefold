'use client';

import type { GenerationAsset, GenerationJob, PromptReferenceSnapshot } from '@musefold/contracts';
import { canRetryGeneration } from '../history/error';
import { useCapabilities } from '@musefold/platform';
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
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  ImageIcon,
  ImageOff,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from '@musefold/ui/icons';
import { skipMotion } from '@musefold/ui/lib/motion';
import { cn } from '@musefold/ui/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { KeyGuidanceAction } from '../history/KeyGuidanceAction';
import { historyErrorPresentation } from '../history/error';
import { GenerationRecoveryNotice } from '../history/GenerationRecoveryNotice';
import { useCopyAssetToClipboard } from '../history/hooks';
import {
  jobToSavePromptSource,
  SavePromptDialog,
  type SavePromptSource,
} from '../prompts/SavePromptDialog';
import { assetSaveName, useSaveAsset } from './hooks';
import { turnMetaSegments, turnNumbers } from './turn-meta';

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
  return ratio && ratio !== 'auto' ? ratio.replace(':', ' / ') : '1 / 1';
}

/**
 * 结果网格(ui-parity 03 §2):1 张单列、2 张两列、4 张 2×2 —— 都由 grid-cols-2 承。
 * 骨架按同一排布用 `request.count` 占位,成图落位不跳版。
 */
function resultGridClass(count: number): string {
  return count > 1 ? 'grid grid-cols-2 gap-2' : 'grid gap-2';
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
  retryPending,
  parentTurn,
  onCancel,
  onRetry,
  onRequestRemove,
  onPreview,
  onEditMessage,
  onSavePrompt,
  onSaveAsset,
  onSaveAllAssets,
  onJumpToTurn,
  onOpenSettings,
}: {
  job: GenerationJob;
  /** 生成中禁用「编辑」(旧版语义:running 时不允许改稿重填)。 */
  editDisabled: boolean;
  retryPending: boolean;
  /** 父回合序号(有 parentRunId 且父回合在本会话时);null = 不显示「来自 #xx 微调」。 */
  parentTurn: number | null;
  onCancel(job: GenerationJob): void;
  onRetry(job: GenerationJob): void;
  onRequestRemove(job: GenerationJob): void;
  onPreview(job: GenerationJob, index: number, trigger: HTMLElement): void;
  onEditMessage(job: GenerationJob): void;
  /** 存为提示词;带资产时以该图为首图(封面)。 */
  onSavePrompt(job: GenerationJob, coverAsset?: GenerationAsset): void;
  onSaveAsset(asset: GenerationAsset): void;
  onSaveAllAssets(job: GenerationJob): void;
  onJumpToTurn(jobId: string): void;
  onOpenSettings?(): void;
}) {
  // 结果就位 reveal(03-C6):只在本次会话内经历「生成中→成图」的回合播;
  // 历史初载(挂载即 succeeded)不播,一次生成只 reveal 一次(类常驻,动画不重触发)。
  const sawActiveRef = useRef(ACTIVE.has(job.status));
  if (ACTIVE.has(job.status)) sawActiveRef.current = true;
  const reveal = sawActiveRef.current && job.status === 'succeeded' && job.assets.length > 0;
  // 用户原文(新任务可为空串 = 纯引用);旧任务回落 request.prompt。
  const userText = jobUserPromptText(job);
  const errorGuidance = historyErrorPresentation(job.error);

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
        {/* 参数 meta 行(03 §4):比例 · 质量 · 张数(>1)· 来源微调;纯引用任务(无气泡)不渲染。 */}
        {userText.trim().length > 0 && (
          <p
            className="flex flex-wrap items-center justify-end gap-1 text-muted-foreground text-xs tabular-nums"
            data-testid="job-meta"
          >
            <span>{turnMetaSegments(job).join(' · ')}</span>
            {parentTurn !== null && job.parentRunId && (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  className="rounded-sm underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/45"
                  data-testid="job-meta-parent"
                  onClick={() => onJumpToTurn(job.parentRunId as string)}
                >
                  来自 #{parentTurn} 微调
                </button>
              </>
            )}
          </p>
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

        {job.status === 'pending_approval' && (
          <div
            className="rounded-lg border border-border bg-muted/40 px-3 py-2"
            data-testid="job-approval-card"
          >
            <p className="text-muted-foreground text-xs">这次生成等待批准后才会进入队列。</p>
          </div>
        )}
        {job.status === 'rejected' && (
          <div
            className="rounded-lg border border-border bg-muted/40 px-3 py-2"
            data-testid="job-approval-rejected"
          >
            <p className="text-muted-foreground text-xs">这次生成未获批准。</p>
          </div>
        )}

        {ACTIVE.has(job.status) &&
          (job.request.count > 1 ? (
            <div
              className={cn(resultGridClass(job.request.count), 'w-full')}
              data-testid="job-placeholder-grid"
              data-count={job.request.count}
            >
              {Array.from({ length: job.request.count }, (_, index) => (
                <div
                  key={index}
                  className="overflow-hidden rounded-xl border border-border"
                  style={{ aspectRatio: skeletonAspectRatio(job) }}
                  data-testid="job-placeholder"
                >
                  <Skeleton className="size-full rounded-none" />
                </div>
              ))}
            </div>
          ) : (
            <div
              className="w-full max-w-xs overflow-hidden rounded-xl border border-border"
              style={{ aspectRatio: skeletonAspectRatio(job) }}
              data-testid="job-placeholder"
            >
              <Skeleton className="size-full rounded-none" />
            </div>
          ))}

        {job.error && (
          <div
            className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2"
            data-testid="job-error"
          >
            <p className="text-destructive text-xs">{errorGuidance?.title ?? job.error.message}</p>
            {errorGuidance ? (
              <KeyGuidanceAction
                guidance={errorGuidance}
                onOpenSettings={onOpenSettings}
                testId="job-error-action"
                recoveryJobId={job.id}
              />
            ) : null}
          </div>
        )}

        {job.assets.length > 0 && (
          <div
            className={resultGridClass(job.assets.length)}
            data-testid="job-asset-grid"
            data-count={job.assets.length}
          >
            {job.assets.map((asset, index) => {
              const multi = job.assets.length > 1;
              const imageRatio =
                asset.width && asset.height
                  ? `${asset.width} / ${asset.height}`
                  : skeletonAspectRatio(job);
              return (
                <div
                  key={asset.id}
                  className={cn(
                    'group/asset relative overflow-hidden rounded-xl border border-border bg-muted',
                    reveal && 'mf-workbench-result-reveal',
                  )}
                  style={reveal && index > 0 ? { animationDelay: `${index * 60}ms` } : undefined}
                  data-testid="job-asset-tile"
                >
                  <button
                    type="button"
                    className="block w-full transition-opacity hover:opacity-95 focus-visible:outline-2 focus-visible:outline-ring/45"
                    style={multi ? { aspectRatio: skeletonAspectRatio(job) } : undefined}
                    onClick={(event) => onPreview(job, index, event.currentTarget)}
                    aria-label={multi ? `放大预览第 ${index + 1} 张` : '放大预览'}
                    data-testid="job-asset"
                  >
                    <FadeImage
                      src={asset.url}
                      alt={jobPromptFallback(job).slice(0, 60)}
                      loading="lazy"
                      width={asset.width ?? undefined}
                      height={asset.height ?? undefined}
                      // Reserve geometry before lazy decoding; auto adopts the real image ratio.
                      style={multi ? undefined : { aspectRatio: `auto ${imageRatio}` }}
                      className={cn(
                        'w-full',
                        multi ? 'size-full object-cover' : 'max-h-96 object-contain',
                      )}
                    />
                  </button>
                  {/* 逐图动作(03 §2 结果网格):hover/focus 渐显常驻组,不藏进下拉菜单(§8-I2)。 */}
                  <div className="absolute top-1.5 right-1.5 flex items-center gap-1 transition-opacity md:opacity-0 md:group-focus-within/asset:opacity-100 md:group-hover/asset:opacity-100">
                    <Button
                      variant="secondary"
                      size="icon"
                      className="size-7 bg-background/85 backdrop-blur hover:bg-background"
                      aria-label={multi ? `保存第 ${index + 1} 张` : '保存图片'}
                      data-testid="job-asset-save"
                      onClick={() => onSaveAsset(asset)}
                    >
                      <Download className="size-3.5" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="size-7 bg-background/85 backdrop-blur hover:bg-background"
                      aria-label={
                        multi ? `以第 ${index + 1} 张为首图存为提示词` : '以该图为首图存为提示词'
                      }
                      data-testid="job-asset-save-prompt"
                      onClick={() => onSavePrompt(job, asset)}
                    >
                      <BookmarkPlus className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <GenerationRecoveryNotice job={job} />
        {!job.recovery && job.status === 'succeeded' && job.assets.length === 0 && (
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
            {job.status === 'succeeded' && job.assets.length === 1 && (
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
            {job.status === 'succeeded' && job.assets.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-muted-foreground text-xs hover:text-foreground"
                aria-label={`全部保存(${job.assets.length} 张)`}
                data-testid="job-save-all"
                onClick={() => onSaveAllAssets(job)}
              >
                <Download className="size-3.5" /> 全部保存
              </Button>
            )}
            {canRetryGeneration(job) && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label={retryPending ? '正在提交重试' : '重试生成'}
                disabled={retryPending}
                aria-busy={retryPending}
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

/** 时间线滚动容器底部留白(承旧 timeline-content,`<md`):悬浮 Composer 高度,不含软键盘。 */
const TIMELINE_MOBILE_BOTTOM_PX = 172;

export interface GenerationTimelineProps {
  jobs: readonly GenerationJob[];
  /** 会话存在进行中任务:用户消息「编辑」禁用。 */
  editDisabled?: boolean;
  isRetryPending?(id: string): boolean;
  /**
   * 软键盘 inset(px)。只由 Workbench 传入;
   * md+ / 无键盘时为 0,桌面仍走 Tailwind `md:pb-[220px]`。
   */
  keyboardInset?: number;
  /** Measured account-model panel height, added to the existing dock gap. */
  composerExtraInset?: number;
  onCancel(job: GenerationJob): void;
  onRetry(job: GenerationJob): void;
  onRemove(job: GenerationJob): void;
  /** 用户消息「编辑」:回填草稿并聚焦输入尾部(03 §4)。 */
  onEditMessage(job: GenerationJob): void;
  /** 「存为提示词」成功 toast「查看」的切屏回调(宿主注入,03/05 §7 共用链路)。 */
  onOpenPrompts?(): void;
  /** 密钥/连接引导切设置(宿主注入)。 */
  onOpenSettings?(): void;
}

/**
 * 会话生成时间线(V25-UI-SPEC §3.5):用户提示词右对齐、品牌助手帧左对齐。
 * 新回合/状态推进自动贴底;用户上滚超过 80px 暂停贴底,回底恢复;
 * 离底时底部悬浮「回到最新」pill(03 §4,承旧 useWorkbenchTimelineController)。
 */
export function GenerationTimeline({
  jobs,
  editDisabled = false,
  isRetryPending,
  keyboardInset = 0,
  composerExtraInset = 0,
  onCancel,
  onRetry,
  onRemove,
  onEditMessage,
  onOpenPrompts,
  onOpenSettings,
}: GenerationTimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastJobKeyRef = useRef('');
  // pill 显隐走 state(ref 不触发渲染);滚动意图仍以 ref 为准,避免渲染期读写竞态。
  const [pinned, setPinned] = useState(true);
  const [removeTarget, setRemoveTarget] = useState<GenerationJob | null>(null);
  // 灯箱指针存 {回合 id, 图序}:轮询刷新 job 对象后仍指向同一张,不定格旧快照。
  const [preview, setPreview] = useState<{ jobId: string; index: number } | null>(null);
  // 打开灯箱的图格:关闭后焦点归还它(§8-I9)。
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const [savePromptSource, setSavePromptSource] = useState<SavePromptSource | null>(null);
  const saveAsset = useSaveAsset();
  const copyAsset = useCopyAssetToClipboard();
  const canCopyAsset = useCapabilities().canRevealLocalFile;

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

  /**
   * 「全部保存」(03 §2):`saveAsset` 契约是单张,顺序调用并汇总 toast。
   * 桌面每张一次系统对话框——用户取消视为「停止后续」(不当错误),已保存的照实汇报。
   */
  async function handleSaveAllAssets(job: GenerationJob) {
    let saved = 0;
    for (const asset of job.assets) {
      try {
        const result = await saveAsset.mutateAsync({
          url: asset.url,
          name: assetSaveName(asset),
        });
        if (result !== 'saved') break;
        saved += 1;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '保存图片失败');
        break;
      }
    }
    if (saved === job.assets.length) toast.success(`已保存 ${saved} 张图片`);
    else if (saved > 0) toast.success(`已保存 ${saved} / ${job.assets.length} 张图片`);
  }

  /** 「复制图片」(桌面):把受管资产写进系统剪贴板;Web 不渲染入口(D2)。 */
  function handleCopyAsset(asset: GenerationAsset) {
    copyAsset.mutate(asset.id, {
      onSuccess: () => toast.success('图片已复制'),
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : '复制图片失败');
      },
    });
  }

  /** 「来自 #xx 微调」:滚到父回合(不改选中态,只做定位)。 */
  function jumpToTurn(jobId: string) {
    const target = viewportRef.current?.querySelector<HTMLElement>(`[data-testid="job-${jobId}"]`);
    if (!target) return;
    pinnedRef.current = false;
    setPinned(false);
    target.scrollIntoView({
      block: 'center',
      behavior: skipMotion() ? 'auto' : 'smooth',
    });
  }

  const turnNumberById = turnNumbers(jobs);
  const previewJob = preview ? (jobs.find((job) => job.id === preview.jobId) ?? null) : null;
  const previewCount = previewJob?.assets.length ?? 0;
  const previewIndex = preview ? Math.min(preview.index, Math.max(previewCount - 1, 0)) : 0;
  const previewAsset = previewJob?.assets[previewIndex] ?? null;

  // 05-C1 同款:预取相邻资产,方向键连翻不见白闪。
  useEffect(() => {
    if (!previewJob || typeof Image === 'undefined') return;
    for (const neighbor of [
      previewJob.assets[previewIndex - 1],
      previewJob.assets[previewIndex + 1],
    ]) {
      if (neighbor) new Image().src = neighbor.url;
    }
  }, [previewJob, previewIndex]);

  const lastJobKey = jobs.length > 0 ? `${jobs.length}:${jobs[jobs.length - 1]?.status}` : '';
  // 渲染期间同步滚动意图,commit 后贴底(避免依赖 effect 时序丢首帧)。
  if (lastJobKey !== lastJobKeyRef.current) {
    lastJobKeyRef.current = lastJobKey;
    if (pinnedRef.current) {
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (viewport && pinnedRef.current) viewport.scrollTop = viewport.scrollHeight;
      });
    }
  }

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (jobs.length === 0 || !viewport || !content || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [jobs.length]);

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
      {/* 底部留白承旧 timeline-content(172/220px)+软键盘 inset:内容可滚到悬浮 Composer 背后。 */}
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 pb-[172px] [--timeline-bottom:172px] md:pb-[220px] md:[--timeline-bottom:220px]"
        style={
          keyboardInset > 0
            ? {
                paddingBottom:
                  TIMELINE_MOBILE_BOTTOM_PX + keyboardInset + Math.max(0, composerExtraInset),
              }
            : composerExtraInset > 0
              ? { paddingBottom: `calc(var(--timeline-bottom) + ${composerExtraInset}px)` }
              : undefined
        }
        data-testid="timeline"
        data-keyboard-inset={Math.max(0, keyboardInset)}
        data-composer-extra-inset={Math.max(0, composerExtraInset)}
      >
        <div ref={contentRef} className="mx-auto flex w-full max-w-[728px] flex-col gap-6">
          {jobs.map((job) => (
            <JobTurn
              key={job.id}
              job={job}
              editDisabled={editDisabled}
              retryPending={isRetryPending?.(job.id) ?? false}
              parentTurn={
                job.parentRunId != null ? (turnNumberById.get(job.parentRunId) ?? null) : null
              }
              onCancel={onCancel}
              onRetry={onRetry}
              onRequestRemove={setRemoveTarget}
              onPreview={(target, index, trigger) => {
                previewTriggerRef.current = trigger;
                setPreview({ jobId: target.id, index });
              }}
              onEditMessage={onEditMessage}
              onSavePrompt={(target, coverAsset) =>
                setSavePromptSource({
                  ...jobToSavePromptSource(target),
                  ...(coverAsset ? { coverImageUrl: coverAsset.url } : {}),
                })
              }
              onSaveAsset={handleSaveAsset}
              onSaveAllAssets={handleSaveAllAssets}
              onJumpToTurn={jumpToTurn}
              onOpenSettings={onOpenSettings}
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
        open={previewJob !== null && previewAsset !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent
          className="max-w-[min(92vw,64rem)] p-2 sm:p-3"
          aria-describedby={undefined}
          data-testid="job-lightbox"
          onCloseAutoFocus={(event) => {
            // Esc / 点罩关闭都把焦点还给触发的图格(§8-I9);图格已随刷新消失则让位默认行为。
            const trigger = previewTriggerRef.current;
            if (!trigger?.isConnected) return;
            event.preventDefault();
            trigger.focus();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' && previewIndex > 0) {
              event.preventDefault();
              setPreview({ jobId: previewJob?.id ?? '', index: previewIndex - 1 });
            }
            if (event.key === 'ArrowRight' && previewJob && previewIndex < previewCount - 1) {
              event.preventDefault();
              setPreview({ jobId: previewJob.id, index: previewIndex + 1 });
            }
          }}
        >
          <DialogTitle className="sr-only">图片预览</DialogTitle>
          {previewJob && previewAsset && (
            <>
              <div className="relative flex items-center justify-center">
                {/* key 翻图重挂:FadeImage 独立淡入,连翻不残留上一张。 */}
                <FadeImage
                  key={previewAsset.id}
                  src={previewAsset.url}
                  alt={jobPromptFallback(previewJob).slice(0, 60)}
                  className="max-h-[80vh] w-full rounded-xl object-contain"
                  data-testid="lightbox-image"
                />
                {previewIndex > 0 && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="-translate-y-1/2 absolute top-1/2 left-2 size-8 rounded-full bg-background/80 backdrop-blur"
                    aria-label="上一张"
                    data-testid="lightbox-prev"
                    onClick={() => setPreview({ jobId: previewJob.id, index: previewIndex - 1 })}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                )}
                {previewIndex < previewCount - 1 && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="-translate-y-1/2 absolute top-1/2 right-2 size-8 rounded-full bg-background/80 backdrop-blur"
                    aria-label="下一张"
                    data-testid="lightbox-next"
                    onClick={() => setPreview({ jobId: previewJob.id, index: previewIndex + 1 })}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 px-1 pb-1">
                <p className="line-clamp-1 min-w-0 text-muted-foreground text-xs">
                  {jobPromptFallback(previewJob)}
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  {previewCount > 1 && (
                    <span
                      className="text-muted-foreground text-xs tabular-nums"
                      data-testid="lightbox-counter"
                    >
                      {previewIndex + 1} / {previewCount}
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    data-testid="lightbox-copy-prompt"
                    onClick={() => void copyPrompt(jobCopyablePromptText(previewJob))}
                  >
                    <Copy className="size-3.5" /> 复制提示词
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    data-testid="lightbox-save-asset"
                    onClick={() => handleSaveAsset(previewAsset)}
                  >
                    <Download className="size-3.5" /> 保存图片
                  </Button>
                  {canCopyAsset && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      data-testid="lightbox-copy-asset"
                      onClick={() => handleCopyAsset(previewAsset)}
                    >
                      <ImageIcon className="size-3.5" /> 复制图片
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
