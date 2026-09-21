import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { PlatformCapabilities } from './capabilities';
import type { MusefoldGateway } from './gateway';

export interface PlatformRuntime {
  gateway: MusefoldGateway;
  capabilities: PlatformCapabilities;
}

/** Web 构建标识(07-07 P3);桌面走 system.getAppInfo,通常不注入。 */
export interface BuildInfo {
  version?: string;
  commit?: string;
  builtAt?: string;
}

interface PlatformContextValue {
  runtime: PlatformRuntime;
  buildInfo?: BuildInfo;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

export function PlatformProvider({
  runtime,
  buildInfo,
  children,
}: {
  runtime: PlatformRuntime;
  buildInfo?: BuildInfo;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ runtime, buildInfo }), [runtime, buildInfo]);
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformRuntime {
  const ctx = useContext(PlatformContext);
  if (!ctx) {
    throw new Error('usePlatform 必须在 <PlatformProvider> 内使用(宿主未注入 runtime)');
  }
  return ctx.runtime;
}

export function useGateway(): MusefoldGateway {
  return usePlatform().gateway;
}

export function useCapabilities(): PlatformCapabilities {
  return usePlatform().capabilities;
}

export function useBuildInfo(): BuildInfo | undefined {
  const ctx = useContext(PlatformContext);
  if (!ctx) {
    throw new Error('usePlatform 必须在 <PlatformProvider> 内使用(宿主未注入 runtime)');
  }
  return ctx.buildInfo;
}
