import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlatformCapabilities } from '../capabilities';
import type { MusefoldGateway } from '../gateway';
import {
  PlatformProvider,
  useBuildInfo,
  useCapabilities,
  useGateway,
  usePlatform,
} from '../context';

const gateway = Object.freeze({}) as MusefoldGateway;
const capabilities: PlatformCapabilities = {
  host: 'web',
  canRevealLocalFile: false,
  hasCloudSyncControls: false,
  hasLocalAutomation: false,
  hasCloudMcpControls: true,
  hasWindowChrome: false,
  hasLocalAiProviders: false,
  hasAgentConnections: false,
  hasDesignSchemes: false,
  hasDoubaoWebLogin: false,
  hasLocalDataManagement: false,
  maxGenerationCount: 1,
};

describe('platform context', () => {
  it('exposes the injected runtime through all public hooks', () => {
    let observed:
      | {
          runtime: ReturnType<typeof usePlatform>;
          gateway: ReturnType<typeof useGateway>;
          capabilities: ReturnType<typeof useCapabilities>;
          buildInfo: ReturnType<typeof useBuildInfo>;
        }
      | undefined;

    function Probe() {
      observed = {
        runtime: usePlatform(),
        gateway: useGateway(),
        capabilities: useCapabilities(),
        buildInfo: useBuildInfo(),
      };
      return null;
    }

    renderToString(
      <PlatformProvider runtime={{ gateway, capabilities }}>
        <Probe />
      </PlatformProvider>,
    );

    expect(observed?.runtime).toEqual({ gateway, capabilities });
    expect(observed?.gateway).toBe(gateway);
    expect(observed?.capabilities).toBe(capabilities);
    expect(observed?.buildInfo).toBeUndefined();
  });

  it('exposes optional buildInfo through useBuildInfo', () => {
    let observed: ReturnType<typeof useBuildInfo>;
    const buildInfo = { version: '2.5.0', commit: 'abcdef1', builtAt: '2026-09-06' };

    function Probe() {
      observed = useBuildInfo();
      return null;
    }

    renderToString(
      <PlatformProvider runtime={{ gateway, capabilities }} buildInfo={buildInfo}>
        <Probe />
      </PlatformProvider>,
    );

    expect(observed).toEqual(buildInfo);
  });

  it('keeps optional aiProviders, sync, designSchemes, and doubao explicitly absent when the gateway omits them', () => {
    let observedGateway: ReturnType<typeof useGateway> | undefined;

    function Probe() {
      observedGateway = useGateway();
      return null;
    }

    renderToString(
      <PlatformProvider runtime={{ gateway, capabilities }}>
        <Probe />
      </PlatformProvider>,
    );

    expect(observedGateway).toBe(gateway);
    expect(observedGateway?.aiProviders).toBeUndefined();
    expect(observedGateway?.sync).toBeUndefined();
    expect(observedGateway?.designSchemes).toBeUndefined();
    expect(observedGateway?.doubao).toBeUndefined();
    expect(Object.hasOwn(gateway, 'aiProviders')).toBe(false);
    expect(Object.hasOwn(gateway, 'sync')).toBe(false);
    expect(Object.hasOwn(gateway, 'designSchemes')).toBe(false);
    expect(Object.hasOwn(gateway, 'doubao')).toBe(false);
  });

  it.each([
    ['usePlatform', () => usePlatform()],
    ['useGateway', () => useGateway()],
    ['useCapabilities', () => useCapabilities()],
    ['useBuildInfo', () => useBuildInfo()],
  ])('throws when %s is used outside PlatformProvider', (_name, readHook) => {
    function Probe() {
      readHook();
      return null;
    }

    expect(() => renderToString(<Probe />)).toThrow(
      'usePlatform 必须在 <PlatformProvider> 内使用(宿主未注入 runtime)',
    );
  });
});
