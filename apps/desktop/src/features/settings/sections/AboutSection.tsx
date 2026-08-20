// 关于 —— 品牌、版本、支持资源与开源许可（v0.3.2 起并入原「品牌信息」分区）。
import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from '../../../components/ui/icons';
import { api } from '../../../lib/ipc';
import type {
  Channel,
  ContentLayerCheckSnapshot,
  ContentLayerState,
  UpdateChannelInfo,
  UpdateChannelResult,
  UpdateStatus,
} from '@musefold/desktop-contracts/updater';
import { usePlatform } from '../../../lib/usePlatform';
import { toast } from '../../../stores/toast';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Kbd } from '../../../components/ui/kbd';
import { MusefoldLogoAnimated } from '../../../components/brand/MusefoldLogoAnimated';
import { SectionShell } from '../components/SectionShell';
import { THIRD_PARTY_PACKAGES } from '../third-party-notices';
import { CHANNEL_LABELS, UpdateChannelRow } from './UpdateChannelRow';

interface VersionInfo {
  app: string;
  db: number;
}

const DEFAULT_CHANNEL_INFO: UpdateChannelInfo = { channel: 'stable', lockedByEnv: false };

/** 内容层检查 status → 人话。未列出的走「未知状态」。 */
const CONTENT_CHECK_STATUS_LABELS: Record<string, string> = {
  trust_anchor_missing: '更新通道未启用',
  manifest_unreachable: '暂时无法获取更新清单',
  manifest_invalid: '更新清单无效',
  installed: '已下载，重启后启用',
  already_installed: '已是最新内容',
  surface_missing: '当前通道暂无桌面内容包',
  not_in_rollout: '尚未轮到此次更新',
  url_not_https: '更新源不安全，已跳过',
  invalid_bundle_version: '内容包版本无效',
  download_failed: '内容包下载失败',
  size_mismatch: '内容包大小校验未通过',
  sha256_mismatch: '内容包校验未通过',
  extract_failed: '内容包解压失败',
  incomplete_bundle: '内容包不完整',
  disk_error: '无法写入本地内容包',
};

/** manifest_invalid 的 reason → 更具体的人话；与 status 映射独立，缺省回退 status 文案。 */
const CONTENT_CHECK_REASON_LABELS: Record<string, string> = {
  invalid_json: '更新清单格式无效',
  trust_anchor_missing: '更新通道未启用',
  invalid_signature: '更新清单签名无效',
  unsupported_schema_version: '更新清单版本不受支持',
  channel_mismatch: '更新清单与当前通道不匹配',
  invalid_manifest: '更新清单字段无效',
  incompatible_shell_version: '当前应用版本不兼容该内容包',
  bundle_version_not_increasing: '已是最新内容',
  bundle_version_rejected: '该内容包先前已被拒绝',
};

