import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WebSidebarAccessSwitcher } from '../WebSidebarAccessSwitcher';

const switcherSource = readFileSync(
  new URL('../WebSidebarAccessSwitcher.tsx', import.meta.url),
  'utf8',
);

function renderSwitcher(overrides: Partial<Parameters<typeof WebSidebarAccessSwitcher>[0]> = {}) {
  return renderToStaticMarkup(
    <WebSidebarAccessSwitcher
      accountName="未像用户"
      quotaLabel="186 积分"
      accountReady
      settingsActive={false}
      onOpenSettings={() => undefined}
      onOpenAccountSettings={() => undefined}
      onLogout={async () => undefined}
      {...overrides}
    />,
  );
}

describe('WebSidebarAccessSwitcher', () => {
  it('keeps the Desktop footer contract while limiting Web to the Cloud identity', () => {
    const html = renderSwitcher();

    expect(html).toContain('class="web-sidebar-access-footer"');
    expect(html).toContain('data-testid="provider-quick-switch"');
    expect(html).toContain('data-identity-switcher');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('未像用户');
    expect(html).toContain('186 积分');
    expect(html).toContain('data-testid="sidebar-settings"');
    expect(html).toContain('data-sidebar-settings-menu');
    expect(html).toContain('aria-label="打开应用菜单"');
    expect(html).toContain('title="设置"');
    expect(switcherSource).toContain('data-testid="identity-switcher"');
    expect(switcherSource).toContain('ProductSidebarIdentityMenuContent');
    expect(switcherSource).toContain('ProductSidebarSettingsMenuContent');
    expect(switcherSource).toContain("testId: 'account-source-option-cloud'");
    expect(switcherSource).toContain("testId: 'identity-account-settings'");
    expect(switcherSource).toContain("testId: 'identity-account-logout'");
    expect(switcherSource).toContain('data-testid="sidebar-settings-menu"');
    expect(switcherSource).toContain("testId: 'sidebar-settings-open'");
    expect(switcherSource).not.toContain('relayProviders');
    expect(switcherSource).not.toContain('豆包');
    expect(switcherSource).not.toContain('桌宠');
    expect(switcherSource).not.toContain('BYOK');
  });

  it('keeps the settings trigger active while rendering settings', () => {
    const html = renderSwitcher({ settingsActive: true });

    expect(html).toContain('bg-pressed');
    expect(html).toContain('data-testid="sidebar-settings"');
  });
});
