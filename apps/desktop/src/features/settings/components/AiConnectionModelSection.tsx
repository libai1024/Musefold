// src/features/settings/components/AiConnectionModelSection.tsx
// Agent 中转站详情面板的「模型」分组(RELAY-SETTINGS-UI 第二步,自 AiConnectionDetailPanel 析出):
// 默认模型输入 + 可用模型行式列表 + 刷新按钮 + 错误提示。纯展示,数据与动作经 props 传入。

import type { AiTextModelInfo } from '@musefold/desktop-contracts/ai';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { ModelOptionList } from '../../../components/ui/model-option-list';
import { Loader2, RefreshCw } from '../../../components/ui/icons';
import { PanelSectionTitle } from './MasterDetail';
import { Field } from './AiConnectionDialogParts';

export function AiConnectionModelSection({
  model,
  onModelChange,
  onModelTouch,
  error,
  models,
  onLoadModels,
  loadDisabled,
  loadingModels,
  modelError,
}: {
  model: string;
  onModelChange: (value: string) => void;
  /** blur 触达:点亮该字段的校验错误 */
  onModelTouch: () => void;
  error?: string;
  models: AiTextModelInfo[];
  onLoadModels: () => void;
  /** 刷新前置就绪(名称 + Base URL + Key,模型可留空)与 testing/saving busy 态由调用方并入 */
  loadDisabled: boolean;
  loadingModels: boolean;
  modelError: string | null;
}) {
  return (
    <div className="settings-detail-section settings-detail-section--divider">
      <PanelSectionTitle
        title="模型"
        value={models.length > 0 ? `${models.length} 个可用模型` : undefined}
        testId="ai-connection-section-model"
      />
      <Field label="默认模型" hint="模型列表不可用时,可以保留并直接使用手工模型 ID。" error={error}>
        <Input
          aria-label="默认模型"
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          onBlur={onModelTouch}
          mono
          placeholder="model-id"
          data-testid="ai-connection-model"
        />
        {models.length > 0 && (
          <ModelOptionList
            items={models.map((item) => ({
              id: item.id,
              label: item.name || item.id,
              mono: true,
            }))}
            selectedId={model}
            onSelect={onModelChange}
            ariaLabel="可用文本模型"
            testId="ai-connection-model-options"
            optionTestId={(id) => `ai-model-option-${id}`}
          />
        )}
        <div className="mt-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onLoadModels}
            disabled={loadDisabled || loadingModels}
            data-testid="ai-connection-load-models"
          >
            {loadingModels ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            刷新
          </Button>
        </div>
        {modelError && (
          <p
            className="mt-1 text-meta leading-relaxed text-warning"
            role="status"
            data-testid="ai-connection-model-error"
          >
            {modelError}
          </p>
        )}
      </Field>
    </div>
  );
}
