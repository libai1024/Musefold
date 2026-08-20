// 生成图片目录占用概览（TASK-HIS-11）

import { useEffect, useState } from 'react';
import { HardDrive, RefreshCw } from '../../../components/ui/icons';
import type { DiskUsageResult } from '@musefold/desktop-contracts/ipc';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { useHistoryStore } from '../store';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

export function HistoryDiskUsage() {
  const refreshKey = useHistoryStore((s) => s.records.length);
  const [usage, setUsage] = useState<DiskUsageResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setUsage(await api.system.diskUsage());
    } catch {
      setUsage(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // records.length 改变时重读：删除源文件/生成新图后概览能跟上。
  }, [refreshKey]);

  return (
    <button
      type="button"
      className="no-drag inline-flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-elevated px-2 text-[11px] text-tertiary transition-colors hover:border-border-default hover:bg-hover hover:text-secondary"
      title={usage ? usage.dir : '读取图片目录占用'}
      onClick={() => void load()}
      data-testid="history-disk-usage"
      data-images-count={usage?.imagesCount ?? 0}
      data-images-bytes={usage?.imagesBytes ?? 0}
    >
      {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <HardDrive className="h-3.5 w-3.5" />}
      <span className="tabular-nums">{usage ? `${usage.imagesCount} 张 · ${formatBytes(usage.imagesBytes)}` : '图片占用'}</span>
    </button>
  );
}
