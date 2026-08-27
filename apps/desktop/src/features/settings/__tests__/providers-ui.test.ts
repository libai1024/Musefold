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
const panelModels = readFileSync(
  'apps/desktop/src/features/settings/components/provider-detail-models.tsx',
  'utf8',
);
const panelHooks = readFileSync(
  'apps/desktop/src/features/settings/components/provider-detail-hooks.ts',
  'utf8',
);
const dialogField = readFileSync(
  'apps/desktop/src/features/generation/components/provider-dialog-parts.tsx',
  'utf8',
);
const validationBanner = readFileSync(
  'apps/desktop/src/features/generation/components/ValidationResultBanner.tsx',
  'utf8',
);
const connectionStatus = readFileSync(
  'apps/desktop/src/features/settings/components/connection-status.ts',
  'utf8',
);
const relaySection = readFileSync(
  'apps/desktop/src/features/settings/components/RelaySection.tsx',
  'utf8',
);
const relayDirtyStore = readFileSync(
  'apps/desktop/src/features/settings/relay-dirty-store.ts',
  'utf8',
);
const settingsCss = readFileSync('apps/desktop/src/styles/settings.css', 'utf8');

describe('provider settings master-detail UI contract(RELAY-SETTINGS-UI 第二步)', () => {
  it('replaces the list+dialog with a master-detail split (rail + detail panel)', () => {
    // 分栏骨架:左栏列表 + 右栏详情面板,弹窗不再由 settings section 驱动
    expect(section).toContain(
      "import { InlineConfirm, MasterDetail, MasterDetailItem } from '../components/MasterDetail';",
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

  it('gives the testing dot its own tone with a motion-gated breathing animation', () => {
    // testing 是进行中专属 tone(warning 色 + 呼吸),不再与「未测试」共用 muted 灰
    expect(connectionStatus).toContain("case 'testing':");
    expect(connectionStatus).toContain("return { tone: 'testing', label: '正在测试连接' };");
    expect(masterDetail).toContain("testing: 'bg-warning settings-md-dot-testing'");
    // 动画复用 motion.css 的 pulse-soft 关键帧,不新增 keyframe
    expect(settingsCss).toContain('animation: pulse-soft 1.2s var(--ease-in-out) infinite;');
    // 减动效门控:与既有 data-motion='off' 语义一致,退化为静态 warning 点
    expect(settingsCss).toContain("html:not([data-motion='off']) .settings-md-dot-testing");
    expect(settingsCss).toContain('animation: none;');
  });

  it('degrades the rail to a horizontal scroll list below 960px', () => {
    expect(settingsCss).toContain('@media (max-width: 959px)');
    expect(settingsCss).toContain('grid-template-columns: 240px minmax(0, 1fr);');
    expect(settingsCss).toContain('overflow-x: auto;');
  });

  it('edits in place with useDraftForm draft state and explicit save/discard', () => {
    // 草稿表单接线(initial 推导 + 校验)析出在 provider-detail-hooks
    expect(panelHooks).toContain("import { useDraftForm } from '@musefold/product-ui';");
    expect(panelHooks).toContain("errors.name = '请填写名称'");
    expect(panelHooks).toContain("errors.baseUrl = '请填写 Base URL'");
    expect(panelHooks).toContain("errors.model = '请填写模型'");
    expect(panel).toContain('useProviderDraftForm(provider, presetSeed)');
    expect(panel).toContain('data-testid="settings-provider-detail"');
    // 底部按钮组复用 PanelActions,testid 经 prop 下发(E2E 断言的运行时值不变)
    expect(panel).toContain('saveTestId="provider-save"');
    expect(panel).toContain('const wasNew = !provider;');
    expect(panel).toContain('if (wasNew && id) onCreated(id);');
    expect(panel).toContain('if (createdId) onCreated(createdId);');
    expect(panel).toContain('else onDiscardNew();');
    expect(panel).toContain('testTestId="provider-test"');
    // 显式放弃:编辑态为「放弃」;新建未落库为「取消」,隐式落库后语义升级为「完成」
    expect(panel).toContain("'放弃'");
    expect(panel).toContain("(createdId ? (dirty ? '放弃' : '完成') : '取消')");
    // 隐式落库后再改动(dirty)回到「放弃」语义,点击经 onCreated 重挂载回持久化值
    expect(panel).toContain("form.markPristine();");
    expect(panel).toContain('form.reset()');
    // 删除自头部迁至底部操作条左端,沿用 InlineConfirm 二次确认(文案带宾语)
    expect(panel).toContain('InlineConfirm');
    expect(panel).toContain('确认删除此服务商?');
    expect(panel).toContain('data-testid="provider-delete"');
    // 底部操作条复用共享 PanelActions(sticky + dirty 圆点)
    expect(panel).toContain('PanelActions');
    expect(panel).toContain('dirty={dirty}');
    expect(masterDetail).toContain('settings-md-actions');
    expect(masterDetail).toContain('settings-panel-dirty');
    expect(masterDetail).toContain('有未保存的修改');
  });

  it('surfaces validation errors per field instead of silently disabling save (P0)', () => {
    // ProviderField(共享自 generation)有可选 error 槽:text-danger 渲染在控件下方
    expect(dialogField).toContain('error?: string;');
    expect(dialogField).toContain('text-danger');
    // 三个必填字段接线 errorFor;保存尝试(touchAll)与 blur(markTouched)双触达
    expect(panel).toContain('nameError={form.errorFor(\'name\')}');
    expect(panel).toContain('baseUrlError={form.errorFor(\'baseUrl\')}');
    expect(panel).toContain("error={form.errorFor('model')}");
    expect(panel).toContain('form.touchAll(PROVIDER_DRAFT_FIELDS)');
    expect(panelParts).toContain('onBlur={onNameTouch}');
    expect(panelParts).toContain('onBlur={onBaseUrlTouch}');
    expect(panelModels).toContain('onBlur={onModelTouch}');
    // 缺必填时保存按钮可点:点亮全部错误而不是静默置灰
    expect(panel).toContain('if (!valid) {');
    expect(panel).not.toContain('saveDisabled={!valid');
  });

  it('lets 拉取模型 run without a model (P0 inversion fix) and auto-picks one', () => {
    // 拉取前置只看名称 + Base URL;保存仍要求完整必填(validate 不变)
    expect(panel).toContain('const loadModelsReady = !form.errors.name && !form.errors.baseUrl;');
    expect(panelModels).toContain('disabled={loadDisabled || loadingModels}');
    expect(panel).toContain('loadDisabled={!loadModelsReady || testing || saving}');
    // 拉到列表后:模型留空时自动选首个可用模型(单模型自动选中逻辑的推广)
    expect(panel).toContain('!draft.model.trim() || (models.length === 1');
    expect(panel).toContain('form.setField(\'model\', models[0].id)');
  });

  it('toasts the implicit create and renames the discard action to 完成', () => {
    // 新建草稿点「测试连接/拉取」隐式落库:toast 披露 + 按钮语义从「放弃」改「完成」
    expect(panel).toContain('const wasImplicitCreate = !provider && !createdId;');
    expect(panel).toContain("toast.success('服务商已创建')");
  });

  it('guards dirty drafts when switching rail items or relay tabs (P0)', () => {
    // 面板 dirty 上抛 + section 在切换/新建前弹 InlineConfirm 拦截
    expect(section).toContain('onDirtyChange={setPanelDirty}');
    expect(section).toContain('dirtyGuard={dirtyGuard}');
    expect(section).toContain('未保存的修改');
    expect(section).toContain('放弃修改');
    expect(section).toContain('继续编辑');
    expect(section).toContain('testId="settings-provider-dirty-guard"');
    expect(panel).toContain('onDirtyChange?.(dirty)');
    // guard 槽替换整组操作按钮(与删除二次确认同位)
    expect(masterDetail).toContain('guard?: ReactNode');
    expect(masterDetail).toContain('{guard ? (');
    // tab 切换拦截在 RelaySection 层,dirty 信号经 relay-dirty-store 上抛
    expect(relaySection).toContain('useRelayDirtyStore');
    expect(relaySection).toContain('setPendingTab(next)');
    expect(relaySection).toContain('data-testid="relay-tab-dirty-guard"');
    expect(relayDirtyStore).toContain('dirty: boolean');
    // InlineConfirm 支持自定义取消文案(默认仍是「取消」)
    expect(masterDetail).toContain("cancelLabel = '取消'");
  });

  it('adds shared section titles and the key status row above the key input (RELAY-SETTINGS-UI 美化)', () => {
    // 连接 / 模型 两组标题；中转站本地计费分组已移除
    expect(panel).toContain('ProviderConnectionSection');
    expect(panelParts).toContain('title="连接"');
    expect(panelModels).toContain('title="模型"');
    expect(panel).not.toContain('title="计费"');
    // 模型分组右侧计数:拉取到模型列表后显示
    expect(panelModels).toContain('个可用模型');
    // keySaved 时输入框上方渲染密钥状态行(状态 + 掩码 + 管理说明)
    expect(panelParts).toContain('ApiKeyStatusRow');
    expect(panelParts).toContain('aria-label="名称"');
    expect(panelParts).toContain('aria-label="Base URL"');
    expect(panelParts).toContain('aria-label="API Key"');
    expect(panelParts).toContain("aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}");
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
    const nameAt = panelParts.indexOf('data-testid="provider-name"');
    const baseUrlAt = panelParts.indexOf('data-testid="provider-base-url"');
    const apiKeyAt = panelParts.indexOf('data-testid="provider-api-key"');
    const connectionAt = panel.indexOf('<ProviderConnectionSection');
    const modelsAt = panel.indexOf('<ProviderDetailModels');
    expect(nameAt).toBeGreaterThan(-1);
    expect(nameAt).toBeLessThan(baseUrlAt);
    expect(baseUrlAt).toBeLessThan(apiKeyAt);
    // 连接分组整体在模型分组之前(本体分别析出在 parts / models 文件)
    expect(connectionAt).toBeGreaterThan(-1);
    expect(connectionAt).toBeLessThan(modelsAt);
    expect(panel).not.toContain('ProviderPricingFields');
    expect(panelParts).not.toContain('provider-pricing-');
    // 模型分组本体(析出文件)沿用共享行式列表 + 别名展示
    expect(panelModels).toContain('ModelOptionList');
    expect(panelModels).toContain('testId="provider-model-options"');
    expect(panelModels).toContain('displayModelName(item.id)');
    expect(panelModels).toContain('data-testid="provider-load-models"');
    // 测试结果沿用 ValidationResultBanner
    expect(panel).toContain('ValidationResultBanner');
  });

  it('polishes key input, keyUrl link and copy consistency (P2)', () => {
    // API Key 输入框关闭自动填充(与 Agent 侧一致)
    expect(panelParts).toContain('autoComplete="off"');
    // keyUrl 有值时渲染为可点链接(noopener),不再等测试失败后从 banner 里点开
    expect(panelParts).toContain('data-testid="provider-key-url"');
    expect(panelParts).toContain('rel="noopener noreferrer"');
    // 保存中句式统一带省略号
    expect(panel).toContain("'保存中…'");
    // 眼睛按钮 title 与 aria-label 同步
    expect(panelParts).toContain("title={showKey ? '隐藏 API Key' : '显示 API Key'}");
  });

  it('announces async validation results via a live region (P1)', () => {
    expect(validationBanner).toContain('role="status"');
    expect(validationBanner).toContain('aria-live="polite"');
  });

  it('strips unreachable managed / doubao-web branches from the station panel', () => {
    // 面板入口(ProvidersSection)已过滤 managedBy==='account' 与 type==='doubao-web',
    // 弹窗时代的两条死分支不再进本面板(完整语义由 generation 的 ProviderDialog 承载)
    expect(section).toContain("provider.managedBy !== 'account' && provider.type !== 'doubao-web'");
    expect(panel).not.toContain('DoubaoWebLoginField');
    expect(panel).not.toContain('openWebLogin');
    expect(panel).not.toContain('isDoubaoWeb');
    expect(panel).not.toContain('验证登录');
    expect(panelParts).not.toContain('DoubaoWebLoginField');
    // 预设选择只在新建态出现在详情面板顶部
    expect(panel).toContain('!provider && <ProviderPresetPicker');
    expect(panel).toContain('ProviderPresetPicker');
    expect(panelParts).toContain('PROVIDER_PRESETS.filter');
    // 预设与模型行保持 6px 圆角,无胶囊
    expect(panel).not.toContain('rounded-full');
    expect(panelParts).not.toContain('rounded-full');
  });
});
