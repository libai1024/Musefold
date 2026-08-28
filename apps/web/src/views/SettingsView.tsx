import { useState } from 'react';
import {
  Archive,
  ArrowLeft,
  BarChart3,
  Blocks,
  Database,
  HardDrive,
  Info,
  LayoutGrid,
  Palette,
  Server,
  SlidersHorizontal,
  UserRound,
} from '@musefold/ui/icons';
import {
  SettingsSection,
  SettingsWorkspace,
  type SettingsNavigationGroup,
} from '@musefold/product-ui';
import type { AccountSummary, McpConnectionPage } from '@musefold/contracts';
import type { ProductCapabilities } from '@musefold/domain';
import type { WebGateway } from '../runtime';
import { AccountView } from './AccountView';
import { ConnectionsView } from './ConnectionsView';
import {
  WebArchivedChatsSection,
  WebDataStatusCard,
  WebOpenSection,
  WebRelaySection,
  WebUnavailableSection,
} from './WebSettingsSections';

import type { WebSettingsSection } from './settings-types';

export type { WebSettingsSection } from './settings-types';

const WEB_SETTINGS_GROUPS: SettingsNavigationGroup[] = [
  {
    id: 'access',
    label: '账户与接入',
    icon: <LayoutGrid />,
    items: [
      {
        id: 'account',
        label: '账号',
        icon: <UserRound />,
        keywords: ['账户', '积分', '额度', '退出登录'],
      },
      {
        id: 'relay',
        label: '中转站',
        icon: <Server />,
        keywords: ['官方模型', 'Agent', 'Skills', '生图'],
      },
    ],
  },
  {
    id: 'general',
    label: '通用',
    icon: <SlidersHorizontal />,
    items: [
      {
        id: 'preferences',
        label: '偏好',
        icon: <Palette />,
        keywords: ['比例', '质量', '背景', '数量', '主题', '动效', '密度'],
      },
      {
        id: 'open',
        label: '开放能力',
        icon: <Blocks />,
        keywords: ['Cloud MCP', '授权', '客户端', '只读'],
      },
    ],
  },
  {
    id: 'application',
    label: '数据与应用',
    icon: <Database />,
    items: [
      {
        id: 'usage',
        label: '使用统计',
        icon: <BarChart3 />,
        keywords: ['用量', '统计', '积分', '成本', '模型'],
      },
      {
        id: 'data',
        label: '数据存储',
        icon: <HardDrive />,
        keywords: ['导入', '导出', '备份', '下载', '上传'],
      },
      {
        id: 'about',
        label: '关于 App',
        icon: <Info />,
        keywords: ['版本', '文档', '反馈', '许可', '支持'],
      },
      {
        id: 'archived',
        label: '已归档聊天',
        icon: <Archive />,
        keywords: ['恢复聊天', '删除聊天'],
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
  capabilities,
  dataSourceLabel,
  onRedeem,
  onRefresh,
  redeemBusy,
  refreshBusy,
  connections,
  connectionsLoading,
  connectionsError,
  onConnectionsChange,
  onLogout,
}: {
  section: WebSettingsSection;
  onSectionChange: (section: WebSettingsSection) => void;
  onBack: () => void;
  gateway: WebGateway;
  account: AccountSummary;
  capabilities: Readonly<ProductCapabilities>;
  dataSourceLabel: string;
  onRedeem: (code: string) => Promise<number>;
  onRefresh: () => Promise<unknown>;
  redeemBusy: boolean;
  refreshBusy: boolean;
  connections: McpConnectionPage;
  connectionsLoading: boolean;
  connectionsError: string | null;
  onConnectionsChange: (next: McpConnectionPage) => void;
  onLogout: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');

  return (
    <SettingsWorkspace
      className="web-settings-view"
      testId="web-settings-workspace"
      groups={WEB_SETTINGS_GROUPS}
      activeSection={section}
      onSectionChange={(next) => onSectionChange(next as WebSettingsSection)}
      searchValue={search}
      onSearchChange={setSearch}
      headerAction={(
        <button type="button" className="mf-settings-header-action-button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          返回工作区
        </button>
      )}
    >
      <div className="mf-settings-content">
        {section === 'account' ? (
          <SettingsSection title="账户" description="Musefold Cloud 账号与生图额度">
            <AccountView
              account={account}
              dataSourceLabel={dataSourceLabel}
              onRedeem={onRedeem}
              onRefresh={onRefresh}
              onLogout={onLogout}
              redeemBusy={redeemBusy}
              refreshBusy={refreshBusy}
              embedded
              showHeading={false}
            />
          </SettingsSection>
        ) : null}
        {section === 'relay' ? <WebRelaySection capabilities={capabilities} /> : null}
        {section === 'preferences' ? (
          <WebUnavailableSection
            title="偏好"
            description="Web 工作台使用浏览器环境与云端生成参数。"
            cardTitle="工作台偏好"
            cardDescription="Web 当前不保存桌面专属的本地 Provider、窗口或系统外观配置。"
            icon={<Palette className="mt-0.5 text-secondary" aria-hidden="true" />}
            testId="web-settings-preferences"
          />
        ) : null}
        {section === 'open' ? (
          <WebOpenSection
            gateway={gateway}
            connections={connections}
            connectionsLoading={connectionsLoading}
            connectionsError={connectionsError}
            cloudMcpAvailable={capabilities.cloudMcpConnections}
            onConnectionsChange={onConnectionsChange}
          />
        ) : null}
        {section === 'usage' ? (
          <WebUnavailableSection
            title="使用统计"
            description="生成记录和账号额度可在工作台与历史中查看。"
            cardTitle="云端统计"
            cardDescription="Web 统计看板尚未接入独立的云端统计接口。"
            icon={<BarChart3 className="mt-0.5 text-secondary" aria-hidden="true" />}
            testId="web-settings-usage"
          />
        ) : null}
        {section === 'data' ? <WebDataStatusCard /> : null}
        {section === 'about' ? (
          <WebUnavailableSection
            title="关于 App"
            description="查看 Musefold Web 的支持边界与服务信息。"
            cardTitle="Musefold Web"
            cardDescription="版本更新由 Web 发布流程完成，浏览器不会显示或安装 Electron 更新。"
            icon={<Info className="mt-0.5 text-secondary" aria-hidden="true" />}
            testId="web-settings-about"
          />
        ) : null}
        {section === 'archived' ? <WebArchivedChatsSection gateway={gateway} /> : null}
      </div>
    </SettingsWorkspace>
  );
}

export { ConnectionsView };
