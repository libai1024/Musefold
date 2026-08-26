import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebar = readFileSync('apps/desktop/src/components/layout/Sidebar.tsx', 'utf8');
const switcher = readFileSync(
  'apps/desktop/src/components/layout/SidebarAccessSwitcher.tsx',
  'utf8',
);
const overlays = readFileSync('apps/desktop/src/styles/overlays-v2.css', 'utf8');
const settings = readFileSync(
  'apps/desktop/src/features/settings/components/SettingsView.tsx',
  'utf8',
);
const settingsStore = readFileSync('apps/desktop/src/features/settings/store.ts', 'utf8');
const relaySection = readFileSync(
  'apps/desktop/src/features/settings/components/RelaySection.tsx',
  'utf8',
);
const transitions = readFileSync(
  'apps/desktop/src/features/settings/components/AccessTransitions.tsx',
  'utf8',
);
const doubao = readFileSync(
  'apps/desktop/src/features/settings/components/DoubaoSection.tsx',
  'utf8',
);
const account = [
  readFileSync('apps/desktop/src/features/settings/components/AccountSection.tsx', 'utf8'),
  readFileSync('apps/desktop/src/features/settings/components/AccountSignedInPanel.tsx', 'utf8'),
].join('\n');
const providers = [
  readFileSync('apps/desktop/src/features/settings/components/ProvidersSection.tsx', 'utf8'),
  // RELAY-SETTINGS-UI 第二步:「设为默认」收进 master-detail 详情面板头部
  readFileSync('apps/desktop/src/features/settings/components/ProviderDetailPanel.tsx', 'utf8'),
].join('\n');
const agentConnections = [
  readFileSync('apps/desktop/src/features/settings/components/AiConnectionsSection.tsx', 'utf8'),
  readFileSync('apps/desktop/src/features/settings/components/AiConnectionDetailPanel.tsx', 'utf8'),
].join('\n');
const accountSwitch = readFileSync(
  'apps/desktop/src/features/settings/account-source-switch.ts',
  'utf8',
);
const doubaoBrowser = readFileSync('apps/desktop/electron/doubao-web/browser-service.ts', 'utf8');

