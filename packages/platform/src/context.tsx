import { createContext, type ReactNode, useContext } from 'react';
import type { PlatformCapabilities } from './capabilities';
import type { MusefoldGateway } from './gateway';

export interface PlatformRuntime {
  gateway: MusefoldGateway;
  capabilities: PlatformCapabilities;
}

const PlatformContext = createContext<PlatformRuntime | null>(null);

export function PlatformProvider({
  runtime,
  children,
}: {
  runtime: PlatformRuntime;
  children: ReactNode;
}) {
  return <PlatformContext.Provider value={runtime}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformRuntime {
  const runtime = useContext(PlatformContext);
  if (!runtime) {
    throw new Error('usePlatform 必须在 <PlatformProvider> 内使用(宿主未注入 runtime)');
  }
  return runtime;
}

export function useGateway(): MusefoldGateway {
  return usePlatform().gateway;
}

export function useCapabilities(): PlatformCapabilities {
  return usePlatform().capabilities;
}
