// src/features/settings/components/provider-detail-hooks.ts
// 生图中转站详情面板的草稿表单(RELAY-SETTINGS-UI 第二步,自 ProviderDetailPanel 析出):
// initial 推导(选中条目回填 / 预设种子) + useDraftForm 接线(校验产出「请填写…」)。
// 面板入口已过滤 managed/doubao-web,校验只覆盖通用必填项。

import { useMemo } from 'react';
import type { NewProviderConfig, ProviderConfig } from '@musefold/desktop-contracts/providers';
import { PROVIDER_PRESETS } from '@musefold/domain/constants';
import { pickPreset } from '@musefold/domain/provider-presets';
import { useDraftForm } from '@musefold/product-ui';

export const PROVIDER_DRAFT_FIELDS = ['name', 'baseUrl', 'model'] as const;

/** 参与 dirty/校验的实体字段；API Key（只写）留在局部状态。 */
export interface ProviderDraft {
  presetId: string;
  name: string;
  type: NewProviderConfig['type'];
  baseUrl: string;
  model: string;
}

export type ProviderDraftField = (typeof PROVIDER_DRAFT_FIELDS)[number];

export function useProviderDraftForm(
  provider: ProviderConfig | null,
  presetSeed?: string | null,
) {
  const initial = useMemo<ProviderDraft>(() => {
    if (provider) {
      // 匹配预设以高亮(仅作提示;匹配 type,其次 baseUrl)
      const match =
        PROVIDER_PRESETS.find((p) => p.type === provider.type) ??
        PROVIDER_PRESETS.find((p) => p.baseUrl === provider.baseUrl);
      return {
        presetId: match?.id ?? '',
        name: provider.name,
        type: provider.type,
        baseUrl: provider.baseUrl,
        model: provider.model,
      };
    }
    const preset = pickPreset(presetSeed);
    return {
      presetId: preset.id,
      name: preset.name,
      type: preset.type,
      baseUrl: preset.baseUrl,
      model: preset.model,
    };
    // 只随选中条目/预设种子重建草稿,避免无关 store 更新打断编辑
  }, [
    provider?.id,
    provider?.name,
    provider?.type,
    provider?.baseUrl,
    provider?.model,
    presetSeed,
  ]);

  return useDraftForm<ProviderDraft, ProviderDraftField>({
    initial,
    validate: (draft) => {
      const errors: Partial<Record<ProviderDraftField, string>> = {};
      if (!draft.name.trim()) errors.name = '请填写名称';
      if (!draft.baseUrl.trim()) errors.baseUrl = '请填写 Base URL';
      if (!draft.model.trim()) errors.model = '请填写模型';
      return errors;
    },
  });
}
