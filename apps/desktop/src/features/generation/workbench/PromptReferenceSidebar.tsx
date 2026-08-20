import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  GripVertical,
  LibraryBig,
  Loader2,
  Maximize2,
  Minus,
  Quote,
  Search,
  Star,
  X,
} from '../../../components/ui/icons';
import type { Prompt } from '@musefold/desktop-contracts/models';
import type { PromptReference } from '@musefold/desktop-contracts/providers';
import api from '../../../lib/ipc';
import { cn } from '../../../lib/utils';
import { toast } from '../../../stores/toast';
import { useGenerationWorkbenchStore } from './store';
import {
  isDuplicateReference,
  MAX_DRAFT_REFERENCES,
  MAX_REFERENCE_TEXT_LENGTH,
} from './references';

interface SelectionSnapshot {
  promptId: string;
  text: string;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

interface PanelFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResizeState {
  pointerId: number;
  direction: ResizeDirection;
  startX: number;
  startY: number;
  frame: PanelFrame;
  boundsWidth: number;
  boundsHeight: number;
}

const DEFAULT_PANEL_WIDTH = 304;
const DEFAULT_PANEL_HEIGHT = 414;
const MIN_PANEL_WIDTH = 280;
const MIN_PANEL_HEIGHT = 220;
const PANEL_MARGIN = 12;

const RESIZE_HANDLES: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: 'n', className: 'left-4 right-4 top-0 h-2 cursor-ns-resize' },
  { direction: 'ne', className: 'right-0 top-0 h-4 w-4 cursor-nesw-resize' },
  { direction: 'e', className: 'bottom-4 right-0 top-4 w-2 cursor-ew-resize' },
  { direction: 'se', className: 'bottom-0 right-0 h-4 w-4 cursor-nwse-resize' },
  { direction: 's', className: 'bottom-0 left-4 right-4 h-2 cursor-ns-resize' },
  { direction: 'sw', className: 'bottom-0 left-0 h-4 w-4 cursor-nesw-resize' },
  { direction: 'w', className: 'bottom-4 left-0 top-4 w-2 cursor-ew-resize' },
  { direction: 'nw', className: 'left-0 top-0 h-4 w-4 cursor-nwse-resize' },
];

function clampFrame(frame: PanelFrame, boundsWidth: number, boundsHeight: number): PanelFrame {
  const maxWidth = Math.max(MIN_PANEL_WIDTH, boundsWidth - PANEL_MARGIN * 2);
  const maxHeight = Math.max(MIN_PANEL_HEIGHT, boundsHeight - PANEL_MARGIN * 2);
  const width = Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, frame.width));
  const height = Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, frame.height));
  return {
    x: Math.min(Math.max(PANEL_MARGIN, frame.x), Math.max(PANEL_MARGIN, boundsWidth - width - PANEL_MARGIN)),
    y: Math.min(Math.max(PANEL_MARGIN, frame.y), Math.max(PANEL_MARGIN, boundsHeight - height - PANEL_MARGIN)),
    width,
    height,
  };
}

