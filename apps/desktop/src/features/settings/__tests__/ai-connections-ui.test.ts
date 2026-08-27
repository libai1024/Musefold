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
const panelHooks = readFileSync(
  'apps/desktop/src/features/settings/components/ai-connection-panel-hooks.ts',
  'utf8',
);
const dialogParts = readFileSync(
  'apps/desktop/src/features/settings/components/AiConnectionDialogParts.tsx',
  'utf8',
);
const modelSection = readFileSync(
  'apps/desktop/src/features/settings/components/AiConnectionModelSection.tsx',
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
    // 详情面板:草稿态(编排收拢在 controller hook)+ 显式保存/放弃 + 删除二次确认
    expect(panelHooks).toContain("import { useDraftForm } from '@musefold/product-ui';");
    expect(panelHooks).toContain('export function useAiConnectionPanelController');
    expect(panel).toContain('data-testid="ai-connection-detail"');
    // 底部按钮组复用 PanelActions,testid 经 prop 下发(E2E 断言的运行时值不变)
    expect(panel).toContain('saveTestId="ai-connection-save"');
    expect(panelHooks).toContain('const wasNew = !connection;');
    expect(panelHooks).toContain('if (wasNew) onCreated(id);');
    expect(panelHooks).toContain('if (createdId) onCreated(createdId);');
    expect(panelHooks).toContain('else onDiscardNew();');
    expect(panel).toContain('testTestId="ai-connection-test"');
    expect(panel).toContain("'放弃'");
    // 删除自头部迁至底部操作条左端,沿用 InlineConfirm 二次确认(文案带宾语,与生图统一句式)
    expect(panel).toContain('InlineConfirm');
    expect(panel).toContain('确认删除此连接?');
    expect(panel).toContain('data-testid="ai-connection-delete"');
  });

  it('reuses the shared panel actions, section titles and Stripe-style key row (RELAY-SETTINGS-UI 美化)', () => {
    // 底部操作条:sticky + dirty 圆点(与生图面板同一 PanelActions)
    expect(panel).toContain('PanelActions');
    expect(panel).toContain('dirty={dirty}');
    // 连接 / 模型 分组标题,模型分组右侧计数
    expect(panel).toContain('PanelSectionTitle');
    expect(panel).toContain('title="连接"');
    expect(modelSection).toContain('title="模型"');
    expect(modelSection).toContain('个可用模型');
    // Key 字段 Stripe 式状态行:状态 + 掩码 + 撤销同排(revoke testid 不变,本体析出在 DialogParts)
    expect(dialogParts).toContain('data-testid="ai-connection-key-status"');
    expect(dialogParts).toContain('密钥已加密保存');
    expect(dialogParts).toContain('ai-connection-revoke-key');
    // 费用提示从全宽条降为 Field hint,契约文案字符串保留
    expect(panel).not.toContain('border-y');
    expect(dialogParts).toContain('费用由服务商或网关计费');
    // CapabilityResult:成功态 Check 头行,dl dt 灰字 / dd 权重对比
    expect(dialogParts).toContain('ai-connection-capabilities-title');
    expect(dialogParts).toContain('连接测试通过');
    expect(dialogParts).toContain('mt-0.5 font-medium text-secondary');
  });

  it('covers presets, manual model fallback, key revoke and capability facts', () => {
    // 预设卡片网格只在新建态出现(网格本体析出在 AiConnectionDialogParts)
    expect(panel).toContain('!connection && (');
    expect(panel).toContain('AiConnectionPresetGrid');
    expect(dialogParts).toContain('ai-connection-presets');
    expect(dialogParts).toContain('ai-preset-');
    expect(panel).toContain('ai-connection-base-url');
    expect(modelSection).toContain('ai-connection-model-error');
    expect(panelHooks).toContain('当前手工模型 ID 已保留');
    expect(dialogParts).toContain('本版本不使用');
    expect(dialogParts).toContain('费用由服务商或网关计费');
    // routeKind 直连/网关分段保留
    expect(panel).toContain('ai-connection-route-kind');
    expect(panel).toContain('RouteButton');
  });

  it('surfaces validation errors per field instead of silently disabling save (P0)', () => {
    // Field(AiConnectionDialogParts)有可选 error 槽:text-danger 渲染在控件下方
    expect(dialogParts).toContain('error?: string;');
    expect(dialogParts).toContain('text-danger');
    // 三个必填字段接线 errorFor;保存尝试(touchAll)与 blur(markTouched)双触达
    expect(panel).toContain("error={form.errorFor('name')}");
    expect(panel).toContain("error={form.errorFor('baseUrl')}");
    expect(panel).toContain("error={form.errorFor('model')}");
    expect(panelHooks).toContain('form.touchAll(AI_CONNECTION_DRAFT_FIELDS)');
    expect(panel).toContain("onBlur={() => form.markTouched('name')}");
    expect(panel).toContain("onBlur={() => form.markTouched('baseUrl')}");
    expect(modelSection).toContain('onBlur={onModelTouch}');
    // 缺必填时保存按钮可点:点亮全部错误而不是静默置灰
    expect(panelHooks).toContain('if (!valid) {');
    expect(panel).not.toContain('saveDisabled={!panel.valid');
  });

  it('lets 刷新模型 run without a model (P0 inversion fix) and auto-picks one', () => {
    // 刷新前置只看名称 + Base URL + Key;保存仍要求完整必填(validate 不变)
    expect(panelHooks).toContain(
      'const loadModelsReady = !form.errors.name && !form.errors.baseUrl;',
    );
    expect(modelSection).toContain('disabled={loadDisabled || loadingModels}');
    expect(panel).toContain('loadDisabled={!loadModelsReady || testing || saving}');
    // 主进程建连校验模型非空:留空时已有记录省略 model 补丁、新建用预设默认占位,
    // 拉到列表后自动选中首个可用模型
    expect(panelHooks).toContain('...(model ? { model } : {})');
    expect(panelHooks).toContain('presets.find((preset) => preset.id === draft.presetId)?.model');
    expect(panelHooks).toContain('if (!draft.model.trim() && discovered.length > 0)');
  });

  it('toasts the implicit create and renames the discard action to 完成', () => {
    expect(panelHooks).toContain('const wasImplicitCreate = !connection && !createdId;');
    expect(panelHooks).toContain("toast.success('AI 连接已创建')");
    expect(panel).toContain("(createdId ? (dirty ? '放弃' : '完成') : '取消')");
    // 隐式落库后再改动(dirty)回到「放弃」语义,点击经 onCreated 重挂载回持久化值
    expect(panelHooks).toContain("form.markPristine();");
    // 保存中句式与生图统一带省略号;眼睛按钮补 title
    expect(panel).toContain("'保存中…'");
    expect(dialogParts).toContain("title={showKey ? '隐藏 API Key' : '显示 API Key'}");
    expect(dialogParts).toContain('autoComplete="off"');
  });

  it('discloses routeKind semantics and upgrades the control to a radiogroup (P1)', () => {
    // 容器 radiogroup + 子项 radio/aria-checked(替代 aria-pressed)
    expect(panel).toContain('role="radiogroup"');
    expect(panel).toContain('aria-label="连接方式"');
    expect(dialogParts).toContain('role="radio"');
    expect(dialogParts).toContain('aria-checked={active}');
    expect(dialogParts).not.toContain('aria-pressed={active}');
    // 选中值下渲染一行 dim 说明(直连/网关各一句)
    expect(panel).toContain('ROUTE_HINTS');
    expect(panel).toContain("'直连:直接访问服务商 API'");
    expect(panel).toContain("'网关:经中转站转发,支持结构化输出策略'");
  });

  it('guards dirty drafts when switching rail items or relay tabs (P0)', () => {
    expect(section).toContain('onDirtyChange={setPanelDirty}');
    expect(section).toContain('dirtyGuard={dirtyGuard}');
    expect(section).toContain('未保存的修改');
    expect(section).toContain('放弃修改');
    expect(section).toContain('继续编辑');
    expect(section).toContain('testId="settings-ai-dirty-guard"');
    expect(panel).toContain('onDirtyChange?.(dirty)');
  });

  it('uses app controls and explicit keyboard labels instead of a native select', () => {
    expect(panel).not.toContain('<select');
    // 模型选项已收敛为共享行式列表(ModelOptionList),listbox 语义在该组件内
    expect(modelSection).toContain('ModelOptionList');
    expect(modelOptionList).toContain('role="listbox"');
    expect(modelOptionList).toContain('role="option"');
    expect(modelOptionList).toContain('focus-visible:ring-2');
    expect(dialogParts).toContain('aria-label="API Key"');
    // v1.4.1:分区统一走 SettingsCard 应用控件面,不再手写网格工具类
    expect(section).toContain('SettingsCard');
  });

  it('groups connection fields before the model group', () => {
    // 分组排序:连接(名称/连接方式/Base URL/API Key)→ 模型(默认模型 + 刷新)
    const nameAt = panel.indexOf('data-testid="ai-connection-name"');
    const baseUrlAt = panel.indexOf('data-testid="ai-connection-base-url"');
    const keyFieldAt = panel.indexOf('<AiConnectionKeyField');
    const modelsAt = panel.indexOf('<AiConnectionModelSection');
    expect(nameAt).toBeGreaterThan(-1);
    expect(nameAt).toBeLessThan(baseUrlAt);
    expect(baseUrlAt).toBeLessThan(keyFieldAt);
    expect(keyFieldAt).toBeLessThan(modelsAt);
    // 刷新按钮收进模型分组底部(列表之后,本体在 AiConnectionModelSection)
    expect(modelSection).toContain('data-testid="ai-connection-load-models"');
    // 测试结果沿用 CapabilityResult 面板
    expect(panel).toContain('CapabilityResult');
  });

  it('keeps the status dot wired into the Agent connection rail rows', () => {
    expect(section).toContain('resolveConnectionDot');
    expect(section).toContain('statusDot={resolveConnectionDot({');
    expect(section).toContain('testId={`settings-ai-row-${connection.id}`}');
  });

  it('strips the unreachable managed branch from the station panel (拆分 + 瘦身)', () => {
    // 面板入口已过滤 managedBy==='account',托管分支与两条样式特例不再进本面板
    expect(section).toContain("connection.managedBy !== 'account'");
    expect(panel).not.toContain('managed');
    expect(panelHooks).not.toContain('const managed');
    expect(panelHooks).not.toContain('managed ?');
    expect(panelHooks).not.toContain('px-4 shadow-none');
  });
});
