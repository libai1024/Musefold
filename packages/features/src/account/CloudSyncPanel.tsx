'use client';

import type { DesktopSyncState, DesktopSyncStatus } from '@musefold/contracts';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Separator } from '@musefold/ui/components/separator';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Spinner } from '@musefold/ui/components/spinner';
import { Switch } from '@musefold/ui/components/switch';
import { toast } from '@musefold/ui/components/sonner';
import { useAccountStatus, useSetSyncEnabled, useSyncNow, useSyncStatus } from './hooks';

const STATE_LABELS: Record<DesktopSyncState, string> = {
  disabled: '未开启',
  idle: '已是最新',
  syncing: '同步中',
  conflict: '有冲突',
  error: '出错',
};

function formatSyncedAt(iso: string | null): string {
  if (!iso) return '尚未同步';
  const date = new Date(iso);
  return `上次同步 ${date.toLocaleString('zh-CN', { hour12: false })}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败,请重试';
}

/**
 * 云同步面板(桌面专属,capabilities.hasCloudSyncControls):
 * 登录 ≠ 同步 —— 开关由用户显式打开;打开即全量同步一轮,此后写路径防抖触发。
 */
export function CloudSyncPanel() {
  const status = useSyncStatus();

  return (
    <Card data-testid="settings-sync-card">
      <CardHeader>
        <CardTitle>云同步</CardTitle>
        <CardDescription>提示词库跨设备同步;开关独立于登录,数据仅在开启后上云</CardDescription>
      </CardHeader>
      <CardContent>
        {status.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : status.isError ? (
          <p className="text-destructive text-sm">同步状态读取失败,请重试</p>
        ) : (
          <SyncControls data={status.data} />
        )}
      </CardContent>
    </Card>
  );
}

function SyncControls({ data }: { data: DesktopSyncStatus }) {
  const account = useAccountStatus();
  const setEnabled = useSetSyncEnabled();
  const syncNow = useSyncNow();

  const signedIn = account.isSuccess;
  const busy = setEnabled.isPending || syncNow.isPending || data.state === 'syncing';

  const handleToggle = (checked: boolean) => {
    setEnabled.mutate(checked, {
      onSuccess: (next) => {
        if (checked) {
          toast.success(
            next.state === 'error' ? `同步已开启,但首轮失败:${next.error ?? ''}` : '云同步已开启',
          );
        }
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-foreground text-sm">
            {data.enabled ? '同步已开启' : '同步未开启'}
          </p>
          <p
            className="mt-0.5 text-muted-foreground text-xs tabular-nums"
            data-testid="sync-subtitle"
          >
            {data.enabled
              ? `${data.account?.username ?? ''} · ${formatSyncedAt(data.lastSyncedAt)}`
              : signedIn
                ? '开启后提示词、文件夹与标签将同步到云端'
                : '登录账号后可开启'}
          </p>
        </div>
        <Switch
          checked={data.enabled}
          disabled={busy || (!data.enabled && !signedIn)}
          onCheckedChange={handleToggle}
          data-testid="sync-toggle"
        />
      </div>

      {data.enabled && (
        <>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  data.state === 'error' || data.state === 'conflict' ? 'destructive' : 'secondary'
                }
                data-testid="sync-state"
              >
                {STATE_LABELS[data.state]}
              </Badge>
              {data.pendingMutations > 0 && (
                <span className="text-muted-foreground text-xs">
                  待推送 {data.pendingMutations}
                </span>
              )}
              {data.conflicts > 0 && (
                <span className="text-destructive text-xs">冲突 {data.conflicts}</span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                syncNow.mutate(undefined, {
                  onError: (error) => toast.error(errorMessage(error)),
                })
              }
              data-testid="sync-now"
            >
              {busy && <Spinner className="size-3.5" />}
              立即同步
            </Button>
          </div>
          {data.state === 'error' && data.error && (
            <p className="text-destructive text-xs" data-testid="sync-error">
              {data.error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
