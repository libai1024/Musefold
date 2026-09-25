// v2.5 桌面「应用更新」域桥:设置「关于 → 应用更新」卡的主进程侧。
//
// 语义全部复用 electron/update 的 UpdaterService(状态机)与 settings/update-preferences
// (electron-store 持久化);本域只做两件事:(1) 出参按 contracts zod 复核;
// (2) 偏好写入后把自动下载开关同步到运行中的 UpdaterService(立即生效)。
// 检查/下载行为语义(防重入、状态迁移、脱敏)都在 UpdaterService,行为改动在那里的
// FakeUpdater 单测覆盖(AGENTS 约束),本域不重复实现。

import {
  appUpdatePreferencesPatchSchema,
  appUpdatePreferencesSchema,
  appUpdateSnapshotSchema,
  appUpdateStatusSchema,
} from '@musefold/contracts';
import { z } from 'zod';
import { getUpdatePreferences, setUpdatePreferences } from '../../settings/update-preferences';
import { getUpdaterService } from '../../update';
import type { MethodDef } from './envelope';

const noInput = z.undefined().or(z.object({}).strict());

export function buildAppUpdateDomainMethods(): Record<string, MethodDef> {
  return {
    'appUpdate.getState': {
      input: noInput,
      handle: async () =>
        appUpdateSnapshotSchema.parse({
          status: getUpdaterService().getState(),
          preferences: getUpdatePreferences(),
        }),
    },
    'appUpdate.checkForUpdates': {
      input: noInput,
      handle: async () => appUpdateStatusSchema.parse(await getUpdaterService().check()),
    },
    'appUpdate.downloadUpdate': {
      input: noInput,
      handle: async () => appUpdateStatusSchema.parse(await getUpdaterService().download()),
    },
    // 安装会退出应用(beforeInstall 完成迁移前准备后 quitAndInstall);
    // 信封可能来不及回渲染层,与 system.relaunch 同一处置(退出由窗口消失本身告知)。
    'appUpdate.installUpdate': {
      input: noInput,
      handle: async () => appUpdateStatusSchema.parse(await getUpdaterService().install()),
    },
    'appUpdate.updatePreferences': {
      input: appUpdatePreferencesPatchSchema,
      handle: async (rawPatch) => {
        const patch = rawPatch as z.infer<typeof appUpdatePreferencesPatchSchema>;
        const preferences = appUpdatePreferencesSchema.parse(setUpdatePreferences(patch));
        getUpdaterService().setAutoDownload(preferences.autoDownload);
        return preferences;
      },
    },
  };
}
