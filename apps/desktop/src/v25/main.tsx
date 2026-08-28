import { SettingsScreen, ThemeSync } from '@musefold/features/settings';
import { DESKTOP_CAPABILITIES, PlatformProvider } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
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

function V25Shell() {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={runtime}>
          <ThemeSync />
          <div className="min-h-dvh bg-background" data-testid="v25-shell">
            <SettingsScreen />
          </div>
        </PlatformProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('v25 shell: #root 不存在');
createRoot(container).render(<V25Shell />);
