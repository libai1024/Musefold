// src/features/settings/components/provider-detail-models.tsx
// 生图中转站详情面板的「模型」分组(RELAY-SETTINGS-UI 第二步,自 ProviderDetailPanel 析出):
// 模型输入 + 拉取按钮 + 拉取结果行式列表 + 校验错误/预设提示。纯展示,数据与动作经 props 传入。

import type { ModelInfo } from '@musefold/desktop-contracts/providers';
import { ProviderField as Field } from '@renderer/runtime/generation-access';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { ModelOptionList } from '../../../components/ui/model-option-list';
import { Loader2, Zap } from '../../../components/ui/icons';
import { displayModelName } from '../../../lib/model-catalog';
import { PanelSectionTitle } from './MasterDetail';

export function ProviderDetailModels({
  model,
  onModelChange,
  onModelTouch,
  error,
  modelOptions,
  onLoadModels,
  loadDisabled,
  loadingModels,
  modelError,
  modelLabel,
  modelPlaceholder,
  modelHint,
}: {
  model: string;
  onModelChange: (value: string) => void;
  /** blur 触达:点亮该字段的校验错误 */
  onModelTouch: () => void;
  error?: string;
  modelOptions: ModelInfo[];
  onLoadModels: () => void;
  /** 拉取前置就绪(名称 + Base URL,模型可留空)与 testing/saving busy 态由调用方并入 */
  loadDisabled: boolean;
  loadingModels: boolean;
  modelError: string | null;
  modelLabel: string;
  modelPlaceholder: string;
  modelHint?: string;
}) {
  return (
    <div className="settings-detail-section settings-detail-section--divider">
      <PanelSectionTitle
        title="模型"
        value={modelOptions.length > 0 ? `${modelOptions.length} 个可用模型` : undefined}
        testId="provider-section-model"
      />
      <Field label={modelLabel} error={error}>
        <Input
          aria-label={modelLabel}
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          onBlur={onModelTouch}
          placeholder={modelPlaceholder}
          data-testid="provider-model"
        />
        {modelOptions.length > 0 && (
          <ModelOptionList
            items={modelOptions.map((item) => ({
              id: item.id,
              label: displayModelName(item.id),
              title: item.description ?? item.id,
              mono: displayModelName(item.id) === item.id,
            }))}
            selectedId={model}
            onSelect={onModelChange}
            ariaLabel="可用生图模型"
            testId="provider-model-options"
            optionTestId={(id) => `provider-model-option-${id}`}
          />
        )}
        <div className="mt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onLoadModels}
            disabled={loadDisabled || loadingModels}
            data-testid="provider-load-models"
          >
            {loadingModels ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            拉取
          </Button>
        </div>
        {modelError && (
          <p className="mt-1 text-[11px] text-danger" data-testid="provider-model-error">
            {modelError}
          </p>
        )}
        {modelHint && <p className="mt-1 text-[11px] leading-relaxed text-tertiary">{modelHint}</p>}
      </Field>
    </div>
  );
}
