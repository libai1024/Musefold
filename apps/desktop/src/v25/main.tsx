import { PromptLibraryScreen } from '@musefold/features/prompts';
import { SettingsScreen, ThemeSync } from '@musefold/features/settings';
import { AppShell, SHELL_NAV_ITEMS, type ShellNavItem } from '@musefold/features/shell';
import { DESKTOP_CAPABILITIES, PlatformProvider } from '@musefold/platform';
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
  (['prompts', 'settings'] as ViewId[]).includes(item.id),
);

function DesktopView({ view }: { view: ViewId }) {
  if (view === 'prompts') return <PromptLibraryScreen />;
  return <SettingsScreen />;
}

function V25Shell() {
  const [view, setView] = useState<ViewId>('prompts');

  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={runtime}>
          <ThemeSync />
          <div className="min-h-dvh bg-background" data-testid="v25-shell">
            <AppShell activeId={view} items={DESKTOP_NAV_ITEMS} onNavigate={setView}>
              <DesktopView view={view} />
            </AppShell>
          </div>
        </PlatformProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('v25 shell: #root 不存在');
createRoot(container).render(<V25Shell />);
