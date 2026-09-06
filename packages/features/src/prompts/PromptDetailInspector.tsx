'use client';

import type { GenerationJob, PromptDocument } from '@musefold/contracts';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@musefold/ui/components/dropdown-menu';
import { Separator } from '@musefold/ui/components/separator';
import {
  Check,
  Copy,
  MoreHorizontal,
  PanelRightClose,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Sparkles,
  Trash2,
} from '@musefold/ui/icons';
import { useEffect, useState } from 'react';
import { promptDateTime, promptRelativeTime, promptSourceLabel } from './format';
import { PromptCover } from './PromptListRow';
import { PromptRelatedWorks } from './PromptRelatedWorks';

/** 复制钮:Copy → Check 1.2s(与行内复制同一时长口径),toast 由调用方负责。 */
function CopyButton({
  text,
  label,
  testId,
  onCopied,
}: {
  text: string;
  label: string;
  testId: string;
  onCopied?(): void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_200);
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
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          onCopied?.();
        });
      }}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-foreground tabular-nums">{value}</span>
    </div>
  );
}

export interface PromptDetailInspectorProps {
  prompt: PromptDocument;
  onClose(): void;
  onUse(prompt: PromptDocument): void;
  onEdit(prompt: PromptDocument): void;
  onCopy(prompt: PromptDocument): void;
  onTogglePin(prompt: PromptDocument): void;
  onRemove(prompt: PromptDocument): void;
  onRestore(prompt: PromptDocument): void;
  /** 相关作品缩略点击 → 跳历史屏并选中该回合;宿主未接切屏时省略(缩略退成只读画廊)。 */
  onOpenWork?(job: GenerationJob): void;
}

/**
 * 提示词详情面板(承旧 PromptDetailScreen 的 inspector 形态,ui-parity 04 §8-2):
 * 导航 → 头部(封面/标题/来源元信息/更多菜单/主动作)→ 正文与反向词 → 相关作品 → 元数据。
 * md+ 由 Screen 装进右栏(≈400px),窄屏装进 Sheet —— 与历史屏 HistoryInspector 同构。
 *
 * 「分享 / 创建方案」不进本菜单:分享属暂缓域,创建方案入口留在列表行(方案域能力闸门)。
 */
export function PromptDetailInspector({
  prompt,
  onClose,
  onUse,
  onEdit,
  onCopy,
  onTogglePin,
  onRemove,
  onRestore,
  onOpenWork,
}: PromptDetailInspectorProps) {
  const deleted = prompt.deletedAt != null;

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="prompt-detail"
      data-prompt-id={prompt.id}
      data-deleted={deleted ? 'true' : 'false'}
    >
      <div className="flex items-center gap-2 border-border border-b px-4 py-2.5">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">
          提示词详情
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="关闭提示词详情"
          data-testid="prompt-detail-close"
          onClick={onClose}
        >
          <PanelRightClose className="size-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <header className="flex items-start gap-3">
          <PromptCover prompt={prompt} className="size-12" testId="prompt-detail-cover" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-1.5">
              {prompt.isPinned && !deleted && (
                <Pin className="size-3.5 shrink-0 text-primary" aria-label="已置顶" />
              )}
              <h2
                className="min-w-0 truncate font-semibold text-foreground text-sm"
                data-testid="prompt-detail-title"
              >
                {prompt.title}
              </h2>
              {deleted && (
                <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                  回收站
                </Badge>
              )}
            </div>
            {prompt.description && (
              <p className="text-muted-foreground text-xs">{prompt.description}</p>
            )}
            <p
              className="text-[11px] text-muted-foreground/80 tabular-nums"
              data-testid="prompt-detail-meta"
            >
              {promptSourceLabel(prompt.source)} · 使用 {prompt.usageCount} 次 · 更新于{' '}
              {promptRelativeTime(prompt.updatedAt)}
            </p>
            {prompt.tags.length > 0 && (
              <div className="flex flex-wrap gap-1" data-testid="prompt-detail-tags">
                {prompt.tags.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="secondary"
                    className="max-w-32 truncate px-1.5 py-0 text-[10px]"
                  >
                    {tag.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {deleted ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                data-testid="prompt-detail-restore"
                onClick={() => onRestore(prompt)}
              >
                <RotateCcw className="size-3.5" /> 恢复
              </Button>
            ) : (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground"
                      aria-label="提示词操作"
                      data-testid="prompt-detail-menu"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={6}>
                    <DropdownMenuItem
                      data-testid="prompt-detail-edit"
                      onSelect={() => onEdit(prompt)}
                    >
                      <Pencil aria-hidden /> 编辑
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-testid="prompt-detail-copy"
                      onSelect={() => onCopy(prompt)}
                    >
                      <Copy aria-hidden /> 复制正文
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-testid="prompt-detail-pin"
                      onSelect={() => onTogglePin(prompt)}
                    >
                      {prompt.isPinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                      {prompt.isPinned ? '取消置顶' : '置顶'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      data-testid="prompt-detail-remove"
                      onSelect={() => onRemove(prompt)}
                    >
                      <Trash2 aria-hidden /> 移入回收站
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="sm"
                  className="gap-1.5"
                  data-testid="prompt-detail-use"
                  onClick={() => onUse(prompt)}
                >
                  <Sparkles className="size-3.5" /> 使用
                </Button>
              </>
            )}
          </div>
        </header>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-muted-foreground text-xs">正文</span>
            <CopyButton
              text={prompt.content}
              label="复制正文"
              testId="prompt-detail-copy-content"
            />
          </div>
          <p
            className="whitespace-pre-wrap break-words text-foreground text-sm"
            data-testid="prompt-detail-content"
          >
            {prompt.content}
          </p>
        </div>

        {prompt.negative && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-muted-foreground text-xs">反向提示词</span>
              <CopyButton
                text={prompt.negative}
                label="复制反向提示词"
                testId="prompt-detail-copy-negative"
              />
            </div>
            <p
              className="whitespace-pre-wrap break-words text-muted-foreground text-sm"
              data-testid="prompt-detail-negative"
            >
              {prompt.negative}
            </p>
          </div>
        )}

        <Separator />

        <PromptRelatedWorks promptId={prompt.id} onOpenWork={onOpenWork} />

        <Separator />

        <div className="flex flex-col gap-1.5" data-testid="prompt-detail-facts">
          <FactRow label="来源" value={promptSourceLabel(prompt.source)} />
          <FactRow label="创建" value={promptDateTime(prompt.createdAt)} />
          <FactRow label="更新" value={promptDateTime(prompt.updatedAt)} />
          <FactRow label="使用次数" value={String(prompt.usageCount)} />
        </div>
      </div>
    </div>
  );
}
