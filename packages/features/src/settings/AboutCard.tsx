'use client';

import type { AppInfo } from '@musefold/contracts';
import { useGateway } from '@musefold/platform';
import { MusefoldMark } from '@musefold/ui/components/brand-mark';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@musefold/ui/components/dialog';
import { Kbd } from '@musefold/ui/components/kbd';
import { Separator } from '@musefold/ui/components/separator';
import { toast } from '@musefold/ui/components/sonner';
import { BookOpen, Check, Copy, MessageSquare, Scale } from '@musefold/ui/icons';
import { type ReactNode, useEffect, useState } from 'react';
import { isMacPlatform, PRODUCT_SHORTCUTS } from '../shell/shortcuts';
import { useAppInfo, useOpenProductDocs } from './hooks';
import { THIRD_PARTY_NOTICES } from './third-party-notices';

/**
 * 品牌字体(ZCOOL XiaoWei)是 Theater 第二现场(0707-C2):
 * @font-face 与工作台空态水印同一份资产(packages/ui globals.css),这里只引用不新增。
 */
const BRAND_FONT_STACK = "'ZCOOL XiaoWei', 'Songti SC', 'Noto Serif SC', serif";

const PRODUCT_NAME = 'Musefold / 未像';
const PRODUCT_SLOGAN = '把想法变成可生成的视觉';

/** 平台展示名:报障时「你什么系统」一眼可读,原始标识仍进复制文本。 */
function platformLabel(platform: string): string {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  if (platform === 'linux') return 'Linux';
  return platform;
}

/** 版本信息聚合串(报障粘贴用,07-07 §4-2):版本 / 平台 / schema / 通道。 */
export function formatVersionInfo(appInfo: AppInfo | null): string {
  if (!appInfo) return `${PRODUCT_NAME}\n形态:Web 版`;
  const lines = [
    PRODUCT_NAME,
    `版本:${appInfo.version}`,
    `平台:${platformLabel(appInfo.platform)}(${appInfo.platform} ${appInfo.arch})`,
    `数据库结构版本:${appInfo.schemaVersion}`,
  ];
  if (appInfo.channel) lines.push(`更新通道:${appInfo.channel}`);
  if (appInfo.commit) lines.push(`构建:${appInfo.commit}`);
  return lines.join('\n');
}

/** 反馈信息 = 版本信息 + 日志入口指引(与 07-06 诊断日志行呼应)。 */
export function formatFeedbackInfo(appInfo: AppInfo | null): string {
  return `${formatVersionInfo(appInfo)}\n诊断日志:设置 → 数据 → 诊断日志「查看」`;
}

/** 复制按钮:钮内 Check 1.2s + toast 双反馈(0707-C1 / 0704-C2 同一封装)。 */
function CopyActionButton({
  text,
  label,
  testId,
  toastMessage,
  icon,
}: {
  text: string;
  label: string;
  testId: string;
  toastMessage: string;
  icon?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_200);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-xs"
      data-testid={testId}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            toast.success(toastMessage);
          },
          () => toast.error('复制失败,请手动选中复制'),
        );
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-success" aria-hidden />
      ) : (
        (icon ?? <Copy className="size-3.5" aria-hidden />)
      )}
      {label}
    </Button>
  );
}

/**
 * 设置「关于」分区(07-settings-07):品牌 + 版本 + 支持资源 + 快捷键表,双端同一份。
 *
 * 双端差异只在数据源:桌面经 `gateway.system.getAppInfo()` 拿版本 / 平台 / 库结构版本,
 * Web 宿主没有 system 域 → 版本行显示「Web 版」。
 * 应用更新 / 内容层 / 更新通道三行属暂缓域(热更新控制面),本卡不出现。
 */
export function AboutCard() {
  const appInfo = useAppInfo().data ?? null;
  const hasSystemDomain = Boolean(useGateway().system);

  return (
    <div className="flex flex-col gap-6" data-testid="settings-about-anchor">
      <AboutAppCard appInfo={appInfo} />
      <AboutSupportCard appInfo={appInfo} hasSystemDomain={hasSystemDomain} />
      <ShortcutsCard appInfo={appInfo} />
    </div>
  );
}

