import { AccountFooter } from '@musefold/features/account';
import { HistoryScreen } from '@musefold/features/history';
import { PromptLibraryScreen } from '@musefold/features/prompts';
import { SettingsScreen, ThemeSync } from '@musefold/features/settings';
import { AppShell, SHELL_NAV_ITEMS, type ShellNavItem } from '@musefold/features/shell';
import {
  NewSessionAction,
  SessionListPanel,
  useActiveSession,
  WorkbenchScreen,
} from '@musefold/features/workbench';
import { DESKTOP_CAPABILITIES, PlatformProvider } from '@musefold/platform';
import { Toaster } from '@musefold/ui/components/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createDesktopGateway } from './desktop-gateway';
import './globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

const runtime = {
  gateway: createDesktopGateway(),
  capabilities: DESKTOP_CAPABILITIES,
};

type ViewId = ShellNavItem['id'];

/** 迁移期桌面导航目录:只放已迁入 v2.5 的域,其余仍在旧壳。 */
const DESKTOP_NAV_ITEMS = SHELL_NAV_ITEMS.filter((item) =>
  (['workbench', 'prompts', 'history', 'settings'] as ViewId[]).includes(item.id),
);

function DesktopView({ view, onOpenView }: { view: ViewId; onOpenView: (id: ViewId) => void }) {
  const setActiveSessionId = useActiveSession((s) => s.setActiveSessionId);
  if (view === 'workbench') {
    return (
      <div className="h-[calc(100dvh-7rem)] md:h-dvh">
        <WorkbenchScreen />
      </div>
    );
  }
  if (view === 'prompts') return <PromptLibraryScreen />;
  if (view === 'history') {
    return (
      <div className="h-[calc(100dvh-7rem)] md:h-dvh">
        <HistoryScreen
          onOpenSession={(sessionId) => {
            setActiveSessionId(sessionId);
            onOpenView('workbench');
          }}
        />
      </div>
    );
  }
  return <SettingsScreen />;
}

// macOS hiddenInset 交通灯占位(window.ts trafficLightPosition x=14 + 三灯宽度)。
const IS_MAC = navigator.platform.toUpperCase().includes('MAC');

function V25Shell() {
  const [view, setView] = useState<ViewId>('workbench');
  const openWorkbench = () => setView('workbench');

  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={runtime}>
          <ThemeSync />
          <div className="min-h-dvh bg-background" data-testid="v25-shell">
            <AppShell
              activeId={view}
              items={DESKTOP_NAV_ITEMS}
              onNavigate={setView}
              action={<NewSessionAction onOpen={openWorkbench} />}
              sessions={<SessionListPanel onOpen={openWorkbench} />}
              footer={<AccountFooter onOpenAccount={() => setView('settings')} />}
              brandInset={IS_MAC ? 78 : 0}
            >
              <DesktopView view={view} onOpenView={setView} />
            </AppShell>
          </div>
          <Toaster position="bottom-right" />
        </PlatformProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('v25 shell: #root 不存在');
createRoot(container).render(<V25Shell />);
