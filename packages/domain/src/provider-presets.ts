// Provider 预设解析 —— 空态一键接入与对话框共用（TASK-GEN-01）

import {
  DEFAULT_PRESET_ID,
  PROVIDER_PRESETS,
  type ProviderPreset,
} from './constants';

/** 按 id 取预设；未知 id 回落默认推荐（TvT） */
export function pickPreset(presetId?: string | null): ProviderPreset {
  if (presetId) {
    const hit = PROVIDER_PRESETS.find((p) => p.id === presetId);
    if (hit) return hit;
  }
  return PROVIDER_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID) ?? PROVIDER_PRESETS[0];
}

/** 推荐预设（首启空态高亮） */
export function recommendedPresets(): ProviderPreset[] {
  const rec = PROVIDER_PRESETS.filter((p) => p.recommended);
  return rec.length > 0 ? rec : PROVIDER_PRESETS.slice(0, 1);
}
