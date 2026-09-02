// @vitest-environment jsdom
//
// WindowControls renderer 证据(Win/Linux 自绘控件,ui-parity 01 §3 P1 缺口):
// 非 mac 渲染与点击转发、最大化态订阅/快照时序、精确退订、StrictMode、
// 桥缺失安全降级;mac(enabled=false)恒 null 不订阅。桥形状按 preload
// 线契约结构式伪造。

import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWindowMaximized, WindowControls } from '../window-controls';

// Electron 拖拽层豁免按宿主 globals.css 声明(仓库 app-region 唯一管理口径);
// jsdom CSSOM 不识别 -webkit-app-region,按源契约断言规则仍在。
// (jsdom 全局 URL 不支持 file: scheme,用 node:url 的 URL 解析。)
const globalsCss = readFileSync(new NodeURL('../globals.css', import.meta.url), 'utf8');

type Listener = (maximized: boolean) => void;

function installFakeBridge(options: { snapshot?: boolean | Promise<boolean> } = {}) {
  const listeners = new Set<Listener>();
  const unsubscribe = vi.fn((listener: Listener) => {
    listeners.delete(listener);
  });
  const onMaximizeChange = vi.fn((listener: Listener) => {
    listeners.add(listener);
    return () => unsubscribe(listener);
  });
  const isMaximized = vi.fn(() => options.snapshot ?? false);
  const bridge = {
    minimize: vi.fn(),
    maximizeToggle: vi.fn(),
    close: vi.fn(),
    isMaximized,
    onMaximizeChange,
  };
  Object.defineProperty(window, 'musefoldV25', {
    configurable: true,
    writable: true,
    value: bridge,
  });
  return {
    ...bridge,
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

function renderControls(enabled = true) {
  return render(<WindowControls enabled={enabled} />);
}

describe('WindowControls 渲染与点击转发', () => {
  afterEach(() => {
    cleanup();
    removeBridge();
    vi.restoreAllMocks();
  });

  it('非 mac(enabled=true):渲染三键,拖拽层豁免规则在位,不占用 invoke 数据通道', () => {
    const fake = installFakeBridge();
    const { getByTestId } = renderControls();

    const strip = getByTestId('window-controls');
    expect(strip.tagName).toBe('DIV');
    // Electron 拖拽层豁免:控件与其按钮必须整层 no-drag(真实鼠标才点得到)。
    expect(globalsCss).toContain("[data-testid='window-controls']");
    expect(globalsCss).toContain('-webkit-app-region: no-drag');

    expect(getByTestId('window-control-minimize').getAttribute('aria-label')).toBe('最小化');
    expect(getByTestId('window-control-maximize').getAttribute('aria-label')).toBe('最大化');
    expect(getByTestId('window-control-close').getAttribute('aria-label')).toBe('关闭');
    expect(fake.isMaximized).toHaveBeenCalledTimes(1);
  });

  it('点击三键分别转发 minimize / maximizeToggle / close', () => {
    const fake = installFakeBridge();
    const { getByTestId } = renderControls();

    fireEvent.click(getByTestId('window-control-minimize'));
    expect(fake.minimize).toHaveBeenCalledTimes(1);
    fireEvent.click(getByTestId('window-control-maximize'));
    expect(fake.maximizeToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(getByTestId('window-control-close'));
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('最大化事件往返:图标语义在「最大化/还原」间切换', () => {
    const fake = installFakeBridge({ snapshot: false });
    const { getByTestId } = renderControls();
    expect(getByTestId('window-control-maximize').getAttribute('aria-label')).toBe('最大化');

    act(() => fake.emit(true));
    expect(getByTestId('window-control-maximize').getAttribute('aria-label')).toBe('还原');

    act(() => fake.emit(false));
    expect(getByTestId('window-control-maximize').getAttribute('aria-label')).toBe('最大化');
  });

  it('卸载精确退订恰好一次,残留事件为空操作', () => {
    const fake = installFakeBridge();
    const { unmount } = renderControls();

    unmount();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount()).toBe(0);
    act(() => fake.emit(true));
  });

  it('mac(enabled=false):恒不渲染,不订阅不查询', () => {
    const fake = installFakeBridge();
    const { container, getByTestId } = renderControls(false);

    expect(container.querySelector('[data-testid="window-controls"]')).toBeNull();
    expect(() => getByTestId('window-control-minimize')).toThrow();
    expect(fake.onMaximizeChange).not.toHaveBeenCalled();
    expect(fake.isMaximized).not.toHaveBeenCalled();
  });

  it('桥缺失(preload 未注入):控件仍渲染,点击与订阅安全 no-op', () => {
    removeBridge();
    const { getByTestId } = renderControls();

    expect(() => fireEvent.click(getByTestId('window-control-minimize'))).not.toThrow();
    expect(getByTestId('window-control-maximize').getAttribute('aria-label')).toBe('最大化');
  });
});

describe('useWindowMaximized 时序约束', () => {
  afterEach(() => {
    cleanup();
    removeBridge();
    vi.restoreAllMocks();
  });

  it('初始快照:先订阅后查询,挂载后采用 isMaximized() 结果', async () => {
    const fake = installFakeBridge({ snapshot: Promise.resolve(true) });
    const { result } = renderHook(() => useWindowMaximized(true));

    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(fake.isMaximized).toHaveBeenCalledTimes(1);

    const subscribeOrder = fake.onMaximizeChange.mock.invocationCallOrder[0];
    const queryOrder = fake.isMaximized.mock.invocationCallOrder[0];
    expect(subscribeOrder).toBeLessThan(queryOrder);
  });

  it('事件先到达时,迟到的初始快照不得覆盖更新后的状态', async () => {
    let resolveSnapshot: ((value: boolean) => void) | undefined;
    const snapshot = new Promise<boolean>((resolve) => {
      resolveSnapshot = resolve;
    });
    const fake = installFakeBridge({ snapshot });
    const { result } = renderHook(() => useWindowMaximized(true));

    act(() => fake.emit(false));
    expect(result.current).toBe(false);

    await act(async () => resolveSnapshot?.(true));
    expect(result.current).toBe(false);
  });

  it('StrictMode:双跑 effect 后旧效应快照作废,退订恰好一次', async () => {
    let resolveStaleSnapshot: ((value: boolean) => void) | undefined;
    const staleSnapshot = new Promise<boolean>((resolve) => {
      resolveStaleSnapshot = resolve;
    });
    const fake = installFakeBridge();
    fake.isMaximized.mockImplementationOnce(() => staleSnapshot).mockResolvedValue(true);

    const { result } = renderHook(() => useWindowMaximized(true), { wrapper: StrictMode });

    expect(fake.onMaximizeChange).toHaveBeenCalledTimes(2);
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount()).toBe(1);

    await waitFor(() => expect(result.current).toBe(true));

    await act(async () => resolveStaleSnapshot?.(false));
    expect(result.current).toBe(true);
  });

  it('初始查询拒绝:不向渲染层抛错,保持事件驱动', async () => {
    const fake = installFakeBridge({ snapshot: Promise.reject(new Error('ipc down')) });
    const { result } = renderHook(() => useWindowMaximized(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(false);

    act(() => fake.emit(true));
    expect(result.current).toBe(true);
  });

  it('enabled=false(mac):不订阅不查询,恒 false', async () => {
    const fake = installFakeBridge({ snapshot: true });
    const { result } = renderHook(() => useWindowMaximized(false));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
    expect(fake.onMaximizeChange).not.toHaveBeenCalled();
    expect(fake.isMaximized).not.toHaveBeenCalled();
  });
});
