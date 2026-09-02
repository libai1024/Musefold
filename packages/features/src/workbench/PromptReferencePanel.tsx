'use client';

import type {
  PromptDocument,
  PromptListQuery,
  PromptReferenceSelection,
} from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@musefold/ui/components/dialog';
import { Input } from '@musefold/ui/components/input';
import { Spinner } from '@musefold/ui/components/spinner';
import { ChevronDown, FileText, Search, X } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import {
  type Ref,
  type RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMediaQuery } from '../history/hooks';
import { usePromptList } from '../prompts/hooks';
import {
  buildExcerptPromptReference,
  buildFullPromptReference,
  notifyPromptReferenceSelectionError,
  PROMPT_REFERENCE_TEXT_MAX,
} from './prompt-references';

/**
 * 读浏览器选区相对容器正文的 UTF-16 偏移(DOM Range 偏移本身就是 UTF-16 code unit 语义,
 * 与契约区间一致)。选区为空、不在容器内或起点不先于终点时返回 null。
 */
export function readSelectionRangeWithin(
  container: HTMLElement,
): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }
  const before = document.createRange();
  before.selectNodeContents(container);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const end = start + range.toString().length;
  return start < end ? { start, end } : null;
}

export interface PromptReferencePanelProps {
  /** 当前草稿已选的引用意图(计数/已引用标记)。 */
  selections: readonly PromptReferenceSelection[];
  /** 新增一条引用意图;上限/重复由调用方判定并反馈。 */
  onAdd(intent: PromptReferenceSelection): void;
  onClose(): void;
  /** 桌面内联面板挂载即聚焦搜索框(移动端由 Dialog onOpenAutoFocus 代劳)。 */
  autoFocusSearch?: boolean;
  /** 暴露搜索框:移动端 Dialog 打开时聚焦用。 */
  searchInputRef?: Ref<HTMLInputElement>;
  className?: string;
}

/**
 * 参考素材选择面板(提示词引用,承旧 v2.1 素材库 Dock 的提示词引用区):
 * 默认按最近更新列出库内提示词,支持搜索与翻页;行展开后可「引用整条」或
 * 选中正文片段「引用选中内容」(UTF-16 区间意图,不含任何客户端文本)。
 */
