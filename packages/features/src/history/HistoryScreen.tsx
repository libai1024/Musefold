'use client';

import type { GenerationJob } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import { Sheet, SheetContent, SheetTitle } from '@musefold/ui/components/sheet';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Spinner } from '@musefold/ui/components/spinner';
import { Tabs, TabsList, TabsTrigger } from '@musefold/ui/components/tabs';
import { History as HistoryIcon, Trash2 } from '@musefold/ui/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCancelGeneration, useRetryGeneration } from '../workbench/hooks';
import { HistoryFilterBar } from './HistoryFilterBar';
import { HistoryInspector } from './HistoryInspector';
import { HistoryRow } from './HistoryRow';
import { threadJobs } from './format';
import {
  buildHistoryQuery,
  DEFAULT_HISTORY_FILTERS,
  type HistoryFilters,
  useHistoryList,
  useMediaQuery,
  useRemoveGeneration,
  useRestoreGeneration,
} from './hooks';

export interface HistoryScreenProps {
  /** 跳到所属会话(宿主注入:切工作台视图/路由并激活该会话)。 */
  onOpenSession?(sessionId: string): void;
}

/**
 * 生成历史屏(V25-UI-SPEC §5):筛选栏 + 线程缩进列表 + 详情 Inspector + 回收站。
 * Inspector:lg+ 内嵌右栏;窄屏 Sheet。
 */
export function HistoryScreen({ onOpenSession }: HistoryScreenProps) {
  const [tab, setTab] = useState<'all' | 'trash'>('all');
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_HISTORY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

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

  const jobs = useMemo(() => (list.data?.pages ?? []).flatMap((page) => page.items), [list.data]);
  const threaded = useMemo(() => threadJobs(jobs), [jobs]);
  const modelOptions = useMemo(
    () => [...new Set(jobs.map((job) => job.providerModel).filter((m): m is string => !!m))],
    [jobs],
  );
  const selectedJob = jobs.find((job) => job.id === selectedId) ?? null;

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
    return {
      onOpen: () => setSelectedId(job.id),
      onCancel: () => cancelGeneration.mutate(job.id),
      onRetry: () => retryGeneration.mutate(job.id),
      onRemove: () => {
        if (selectedId === job.id) setSelectedId(null);
        removeGeneration.mutate(job.id);
      },
      onRestore: () => restoreGeneration.mutate(job.id),
    };
  }

  const inspector = selectedJob && (
    <HistoryInspector
      job={selectedJob}
      onClose={() => setSelectedId(null)}
      onCancel={() => cancelGeneration.mutate(selectedJob.id)}
      onRetry={() => retryGeneration.mutate(selectedJob.id)}
      onRemove={() => {
        removeGeneration.mutate(selectedJob.id);
        setSelectedId(null);
      }}
      onRestore={() => restoreGeneration.mutate(selectedJob.id)}
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
    </div>
  );
}
