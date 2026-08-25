import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const section = readFileSync(
  'apps/desktop/src/features/settings/components/ProvidersSection.tsx',
  'utf8',
);
const masterDetail = readFileSync(
  'apps/desktop/src/features/settings/components/MasterDetail.tsx',
  'utf8',
);
const panel = readFileSync(
  'apps/desktop/src/features/settings/components/ProviderDetailPanel.tsx',
  'utf8',
);
const panelParts = readFileSync(
  'apps/desktop/src/features/settings/components/provider-detail-parts.tsx',
  'utf8',
);
const settingsCss = readFileSync('apps/desktop/src/styles/settings.css', 'utf8');

describe('provider settings master-detail UI contract(RELAY-SETTINGS-UI 第二步)', () => {
  it('replaces the list+dialog with a master-detail split (rail + detail panel)', () => {
    // 分栏骨架:左栏列表 + 右栏详情面板,弹窗不再由 settings section 驱动
    expect(section).toContain(
      "import { MasterDetail, MasterDetailItem } from '../components/MasterDetail';",
    );
    expect(section).toContain(
      "import { ProviderDetailPanel } from '../components/ProviderDetailPanel';",
    );
    expect(section).not.toContain('openProviderDialog');
    expect(section).toContain('testId="settings-provider-master-detail"');
    // 左栏行保留第一步的状态点接线与行 testid 约定
    expect(section).toContain('testId={`settings-provider-row-${p.id}`}');
    expect(section).toContain('resolveConnectionDot');
    // 新建入口收进左栏底部,testid 不变(E2E 依赖)
    expect(section).toContain('data-testid="settings-provider-new"');
  });

  it('drops the batch test entry and boundary fact card (v2 设置整合)', () => {
    // 「测试全部」批量入口与卡片级汇总已随 testAll 移除;单 Provider 测试仍在详情面板
    expect(section).not.toContain('settings-provider-test-summary');
    expect(section).not.toContain('测试全部');
    expect(section).toContain('data-testid="settings-provider-list"');
    expect(section).not.toContain('data-testid="settings-provider-boundary"');
  });

  it('renders rail rows with status dot and a nav-like selected state(radius 6,无框)', () => {
    expect(masterDetail).toContain('statusDot?: ConnectionDot');
    expect(masterDetail).toContain('h-2 w-2 rounded-full');
    expect(masterDetail).toContain('bg-success');
    expect(masterDetail).toContain('bg-warning');
    expect(masterDetail).toContain('bg-danger');
    // a11y:title + sr-only 文本 + 行级 testid 派生(与第一步一致)
    expect(masterDetail).toContain('sr-only');
    expect(masterDetail).toContain('`${testId}-status`');
    // 选中态视觉对齐 SettingsWorkspace 侧栏导航:bg-active + 3px accent 条,radius-sm
    expect(settingsCss).toContain(".settings-md-item[data-active='true']");
    expect(settingsCss).toContain('background: var(--bg-active);');
    expect(settingsCss).toContain('border-radius: var(--radius-sm);');
    // 数据模型没有启用/禁用字段:不虚构「已启用/已停用」开关或徽标
    expect(panel).not.toContain('已停用');
    expect(section).not.toContain('已停用');
  });

  it('degrades the rail to a horizontal scroll list below 960px', () => {
    expect(settingsCss).toContain('@media (max-width: 959px)');
    expect(settingsCss).toContain('grid-template-columns: 240px minmax(0, 1fr);');
    expect(settingsCss).toContain('overflow-x: auto;');
  });

  it('edits in place with useDraftForm draft state and explicit save/discard', () => {
    expect(panel).toContain("import { useDraftForm } from '@musefold/product-ui';");
    expect(panel).toContain('data-testid="settings-provider-detail"');
    // 底部按钮组复用 PanelActions,testid 经 prop 下发(E2E 断言的运行时值不变)
    expect(panel).toContain('saveTestId="provider-save"');
    expect(panel).toContain('const wasNew = !provider;');
    expect(panel).toContain('if (wasNew && id) onCreated(id);');
    expect(panel).toContain('if (createdId) onCreated(createdId);');
    expect(panel).toContain('else onDiscardNew();');
    expect(panel).toContain('testTestId="provider-test"');
    // 显式放弃:新建态文案为「取消」,编辑态为「放弃」
    expect(panel).toContain("'放弃'");
    expect(panel).toContain('form.reset()');
    // 删除自头部迁至底部操作条左端,沿用 InlineConfirm 二次确认
    expect(panel).toContain('InlineConfirm');
    expect(panel).toContain('确认删除?');
    expect(panel).toContain('data-testid="provider-delete"');
    // 底部操作条复用共享 PanelActions(sticky + dirty 圆点)
    expect(panel).toContain('PanelActions');
    expect(panel).toContain('dirty={dirty}');
    expect(masterDetail).toContain('settings-md-actions');
    expect(masterDetail).toContain('settings-panel-dirty');
    expect(masterDetail).toContain('有未保存的修改');
  });

  it('adds shared section titles and the key status row above the key input (RELAY-SETTINGS-UI 美化)', () => {
    // 连接 / 模型两组标题；中转站本地计费分组已移除
    expect(panel).toContain('PanelSectionTitle');
    expect(panel).toContain('title="连接"');
    expect(panel).toContain('title="模型"');
    expect(panel).not.toContain('title="计费"');
    // 模型分组右侧计数:拉取到模型列表后显示
    expect(panel).toContain('个可用模型');
    // keySaved 时输入框上方渲染密钥状态行(状态 + 掩码 + 管理说明)
    expect(panel).toContain('ApiKeyStatusRow');
    expect(panel).toContain('aria-label="名称"');
    expect(panel).toContain('aria-label="Base URL"');
    expect(panel).toContain('aria-label="API Key"');
    expect(panel).toContain("aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}");
    expect(panelParts).toContain('data-testid="provider-api-key-status"');
    expect(panelParts).toContain('密钥已加密保存');
    // 预设选择升级为与 Agent 侧同构的卡片网格
    expect(panelParts).toContain('grid grid-cols-2 gap-1.5 sm:grid-cols-3');
    expect(panelParts).toContain('provider-preset-option-${p.id}');
    expect(panelParts).toContain('line-clamp-2');
    // 测试成功透传可用模型数给结果条
    expect(panel).toContain('modelCount: result.ok ? modelOptions.length || undefined : undefined');
    // 左栏行第二行 meta 规格存在
    expect(masterDetail).toContain('meta?: string');
    expect(settingsCss).toContain('.settings-md-item-meta');
  });

  it('keeps 连接 → 模型 grouping with the shared model option list and omits pricing', () => {
    const nameAt = panel.indexOf('data-testid="provider-name"');
    const baseUrlAt = panel.indexOf('data-testid="provider-base-url"');
    const apiKeyAt = panel.indexOf('data-testid="provider-api-key"');
    const modelAt = panel.indexOf('data-testid="provider-model"');
    const loadModelsAt = panel.indexOf('data-testid="provider-load-models"');
    expect(nameAt).toBeGreaterThan(-1);
    expect(nameAt).toBeLessThan(baseUrlAt);
    expect(baseUrlAt).toBeLessThan(apiKeyAt);
    expect(apiKeyAt).toBeLessThan(modelAt);
    expect(modelAt).toBeLessThan(loadModelsAt);
    expect(panel).not.toContain('ProviderPricingFields');
    expect(panelParts).not.toContain('provider-pricing-');
    expect(panel).toContain('ModelOptionList');
    expect(panel).toContain('testId="provider-model-options"');
    expect(panel).toContain('displayModelName(item.id)');
    // 测试结果沿用 ValidationResultBanner
    expect(panel).toContain('ValidationResultBanner');
  });

  it('keeps doubao-web and managed branches plus new-mode preset selection', () => {
    // doubao-web:无 Base URL/Key 字段,操作改为「打开登录窗口」(字段本体在 provider-detail-parts)
    expect(panel).toContain("draft.type === 'doubao-web'");
    expect(panel).toContain('DoubaoWebLoginField');
    expect(panelParts).toContain('data-testid="provider-open-web-login"');
    // managed(账号托管):只读,仅模型选择
    expect(panel).toContain("provider?.managedBy === 'account'");
    // 预设选择只在新建态出现在详情面板顶部
    expect(panel).toContain('!provider && !managed');
    expect(panel).toContain('ProviderPresetPicker');
    expect(panelParts).toContain('PROVIDER_PRESETS.filter');
    // 预设与模型行保持 6px 圆角,无胶囊
    expect(panel).not.toContain('rounded-full');
    expect(panelParts).not.toContain('rounded-full');
  });
});
