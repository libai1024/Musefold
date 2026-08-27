// 关于页「应用更新」卡的应用更新状态机行(自 AboutSection 拆出)。
// 状态变化容器带 aria-live,读屏可播报;下载/版本数字用 tabular figures 防行宽抖动。
import { Download, Loader2, RefreshCw } from '../../../components/ui/icons';
import type { Channel, UpdateStatus } from '@musefold/desktop-contracts/updater';
import { Button } from '../../../components/ui/button';
import { CHANNEL_LABELS } from './UpdateChannelRow';

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateRow({
  status,
  channel,
  onAction,
}: {
  status: UpdateStatus | null;
  channel: Channel;
  onAction: () => void;
}) {
  // 初始态诚实化:IPC getState 返回前是「未检查更新」,不是「正在检查」(设置评审 P1-4)
  const state = status?.state ?? 'unknown';
  const isBusy = state === 'checking' || state === 'downloading' || state === 'installing';
  const versionLabel = status && 'version' in status ? status.version : '';
  const disabledReason = status?.state === 'disabled' ? status.reason : undefined;
  const progress = status?.state === 'downloading' ? status.progress : null;
  const errorMessage = status?.state === 'error' ? status.message : undefined;
  const title =
    state === 'disabled'
      ? '自动更新暂不可用'
      : state === 'not-available'
        ? '已是最新版本'
        : state === 'available'
          ? `发现新版本 v${versionLabel}`
          : state === 'downloaded'
            ? `v${versionLabel} 已下载`
            : state === 'downloading'
              ? `正在下载 v${versionLabel}`
              : state === 'installing'
                ? '正在重启安装'
                : state === 'error'
                  ? '更新检查失败'
                  : state === 'checking'
                    ? '正在检查更新'
                    : '未检查更新';
  const description =
    state === 'disabled'
      ? disabledReason === 'development'
        ? '开发环境不会连接更新服务器'
        : '当前平台或运行配置不支持自动更新'
      : state === 'available'
        ? '下载完成后可重启 Musefold 完成更新'
        : state === 'downloaded'
          ? '重启应用即可完成安装，创作数据不会被删除'
          : state === 'downloading'
            ? `${Math.round(progress?.percent ?? 0)}% · ${formatBytes(progress?.transferred ?? 0)} / ${formatBytes(progress?.total ?? 0)}`
            : state === 'error'
              ? (errorMessage ?? '请稍后重试')
              : channel === 'stable'
                ? '从 zhaozhaoyue.top 获取已签名的稳定版本'
                : `当前为${CHANNEL_LABELS[channel]}通道，版本可能不稳定`;
  const action =
    state === 'available'
      ? '下载'
      : state === 'downloaded'
        ? '重启更新'
        : state === 'disabled'
          ? '不可用'
          : state === 'not-available'
            ? '重新检查'
            : state === 'error'
              ? '重试'
              : '检查更新';
  const Icon = isBusy ? Loader2 : state === 'downloaded' ? Download : RefreshCw;

  return (
    <div
      className="settings-row flex items-center gap-6 py-[var(--density-setting-row-y)]"
      data-testid="about-updater"
    >
      <div className="min-w-0 flex-1" aria-live="polite">
        <p className="text-[12.5px] font-medium tabular-nums text-primary">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed tabular-nums text-tertiary">
          {description}
        </p>
      </div>
      <Button
        size="sm"
        variant={state === 'downloaded' ? 'primary' : 'outline'}
        onClick={() => void onAction()}
        disabled={isBusy || state === 'disabled'}
        data-testid="about-update-action"
      >
        <Icon className={isBusy ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
        {action}
      </Button>
    </div>
  );
}