export function AboutSection() {
  const { isMac, name: platform } = usePlatform();
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [channelInfo, setChannelInfo] = useState<UpdateChannelInfo>(DEFAULT_CHANNEL_INFO);
  const [contentState, setContentState] = useState<ContentLayerState | null>(null);
  const [contentChecking, setContentChecking] = useState(false);
  const mod = isMac ? '⌘' : 'Ctrl';

  useEffect(() => {
    let mounted = true;
    api.system.getVersion()
      .then((value) => mounted && setVersion(value))
      .catch(() => mounted && setVersion(null));
    api.updater.getState()
      .then((value) => mounted && setUpdateStatus(value))
      .catch(() => mounted && setUpdateStatus(null));
    api.updater.getChannel()
      .then((value) => mounted && setChannelInfo(value))
      .catch(() => mounted && setChannelInfo(DEFAULT_CHANNEL_INFO));
    api.updater.getContentState()
      .then((value) => mounted && setContentState(value))
      .catch(() => mounted && setContentState(null));
    const unsubscribe = api.updater.onStateChanged((value) => {
      if (mounted) setUpdateStatus(value);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const shortcuts: { keys: string[]; label: string }[] = [
    { keys: [mod, 'K'], label: '命令面板' },
    { keys: [mod, 'N'], label: '新建' },
    { keys: [mod, 'F'], label: '搜索' },
    { keys: ['Enter'], label: '发送（生成）' },
    { keys: ['Shift', 'Enter'], label: '换行' },
  ];

  const versionText = version ? `Musefold ${version.app} · DB ${version.db}` : 'Musefold 未读取 · DB 未读取';

  const copyVersion = async () => {
    try {
      await navigator.clipboard.writeText(versionText);
      setCopied(true);
      toast.success('版本信息已复制');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败', '剪贴板不可用');
    }
  };

  const openDocs = async () => {
    try {
      await api.system.openAboutResource('product-docs');
    } catch (error) {
      toast.error('文档打开失败', error instanceof Error ? error.message : '请检查安装文件是否完整');
    }
  };

  const copyFeedbackInfo = async () => {
    const details = [
      versionText,
      `Platform ${platform ?? 'unknown'}`,
      '请在此补充：发生了什么、期望结果、复现步骤。',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(details);
      toast.success('反馈信息已复制', '可连同诊断日志一起发送给维护者');
    } catch {
      toast.error('复制失败', '剪贴板不可用');
    }
  };

  const commitChannel = async (next: Channel): Promise<UpdateChannelResult> => {
    try {
      const result = await api.updater.setChannel(next);
      if (!result.ok) {
        toast.error('切换更新通道失败', result.message);
        return result;
      }
      setChannelInfo(result);
      setUpdateStatus(await api.updater.check());
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '请稍后重试';
      toast.error('切换更新通道失败', message);
      return {
        ok: false,
        channel: channelInfo.channel,
        lockedByEnv: channelInfo.lockedByEnv,
        message,
      };
    }
  };

  const checkContentNow = async () => {
    setContentChecking(true);
    try {
      await api.updater.checkContentNow();
      const next = await api.updater.getContentState();
      setContentState(next);
    } catch (error) {
      toast.error('内容更新检查失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      setContentChecking(false);
    }
  };

  const updateAction = async () => {
    try {
      if (updateStatus?.state === 'available') {
        setUpdateStatus(await api.updater.download());
      } else if (updateStatus?.state === 'downloaded') {
        setUpdateStatus(await api.updater.install());
      } else {
        setUpdateStatus(await api.updater.check());
      }
    } catch (error) {
      toast.error('更新操作失败', error instanceof Error ? error.message : '请稍后重试');
    }
  };

  return (
    <SectionShell title="关于" description="品牌、版本、支持资源与开源许可。">
      <div className="flex flex-col gap-6">
        {/* 品牌 + 版本 —— 原「品牌信息」分区并入此处 */}
        <div className="flex items-center gap-4 border-y border-border-subtle py-5" data-testid="about-brand">
          <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-2xl border border-border-subtle bg-elevated shadow-sm">
            <MusefoldLogoAnimated className="h-11 w-11" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold tracking-tight text-primary">Musefold</p>
            <p className="mt-0.5 text-[11.5px] text-secondary">未像 · 让灵感成为图像</p>
            <p className="mt-1 text-[10.5px] text-tertiary">视觉灵感与 AI 生图工作台 · 收集 · 折叠 · 显形 · 继续</p>
            <p className="mt-1 text-[10.5px] text-quaternary">开发者：昭昭月科技有限公司</p>
          </div>
          <button
            type="button"
            onClick={copyVersion}
            className="group flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-ring)]"
            title="复制版本信息"
            data-testid="about-version"
          >
            <span className="font-mono text-[11px] leading-tight text-secondary">
              <span className="block">v{version?.app ?? '未读取'}</span>
              <span className="block text-[10px] text-quaternary">DB schema {version?.db ?? '未读取'}</span>
            </span>
            {copied
              ? <Check className="h-3.5 w-3.5 text-success" />
              : <Copy className="h-3.5 w-3.5 text-quaternary group-hover:text-secondary" />}
          </button>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium text-tertiary">应用更新</p>
          <div className="divide-y divide-border-subtle border-y border-border-subtle">
            <UpdateChannelRow info={channelInfo} onCommit={commitChannel} />
            <ContentLayerRow
              state={contentState}
              checking={contentChecking}
              onCheck={() => void checkContentNow()}
            />
            <UpdateRow status={updateStatus} channel={channelInfo.channel} onAction={updateAction} />
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium text-tertiary">
            支持
          </p>
          <div className="divide-y divide-border-subtle border-y border-border-subtle">
            <SupportRow
              title="产品文档"
              description="打开随应用提供的功能与数据说明"
              action="打开"
              onClick={openDocs}
              testId="about-open-docs"
            />
            <SupportRow
              title="问题反馈"
              description="复制版本、系统与复现信息模板"
              action="复制信息"
              onClick={copyFeedbackInfo}
              testId="about-copy-feedback"
            />
            <SupportRow
              title="开源许可"
              description="Musefold 使用 MIT 许可，并包含第三方开源组件"
              action="查看"
              onClick={() => setLicensesOpen(true)}
              testId="about-open-licenses"
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium text-tertiary">
            键盘快捷键
          </p>
          <div className="flex flex-col divide-y divide-border-subtle border-y border-border-subtle">
            {shortcuts.map((shortcut) => (
              <div key={shortcut.label} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-[12px] text-secondary">{shortcut.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {shortcut.keys.map((key) => <Kbd key={key}>{key}</Kbd>)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2 border-t border-border-subtle pt-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p className="text-[11px] leading-relaxed text-tertiary">
            本地优先：创作内容与应用数据留在当前设备；API 密钥经系统级加密（macOS Keychain / Windows DPAPI）保存，仅主进程可解密，永不写入日志或暴露给渲染进程。
          </p>
        </div>
      </div>

      <Dialog open={licensesOpen} onOpenChange={setLicensesOpen}>
        <DialogContent className="max-w-xl" data-testid="about-licenses-dialog">
          <DialogHeader>
            <DialogTitle>开源许可</DialogTitle>
            <DialogDescription>
              Musefold 采用 MIT License。以下为发行包中的直接运行时依赖；各组件版权归原作者所有。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(58vh,440px)] overflow-y-auto rounded-lg border border-border-subtle bg-inset/35">
            {THIRD_PARTY_PACKAGES.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between gap-4 border-b border-border-subtle px-3 py-2 last:border-b-0"
              >
                <span className="min-w-0 truncate font-mono text-[11px] text-secondary">{item.name}</span>
                <span className="shrink-0 text-[10px] font-medium text-tertiary">{item.license}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={() => setLicensesOpen(false)}>完成</Button>
          </div>
        </DialogContent>
      </Dialog>
    </SectionShell>
  );
}

function ContentLayerRow({
  state,
  checking,
  onCheck,
}: {
  state: ContentLayerState | null;
  checking: boolean;
  onCheck: () => void;
}) {
  const versionLabel = !state
    ? '未读取'
    : state.activeSource === 'builtin'
      ? '内置'
      : (state.activeBundleVersion ?? '已应用');
  const pendingVersion = state?.pendingVersion ?? null;
  const checkLabel = formatContentCheckLabel(state?.lastCheck ?? null);

  return (
    <div className="settings-row flex items-center gap-6 py-[var(--density-setting-row-y)]" data-testid="about-content-layer">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-primary">内容层 · {versionLabel}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">{checkLabel}</p>
        {pendingVersion ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">
            重启后启用 {pendingVersion}
          </p>
        ) : null}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onCheck}
        disabled={checking}
        data-testid="about-content-check-action"
      >
        {checking
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : <RefreshCw className="h-3 w-3" />}
        检查内容更新
      </Button>
    </div>
  );
}

function formatContentCheckLabel(lastCheck: ContentLayerCheckSnapshot | null): string {
  if (!lastCheck) return '尚未检查';
  if (lastCheck.reason) {
    const reasonLabel = CONTENT_CHECK_REASON_LABELS[lastCheck.reason];
    if (reasonLabel) return reasonLabel;
  }
  return CONTENT_CHECK_STATUS_LABELS[lastCheck.status] ?? '未知状态';
}

function UpdateRow({
  status,
  channel,
  onAction,
}: {
  status: UpdateStatus | null;
  channel: Channel;
  onAction: () => void;
}) {
  const state = status?.state ?? 'checking';
  const isBusy = state === 'checking' || state === 'downloading' || state === 'installing';
  const versionLabel = status && 'version' in status ? status.version : '';
  const disabledReason = status?.state === 'disabled' ? status.reason : undefined;
  const progress = status?.state === 'downloading' ? status.progress : null;
  const errorMessage = status?.state === 'error' ? status.message : undefined;
  const title = state === 'disabled'
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
                  : '检查应用更新';
  const description = state === 'disabled'
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
            ? errorMessage ?? '请稍后重试'
            : channel === 'stable'
              ? '从 zhaozhaoyue.top 获取已签名的稳定版本'
              : `当前为${CHANNEL_LABELS[channel]}通道，版本可能不稳定`;
  const action = state === 'available'
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
    <div className="settings-row flex items-center gap-6 py-[var(--density-setting-row-y)]" data-testid="about-updater">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-primary">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">{description}</p>
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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function SupportRow({
  title,
  description,
  action,
  onClick,
  testId,
}: {
  title: string;
  description: string;
  action: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <div className="settings-row flex items-center gap-6 py-[var(--density-setting-row-y)]">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-primary">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">{description}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onClick} data-testid={testId}>{action}</Button>
    </div>
  );
}