export function PromptReferenceSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [frame, setFrame] = useState<PanelFrame | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const userAdjustedFrameRef = useRef(false);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const references = useGenerationWorkbenchStore((state) => state.draftReferences);
  const addReference = useGenerationWorkbenchStore((state) => state.addDraftReference);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPromptLoading(true);
      setPromptError(null);
      void api.prompt
        .list({
          search: query.trim() || undefined,
          sort: 'updated',
          sortDir: 'desc',
        })
        .then((items) => {
          if (!cancelled) setPrompts(items.slice(0, 40));
        })
        .catch((reason: unknown) => {
          if (!cancelled) setPromptError(reason instanceof Error ? reason.message : '提示词加载失败');
        })
        .finally(() => {
          if (!cancelled) setPromptLoading(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = isNarrow ? window.setTimeout(() => searchRef.current?.focus(), 120) : undefined;
    return () => {
      if (focusTimer !== undefined) window.clearTimeout(focusTimer);
      returnFocusRef.current?.focus();
    };
  }, [isNarrow, open]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => {
      setIsNarrow(media.matches);
    };
    update();
    media.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const parent = panelRef.current.parentElement;
    if (!parent) return;
    const syncFrame = () => {
      const bounds = parent.getBoundingClientRect();
      const composer = parent.parentElement?.querySelector<HTMLElement>('[data-testid="workbench-composer"]');
      const composerRect = composer?.getBoundingClientRect();
      setIsNarrow(bounds.width <= 760);
      setFrame((current) => {
        const width = Math.min(DEFAULT_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, bounds.width - PANEL_MARGIN * 2));
        const height = Math.min(DEFAULT_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, bounds.height - PANEL_MARGIN * 2));
        if (current && userAdjustedFrameRef.current) return clampFrame(current, bounds.width, bounds.height);
        const composerBottom = composerRect
          ? composerRect.top - bounds.top - 12
          : bounds.height - 16;
        return clampFrame({
          x: bounds.width - width - 16,
          y: composerBottom - height,
          width,
          height,
        }, bounds.width, bounds.height);
      });
    };
    syncFrame();
    const observer = new ResizeObserver(syncFrame);
    observer.observe(parent);
    const composer = parent.parentElement?.querySelector<HTMLElement>('[data-testid="workbench-composer"]');
    if (composer) observer.observe(composer);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (!isNarrow || event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex="0"]',
        ),
      ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isNarrow, onClose, open]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && event.pointerId === drag.pointerId) {
        setFrame((current) => current ? {
          ...current,
          x: Math.min(drag.maxX, Math.max(drag.minX, drag.originX + event.clientX - drag.startX)),
          y: Math.min(drag.maxY, Math.max(drag.minY, drag.originY + event.clientY - drag.startY)),
        } : current);
        return;
      }
      const resize = resizeRef.current;
      if (!resize || event.pointerId !== resize.pointerId) return;
      const { frame: origin, direction, boundsWidth, boundsHeight } = resize;
      let left = origin.x;
      let right = origin.x + origin.width;
      let top = origin.y;
      let bottom = origin.y + origin.height;
      const deltaX = event.clientX - resize.startX;
      const deltaY = event.clientY - resize.startY;
      if (direction.includes('w')) left = Math.min(origin.x + origin.width - MIN_PANEL_WIDTH, Math.max(PANEL_MARGIN, origin.x + deltaX));
      if (direction.includes('e')) right = Math.max(origin.x + MIN_PANEL_WIDTH, Math.min(boundsWidth - PANEL_MARGIN, origin.x + origin.width + deltaX));
      if (direction.includes('n')) top = Math.min(origin.y + origin.height - MIN_PANEL_HEIGHT, Math.max(PANEL_MARGIN, origin.y + deltaY));
      if (direction.includes('s')) bottom = Math.max(origin.y + MIN_PANEL_HEIGHT, Math.min(boundsHeight - PANEL_MARGIN, origin.y + origin.height + deltaY));
      setFrame(clampFrame({ x: left, y: top, width: right - left, height: bottom - top }, boundsWidth, boundsHeight));
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) {
        dragRef.current = null;
        setIsDragging(false);
      }
      if (resizeRef.current?.pointerId === event.pointerId) {
        resizeRef.current = null;
        setIsResizing(false);
      }
    };
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  const captureSelection = (prompt: Prompt, container: HTMLElement) => {
    const current = window.getSelection();
    if (!current || current.isCollapsed || current.rangeCount === 0) {
      setSelection((existing) => (existing?.promptId === prompt.id ? null : existing));
      return;
    }
    const range = current.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const text = current.toString().trim();
    setSelection(text ? { promptId: prompt.id, text } : null);
  };

  const add = (reference: PromptReference) => {
    if (references.length >= MAX_DRAFT_REFERENCES) {
      toast.error('引用数量已满', `最多同时引用 ${MAX_DRAFT_REFERENCES} 条提示词。`);
      return;
    }
    if (reference.text.length > MAX_REFERENCE_TEXT_LENGTH) {
      toast.error('选中内容过长', `请把选区缩短到 ${MAX_REFERENCE_TEXT_LENGTH} 字以内。`);
      return;
    }
    if (isDuplicateReference(references, reference)) {
      toast.info('已经引用过这段内容');
      return;
    }
    addReference(reference);
    setSelection(null);
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isNarrow || !panelRef.current || event.button !== 0) return;
    const rect = panelRef.current.getBoundingClientRect();
    const bounds = panelRef.current.parentElement?.getBoundingClientRect();
    const parentLeft = bounds?.left ?? 0;
    const parentTop = bounds?.top ?? 0;
    const boundsWidth = bounds?.width ?? window.innerWidth;
    const boundsHeight = bounds?.height ?? window.innerHeight;
    const currentFrame = frame ?? {
      x: rect.left - parentLeft,
      y: rect.top - parentTop,
      width: rect.width,
      height: rect.height,
    };
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: currentFrame.x,
      originY: currentFrame.y,
      minX: PANEL_MARGIN,
      maxX: Math.max(PANEL_MARGIN, boundsWidth - currentFrame.width - PANEL_MARGIN),
      minY: PANEL_MARGIN,
      maxY: Math.max(PANEL_MARGIN, boundsHeight - currentFrame.height - PANEL_MARGIN),
    };
    setFrame(currentFrame);
    userAdjustedFrameRef.current = true;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>, direction: ResizeDirection) => {
    if (!panelRef.current || event.button !== 0 || !frame) return;
    const bounds = panelRef.current.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      pointerId: event.pointerId,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      frame,
      boundsWidth: bounds.width,
      boundsHeight: bounds.height,
    };
    userAdjustedFrameRef.current = true;
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizeFromKeyboard = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    if (!frame) return;
    const horizontal = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0;
    const vertical = event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0;
    if (!horizontal && !vertical) return;
    event.preventDefault();
    const bounds = panelRef.current?.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    userAdjustedFrameRef.current = true;
    setFrame(clampFrame({ ...frame, width: frame.width + horizontal, height: frame.height + vertical }, bounds.width, bounds.height));
  };

  if (!open) return null;

  const loading = promptLoading;
  const error = promptError;
  const resultCount = prompts.length;

  return (
    <>
      {!minimized && (
        <button
          type="button"
          aria-label="关闭素材库"
          onClick={onClose}
          tabIndex={-1}
          className="pointer-events-none absolute inset-0 z-30 hidden bg-black/20 max-[760px]:pointer-events-auto max-[760px]:block"
          data-testid="workbench-reference-backdrop"
        />
      )}
      <aside
        ref={panelRef}
        id="workbench-reference-sidebar"
        role={isNarrow ? 'dialog' : 'complementary'}
        aria-modal={isNarrow ? true : undefined}
        aria-labelledby="workbench-reference-title"
        style={frame ? {
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: minimized ? undefined : frame.height,
        } : undefined}
        className={cn(
          'absolute z-40 flex min-h-0 min-w-0 max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border border-border-default bg-elevated shadow-pop max-[760px]:rounded-xl',
          !frame && 'bottom-4 right-4 w-[min(304px,calc(100%-24px))]',
          !frame && !minimized && 'h-[min(414px,calc(100%-24px))]',
          isDragging && 'cursor-grabbing',
          isResizing && 'select-none',
        )}
        data-testid="workbench-reference-sidebar"
        data-open={open ? 'true' : 'false'}
        data-minimized={minimized ? 'true' : 'false'}
      >
        <div
          onPointerDown={startDrag}
          className={cn(
            'flex h-[52px] shrink-0 touch-none select-none items-center gap-1.5 border-b border-border-subtle px-2.5',
            isNarrow ? 'cursor-default' : isDragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          title={isNarrow ? undefined : '拖动素材库'}
        >
          <span
            tabIndex={0}
            role="button"
            aria-label="调整素材库大小"
            title="拖动素材库边缘或角落调整大小"
            onKeyDown={resizeFromKeyboard}
            className="no-drag flex h-5 w-5 shrink-0 items-center justify-center rounded text-quaternary outline-none focus-visible:bg-hover focus-visible:text-primary"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
            <LibraryBig className="h-3.5 w-3.5" />
          </span>
          <h2 id="workbench-reference-title" className="min-w-0 flex-1 truncate text-[12px] font-semibold text-primary">素材库</h2>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setMinimized((value) => !value)}
            className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
            aria-label={minimized ? '展开素材库' : '缩小素材库'}
            title={minimized ? '展开素材库' : '缩小素材库'}
            data-testid="workbench-materials-minimize"
          >
            {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
            className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
            aria-label="关闭素材库"
            title="关闭素材库"
            data-testid="workbench-materials-close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {RESIZE_HANDLES.map(({ direction, className }) => (
          <div
            key={direction}
            aria-hidden="true"
            onPointerDown={(event) => startResize(event, direction)}
            className={cn('no-drag absolute z-50 rounded-sm', className)}
            data-resize-direction={direction}
          />
        ))}

        <div className="shrink-0 border-b border-border-subtle p-2.5">
          <label className="flex h-8 items-center gap-2 rounded-md border border-border-default bg-elevated px-2.5 transition-colors focus-within:border-border-strong">
            <Search className="h-3.5 w-3.5 shrink-0 text-tertiary" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索提示词"
              placeholder="搜索提示词"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-primary outline-none placeholder:text-tertiary"
              data-testid="workbench-reference-search"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="清空搜索" className="text-tertiary hover:text-primary">
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
          {!minimized && (
            <div className="mt-2 flex items-center justify-between px-0.5 text-[9.5px] text-tertiary">
              <span>{query.trim() ? `搜索结果 ${resultCount}` : '最近更新'}</span>
              <span data-testid="workbench-reference-count">已引用 {references.length}/{MAX_DRAFT_REFERENCES}</span>
            </div>
          )}
        </div>

        {!minimized && <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[10.5px] text-tertiary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载提示词
            </div>
          ) : error ? (
            <div className="rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[10.5px] leading-relaxed text-danger">{error}</div>
          ) : prompts.length === 0 ? (
            <div className="px-4 py-12 text-center text-[10.5px] text-tertiary">没有找到提示词</div>
          ) : (
            <div className="space-y-1">
              {prompts.map((prompt) => {
                const expanded = expandedId === prompt.id;
                const fullReference: PromptReference = {
                  promptId: prompt.id,
                  title: prompt.title,
                  text: prompt.content,
                  scope: 'full',
                };
                const fullReferenced = isDuplicateReference(references, fullReference);
                const selectedText = selection?.promptId === prompt.id ? selection.text : '';
                const selectionTooLong = selectedText.length > MAX_REFERENCE_TEXT_LENGTH;
                const excerptReferenced = selectedText
                  ? isDuplicateReference(references, { ...fullReference, text: selectedText, scope: 'excerpt' })
                  : false;
                return (
                  <article
                    key={prompt.id}
                    className={cn(
                      'rounded-md border bg-elevated transition-colors',
                      expanded ? 'border-border-default' : 'border-border-subtle hover:border-border-default hover:bg-hover',
                    )}
                    data-testid="workbench-reference-row"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedId(expanded ? null : prompt.id);
                        setSelection(null);
                      }}
                      className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
                      aria-expanded={expanded}
                      data-testid="workbench-reference-expand"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-primary">
                          <span className="truncate">{prompt.title}</span>
                          {prompt.isPinned && <Star className="h-3 w-3 shrink-0 fill-current text-warning" />}
                        </span>
                        <span className="mt-1 line-clamp-2 text-[10px] leading-[1.45] text-tertiary">{prompt.content}</span>
                        {prompt.tags.length > 0 && (
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            {prompt.tags.slice(0, 3).map((tag) => (
                              <span key={tag.id} className="rounded-sm bg-inset px-1 py-0.5 text-[9px] text-tertiary">{tag.name}</span>
                            ))}
                          </span>
                        )}
                      </span>
                      <ChevronDown className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-tertiary transition-transform', expanded && 'rotate-180')} />
                    </button>

                    {expanded && (
                      <div className="border-t border-border-subtle px-2.5 pb-2.5 pt-2">
                        <div
                          tabIndex={0}
                          onMouseUp={(event) => captureSelection(prompt, event.currentTarget)}
                          onKeyUp={(event) => captureSelection(prompt, event.currentTarget)}
                          className="max-h-52 select-text overflow-y-auto whitespace-pre-wrap rounded-md bg-inset/55 px-2.5 py-2 text-[10.5px] leading-relaxed text-secondary outline-none focus:ring-2 focus:ring-accent/15"
                          data-testid="workbench-reference-content"
                        >
                          {prompt.content}
                        </div>
                        {selectedText && (
                          <p className={cn('mt-1.5 text-[9.5px]', selectionTooLong ? 'text-danger' : 'text-tertiary')}>
                            已选择 {selectedText.length} 字{selectionTooLong ? `，请缩短到 ${MAX_REFERENCE_TEXT_LENGTH} 字以内` : ''}
                          </p>
                        )}
                        <div className="mt-2 flex items-center justify-end gap-1.5">
                          {selectedText && (
                            <button
                              type="button"
                              disabled={selectionTooLong || excerptReferenced}
                              onClick={() => add({ ...fullReference, text: selectedText, scope: 'excerpt' })}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-border-default bg-elevated px-2 text-[10px] text-secondary hover:bg-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
                              data-testid="workbench-reference-selection"
                            >
                              <Quote className="h-3 w-3" /> {excerptReferenced ? '已引用' : '引用选中内容'}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={fullReferenced}
                            onClick={() => add(fullReference)}
                            className="inline-flex h-7 items-center rounded-md bg-accent px-2.5 text-[10px] font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
                            data-testid="workbench-reference-full"
                          >
                            {fullReferenced ? '已引用' : '引用整条'}
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>}
      </aside>
    </>
  );
}
