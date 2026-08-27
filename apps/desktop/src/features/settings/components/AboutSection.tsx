// 关于 —— 品牌、版本、更新、支持与快捷键(v0.3.2 起并入原「品牌信息」分区)。
// 行组件拆分:内容层 → AboutContentLayerRow,应用更新 → AboutUpdateRow,支持 → AboutSupportCard。
import { useEffect, useState } from 'react';
import { Check, Copy, ShieldCheck } from '../../../components/ui/icons';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import type {
  Channel,
  ContentLayerState,
  UpdateChannelInfo,
  UpdateChannelResult,
  UpdateStatus,
} from '@musefold/desktop-contracts/updater';
import { usePlatform } from '../../../lib/usePlatform';
import { toast } from '../../../stores/toast';
import { Kbd } from '@musefold/ui';
import { PRODUCT_SHORTCUTS, shortcutDisplayKeys } from '@musefold/domain';
import { MusefoldLogoAnimated } from '../../../components/brand/MusefoldLogoAnimated';
import { SettingsCard } from '../components/SectionShell';
import { UpdateChannelRow } from './UpdateChannelRow';
import { ContentLayerRow } from './AboutContentLayerRow';
import { UpdateRow } from './AboutUpdateRow';
import { AboutSupportCard } from './AboutSupportCard';

interface VersionInfo {
  app: string;
  db: number;
}

const DEFAULT_CHANNEL_INFO: UpdateChannelInfo = { channel: 'stable', lockedByEnv: false };

// 快捷键表只列真实接线的条目(设置评审 P0):
// ⌘F 未接任何全局 keydown 监听,列出即说谎;navigation-catalog 是共享单一事实源,过滤在展示层做。
const HIDDEN_SHORTCUT_IDS = new Set(['search']);
// Enter 系快捷键只在聚焦工作台输入框时生效,标注作用域避免「全工作区可用」的误导
const COMPOSER_SCOPED_IDS = new Set(['submit', 'newline']);

export function AboutSection() {
  const { isMac, name: platform } = usePlatform();
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [channelInfo, setChannelInfo] = useState<UpdateChannelInfo>(DEFAULT_CHANNEL_INFO);
  const [contentState, setContentState] = useState<ContentLayerState | null>(null);
  const [contentChecking, setContentChecking] = useState(false);
  const mod = isMac ? '⌘' : 'Ctrl';

  useEffect(() => {
    let mounted = true;
    api.system
      .getVersion()
      .then((value) => mounted && setVersion(value))
      .catch(() => mounted && setVersion(null));
    api.updater
      .getState()
      .then((value) => mounted && setUpdateStatus(value))
      .catch(() => mounted && setUpdateStatus(null));
    api.updater
      .getChannel()
      .then((value) => mounted && setChannelInfo(value))
      .catch(() => mounted && setChannelInfo(DEFAULT_CHANNEL_INFO));
    api.updater
      .getContentState()
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

  const shortcuts = PRODUCT_SHORTCUTS.filter((spec) => !HIDDEN_SHORTCUT_IDS.has(spec.id)).map(
    (spec) => ({
      keys: shortcutDisplayKeys(spec, mod),
      label: COMPOSER_SCOPED_IDS.has(spec.id) ? `${spec.label} · 工作台输入框` : spec.label,
    }),
  );

  const versionText = version
    ? `Musefold ${version.app} · DB ${version.db}`
    : 'Musefold 未读取 · DB 未读取';

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
      toast.error(
        '文档打开失败',
        error instanceof Error ? error.message : '请检查安装文件是否完整',
      );
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
    <div>
      {/* 品牌 + 版本 —— 原「品牌信息」分区并入此处 */}
      <SettingsCard title="应用信息" description="Musefold 版本、品牌与数据库结构信息">
        <div className="settings-brand-panel setting-item" data-testid="about-brand">
          <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-elevated shadow-sm">
            <MusefoldLogoAnimated className="h-11 w-11" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold tracking-tight text-primary">Musefold</p>
            <p className="mt-0.5 text-[11.5px] text-secondary">未像 · 让灵感成为图像</p>
            <p className="mt-1 text-meta text-tertiary">
              视觉灵感与 AI 生图工作台 · 收集 · 折叠 · 显形 · 继续
            </p>
            <p className="mt-1 text-meta text-quaternary">开发者：昭昭月科技有限公司</p>
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
              <span className="block text-meta text-quaternary">
                DB schema {version?.db ?? '未读取'}
              </span>
            </span>
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-quaternary group-hover:text-secondary" />
            )}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title="应用更新" description="选择更新通道并检查应用与内容层版本">
        <UpdateChannelRow info={channelInfo} onCommit={commitChannel} />
        <ContentLayerRow
          state={contentState}
          checking={contentChecking}
          onCheck={() => void checkContentNow()}
        />
        <UpdateRow status={updateStatus} channel={channelInfo.channel} onAction={updateAction} />
      </SettingsCard>

      <SettingsCard title="支持" description="查看文档、反馈问题和开源许可">
        <AboutSupportCard onOpenDocs={openDocs} onCopyFeedback={copyFeedbackInfo} />
      </SettingsCard>

      <SettingsCard title="键盘快捷键" description="全局快捷键与工作台输入框内的按键操作">
        {shortcuts.map((shortcut) => (
          <div key={shortcut.label} className="setting-item">
            <span className="text-[12px] text-secondary">{shortcut.label}</span>
            <span className="flex shrink-0 items-center gap-1">
              {shortcut.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </SettingsCard>

      <div className="settings-note flex items-start gap-2 border-t border-border-subtle pt-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <p className="text-[11px] leading-relaxed text-tertiary">
          本地优先：创作内容与应用数据留在当前设备；API 密钥经系统级加密（macOS Keychain / Windows
          DPAPI）保存，仅主进程可解密，永不写入日志或暴露给渲染进程。
        </p>
      </div>
    </div>
  );
}
