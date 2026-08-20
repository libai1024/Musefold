import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const section = readFileSync('apps/desktop/src/features/settings/sections/AiConnectionsSection.tsx', 'utf8');
const dialog = readFileSync('apps/desktop/src/features/settings/components/AiConnectionDialog.tsx', 'utf8');
const settingsView = readFileSync('apps/desktop/src/features/settings/components/SettingsView.tsx', 'utf8');

describe('AI connection settings UI contract', () => {
  it('keeps text AI and image generation in separate settings sections', () => {
    expect(settingsView).toContain("key: 'doubao', label: '豆包网页版'");
    expect(settingsView).toContain("key: 'providers', label: '生图中转站'");
    expect(settingsView).toContain("key: 'ai', label: 'Agent 中转站'");
    expect(settingsView).toContain("label: '高级设置'");
    expect(section).toContain('不会自动生图、读取未授权文件或发布方案');
  });

  it('covers presets, manual model fallback, key revoke and capability facts', () => {
    expect(dialog).toContain('ai-connection-presets');
    expect(dialog).toContain('ai-connection-base-url');
    expect(dialog).toContain('ai-connection-model-error');
    expect(dialog).toContain('当前手工模型 ID 已保留');
    expect(dialog).toContain('ai-connection-revoke-key');
    expect(dialog).toContain('本版本不使用');
    expect(dialog).toContain('费用由你连接的服务商或网关计费');
  });

  it('uses app controls and explicit keyboard labels instead of a native select', () => {
    expect(dialog).not.toContain('<select');
    expect(dialog).toContain('role="listbox"');
    expect(dialog).toContain('focus-visible:ring-2');
    expect(dialog).toContain('aria-label="API Key"');
    expect(section).toContain('sm:grid-cols-3');
  });
});
