// v2.5 桌面壳宿主:壳几何、导航目录、视图路由与域集成接缝。
// 从 main.tsx 抽出以便单测;main.tsx 只留 createRoot 副作用。

import { AccountFooter, MobileQuotaReadout } from '@musefold/features/account';
import { SchemesScreen, useDesignSchemesIntegration } from '@musefold/features/design-schemes';
import { HistoryScreen } from '@musefold/features/history';
import { PromptLibraryScreen } from '@musefold/features/prompts';
import { MotionSync, SettingsScreen, ThemeSync } from '@musefold/features/settings';
import {
  AppShell,
  getShellNavItems,
  ShellErrorBoundary,
  type ShellNavItem,
  useScreenIntent,
} from '@musefold/features/shell';
import {
  NewSessionAction,
  SessionListPanel,
  useActiveSession,
  WorkbenchScreen,
} from '@musefold/features/workbench';
import { DESKTOP_CAPABILITIES, PlatformProvider } from '@musefold/platform';
import { Toaster } from '@musefold/ui/components/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { createDesktopGateway, resolveDesktopDesignSchemeAssetUrl } from './desktop-gateway';
import { useDesignSchemeComposerHandlers, useImportDesignScheme } from './design-scheme-actions';
import { resolveBrandInset, useWindowFullscreen } from './use-window-fullscreen';
import { WindowControls } from './window-controls';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

const runtime = {
  gateway: createDesktopGateway(),
  capabilities: DESKTOP_CAPABILITIES,
};

export type DesktopViewId = ShellNavItem['id'];

/** 桌面导航目录 = capability 驱动目录(getShellNavItems 单一事实源,能力关闭即无入口)。 */
export const DESKTOP_NAV_ITEMS = getShellNavItems(DESKTOP_CAPABILITIES);

export interface DesktopViewProps {
  view: DesktopViewId;
  onOpenView: (id: DesktopViewId) => void;
}

/**
 * 设计方案视图:详情深链(scheme-detail intent,与 prompts/history trash 同机制)——
 * useState 初值只「读」intent(StrictMode 双跑安全),mount 后 effect 清掉一次性意图;
 * 深链只可能从工作台视图发出,切屏本身保证重挂载,无需额外 nonce。
 * 动作 = features 集成层(试运行/使用/修改/创建 → 意图 + 切工作台)+ 宿主导入接缝。
 */
function DesignSchemesView({ onOpenView }: { onOpenView: (id: DesktopViewId) => void }) {
  const integration = useDesignSchemesIntegration({
    onOpenWorkbench: useCallback(() => onOpenView('workbench'), [onOpenView]),
  });
  const importScheme = useImportDesignScheme();
  const consumeIntent = useScreenIntent((s) => s.consume);
  const [initialDetailId] = useState(() => {
    const intent = useScreenIntent.getState().intent;
    return intent?.kind === 'scheme-detail' ? intent.schemeId : undefined;
  });
  useEffect(() => {
    consumeIntent('scheme-detail');
  }, [consumeIntent]);
  return (
    <div className="h-[calc(100dvh-7rem)] md:h-full">
      <SchemesScreen
        initialDetailId={initialDetailId}
        actions={{ ...integration, onImportScheme: importScheme }}
        resolveAssetUrl={resolveDesktopDesignSchemeAssetUrl}
      />
    </div>
  );
}

export function DesktopView({ view, onOpenView }: DesktopViewProps) {
  const setActiveSessionId = useActiveSession((s) => s.setActiveSessionId);
  /**
   * 方案域集成 prop(§8A):导航缝(onOpenDesignSchemes)+ 运行缝(onRun / onCancelRun,
   * 主进程权威 prepareRun → run → cancel,text-only)。Agent 创建/修改缝(onCreate / onModify)
   * 主进程仍 fail-closed,故缺省——Composer 对应入口禁用并解释,绝不回落普通生成伪造方案运行。
   */
  const openDesignSchemes = useCallback(
    (detailId?: string) => {
      if (detailId) {
        useScreenIntent.getState().setIntent({ kind: 'scheme-detail', schemeId: detailId });
      }
      onOpenView('design-schemes');
    },
    [onOpenView],
  );
  const schemeComposerHandlers = useDesignSchemeComposerHandlers();
  if (view === 'workbench') {
    return (
      <div className="h-[calc(100dvh-7rem)] md:h-full">
        <WorkbenchScreen
          onOpenSettings={() => onOpenView('settings')}
          onOpenPrompts={() => onOpenView('prompts')}
          designSchemes={{ ...schemeComposerHandlers, onOpenDesignSchemes: openDesignSchemes }}
        />
      </div>
    );
  }
  if (view === 'prompts') {
    return <PromptLibraryScreen onOpenWorkbench={() => onOpenView('workbench')} />;
  }
  if (view === 'design-schemes') {
    return <DesignSchemesView onOpenView={onOpenView} />;
  }
  if (view === 'history') {
    return (
      <div className="h-[calc(100dvh-7rem)] md:h-full">
        <HistoryScreen
          onOpenSession={(sessionId) => {
            setActiveSessionId(sessionId);
            onOpenView('workbench');
          }}
          onOpenPrompts={() => onOpenView('prompts')}
        />
      </div>
    );
  }
  return <SettingsScreen onOpenScreen={onOpenView} />;
}

// macOS hiddenInset 交通灯占位(window.ts trafficLightPosition x=14 + 三灯宽度)。
const IS_MAC = navigator.platform.toUpperCase().includes('MAC');

/**
 * 壳宿主:brandInset 由全屏状态驱动(resolveBrandInset 单一几何口径),
 * 状态挂在 StrictMode 边界内的宿主组件上,dev 双跑 effect 由 hook 自身消化。
 */
export function DesktopShellHost() {
  const [view, setView] = useState<DesktopViewId>('workbench');
  const isFullscreen = useWindowFullscreen(IS_MAC);
  const openWorkbench = () => setView('workbench');

  return (
    <ShellErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={runtime}>
          <ThemeSync />
          <MotionSync />
          <div className="min-h-dvh bg-background" data-testid="v25-shell">
            <AppShell
              activeId={view}
              items={DESKTOP_NAV_ITEMS}
              onNavigate={setView}
              action={<NewSessionAction onOpen={openWorkbench} />}
              sessions={<SessionListPanel onOpen={openWorkbench} />}
              footer={<AccountFooter onOpenSettings={() => setView('settings')} />}
              mobileExtra={<MobileQuotaReadout />}
              brandInset={resolveBrandInset(IS_MAC, isFullscreen)}
            >
              <DesktopView view={view} onOpenView={setView} />
            </AppShell>
            {/* Win/Linux 右上角自绘窗口控件(mac 保留原生交通灯,恒 null)。 */}
            <WindowControls enabled={!IS_MAC} />
          </div>
          <Toaster />
        </PlatformProvider>
      </QueryClientProvider>
    </ShellErrorBoundary>
  );
}