function AboutAppCard({ appInfo }: { appInfo: AppInfo | null }) {
  return (
    <Card data-testid="settings-about-card">
      <CardContent className="flex flex-col items-center gap-4 py-6 text-center">
        <MusefoldMark
          className="size-14 text-foreground drop-shadow-sm"
          aria-hidden
          focusable="false"
        />
        <div className="flex flex-col gap-1">
          <p
            className="text-foreground text-xl tracking-wide"
            style={{ fontFamily: BRAND_FONT_STACK }}
            data-testid="settings-about-product"
          >
            {PRODUCT_NAME}
          </p>
          <p className="text-muted-foreground text-[13px]">{PRODUCT_SLOGAN}</p>
        </div>
        <p
          className="font-mono text-muted-foreground text-xs tabular-nums"
          data-testid="settings-about-version"
        >
          {appInfo
            ? `版本 ${appInfo.version} · 库结构 v${appInfo.schemaVersion} · ${platformLabel(appInfo.platform)}`
            : 'Web 版'}
        </p>
        <CopyActionButton
          text={formatVersionInfo(appInfo)}
          label="复制版本信息"
          testId="settings-about-copy-version"
          toastMessage="版本信息已复制"
        />
      </CardContent>
    </Card>
  );
}

function AboutSupportCard({
  appInfo,
  hasSystemDomain,
}: {
  appInfo: AppInfo | null;
  hasSystemDomain: boolean;
}) {
  return (
    <Card data-testid="settings-about-support-card">
      <CardHeader>
        <CardTitle>支持</CardTitle>
        <CardDescription>遇到问题时,把版本信息与诊断日志一起发给维护者最省事</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 pt-0">
        {/* 文档随桌面安装包分发(主进程按白名单资源 id 打开);Web 宿主暂无公开文档站,不渲染死入口。 */}
        {hasSystemDomain && <ProductDocsButton />}
        <CopyActionButton
          text={formatFeedbackInfo(appInfo)}
          label="复制反馈信息"
          testId="settings-about-copy-feedback"
          toastMessage="可连同诊断日志一起发送给维护者"
          icon={<MessageSquare className="size-3.5" aria-hidden />}
        />
        <ThirdPartyNoticesDialog />
      </CardContent>
    </Card>
  );
}

/**
 * `useOpenProductDocs` 依赖 system 域(缺省即抛),所以按能力分叉必须落在**组件边界**上:
 * 这个子组件只在桌面宿主挂载,hook 在其内部无条件调用(Rules of Hooks)。
 */
function ProductDocsButton() {
  const openDocs = useOpenProductDocs();
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-xs"
      data-testid="settings-about-docs"
      disabled={openDocs.isPending}
      onClick={() => openDocs.mutate(undefined, { onError: () => toast.error('文档打开失败') })}
    >
      <BookOpen className="size-3.5" aria-hidden />
      查看文档
    </Button>
  );
}

function ThirdPartyNoticesDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          data-testid="settings-about-notices"
        >
          <Scale className="size-3.5" aria-hidden />
          第三方声明
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" data-testid="settings-about-notices-dialog">
        <DialogHeader>
          <DialogTitle>第三方开源声明</DialogTitle>
          <DialogDescription>未像使用了以下开源项目,在此致谢并遵循其许可条款</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] overflow-y-auto pr-1" aria-label="第三方开源许可列表">
          {THIRD_PARTY_NOTICES.map((notice) => (
            <li
              key={notice.name}
              className="flex items-baseline justify-between gap-3 border-border/60 border-b py-1.5 last:border-b-0"
              data-testid={`settings-about-notice-${notice.name}`}
            >
              <span className="min-w-0 truncate font-mono text-foreground text-xs">
                {notice.name}
              </span>
              <span className="max-w-[55%] shrink-0 text-right text-muted-foreground text-xs">
                {notice.license}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 快捷键表(07-07 §2.4):数据源是 features shell 的 `PRODUCT_SHORTCUTS` 单源 ——
 * 只列真实接线的条目,禁止在这里手写平行表;新接一条快捷键登记后自动上表。
 */
function ShortcutsCard({ appInfo }: { appInfo: AppInfo | null }) {
  // SSR 首帧不可知平台:桌面用 appInfo.platform,Web 挂载后再读 navigator(防 hydration 闪)。
  const [isMacFromNavigator, setIsMacFromNavigator] = useState(false);
  useEffect(() => setIsMacFromNavigator(isMacPlatform()), []);
  const isMac = appInfo ? appInfo.platform === 'darwin' : isMacFromNavigator;

  return (
    <Card data-testid="settings-about-shortcuts-card">
      <CardHeader>
        <CardTitle>快捷键</CardTitle>
        <CardDescription>只列出当前版本真实生效的快捷键</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col pt-0">
        {PRODUCT_SHORTCUTS.map((shortcut, index) => (
          <div key={shortcut.id}>
            {index > 0 && <Separator />}
            <div
              className="flex items-center gap-3 py-2"
              data-testid={`settings-about-shortcut-${shortcut.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm">{shortcut.label}</p>
                <p className="text-muted-foreground text-xs">{shortcut.scope}</p>
              </div>
              <Kbd className="shrink-0">{isMac ? shortcut.mac : shortcut.win}</Kbd>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
