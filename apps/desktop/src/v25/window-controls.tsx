// v2.5 桌面壳:Windows/Linux 自绘窗口控件接线(ui-parity 01 §3 WindowControls)。
//
// 窗口动作是宿主特权信号,不进 contracts / platform data gateway / musefold:invoke
// 方法表;渲染层直接读 preload 暴露的 window.musefoldV25 窗口方法(与
// use-window-fullscreen.ts 同一通道纪律)。macOS 保留原生交通灯,本组件恒 null。
// 纯 UI 在 features/shell/WindowControls;这里只接最大化态与三钮回调。

import { WindowControls as WindowControlsUi } from '@musefold/features/shell';
import { useEffect, useState } from 'react';

type MaximizeListener = (maximized: boolean) => void;

/**
 * preload 窗口桥的最小结构式视图。容忍同步布尔或 Promise 快照、以及未返回
 * unsubscribe 的订阅实现(浏览器与单测环境亦然)。
 */
interface WindowMaximizeBridge {
  isMaximized?(): Promise<boolean> | boolean;
  onMaximizeChange?(listener: MaximizeListener): undefined | (() => void);
}

function getMaximizeBridge(): WindowMaximizeBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.musefoldV25 as WindowMaximizeBridge | undefined;
}

/**
 * 窗口最大化状态(自绘控件在「最大化/还原」间切换图标)。
 *
 * 顺序约束:先订阅 onMaximizeChange 再查询 isMaximized() —— 启动时窗口可能已
 * 处于最大化(不会再有事件)。查询快照只在查询启动后尚未收到事件时应用;
 * 事件一旦到达就成为更新后的权威状态,避免独立 IPC 流的迟到快照覆盖新事件。
 */
export function useWindowMaximized(enabled: boolean): boolean {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const bridge = getMaximizeBridge();
    // 桥缺失:安全 no-op,保持非最大化基线;仅缺一项方法时使用另一项可用能力。
    if (!bridge || (!bridge.onMaximizeChange && !bridge.isMaximized)) return;

    // StrictMode/卸载竞态:cleanup 后迟到的快照与残留事件一律作废。
    let active = true;
    let eventVersion = 0;
    const apply = (next: boolean) => {
      if (active) setIsMaximized(next);
    };
    const handleEvent = (next: boolean) => {
      eventVersion += 1;
      apply(next);
    };

    // 先订阅,再取初始快照。
    const unsubscribe = bridge.onMaximizeChange?.(handleEvent);

    if (bridge.isMaximized) {
      try {
        const snapshotVersion = eventVersion;
        const snapshot = bridge.isMaximized();
        if (snapshot !== undefined) {
          void Promise.resolve(snapshot)
            .then((next) => {
              if (eventVersion === snapshotVersion) apply(next);
            })
            .catch(() => {
              // 初始查询失败:保持事件驱动状态,不向渲染层抛错。
            });
        }
      } catch {
        // 同步抛错同上:桥实现未就绪时静默降级。
      }
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [enabled]);

  return isMaximized;
}

interface WindowControlsProps {
  /** 仅非 macOS 宿主渲染(mac 保留原生交通灯,V25-UI-SPEC §2.3)。 */
  enabled: boolean;
}

/**
 * 宿主适配器:最大化态经 preload 订阅,三钮转发 musefoldV25。
 * 几何由 AppShell `windowControls` 槽(主区右上 32px 窄带)定位。
 */
export function WindowControls({ enabled }: WindowControlsProps) {
  const isMaximized = useWindowMaximized(enabled);
  if (!enabled) return null;

  const bridge = typeof window === 'undefined' ? undefined : window.musefoldV25;
  return (
    <WindowControlsUi
      isMaximized={isMaximized}
      onMinimize={() => bridge?.minimize()}
      onMaximizeToggle={() => bridge?.maximizeToggle()}
      onClose={() => bridge?.close()}
    />
  );
}
