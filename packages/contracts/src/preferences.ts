import { z } from 'zod';

/**
 * 应用偏好(v2.5 设置域打样契约)。
 * 双宿主本地持久化:桌面存主进程,Web 存 localStorage;不进云同步。
 */
export const appThemeSchema = z.enum(['light', 'dark', 'system']);
export const appLanguageSchema = z.enum(['zh-CN', 'en-US']);

/**
 * 动效分级(承 v2.1 三态语义,ui-parity 07-03 §4.1):
 * - system:跟随系统 `prefers-reduced-motion`(默认);
 * - on:强制减少——动画/过渡压至瞬时到达终态,省 CPU/GPU 与电量;
 * - off:强制完整动效,即使系统开了减弱也播放(布尔表达不了这一档,是三态的存在理由)。
 */
export const motionLevelSchema = z.enum(['system', 'on', 'off']);

/** v2.5 早期存档是布尔:false(不减少)→ system,true(减少)→ on。 */
const motionLevelWithLegacy = z.preprocess(
  (value) => (value === true ? 'on' : value === false ? 'system' : value),
  motionLevelSchema,
);

export const appPreferencesSchema = z.object({
  theme: appThemeSchema,
  language: appLanguageSchema,
  reducedMotion: motionLevelWithLegacy.default('system'),
  /**
   * 工作台会话置顶(V25-UI-SPEC §3.3 / D6):本机偏好,不进云;
   * 带 default 使旧存档缺字段时无损升级。跨端同步待后续版本。
   */
  pinnedSessionIds: z.array(z.string()).default([]),
});

export const appPreferencesPatchSchema = appPreferencesSchema.partial();

export const defaultAppPreferences: AppPreferences = {
  theme: 'system',
  language: 'zh-CN',
  reducedMotion: 'system',
  pinnedSessionIds: [],
};

export type AppTheme = z.infer<typeof appThemeSchema>;
export type AppLanguage = z.infer<typeof appLanguageSchema>;
export type MotionLevel = z.infer<typeof motionLevelSchema>;
export type AppPreferences = z.infer<typeof appPreferencesSchema>;
export type AppPreferencesPatch = z.infer<typeof appPreferencesPatchSchema>;
