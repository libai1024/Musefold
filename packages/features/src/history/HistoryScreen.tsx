'use client';

import { useRetryAction } from '../workbench/use-retry-action';

import type { GenerationAsset, GenerationCleanupScope, GenerationJob } from '@musefold/contracts';
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
import { Button } from '@musefold/ui/components/button';
import { Sheet, SheetContent, SheetTitle } from '@musefold/ui/components/sheet';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { toast } from '@musefold/ui/components/sonner';
import { Spinner } from '@musefold/ui/components/spinner';
import { Tabs, TabsList, TabsTrigger } from '@musefold/ui/components/tabs';
import { History as HistoryIcon, Trash2 } from '@musefold/ui/icons';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  jobToSavePromptSource,
  SavePromptDialog,
  type SavePromptSource,
} from '../prompts/SavePromptDialog';
import { useScreenIntent } from '../shell/screen-intent-store';
import {
  canMeasureVirtualRows,
  historyThreadEstimate,
  shouldVirtualizeList,
  useDocumentDensity,
  useListVirtualizer,
  VirtualListFrame,
} from '../shell/use-virtual-rows';
import { assetSaveName, useCancelGeneration, useSaveAsset } from '../workbench/hooks';
import { HistoryFilterBar } from './HistoryFilterBar';
import { HistoryInspector } from './HistoryInspector';
import { HistoryLightbox, type LightboxEntry } from './HistoryLightbox';
import { CLEANUP_COPY, HistoryMaintenanceBar } from './HistoryMaintenanceBar';
import { HistoryRow } from './HistoryRow';
import { groupHistoryThreads, type ThreadedJob, threadJobs } from './format';
import {
  buildHistoryQuery,
  DEFAULT_HISTORY_FILTERS,
  type HistoryFilters,
  useAutoLoadMore,
  useCleanupGeneration,
  useCopyAssetToClipboard,
  useHistoryList,
  useMediaQuery,
  usePurgeGeneration,
  useRemoveGeneration,
  useRestoreGeneration,
  useRevealAsset,
  useStorageUsage,
} from './hooks';

export interface HistoryScreenProps {
  /** 跳到所属会话(宿主注入:切工作台视图/路由并激活该会话)。 */
  onOpenSession?(sessionId: string): void;
  /** 「存为提示词」成功 toast「查看」跳库的切屏回调(宿主注入)。 */
  onOpenPrompts?(): void;
  /** 密钥/连接引导切设置(宿主注入)。 */
  onOpenSettings?(): void;
}

/**
 * 生成历史屏(V25-UI-SPEC §5):筛选栏 + 线程缩进列表 + 详情 Inspector + 回收站。
 * Inspector:lg+ 内嵌右栏(8px 右移淡入,过 CSS reduce-motion 闸门);窄屏 Sheet。
 */
