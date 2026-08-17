// src/lib/model-catalog.ts
// 模型列表过滤与显示名的单一出处：
// 中转站 /models 混排文本与图像模型，各处选择器共用同一套过滤规则，
// 账号别名模型（musefold-*）统一映射为友好显示名。

/** 生图模型过滤：混排列表只留图像相关。 */
export const IMAGE_MODEL_PATTERN = /image|dall|flux|seedream|seededit|midjourney|stable|sd3|sdxl|cogview|wanx|imagen|banana/i;

/** Agent 模型列表过滤：/models 返回里剔除明显的非文本模型。 */
export const NON_TEXT_MODEL_PATTERN = /embed|whisper|tts|audio|rerank|moderation|sora|video|image|dall/i;

/**
 * 过滤出生图模型。
 * - wukong-studio 以产品 ID 标识模型，不适用命名过滤；
 * - BYOK 站全部滤空说明命名规则不适配，回退原列表（宁可多显示不可无选项）；
 * - 托管站（账号）不回退：Agent 别名混进生图选择器就是事故（用户报告的 bug）。
 */
export function filterImageModels<T extends { id: string }>(
  models: T[],
  options: { managed?: boolean; providerType?: string } = {},
): T[] {
  if (options.providerType === 'wukong-studio') return models;
  const filtered = models.filter((model) => IMAGE_MODEL_PATTERN.test(model.id));
  if (filtered.length > 0) return filtered;
  return options.managed ? [] : models;
}

/** 账号别名模型 → 友好显示名；未知模型原样返回。 */
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'musefold-image-pro': 'Musefold 生图',
  'musefold-agent': 'Musefold Agent',
};

export function displayModelName(id: string | null | undefined): string {
  if (!id) return '';
  return MODEL_DISPLAY_NAMES[id] ?? id;
}
