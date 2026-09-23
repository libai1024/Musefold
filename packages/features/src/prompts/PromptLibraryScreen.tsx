'use client';

import type { GenerationJob, PromptDocument, PromptListQuery } from '@musefold/contracts';
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
import { Button } from '@musefold/ui/components/button';
import { Input } from '@musefold/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { Sheet, SheetContent, SheetTitle } from '@musefold/ui/components/sheet';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@musefold/ui/components/tabs';
import { Library, Plus, Search, Trash2 } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  buildSchemeCreateSeedFromPrompt,
  useSchemeIntegration,
} from '../design-schemes/integration-store';
import { useScreenIntent } from '../shell/screen-intent-store';
import { useMediaQuery } from '../shell/sidebar-layout';
import {
  promptRowEstimate,
  useDocumentDensity,
  canMeasureVirtualRows,
  useListVirtualizer,
  VirtualListFrame,
  VIRTUAL_LIST_THRESHOLD,
} from '../shell/use-virtual-rows';
import { PromptDetailInspector } from './PromptDetailInspector';
import { PromptEditorDialog, editorValueToNewDocument } from './PromptEditorDialog';
import { PromptListRow } from './PromptListRow';
import { TaxonomyManager } from './TaxonomyManager';
import { toast } from '@musefold/ui/components/sonner';
import { useActiveSession } from '../workbench/session-store';
import {
  copyPromptContent,
  promptToWorkbenchDraft,
  useCreatePrompt,
  useEmptyPromptTrash,
  usePromptFolders,
  usePromptList,
  usePromptTags,
  usePurgePrompt,
  useRemovePrompt,
  useRestorePrompt,
  useUpdatePrompt,
  useUsePrompt,
} from './hooks';

type LibraryTab = 'library' | 'trash';
type LibrarySort = NonNullable<PromptListQuery['sort']>;

const ALL_FOLDERS = '__all__';
const UNFILED = '__unfiled__';
/** 「全部」/回收站双列:视口 ≥760px 且详情关闭(旧 LibraryPage 几何)。置顶始终单列。 */
const LIBRARY_DUAL_COLUMN_QUERY = '(min-width: 760px)';

const SORT_LABELS: Record<LibrarySort, string> = {
  'updated-desc': '最近更新',
  'created-desc': '最近创建',
  'usage-desc': '最常使用',
  'title-asc': '标题 A→Z',
};

interface RowSection {
  key: string;
  title: string | null;
  items: PromptDocument[];
}

/** 「全部」/回收站流:1 列或 2 列同一套格子,虚拟行与小库常驻列表共用。 */
function PromptFlowRow({
  columns,
  items,
  children,
}: {
  columns: 1 | 2;
  items: PromptDocument[];
  children: (prompt: PromptDocument) => ReactNode;
}) {
  return (
    <div className={cn('grid gap-y-1', columns === 2 ? 'grid-cols-2 gap-x-7' : 'grid-cols-1')}>
      {items.map((prompt) => children(prompt))}
    </div>
  );
}

/** 「/」聚焦搜索的输入态判定:输入框/文本域/可编辑区内不抢键。 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface PromptLibraryScreenProps {
  /** 「使用」送稿后的切屏回调(宿主注入:切工作台视图/路由)。 */
  onOpenWorkbench?(): void;
  /**
   * 详情「相关作品」缩略跳历史屏(宿主注入切屏);未注入时缩略退成只读画廊。
   * 选中哪条经 screen-intent `history-select` 传给历史屏。
   */
  onOpenHistory?(): void;
}

/**
 * 提示词库屏幕 —— v2.5 第一个数据域,双宿主同一份。
 * 信息架构承自 v2.0:页头计数、搜索工具条、「置顶/全部」分节列表、
 * 回收站独立视图;行点击开右侧详情 Inspector(md+ 内嵌 / 窄屏 Sheet)。
 * 数据经 MusefoldGateway,组件全部走语义 token。
 */