export function HistoryScreen({
  onOpenSession,
  onOpenPrompts,
  onOpenSettings,
}: HistoryScreenProps) {
  const [tab, setTab] = useState<'all' | 'trash'>('all');
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_HISTORY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isMdUp = useMediaQuery('(min-width: 768px)');
  const capabilities = useCapabilities();
  const canRevealLocalFile = capabilities.canRevealLocalFile;

  const consumeIntent = useScreenIntent((s) => s.consume);
  /** 深链选中的记录 id:数据到位后滚到该行(可能在后面几页,拿不到就只选中)。 */
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  useEffect(() => {
    if (consumeIntent('history-trash')) setTab('trash');
    // 提示词详情「相关作品」→ 历史屏选中该回合(05 §7 / 03 联动)。
    const select = consumeIntent('history-select');
    if (select) {
      setTab('all');
      setSelectedId(select.jobId);
      setPendingScrollId(select.jobId);
    }
  }, [consumeIntent]);

  // 搜索 300ms 防抖(V25-UI-SPEC §5.2)。
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = useMemo(
    () => buildHistoryQuery(filters, search, tab === 'trash'),
    [filters, search, tab],
  );
  const list = useHistoryList(query);
  const cancelGeneration = useCancelGeneration();
  const retryGeneration = useRetryAction(onOpenSettings);
  const removeGeneration = useRemoveGeneration();
  const restoreGeneration = useRestoreGeneration();
  const purgeGeneration = usePurgeGeneration();
  const cleanupGeneration = useCleanupGeneration();
  const revealAsset = useRevealAsset();
  const copyAsset = useCopyAssetToClipboard();
  const storageUsage = useStorageUsage(canRevealLocalFile);
  const [purgeTarget, setPurgeTarget] = useState<GenerationJob | null>(null);
  const [savePromptSource, setSavePromptSource] = useState<SavePromptSource | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const saveAsset = useSaveAsset();

  /** 保存图片(05 §3):桌面系统对话框 / Web 浏览器下载;取消不提示。 */
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

  /** 在文件夹中显示(桌面):只送受管资产 id,路径解析全在主进程。 */
  const handleRevealAsset = useCallback(
    (asset: GenerationAsset) => {
      revealAsset.mutate(asset.id, {
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : '无法定位图片文件');
        },
      });
    },
    [revealAsset],
  );

  const handleCopyAsset = useCallback(
    (asset: GenerationAsset) => {
      copyAsset.mutate(asset.id, {
        onSuccess: () => toast.success('图片已复制到剪贴板'),
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : '复制图片失败');
        },
      });
    },
    [copyAsset],
  );

  function handleCleanup(scope: GenerationCleanupScope) {
    cleanupGeneration.mutate(
      { scope },
      {
        onSuccess: ({ affected }) => {
          if (affected === 0) {
            toast.success('没有需要清理的记录');
            return;
          }
          toast.success(
            scope === 'empty-trash'
              ? `已永久删除 ${affected} 条记录`
              : `已将 ${affected} 条记录移入回收站`,
          );
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : `${CLEANUP_COPY[scope].item}失败`);
        },
      },
    );
  }

  const jobs = useMemo(() => (list.data?.pages ?? []).flatMap((page) => page.items), [list.data]);
  const threaded = useMemo(() => threadJobs(jobs), [jobs]);
  const threadGroups = useMemo(() => groupHistoryThreads(threaded), [threaded]);
  const density = useDocumentDensity();
  const shouldVirtualize =
    shouldVirtualizeList(threadGroups.length) || shouldVirtualizeList(threaded.length);
  const modelOptions = useMemo(
    () => [...new Set(jobs.map((job) => job.providerModel).filter((m): m is string => !!m))],
    [jobs],
  );
  const selectedJob = jobs.find((job) => job.id === selectedId) ?? null;
  const selectedThread = threaded.find((item) => item.job.id === selectedId) ?? null;
  /** 谱系:父记录与直接子记录都从当前结果集解析(与列表缩进同一份索引)。 */
  const parentJob = selectedJob?.parentRunId
    ? (jobs.find((job) => job.id === selectedJob.parentRunId) ?? null)
    : null;
  const childJobs = useMemo(
    () => (selectedId ? jobs.filter((job) => job.parentRunId === selectedId) : []),
    [jobs, selectedId],
  );

  // 列表长度变化后重取磁盘占用(承旧 HistoryDiskUsage 的 runCount 依赖)。
  const refetchStorage = storageUsage.refetch;
  const jobCount = jobs.length;
  const countedRef = useRef(-1);
  useEffect(() => {
    if (!canRevealLocalFile || countedRef.current === jobCount) return;
    countedRef.current = jobCount;
    void refetchStorage();
  }, [canRevealLocalFile, jobCount, refetchStorage]);

  // Lightbox 可翻集合(05 §7):成功且有资产的记录,顺序与列表可视顺序(线程序)一致。
  const lightboxEntries = useMemo(
    () =>
      threaded.flatMap(({ job }): LightboxEntry[] => {
        const asset = job.assets[0];
        return job.status === 'succeeded' && asset ? [{ job, asset }] : [];
      }),
    [threaded],
  );

  /** 打开/翻图共用:选中行跟随当前图(05 §7)。 */
  function openLightbox(id: string) {
    setLightboxId(id);
    setSelectedId(id);
  }

  // 选中记录翻页/筛选后不在结果集时收起详情(深链等待数据期间不收)。
  useEffect(() => {
    if (selectedId && !selectedJob && selectedId !== pendingScrollId) setSelectedId(null);
  }, [selectedId, selectedJob, pendingScrollId]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useAutoLoadMore(sentinelRef, list.hasNextPage && !list.isFetchingNextPage, () => {
    void list.fetchNextPage();
  });

  // 深链落地:目标行渲染出来后滚到可视区并停止等待。虚拟化时先 scrollToIndex 再对行 scrollIntoView。
  const listRef = useRef<HTMLDivElement | null>(null);
  const virtualFrameRef = useRef<HTMLDivElement | null>(null);
  const useWindowScroll = canMeasureVirtualRows() && !isMdUp;
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    if (!shouldVirtualize || !useWindowScroll) {
      setScrollMargin(0);
      return;
    }
    const frame = virtualFrameRef.current;
    if (!frame) return;
    const update = () => setScrollMargin(frame.getBoundingClientRect().top + window.scrollY);
    update();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [shouldVirtualize, useWindowScroll]);
  const virtualizer = useListVirtualizer({
    count: shouldVirtualize ? threadGroups.length : 0,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => historyThreadEstimate(threadGroups[index]?.length ?? 1, density),
    scrollMargin,
    useWindowScroll,
  });
  useLayoutEffect(() => {
    // 目标行还没进当前结果集(首屏未回或被筛掉)就继续等,别把意图丢掉。
    if (!pendingScrollId) return;
    if (!threaded.some((item) => item.job.id === pendingScrollId)) return;
    const groupIndex = threadGroups.findIndex((group) =>
      group.some((item) => item.job.id === pendingScrollId),
    );
    if (shouldVirtualize && groupIndex >= 0) {
      void virtualizer.getTotalSize();
      const visible = virtualizer.getVirtualItems().some((item) => item.index === groupIndex);
      if (!visible) virtualizer.scrollToIndex(groupIndex, { align: 'center' });
    }
    const row = listRef.current?.querySelector(`[data-job-row="${pendingScrollId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'auto' });
    setPendingScrollId(null);
  });

  const hasActiveFilter = Boolean(
    filters.status || filters.providerModel || filters.datePreset !== '30d' || search.trim(),
  );

  function clearFilters() {
    setFilters(DEFAULT_HISTORY_FILTERS);
    setSearchInput('');
    setSearch('');
  }

  function rowActions(job: GenerationJob) {
    const inLightboxSet = job.status === 'succeeded' && job.assets.length > 0;
    return {
      onOpen: () => setSelectedId(job.id),
      onCancel: () => cancelGeneration.mutate(job.id),
      onRetry: () => retryGeneration.request(job),
      retryPending: retryGeneration.isPending(job.id),
      onRemove: () => {
        if (selectedId === job.id) setSelectedId(null);
        removeGeneration.mutate(job.id);
      },
      onRestore: () => restoreGeneration.mutate(job.id),
      onPurge: () => setPurgeTarget(job),
      // 行缩略点击放大(05 §7);无成图行仍走开详情。
      ...(inLightboxSet ? { onOpenLightbox: () => openLightbox(job.id) } : {}),
    };
  }

  function renderThreadGroup(group: ThreadedJob[]) {
    const root = group[0];
    if (!root) return null;
    return (
      <div
        key={root.threadRootId}
        className="flex flex-col gap-1"
        data-testid="history-thread-group"
        data-thread-root={root.threadRootId}
      >
        {group.map((item) => (
          <div key={item.job.id} data-job-row={item.job.id}>
            <HistoryRow
              job={item.job}
              thread={item}
              selected={selectedId === item.job.id}
              deletedView={tab === 'trash'}
              {...rowActions(item.job)}
            />
          </div>
        ))}
      </div>
    );
  }

  const selectedAsset = selectedJob?.assets[0];
  const inspector = selectedJob && (
    <HistoryInspector
      job={selectedJob}
      onClose={() => setSelectedId(null)}
      onCancel={() => cancelGeneration.mutate(selectedJob.id)}
      onRetry={() => retryGeneration.request(selectedJob)}
      retryPending={retryGeneration.isPending(selectedJob.id)}
      onRemove={() => {
        removeGeneration.mutate(selectedJob.id);
        setSelectedId(null);
      }}
      onRestore={() => restoreGeneration.mutate(selectedJob.id)}
      onSavePrompt={() => setSavePromptSource(jobToSavePromptSource(selectedJob))}
      onSaveAsset={() => {
        if (selectedAsset) handleSaveAsset(selectedAsset);
      }}
      onOpenLightbox={
        selectedJob.status === 'succeeded' && selectedJob.assets.length > 0
          ? () => openLightbox(selectedJob.id)
          : undefined
      }
      onOpenSession={onOpenSession}
      onOpenSettings={onOpenSettings}
      // 桌面文件操作:Web 宿主不注入 → Inspector 不渲染这两个动作。
      {...(canRevealLocalFile && selectedAsset
        ? {
            onRevealAsset: () => handleRevealAsset(selectedAsset),
            onCopyAsset: () => handleCopyAsset(selectedAsset),
          }
        : {})}
      parentJob={parentJob}
      childJobs={childJobs}
      orphan={selectedThread?.orphan ?? false}
      onSelectJob={setSelectedId}
    />
  );

  return (
    <div className="flex h-full min-h-0" data-testid="history">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-2.5 border-border border-b px-4 pt-3 pb-2.5">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-semibold text-base text-foreground">生成历史</h1>
            <Tabs value={tab} onValueChange={(next) => setTab(next as 'all' | 'trash')}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="gap-1.5 text-xs" data-testid="history-tab-all">
                  <HistoryIcon className="size-3.5" /> 全部
                </TabsTrigger>
                <TabsTrigger
                  value="trash"
                  className="gap-1.5 text-xs"
                  data-testid="history-tab-trash"
                >
                  <Trash2 className="size-3.5" /> 回收站
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <HistoryFilterBar
            filters={filters}
            search={searchInput}
            modelOptions={modelOptions}
            onFiltersChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
            onSearchChange={setSearchInput}
            onClear={clearFilters}
          />
        </div>

        {/* 维护工具行只在回收站 tab 出现:清理三项 + 桌面磁盘占用 readout(05 §7)。 */}
        {tab === 'trash' && (
          <HistoryMaintenanceBar
            storage={storageUsage.data ?? null}
            showStorage={canRevealLocalFile}
            storageLoading={storageUsage.isFetching}
            onRefreshStorage={() => void storageUsage.refetch()}
            cleanupPending={cleanupGeneration.isPending}
            onCleanup={handleCleanup}
          />
        )}

        <div
          ref={listRef}
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
          data-testid="history-list-scroll"
          data-virtualized={shouldVirtualize ? 'true' : undefined}
          role="list"
        >
          {list.isPending &&
            [0, 1, 2, 3, 4, 5].map((index) => (
              <Skeleton key={index} className="h-16 shrink-0 rounded-lg" />
            ))}

          {list.isError && (
            <div
              className="flex flex-col items-center gap-3 py-16 text-center"
              data-testid="history-error"
            >
              <p className="text-muted-foreground text-sm">历史读取失败</p>
              <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                重试
              </Button>
            </div>
          )}

          {list.isSuccess && threaded.length === 0 && (
            <div
              className="flex flex-col items-center gap-2 py-16 text-center"
              data-testid="history-empty"
            >
              {tab === 'trash' ? (
                <>
                  <Trash2 className="size-6 text-muted-foreground" aria-hidden />
                  <p className="text-muted-foreground text-sm">回收站是空的</p>
                </>
              ) : hasActiveFilter ? (
                <>
                  <HistoryIcon className="size-6 text-muted-foreground" aria-hidden />
                  <p className="text-muted-foreground text-sm">没有匹配的记录</p>
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    清除筛选
                  </Button>
                </>
              ) : (
                <>
                  <HistoryIcon className="size-6 text-muted-foreground" aria-hidden />
                  <p className="text-muted-foreground text-sm">
                    还没有生成记录,去工作台开始第一张图
                  </p>
                </>
              )}
            </div>
          )}

          {shouldVirtualize ? (
            <VirtualListFrame
              virtualizer={virtualizer}
              listRef={virtualFrameRef}
              testId="history-virtual-list"
            >
              {(index) => renderThreadGroup(threadGroups[index] ?? [])}
            </VirtualListFrame>
          ) : (
            threadGroups.map((group) => renderThreadGroup(group))
          )}

          {list.hasNextPage && (
            <>
              {/* 滚动哨兵:进视口自动取下一页;没有 IntersectionObserver 时按钮兜底。 */}
              <div ref={sentinelRef} aria-hidden data-testid="history-load-sentinel" />
              <Button
                variant="ghost"
                size="sm"
                className="mx-auto mt-2 text-muted-foreground text-xs"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
                data-testid="history-load-more"
              >
                {list.isFetchingNextPage ? <Spinner className="size-3.5" /> : '加载更多'}
              </Button>
            </>
          )}
        </div>
      </div>

      {isDesktop ? (
        selectedJob && (
          <aside
            // 05-C3:出现时 8px 右移淡入;reduce-motion 由 globals.css 统一压制。
            className="hidden w-96 shrink-0 animate-in border-border border-l duration-200 ease-out fade-in slide-in-from-right-2 lg:block"
            data-testid="history-inspector-aside"
          >
            {inspector}
          </aside>
        )
      ) : (
        <Sheet open={selectedJob != null} onOpenChange={(open) => !open && setSelectedId(null)}>
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-96 [&>button]:hidden">
            <SheetTitle className="sr-only">生成详情</SheetTitle>
            {inspector}
          </SheetContent>
        </Sheet>
      )}

      <SavePromptDialog
        source={savePromptSource}
        onOpenChange={(open) => {
          if (!open) setSavePromptSource(null);
        }}
        onOpenPrompts={onOpenPrompts}
      />

      <HistoryLightbox
        entries={lightboxEntries}
        activeId={lightboxId}
        onNavigate={openLightbox}
        onClose={() => setLightboxId(null)}
        onSaveAsset={handleSaveAsset}
        {...(canRevealLocalFile
          ? { onRevealAsset: handleRevealAsset, onCopyAsset: handleCopyAsset }
          : {})}
      />

      <AlertDialog
        open={purgeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPurgeTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除生成记录?</AlertDialogTitle>
            <AlertDialogDescription>
              该记录与生成的图片将被彻底删除,无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="history-purge-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (purgeTarget) {
                  if (selectedId === purgeTarget.id) setSelectedId(null);
                  purgeGeneration.mutate(purgeTarget.id);
                }
                setPurgeTarget(null);
              }}
            >
              永久删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
