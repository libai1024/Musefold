'use client';

import type { PromptDocument } from '@musefold/contracts';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@musefold/ui/components/tooltip';
import {
  Blocks,
  Copy,
  FileText,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Star,
  Trash2,
} from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import type { ReactNode } from 'react';

export interface PromptListRowProps {
  prompt: PromptDocument;
  /** 跨屏定位高亮(「存为提示词 → 查看」落点):accent 底色 2s 渐隐并滚入视口。 */
  highlighted?: boolean;
  /** 「使用」= 送工作台草稿并切屏(承旧行尾主动作,ui-parity 04 P0)。 */
  onUse(prompt: PromptDocument): void;
  onEdit(prompt: PromptDocument): void;
  onCopy(prompt: PromptDocument): void;
  onTogglePin(prompt: PromptDocument): void;
  onRemove(prompt: PromptDocument): void;
  onRestore(prompt: PromptDocument): void;
  /** 回收站行「永久删除」;确认对话框由屏幕层持有。 */
  onPurge(prompt: PromptDocument): void;
  /**
   * 「创建方案」(承 v2.1 详情页菜单项):把提示词整理成可复用方案的创建意图送工作台。
   * 可选——方案域能力关闭或宿主未接切屏回调时不渲染该钮(D2,不留死入口);
   * 回收站行同样不出现。
   */
  onCreateScheme?(prompt: PromptDocument): void;
}

function RowAction({
  label,
  testId,
  onClick,
  children,
}: {
  label: string;
  testId: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label={label}
          data-testid={testId}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * 库列表行(信息架构承自 v2.0 PromptListRow):
 * 缩略图 + 标题/摘要/元信息 + 常驻操作组。操作不藏浮层——
 * 桌面 hover 渐显、触屏常显,回收站行留「恢复/永久删除」。
 */
export function PromptListRow({
  prompt,
  highlighted = false,
  onUse,
  onEdit,
  onCopy,
  onTogglePin,
  onRemove,
  onRestore,
  onPurge,
  onCreateScheme,
}: PromptListRowProps) {
  const deleted = prompt.deletedAt != null;
  const summary = prompt.description?.trim() || prompt.content;

  return (
    <article
      data-testid={`prompt-row-${prompt.id}`}
      ref={(node) => {
        if (highlighted) node?.scrollIntoView?.({ block: 'nearest' });
      }}
      className={cn(
        'group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-card',
        deleted && 'opacity-70',
        highlighted && 'mf-row-highlight',
      )}
    >
      <div
        className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground"
        aria-hidden
      >
        <FileText className="size-5" />
      </div>

      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
        onClick={() => (deleted ? onRestore(prompt) : onEdit(prompt))}
        data-testid="prompt-row-open"
      >
        <span className="flex items-center gap-1.5 font-medium text-foreground text-sm">
          {prompt.isPinned && !deleted && (
            <Pin className="size-3.5 shrink-0 text-primary" aria-label="已置顶" />
          )}
          <span className="truncate" data-testid="prompt-row-title">
            {prompt.title}
          </span>
          {prompt.rating > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 text-warning text-xs tabular-nums">
              <Star className="size-3 fill-current" aria-hidden />
              {prompt.rating}
            </span>
          )}
        </span>
        <span className="truncate text-muted-foreground text-xs">{summary}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground/80 tabular-nums">
          {prompt.usageCount > 0 && <span>使用 {prompt.usageCount} 次</span>}
          {prompt.tags.slice(0, 4).map((tag) => (
            <Badge
              key={tag.id}
              variant="secondary"
              className="max-w-28 truncate px-1.5 py-0 text-[10px]"
            >
              {tag.name}
            </Badge>
          ))}
          {prompt.tags.length > 4 && <span>+{prompt.tags.length - 4}</span>}
        </span>
      </button>

      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5 transition-opacity',
          // 桌面 hover/键盘聚焦渐显;触屏(无 hover 能力)常显。
          'md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100',
        )}
      >
        {deleted ? (
          <>
            <RowAction label="恢复" testId="prompt-row-restore" onClick={() => onRestore(prompt)}>
              <RotateCcw className="size-4" />
            </RowAction>
            <RowAction label="永久删除" testId="prompt-row-purge" onClick={() => onPurge(prompt)}>
              <Trash2 className="size-4" />
            </RowAction>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 font-medium text-primary text-xs hover:text-primary"
              data-testid="prompt-row-use"
              onClick={() => onUse(prompt)}
            >
              使用
            </Button>
            <RowAction label="复制内容" testId="prompt-row-copy" onClick={() => onCopy(prompt)}>
              <Copy className="size-4" />
            </RowAction>
            {onCreateScheme ? (
              <RowAction
                label="创建方案"
                testId="prompt-row-create-scheme"
                onClick={() => onCreateScheme(prompt)}
              >
                <Blocks className="size-4" />
              </RowAction>
            ) : null}
            <RowAction label="编辑" testId="prompt-row-edit" onClick={() => onEdit(prompt)}>
              <Pencil className="size-4" />
            </RowAction>
            <RowAction
              label={prompt.isPinned ? '取消置顶' : '置顶'}
              testId="prompt-row-pin"
              onClick={() => onTogglePin(prompt)}
            >
              {prompt.isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            </RowAction>
            <RowAction
              label="移入回收站"
              testId="prompt-row-remove"
              onClick={() => onRemove(prompt)}
            >
              <Trash2 className="size-4" />
            </RowAction>
          </>
        )}
      </div>
    </article>
  );
}
