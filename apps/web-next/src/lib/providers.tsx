'use client';

import { DensitySync, MotionSync, ThemeSync } from '@musefold/features/settings';
import { type BuildInfo, PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { createWebGateway } from './web-gateway';

// 默认同源(''):请求走相对路径,dev 由 next.config rewrites 反代,生产由部署层路由。
// 分域部署时以 NEXT_PUBLIC_API_BASE_URL 覆盖(需 API 侧配套 CORS,当前刻意未开)。
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';

function compactBuildInfo(info?: BuildInfo): BuildInfo | undefined {
  if (!info) return undefined;
  const version = info.version || undefined;
  const commit = info.commit || undefined;
  const builtAt = info.builtAt || undefined;
  if (!version && !commit && !builtAt) return undefined;
  return { version, commit, builtAt };
}

export function Providers({ children, buildInfo }: { children: ReactNode; buildInfo?: BuildInfo }) {
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
      <PlatformProvider runtime={runtime} buildInfo={compactBuildInfo(buildInfo)}>
        <ThemeSync />
        <MotionSync />
        <DensitySync />
        {children}
      </PlatformProvider>
    </QueryClientProvider>
  );
}
