import { z } from 'zod';
import { isoDateTimeSchema } from './common';
import { accountNoticeReadIdsSchema } from './account-notices';
import {
  generationAspectRatioSchema,
  generationCountSchema,
  generationQualitySchema,
} from './generation';

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

/** 界面密度(承 v2.1,ui-parity 07-03):舒适为默认,紧凑覆盖 `--density-*` token。 */
export const interfaceDensitySchema = z.enum(['comfortable', 'compact']);

/**
 * 新会话/空草稿的默认画幅:目录预设或规范 `W:H`,另含 Composer 默认档 `auto`。
 * 复用 generation 比例 schema(约分 + 1:4–4:1),带 default 使旧存档无损升级。
 */
export const defaultAspectRatioSchema = z.union([z.literal('auto'), generationAspectRatioSchema]);

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
  /**
   * 新设计默认画幅(与 Composer 目录同一规范)。缺字段 → auto(与 Composer 当前默认一致)。
   */
  defaultAspectRatio: defaultAspectRatioSchema.default('auto'),
  /**
   * 新设计默认质量(generationQualitySchema)。缺字段 → auto(与 Composer 当前默认一致)。
   */
  defaultQuality: generationQualitySchema.default('auto'),
  /**
   * 新设计默认张数(§9-D3 解锁后生效)。缺字段 → 1;
   * 宿主 `maxGenerationCount === 1` 时该偏好不出现在设置面,仍按 1 参与继承。
   */
  defaultCount: generationCountSchema.default(1),
  /** 界面密度。缺字段 → comfortable。 */
  density: interfaceDensitySchema.default('comfortable'),
  /**
   * 首启引导完成哨兵(U01-onboarding):完成或跳过引导的时刻,null = 尚未完成。
   * 「已具备可用生图通道」的存量用户由 gate 静默写入,避免老用户看到引导;
   * 一旦非 null 就不再重放。本机偏好,不进云同步。
   */
  onboardingCompletedAt: isoDateTimeSchema.nullable().default(null),
  /** Read-only import of legacy device-wide public notice markers; no credentials/content. */
  legacyAccountNoticeReadIds: accountNoticeReadIdsSchema.optional(),
});

/**
 * 增量 patch 契约。zod 4 下 `appPreferencesSchema.partial()` 仍会给缺席的带 `.default()`
 * 字段回填默认值,单字段 patch 经桌面 `gateway-bridge` 校验后再 spread,会把置顶/密度/
 * 生成默认/引导哨兵一起打回默认。这里先剥掉 default 再 partial:缺席字段保持缺席,
 * legacy 预处理(布尔 reducedMotion)保留。字段列表由 `appPreferencesSchema.shape` 派生,不手抄。
 */
type WithoutDefaults<T extends z.ZodRawShape> = {
  [K in keyof T]: T[K] extends z.ZodDefault<infer Inner> ? Inner : T[K];
};

function withoutDefaults<T extends z.ZodRawShape>(shape: T): WithoutDefaults<T> {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [
      key,
      schema instanceof z.ZodDefault ? schema.removeDefault() : schema,
    ]),
  ) as WithoutDefaults<T>;
}

export const appPreferencesPatchSchema = z
  .object(withoutDefaults(appPreferencesSchema.shape))
  .partial();

export const defaultAppPreferences: AppPreferences = {
  theme: 'system',
  language: 'zh-CN',
  reducedMotion: 'system',
  pinnedSessionIds: [],
  defaultAspectRatio: 'auto',
  defaultQuality: 'auto',
  defaultCount: 1,
  density: 'comfortable',
  onboardingCompletedAt: null,
};

export type AppTheme = z.infer<typeof appThemeSchema>;
export type AppLanguage = z.infer<typeof appLanguageSchema>;
export type MotionLevel = z.infer<typeof motionLevelSchema>;
export type InterfaceDensity = z.infer<typeof interfaceDensitySchema>;
export type DefaultAspectRatio = z.infer<typeof defaultAspectRatioSchema>;
export type AppPreferences = z.infer<typeof appPreferencesSchema>;
export type AppPreferencesPatch = z.infer<typeof appPreferencesPatchSchema>;
