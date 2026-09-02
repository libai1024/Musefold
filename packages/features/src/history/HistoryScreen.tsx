'use client';

import type { GenerationAsset, GenerationJob } from '@musefold/contracts';
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
import { useEffect, useMemo, useState } from 'react';
import {
  jobToSavePromptSource,
  SavePromptDialog,
  type SavePromptSource,
} from '../prompts/SavePromptDialog';
import { useScreenIntent } from '../shell/screen-intent-store';
import {
  assetSaveName,
  createRetryGenerationMutationIntent,
  useCancelGeneration,
  useRetryGeneration,
  useSaveAsset,
} from '../workbench/hooks';
import { HistoryFilterBar } from './HistoryFilterBar';
import { HistoryInspector } from './HistoryInspector';
import { HistoryLightbox, type LightboxEntry } from './HistoryLightbox';
import { HistoryRow } from './HistoryRow';
import { threadJobs } from './format';
import {
  buildHistoryQuery,
  DEFAULT_HISTORY_FILTERS,
  type HistoryFilters,
  useHistoryList,
  useMediaQuery,
  usePurgeGeneration,
  useRemoveGeneration,
  useRestoreGeneration,
} from './hooks';

export interface HistoryScreenProps {
  /** 跳到所属会话(宿主注入:切工作台视图/路由并激活该会话)。 */
  onOpenSession?(sessionId: string): void;
  /** 「存为提示词」成功 toast「查看」跳库的切屏回调(宿主注入)。 */
  onOpenPrompts?(): void;
}

/**
 * 生成历史屏(V25-UI-SPEC §5):筛选栏 + 线程缩进列表 + 详情 Inspector + 回收站。
 * Inspector:lg+ 内嵌右栏;窄屏 Sheet。
 */
export function HistoryScreen({ onOpenSession, onOpenPrompts }: HistoryScreenProps) {
  const [tab, setTab] = useState<'all' | 'trash'>('all');
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_HISTORY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const consumeIntent = useScreenIntent((s) => s.consume);
  useEffect(() => {
    if (consumeIntent('history-trash')) setTab('trash');
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
  const retryGeneration = useRetryGeneration();
  const removeGeneration = useRemoveGeneration();
  const restoreGeneration = useRestoreGeneration();
  const purgeGeneration = usePurgeGeneration();
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

  const jobs = useMemo(() => (list.data?.pages ?? []).flatMap((page) => page.items), [list.data]);
  const threaded = useMemo(() => threadJobs(jobs), [jobs]);
  const modelOptions = useMemo(
    () => [...new Set(jobs.map((job) => job.providerModel).filter((m): m is string => !!m))],
    [jobs],
  );
  const selectedJob = jobs.find((job) => job.id === selectedId) ?? null;

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

  // 选中记录翻页/筛选后不在结果集时收起详情。
  useEffect(() => {
    if (selectedId && !selectedJob) setSelectedId(null);
  }, [selectedId, selectedJob]);

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
      onRetry: () => retryGeneration.mutate(createRetryGenerationMutationIntent(job.id)),
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

  const inspector = selectedJob && (
    <HistoryInspector
      job={selectedJob}
      onClose={() => setSelectedId(null)}
      onCancel={() => cancelGeneration.mutate(selectedJob.id)}
      onRetry={() => retryGeneration.mutate(createRetryGenerationMutationIntent(selectedJob.id))}
      onRemove={() => {
        removeGeneration.mutate(selectedJob.id);
        setSelectedId(null);
      }}
      onRestore={() => restoreGeneration.mutate(selectedJob.id)}
      onSavePrompt={() => setSavePromptSource(jobToSavePromptSource(selectedJob))}
      onSaveAsset={() => {
        const first = selectedJob.assets[0];
        if (first) handleSaveAsset(first);
      }}
      onOpenLightbox={
        selectedJob.status === 'succeeded' && selectedJob.assets.length > 0
          ? () => openLightbox(selectedJob.id)
          : undefined
      }
      onOpenSession={onOpenSession}
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

        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3" role="list">
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

          {threaded.map(({ job, depth }) => (
            <HistoryRow
              key={job.id}
              job={job}
              depth={depth}
              selected={selectedId === job.id}
              deletedView={tab === 'trash'}
              {...rowActions(job)}
            />
          ))}

          {list.hasNextPage && (
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
          )}
        </div>
      </div>

      {isDesktop ? (
        selectedJob && (
          <aside className="hidden w-96 shrink-0 border-border border-l lg:block">
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
