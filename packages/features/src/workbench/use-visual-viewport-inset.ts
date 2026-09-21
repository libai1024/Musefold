'use client';

import { useSyncExternalStore } from 'react';
import { useMediaQuery } from '../shell/sidebar-layout';

/** Tailwind `md` 以下才抬 Composer;无 matchMedia 时该查询为 false,inset 保持 0。 */
const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

/**
 * 软键盘 inset:布局视口底边到 visualViewport 底边的距离。
 * iOS 键盘常不改 `innerHeight`,只缩小 visualViewport;Android Chrome 常同步缩小两者(inset ≈ 0)。
 */
export function visualViewportInsetPx(
  innerHeight: number,
  viewport: Pick<VisualViewport, 'height' | 'offsetTop'> | null | undefined,
): number {
  if (!viewport) return 0;
  return Math.max(0, innerHeight - viewport.height - viewport.offsetTop);
}

function readVisualViewportInset(): number {
  if (typeof window === 'undefined') return 0;
  return visualViewportInsetPx(window.innerHeight, window.visualViewport);
}

function subscribeVisualViewport(notify: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', notify);
  viewport?.addEventListener('scroll', notify);
  return () => {
    viewport?.removeEventListener('resize', notify);
    viewport?.removeEventListener('scroll', notify);
  };
}

/**
 * 移动 Web 软键盘 inset(px)。
 * 仅 `<md` 启用;md+ / 无 `visualViewport` / SSR / jsdom 恒为 0。减少动效不另做动画。
 */
export function useVisualViewportInset(): number {
  const mobile = useMediaQuery(MOBILE_MEDIA_QUERY);
  const inset = useSyncExternalStore(subscribeVisualViewport, readVisualViewportInset, () => 0);
  return mobile ? inset : 0;
}
