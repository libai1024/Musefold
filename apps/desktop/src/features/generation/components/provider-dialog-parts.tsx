// Provider 配置对话框的字段外壳与模型列表合并逻辑（V13-REUSE-03 从对话框析出）。

import type { ReactNode } from 'react';
import type { ModelInfo } from '@musefold/desktop-contracts/providers';

export function mergeModelOptions(currentModel: string, models: ModelInfo[]): ModelInfo[] {
  const unique = new Map<string, ModelInfo>();
  const current = currentModel.trim();
  if (current) unique.set(current, { id: current, name: current, description: '当前填写模型' });
  for (const model of models) {
    const id = model.id.trim();
    if (!id) continue;
    unique.set(id, { ...model, id, name: model.name || id });
  }
  return Array.from(unique.values());
}

/** 字段外壳:label + 控件 + 可选错误行(error 只在字段被 touch 后由调用方传入,避免满屏红字) */
export function Field({
  label,
  error,
  children,
}: {
  label: string;
  /** useDraftForm errorFor 产出的校验错误,渲染在控件下方(text-danger) */
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-secondary">{label}</label>
      {children}
      {error && (
        <p className="mt-1 text-[11px] text-danger" data-testid="provider-field-error">
          {error}
        </p>
      )}
    </div>
  );
}
