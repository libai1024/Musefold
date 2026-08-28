import type { AppLanguage, AppTheme } from '@musefold/contracts';
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
import { Switch } from '@musefold/ui/components/switch';
import { AccountPanel } from '../account/AccountPanel';
import { AiConnectionsPanel } from '../account/AiConnectionsPanel';
import { CloudSyncPanel } from '../account/CloudSyncPanel';
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

/**
 * 设置屏幕 —— v2.5 双宿主打样域。
 * 同一份组件在 Next.js 壳与 Electron 新渲染壳渲染,数据经 MusefoldGateway。
 */
export function SettingsScreen() {
  const capabilities = useCapabilities();
  const preferences = usePreferences();
  const updatePreferences = useUpdatePreferences();

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
                  <Label htmlFor="settings-reduced-motion">减弱动效</Label>
                  <p className="mt-1 text-muted-foreground text-xs">降低界面过渡与动画强度</p>
                </div>
                <Switch
                  id="settings-reduced-motion"
                  data-testid="settings-reduced-motion"
                  checked={preferences.data.reducedMotion}
                  onCheckedChange={(checked) =>
                    updatePreferences.mutate({ reducedMotion: checked })
                  }
                />
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

      <AccountPanel />

      {capabilities.hasCloudSyncControls && <CloudSyncPanel />}

      {capabilities.hasLocalAiProviders && <AiConnectionsPanel />}
    </div>
  );
}
