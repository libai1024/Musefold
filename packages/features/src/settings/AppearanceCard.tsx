import type { AppLanguage, AppTheme, MotionLevel } from '@musefold/contracts';
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

/**
 * 「外观」分区卡(V25-UI-SPEC §6.2「通用 / 偏好」):主题 / 动效 / 语言,写偏好即时生效(乐观更新)。
 * 行式控件:左标签 + 描述,右 Select(§6.3)。
 */
export function AppearanceCard() {
  const preferences = usePreferences();
  const updatePreferences = useUpdatePreferences();

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
                    <SelectItem key={level} value={level} data-testid={`settings-motion-${level}`}>
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
  );
}
