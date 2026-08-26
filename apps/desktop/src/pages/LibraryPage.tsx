// src/pages/LibraryPage.tsx
// 提示词库 —— v0.3.2 重塑：960px 居中紧凑列表，版式对齐方案中心。
//
// 结构：
//   列表模式：分区（置顶 / 全部）+ 紧凑行（缩略图 + 标题/预览/元信息 + 行尾「使用」）
//     - 置顶区常驻渲染（少量集合）；「全部」区虚拟化（性能门槛：140+ 条时 DOM 有界）
//     - 整页滚动（对齐方案中心），虚拟化经 scrollMargin 挂在页面滚动容器上
//   详情模式：右侧 404px Inspector，与方案中心保持一致；窄屏切换为单页详情
//
// v0.1 的文件夹/标签/评分/智能集/批量操作从 UI 退役（数据保留，FTS5 搜索兜底）。

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { DropdownMenuItem } from '@musefold/ui';
import {
  PromptLibraryScreen,
  PromptLibraryHeaderActions,
  PromptListRow,
  PromptSectionHeading,
  useLibraryPageController,
  type PromptListItemViewModel,
} from '@musefold/product-ui';
import { FileText, Plus, Search, Upload, X } from '../components/ui/icons';
import type { DesktopLibraryPrompt } from '@musefold/desktop-contracts/library-documents';
import { useLibraryStatsQuery } from '../features/library/use-library-queries';
import {
  getLibraryDesktopExtras,
  selectNormal,
  selectPinned,
  useLibraryStore,
} from '../features/library/store';
import { useGenerationWorkbenchStore } from '../features/generation/workbench/store';
import { desktopGateway } from '../runtime';
import { desktopPlatformServices } from '../runtime/platform-services';
import { useSettingsStore } from '../features/settings/store';
import { PromptEditor } from '../features/library/components/PromptEditor';
import { PromptDetailView } from '../features/library/components/PromptDetailView';
import { TrashDialog } from '../features/library/components/TrashDialog';
import { toImageSrc } from '../lib/media';
import { formatTime } from '../lib/format';
import { toast } from '../stores/toast';
import { promptParamsToRefineParams } from '../lib/prompt-params';
import { useAppStore } from '../stores/app';

type PageMode = 'list' | 'detail';

const ROW_GAP = 4;
const COLUMN_GAP = 28;

