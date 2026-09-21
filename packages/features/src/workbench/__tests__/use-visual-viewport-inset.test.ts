/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVisualViewportInset, visualViewportInsetPx } from '../use-visual-viewport-inset';

const MOBILE_QUERY = '(max-width: 767px)';

class FakeVisualViewport extends EventTarget {
  height: number;
  offsetTop: number;
  constructor(height: number, offsetTop = 0) {
    super();
    this.height = height;
    this.offsetTop = offsetTop;
  }
}

function stubMatchMedia(mobile: boolean) {
  let matches = mobile;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      if (query === MOBILE_QUERY) return matches;
      if (query.includes('min-width: 768px')) return !matches;
      return false;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  return {
    setMobile(next: boolean) {
      matches = next;
      act(() => {
        for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
      });
    },
  };
}

function installVisualViewport(height: number, offsetTop = 0): FakeVisualViewport {
  const viewport = new FakeVisualViewport(height, offsetTop);
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: viewport,
  });
  return viewport;
}

const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'visualViewport');
  if (originalInnerHeight) Object.defineProperty(window, 'innerHeight', originalInnerHeight);
});

describe('visualViewportInsetPx', () => {
  it('无 visualViewport 为 0;键盘抬起为 innerHeight - height - offsetTop', () => {
    expect(visualViewportInsetPx(800, null)).toBe(0);
    expect(visualViewportInsetPx(800, undefined)).toBe(0);
    expect(visualViewportInsetPx(800, { height: 500, offsetTop: 0 })).toBe(300);
    expect(visualViewportInsetPx(800, { height: 480, offsetTop: 40 })).toBe(280);
    expect(visualViewportInsetPx(800, { height: 900, offsetTop: 0 })).toBe(0);
  });
});

describe('useVisualViewportInset', () => {
  it('jsdom 无 visualViewport 时为 0', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useVisualViewportInset());
    expect(result.current).toBe(0);
  });

  it('<md 且 visualViewport 变矮时返回 inset;md+ 恒 0', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    installVisualViewport(520);

    stubMatchMedia(true);
    const mobile = renderHook(() => useVisualViewportInset());
    expect(mobile.result.current).toBe(280);
    mobile.unmount();

    stubMatchMedia(false);
    const desktop = renderHook(() => useVisualViewportInset());
    expect(desktop.result.current).toBe(0);
  });

  it('matchMedia 切到 md+ 后回落 0', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    installVisualViewport(500, 20);
    const media = stubMatchMedia(true);

    const { result } = renderHook(() => useVisualViewportInset());
    expect(result.current).toBe(280);

    media.setMobile(false);
    expect(result.current).toBe(0);
  });

  it('visualViewport resize / scroll 后重算 inset', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const viewport = installVisualViewport(600);
    stubMatchMedia(true);

    const { result } = renderHook(() => useVisualViewportInset());
    expect(result.current).toBe(200);

    act(() => {
      viewport.height = 400;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(400);

    act(() => {
      viewport.offsetTop = 50;
      viewport.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe(350);
  });

  it('卸载时移除 visualViewport 监听', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const viewport = installVisualViewport(400);
    stubMatchMedia(true);
    const removeSpy = vi.spyOn(viewport, 'removeEventListener');

    const { unmount } = renderHook(() => useVisualViewportInset());
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
