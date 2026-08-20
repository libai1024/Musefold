import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebar = readFileSync('apps/desktop/src/components/layout/Sidebar.tsx', 'utf8');
const switcher = readFileSync('apps/desktop/src/components/layout/SidebarAccessSwitcher.tsx', 'utf8');
const settings = readFileSync('apps/desktop/src/features/settings/components/SettingsView.tsx', 'utf8');
const access = readFileSync('apps/desktop/src/features/settings/components/AccessModeSection.tsx', 'utf8');
const transitions = readFileSync('apps/desktop/src/features/settings/components/AccessTransitions.tsx', 'utf8');
const doubao = readFileSync('apps/desktop/src/features/settings/components/DoubaoSection.tsx', 'utf8');
const account = readFileSync('apps/desktop/src/features/settings/components/AccountSection.tsx', 'utf8');
const providers = readFileSync('apps/desktop/src/features/settings/components/ProvidersSection.tsx', 'utf8');
const agentConnections = readFileSync('apps/desktop/src/features/settings/components/AiConnectionsSection.tsx', 'utf8');
const accountSwitch = readFileSync('apps/desktop/src/features/settings/account-source-switch.ts', 'utf8');
const settingsStore = readFileSync('apps/desktop/src/features/settings/store.ts', 'utf8');
const doubaoBrowser = readFileSync('apps/desktop/electron/doubao-web/browser-service.ts', 'utf8');

describe('AI access settings and sidebar contract', () => {
  it('keeps access-mode selection in Settings', () => {
    expect(settings).toContain("{ key: 'access', label: 'AI 接入' }");
    expect(settings).toContain('access: AccessModeSection');
    expect(access).toContain('data-testid={`settings-access-mode-${mode}`}');
    expect(sidebar).toContain('<SidebarAccessSwitcher />');
  });

  it('lets account mode switch between Doubao and the official account', () => {
    expect(access).toContain('data-testid="settings-account-source-picker"');
    expect(access).toContain('source="doubao"');
    expect(access).toContain('source="official"');
    expect(access).toContain('<AccountIdentityTransition');
    expect(access).toContain("activateTarget('account', identityTransition.to.source)");
  });

  it('uses the full-screen transition only for account/relay mode changes', () => {
    expect(transitions).toContain('data-testid="ai-access-transition"');
    expect(transitions).toContain('className="fixed inset-0 z-[220]"');
    expect(transitions).toContain('scale-y-0 bg-sidebar');
    expect(transitions).toContain("duration: 3.2, ease: 'power1.inOut'");
    expect(transitions).toContain('prefers-reduced-motion: reduce');
    expect(access).toContain('<AccessModeTransition');
  });

  it('uses a lighter identity handoff animation for Doubao/official switches', () => {
    expect(transitions).toContain('data-testid="account-identity-transition"');
    expect(transitions).toContain('bg-background/80 backdrop-blur-sm');
    expect(transitions).toContain('bg-accent will-change-transform');
    expect(transitions).toContain("duration: 0.62, ease: 'power2.inOut'");
    expect(transitions).toContain('swapPromiseRef.current ??= onSwap()');
  });

  it('validates all required target channels before activation', () => {
    const activation = access.slice(access.indexOf('const activateTarget'), access.indexOf('const chooseMode'));
    expect(activation).toContain('verifyAiAccessConnectivity');
    expect(activation).toContain('testProvider(relayProvider.id)');
    expect(activation).toContain('validateConnection(relayConnection.id)');
    expect(activation).toContain('Promise.allSettled');
    expect(accountSwitch).toContain('refreshQuota()');
    expect(accountSwitch).toContain('generation.testProvider(officialProvider.id)');
    expect(accountSwitch).toContain('connections.validate(officialConnection.id)');
    expect(accountSwitch).toContain('Promise.allSettled');
  });

  it('switches account identity from the sidebar with the Settings animation', () => {
    expect(switcher).not.toContain("openSettingsAt('access')");
    expect(switcher).toContain("data-testid={mode === 'account' ? 'account-source-switcher'");
    expect(switcher).toContain('account-source-option-${account.source}');
    expect(switcher).toContain('beginAccountSwitch(account.source)');
    expect(switcher).toContain('<AccountIdentityTransition');
    expect(switcher).toContain('switchAccountSource(identityTransition.to.source)');
    expect(switcher).toContain('data-testid="sidebar-doubao-avatar"');
    expect(switcher).toContain("'sidebar-doubao-remaining'");
    expect(switcher).toContain("'sidebar-official-account'");
  });

  it('shows relay station and model in the sidebar and switches image models there', () => {
    expect(switcher).toContain("'sidebar-relay-name'");
    expect(switcher).toContain("'sidebar-relay-model'");
    expect(switcher).toContain("'relay-model-switcher'");
    expect(switcher).toContain('chooseRelayProvider(provider.id)');
    expect(switcher).toContain('await testProvider(providerId)');
  });

  it('does not let configuration and login bypass the access-mode switch', () => {
    expect(doubao).not.toContain('await setActive(id)');
    expect(doubao).toContain('登录与验证不会改变当前接入模式');
    expect(providers).toContain('relayMode && !active');
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

  it('keeps the Doubao browser hidden unless developer mode is enabled', () => {
    expect(doubao).toContain('label="开发者选项"');
    expect(doubao).toContain('data-testid="settings-doubao-developer-toggle"');
    expect(doubao).toContain('豆包在后台运行，不显示网页窗口');
    expect(doubao).toContain('每次启动均保持关闭');
    expect(settingsStore).toContain('doubaoDeveloperMode: false');
    expect(settingsStore).not.toContain('DOUBAO_DEVELOPER_MODE_KEY');
    expect(doubaoBrowser).toContain('let developerWindowVisible = false;');
    expect(doubaoBrowser).toContain('if (!developerWindowVisible && win.isVisible()) win.hide();');
    expect(doubaoBrowser).toContain('const win = await ensureImagePage(true);');
  });
});
