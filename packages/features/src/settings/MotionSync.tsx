'use client';

import { useEffect } from 'react';
import { usePreferences } from './hooks';

/**
 * 数据驱动动效分级(与 ThemeSync 同构,双宿主共用):
 * 把偏好 reducedMotion(system/on/off)投影到 <html> 标记,
 * 压制规则在 @musefold/ui globals.css,JS 侧判定在 @musefold/ui/lib/motion。
 * - on → class "reduce-motion" + data-motion="on"(无条件压制)
 * - system → data-motion="system"(仅系统 prefers-reduced-motion 命中时压制)
 * - off → data-motion="off"(显式完整动效,覆盖系统减弱)
 * 系统偏好变化由 CSS 媒体查询实时生效,无需 JS 订阅。
 */
export function MotionSync() {
  const preferences = usePreferences();
  const level = preferences.data?.reducedMotion;

  useEffect(() => {
    if (!level) return;
    const root = document.documentElement;
    root.classList.toggle('reduce-motion', level === 'on');
    root.dataset.motion = level;
  }, [level]);

  return null;
}
