import { z } from 'zod';
/**
 * 应用偏好(v2.5 设置域打样契约)。
 * 双宿主本地持久化:桌面存主进程,Web 存 localStorage;不进云同步。
 */
export declare const appThemeSchema: z.ZodEnum<{
  system: 'system';
  light: 'light';
  dark: 'dark';
}>;
export declare const appLanguageSchema: z.ZodEnum<{
  'zh-CN': 'zh-CN';
  'en-US': 'en-US';
}>;
export declare const appPreferencesSchema: z.ZodObject<
  {
    theme: z.ZodEnum<{
      system: 'system';
      light: 'light';
      dark: 'dark';
    }>;
    language: z.ZodEnum<{
      'zh-CN': 'zh-CN';
      'en-US': 'en-US';
    }>;
    reducedMotion: z.ZodBoolean;
  },
  z.core.$strip
>;
export declare const appPreferencesPatchSchema: z.ZodObject<
  {
    theme: z.ZodOptional<
      z.ZodEnum<{
        system: 'system';
        light: 'light';
        dark: 'dark';
      }>
    >;
    language: z.ZodOptional<
      z.ZodEnum<{
        'zh-CN': 'zh-CN';
        'en-US': 'en-US';
      }>
    >;
    reducedMotion: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const defaultAppPreferences: AppPreferences;
export type AppTheme = z.infer<typeof appThemeSchema>;
export type AppLanguage = z.infer<typeof appLanguageSchema>;
export type AppPreferences = z.infer<typeof appPreferencesSchema>;
export type AppPreferencesPatch = z.infer<typeof appPreferencesPatchSchema>;
//# sourceMappingURL=preferences.d.ts.map
