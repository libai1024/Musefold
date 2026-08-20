// src/App.tsx
// 路由 + 浮层布局骨架 —— 详见 docs/06-ui-design-system.md §6

import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { ProviderDialog } from './features/generation/components/ProviderDialog';
import { OnboardingFlow } from './features/onboarding/OnboardingFlow';
import { EmberHatchOverlay } from './components/layout/EmberHatchOverlay';
import { ImportConfirmDialog } from './features/share/ImportConfirmDialog';
import { GeneratePage } from './pages/GeneratePage';
import { LibraryPage } from './pages/LibraryPage';
import { DesignSchemesPage } from './features/design-schemes/DesignSchemesPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { useAppStore } from './stores/app';
import { useGenerationStore } from './features/generation/store';
import { usePlatform } from './lib/usePlatform';
import { useAiConnectionStore } from './features/settings/ai-connection-store';
import { useAccountStore } from './features/account/store';
import { useSettingsStore } from './features/settings/store';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';

const pages = {
  generate: GeneratePage,
  library: LibraryPage,
  'design-schemes': DesignSchemesPage,
  history: HistoryPage,
  settings: SettingsPage,
} as const;

export default function App() {
  const currentView = useAppStore((s) => s.currentView);
  const theme = useAppStore((s) => s.theme);
  const syncSystemTheme = useAppStore((s) => s.syncSystemTheme);
  const reducedMotion = useAppStore((s) => s.reducedMotion);
  const density = useAppStore((s) => s.density);
  const loadProviders = useGenerationStore((s) => s.loadProviders);
  const loadAiConnections = useAiConnectionStore((s) => s.load);
  const initializeAccount = useAccountStore((s) => s.initialize);
  const providerDialogOpen = useGenerationStore((s) => s.providerDialogOpen);
  const setProviderDialogOpen = useGenerationStore((s) => s.setProviderDialogOpen);
  const editingProvider = useGenerationStore((s) => s.editingProvider);
  const openProviderDialog = useGenerationStore((s) => s.openProviderDialog);
  const setView = useAppStore((s) => s.setView);
  const setSettingsSection = useSettingsStore((s) => s.setSection);
  const requestAccountSetup = useSettingsStore((s) => s.requestAccountSetup);
  const doubaoDeveloperMode = useSettingsStore((s) => s.doubaoDeveloperMode);
  const { name: platformName } = usePlatform();
  const Page = pages[currentView];

  // 主题属性：data-theme 由 tailwind darkMode class 策略读取
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.motion = reducedMotion;
    root.classList.toggle('reduce-motion', reducedMotion === 'on');
  }, [reducedMotion]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  // 跟随系统：监听 prefers-color-scheme 变化
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const handler = () => syncSystemTheme();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [syncSystemTheme]);

  // 平台属性：CSS 通过 [data-platform] 微调 Mica 透明度与兜底底色
  useEffect(() => {
    document.documentElement.dataset.platform = platformName;
  }, [platformName]);

  // 启动加载服务商（标题栏/侧栏状态即时反映）
  useEffect(() => {
    loadProviders().catch(() => {});
    loadAiConnections().catch(() => {});
    initializeAccount().catch(() => {});
  }, [initializeAccount, loadAiConnections, loadProviders]);

  useEffect(() => {
    void api.provider.setWebDeveloperVisible(doubaoDeveloperMode).catch(() => {});
  }, [doubaoDeveloperMode]);

  useEffect(() => {
    let offSetup = () => {};
    let offProvider = () => {};
    try {
      offSetup = api.automation.onSetupRequested((request) => {
        if (request.kind === 'account') {
          requestAccountSetup(request.requestId, request.mode ?? 'login');
          setSettingsSection('account');
          setView('settings');
          return;
        }
        setSettingsSection('providers');
        setView('settings');
        void loadProviders()
          .catch(() => undefined)
          .finally(() => openProviderDialog(null, { draft: request.draft }));
      });
      offProvider = api.automation.onProviderChanged(() => {
        void loadProviders().catch(() => undefined);
      });
    } catch {
      // 纯浏览器预览未提供自动化事件桥时忽略；桌面功能不受影响。
    }
    return () => {
      offSetup();
      offProvider();
    };
  }, [loadProviders, openProviderDialog, requestAccountSetup, setSettingsSection, setView]);

  return (
    <>
      <AppShell>
        <Page />
        <ProviderDialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen} provider={editingProvider} />
      </AppShell>
      <OnboardingFlow />
      <EmberHatchOverlay />
      <ImportConfirmDialog />
    </>
  );
}
