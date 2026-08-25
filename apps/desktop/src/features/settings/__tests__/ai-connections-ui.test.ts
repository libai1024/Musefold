import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const section = readFileSync(
  'apps/desktop/src/features/settings/components/AiConnectionsSection.tsx',
  'utf8',
);
const panel = readFileSync(
  'apps/desktop/src/features/settings/components/AiConnectionDetailPanel.tsx',
  'utf8',
);
const dialogParts = readFileSync(
  'apps/desktop/src/features/settings/components/AiConnectionDialogParts.tsx',
  'utf8',
);
const modelOptionList = readFileSync(
  'apps/desktop/src/components/ui/model-option-list.tsx',
  'utf8',
);
const settingsView = readFileSync(
  'apps/desktop/src/features/settings/components/SettingsView.tsx',
  'utf8',
);

describe('AI connection settings UI contract(RELAY-SETTINGS-UI 第二步)', () => {
  it('merges text AI and image generation into one relay section with tabs (v2 设置整合)', () => {
    // 生图中转站 + Agent 中转站合并为「中转站」分区,内部分段控件切换 tab
    expect(settingsView).toContain("id: 'relay'");
    expect(settingsView).toContain("label: '中转站'");
    expect(settingsView).not.toContain("label: '模型与服务'");
    expect(section).not.toContain('不会自动生图、读取未授权文件或发布方案');
    expect(section).not.toContain('settings-ai-boundary');
    expect(section).not.toContain('导出、导入和备份都不会携带');
  });

  it('replaces the dialog with a master-detail split and in-place editing', () => {
    // AiConnectionDialog 已删除;section 渲染 MasterDetail + 详情面板
    expect(section).toContain(
      "import { AiConnectionDetailPanel } from '../components/AiConnectionDetailPanel';",
    );
    expect(section).not.toContain('<AiConnectionDialog');
    expect(section).not.toContain('openDialog');
    expect(section).toContain('testId="settings-ai-master-detail"');
    // 新建入口在左栏底部,空态快捷预设改为新建草稿(带预设种子)
    expect(section).toContain('data-testid="settings-ai-new"');
    expect(section).toContain('settings-ai-quick-');
    // 详情面板:草稿态 + 显式保存/放弃 + 删除二次确认
    expect(panel).toContain("import { useDraftForm } from '@musefold/product-ui';");
    expect(panel).toContain('data-testid="ai-connection-detail"');
    // 底部按钮组复用 PanelActions,testid 经 prop 下发(E2E 断言的运行时值不变)
    expect(panel).toContain('saveTestId="ai-connection-save"');
    expect(panel).toContain('const wasNew = !connection;');
    expect(panel).toContain('if (wasNew) onCreated(id);');
    expect(panel).toContain('if (createdId) onCreated(createdId);');
    expect(panel).toContain('else onDiscardNew();');
    expect(panel).toContain('testTestId="ai-connection-test"');
    expect(panel).toContain("'放弃'");
    // 删除自头部迁至底部操作条左端,沿用 InlineConfirm 二次确认
    expect(panel).toContain('InlineConfirm');
    expect(panel).toContain('确认删除连接?');
    expect(panel).toContain('data-testid="ai-connection-delete"');
  });

  it('reuses the shared panel actions, section titles and Stripe-style key row (RELAY-SETTINGS-UI 美化)', () => {
    // 底部操作条:sticky + dirty 圆点(与生图面板同一 PanelActions)
    expect(panel).toContain('PanelActions');
    expect(panel).toContain('dirty={dirty}');
    // 连接 / 模型 分组标题,模型分组右侧计数
    expect(panel).toContain('PanelSectionTitle');
    expect(panel).toContain('title="连接"');
    expect(panel).toContain('title="模型"');
    expect(panel).toContain('个可用模型');
    // Key 字段 Stripe 式状态行:状态 + 掩码 + 撤销同排(revoke testid 不变)
    expect(panel).toContain('data-testid="ai-connection-key-status"');
    expect(panel).toContain('密钥已加密保存');
    expect(panel).toContain('ai-connection-revoke-key');
    // 费用提示从全宽条降为 Field hint,契约文案字符串保留
    expect(panel).not.toContain('border-y');
    expect(panel).toContain('费用由服务商或网关计费');
    // CapabilityResult:成功态 Check 头行,dl dt 灰字 / dd 权重对比
    expect(dialogParts).toContain('ai-connection-capabilities-title');
    expect(dialogParts).toContain('连接测试通过');
    expect(dialogParts).toContain('mt-0.5 font-medium text-secondary');
  });

  it('covers presets, manual model fallback, key revoke and capability facts', () => {
    // 预设卡片网格只在新建态出现(网格本体析出在 AiConnectionDialogParts)
    expect(panel).toContain('!connection && !managed');
    expect(panel).toContain('AiConnectionPresetGrid');
    expect(dialogParts).toContain('ai-connection-presets');
    expect(dialogParts).toContain('ai-preset-');
    expect(panel).toContain('ai-connection-base-url');
    expect(panel).toContain('ai-connection-model-error');
    expect(panel).toContain('当前手工模型 ID 已保留');
    expect(panel).toContain('ai-connection-revoke-key');
    expect(dialogParts).toContain('本版本不使用');
    expect(panel).toContain('费用由服务商或网关计费');
    // routeKind 直连/网关分段保留
    expect(panel).toContain('ai-connection-route-kind');
    expect(panel).toContain('RouteButton');
  });

  it('uses app controls and explicit keyboard labels instead of a native select', () => {
    expect(panel).not.toContain('<select');
    // 模型选项已收敛为共享行式列表(ModelOptionList),listbox 语义在该组件内
    expect(panel).toContain('ModelOptionList');
    expect(modelOptionList).toContain('role="listbox"');
    expect(modelOptionList).toContain('role="option"');
    expect(modelOptionList).toContain('focus-visible:ring-2');
    expect(panel).toContain('aria-label="API Key"');
    // v1.4.1:分区统一走 SettingsCard 应用控件面,不再手写网格工具类
    expect(section).toContain('SettingsCard');
  });

  it('groups connection fields before the model group', () => {
    // 分组排序:连接(名称/连接方式/Base URL/API Key)→ 模型(默认模型 + 刷新)
    const nameAt = panel.indexOf('data-testid="ai-connection-name"');
    const baseUrlAt = panel.indexOf('data-testid="ai-connection-base-url"');
    const apiKeyAt = panel.indexOf('data-testid="ai-connection-api-key"');
    const modelAt = panel.indexOf('data-testid="ai-connection-model"');
    const loadModelsAt = panel.indexOf('data-testid="ai-connection-load-models"');
    expect(nameAt).toBeGreaterThan(-1);
    expect(nameAt).toBeLessThan(baseUrlAt);
    expect(baseUrlAt).toBeLessThan(apiKeyAt);
    expect(apiKeyAt).toBeLessThan(modelAt);
    // 刷新按钮收进模型分组底部(列表之后)
    expect(modelAt).toBeLessThan(loadModelsAt);
    // 测试结果沿用 CapabilityResult 面板
    expect(panel).toContain('CapabilityResult');
  });

  it('keeps the status dot wired into the Agent connection rail rows', () => {
    expect(section).toContain('resolveConnectionDot');
    expect(section).toContain('statusDot={resolveConnectionDot({');
    expect(section).toContain('testId={`settings-ai-row-${connection.id}`}');
  });
});
