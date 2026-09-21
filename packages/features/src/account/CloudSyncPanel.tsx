'use client';

import { canKeepLocalSyncConflict } from '@musefold/contracts';
import type {
  DesktopSyncConsent,
  DesktopSyncPhase,
  DesktopSyncStatus,
  SyncConflictResolution,
  SyncConflictSummary,
} from '@musefold/contracts';
import { queryKeys } from '@musefold/platform';
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
import { toast } from '@musefold/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { LocalWorkspaceRecovery } from './LocalWorkspaceRecovery';
import { useLocalWorkspaceRecovery } from './workspace-recovery-hooks';
import {
  useResolveSyncConflict,
  useSetSyncConsent,
  useSyncConflicts,
  useSyncNow,
  useSyncStatus,
} from './hooks';

/** runtime phase 标签(完整覆盖契约九态)。 */
const PHASE_LABELS: Record<DesktopSyncPhase, string> = {
  signed_out: '未登录',
  awaiting_consent: '待开启',
  paused: '已暂停',
  enabling: '开启中',
  idle: '已是最新',
  syncing: '同步中',
  conflict: '有冲突',
  auth_blocked: '登录失效',
  error: '出错',
};

/**
 * v2.1 legacy 状态摘要文案 parity(勿与新 phase Badge 混淆):
 * 同步中 / N 个冲突 / 同步失败 / N 项等待同步 / 已关闭 / 上次同步…/尚未同步。
 */
function legacySummary(data: DesktopSyncStatus): string {
  if (data.consent === 'paused') {
    return data.pendingMutations > 0 ? `${data.pendingMutations} 项等待同步` : '同步已暂停';
  }
  switch (data.state) {
    case 'syncing':
      return '同步中';
    case 'conflict':
      return `${data.conflicts} 个冲突`;
    case 'error':
      return '同步失败';
    case 'disabled':
      return data.pendingMutations > 0 ? `${data.pendingMutations} 项等待同步` : '已关闭';
    case 'idle':
      return data.pendingMutations > 0
        ? `${data.pendingMutations} 项等待同步`
        : formatSyncedAt(data.lastSyncedAt);
  }
}

const ENTITY_LABELS: Record<SyncConflictSummary['entityType'], string> = {
  prompt: '提示词',
  folder: '文件夹',
  tag: '标签',
};

function formatSyncedAt(iso: string | null): string {
  if (!iso) return '尚未同步';
  const date = new Date(iso);
  return `上次同步 ${date.toLocaleString('zh-CN', { hour12: false })}`;
}

function formatConflictTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败,请重试';
}

/**
 * 冲突摘要只读展示白名单:title → name → entityId fallback,附 updatedAt。
 * 绝不渲染 ownerId/workspaceId/本地路径/密钥等内部字段。
 */
function summarizeSnapshot(
  snapshot: Record<string, unknown>,
  fallbackId: string,
): { title: string; updatedAt: string | null } {
  const rawTitle = snapshot.title ?? snapshot.name;
  const title = typeof rawTitle === 'string' && rawTitle.trim().length > 0 ? rawTitle : fallbackId;
  const rawUpdatedAt = snapshot.updatedAt;
  return { title, updatedAt: typeof rawUpdatedAt === 'string' ? rawUpdatedAt : null };
}

/**
 * 云同步面板(桌面专属,capabilities.hasCloudSyncControls):
 * consent 是 durable 用户决定(unset/enabled/paused),phase 是 runtime 派生状态;
 * 首次同意是显式 CTA「开启云同步」,不用二态 Switch 混淆 unset 与 paused。
 */
export function CloudSyncPanel() {
  const status = useSyncStatus();
  const recovery = useLocalWorkspaceRecovery();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (recovery.supported && status.data?.reviewRef !== undefined)
      void queryClient.invalidateQueries({ queryKey: queryKeys.sync.localWorkspaces() });
  }, [queryClient, recovery.supported, status.data?.reviewRef]);

  return (
    <Card data-testid="settings-sync-card">
      <CardHeader>
        <CardTitle>云同步</CardTitle>
        <CardDescription>提示词库跨设备同步;开关独立于登录,数据仅在开启后上云</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {recovery.supported &&
          (recovery.status.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : recovery.status.isError ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>本机提示词库读取失败</p>
              <Button variant="outline" size="sm" onClick={() => void recovery.status.refetch()}>
                重新读取本机数据
              </Button>
            </div>
          ) : (
            <LocalWorkspaceRecovery
              data={recovery.status.data}
              refresh={() => void recovery.status.refetch()}
            />
          ))}
        {status.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : status.isError ? (
          <div className="space-y-2 text-destructive text-sm">
            <p>同步状态读取失败,请重试</p>
            <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
              刷新同步状态
            </Button>
          </div>
        ) : (
          <SyncControls
            data={status.data}
            workspaceReady={!recovery.supported || recovery.status.data?.targetReady === true}
          />
        )}
      </CardContent>
    </Card>
  );
}

