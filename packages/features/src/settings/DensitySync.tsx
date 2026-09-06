'use client';

import { useEffect } from 'react';
import { usePreferences } from './hooks';

/**
 * 数据驱动界面密度(与 ThemeSync / MotionSync 同构,双宿主共用):
 * 把偏好 density 投影到 <html data-density>,紧凑档覆盖 ui 包 `--density-*` token。
 */
export function DensitySync() {
  const preferences = usePreferences();
  const density = preferences.data?.density;

  useEffect(() => {
    if (!density) return;
    document.documentElement.dataset.density = density;
  }, [density]);

  return null;
}
