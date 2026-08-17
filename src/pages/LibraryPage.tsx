// src/pages/LibraryPage.tsx
// 提示词库 —— v0.3.2 重塑：960px 居中紧凑列表，版式对齐方案中心。
//
// 结构：
//   列表模式：分区（置顶 / 全部）+ 紧凑行（缩略图 + 标题/预览/元信息 + 行尾「使用」）
//     - 置顶区常驻渲染（少量集合）；「全部」区虚拟化（性能门槛：140+ 条时 DOM 有界）
//     - 整页滚动（对齐方案中心），虚拟化经 scrollMargin 挂在页面滚动容器上
//   详情模式：880px 轻量详情页（PromptDetailView），替代旧 320px 常驻检视器
//
// v0.1 的文件夹/标签/评分/智能集/批量操作从 UI 退役（数据保留，FTS5 搜索兜底）。

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  FileText,
  MoreHorizontal,
  Plus,
  Search,
  Trash,
  Upload,
  X,
} from '../components/ui/icons';
import type { Prompt } from '@shared/types/models';
import { useLibraryStore, useNormalPrompts, usePinnedPrompts } from '../features/library/store';
import { useGenerationWorkbenchStore } from '../features/generation/workbench/store';
import { useSettingsStore } from '../features/settings/store';
import { PromptEditor } from '../features/library/components/PromptEditor';
import { PromptDetailView } from '../features/library/components/PromptDetailView';
import { TrashDialog } from '../features/library/components/TrashDialog';
import { toImageSrc } from '../lib/media';
import { formatTime } from '../lib/format';
import { toast } from '../stores/toast';
import { promptParamsToRefineParams } from '../features/generation/promptParams';
import { cn } from '../lib/utils';
import { useAppStore } from '../stores/app';

type PageMode = 'list' | 'detail';

const ROW_GAP = 4;
const COLUMN_GAP = 28;

function usePromptDraft() {
  const openDraft = useGenerationWorkbenchStore((s) => s.openDraft);
  return (prompt: Prompt) => {
    const params = prompt.params ? promptParamsToRefineParams(prompt.params) : undefined;
    openDraft({
      prompt: prompt.content,
      negative: prompt.contentNegative ?? '',
      source: { kind: 'prompt', id: prompt.id, label: prompt.title },
      params,
    });
    toast.success('已送入制作', prompt.title);
  };
}

function PromptRow({
  prompt,
  compact,
  highlighted,
  onOpen,
  onUse,
}: {
  prompt: Prompt;
  compact: boolean;
  highlighted: boolean;
  onOpen: () => void;
  onUse: () => void;
}) {
  return (
    <article
      className={cn(
        'group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 transition-colors hover:bg-hover',
        compact ? 'min-h-[60px] py-1.5' : 'min-h-[76px] py-2',
        highlighted && 'bg-accent-soft',
      )}
      data-prompt-id={prompt.id}
      data-testid="prompt-row"
    >
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        aria-label={`查看${prompt.title}`}
        tabIndex={-1}
      >
        <span
          className={cn(
            'flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-inset/55',
            compact ? 'h-11 w-11' : 'h-14 w-14',
          )}
        >
          {prompt.coverImagePath ? (
            <img src={toImageSrc(prompt.coverImagePath)} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <FileText className="h-4 w-4 text-secondary" aria-hidden="true" />
          )}
        </span>
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 text-left focus-visible:outline-none" data-testid="prompt-row-open">
        <span className="block truncate text-[12.5px] font-semibold text-primary">{prompt.title}</span>
        <span className="mt-0.5 block truncate text-[10.5px] text-tertiary">{prompt.content}</span>
        <span className={cn('flex items-center gap-2 text-[10px] text-secondary', compact ? 'mt-0.5' : 'mt-1.5')}>
          {prompt.usageCount > 0 && <span className="tabular-nums">使用 {prompt.usageCount} 次</span>}
          <span className="text-quaternary">{formatTime(prompt.updatedAt)}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onUse();
        }}
        className="no-drag min-h-8 shrink-0 rounded-md px-2.5 text-[11px] font-medium text-primary transition-colors hover:bg-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        data-testid="prompt-row-use"
      >
        使用
      </button>
    </article>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-2 flex items-center gap-2 border-b border-border-subtle pb-2">
      <h2 className="text-[13px] font-semibold text-primary">{title}</h2>
      <span className="text-[10px] tabular-nums text-tertiary">{count}</span>
    </div>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border-default bg-elevated px-3 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-accent/10">
      <Search className="h-3.5 w-3.5 shrink-0 text-tertiary" />
      <span className="sr-only">搜索提示词</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="搜索提示词"
        placeholder="搜索标题或正文"
        className="min-w-0 flex-1 bg-transparent text-[12px] text-primary outline-none placeholder:text-quaternary"
        data-testid="library-search"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
          aria-label="清空搜索"
          data-testid="library-search-clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </label>
  );
}

