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

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-secondary">{label}</label>
      {children}
    </div>
  );
}
