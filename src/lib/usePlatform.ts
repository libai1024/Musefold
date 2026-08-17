// src/lib/usePlatform.ts
// 平台检测与窗口状态 —— 渲染进程沙箱内用 navigator.userAgentData / userAgent 判定
// 用于 TitleBar 内边距（Mac 交通灯 vs Win/Linux 自绘控件）与 CSS [data-platform] 微调

import { useEffect, useMemo, useState } from 'react';

export interface Platform {
  isMac: boolean;
  isWin: boolean;
  isLinux: boolean;
  isOther: boolean;
  /** 语义化名字，用于 data-platform 属性 */
  name: 'mac' | 'win' | 'linux' | 'other';
}

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

const platform: Platform = (() => {
  if (/Windows|Win32|Win64/i.test(ua))
    return { isMac: false, isWin: true, isLinux: false, isOther: false, name: 'win' };
  if (/Macintosh|Mac OS X|Mac_PowerPC/i.test(ua))
    return { isMac: true, isWin: false, isLinux: false, isOther: false, name: 'mac' };
  if (/Linux|X11/i.test(ua))
    return { isMac: false, isWin: false, isLinux: true, isOther: false, name: 'linux' };
  return { isMac: false, isWin: false, isLinux: false, isOther: true, name: 'other' };
})();

export function usePlatform(): Platform {
  return useMemo(() => platform, []);
}

/** 窗口最大化状态（用于自绘控件在"最大化/还原"间切换图标） */
export function useWindowMaximized(): boolean {
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    const w = window.api?.window;
    if (!w) return;
    w.isMaximized().then(setIsMax).catch(() => {});
    return w.onMaximizeChange(setIsMax);
  }, []);

  return isMax;
}

/** 全屏状态（mac 全屏时交通灯隐藏 → 标题栏左侧无需让位） */
export function useWindowFullscreen(): boolean {
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const w = window.api?.window;
    if (!w) return;
    return w.onFullscreenChange(setIsFs);
  }, []);

  return isFs;
}