function SyncControls({
  data,
  workspaceReady,
}: {
  data: DesktopSyncStatus;
  workspaceReady: boolean;
}) {
  const setConsent = useSetSyncConsent();
  const syncNow = useSyncNow();

  const transportBusy = setConsent.isPending || syncNow.isPending;
  const runtimeBusy = data.phase === 'enabling' || data.phase === 'syncing';
  const busy = transportBusy || runtimeBusy || data.reviewRef === null;

  const runConsent = (next: DesktopSyncConsent) => {
    setConsent.mutate(
      { consent: next, ...(data.reviewRef === undefined ? {} : { reviewRef: data.reviewRef }) },
      {
        onSuccess: (status) => {
          if (status.phase === 'error') {
            toast.error(`操作已完成,但同步失败:${status.error ?? '未知错误'}`);
          } else if (next === 'enabled') {
            toast.success(data.consent === 'paused' ? '同步已继续' : '云同步已开启');
          } else if (next === 'paused') {
            toast.success('同步已暂停,本地变更会在继续后上传');
          }
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const runSyncNow = () => {
    syncNow.mutate(undefined, {
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {data.phase === 'auth_blocked' ? (
        <div role="alert" className="text-destructive text-sm" data-testid="sync-error">
          <Badge variant="destructive" data-testid="sync-phase">
            登录失效
          </Badge>
          登录状态已失效或账号尚未验证，请在账号面板重新登录或完成恢复后再继续同步。
          {data.error && <p>{data.error}</p>}
        </div>
      ) : data.phase === 'signed_out' ? (
        <SignedOutNotice />
      ) : data.consent === 'unset' ? (
        workspaceReady ? (
          <ConsentPrompt
            accountName={data.account?.username}
            busy={busy}
            onEnable={() => runConsent('enabled')}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            先在上方查看本机数据，选择复制提示词库或建立空库，再开启云同步。
          </p>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-foreground text-sm">
                {data.consent === 'paused' ? '同步已暂停' : '同步已开启'}
              </p>
              <p
                className="mt-0.5 break-words text-muted-foreground text-xs tabular-nums"
                data-testid="sync-subtitle"
              >
                {data.consent === 'paused'
                  ? '本地仍可正常使用,变更会积累待同步'
                  : `${data.account?.username ?? ''} · ${formatSyncedAt(data.lastSyncedAt)}`}
              </p>
            </div>
            {data.consent === 'paused' ? (
              <Button
                size="sm"
                className="shrink-0 whitespace-nowrap"
                disabled={busy}
                onClick={() => runConsent('enabled')}
                data-testid="sync-consent-resume"
              >
                {setConsent.isPending && <Spinner className="size-3.5" />}
                继续同步
              </Button>
            ) : (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="whitespace-nowrap"
                  disabled={busy}
                  onClick={runSyncNow}
                  data-testid="sync-now"
                >
                  {busy && <Spinner className="size-3.5" />}
                  立即同步
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="whitespace-nowrap"
                  disabled={busy}
                  onClick={() => runConsent('paused')}
                  data-testid="sync-consent-pause"
                >
                  暂停同步
                </Button>
              </div>
            )}
          </div>

          <Separator />

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={isDestructivePhase(data.phase) ? 'destructive' : 'secondary'}
              data-testid="sync-phase"
              role="status"
              aria-live="polite"
            >
              {data.phase === 'syncing' && <Spinner className="size-3" />}
              {PHASE_LABELS[data.phase]}
            </Badge>
            <span
              className="text-muted-foreground text-xs tabular-nums"
              data-testid="sync-legacy-summary"
            >
              {legacySummary(data)}
            </span>
          </div>

          {data.phase === 'error' && (
            <div
              className="flex flex-col gap-1 text-destructive text-xs"
              role="alert"
              data-testid="sync-error"
            >
              <p>同步出错,可重试「立即同步」</p>
              {data.error && <p className="break-words">{data.error}</p>}
            </div>
          )}

          <ConflictSection data={data} />
        </>
      )}
    </div>
  );
}

function isDestructivePhase(phase: DesktopSyncPhase): boolean {
  return phase === 'error' || phase === 'auth_blocked' || phase === 'conflict';
}

/** signed_out:仅提示登录后可开启,不提供任何 transport 动作。 */
function SignedOutNotice() {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium text-foreground text-sm">同步未开启</p>
      <p className="text-muted-foreground text-xs" data-testid="sync-subtitle">
        登录账号后可开启云同步
      </p>
    </div>
  );
}

/** 首次同意(unset / awaiting_consent):显式 CTA,不用 Switch 混淆 paused/unset。 */
function ConsentPrompt({
  busy,
  onEnable,
  accountName,
}: {
  busy: boolean;
  onEnable: () => void;
  accountName?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium text-foreground text-sm">同步未开启</p>
        {accountName && <p className="text-muted-foreground text-xs">账号：{accountName}</p>}
        <p className="mt-0.5 text-muted-foreground text-xs" data-testid="sync-subtitle">
          开启后提示词、文件夹与标签将同步到云端
        </p>
      </div>
      <Button
        size="sm"
        className="shrink-0 whitespace-nowrap"
        disabled={busy}
        onClick={onEnable}
        data-testid="sync-consent-enable"
      >
        {busy && <Spinner className="size-3.5" />}
        开启云同步
      </Button>
    </div>
  );
}

/** 冲突区:仅在需要时查询(enabled/paused 且计数 > 0 或 phase=conflict)。 */
function ConflictSection({ data }: { data: DesktopSyncStatus }) {
  const shouldQuery =
    (data.consent === 'enabled' || data.consent === 'paused') &&
    (data.conflicts > 0 || data.phase === 'conflict');
  const conflicts = useSyncConflicts(shouldQuery);
  const queryClient = useQueryClient();

  // legacy bug 修复:状态里的冲突计数/阶段变化必须刷新明细,不能只更新计数。
  // signature 在闭包内被消费,使 effect 随计数/阶段变化重新触发(Biome deps 合规)。
  const conflictSignature = shouldQuery ? `${data.conflicts}:${data.phase}` : null;
  useEffect(() => {
    if (conflictSignature === null) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.sync.conflicts() });
  }, [conflictSignature, queryClient]);

  if (!shouldQuery) return null;

  return (
    <>
      <Separator />
      <section aria-label="同步冲突" className="flex flex-col gap-2">
        <h3 className="font-medium text-foreground text-sm">需要处理的同步冲突</h3>
        {conflicts.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : conflicts.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-destructive text-xs" role="alert">
              冲突列表读取失败
            </p>
            <Button
              variant="outline"
              size="sm"
              className="whitespace-nowrap"
              onClick={() => void conflicts.refetch()}
              data-testid="sync-conflicts-retry"
            >
              重试
            </Button>
          </div>
        ) : conflicts.data.length === 0 ? (
          <p className="text-muted-foreground text-xs">没有待处理的冲突</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="sync-conflict-list">
            {conflicts.data.map((conflict) => (
              <ConflictRow key={conflict.id} conflict={conflict} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ConflictRow({ conflict }: { conflict: SyncConflictSummary }) {
  const resolve = useResolveSyncConflict();
  const rowBusy = resolve.isPending && resolve.variables?.conflictId === conflict.id;
  const rowError =
    resolve.isError && resolve.variables?.conflictId === conflict.id ? resolve.error : null;

  const local = summarizeSnapshot(conflict.localSnapshot, conflict.entityId);
  const remote = summarizeSnapshot(conflict.remoteSnapshot, conflict.entityId);
  const canKeepLocal = canKeepLocalSyncConflict(conflict);

  const run = (resolution: SyncConflictResolution) => {
    resolve.mutate(
      { conflictId: conflict.id, resolution },
      {
        onError: (error) => toast.error(`「${local.title}」冲突处理失败:${errorMessage(error)}`),
      },
    );
  };

  return (
    <li className="flex flex-col gap-2 py-3" data-testid={`sync-conflict-row-${conflict.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{ENTITY_LABELS[conflict.entityType]}</Badge>
        <time className="text-muted-foreground text-xs tabular-nums" dateTime={conflict.createdAt}>
          冲突于 {formatConflictTime(conflict.createdAt)}
        </time>
      </div>
      <dl className="grid min-w-0 gap-2 text-xs sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-muted-foreground">本机版本</dt>
          <dd className="break-words text-foreground">
            {local.title}
            {local.updatedAt && (
              <span className="text-muted-foreground tabular-nums">
                {' '}
                · 更新于 {formatConflictTime(local.updatedAt)}
              </span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">云端版本</dt>
          <dd className="break-words text-foreground">
            {remote.title}
            {remote.updatedAt && (
              <span className="text-muted-foreground tabular-nums">
                {' '}
                · 更新于 {formatConflictTime(remote.updatedAt)}
              </span>
            )}
          </dd>
        </div>
      </dl>
      {!canKeepLocal && (
        <p className="text-muted-foreground text-xs">
          此分类已在云端永久删除，无法恢复。保留云端会移除本机分类，提示词内容会保留。
        </p>
      )}
      {rowError && (
        <p className="break-words text-destructive text-xs" role="alert">
          处理失败:{errorMessage(rowError)},可重试
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="whitespace-nowrap"
          disabled={rowBusy}
          onClick={() => run('remote')}
        >
          保留云端
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="whitespace-nowrap"
          disabled={rowBusy || !canKeepLocal}
          onClick={() => run('local')}
        >
          保留本地
        </Button>
        {conflict.canDuplicate && (
          <Button
            variant="outline"
            size="sm"
            className="whitespace-nowrap"
            disabled={rowBusy}
            onClick={() => run('duplicate')}
          >
            另存本地副本
          </Button>
        )}
        {rowBusy && <Spinner className="size-3.5" />}
      </div>
    </li>
  );
}
