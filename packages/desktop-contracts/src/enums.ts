// shared/types/enums.ts
// 枚举定义 —— 跨进程共享，先于实现完整定义

/** 提示词渲染目标模型族，决定权重序列化语法 */
export type PromptTarget =
  | 'a1111'
  | 'comfyui'
  | 'midjourney'
  | 'flux'
  | 'sd3'
  | 'openai'
  | 'generic';

/** Fragment 片段类型 */
/** 标签组（预设维度） */
export type TagGroup = '风格' | '场景' | '模型' | '主体' | '画质' | '自定义';

/** Provider 类型 */
export const PROVIDER_TYPES = ['openai', 'openai-compatible', 'doubao-web'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export function isProviderType(value: unknown): value is ProviderType {
  return typeof value === 'string' && PROVIDER_TYPES.includes(value as ProviderType);
}

/** 提示词来源；slip = 朱点速记的「笺」（v0.3.3 笺匣，docs/v0.3.3/V03.3-EMBER-MARK-UI-SPEC.md §8） */
export type PromptSource = 'manual' | 'import' | 'shared' | 'slip';

/** 历史记录状态 */
export type HistoryStatus = 'success' | 'failed' | 'cancelled';

/** 图片尺寸（gpt-image-2 取值） */
export type ImageSize =
  | '1024x1024'
  | '1536x1024'
  | '1024x1536'
  | '2048x2048'
  | 'auto';

/** 图片质量 */
export type ImageQuality = 'low' | 'medium' | 'high' | 'auto';

/** 图片背景 */
export type ImageBackground = 'auto' | 'transparent' | 'opaque';

/** 内容审核级别 */
export type ModerationLevel = 'auto' | 'low';

/** Skill 文件分类 */
export type SkillFileKind = 'skill_md' | 'reference' | 'asset' | 'script' | 'license' | 'other';

/** Skill 文件执行策略；当前始终不执行。 */
export type SkillExecutionPolicy = 'never';
