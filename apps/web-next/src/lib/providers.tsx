'use client';

import { ThemeSync } from '@musefold/features/settings';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { createWebGateway } from './web-gateway';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8787';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  const [runtime] = useState(() => ({
    gateway: createWebGateway(API_BASE_URL),
    capabilities: WEB_CAPABILITIES,
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <PlatformProvider runtime={runtime}>
        <ThemeSync />
        {children}
      </PlatformProvider>
    </QueryClientProvider>
  );
}
