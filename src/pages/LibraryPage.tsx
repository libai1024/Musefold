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
  PromptLibraryScreen,
  PromptLibraryHeaderActions,
  PromptListRow,
  PromptSectionHeading,
  type PromptListItemViewModel,
} from '@musefold/product-ui';
import {
  FileText,
  Plus,
  Search,
  Upload,
  X,
} from '../components/ui/icons';
import type { Prompt } from '@shared/types/models';
import {
  useLibraryStore,
  useNormalPrompts,
  usePinnedPrompts,
} from '../features/library/store';
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
    const params = prompt.params
      ? promptParamsToRefineParams(prompt.params)
      : undefined;
    openDraft({
      prompt: prompt.content,
      negative: prompt.contentNegative ?? '',
      source: { kind: 'prompt', id: prompt.id, label: prompt.title },
      params,
    });
    toast.success('已送入制作', prompt.title);
  };
}

function toPromptListItem(prompt: Prompt): PromptListItemViewModel {
  return {
    id: prompt.id,
    title: prompt.title,
    content: prompt.content,
    description: prompt.description,
    imageUrl: prompt.coverImagePath ? toImageSrc(prompt.coverImagePath) : null,
    usageCount: prompt.usageCount,
    updatedAtLabel: formatTime(prompt.updatedAt),
    tags: prompt.tags.map((tag) => tag.name),
    isPinned: prompt.isPinned,
  };
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
  const copyContent = useLibraryStore((s) => s.copyContent);
  const selectedPromptId = useLibraryStore((s) => s.selectedPromptId);
  const selectPrompt = useLibraryStore((s) => s.selectPrompt);
  const setTrashOpen = useLibraryStore((s) => s.setTrashOpen);
  const highlightPrompt = useLibraryStore((s) => s.highlightPrompt);
  const highlightPromptId = useLibraryStore((s) => s.highlightPromptId);
  const setFilters = useLibraryStore((s) => s.setFilters);
  // 笺匣（v0.3.3 §8）：source='slip' 的收件箱视图；计数取当前已加载列表
  const slipsOnly = useLibraryStore((s) => s.filters.source === 'slip');
  const slipCount = useLibraryStore(
    (s) => s.prompts.filter((p) => p.source === 'slip').length,
  );
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
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [listOffset, setListOffset] = useState(0);
  const [columns, setColumns] = useState(2);

  const compact = density === 'compact';
  // 紧凑行的摘要在双列窄宽度下可能占两行，估算必须覆盖实际内容高度，
  // 否则虚拟行会在快速滚动或密度切换时发生重叠。
  const rowHeight = (compact ? 72 : 76) + ROW_GAP;
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
      virtualizer.scrollToIndex(Math.floor(normalIndex / columns), {
        align: 'center',
      });
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

  const openEditor = (p: Prompt | null) => {
    setEditing(p);
    setEditorOpen(true);
  };

  const openDetail = (id: string) => {
    selectPrompt(id);
    setPageMode('detail');
  };

  const openImport = () => {
    useSettingsStore.getState().setSection('data');
    setView('settings');
  };

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    columnGap: `${COLUMN_GAP}px`,
  } as const;

  const renderRow = (p: Prompt) => (
    <PromptListRow
      key={p.id}
      prompt={toPromptListItem(p)}
      compact={compact}
      highlighted={highlightPromptId === p.id}
      copied={copiedPromptId === p.id}
      onOpen={() => openDetail(p.id)}
      onCopy={() => {
        void copyContent(p.id).then((copied) => {
          if (!copied) return;
          setCopiedPromptId(p.id);
          window.setTimeout(() => {
            setCopiedPromptId((current) => current === p.id ? null : current);
          }, 1_200);
        });
      }}
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
    <div className="h-full bg-elevated" data-testid="library-shell">
      <div
        ref={scrollRef}
        className="relative h-full overflow-y-auto px-6 pb-16 pt-5 max-[640px]:px-4"
        data-testid="prompt-list"
      >
        <PromptLibraryScreen
          prompts={[...pinned, ...normal].map(toPromptListItem)}
          query={search}
          onQueryChange={setSearch}
          headerAction={
            <PromptLibraryHeaderActions
              onCreate={() => openEditor(null)}
              onOpenTrash={() => setTrashOpen(true)}
              trashCount={stats?.trashed ?? 0}
              trashTestId="trash-open"
              extraMenuItems={(closeMenu) => (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      openImport();
                    }}
                    data-testid="library-import"
                  >
                    <Upload aria-hidden="true" /> 导入
                  </button>
              )}
            />
          }
          toolbarExtra={
            (slipCount > 0 || slipsOnly) ? (
              <button
                type="button"
                data-testid="library-filter-slips"
                data-active={slipsOnly ? 'true' : 'false'}
                aria-pressed={slipsOnly}
                onClick={() =>
                  setFilters({ source: slipsOnly ? undefined : 'slip' })
                }
                className={cn(
                  'no-drag rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                  slipsOnly
                    ? 'border-transparent bg-primary text-background'
                    : 'border-border-subtle bg-transparent text-secondary hover:border-border-default hover:text-primary',
                )}
              >
                笺匣{slipCount > 0 ? ` ${slipCount}` : ''}
              </button>
            ) : null
          }
          body={
            <div className="mt-1">
              {error && (
                <div
                  role="alert"
                  className="mt-4 flex items-center gap-2 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[10.5px] text-danger"
                  data-testid="library-error"
                >
                  <span className="min-w-0 flex-1 truncate">{error}</span>
                  <button
                    type="button"
                    onClick={clearError}
                    className="shrink-0 hover:opacity-70"
                    aria-label="关闭错误提示"
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              )}

              <div className="mt-7">
            {loading && !initialized ? (
              <div
                className="py-16 text-center text-[11px] text-tertiary"
                data-testid="prompt-list-skeleton"
              >
                正在读取提示词…
              </div>
            ) : empty && searching ? (
              <div className="py-16 text-center" data-testid="empty-no-match">
                <Search className="mx-auto h-5 w-5 text-quaternary" />
                <p className="mt-3 text-[12px] text-secondary">
                  没有找到匹配的提示词
                </p>
                <p className="mt-1 text-[10.5px] text-tertiary">
                  换一个标题或正文关键词试试
                </p>
              </div>
            ) : empty && slipsOnly ? (
              <div className="py-16 text-center" data-testid="empty-no-slips">
                <span
                  aria-hidden="true"
                  className="ember-seal mx-auto block h-[15px] w-[15px] rounded-full"
                />
                <p className="mt-4 text-[12px] font-medium text-primary">
                  匣中无笺
                </p>
                <p className="mx-auto mt-1 max-w-[42ch] text-[10.5px] leading-relaxed text-tertiary">
                  任何页面双击右上角的朱点，随手记一笔。
                </p>
              </div>
            ) : empty ? (
              <div className="py-16 text-center" data-testid="empty-no-prompts">
                <FileText className="mx-auto h-5 w-5 text-quaternary" />
                <p className="mt-3 text-[12px] font-medium text-primary">
                  还没有提示词
                </p>
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
                    <PromptSectionHeading title="置顶" count={pinned.length} />
                    <div style={{ ...gridStyle, rowGap: `${ROW_GAP}px` }}>
                      {pinned.map(renderRow)}
                    </div>
                  </section>
                )}
                {normal.length > 0 && (
                  <section>
                    <PromptSectionHeading title="全部" count={normal.length} />
                    <div
                      ref={listRef}
                      style={{
                        height: `${virtualizer.getTotalSize()}px`,
                        position: 'relative',
                      }}
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
                          {normal
                            .slice(
                              v.index * columns,
                              v.index * columns + columns,
                            )
                            .map(renderRow)}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
              )}
              </div>
            </div>
          }
        />
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
