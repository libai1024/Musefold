import { z } from 'zod';

/**
 * 应用偏好(v2.5 设置域打样契约)。
 * 双宿主本地持久化:桌面存主进程,Web 存 localStorage;不进云同步。
 */
export const appThemeSchema = z.enum(['light', 'dark', 'system']);
export const appLanguageSchema = z.enum(['zh-CN', 'en-US']);

export const appPreferencesSchema = z.object({
  theme: appThemeSchema,
  language: appLanguageSchema,
  reducedMotion: z.boolean(),
});

export const appPreferencesPatchSchema = appPreferencesSchema.partial();

export const defaultAppPreferences: AppPreferences = {
  theme: 'system',
  language: 'zh-CN',
  reducedMotion: false,
};

export type AppTheme = z.infer<typeof appThemeSchema>;
export type AppLanguage = z.infer<typeof appLanguageSchema>;
export type AppPreferences = z.infer<typeof appPreferencesSchema>;
export type AppPreferencesPatch = z.infer<typeof appPreferencesPatchSchema>;
