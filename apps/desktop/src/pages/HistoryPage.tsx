// src/pages/HistoryPage.tsx
// 生成历史 —— 列表 + 右栏检视（TASK-HIS-01/02/03）
// 详见 docs/05-image-generation.md §6 · docs/product/13-history-deep-dive.md §4.1
//
// 布局：主区(弹性列表) | 检视(320，可折叠)

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Filter, PanelRightClose, PanelRightOpen } from '../components/ui/icons';
import { HistoryList } from '../features/history/components/HistoryList';
import { HistoryFilterBar } from '../features/history/components/HistoryFilterBar';
import { HistoryDetail } from '../features/history/components/HistoryDetail';
import { HistoryCleanupMenu } from '../features/history/components/HistoryCleanupMenu';
import { HistoryDiskUsage } from '../features/history/components/HistoryDiskUsage';
import {
  toHistoryListQuery,
  toHistoryListQueryKey,
  useHistoryStore,
} from '../features/history/store';
import { ImageLightbox } from '../components/image-lightbox';
import { Button } from '../components/ui/button';
import {
  GenerationHistoryWorkspace,
  GenerationHistoryScreen,
  useHistoryPageController,
} from '@musefold/product-ui';
import { desktopGateway } from '../runtime';
import { desktopPlatformServices } from '../runtime/platform-services';

export function HistoryPage() {
  const filters = useHistoryStore((s) => s.filters);
  const activeFilterCount = useHistoryStore((s) => s.activeFilterCount());
  const selectedId = useHistoryStore((s) => s.selectedId);
  const select = useHistoryStore((s) => s.select);
  const page = useHistoryPageController({
    history: desktopGateway,
    platform: desktopPlatformServices,
    listKey: toHistoryListQueryKey(filters),
    listFn: () =>
      desktopGateway.listHistory(toHistoryListQuery(useHistoryStore.getState().filters)),
  });
  const { records, loading, refetch } = {
    records: page.items,
    loading: page.loading,
    refetch: page.refetch,
  };
  const count = records.length;
  const inspector = page.inspector;
  const inspectorCollapsed = inspector.collapsed;
  const inspectorOpen = Boolean(selectedId) && !inspectorCollapsed;
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    inspector.select(selectedId);
    if (selectedId) inspector.setCollapsed(false);
  }, [inspector.select, inspector.setCollapsed, selectedId]);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const imageRecords = useMemo(
    () => records.filter((r) => r.status === 'succeeded' && Boolean(r.imagePath)),
    [records],
  );
  const lightboxIndex = imageRecords.findIndex((r) => r.id === lightboxId);
  const lightboxRecord = lightboxIndex >= 0 ? imageRecords[lightboxIndex] : null;

  useEffect(() => {
    if (lightboxId && lightboxIndex < 0) setLightboxId(null);
  }, [lightboxId, lightboxIndex]);

  const openLightbox = (id: string) => {
    const target = imageRecords.find((r) => r.id === id);
    if (!target) return;
    select(id);
    setLightboxId(id);
  };

  const goLightbox = (delta: -1 | 1) => {
    if (lightboxIndex < 0) return;
    const next = imageRecords[lightboxIndex + delta];
    if (!next) return;
    select(next.id);
    setLightboxId(next.id);
  };

  return (
    <div className="h-full min-h-0 bg-work">
      <GenerationHistoryScreen
        items={[]}
        count={count}
        refreshing={loading}
        showPageHeader={false}
        onRefresh={() => void refetch()}
        className="mf-history-screen-workspace"
        headerAction={
          <>
            <Button
              size="sm"
              variant={filtersOpen || activeFilterCount > 0 ? 'subtle' : 'outline'}
              className="min-w-[76px] tabular-nums"
              aria-controls="history-filter-panel"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
              title={filtersOpen ? '收起筛选' : '展开筛选'}
              data-testid="history-filter-toggle"
            >
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              筛选
              {activeFilterCount > 0 && (
                <span
                  className="grid min-w-4 place-items-center rounded-md bg-elevated px-1 text-[10px] leading-4 text-primary shadow-hairline"
                  data-testid="history-filter-count"
                >
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                className={`h-3 w-3 text-tertiary transition-transform ${
                  filtersOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </Button>
            <HistoryDiskUsage />
            <HistoryCleanupMenu />
            <Button
              size="icon"
              variant="ghost"
              onClick={inspector.toggleCollapsed}
              disabled={!selectedId}
              title={
                !selectedId
                  ? '选择一条记录后查看详情'
                  : inspectorOpen
                    ? '折叠检视面板'
                    : '展开检视面板'
              }
              data-testid="history-inspector-toggle"
            >
              {inspectorOpen ? (
                <PanelRightClose className="h-3.5 w-3.5" />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5" />
              )}
            </Button>
          </>
        }
        toolbar={filtersOpen ? <HistoryFilterBar /> : undefined}
        body={
          <>
            <GenerationHistoryWorkspace
              detailOpen={inspectorOpen}
              onBack={() => {
                select(null);
                inspector.select(null);
              }}
              list={<HistoryList onOpenLightbox={openLightbox} />}
              detail={<HistoryDetail onOpenLightbox={openLightbox} />}
            />
            <ImageLightbox
              path={lightboxRecord?.imagePath ?? null}
              prompt={lightboxRecord?.request.prompt}
              onClose={() => setLightboxId(null)}
              onPrevious={() => goLightbox(-1)}
              onNext={() => goLightbox(1)}
              hasPrevious={lightboxIndex > 0}
              hasNext={lightboxIndex >= 0 && lightboxIndex < imageRecords.length - 1}
            />
          </>
        }
      />
    </div>
  );
}
