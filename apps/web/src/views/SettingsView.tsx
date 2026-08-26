import { useState } from 'react';
import { ArrowLeft, LayoutGrid, Link2, UserRound } from '@musefold/ui/icons';
import {
  SettingsCard,
  SettingsSection,
  SettingsWorkspace,
  type SettingsNavigationGroup,
} from '@musefold/product-ui';
import type { AccountSummary, McpConnectionPage } from '@musefold/contracts';
import type { WebGateway } from '../runtime';
import { AccountView } from './AccountView';
import { ConnectionsView } from './ConnectionsView';

export type WebSettingsSection = 'account' | 'connections';

const WEB_SETTINGS_GROUPS: SettingsNavigationGroup[] = [
  {
    id: 'account-access',
    label: '账户与接入',
    icon: <LayoutGrid />,
    items: [
      {
        id: 'account',
        label: 'Musefold 账号',
        icon: <UserRound />,
        keywords: ['账户', '积分', '额度', '退出登录'],
      },
      {
        id: 'connections',
        label: '已连接应用',
        icon: <Link2 />,
        keywords: ['Cloud MCP', '授权', '预算', '客户端'],
      },
    ],
  },
];

export function WebSettingsView({
  section,
  onSectionChange,
  onBack,
  gateway,
  account,
  connections,
  onConnectionsChange,
  onLoggedOut,
}: {
  section: WebSettingsSection;
  onSectionChange: (section: WebSettingsSection) => void;
  onBack: () => void;
  gateway: WebGateway;
  account: AccountSummary;
  connections: McpConnectionPage;
  onConnectionsChange: (next: McpConnectionPage) => void;
  onLoggedOut: () => void;
}) {
  const [search, setSearch] = useState('');

  return (
    <SettingsWorkspace
      className="web-settings-view"
      groups={WEB_SETTINGS_GROUPS}
      activeSection={section}
      onSectionChange={(next) => onSectionChange(next as WebSettingsSection)}
      searchValue={search}
      onSearchChange={setSearch}
      headerAction={
        <button type="button" className="mf-settings-header-action-button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          返回工作区
        </button>
      }
    >
      <div className="mf-settings-content">
        {section === 'account' ? (
          <SettingsSection title="账户" description="个人账户与生图额度">
            <SettingsCard
              title="Musefold 账号"
              description="查看当前账户、可用额度、生图状态与数据来源"
            >
              <AccountView
                gateway={gateway}
                account={account}
                onLoggedOut={onLoggedOut}
                embedded
                showHeading={false}
              />
            </SettingsCard>
          </SettingsSection>
        ) : (
          <SettingsSection
            title="已连接应用"
            description="管理 AI 客户端访问 Musefold Cloud MCP 的授权、范围和预算。"
          >
            <SettingsCard
              title="Cloud MCP 授权"
              description="控制每个 AI 客户端的访问范围、审批方式与积分预算"
            >
              <ConnectionsView
                gateway={gateway}
                connections={connections}
                onConnectionsChange={onConnectionsChange}
                embedded
                showHeading={false}
              />
            </SettingsCard>
          </SettingsSection>
        )}
      </div>
    </SettingsWorkspace>
  );
}
