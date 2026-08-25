import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dialog = readFileSync(
  'apps/desktop/src/features/generation/components/ProviderDialog.tsx',
  'utf8',
);
const parts = readFileSync(
  'apps/desktop/src/features/generation/components/provider-dialog-parts.tsx',
  'utf8',
);

describe('provider dialog UI contract（RELAY-SETTINGS-UI 第一步）', () => {
  it('groups fields as 连接 → 模型 and omits local pricing controls', () => {
    const nameAt = dialog.indexOf('data-testid="provider-name"');
    const baseUrlAt = dialog.indexOf('data-testid="provider-base-url"');
    const apiKeyAt = dialog.indexOf('data-testid="provider-api-key"');
    const modelAt = dialog.indexOf('data-testid="provider-model"');
    const loadModelsAt = dialog.indexOf('data-testid="provider-load-models"');
    expect(nameAt).toBeGreaterThan(-1);
    // 连接分组：名称 → Base URL → API Key
    expect(nameAt).toBeLessThan(baseUrlAt);
    expect(baseUrlAt).toBeLessThan(apiKeyAt);
    // 模型分组在连接之后，拉取按钮收在模型分组内
    expect(apiKeyAt).toBeLessThan(modelAt);
    expect(modelAt).toBeLessThan(loadModelsAt);
    expect(loadModelsAt).toBeGreaterThan(modelAt);
    expect(dialog).not.toContain('provider-pricing-mode');
  });

  it('renders model options as a shared row list instead of capsules', () => {
    expect(dialog).toContain('ModelOptionList');
    expect(dialog).toContain('testId="provider-model-options"');
    expect(dialog).toContain('optionTestId={(id) => `provider-model-option-${id}`}');
    // 模型名经过 displayModelName 别名
    expect(dialog).toContain('displayModelName(item.id)');
  });

  it('keeps 6px radius on pills/buttons, no rounded-full capsules', () => {
    expect(dialog).not.toContain('rounded-full');
    expect(parts).not.toContain('rounded-full');
    expect(dialog).toContain('rounded-sm');
  });
});
