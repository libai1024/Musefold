import type {
  CloudSyncConflictResolution,
  CloudSyncConflictSummary,
  CloudSyncSummary,
} from '@musefold/desktop-contracts/cloud-sync';
import { Button } from '../../../components/ui/button';
import { SettingsSwitch } from '@musefold/product-ui';
import { cloudSyncLabel } from './account-section-helpers';
import { InlineMessage } from './account-section-ui';

export function AccountCloudSyncPanel({
  cloudSync,
  cloudConflicts,
  cloudError,
  setCloudEnabled,
  syncCloudNow,
  resolveCloudConflict,
}: {
  cloudSync: CloudSyncSummary | null;
  cloudConflicts: CloudSyncConflictSummary[];
  cloudError: string | null;
  setCloudEnabled: (enabled: boolean) => Promise<void>;
  syncCloudNow: () => Promise<void>;
  resolveCloudConflict: (
    conflictId: string,
    resolution: CloudSyncConflictResolution,
  ) => Promise<void>;
}) {
  return (
    <section className="py-5" data-testid="account-cloud-sync">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-[12px] font-medium text-primary">提示词云同步</p>
          <p className="mt-1 max-w-[460px] text-[11px] leading-relaxed text-tertiary">
            在已登录的 Musefold 账号之间同步提示词、文件夹和标签；本机图片路径与密钥不会上传。
          </p>
        </div>
        <SettingsSwitch
          checked={cloudSync?.account?.enabled ?? false}
          onCheckedChange={(enabled) => void setCloudEnabled(enabled)}
          label="提示词云同步"
          disabled={!cloudSync?.available || cloudSync.status === 'syncing'}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-meta text-tertiary">
        <span>
          {cloudSyncLabel(cloudSync)}
          {cloudSync?.account?.deviceName ? ` · 此设备 ${cloudSync.account.deviceName}` : ''}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="px-3 shadow-none"
          disabled={!cloudSync?.account?.enabled || cloudSync.status === 'syncing'}
          onClick={() => void syncCloudNow()}
        >
          {cloudSync?.status === 'syncing' ? '同步中…' : '立即同步'}
        </Button>
      </div>
      {cloudError && <InlineMessage tone="warning">{cloudError}</InlineMessage>}
      {cloudConflicts.length > 0 && (
        <div className="mt-4 border-t border-border-subtle pt-4">
          <p className="text-[11px] font-medium text-primary">需要处理的同步冲突</p>
          <div className="mt-2 divide-y divide-border-subtle border-y border-border-subtle">
            {cloudConflicts.map((conflict) => (
              <CloudConflictRow
                key={conflict.id}
                conflict={conflict}
                onResolve={resolveCloudConflict}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function CloudConflictRow({
  conflict,
  onResolve,
}: {
  conflict: CloudSyncConflictSummary;
  onResolve: (id: string, resolution: CloudSyncConflictResolution) => Promise<void>;
}) {
  const title = String(
    conflict.localSnapshot.title ?? conflict.localSnapshot.name ?? conflict.entityId,
  );
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-secondary" title={title}>
          {title}
        </span>
        <span className="shrink-0 text-meta text-quaternary">
          {conflict.entityType === 'prompt'
            ? '提示词'
            : conflict.entityType === 'folder'
              ? '文件夹'
              : '标签'}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="ghost"
          size="xs"
          className="px-2.5 shadow-none"
          onClick={() => void onResolve(conflict.id, 'remote')}
        >
          保留云端
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="px-2.5 shadow-none"
          onClick={() => void onResolve(conflict.id, 'local')}
        >
          保留本地
        </Button>
        {conflict.canDuplicate && (
          <Button
            variant="ghost"
            size="xs"
            className="px-2.5 shadow-none"
            onClick={() => void onResolve(conflict.id, 'duplicate')}
          >
            另存本地副本
          </Button>
        )}
      </div>
    </div>
  );
}
