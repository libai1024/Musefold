import { z } from 'zod';

/**
 * 应用更新域(v2.5):外壳 electron-updater 的状态机契约,设置「关于 → 应用更新」卡的唯一数据源。
 *
 * 形状与主进程 `UpdaterService` 的状态对象同源(见 apps/desktop/electron/update/updater-service.ts);
 * 这里是唯一事实源,`@musefold/desktop-contracts/updater` 的 legacy 类型由本文件派生,不平行手写。
 * 窄口径:不含 feed URL、本地路径或 electron-updater 对象。
 */

export const appUpdateStateSchema = z.enum([
  'disabled',
  'idle',
  'checking',
  'not-available',
  'available',
  'downloading',
  'downloaded',
  'installing',
  'error',
]);
export type AppUpdateState = z.infer<typeof appUpdateStateSchema>;

export const appUpdateDisabledReasonSchema = z.enum([
  'development',
  'unsupported-platform',
  'disabled-by-environment',
]);
export type AppUpdateDisabledReason = z.infer<typeof appUpdateDisabledReasonSchema>;

export const appUpdateProgressSchema = z.object({
  /** 0–100;主进程已 clamp 非有限值。 */
  percent: z.number().nonnegative(),
  transferred: z.number().nonnegative(),
  total: z.number().nonnegative(),
  bytesPerSecond: z.number().nonnegative(),
});
export type AppUpdateProgress = z.infer<typeof appUpdateProgressSchema>;

/** 候选/已下载版本的元数据;version 缺失时主进程回落当前版本号。 */
export const appUpdateMetadataSchema = z.object({
  version: z.string().min(1),
  releaseDate: z.string().min(1).optional(),
});
export type AppUpdateMetadata = z.infer<typeof appUpdateMetadataSchema>;

export const appUpdateStatusSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('disabled'),
    currentVersion: z.string().min(1),
    reason: appUpdateDisabledReasonSchema,
  }),
  z.object({
    state: z.enum(['idle', 'checking', 'not-available']),
    currentVersion: z.string().min(1),
  }),
  z
    .object({
      state: z.enum(['available', 'downloaded', 'installing']),
      currentVersion: z.string().min(1),
    })
    .extend(appUpdateMetadataSchema.shape),
  z
    .object({
      state: z.literal('downloading'),
      currentVersion: z.string().min(1),
      progress: appUpdateProgressSchema,
    })
    .extend(appUpdateMetadataSchema.shape),
  z.object({
    state: z.literal('error'),
    currentVersion: z.string().min(1),
    /** 主进程已脱敏(无 URL / 本地路径),长度 ≤ 300。 */
    message: z.string().min(1),
  }),
]);
export type AppUpdateStatus = z.infer<typeof appUpdateStatusSchema>;

/**
 * 自动更新偏好(桌面主进程 electron-store 持久化,不进云同步):
 * - autoCheckOnStartup:启动后自动检查 + 周期性复查的门(关 = 只能手动「检查更新」);
 * - autoDownload:任一次检查(自动或手动)发现新版本后是否直接后台下载。
 * 默认双开(VS Code/Chrome 主流基线:静默检查、后台下载、重启时安装,且都能关)。
 */
export const appUpdatePreferencesSchema = z.object({
  autoCheckOnStartup: z.boolean(),
  autoDownload: z.boolean(),
});
export type AppUpdatePreferences = z.infer<typeof appUpdatePreferencesSchema>;

export const appUpdatePreferencesPatchSchema = appUpdatePreferencesSchema.partial();
export type AppUpdatePreferencesPatch = z.infer<typeof appUpdatePreferencesPatchSchema>;

/** `appUpdate.getState` 出参:状态 + 偏好一次读齐(控制面卡唯一数据源,承 automation.getStatus)。 */
export const appUpdateSnapshotSchema = z.object({
  status: appUpdateStatusSchema,
  preferences: appUpdatePreferencesSchema,
});
export type AppUpdateSnapshot = z.infer<typeof appUpdateSnapshotSchema>;