describe('AI access identity menu and sidebar contract', () => {
  it('moves access-mode selection into the sidebar identity menu (v2 设置整合)', () => {
    // AccessModeSection 已删除；接入模式由左下角身份菜单隐式切换
    expect(settings).not.toContain('AccessModeSection');
    expect(settings).toContain("id: 'account'");
    expect(settings).toContain("id: 'relay'");
    expect(sidebar).toContain('<SidebarAccessSwitcher />');
    // 账号与中转站在同一个身份菜单里跨模式互切
    expect(switcher).toContain('data-testid="identity-switcher"');
    expect(switcher).toContain('account-source-option-${account.source}');
    expect(switcher).toContain('relay-model-option-${provider.id}');
  });

  it('uses shared dropdown semantics for both sidebar access menus', () => {
    expect(switcher).toContain('<DropdownMenu modal={false}');
    expect(switcher).toContain('<DropdownMenuTrigger asChild>');
    expect(switcher).toContain('<DropdownMenuContent');
    expect(switcher).toContain('<DropdownMenuLabel>生图账号</DropdownMenuLabel>');
    expect(switcher).toContain('<DropdownMenuSeparator />');
    expect(switcher).toContain('side="top"');
    expect(switcher).toContain('w-[292px]');
    expect(switcher).toContain('w-[220px]');
    expect(switcher).toContain('void chooseRelayProvider(provider.id)');
    expect(switcher).toContain('onCloseAutoFocus={(event) => {');
    expect(switcher).toContain('identityTriggerRef.current?.focus()');
    expect(switcher).toContain('settingsTriggerRef.current?.focus()');
    expect(overlays).toContain('border-radius: var(--radius-lg);');
    expect(overlays).toContain('z-index: 75;');
    expect(switcher).not.toContain('createPortal');
    expect(switcher).not.toContain('document.addEventListener');
    expect(switcher).not.toContain('menuAnchor');
    expect(switcher).not.toContain('settingsAnchor');
  });

  it('lets the identity menu switch between Doubao and the official account', () => {
    expect(switcher).toContain("onChoose: () => beginAccountSwitch('doubao')");
    expect(switcher).toContain("onChoose: () => beginAccountSwitch('official')");
    expect(switcher).toContain('<AccountIdentityTransition');
    expect(switcher).toContain('switchAccountSource(identityTransition.to.source)');
    // 未登录账号不再禁用：点击直达设置的账号分区去登录
    expect(switcher).toContain("'未登录 · 点击去登录'");
    expect(switcher).toContain("openSettingsAt('account')");
  });

  it('uses a lighter identity handoff animation for Doubao/official switches', () => {
    expect(transitions).toContain('data-testid="account-identity-transition"');
    expect(transitions).toContain('bg-background/80 backdrop-blur-sm');
    expect(transitions).toContain('bg-accent will-change-transform');
    expect(transitions).toContain("duration: 0.62, ease: 'power2.inOut'");
    expect(transitions).toContain('swapPromiseRef.current ??= onSwap()');
    // v2 设置整合：全屏模式切换动画随 AccessModeSection 一并移除
    expect(transitions).not.toContain('ai-access-transition');
  });

  it('validates target channels before activation', () => {
    // 账号目标：switchAccountSource 内验证并回滚
    expect(accountSwitch).toContain('refreshQuota()');
    expect(accountSwitch).toContain('generation.testProvider(officialProvider.id)');
    expect(accountSwitch).toContain('connections.validate(officialConnection.id)');
    expect(accountSwitch).toContain('Promise.allSettled');
    // 中转站目标：先测生图通道；从账号模式跨入时连 Agent 通道一起验证
    expect(switcher).toContain('await testProvider(providerId)');
    expect(switcher).toContain('preferredByokEntry(stationConnections)');
    expect(switcher).toContain('connectionState.validate(targetConnection.id)');
  });

  it('shows relay station and model in the sidebar and switches image models there', () => {
    expect(switcher).toContain("'sidebar-relay-name'");
    expect(switcher).toContain("'sidebar-relay-model'");
    expect(switcher).toContain('data-testid="sidebar-doubao-avatar"');
    expect(switcher).toContain("'sidebar-doubao-remaining'");
    expect(switcher).toContain("'sidebar-official-account'");
    expect(switcher).toContain('chooseRelayProvider(provider.id)');
    expect(switcher).toContain('data-testid="relay-model-manage"');
  });

  it('keeps the merged relay section tabbed and deep-link compatible', () => {
    expect(relaySection).toContain('ProvidersRelayPanel');
    expect(relaySection).toContain('AiConnectionsRelayPanel');
    expect(relaySection).toContain('testIdPrefix="relay-tab"');
    expect(settingsStore).toContain(
      "relayTab: input === 'providers' || input === 'ai' ? input : state.relayTab",
    );
  });

  it('does not let configuration and login bypass the access-mode switch', () => {
    expect(doubao).not.toContain('await setActive(id)');
    expect(doubao).toContain('登录与验证不会改变当前接入模式');
    expect(providers).toContain('relayMode && !isActive');
    expect(agentConnections).toContain('relayMode && !connection.isActive');
  });

  it('keeps the compact app menu beside the access identity', () => {
    expect(switcher).toContain('data-testid="sidebar-settings-menu"');
    expect(switcher).toContain("petEnabled ? '隐藏桌宠' : '显示桌宠'");
    expect(switcher).toContain('data-testid="sidebar-settings-open"');
  });

  it('keeps the two official account models read-only', () => {
    expect(account).toContain('ACCOUNT_DEFAULT_IMAGE_MODEL');
    expect(account).toContain('ACCOUNT_DEFAULT_TEXT_MODEL');
    expect(account).toContain('account-managed-models');
  });

  it('keeps the Doubao browser hidden unless the foreground switch is enabled', () => {
    expect(doubao).toContain('label="豆包前台"');
    // v1.4.1：开关经共享 SettingsSwitch 的 testId 属性下发 data-testid
    expect(doubao).toContain('testId="settings-doubao-developer-toggle"');
    expect(doubao).toContain('豆包在后台隐藏运行');
    expect(doubao).toContain('恢复后台运行');
    expect(settingsStore).toContain('doubaoForeground: false');
    expect(settingsStore).not.toContain('DOUBAO_DEVELOPER_MODE_KEY');
    expect(doubaoBrowser).toContain('let developerWindowVisible = false;');
    expect(doubaoBrowser).toContain('if (!developerWindowVisible && win.isVisible()) win.hide();');
    expect(doubaoBrowser).toContain('const win = await ensureImagePage(true);');
  });
});
