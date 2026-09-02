// @vitest-environment jsdom
//
// U01-fullscreen-inset renderer 证据:初始查询、事件更新、StrictMode cleanup、
// 桥缺失 no-op、非 macOS 不订阅。桥形状按 preload 线契约结构式伪造。

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRAND_INSET_MAC,
  BRAND_INSET_MAC_FULLSCREEN,
  resolveBrandInset,
  useWindowFullscreen,
} from '../use-window-fullscreen';

type Listener = (fullscreen: boolean) => void;

function installFakeBridge(options: { snapshot?: boolean | Promise<boolean> } = {}) {
  const listeners = new Set<Listener>();
  const unsubscribe = vi.fn((listener: Listener) => {
    listeners.delete(listener);
  });
  const onFullscreenChange = vi.fn((listener: Listener) => {
    listeners.add(listener);
    return () => unsubscribe(listener);
  });
  const isFullscreen = vi.fn(() => options.snapshot ?? false);
  Object.defineProperty(window, 'musefoldV25', {
    configurable: true,
    writable: true,
    value: { onFullscreenChange, isFullscreen },
  });
  return {
    onFullscreenChange,
    isFullscreen,
    unsubscribe,
    listenerCount: () => listeners.size,
    emit(next: boolean) {
      for (const listener of [...listeners]) listener(next);
    },
  };
}

function removeBridge() {
  delete window.musefoldV25;
}

describe('useWindowFullscreen(U01-fullscreen-inset)', () => {
  afterEach(() => {
    cleanup();
    removeBridge();
    vi.restoreAllMocks();
  });

  it('初始快照:先订阅后查询,挂载后采用 isFullscreen() 结果', async () => {
    const fake = installFakeBridge({ snapshot: Promise.resolve(true) });
    const { result } = renderHook(() => useWindowFullscreen(true));

    // 同步首渲染仍按非全屏几何,快照到达后收敛。
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(fake.isFullscreen).toHaveBeenCalledTimes(1);

    // 顺序约束:订阅必须早于初始查询(避免启动/切换窗口期丢事件)。
    const subscribeOrder = fake.onFullscreenChange.mock.invocationCallOrder[0];
    const queryOrder = fake.isFullscreen.mock.invocationCallOrder[0];
    expect(subscribeOrder).toBeLessThan(queryOrder);
  });

  it('事件先到达时,迟到的初始快照不得覆盖更新后的状态', async () => {
    let resolveSnapshot: ((value: boolean) => void) | undefined;
    const snapshot = new Promise<boolean>((resolve) => {
      resolveSnapshot = resolve;
    });
    const fake = installFakeBridge({ snapshot });
    const { result } = renderHook(() => useWindowFullscreen(true));

    act(() => fake.emit(true));
    expect(result.current).toBe(true);

    await act(async () => resolveSnapshot?.(false));
    expect(result.current).toBe(true);
  });

  it('事件更新:enter/leave-full-screen 推送驱动状态往返', () => {
    const fake = installFakeBridge({ snapshot: false });
    const { result } = renderHook(() => useWindowFullscreen(true));

    act(() => fake.emit(true));
    expect(result.current).toBe(true);
    act(() => fake.emit(false));
    expect(result.current).toBe(false);
  });

  it('cleanup 精确退订:卸载后 unsubscribe 恰好一次,残留事件为空操作', () => {
    const fake = installFakeBridge();
    const { result, unmount } = renderHook(() => useWindowFullscreen(true));
    act(() => fake.emit(true));
    expect(result.current).toBe(true);

    unmount();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount()).toBe(0);
    // 卸载后再发事件:无监听者,不抛错不告警。
    act(() => fake.emit(false));
  });

  it('StrictMode:双跑 effect 后旧效应快照作废,状态跟随实时订阅', async () => {
    let resolveStaleSnapshot: ((value: boolean) => void) | undefined;
    const staleSnapshot = new Promise<boolean>((resolve) => {
      resolveStaleSnapshot = resolve;
    });
    const fake = installFakeBridge();
    fake.isFullscreen.mockImplementationOnce(() => staleSnapshot).mockResolvedValue(true);

    const { result } = renderHook(() => useWindowFullscreen(true), { wrapper: StrictMode });

    // 订阅两次(首次已被 cleanup),退订恰好一次,查询各跑一次。
    expect(fake.onFullscreenChange).toHaveBeenCalledTimes(2);
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount()).toBe(1);

    // 活效应的快照收敛为 true。
    await waitFor(() => expect(result.current).toBe(true));

    // 已作废效应的迟到快照不得覆盖现态。
    await act(async () => resolveStaleSnapshot?.(false));
    expect(result.current).toBe(true);
  });

  it('桥缺失(window.musefoldV25 未注入):安全 no-op,恒非全屏', () => {
    removeBridge();
    const { result } = renderHook(() => useWindowFullscreen(true));
    expect(result.current).toBe(false);
  });

  it('桥仅有 invoke(窗口方法未注入):安全 no-op,恒非全屏', () => {
    Object.defineProperty(window, 'musefoldV25', {
      configurable: true,
      writable: true,
      value: { invoke: vi.fn() },
    });
    const { result } = renderHook(() => useWindowFullscreen(true));
    expect(result.current).toBe(false);
  });

  it('初始查询拒绝:不向渲染层抛错,保持事件驱动', async () => {
    const fake = installFakeBridge({ snapshot: Promise.reject(new Error('ipc down')) });
    const { result } = renderHook(() => useWindowFullscreen(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(false);

    act(() => fake.emit(true));
    expect(result.current).toBe(true);
  });

  it('enabled=false(非 macOS):不订阅不查询,恒 false', async () => {
    const fake = installFakeBridge({ snapshot: true });
    const { result } = renderHook(() => useWindowFullscreen(false));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
    expect(fake.onFullscreenChange).not.toHaveBeenCalled();
    expect(fake.isFullscreen).not.toHaveBeenCalled();
  });
});

describe('resolveBrandInset 几何口径(ui-parity 01 §4-2)', () => {
  it('非 macOS 恒 0px(与全屏态无关)', () => {
    expect(resolveBrandInset(false, false)).toBe(0);
    expect(resolveBrandInset(false, true)).toBe(0);
  });

  it('macOS 非全屏 78px,原生全屏回落 12px,不套旧版 86px', () => {
    expect(resolveBrandInset(true, false)).toBe(BRAND_INSET_MAC);
    expect(resolveBrandInset(true, false)).toBe(78);
    expect(resolveBrandInset(true, true)).toBe(BRAND_INSET_MAC_FULLSCREEN);
    expect(resolveBrandInset(true, true)).toBe(12);
  });
});
