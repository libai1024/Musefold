import type { AppLanguage, AppTheme, InterfaceDensity, MotionLevel } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
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
import { ToggleGroup, ToggleGroupItem } from '@musefold/ui/components/toggle-group';
import {
  Minimize2,
  Monitor,
  Moon,
  Sparkles,
  StretchVertical,
  Sun,
  ZapOff,
} from '@musefold/ui/icons';
import { useEffect, useState } from 'react';
import { usePreferences, useUpdatePreferences } from './hooks';
import { SEGMENT_GROUP_CLASS, SEGMENT_ITEM_CLASS } from './segment-classes';

const THEME_OPTIONS: readonly { value: AppTheme; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
];

const MOTION_OPTIONS: readonly { value: MotionLevel; label: string; icon: typeof Monitor }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'on', label: '减少动效', icon: ZapOff },
  { value: 'off', label: '完整动效', icon: Sparkles },
];

const DENSITY_OPTIONS: readonly {
  value: InterfaceDensity;
  label: string;
  icon: typeof Minimize2;
}[] = [
  { value: 'comfortable', label: '舒适', icon: StretchVertical },
  { value: 'compact', label: '紧凑', icon: Minimize2 },
];

const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
};

/** 挂载后读 matchMedia,避免 SSR/首帧水合错位(0703-C1)。 */
function useMountedMediaHints(): { dark: boolean; reduceMotion: boolean } | null {
  const [hints, setHints] = useState<{ dark: boolean; reduceMotion: boolean } | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const color = window.matchMedia('(prefers-color-scheme: dark)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setHints({ dark: color.matches, reduceMotion: motion.matches });
    sync();
    color.addEventListener('change', sync);
    motion.addEventListener('change', sync);
    return () => {
      color.removeEventListener('change', sync);
      motion.removeEventListener('change', sync);
    };
  }, []);

  return hints;
}

function themeHint(theme: AppTheme, resolved: { dark: boolean } | null): string {
  if (theme !== 'system') return '手动指定明暗';
  if (!resolved) return '跟随系统';
  return `跟随系统,当前为${resolved.dark ? '深色' : '浅色'}`;
}

function motionHint(level: MotionLevel, resolved: { reduceMotion: boolean } | null): string {
  if (level === 'on') return '关闭过渡、入场和循环动画';
  if (level === 'off') return '始终保留完整界面动效';
  if (!resolved) return '跟随系统读取系统辅助功能设置';
  return `跟随系统,当前:${resolved.reduceMotion ? '减少动效' : '完整动效'}`;
}

function densityHint(density: InterfaceDensity): string {
  return density === 'compact' ? '缩短主要列表与卡片间距' : '保留更宽松的浏览间距';
}

/**
 * 「外观」分区卡(V25-UI-SPEC §6.2「通用 / 偏好」):主题 / 动效 / 密度 / 语言。
 * 主题/动效/密度统一 ToggleGroup(0703-C2);写偏好即时生效(乐观更新)。
 */
export function AppearanceCard() {
  const preferences = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const media = useMountedMediaHints();

  return (
    <Card data-testid="settings-appearance-card">
      <CardHeader>
        <CardTitle>外观</CardTitle>
        <CardDescription>主题与动效偏好,仅保存在本机</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {preferences.isPending ? (
          <Skeleton className="h-9 w-full" data-testid="settings-loading" />
        ) : preferences.isError ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-destructive text-sm">偏好读取失败,请重试</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void preferences.refetch()}
              data-testid="settings-preferences-retry"
            >
              重试
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Label>主题</Label>
                <p className="mt-1 text-muted-foreground text-xs" data-testid="settings-theme-hint">
                  {themeHint(preferences.data.theme, media)}
                </p>
              </div>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={preferences.data.theme}
                onValueChange={(value) => {
                  if (!value) return;
                  updatePreferences.mutate({ theme: value as AppTheme });
                }}
                aria-label="主题"
                data-testid="settings-theme-trigger"
                className={SEGMENT_GROUP_CLASS}
              >
                {THEME_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <ToggleGroupItem
                      key={option.value}
                      value={option.value}
                      aria-label={option.label}
                      data-testid={`settings-theme-${option.value}`}
                      className={SEGMENT_ITEM_CLASS}
                    >
                      <Icon />
                      {option.label}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </div>
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Label>动效</Label>
                <p
                  className="mt-1 text-muted-foreground text-xs"
                  data-testid="settings-motion-hint"
                >
                  {motionHint(preferences.data.reducedMotion, media)}
                </p>
              </div>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={preferences.data.reducedMotion}
                onValueChange={(value) => {
                  if (!value) return;
                  updatePreferences.mutate({ reducedMotion: value as MotionLevel });
                }}
                aria-label="动效"
                data-testid="settings-motion-trigger"
                className={SEGMENT_GROUP_CLASS}
              >
                {MOTION_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <ToggleGroupItem
                      key={option.value}
                      value={option.value}
                      aria-label={option.label}
                      data-testid={`settings-motion-${option.value}`}
                      className={SEGMENT_ITEM_CLASS}
                    >
                      <Icon />
                      {option.label}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </div>
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Label>界面密度</Label>
                <p
                  className="mt-1 text-muted-foreground text-xs"
                  data-testid="settings-density-hint"
                >
                  {densityHint(preferences.data.density)}
                </p>
              </div>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={preferences.data.density}
                onValueChange={(value) => {
                  if (!value) return;
                  updatePreferences.mutate({ density: value as InterfaceDensity });
                }}
                aria-label="界面密度"
                data-testid="settings-density-trigger"
                className={SEGMENT_GROUP_CLASS}
              >
                {DENSITY_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <ToggleGroupItem
                      key={option.value}
                      value={option.value}
                      aria-label={option.label}
                      data-testid={`settings-density-${option.value}`}
                      className={SEGMENT_ITEM_CLASS}
                    >
                      <Icon />
                      {option.label}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
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
  );
}
