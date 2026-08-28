import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DropdownMenu, DropdownMenuContent } from '@musefold/legacy-ui';
import {
  ProductSidebarIdentityMenuContent,
  ProductSidebarSettingsMenuContent,
} from '../ProductSidebarMenus';

function renderMenu(content: ReactNode) {
  return renderToStaticMarkup(
    <DropdownMenu open>
      <DropdownMenuContent>{content}</DropdownMenuContent>
    </DropdownMenu>,
  );
}

describe('ProductSidebarMenus', () => {
  it('renders account identities as an accessible radio group', () => {
    const html = renderMenu(
      <ProductSidebarIdentityMenuContent
        title="未像用户"
        detail="186 积分"
        accounts={[
          {
            id: 'cloud',
            name: '未像用户',
            detail: '186 积分',
            active: true,
            avatar: <span>未</span>,
            onSelect: () => undefined,
            testId: 'account-source-option-cloud',
          },
          {
            id: 'secondary',
            name: '备用账号',
            detail: '未连接',
            active: false,
            avatar: <span>备</span>,
            onSelect: () => undefined,
            testId: 'account-source-option-secondary',
          },
        ]}
        actions={[
          {
            label: '账号设置',
            onSelect: () => undefined,
            testId: 'identity-account-settings',
          },
          {
            label: '退出登录',
            onSelect: () => undefined,
            tone: 'danger',
            testId: 'identity-account-logout',
          },
        ]}
      />,
    );

    expect(html).toContain('aria-label="可用生图身份"');
    expect(html).toContain('role="group" aria-label="生图账号"');
    expect(html).toContain('data-testid="account-source-option-cloud"');
    expect(html).toContain('data-testid="account-source-option-secondary"');
    expect(html).toContain('role="menuitemradio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('data-testid="identity-account-settings"');
    expect(html).toContain('data-testid="identity-account-logout"');
    expect(html).toContain('data-tone="danger"');
  });

  it('renders relay state, loading feedback, and an empty configuration action', () => {
    const relayHtml = renderMenu(
      <ProductSidebarIdentityMenuContent
        title="未像用户"
        detail="186 积分"
        accounts={[]}
        relayProviders={[
          {
            id: 'relay-1',
            name: '本地中转站',
            modelLabel: 'Flux Schnell',
            icon: <span>R</span>,
            active: true,
            pending: false,
            onSelect: () => undefined,
            testId: 'relay-model-option-relay-1',
          },
          {
            id: 'relay-2',
            name: '连接中转站',
            modelLabel: '等待验证',
            active: false,
            pending: true,
            onSelect: () => undefined,
            testId: 'relay-model-option-relay-2',
          },
        ]}
      />,
    );

    expect(relayHtml).toContain('role="group" aria-label="生图中转站"');
    expect(relayHtml).toContain('data-testid="relay-model-option-relay-1"');
    expect(relayHtml).toContain('data-testid="relay-model-option-relay-2"');
    expect(relayHtml).toContain('aria-checked="true"');
    expect(relayHtml).toContain('data-disabled=""');
    expect(relayHtml).toContain(
      'class="lucide lucide-loader-circle h-3.5 w-3.5 animate-spin text-tertiary"',
    );

    const emptyHtml = renderMenu(
      <ProductSidebarIdentityMenuContent
        title="未像用户"
        detail="186 积分"
        accounts={[]}
        relayEmptyAction={{
          label: '配置生图中转站',
          detail: '添加可用模型',
          onSelect: () => undefined,
          testId: 'relay-model-configure',
        }}
      />,
    );

    expect(emptyHtml).toContain('data-testid="relay-model-configure"');
    expect(emptyHtml).toContain('配置生图中转站');
    expect(emptyHtml).toContain('添加可用模型');
  });

  it('keeps the settings menu as a host-provided action list', () => {
    const html = renderMenu(
      <ProductSidebarSettingsMenuContent
        appName="Musefold"
        items={[
          {
            label: '应用设置',
            icon: <span aria-hidden="true">S</span>,
            onSelect: () => undefined,
            testId: 'sidebar-settings-open',
          },
        ]}
      />,
    );

    expect(html).toContain('class="mf-sidebar-menu-header"');
    expect(html).toContain('Musefold');
    expect(html).toContain('class="mf-sidebar-menu-actions"');
    expect(html).toContain('data-testid="sidebar-settings-open"');
    expect(html).toContain('应用设置');
  });
});
