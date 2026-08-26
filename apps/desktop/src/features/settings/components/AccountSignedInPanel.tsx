import type { Dispatch, SetStateAction } from 'react';
import {
  ACCOUNT_DEFAULT_IMAGE_MODEL,
  ACCOUNT_DEFAULT_TEXT_MODEL,
} from '@musefold/domain/constants';
import type {
  AccountErrorCode,
  AccountNotice,
  AccountStatus,
} from '@musefold/desktop-contracts/account';
import type {
  CloudSyncConflictResolution,
  CloudSyncConflictSummary,
  CloudSyncSummary,
} from '@musefold/desktop-contracts/cloud-sync';
import { Button } from '../../../components/ui/button';
import { displayModelName } from '../../../lib/model-catalog';
import { cn } from '../../../lib/utils';
import { AccountScreen, type AccountActionFeedback } from '@musefold/product-ui';
import { SettingRow, SettingsCard } from '../components/SectionShell';
import { healthLabel, points } from './account-section-helpers';
import { InlineMessage } from './account-section-ui';
import { AccountCloudSyncPanel } from './AccountCloudSyncPanel';

export function AccountSignedInPanel({
  status,
  action,
  notices,
  quotaCny,
  confirmLogout,
  setConfirmLogout,
  cloudSync,
  cloudConflicts,
  cloudError,
  refreshQuota,
  redeem,
  logout,
  markNoticeRead,
  setCloudEnabled,
  syncCloudNow,
  resolveCloudConflict,
}: {
  status: AccountStatus;
  action: 'login' | 'register' | 'logout' | 'redeem' | 'refresh' | 'server' | null;
  notices: AccountNotice[];
  quotaCny: number | null;
  confirmLogout: boolean;
  setConfirmLogout: Dispatch<SetStateAction<boolean>>;
  cloudSync: CloudSyncSummary | null;
  cloudConflicts: CloudSyncConflictSummary[];
  cloudError: string | null;
  refreshQuota: () => Promise<unknown>;
  redeem: (code: string) => Promise<{ quotaAdded: number }>;
  logout: () => Promise<unknown>;
  markNoticeRead: (id: string) => void;
  setCloudEnabled: (enabled: boolean) => Promise<void>;
  syncCloudNow: () => Promise<void>;
  resolveCloudConflict: (
    conflictId: string,
    resolution: CloudSyncConflictResolution,
  ) => Promise<void>;
}) {
  const actionError = (cause: unknown, accountAction: 'redeem' | 'refresh'): string => {
    const code = (cause as { code?: AccountErrorCode })?.code;
    if (code === 'ACCOUNT/REDEEM_INVALID') return '兑换码无效或已使用，请检查后重试';
    if (code === 'ACCOUNT/AUTH') return '登录状态已失效，请重新登录';
    if (code === 'ACCOUNT/NETWORK') return '暂时无法连接账号服务器，请稍后重试';
    return accountAction === 'redeem'
      ? '兑换服务暂时不可用，请稍后重试'
      : '刷新失败，请稍后重试';
  };

  return (
    <AccountScreen
      testId="settings-account-signed-in"
      showHeading={false}
      account={{
        name: status.username ?? 'Musefold 账户',
        username: status.username ?? '—',
        avatarLabel: (status.username ?? 'M').slice(0, 1),
        quotaLabel: status.quota ? points(status.quota.value) : '—',
        quotaHint:
          status.estImagesRemaining != null
            ? `约可生成 ${status.estImagesRemaining.toLocaleString('zh-CN')} 张${quotaCny != null ? ` · 约 ¥${quotaCny.toFixed(2)}` : ''}`
            : quotaCny != null
              ? `约 ¥${quotaCny.toFixed(2)}`
              : null,
        generationStatusLabel: status.health === 'ok' ? '可用' : healthLabel(status.health),
        generationAvailable: status.health === 'ok',
        dataSourceLabel: status.isDefaultServer ? 'Musefold Cloud' : '自定义 new-api',
      }}
      redeemBusy={action === 'redeem'}
      refreshBusy={action === 'refresh'}
      onRedeem={async (code): Promise<AccountActionFeedback> => {
        try {
          const result = await redeem(code);
          return {
            tone: 'success',
            message: `兑换成功，${points(result.quotaAdded)}已到账`,
          };
        } catch (cause) {
          return { tone: 'error', message: actionError(cause, 'redeem') };
        }
      }}
      onRefresh={async (): Promise<AccountActionFeedback> => {
        try {
          await refreshQuota();
          return { tone: 'success', message: '账户信息已刷新' };
        } catch (cause) {
          return { tone: 'error', message: actionError(cause, 'refresh') };
        }
      }}
      overviewAccessory={(
        <span
          className={cn(
            'inline-flex h-7 items-center rounded-md border px-3 text-[11px] font-medium',
            status.health === 'ok'
              ? 'border-border-default text-secondary'
              : status.health === 'token-invalid'
                ? 'border-danger/40 text-danger'
                : 'border-warning/40 text-warning',
          )}
        >
          {healthLabel(status.health)}
        </span>
      )}
      extensions={(
        <>
          {status.health === 'token-invalid' && (
            <div>
              <InlineMessage tone="danger">
                登录状态已失效。重新登录后，现有模型配置会自动恢复。
              </InlineMessage>
              <Button
                variant="outline"
                size="xs"
                className="mt-2 px-3 shadow-none"
                onClick={() => void logout()}
              >
                重新登录
              </Button>
            </div>
          )}
          {status.health === 'unreachable' && (
            <InlineMessage tone="warning">暂时无法连接账号服务器。本地内容不受影响。</InlineMessage>
          )}

      <SettingsCard
        title="账号内置模型"
        description="由 Musefold 固定配置，无需选择或维护模型 ID。"
        bodyClassName="settings-account-card"
        data-testid="account-managed-models"
      >
        <div className="grid gap-1.5 py-4 text-meta sm:grid-cols-2">
          <p className="flex items-center justify-between gap-4">
            <span className="text-tertiary">生图</span>
            <span className="font-medium text-secondary">
              {displayModelName(ACCOUNT_DEFAULT_IMAGE_MODEL)}
            </span>
          </p>
          <p className="flex items-center justify-between gap-4">
            <span className="text-tertiary">Agent</span>
            <span className="font-medium text-secondary">
              {displayModelName(ACCOUNT_DEFAULT_TEXT_MODEL)}
            </span>
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title="数据与同步" description="在已登录的 Musefold 账号之间同步提示词数据">
        <AccountCloudSyncPanel
          cloudSync={cloudSync}
          cloudConflicts={cloudConflicts}
          cloudError={cloudError}
          setCloudEnabled={setCloudEnabled}
          syncCloudNow={syncCloudNow}
          resolveCloudConflict={resolveCloudConflict}
        />
      </SettingsCard>

      {notices.length > 0 && (
        <SettingsCard
          title="服务公告"
          description="来自账号服务器的最新通知"
          action={
            <Button
              type="button"
              unstyled
              className="no-drag text-meta text-tertiary underline-offset-4 hover:text-primary hover:underline"
              onClick={() => notices.forEach((notice) => markNoticeRead(notice.id))}
            >
              全部已读
            </Button>
          }
          bodyClassName="settings-account-card"
        >
          <div className="divide-y divide-border-subtle border-y border-border-subtle">
            {notices.map((notice) => (
              <div key={notice.id} className="py-3 text-[11.5px] leading-relaxed text-secondary">
                {notice.content}
              </div>
            ))}
          </div>
        </SettingsCard>
      )}

      <SettingsCard
        title="登录与设备"
        description="当前设备的登录凭据与账号服务器"
        bodyClassName="settings-account-card"
      >
        <SettingRow label={status.username ?? '—'} hint="当前账号">
          <span className="font-mono text-[11px] text-tertiary">
            令牌 ····{status.deviceTokenSuffix ?? '—'}
          </span>
        </SettingRow>
        <SettingRow
          label="账号服务器"
          hint={status.isDefaultServer ? 'Musefold Cloud' : '自定义 new-api'}
        >
          <span
            className="block max-w-[300px] truncate font-mono text-meta text-tertiary"
            title={status.serverUrl}
          >
            {status.serverUrl}
          </span>
        </SettingRow>
        <div className="pb-2 pt-4">
          {!confirmLogout ? (
            <Button
              variant="ghost"
              size="sm"
              className="px-3 text-tertiary shadow-none"
              onClick={() => setConfirmLogout(true)}
            >
              退出登录
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-tertiary">
              <span>将移除本机托管配置；手动服务商不受影响。</span>
              <Button
                variant="danger"
                size="xs"
                className="px-3 shadow-none"
                disabled={action === 'logout'}
                onClick={() => void logout()}
              >
                确认退出
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="px-3 shadow-none"
                onClick={() => setConfirmLogout(false)}
              >
                取消
              </Button>
            </div>
          )}
        </div>
      </SettingsCard>
        </>
      )}
    />
  );
}
