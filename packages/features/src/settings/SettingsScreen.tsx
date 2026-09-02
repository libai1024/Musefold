import type { AppLanguage, AppTheme, MotionLevel } from '@musefold/contracts';
import { useCapabilities } from '@musefold/platform';
import { Badge } from '@musefold/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Label } from '@musefold/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { Separator } from '@musefold/ui/components/separator';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { ChevronRight, History, Library } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { AccountPanel } from '../account/AccountPanel';
import { AiConnectionsPanel } from '../account/AiConnectionsPanel';
import { CloudSyncPanel } from '../account/CloudSyncPanel';
import { DoubaoConnectionPanel } from '../account/DoubaoConnectionPanel';
import { useScreenIntent } from '../shell/screen-intent-store';
import { ArchivedSessionsPanel } from './ArchivedSessionsPanel';
import { usePreferences, useUpdatePreferences } from './hooks';

const THEME_LABELS: Record<AppTheme, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
};

/** 三档动效(契约 motionLevelSchema,承旧 v2.1 语义):off 可覆盖系统减弱设置。 */
const MOTION_LABELS: Record<MotionLevel, string> = {
  system: '跟随系统',
  on: '减少动效',
  off: '完整动效',
};

export interface SettingsScreenProps {
  /** 「数据」卡回收站入口的切屏回调;缺省不渲染该卡(宿主未接线时)。 */
  onOpenScreen?(id: 'prompts' | 'history'): void;
}

/**
 * 设置屏幕 —— v2.5 双宿主打样域。
 * 同一份组件在 Next.js 壳与 Electron 新渲染壳渲染,数据经 MusefoldGateway。
 */
export function SettingsScreen({ onOpenScreen }: SettingsScreenProps = {}) {
  const capabilities = useCapabilities();
  const preferences = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const setIntent = useScreenIntent((s) => s.setIntent);
  const consume = useScreenIntent((s) => s.consume);

  // 侧栏账号区深链(账号/中转站/豆包):滚到目标卡并短暂点亮边界。
  const accountAnchorRef = useRef<HTMLDivElement>(null);
  const connectionsAnchorRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState<'account' | 'connections' | null>(null);
  useEffect(() => {
    const target = consume('settings-account')
      ? ('account' as const)
      : consume('settings-connections')
        ? ('connections' as const)
        : null;
    if (!target) return;
    // 中转站卡仅桌面存在;Web 深链兜底落账户卡。
    const node =
      target === 'connections' && connectionsAnchorRef.current
        ? connectionsAnchorRef.current
        : accountAnchorRef.current;
    const effective = node === connectionsAnchorRef.current ? 'connections' : 'account';
    setHighlight(effective);
    node?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    // 不做 cleanup:StrictMode 双跑时二次效应消费不到意图,cleanup 会把首跑的高亮吞掉;
    // 卸载后到点 setState 是无害 no-op。
    window.setTimeout(() => setHighlight(null), 1_800);
  }, [consume]);

  const anchorClass = (active: boolean) =>
    cn(
      'scroll-mt-6 rounded-xl transition-shadow duration-(--dur-base)',
      active && 'ring-2 ring-primary/40 ring-offset-2 ring-offset-background',
    );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6" data-testid="settings-screen">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-foreground text-xl">设置</h1>
          <p className="mt-1 text-muted-foreground text-sm">外观、语言与账号</p>
        </div>
        <Badge variant="secondary" data-testid="settings-host-badge">
          {capabilities.host === 'desktop' ? '桌面版' : 'Web 版'}
        </Badge>
      </header>

      <Card data-testid="settings-appearance-card">
        <CardHeader>
          <CardTitle>外观</CardTitle>
          <CardDescription>主题与动效偏好,仅保存在本机</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {preferences.isPending ? (
            <Skeleton className="h-9 w-full" data-testid="settings-loading" />
          ) : preferences.isError ? (
            <p className="text-destructive text-sm">偏好读取失败,请重试</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="settings-theme">主题</Label>
                <Select
                  value={preferences.data.theme}
                  onValueChange={(value) => updatePreferences.mutate({ theme: value as AppTheme })}
                >
                  <SelectTrigger
                    id="settings-theme"
                    className="w-44"
                    data-testid="settings-theme-trigger"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(THEME_LABELS) as AppTheme[]).map((theme) => (
                      <SelectItem key={theme} value={theme} data-testid={`settings-theme-${theme}`}>
                        {THEME_LABELS[theme]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="settings-motion">动效</Label>
                  <p className="mt-1 text-muted-foreground text-xs">
                    减少动效可降低视觉干扰与耗电;跟随系统读取系统辅助功能设置
                  </p>
                </div>
                <Select
                  value={preferences.data.reducedMotion}
                  onValueChange={(value) =>
                    updatePreferences.mutate({ reducedMotion: value as MotionLevel })
                  }
                >
                  <SelectTrigger
                    id="settings-motion"
                    className="w-44 shrink-0"
                    data-testid="settings-motion-trigger"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(MOTION_LABELS) as MotionLevel[]).map((level) => (
                      <SelectItem
                        key={level}
                        value={level}
                        data-testid={`settings-motion-${level}`}
                      >
                        {MOTION_LABELS[level]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="settings-language">语言</Label>
                <Select
                  value={preferences.data.language}
                  onValueChange={(value) =>
                    updatePreferences.mutate({ language: value as AppLanguage })
                  }
                >
                  <SelectTrigger
                    id="settings-language"
                    className="w-44"
                    data-testid="settings-language-trigger"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(LANGUAGE_LABELS) as AppLanguage[]).map((language) => (
                      <SelectItem key={language} value={language}>
                        {LANGUAGE_LABELS[language]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div
        ref={accountAnchorRef}
        className={anchorClass(highlight === 'account')}
        data-testid="settings-account-anchor"
      >
        <AccountPanel />
      </div>

      {capabilities.hasCloudSyncControls && <CloudSyncPanel />}

      {(capabilities.hasLocalAiProviders || capabilities.hasDoubaoWebLogin) && (
        <div
          ref={connectionsAnchorRef}
          className={cn('flex flex-col gap-6', anchorClass(highlight === 'connections'))}
          data-testid="settings-connections-anchor"
        >
          {capabilities.hasLocalAiProviders && <AiConnectionsPanel />}
          {/* 豆包免费试用(V25-UI-SPEC §0.2 可达入口):仅桌面宿主渲染。 */}
          {capabilities.hasDoubaoWebLogin && <DoubaoConnectionPanel />}
        </div>
      )}

      {onOpenScreen && (
        <Card data-testid="settings-data-card">
          <CardHeader>
            <CardTitle>数据</CardTitle>
            <CardDescription>已删除的内容进入回收站;已归档对话可就地恢复或删除</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 pt-0">
            <button
              type="button"
              className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm transition-colors hover:bg-muted"
              data-testid="settings-open-prompt-trash"
              onClick={() => {
                setIntent({ kind: 'prompts-trash' });
                onOpenScreen('prompts');
              }}
            >
              <Library className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1 text-foreground">提示词回收站</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
            <button
              type="button"
              className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm transition-colors hover:bg-muted"
              data-testid="settings-open-history-trash"
              onClick={() => {
                setIntent({ kind: 'history-trash' });
                onOpenScreen('history');
              }}
            >
              <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1 text-foreground">生成历史回收站</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
            <Separator className="my-1" />
            <ArchivedSessionsPanel />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
