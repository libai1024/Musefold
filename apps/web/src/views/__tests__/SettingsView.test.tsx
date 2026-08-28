import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getProductCapabilities } from '@musefold/domain';
import { musefoldQueryKeys } from '@musefold/product-ui';
import type { AccountSummary, McpConnectionPage, WorkbenchSessionPage } from '@musefold/contracts';
import { WebSettingsView } from '../SettingsView';

const account: AccountSummary = {
  id: 'account-1',
  username: 'musefold',
  displayName: '未像用户',
  quota: 9_300_000,
  quotaUnit: '点',
  canGenerate: true,
};

const connections: McpConnectionPage = { items: [] };
const gateway = {
  listWorkbenchSessions: async () => ({ items: [], nextCursor: null }) as WorkbenchSessionPage,
} as never;

function renderSettings(section: Parameters<typeof WebSettingsView>[0]['section'] = 'account') {
  return renderToStaticMarkup(
    <WebSettingsView
      section={section}
      onSectionChange={() => undefined}
      onBack={() => undefined}
      gateway={gateway}
      account={account}
      capabilities={getProductCapabilities('web')}
      dataSourceLabel="Musefold Cloud"
      onRedeem={async () => 0}
      onRefresh={async () => undefined}
      redeemBusy={false}
      refreshBusy={false}
      connections={connections}
      connectionsLoading={false}
      connectionsError={null}
      onConnectionsChange={() => undefined}
      onLogout={async () => undefined}
    />,
  );
}

describe('WebSettingsView', () => {
  it('exposes the complete eight-section settings information architecture', () => {
    const html = renderSettings();
    for (const label of [
      '账号',
      '中转站',
      '偏好',
      '开放能力',
      '使用统计',
      '数据存储',
      '关于 App',
      '已归档聊天',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('data-testid="web-settings-workspace"');
    expect(html).toContain('data-testid="settings-section-account"');
    expect(html).not.toContain('已连接应用');
  });

  it('keeps the official relay and constrained agent copy on Web', () => {
    expect(renderSettings('relay')).toContain('data-active="true"');
    expect(renderSettings('relay')).toContain('官方 Agent 能力正在逐步开放');
    expect(renderSettings('relay')).toContain('不会写入提示词、执行生图、访问本地文件');
  });

  it('places Cloud MCP under open capabilities and reports its host boundary', () => {
    const available = renderSettings('open');
    expect(available).toContain('Cloud MCP 授权');
    expect(available).toContain('还没有连接 AI 客户端');

    const unavailable = renderToStaticMarkup(
      <WebSettingsView
        section="open"
        onSectionChange={() => undefined}
        onBack={() => undefined}
        gateway={gateway}
        account={account}
        capabilities={{ ...getProductCapabilities('web'), cloudMcpConnections: false }}
        dataSourceLabel="Musefold Cloud"
        onRedeem={async () => 0}
        onRefresh={async () => undefined}
        redeemBusy={false}
        refreshBusy={false}
        connections={connections}
        connectionsLoading={false}
        connectionsError={null}
        onConnectionsChange={() => undefined}
        onLogout={async () => undefined}
      />,
    );
    expect(unavailable).toContain('Cloud MCP 当前不可用');
  });

  it('renders the archived chat empty state from the Web workbench query', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      musefoldQueryKeys.workbench.list({ limit: 100, includeArchived: true }),
      { items: [], nextCursor: null },
    );
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <WebSettingsView
          section="archived"
          onSectionChange={() => undefined}
          onBack={() => undefined}
          gateway={gateway}
          account={account}
          capabilities={getProductCapabilities('web')}
          dataSourceLabel="Musefold Cloud"
          onRedeem={async () => 0}
          onRefresh={async () => undefined}
          redeemBusy={false}
          refreshBusy={false}
          connections={connections}
          connectionsLoading={false}
          connectionsError={null}
          onConnectionsChange={() => undefined}
          onLogout={async () => undefined}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain('还没有已归档聊天');
    expect(html).toContain('data-testid="web-settings-archived-empty"');
  });

  it('shows explicit Web host boundary states for desktop-only sections', () => {
    expect(renderSettings('preferences')).toContain('此能力属于 Desktop 宿主范围');
    expect(renderSettings('usage')).toContain('Web 统计看板尚未接入独立的云端统计接口');
    expect(renderSettings('data')).toContain('Web 不提供 SQLite 路径');
    expect(renderSettings('about')).toContain('不会显示或安装 Electron 更新');
  });
});