function usePromptDraft() {
  const openDraft = useGenerationWorkbenchStore((s) => s.openDraft);
  return (prompt: DesktopLibraryPrompt) => {
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

function toPromptListItem(prompt: DesktopLibraryPrompt): PromptListItemViewModel {
  return {
    id: prompt.id,
    title: prompt.title,
    content: prompt.content,
    description: prompt.description,
    imageUrl: prompt.coverImagePath ? toImageSrc(prompt.coverImagePath) : null,
    usageCount: prompt.usageCount,
    updatedAtLabel: formatTime(prompt.updatedAtMs),
    tags: prompt.tags.map((tag) => tag.name),
    isPinned: prompt.isPinned,
  };
}

export function LibraryPage() {
  const loadAll = useLibraryStore((s) => s.loadAll);
  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const clearFilters = useLibraryStore((s) => s.clearFilters);
  const queryStats = useLibraryStatsQuery();
  const storeStats = useLibraryStore((s) => s.stats);
  const stats = queryStats ?? storeStats;
  const listQuery = useLibraryStore((s) => s.listQuery);
  const page = useLibraryPageController<DesktopLibraryPrompt>({
    prompts: desktopGateway,
    platform: desktopPlatformServices,
    listKey: listQuery,
    listFn: () => getLibraryDesktopExtras().listLibraryPrompts(listQuery),
  });
  const { loading, initialized, error, prompts } = {
    loading: page.loading,
    initialized: page.initialized,
    error: page.error,
    prompts: page.items,
  };
  const pinned = useMemo(() => selectPinned({ prompts }), [prompts]);
  const normal = useMemo(() => selectNormal({ prompts }), [prompts]);
  const clearError = useLibraryStore((s) => s.clearError);
  const copyContent = useLibraryStore((s) => s.copyContent);
  const selectedPromptId = useLibraryStore((s) => s.selectedPromptId);
  const selectPrompt = useLibraryStore((s) => s.selectPrompt);
  const setTrashOpen = useLibraryStore((s) => s.setTrashOpen);
  const highlightPrompt = useLibraryStore((s) => s.highlightPrompt);
  const highlightPromptId = useLibraryStore((s) => s.highlightPromptId);
  const setFilters = useLibraryStore((s) => s.setFilters);
  const slipsOnly = useLibraryStore((s) => s.filters.source === 'slip');
  const slipCount = prompts.filter((p) => p.source === 'slip').length;
  const usePrompt = usePromptDraft();
  const density = useAppStore((s) => s.density);

  const pendingHighlight = useAppStore((s) => s.pendingHighlightPromptId);
  const consumeHighlightPrompt = useAppStore((s) => s.consumeHighlightPrompt);
  const setView = useAppStore((s) => s.setView);

  const [pageMode, setPageMode] = useState<PageMode>('list');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DesktopLibraryPrompt | null>(null);
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
  const showPromptGroupHeadings = pinned.length > 0 && normal.length > 0;
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
  const inspectorOpen = pageMode === 'detail' && Boolean(selectedPrompt);

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
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => {
      setColumns(inspectorOpen ? 1 : el.clientWidth >= 760 ? 2 : 1);
      setListOffset(listRef.current?.offsetTop ?? 0);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [inspectorOpen, pinned.length, empty, Boolean(error)]);

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

  const openEditor = (p: DesktopLibraryPrompt | null) => {
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

  const renderRow = (p: DesktopLibraryPrompt) => (
    <PromptListRow
      key={p.id}
      prompt={toPromptListItem(p)}
      compact={compact}
      highlighted={
        highlightPromptId === p.id || (pageMode === 'detail' && selectedPromptId === p.id)
      }
      copied={copiedPromptId === p.id}
      onOpen={() => openDetail(p.id)}
      onCopy={() => {
        void copyContent(p.id).then((copied) => {
          if (!copied) return;
          setCopiedPromptId(p.id);
          window.setTimeout(() => {
            setCopiedPromptId((current) => (current === p.id ? null : current));
          }, 1_200);
        });
      }}
      // eslint-disable-next-line react-hooks/rules-of-hooks -- usePrompt 是 usePromptDraft() 在组件顶层返回的回调，不是 Hook；规则因 use* 命名误报。
      onUse={() => usePrompt(p)}
    />
  );

  return (
    <div className="h-full bg-work" data-testid="library-shell">
      <div className="mf-library-workspace" data-inspector-open={inspectorOpen ? 'true' : 'false'}>
        <div
          ref={scrollRef}
          className="mf-library-list-pane mf-workspace-list-pane relative h-full min-w-0 flex-1 overflow-y-auto"
          data-testid="prompt-list"
        >
          <PromptLibraryScreen
            className={`mf-workspace-list-content${inspectorOpen ? ' mf-workspace-list-content-wide' : ''}`}
            prompts={[...pinned, ...normal].map(toPromptListItem)}
            query={search}
            onQueryChange={setSearch}
            showPageHeader={false}
            scopeNavigation={
              <div className="mf-workspace-scope-tabs" role="tablist" aria-label="提示词范围">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!slipsOnly}
                  onClick={() => setFilters({ source: undefined })}
                  className="mf-workspace-scope-tab"
                  data-testid="library-filter-all"
                >
                  <span>全部</span>
                  <span className="mf-workspace-scope-count">{stats?.total ?? prompts.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={slipsOnly}
                  onClick={() => setFilters({ source: 'slip' })}
                  className="mf-workspace-scope-tab"
                  data-testid="library-filter-slips"
                >
                  <span>笺匣</span>
                  <span className="mf-workspace-scope-count">{slipCount}</span>
                </button>
              </div>
            }
            headerAction={
              <PromptLibraryHeaderActions
                onCreate={() => openEditor(null)}
                onRefresh={async () => {
                  await Promise.all([page.refetch(), loadAll()]);
                }}
                refreshing={loading}
                onOpenTrash={() => setTrashOpen(true)}
                trashCount={stats?.trashed ?? 0}
                trashTestId="trash-open"
                extraMenuItems={(closeMenu) => (
                  <DropdownMenuItem
                    onSelect={() => {
                      closeMenu();
                      openImport();
                    }}
                    data-testid="library-import"
                  >
                    <Upload aria-hidden="true" /> 导入
                  </DropdownMenuItem>
                )}
              />
            }
            body={
              <div className="mt-1">
                {error && (
                  <div
                    role="alert"
                    className="mt-4 flex items-center gap-2 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-meta text-danger"
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
                      <p className="mt-3 text-[12px] text-secondary">没有找到匹配的提示词</p>
                      <p className="mt-1 text-meta text-tertiary">换一个标题或正文关键词试试</p>
                    </div>
                  ) : empty && slipsOnly ? (
                    <div className="py-16 text-center" data-testid="empty-no-slips">
                      <span
                        aria-hidden="true"
                        className="ember-seal mx-auto block h-[15px] w-[15px] rounded-full"
                      />
                      <p className="mt-4 text-[12px] font-medium text-primary">匣中无笺</p>
                      <p className="mx-auto mt-1 max-w-[42ch] text-meta leading-relaxed text-tertiary">
                        任何页面双击右上角的朱点，随手记一笔。
                      </p>
                    </div>
                  ) : empty ? (
                    <div className="py-16 text-center" data-testid="empty-no-prompts">
                      <FileText className="mx-auto h-5 w-5 text-quaternary" />
                      <p className="mt-3 text-[12px] font-medium text-primary">还没有提示词</p>
                      <p className="mx-auto mt-1 max-w-[42ch] text-meta leading-relaxed text-tertiary">
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
                        <section
                          className={normal.length > 0 ? 'mb-7' : undefined}
                          data-testid="pinned-section"
                        >
                          {showPromptGroupHeadings ? (
                            <PromptSectionHeading title="置顶" count={pinned.length} />
                          ) : null}
                          <div style={{ ...gridStyle, rowGap: `${ROW_GAP}px` }}>
                            {pinned.map(renderRow)}
                          </div>
                        </section>
                      )}
                      {normal.length > 0 && (
                        <section>
                          {showPromptGroupHeadings ? (
                            <PromptSectionHeading title="全部" count={normal.length} />
                          ) : null}
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
                                ref={virtualizer.measureElement}
                                data-index={v.index}
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  width: '100%',
                                  paddingBottom: `${ROW_GAP}px`,
                                  transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)`,
                                  ...gridStyle,
                                }}
                              >
                                {normal
                                  .slice(v.index * columns, v.index * columns + columns)
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

        {inspectorOpen && selectedPrompt ? (
          <aside
            className="mf-library-inspector-shell mf-workspace-inspector-shell"
            aria-label="提示词详情"
            data-testid="prompt-inspector"
          >
            <div className="mf-library-inspector mf-workspace-inspector">
              <PromptDetailView
                prompt={selectedPrompt}
                layout="inspector"
                onBack={() => setPageMode('list')}
                onEdit={openEditor}
              />
            </div>
          </aside>
        ) : null}
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
