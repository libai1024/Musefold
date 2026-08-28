import { useEffect, useState } from 'react';
import { PRODUCT_MOBILE_BREAKPOINT } from '@musefold/product-ui';

/**
 * >680px（PRODUCT_MOBILE_BREAKPOINT 之上）视为产品大屏：
 * 命令面板与提示词弹窗几何在这一档启用；小屏遵循既有手机 shell 约束。
 * SSR / 无 matchMedia 环境保守回落为小屏（保持整页形态）。
 */
export const LARGE_PRODUCT_VIEWPORT_QUERY = `(min-width: ${PRODUCT_MOBILE_BREAKPOINT + 1}px)`;

export function useLargeProductViewport(): boolean {
  const [large, setLarge] = useState(() => readLargeViewport());

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(LARGE_PRODUCT_VIEWPORT_QUERY);
    const update = () => setLarge(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return large;
}

function readLargeViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(LARGE_PRODUCT_VIEWPORT_QUERY).matches;
}
