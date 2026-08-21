// Provider 配置对话框的字段外壳、计价模式按钮与草稿校验（V13-REUSE-03 从对话框析出）。

import type { ReactNode } from 'react';
import type { ModelInfo, ProviderPricingMode } from '@musefold/desktop-contracts/providers';
import { cn } from '../../../lib/utils';

export type PricingDraftMode = 'none' | ProviderPricingMode;

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

export function PricingModeButton({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'no-drag rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
        active
          ? 'border-transparent bg-primary text-background'
          : 'border-border-subtle bg-transparent text-secondary hover:border-border-default hover:text-primary'
      )}
    >
      {children}
    </button>
  );
}

export function validatePricingDraft(
  mode: PricingDraftMode,
  unitPoints: string,
): string | null {
  if (mode === 'none') return null;
  const trimmed = unitPoints.trim();
  if (!trimmed) return '请填写单价';
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return '单价必须是非负积分数';
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return '单价过大';
  return null;
}
