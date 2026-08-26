import { useEffect, useRef, useState } from 'react';
import type { DesktopLibraryPrompt } from '@musefold/desktop-contracts/library-documents';
import type { PromptReference } from '@musefold/desktop-contracts/providers';
import {
  ChevronDown,
  LibraryBig,
  Loader2,
  PanelRightClose,
  Quote,
  Search,
  Star,
  X,
} from '../../../components/ui/icons';
import {
  isDuplicateReference,
  MAX_DRAFT_REFERENCES,
  MAX_REFERENCE_TEXT_LENGTH,
} from '../../../lib/prompt-references';
import { cn } from '../../../lib/utils';
import { desktopGateway } from '../../../runtime';
import { toast } from '../../../stores/toast';
import { useGenerationWorkbenchStore } from './store';

const DOCK_MIN_WIDTH = 260;
const DOCK_MAX_WIDTH = 420;
const DOCK_OVERLAY_QUERY = '(max-width: 960px)';

interface SelectionSnapshot {
  promptId: string;
  text: string;
}

interface ResizeState {
  pointerId: number;
  startX: number;
  startWidth: number;
  maxWidth: number;
}

export function PromptReferenceSidebar({
  open,
  width,
  onWidthChange,
  onClose,
}: {
  open: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [prompts, setPrompts] = useState<DesktopLibraryPrompt[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [isOverlay, setIsOverlay] = useState(() =>
    window.matchMedia(DOCK_OVERLAY_QUERY).matches,
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const references = useGenerationWorkbenchStore((state) => state.draftReferences);
  const addReference = useGenerationWorkbenchStore((state) => state.addDraftReference);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPromptLoading(true);
      setPromptError(null);
      void desktopGateway
        .listLibraryPrompts({
          search: query.trim() || undefined,
          sort: 'updated',
          sortDir: 'desc',
        })
        .then((items) => {
          if (!cancelled) setPrompts(items.slice(0, 40));
        })
        .catch((reason: unknown) => {
          if (!cancelled) {
            setPromptError(
              reason instanceof Error ? reason.message : '提示词加载失败',
            );
          }
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
    const media = window.matchMedia(DOCK_OVERLAY_QUERY);
    const update = () => setIsOverlay(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusTimer = isOverlay
      ? window.setTimeout(() => searchRef.current?.focus(), 120)
      : undefined;
    return () => {
      if (focusTimer !== undefined) window.clearTimeout(focusTimer);
      returnFocusRef.current?.focus();
    };
  }, [isOverlay, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (!isOverlay || event.key !== 'Tab' || !panelRef.current) return;
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
  }, [isOverlay, onClose, open]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      onWidthChange(
        Math.min(
          resize.maxWidth,
          Math.max(
            DOCK_MIN_WIDTH,
            resize.startWidth + resize.startX - event.clientX,
          ),
        ),
      );
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (resizeRef.current?.pointerId === event.pointerId) {
        resizeRef.current = null;
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
  }, [onWidthChange]);

  const captureSelection = (
    prompt: DesktopLibraryPrompt,
    container: HTMLElement,
  ) => {
    const current = window.getSelection();
    if (!current || current.isCollapsed || current.rangeCount === 0) {
      setSelection((existing) =>
        existing?.promptId === prompt.id ? null : existing,
      );
      return;
    }
    const range = current.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const text = current.toString().trim();
    setSelection(text ? { promptId: prompt.id, text } : null);
  };

  const add = (reference: PromptReference) => {
    if (references.length >= MAX_DRAFT_REFERENCES) {
      toast.error(
        '引用数量已满',
        `最多同时引用 ${MAX_DRAFT_REFERENCES} 条提示词。`,
      );
      return;
    }
    if (reference.text.length > MAX_REFERENCE_TEXT_LENGTH) {
      toast.error(
        '选中内容过长',
        `请把选区缩短到 ${MAX_REFERENCE_TEXT_LENGTH} 字以内。`,
      );
      return;
    }
    if (isDuplicateReference(references, reference)) {
      toast.info('已经引用过这段内容');
      return;
    }
    addReference(reference);
    setSelection(null);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isOverlay || event.button !== 0) return;
    const page = panelRef.current?.closest<HTMLElement>(
      '[data-testid="generation-workbench"]',
    );
    if (!page) return;
    const maxWidth = Math.min(
      DOCK_MAX_WIDTH,
      Math.max(DOCK_MIN_WIDTH, page.getBoundingClientRect().width - 520),
    );
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      maxWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizeFromKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') onWidthChange(DOCK_MIN_WIDTH);
    else if (event.key === 'End') onWidthChange(DOCK_MAX_WIDTH);
    else {
      const delta = event.key === 'ArrowLeft' ? 16 : -16;
      onWidthChange(
        Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, width + delta)),
      );
    }
  };

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="收起参考素材面板"
        onClick={onClose}
        tabIndex={-1}
        className="pointer-events-none absolute inset-0 z-30 hidden bg-black/20 max-[960px]:pointer-events-auto max-[960px]:block"
        data-testid="workbench-reference-backdrop"
      />
      <aside
        ref={panelRef}
        id="workbench-reference-sidebar"
        role={isOverlay ? 'dialog' : 'complementary'}
        aria-modal={isOverlay ? true : undefined}
        aria-labelledby="workbench-reference-title"
        className="pointer-events-auto relative z-40 flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-work)] border border-border-subtle bg-[var(--bg-dock)] shadow-sm max-[960px]:absolute max-[960px]:bottom-3 max-[960px]:right-3 max-[960px]:top-3 max-[960px]:h-auto max-[960px]:w-[min(360px,calc(100%-24px))] max-[960px]:rounded-[var(--radius-dialog)] max-[960px]:border-border-default max-[960px]:bg-elevated max-[960px]:shadow-dialog max-[680px]:inset-x-2 max-[680px]:bottom-2 max-[680px]:top-auto max-[680px]:h-[min(76vh,620px)] max-[680px]:w-auto"
        data-testid="workbench-reference-sidebar"
        data-layout={isOverlay ? 'overlay' : 'dock'}
        data-open="true"
      >
        <div
          role="separator"
          aria-label="调整参考素材面板宽度"
          aria-orientation="vertical"
          aria-valuemin={DOCK_MIN_WIDTH}
          aria-valuemax={DOCK_MAX_WIDTH}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeFromKeyboard}
          className="absolute -left-1 top-3 z-50 h-[calc(100%-24px)] w-2 cursor-col-resize rounded-sm outline-none focus-visible:bg-accent/25 max-[960px]:hidden"
          data-testid="workbench-context-dock-resize"
        />

        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-tooltip)] bg-accent-soft text-accent">
            <LibraryBig className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <h2
            id="workbench-reference-title"
            className="min-w-0 flex-1 truncate text-[12px] font-semibold text-primary"
          >
            参考素材
          </h2>
          <span className="text-meta tabular-nums text-tertiary">
            {references.length}/{MAX_DRAFT_REFERENCES}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-tooltip)] text-tertiary hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
            aria-label="收起参考素材面板"
            title="收起参考素材面板"
            data-testid="workbench-materials-close"
          >
            <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="shrink-0 border-b border-border-subtle p-2.5">
          <label className="flex h-8 items-center gap-2 rounded-[var(--radius-tooltip)] border border-border-default bg-elevated px-2.5 transition-colors focus-within:border-border-strong">
            <Search
              className="h-3.5 w-3.5 shrink-0 text-tertiary"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索提示词"
              placeholder="搜索提示词"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-primary outline-none placeholder:text-tertiary"
              data-testid="workbench-reference-search"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="清空搜索"
                className="text-tertiary hover:text-primary"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <div className="mt-2 flex items-center justify-between px-0.5 text-meta text-tertiary">
            <span>{query.trim() ? `搜索结果 ${prompts.length}` : '最近更新'}</span>
            <span data-testid="workbench-reference-count">
              已引用 {references.length}/{MAX_DRAFT_REFERENCES}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {promptLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-meta text-tertiary">
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                aria-hidden="true"
              />
              加载提示词
            </div>
          ) : promptError ? (
            <div className="rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-meta leading-relaxed text-danger">
              {promptError}
            </div>
          ) : prompts.length === 0 ? (
            <div className="px-4 py-12 text-center text-meta text-tertiary">
              没有找到提示词
            </div>
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
                const fullReferenced = isDuplicateReference(
                  references,
                  fullReference,
                );
                const selectedText =
                  selection?.promptId === prompt.id ? selection.text : '';
                const selectionTooLong =
                  selectedText.length > MAX_REFERENCE_TEXT_LENGTH;
                const excerptReferenced = selectedText
                  ? isDuplicateReference(references, {
                      ...fullReference,
                      text: selectedText,
                      scope: 'excerpt',
                    })
                  : false;
                return (
                  <article
                    key={prompt.id}
                    className={cn(
                      'rounded-[var(--radius-control)] border bg-elevated transition-colors',
                      expanded
                        ? 'border-border-default'
                        : 'border-border-subtle hover:border-border-default hover:bg-hover',
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
                          {prompt.isPinned ? (
                            <Star
                              className="h-3 w-3 shrink-0 fill-current text-warning"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                        <span className="mt-1 line-clamp-2 text-meta leading-[1.45] text-tertiary">
                          {prompt.content}
                        </span>
                        {prompt.tags.length > 0 ? (
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            {prompt.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag.id}
                                className="rounded-sm bg-inset px-1 py-0.5 text-meta text-tertiary"
                              >
                                {tag.name}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                      <ChevronDown
                        className={cn(
                          'mt-0.5 h-3.5 w-3.5 shrink-0 text-tertiary transition-transform',
                          expanded && 'rotate-180',
                        )}
                        aria-hidden="true"
                      />
                    </button>

                    {expanded ? (
                      <div className="border-t border-border-subtle px-2.5 pb-2.5 pt-2">
                        <div
                          tabIndex={0}
                          onMouseUp={(event) =>
                            captureSelection(prompt, event.currentTarget)
                          }
                          onKeyUp={(event) =>
                            captureSelection(prompt, event.currentTarget)
                          }
                          className="max-h-52 select-text overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-tooltip)] bg-inset/55 px-2.5 py-2 text-meta leading-relaxed text-secondary outline-none focus:ring-2 focus:ring-accent/15"
                          data-testid="workbench-reference-content"
                        >
                          {prompt.content}
                        </div>
                        {selectedText ? (
                          <p
                            className={cn(
                              'mt-1.5 text-meta',
                              selectionTooLong
                                ? 'text-danger'
                                : 'text-tertiary',
                            )}
                          >
                            已选择 {selectedText.length} 字
                            {selectionTooLong
                              ? `，请缩短到 ${MAX_REFERENCE_TEXT_LENGTH} 字以内`
                              : ''}
                          </p>
                        ) : null}
                        <div className="mt-2 flex items-center justify-end gap-1.5">
                          {selectedText ? (
                            <button
                              type="button"
                              disabled={selectionTooLong || excerptReferenced}
                              onClick={() =>
                                add({
                                  ...fullReference,
                                  text: selectedText,
                                  scope: 'excerpt',
                                })
                              }
                              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-tooltip)] border border-border-default bg-elevated px-2 text-meta text-secondary hover:bg-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
                              data-testid="workbench-reference-selection"
                            >
                              <Quote className="h-3 w-3" aria-hidden="true" />
                              {excerptReferenced ? '已引用' : '引用选中内容'}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={fullReferenced}
                            onClick={() => add(fullReference)}
                            className="inline-flex h-7 items-center rounded-[var(--radius-tooltip)] bg-accent px-2.5 text-meta font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
                            data-testid="workbench-reference-full"
                          >
                            {fullReferenced ? '已引用' : '引用整条'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