export function PromptReferencePanel({
  selections,
  onAdd,
  onClose,
  autoFocusSearch = false,
  searchInputRef,
  className,
}: PromptReferencePanelProps) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const innerSearchRef = useRef<HTMLInputElement>(null);
  // 单行展开:展开区唯一,引用选中内容的 DOM 选区相对它计算。
  const contentRef = useRef<HTMLParagraphElement>(null);

  const query = useMemo<Omit<PromptListQuery, 'cursor'>>(
    () => ({ q: deferredSearch.trim() || undefined, sort: 'updated-desc', limit: 20 }),
    [deferredSearch],
  );
  const list = usePromptList(query);
  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);

  useEffect(() => {
    if (autoFocusSearch) innerSearchRef.current?.focus();
  }, [autoFocusSearch]);

  function setSearchRef(element: HTMLInputElement | null) {
    innerSearchRef.current = element;
    if (typeof searchInputRef === 'function') {
      searchInputRef(element);
    } else if (searchInputRef) {
      searchInputRef.current = element;
    }
  }

  function handleSelectFull(prompt: PromptDocument) {
    onAdd(buildFullPromptReference(prompt));
  }

  /** 「引用选中内容」:读展开区 DOM 选区 → UTF-16 区间意图;空选区/超 4000 明确反馈。 */
  function handleSelectExcerpt(prompt: PromptDocument) {
    const content = contentRef.current;
    const range = content ? readSelectionRangeWithin(content) : null;
    if (!range) {
      notifyPromptReferenceSelectionError('empty');
      return;
    }
    if (range.end - range.start > PROMPT_REFERENCE_TEXT_MAX) {
      notifyPromptReferenceSelectionError('too-long');
      return;
    }
    onAdd(buildExcerptPromptReference(prompt, range));
    window.getSelection()?.removeAllRanges();
  }

  return (
    <aside
      className={cn('flex min-h-0 w-full flex-col bg-background', className)}
      aria-label="参考素材"
      data-testid="workbench-reference-sidebar"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-border/60 border-b px-3">
        <h2 className="font-semibold text-foreground text-sm">参考素材</h2>
        <span
          className="text-[11px] text-muted-foreground tabular-nums"
          data-testid="workbench-reference-count"
        >
          已引用 {selections.length}/6
        </span>
        <button
          type="button"
          className="ml-auto flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/45 md:size-8"
          aria-label="收起参考素材面板"
          title="收起参考素材面板"
          data-testid="workbench-materials-close"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="shrink-0 px-3 py-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={setSearchRef}
            value={search}
            aria-label="搜索提示词"
            placeholder="搜索提示词"
            className="h-9 pl-8 text-[16px] md:text-[13px]"
            data-testid="workbench-reference-search"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isPending ? (
          <p className="flex items-center gap-2 px-3 py-6 text-muted-foreground text-xs">
            <Spinner className="size-3.5" /> 加载提示词
          </p>
        ) : list.isError ? (
          <div className="flex flex-col items-start gap-2 px-3 py-6" role="alert">
            <p className="font-medium text-foreground text-xs">提示词加载失败</p>
            <p className="text-muted-foreground text-xs">
              {list.error instanceof Error ? list.error.message : '请稍后重试'}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-11 md:h-8"
              onClick={() => void list.refetch()}
              data-testid="workbench-reference-retry"
            >
              重试
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-muted-foreground text-xs">没有找到提示词</p>
        ) : (
          items.map((prompt) => {
            const expanded = expandedId === prompt.id;
            const alreadyFull = selections.some(
              (selection) => selection.promptId === prompt.id && selection.scope === 'full',
            );
            const referenced = selections.some((selection) => selection.promptId === prompt.id);
            return (
              <div
                key={prompt.id}
                className="border-border/60 border-b last:border-b-0"
                data-testid="workbench-reference-row"
              >
                <div className="flex items-center gap-1 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-foreground text-xs">
                        {prompt.title}
                      </span>
                      {referenced && (
                        <span className="shrink-0 text-[11px] text-primary">已引用</span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">{prompt.content}</p>
                  </div>
                  <button
                    type="button"
                    className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/45 md:size-8"
                    aria-expanded={expanded}
                    aria-label={expanded ? `收起 ${prompt.title}` : `展开 ${prompt.title}`}
                    data-testid="workbench-reference-expand"
                    onClick={() => setExpandedId(expanded ? null : prompt.id)}
                  >
                    <ChevronDown
                      className={cn(
                        'size-4 transition-transform duration-(--dur-fast)',
                        expanded && 'rotate-180',
                      )}
                      aria-hidden
                    />
                  </button>
                </div>
                {expanded && (
                  <div className="flex flex-col gap-2 px-3 pb-3">
                    <p
                      ref={contentRef}
                      className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-muted-foreground text-xs leading-relaxed"
                      data-testid="workbench-reference-content"
                    >
                      {prompt.content}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-11 gap-1.5 text-xs md:h-8"
                        disabled={alreadyFull}
                        data-testid="workbench-reference-full"
                        onClick={() => handleSelectFull(prompt)}
                      >
                        <FileText className="size-3.5" aria-hidden />
                        {alreadyFull ? '已引用' : '引用整条'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 text-xs md:h-8"
                        data-testid="workbench-reference-selection"
                        // mousedown 默认行为会收起正文选区;拦掉,点击时再读选区。
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSelectExcerpt(prompt)}
                      >
                        引用选中内容
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
        {list.hasNextPage && (
          <div className="px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 w-full text-muted-foreground text-xs md:h-8"
              disabled={list.isFetchingNextPage}
              data-testid="workbench-reference-more"
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? '加载中…' : '加载更多'}
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}

export interface PromptReferenceDockProps {
  open: boolean;
  selections: readonly PromptReferenceSelection[];
  onAdd(intent: PromptReferenceSelection): void;
  onOpenChange(open: boolean): void;
  /** 面板关闭后的焦点归还目标(「添加上下文」触发钮,§8-I9 焦点归还)。 */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * 参考素材面板的宿主分叉:桌面(md+)为工作台右侧 304px 内联面板(承旧素材库 Dock),
 * 移动端为底部 Dialog(焦点圈闭/Esc/焦点归还走 Radix,不外挂文档级 dismissal)。
 */
export function PromptReferenceDock({
  open,
  selections,
  onAdd,
  onOpenChange,
  returnFocusRef,
}: PromptReferenceDockProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const requestClose = useCallback(() => {
    onOpenChange(false);
    const trigger = returnFocusRef?.current;
    if (trigger) requestAnimationFrame(() => trigger.focus());
  }, [onOpenChange, returnFocusRef]);

  // 桌面内联面板非模态:Esc 关闭并归还焦点;Radix 浮层会 preventDefault,自然让位。
  useEffect(() => {
    if (!open || !isDesktop) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      requestClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, isDesktop, requestClose]);

  if (!open) return null;

  if (isDesktop) {
    return (
      <div className="flex w-[304px] shrink-0 flex-col border-border border-l">
        <PromptReferencePanel
          selections={selections}
          onAdd={onAdd}
          onClose={requestClose}
          autoFocusSearch
          searchInputRef={searchInputRef}
          className="flex-1"
        />
      </div>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay data-testid="workbench-reference-backdrop" />
      </DialogPortal>
      <DialogContent
        overlayClassName="pointer-events-none bg-transparent"
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-auto bottom-0 left-0 flex h-[82dvh] max-h-[82dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-t-xl rounded-b-none border-x-0 border-b-0 p-0 pb-[env(safe-area-inset-bottom)]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchInputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">参考素材</DialogTitle>
        <PromptReferencePanel
          selections={selections}
          onAdd={onAdd}
          onClose={requestClose}
          searchInputRef={searchInputRef}
          className="min-h-0 flex-1"
        />
      </DialogContent>
    </Dialog>
  );
}
