// src/pages/HistoryPage.tsx
// 生成历史 —— 列表 + 右栏检视（TASK-HIS-01/02/03）
// 详见 docs/05-image-generation.md §6 · docs/product/13-history-deep-dive.md §4.1
//
// 布局：主区(弹性列表) | 检视(320，可折叠)

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, PanelRightClose, PanelRightOpen } from '../components/ui/icons';
import { HistoryList } from '../features/history/components/HistoryList';
import { HistoryFilterBar } from '../features/history/components/HistoryFilterBar';
import { HistoryDetail } from '../features/history/components/HistoryDetail';
import { HistoryCleanupMenu } from '../features/history/components/HistoryCleanupMenu';
import { HistoryDiskUsage } from '../features/history/components/HistoryDiskUsage';
import { CostDashboard } from '../features/history/components/CostDashboard';
import { useHistoryStore } from '../features/history/store';
import { ImageLightbox } from '../components/image-lightbox';
import { Button } from '../components/ui/button';
import {
  GenerationHistoryWorkspace,
  GenerationHistoryScreen,
  useHistoryInspectorController,
} from '@musefold/product-ui';

export function HistoryPage() {
  const records = useHistoryStore((s) => s.records);
  const count = useHistoryStore((s) => s.records.length);
  const loading = useHistoryStore((s) => s.loading);
  const load = useHistoryStore((s) => s.load);
  const selectedId = useHistoryStore((s) => s.selectedId);
  const select = useHistoryStore((s) => s.select);
  const inspector = useHistoryInspectorController();
  const inspectorCollapsed = inspector.collapsed;

  useEffect(() => {
    inspector.select(selectedId);
    if (selectedId) inspector.setCollapsed(false);
  }, [inspector.select, inspector.setCollapsed, selectedId]);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [costDashboardOpen, setCostDashboardOpen] = useState(false);

  const imageRecords = useMemo(
    () => records.filter((r) => r.status === 'success' && Boolean(r.imagePath)),
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
    <div className="h-full px-6 pb-12 pt-5 max-[640px]:px-4">
      <GenerationHistoryScreen
        items={[]}
        count={count}
        refreshing={loading}
        onRefresh={() => void load({ limit: 200 })}
        className="mf-history-screen-workspace"
        headerAction={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCostDashboardOpen(true)}
              data-testid="history-cost-open"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              成本看板
            </Button>
            <HistoryDiskUsage />
            <HistoryCleanupMenu />
            <Button
              size="icon"
              variant="ghost"
              onClick={inspector.toggleCollapsed}
              title={inspectorCollapsed ? '展开检视面板' : '折叠检视面板'}
              data-testid="history-inspector-toggle"
            >
              {inspectorCollapsed ? (
                <PanelRightOpen className="h-3.5 w-3.5" />
              ) : (
                <PanelRightClose className="h-3.5 w-3.5" />
              )}
            </Button>
          </>
        }
        toolbar={<HistoryFilterBar />}
        body={
        <>
          <GenerationHistoryWorkspace
            detailOpen={Boolean(selectedId) && !inspectorCollapsed}
            onBack={() => {
              select(null);
              inspector.select(null);
            }}
            list={<HistoryList onOpenLightbox={openLightbox} />}
            detail={<HistoryDetail onOpenLightbox={openLightbox} />}
          />
          <ImageLightbox
            path={lightboxRecord?.imagePath ?? null}
            prompt={lightboxRecord?.promptText}
            onClose={() => setLightboxId(null)}
            onPrevious={() => goLightbox(-1)}
            onNext={() => goLightbox(1)}
            hasPrevious={lightboxIndex > 0}
            hasNext={lightboxIndex >= 0 && lightboxIndex < imageRecords.length - 1}
          />
          <CostDashboard open={costDashboardOpen} onOpenChange={setCostDashboardOpen} />
        </>
        }
      />
    </div>
  );
}
