// 桌面应用更新偏好:持久化在主 electron-store 的 update 命名空间(与 update.channel 同库)。
// 双开关默认全开:主流基线(VS Code default / Chrome)都是启动静默检查 + 后台下载,
// 用户可以在设置里关掉。非法存量值回落默认,不抛异常。

import Store from 'electron-store';
import type { AppUpdatePreferences, AppUpdatePreferencesPatch } from '@musefold/contracts';
import { STORE_NAME } from '@musefold/core/constants';

export const DEFAULT_UPDATE_PREFERENCES: AppUpdatePreferences = {
  autoCheckOnStartup: true,
  autoDownload: true,
};

interface UpdatePreferencesSettingsShape {
  update: {
    channel?: string;
    autoCheckOnStartup?: boolean;
    autoDownload?: boolean;
  };
}

const store = new Store<UpdatePreferencesSettingsShape>({
  name: STORE_NAME,
  defaults: { update: {} },
});

function readBoolean(key: 'autoCheckOnStartup' | 'autoDownload', fallback: boolean): boolean {
  const stored = store.get(`update.${key}`);
  return typeof stored === 'boolean' ? stored : fallback;
}

export function getUpdatePreferences(): AppUpdatePreferences {
  return {
    autoCheckOnStartup: readBoolean(
      'autoCheckOnStartup',
      DEFAULT_UPDATE_PREFERENCES.autoCheckOnStartup,
    ),
    autoDownload: readBoolean('autoDownload', DEFAULT_UPDATE_PREFERENCES.autoDownload),
  };
}

export function setUpdatePreferences(patch: AppUpdatePreferencesPatch): AppUpdatePreferences {
  if (patch.autoCheckOnStartup !== undefined) {
    store.set('update.autoCheckOnStartup', patch.autoCheckOnStartup);
  }
  if (patch.autoDownload !== undefined) {
    store.set('update.autoDownload', patch.autoDownload);
  }
  return getUpdatePreferences();
}

/** 仅供测试:回写默认,避免用例间串扰。 */
export function resetUpdatePreferencesForTests(): void {
  store.delete('update.autoCheckOnStartup');
  store.delete('update.autoDownload');
}