export function LibraryPage() {
  const loadAll = useLibraryStore((s) => s.loadAll);
  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const clearFilters = useLibraryStore((s) => s.clearFilters);
  const stats = useLibraryStore((s) => s.stats);
  const loading = useLibraryStore((s) => s.loading);
  const initialized = useLibraryStore((s) => s.initialized);
  const error = useLibraryStore((s) => s.error);
  const clearError = useLibraryStore((s) => s.clearError);
  const selectedPromptId = useLibraryStore((s) => s.selectedPromptId);
  const selectPrompt = useLibraryStore((s) => s.selectPrompt);
  const setTrashOpen = useLibraryStore((s) => s.setTrashOpen);
  const highlightPrompt = useLibraryStore((s) => s.highlightPrompt);
  const highlightPromptId = useLibraryStore((s) => s.highlightPromptId);
  const setFilters = useLibraryStore((s) => s.setFilters);
  // 笺匣（v0.3.3 §8）：source='slip' 的收件箱视图；计数取当前已加载列表
  const slipsOnly = useLibraryStore((s) => s.filters.source === 'slip');
  const slipCount = useLibraryStore((s) => s.prompts.filter((p) => p.source === 'slip').length);
  const pinned = usePinnedPrompts();
  const normal = useNormalPrompts();
  const usePrompt = usePromptDraft();
  const density = useAppStore((s) => s.density);

  const pendingHighlight = useAppStore((s) => s.pendingHighlightPromptId);
  const consumeHighlightPrompt = useAppStore((s) => s.consumeHighlightPrompt);
  const setView = useAppStore((s) => s.setView);

  const [pageMode, setPageMode] = useState<PageMode>('list');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [listOffset, setListOffset] = useState(0);
  const [columns, setColumns] = useState(2);

  const compact = density === 'compact';
  const rowHeight = (compact ? 60 : 76) + ROW_GAP;
  const empty = pinned.length === 0 && normal.length === 0;
  const searching = search.trim() !== '';
  const showList = pageMode === 'list';

  const rowCount = Math.ceil(normal.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
    scrollMargin: listOffset,
  });

  const selectedPrompt = useMemo(
    () => [...pinned, ...normal].find((p) => p.id === selectedPromptId) ?? null,
    [normal, pinned, selectedPromptId],
  );

  useEffect(() => {
    // v0.1 的文件夹/标签筛选已从 UI 退役；进入页面时清掉可能残留的会话内筛选态
    if (useLibraryStore.getState().hasActiveFilters()) clearFilters();
    void loadAll();
  }, [clearFilters, loadAll]);

  // 密度切换改变行高估算，让虚拟化重新量一遍
  useEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight]);

  // 列数跟随内容区宽度（窄窗降为单列）；虚拟化起点跟随上方内容高度
  useLayoutEffect(() => {
    if (!showList) return;
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => {
      setColumns(el.clientWidth >= 760 ? 2 : 1);
      setListOffset(listRef.current?.offsetTop ?? 0);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [showList, pinned.length, empty, Boolean(error)]);

  // Composer「存为提示词」跳过来的高亮意图：消费一次即清，并保证列表可见
  useEffect(() => {
    if (!pendingHighlight) return;
    setPageMode('list');
    void highlightPrompt(pendingHighlight);
    consumeHighlightPrompt();
  }, [pendingHighlight, highlightPrompt, consumeHighlightPrompt]);

  // 高亮条目滚进视野：置顶区常驻用 DOM，「全部」区可能未挂载，走虚拟化跳行
  useEffect(() => {
    if (!highlightPromptId) return;
    const normalIndex = normal.findIndex((p) => p.id === highlightPromptId);
    if (normalIndex >= 0) {
      virtualizer.scrollToIndex(Math.floor(normalIndex / columns), { align: 'center' });
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-prompt-id="${highlightPromptId}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightPromptId, normal, columns]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const openEditor = (p: Prompt | null) => {
    setEditing(p);
    setEditorOpen(true);
  };

  const openDetail = (id: string) => {
    selectPrompt(id);
    setPageMode('detail');
  };

  const openImport = () => {
    setMenuOpen(false);
    useSettingsStore.getState().setSection('data');
    setView('settings');
  };

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    columnGap: `${COLUMN_GAP}px`,
  } as const;

  const renderRow = (p: Prompt) => (
    <PromptRow
      key={p.id}
      prompt={p}
      compact={compact}
      highlighted={highlightPromptId === p.id}
      onOpen={() => openDetail(p.id)}
      onUse={() => usePrompt(p)}
    />
  );

  if (pageMode === 'detail' && selectedPrompt) {
    return (
      <div className="h-full bg-elevated" data-testid="library-page">
        <PromptDetailView
          prompt={selectedPrompt}
          onBack={() => setPageMode('list')}
          onEdit={openEditor}
        />
        <PromptEditor
          open={editorOpen}
          onOpenChange={(o) => {
            setEditorOpen(o);
            if (!o) setEditing(null);
          }}
          prompt={editing}
        />
      </div>
    );
  }

  return (
    <div className="h-full bg-elevated" data-testid="library-page">
      <div ref={scrollRef} className="relative h-full overflow-y-auto" data-testid="prompt-list">
        <div className="mx-auto w-full max-w-[960px] px-6 pb-16 pt-5 max-[640px]:px-4">
          {/* max-[1240px]:pr-12：窄窗口时列边贴近视口右缘，为朱点让出保留区（v0.3.3 §1.2） */}
          <div className="flex items-center gap-3 max-[1240px]:pr-12">
            <h1 className="text-[15px] font-semibold text-primary">提示词库</h1>
            {(slipCount > 0 || slipsOnly) && (
              <button
                type="button"
                data-testid="library-filter-slips"
                data-active={slipsOnly ? 'true' : 'false'}
                aria-pressed={slipsOnly}
                onClick={() => setFilters({ source: slipsOnly ? undefined : 'slip' })}
                className={cn(
                  'no-drag rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                  slipsOnly
                    ? 'border-transparent bg-primary text-background'
                    : 'border-border-subtle bg-transparent text-secondary hover:border-border-default hover:text-primary',
                )}
              >
                笺匣{slipCount > 0 ? ` ${slipCount}` : ''}
              </button>
            )}
            <div className="relative ml-auto flex items-center gap-1" ref={menuRootRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="icon-action h-8 w-8"
                aria-label="更多操作"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="更多操作"
                data-testid="library-menu"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => openEditor(null)}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-background hover:opacity-85"
                data-testid="library-new"
              >
                <Plus className="h-3.5 w-3.5" />
                新建
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-44 rounded-lg border border-border-default bg-popover p-1.5 shadow-pop animate-scale-fade-in" role="menu" aria-label="提示词库操作">
                  <button type="button" role="menuitem" className="menu-action rounded-md" onClick={openImport} data-testid="library-import">
                    <Upload className="h-3.5 w-3.5" /> 导入
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-action rounded-md"
                    onClick={() => {
                      setMenuOpen(false);
                      setTrashOpen(true);
                    }}
                    data-testid="trash-open"
                  >
                    <Trash className="h-3.5 w-3.5" /> 回收站
                    {(stats?.trashed ?? 0) > 0 && (
                      <span className="ml-auto font-mono text-[10px] tabular-nums text-tertiary">{stats.trashed}</span>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5">
            <SearchField value={search} onChange={setSearch} />
          </div>

          {error && (
            <div role="alert" className="mt-4 flex items-center gap-2 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[10.5px] text-danger" data-testid="library-error">
              <span className="min-w-0 flex-1 truncate">{error}</span>
              <button type="button" onClick={clearError} className="shrink-0 hover:opacity-70" aria-label="关闭错误提示">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <div className="mt-7">
            {loading && !initialized ? (
              <div className="py-16 text-center text-[11px] text-tertiary" data-testid="prompt-list-skeleton">
                正在读取提示词…
              </div>
            ) : empty && searching ? (
              <div className="py-16 text-center" data-testid="empty-no-match">
                <Search className="mx-auto h-5 w-5 text-quaternary" />
                <p className="mt-3 text-[12px] text-secondary">没有找到匹配的提示词</p>
                <p className="mt-1 text-[10.5px] text-tertiary">换一个标题或正文关键词试试</p>
              </div>
            ) : empty && slipsOnly ? (
              <div className="py-16 text-center" data-testid="empty-no-slips">
                <span aria-hidden="true" className="ember-seal mx-auto block h-[15px] w-[15px] rounded-full" />
                <p className="mt-4 text-[12px] font-medium text-primary">匣中无笺</p>
                <p className="mx-auto mt-1 max-w-[42ch] text-[10.5px] leading-relaxed text-tertiary">
                  任何页面双击右上角的朱点，随手记一笔。
                </p>
              </div>
            ) : empty ? (
              <div className="py-16 text-center" data-testid="empty-no-prompts">
                <FileText className="mx-auto h-5 w-5 text-quaternary" />
                <p className="mt-3 text-[12px] font-medium text-primary">还没有提示词</p>
                <p className="mx-auto mt-1 max-w-[42ch] text-[10.5px] leading-relaxed text-tertiary">
                  生成满意的结果后可以「存为提示词」，也可以现在新建一条。
                </p>
                <button
                  type="button"
                  onClick={() => openEditor(null)}
                  className="mt-5 inline-flex min-h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-background hover:opacity-85"
                  data-testid="empty-new"
                >
                  <Plus className="h-3.5 w-3.5" />
                  新建
                </button>
              </div>
            ) : (
              <>
                {pinned.length > 0 && (
                  <section className="mb-7" data-testid="pinned-section">
                    <SectionHeading title="置顶" count={pinned.length} />
                    <div style={{ ...gridStyle, rowGap: `${ROW_GAP}px` }}>{pinned.map(renderRow)}</div>
                  </section>
                )}
                {normal.length > 0 && (
                  <section>
                    <SectionHeading title="全部" count={normal.length} />
                    <div
                      ref={listRef}
                      style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
                    >
                      {virtualizer.getVirtualItems().map((v) => (
                        <div
                          key={v.key}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)`,
                            ...gridStyle,
                          }}
                        >
                          {normal.slice(v.index * columns, v.index * columns + columns).map(renderRow)}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <PromptEditor
        open={editorOpen}
        onOpenChange={(o) => {
          setEditorOpen(o);
          if (!o) setEditing(null);
        }}
        prompt={editing}
      />

      <TrashDialog />
    </div>
  );
}
