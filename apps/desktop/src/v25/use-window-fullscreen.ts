// v2.5 桌面壳:macOS 原生全屏感知(U01-fullscreen-inset 子卡)。
//
// 窗口状态是宿主特权信号,不进 contracts / platform data gateway / musefold:invoke
// 方法表;渲染层直接读 preload 暴露的 window.musefoldV25 窗口方法。
// 桥缺失时安全 no-op;仅有订阅或快照方法时使用现有能力(浏览器与单测环境亦然)。

import { useEffect, useState } from 'react';

/** macOS hiddenInset 交通灯让位(window.ts trafficLightPosition x=14 + 三灯宽度)。 */
export const BRAND_INSET_MAC = 78;
/** macOS 原生全屏:交通灯随标题栏隐藏,品牌行回到常规缩进(旧版基线约 12px)。 */
export const BRAND_INSET_MAC_FULLSCREEN = 12;

/**
 * 品牌行几何唯一口径(ui-parity 01 §4-2,V25-UI-SPEC §2.2-1):
 * 非 macOS 0px;macOS 非全屏 78px;macOS 原生全屏 12px。
 * 旧版展开态 86px 属于历史双状态基线,不套进当前单一 brandInset。
 */
export function resolveBrandInset(isMac: boolean, isFullscreen: boolean): number {
  if (!isMac) return 0;
  return isFullscreen ? BRAND_INSET_MAC_FULLSCREEN : BRAND_INSET_MAC;
}

type FullscreenListener = (fullscreen: boolean) => void;

/**
 * preload 窗口桥的最小结构式视图。容忍同步布尔或 Promise 快照、以及未返回
 * unsubscribe 的订阅实现。
 */
interface WindowFullscreenBridge {
  onFullscreenChange?(listener: FullscreenListener): undefined | (() => void);
  isFullscreen?(): Promise<boolean> | boolean;
}

function getFullscreenBridge(): WindowFullscreenBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.musefoldV25 as WindowFullscreenBridge | undefined;
}

/**
 * 订阅主进程全屏状态。仅 macOS 需要该信号驱动 brandInset,其余平台 enabled=false
 * 时不订阅不查询,几何恒 0(resolveBrandInset 兜底)。
 *
 * 顺序约束:先订阅 onFullscreenChange 再查询 isFullscreen() —— 启动时窗口可能已
 * 处于全屏(不会再有事件)。查询快照只在查询启动后尚未收到事件时应用;
 * 事件一旦到达就成为更新后的权威状态,避免独立 IPC 流的迟到快照覆盖新事件。
 */
export function useWindowFullscreen(enabled: boolean): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const bridge = getFullscreenBridge();
    // 桥缺失:安全 no-op,保持非全屏几何;仅缺一项方法时使用另一项可用能力。
    if (!bridge || (!bridge.onFullscreenChange && !bridge.isFullscreen)) return;

    // StrictMode/卸载竞态:cleanup 后迟到的快照与残留事件一律作废。
    let active = true;
    let eventVersion = 0;
    const apply = (next: boolean) => {
      if (active) setIsFullscreen(next);
    };
    const handleEvent = (next: boolean) => {
      eventVersion += 1;
      apply(next);
    };

    // 先订阅,再取初始快照。
    const unsubscribe = bridge.onFullscreenChange?.(handleEvent);

    if (bridge.isFullscreen) {
      try {
        const snapshotVersion = eventVersion;
        const snapshot = bridge.isFullscreen();
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

  return isFullscreen;
}
