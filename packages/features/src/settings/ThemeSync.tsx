'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { resolveThemeClass, usePreferences } from './hooks';

function subscribeSystemDark(callback: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function useSystemPrefersDark(): boolean {
  return useSyncExternalStore(
    subscribeSystemDark,
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    () => false,
  );
}

/** 数据驱动主题:偏好变化(含乐观更新)即刻同步到 <html> class。双宿主共用。 */
export function ThemeSync() {
  const preferences = usePreferences();
  const systemPrefersDark = useSystemPrefersDark();

  useEffect(() => {
    if (!preferences.data) return;
    const themeClass = resolveThemeClass(preferences.data.theme, systemPrefersDark);
    document.documentElement.classList.toggle('dark', themeClass === 'dark');
  }, [preferences.data, systemPrefersDark]);

  return null;
}
