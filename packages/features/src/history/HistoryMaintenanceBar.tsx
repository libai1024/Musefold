'use client';

import type { GenerationCleanupScope } from '@musefold/contracts';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@musefold/ui/components/dropdown-menu';
import { Spinner } from '@musefold/ui/components/spinner';
import { Brush, HardDrive, RefreshCw } from '@musefold/ui/icons';
import { useState } from 'react';
import { formatBytes } from './format';

interface CleanupCopy {
  item: string;
  title: string;
  description: string;
  confirm: string;
  destructive: boolean;
}

/**
 * 三项清理的确认文案(承旧 HistoryCleanupMenu,按 v2.5 资产语义重审):
 * 前两项是软删入回收站 —— 记录可恢复、图片文件不动;
 * 「清空回收站」才真正连图片一起删。
 */
export const CLEANUP_COPY: Record<GenerationCleanupScope, CleanupCopy> = {
  'older-than-30d': {
    item: '清理 30 天前的记录',
    title: '清理 30 天前的记录?',
    description: '创建于 30 天前的已结束记录会移入回收站,生成的图片文件仍保留,可随时恢复。',
    confirm: '移入回收站',
    destructive: false,
  },
  'failed-and-cancelled': {
    item: '清理失败与已取消',
    title: '清理失败与已取消的记录?',
    description: '所有失败与已取消的记录会移入回收站,生成的图片文件仍保留,可随时恢复。',
    confirm: '移入回收站',
    destructive: false,
  },
  'empty-trash': {
    item: '清空回收站',
    title: '清空回收站?',
    description: '回收站内的记录与对应的图片文件将被彻底删除,无法恢复。',
    confirm: '永久删除',
    destructive: true,
  },
};

const CLEANUP_ORDER: GenerationCleanupScope[] = [
  'older-than-30d',
  'failed-and-cancelled',
  'empty-trash',
];

export interface HistoryMaintenanceBarProps {
  /** 磁盘占用 readout(桌面 only);null = 宿主不提供或尚未取到。 */
  storage: { bytes: number; fileCount: number } | null;
  /** 是否渲染磁盘占用区(canRevealLocalFile 门控)。 */
  showStorage: boolean;
  storageLoading: boolean;
  onRefreshStorage(): void;
  cleanupPending: boolean;
  onCleanup(scope: GenerationCleanupScope): void;
}

/** 回收站工具行(ui-parity 05 §7):磁盘占用 readout + 「清理」三项菜单。 */
export function HistoryMaintenanceBar({
  storage,
  showStorage,
  storageLoading,
  onRefreshStorage,
  cleanupPending,
  onCleanup,
}: HistoryMaintenanceBarProps) {
  const [pendingScope, setPendingScope] = useState<GenerationCleanupScope | null>(null);
  const copy = pendingScope ? CLEANUP_COPY[pendingScope] : null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-border border-b px-4 py-2"
      data-testid="history-maintenance-bar"
    >
      {showStorage && (
        <div
          className="flex items-center gap-1.5 text-muted-foreground text-xs"
          data-testid="history-disk-usage"
        >
          <HardDrive className="size-3.5" aria-hidden />
          <span className="tabular-nums">
            {storage ? `${formatBytes(storage.bytes)} · ${storage.fileCount} 个文件` : '统计中…'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            aria-label="刷新磁盘占用"
            data-testid="history-disk-usage-refresh"
            disabled={storageLoading}
            onClick={onRefreshStorage}
          >
            {storageLoading ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />}
          </Button>
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-8 gap-1.5 text-xs"
            disabled={cleanupPending}
            data-testid="history-cleanup-menu"
          >
            {cleanupPending ? <Spinner className="size-3.5" /> : <Brush className="size-3.5" />}
            清理
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {CLEANUP_ORDER.map((scope) => (
            <DropdownMenuItem
              key={scope}
              data-testid={`history-cleanup-${scope}`}
              variant={CLEANUP_COPY[scope].destructive ? 'destructive' : 'default'}
              onSelect={() => setPendingScope(scope)}
            >
              {CLEANUP_COPY[scope].item}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pendingScope !== null}
        onOpenChange={(open) => {
          if (!open) setPendingScope(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="history-cleanup-confirm"
              className={
                copy?.destructive
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined
              }
              onClick={() => {
                if (pendingScope) onCleanup(pendingScope);
                setPendingScope(null);
              }}
            >
              {copy?.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