export function PromptLibraryScreen({
  onOpenWorkbench,
  onOpenHistory,
}: PromptLibraryScreenProps = {}) {
  const [tab, setTab] = useState<LibraryTab>('library');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LibrarySort>('updated-desc');
  const [folderFilter, setFolderFilter] = useState<string>(ALL_FOLDERS);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PromptDocument | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<PromptDocument | null>(null);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isWideLibrary = useMediaQuery(LIBRARY_DUAL_COLUMN_QUERY);

  // 「存为提示词 → 查看」落点(03/05 §7):高亮新条目 2s 渐隐,一次性。
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const intent = useScreenIntent((s) => s.intent);
  const consumeIntent = useScreenIntent((s) => s.consume);
  const setIntent = useScreenIntent((s) => s.setIntent);
  useEffect(() => {
    // 依赖 intent 本身:⌘K 在本屏已挂载时重复触发也要每次消费(不只 mount 一次)。
    if (!intent) return;
    if (consumeIntent('prompts-trash')) setTab('trash');
    const highlight = consumeIntent('prompt-highlight');
    if (highlight) setHighlightId(highlight.promptId);
    if (consumeIntent('prompts-focus-search')) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [intent, consumeIntent]);

  const deferredSearch = useDeferredValue(search);

  const query = useMemo<Omit<PromptListQuery, 'cursor'>>(
    () => ({
      q: deferredSearch.trim() || undefined,
      sort,
      limit: 30,
      folderId:
        folderFilter === ALL_FOLDERS ? undefined : folderFilter === UNFILED ? null : folderFilter,
      tagIds: tagFilter.length > 0 ? tagFilter : undefined,
      deletedOnly: tab === 'trash' ? true : undefined,
    }),
    [deferredSearch, sort, folderFilter, tagFilter, tab],
  );

  const list = usePromptList(query);
  const folders = usePromptFolders();
  const tags = usePromptTags();
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const removePrompt = useRemovePrompt();
  const restorePrompt = useRestorePrompt();
  const purgePrompt = usePurgePrompt();
  const emptyTrash = useEmptyPromptTrash();
  const usePromptAction = useUsePrompt();

  const sections = useMemo<RowSection[]>(() => {
    const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
    if (tab === 'trash') {
      // 宿主先筛选回收站再分页，保留对错误 gateway 数据的防御性检查。
      return [{ key: 'trash', title: null, items: rows.filter((row) => row.deletedAt != null) }];
    }
    const pinned = rows.filter((row) => row.isPinned);
    const rest = rows.filter((row) => !row.isPinned);
    if (pinned.length === 0) return [{ key: 'all', title: null, items: rest }];
    return [
      { key: 'pinned', title: '置顶', items: pinned },
      { key: 'all', title: '全部', items: rest },
    ];
  }, [list.data, tab]);

  const totalCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  const hasActiveFilter =
    search.trim().length > 0 || folderFilter !== ALL_FOLDERS || tagFilter.length > 0;

  const detailPrompt = useMemo(
    () => sections.flatMap((section) => section.items).find((row) => row.id === detailId) ?? null,
    [sections, detailId],
  );
  // 详情目标被删/被恢复而离开当前视图时收面板,不留悬空 Inspector。
  useEffect(() => {
    if (detailId && !detailPrompt && list.isSuccess) setDetailId(null);
  }, [detailId, detailPrompt, list.isSuccess]);
  const listColumns: 1 | 2 = isWideLibrary && detailPrompt == null ? 2 : 1;

  function clearFilters() {
    setSearch('');
    setFolderFilter(ALL_FOLDERS);
    setTagFilter([]);
  }

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(prompt: PromptDocument) {
    setEditing(prompt);
    setEditorOpen(true);
  }

  async function handleCopy(prompt: PromptDocument) {
    await copyPromptContent(prompt);
    usePromptAction.mutate({ id: prompt.id, input: { action: 'copy' } });
    toast.success('已复制到剪贴板', { description: prompt.title });
  }

  const setPendingDraft = useActiveSession((s) => s.setPendingDraft);

  /** 「使用」:送工作台草稿 + 使用计数 + 切屏(承旧「已送入制作」闭环)。 */
  function handleUse(prompt: PromptDocument) {
    setPendingDraft(promptToWorkbenchDraft(prompt));
    usePromptAction.mutate({ id: prompt.id, input: { action: 'apply' } });
    toast.success('已送入制作', { description: prompt.title });
    onOpenWorkbench?.();
  }

  // 「创建方案」(承 v2.1 详情页菜单):方案域能力 + 宿主切屏回调齐备才出现行钮。
  const capabilities = useCapabilities();
  const canCreateScheme = capabilities.hasDesignSchemes && Boolean(onOpenWorkbench);

  /**
   * 提示词 → 方案创建意图:种子文案逐字承旧(整理固定规则/必需变量/本次补充),
   * 来源上下文(promptId/标题)随意图保留;工作台消费后进 design-plan 创建态,
   * 真正的编译由宿主创建管线承接,此处不伪造。
   */
  function handleCreateScheme(prompt: PromptDocument) {
    useSchemeIntegration.getState().setWorkbenchIntent({
      kind: 'create',
      createKind: 'prompt',
      seed: buildSchemeCreateSeedFromPrompt(prompt),
      source: { kind: 'prompt', promptId: prompt.id, title: prompt.title },
    });
    toast.success('已送入工作台', { description: '补充方案想法后提交,由创建管线编译草稿。' });
    onOpenWorkbench?.();
  }

  function handleTogglePin(prompt: PromptDocument) {
    updatePrompt.mutate({
      id: prompt.id,
      patch: { isPinned: !prompt.isPinned, expectedVersion: prompt.version },
    });
  }

  /** 相关作品缩略 → 历史屏并选中该回合(历史屏 mount 时消费 history-select)。 */
  function handleOpenWork(job: GenerationJob) {
    setIntent({ kind: 'history-select', jobId: job.id });
    onOpenHistory?.();
  }

  // 「/」在非输入态聚焦搜索框(shortcuts.ts 登记 prompts-focus-search)。
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // 滚动哨兵:列表底部进入视口即自动取下一页(「加载更多」钮保留为键盘/无 IO 回退)。
  // 「全部」/回收站 >150 行才虚拟化;置顶分节常驻。
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualListRef = useRef<HTMLDivElement>(null);
  const hasNextPage = list.hasNextPage && !list.isError;
  const isFetchingNextPage = list.isFetchingNextPage;
  const fetchNextPage = list.fetchNextPage;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const density = useDocumentDensity();
  const useWindowScroll = canMeasureVirtualRows() && !isDesktop;
  const [scrollMargin, setScrollMargin] = useState(0);
  const virtualSection = useMemo(
    () =>
      sections.find(
        (section) => section.key !== 'pinned' && section.items.length > VIRTUAL_LIST_THRESHOLD,
      ) ?? null,
    [sections],
  );
  const shouldVirtualize = virtualSection != null;

  useLayoutEffect(() => {
    if (!shouldVirtualize) return;
    const list = virtualListRef.current;
    if (!list) return;
    const update = () => {
      if (useWindowScroll) {
        setScrollMargin(list.getBoundingClientRect().top + window.scrollY);
        return;
      }
      const scroll = scrollRef.current;
      if (!scroll) return;
      setScrollMargin(
        list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop,
      );
    };
    update();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(update);
    observer.observe(list);
    const scroll = scrollRef.current;
    if (scroll) observer.observe(scroll);
    return () => observer.disconnect();
  }, [shouldVirtualize, useWindowScroll]);

  const virtualizer = useListVirtualizer({
    count: virtualSection ? Math.ceil(virtualSection.items.length / listColumns) : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => promptRowEstimate(density),
    scrollMargin,
    useWindowScroll,
  });

  const previousListColumns = useRef(listColumns);
  useLayoutEffect(() => {
    if (previousListColumns.current === listColumns) return;
    previousListColumns.current = listColumns;
    virtualizer.measure();
  }, [listColumns, virtualizer]);

  useEffect(() => {
    if (!highlightId || !virtualSection) return;
    const index = virtualSection.items.findIndex((prompt) => prompt.id === highlightId);
    if (index >= 0) virtualizer.scrollToIndex(Math.floor(index / listColumns), { align: 'center' });
  }, [highlightId, virtualSection, virtualizer, listColumns]);

  function renderPromptRow(prompt: PromptDocument) {
    return (
      <PromptListRow
        key={prompt.id}
        prompt={prompt}
        highlighted={prompt.id === highlightId}
        selected={prompt.id === detailId}
        onOpen={(target) => setDetailId(target.id)}
        onUse={handleUse}
        onEdit={openEdit}
        onCopy={handleCopy}
        onTogglePin={handleTogglePin}
        onRemove={(target) => removePrompt.mutate(target.id)}
        onRestore={(target) => restorePrompt.mutate(target.id)}
        onPurge={setPurgeTarget}
        onCreateScheme={canCreateScheme ? handleCreateScheme : undefined}
      />
    );
  }

  const queryError = (
    <div
      className="flex flex-col items-center gap-2 py-6 text-sm"
      role="alert"
      data-testid="prompt-error"
    >
      <p className="font-medium text-destructive">提示词加载失败</p>
      <p className="text-muted-foreground">请重试加载。</p>
      <Button
        variant="outline"
        disabled={list.isFetching}
        onClick={() => void list.refetch()}
        data-testid="prompt-retry"
      >
        重试
      </Button>
    </div>
  );

  const inspector = detailPrompt && (
    <PromptDetailInspector
      prompt={detailPrompt}
      onClose={() => setDetailId(null)}
      onUse={handleUse}
      onEdit={openEdit}
      onCopy={(target) => void handleCopy(target)}
      onTogglePin={handleTogglePin}
      onRemove={(target) => removePrompt.mutate(target.id)}
      onRestore={(target) => restorePrompt.mutate(target.id)}
      onOpenWork={onOpenHistory ? handleOpenWork : undefined}
    />
  );

  return (
    <div className="flex h-full min-h-0" data-testid="prompt-library">
      <div
        ref={scrollRef}
        className="min-w-0 flex-1 overflow-y-auto"
        data-testid="prompt-list-scroll"
      >
        <div
          className={cn(
            'mx-auto flex w-full flex-col gap-4 p-4 md:p-6',
            // 详情开启时列表转单列(不再居中留白),关闭时回到 3xl 阅读宽度。
            detailPrompt ? 'max-w-none' : 'max-w-3xl',
          )}
        >
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <h1 className="font-semibold text-foreground text-xl">提示词库</h1>
              {list.isSuccess && (
                <span className="text-muted-foreground text-sm" data-testid="prompt-count">
                  {totalCount} 条
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {tab === 'trash' && totalCount > 0 && (
                <Button
                  variant="outline"
                  className="gap-1.5 text-muted-foreground hover:text-destructive"
                  data-testid="prompt-empty-trash"
                  onClick={() => setEmptyTrashOpen(true)}
                >
                  <Trash2 className="size-4" /> 清空回收站
                </Button>
              )}
              <Button onClick={openCreate} data-testid="prompt-create">
                <Plus className="size-4" /> 新建提示词
              </Button>
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={tab} onValueChange={(next) => setTab(next as LibraryTab)}>
              <TabsList>
                <TabsTrigger value="library" data-testid="prompt-tab-all">
                  库
                </TabsTrigger>
                <TabsTrigger value="trash" data-testid="prompt-tab-trash">
                  回收站
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="relative min-w-40 flex-1">
              <Search
                className="absolute top-2.5 left-2.5 size-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={searchRef}
                value={search}
                data-testid="prompt-search"
                placeholder="搜索标题、正文或标签"
                className="pl-8"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <Select value={sort} onValueChange={(next) => setSort(next as LibrarySort)}>
              <SelectTrigger className="w-32" data-testid="prompt-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as LibrarySort[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={folderFilter} onValueChange={setFolderFilter}>
              <SelectTrigger className="w-36" data-testid="prompt-folder-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FOLDERS}>全部文件夹</SelectItem>
                <SelectItem value={UNFILED}>未整理</SelectItem>
                {(folders.data ?? []).map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <TaxonomyManager folders={folders.data ?? []} tags={tags.data ?? []} />
          </div>

          {(tags.data?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid="prompt-tag-filter">
              {(tags.data ?? []).map((tag) => {
                const selected = tagFilter.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() =>
                      setTagFilter((prev) =>
                        selected ? prev.filter((id) => id !== tag.id) : [...prev, tag.id],
                      )
                    }
                  >
                    <Badge
                      variant={selected ? 'default' : 'outline'}
                      className={cn('cursor-pointer', !selected && 'text-muted-foreground')}
                    >
                      {tag.name}
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}

          {list.isPending ? (
            <div className="flex flex-col gap-2" data-testid="prompt-loading">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton key={index} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : list.isError && totalCount === 0 ? (
            queryError
          ) : totalCount === 0 ? (
            <div
              className="flex flex-col items-center gap-2 py-16 text-muted-foreground"
              data-testid="prompt-empty"
            >
              <Library className="size-8" aria-hidden />
              {hasActiveFilter ? (
                <>
                  <p className="text-sm">没有匹配的提示词</p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="prompt-clear-filters"
                      onClick={clearFilters}
                    >
                      清除筛选
                    </Button>
                    <Button
                      size="sm"
                      data-testid="prompt-empty-filtered-create"
                      onClick={openCreate}
                    >
                      <Plus className="size-4" /> 新建提示词
                    </Button>
                  </div>
                </>
              ) : tab === 'trash' ? (
                <p className="text-sm">回收站是空的</p>
              ) : (
                <>
                  <p className="text-sm">还没有提示词,新建一条开始</p>
                  <Button size="sm" data-testid="prompt-empty-create" onClick={openCreate}>
                    <Plus className="size-4" /> 新建提示词
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div
              className="flex flex-col gap-4"
              data-testid="prompt-grid"
              data-columns={String(listColumns)}
              data-virtualized={shouldVirtualize ? 'true' : undefined}
              role="list"
            >
              {sections.map((section) => {
                if (section.items.length === 0) return null;
                const virtualize =
                  section.key !== 'pinned' && section.items.length > VIRTUAL_LIST_THRESHOLD;
                const flowColumns = section.key === 'pinned' ? 1 : listColumns;
                return (
                  <section key={section.key} className="flex flex-col gap-1">
                    {section.title && (
                      <h2 className="px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                        {section.title}
                        <span className="ml-1.5 opacity-70">{section.items.length}</span>
                      </h2>
                    )}
                    {virtualize ? (
                      <VirtualListFrame
                        virtualizer={virtualizer}
                        listRef={virtualListRef}
                        testId="prompt-virtual-list"
                      >
                        {(rowIndex) => (
                          <PromptFlowRow
                            columns={flowColumns}
                            items={section.items.slice(
                              rowIndex * flowColumns,
                              rowIndex * flowColumns + flowColumns,
                            )}
                          >
                            {renderPromptRow}
                          </PromptFlowRow>
                        )}
                      </VirtualListFrame>
                    ) : section.key === 'pinned' ? (
                      section.items.map(renderPromptRow)
                    ) : (
                      <PromptFlowRow columns={flowColumns} items={section.items}>
                        {renderPromptRow}
                      </PromptFlowRow>
                    )}
                  </section>
                );
              })}
              <div ref={sentinelRef} aria-hidden data-testid="prompt-scroll-sentinel" />
              {list.hasNextPage && !list.isError && (
                <Button
                  variant="outline"
                  className="mx-auto"
                  disabled={list.isFetchingNextPage}
                  onClick={() => list.fetchNextPage()}
                  data-testid="prompt-load-more"
                >
                  {list.isFetchingNextPage ? '加载中…' : '加载更多'}
                </Button>
              )}
            </div>
          )}
          {list.isError && totalCount > 0 && queryError}
        </div>
      </div>

      {isDesktop ? (
        detailPrompt && (
          <aside
            className="hidden w-96 shrink-0 border-border border-l md:block"
            data-testid="prompt-inspector"
          >
            {inspector}
          </aside>
        )
      ) : (
        <Sheet open={detailPrompt != null} onOpenChange={(open) => !open && setDetailId(null)}>
          <SheetContent
            side="right"
            className="w-full gap-0 p-0 sm:max-w-96 [&>button]:hidden"
            data-testid="prompt-inspector"
          >
            <SheetTitle className="sr-only">提示词详情</SheetTitle>
            {inspector}
          </SheetContent>
        </Sheet>
      )}

      <AlertDialog
        open={purgeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPurgeTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除提示词?</AlertDialogTitle>
            <AlertDialogDescription>
              「{purgeTarget?.title}」将被彻底删除,无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="prompt-purge-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (purgeTarget) purgePrompt.mutate(purgeTarget.id);
                setPurgeTarget(null);
              }}
            >
              永久删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={emptyTrashOpen} onOpenChange={setEmptyTrashOpen}>
        <AlertDialogContent className="max-w-sm" data-testid="prompt-empty-trash-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>清空回收站?</AlertDialogTitle>
            <AlertDialogDescription>
              {hasActiveFilter || list.hasNextPage
                ? `回收站中的全部提示词将被彻底删除，无法恢复。当前列表显示 ${totalCount} 条；清空范围包括尚未加载及被筛选隐藏的条目。`
                : `回收站中的 ${totalCount} 条提示词将被彻底删除，无法恢复。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="prompt-empty-trash-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setEmptyTrashOpen(false);
                setDetailId(null);
                emptyTrash.mutate(undefined, {
                  onSuccess: (result) => toast.success(`已清空回收站,永久删除 ${result.purged} 条`),
                  onError: (error) =>
                    toast.error(error instanceof Error ? error.message : '清空失败'),
                });
              }}
            >
              清空回收站
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PromptEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        prompt={editing}
        folders={folders.data ?? []}
        tags={tags.data ?? []}
        submitting={createPrompt.isPending || updatePrompt.isPending}
        onSubmit={(value) => {
          if (editing) {
            updatePrompt.mutate(
              {
                id: editing.id,
                patch: {
                  title: value.title.trim(),
                  description: value.description.trim() ? value.description.trim() : null,
                  content: value.content.trim(),
                  negative: value.negative.trim() ? value.negative.trim() : null,
                  folderId: value.folderId,
                  tagIds: value.tagIds,
                  rating: value.rating,
                  isPinned: value.isPinned,
                  expectedVersion: editing.version,
                },
              },
              {
                onSuccess: () => setEditorOpen(false),
                onError: (error) =>
                  toast.error(error instanceof Error ? error.message : '保存失败'),
              },
            );
          } else {
            createPrompt.mutate(editorValueToNewDocument(value), {
              onSuccess: () => setEditorOpen(false),
              onError: (error) => toast.error(error instanceof Error ? error.message : '创建失败'),
            });
          }
        }}
      />
    </div>
  );
}
