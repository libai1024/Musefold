import { useState } from 'react';
import {
  Archive,
  ArrowLeft,
  BarChart3,
  Blocks,
  Database,
  HardDrive,
  LayoutGrid,
  Palette,
  Server,
  SlidersHorizontal,
  UserRound,
} from '../../../components/ui/icons';
import { SettingsWorkspace, type SettingsNavigationGroup } from '@musefold/product-ui';
import { useAppStore } from '../../../stores/app';
import { useSettingsStore, type SettingsSection } from '../store';
import { RelaySection } from './RelaySection';
import { AccountSettingsSection } from './AccountSettingsSection';
import { PreferencesSection } from './PreferencesSection';
import { OpenCapabilitiesSection } from './OpenCapabilitiesSection';
import { DataAndAboutSection } from './DataAndAboutSection';
import { ArchivedChatsSection } from './ArchivedChatsSection';
import { UsageStatisticsSection } from './UsageStatisticsSection';
import {
  SETTINGS_SECTION_CAPABILITY,
  isCapabilityEntryVisible,
} from '../../../runtime/capabilities';

interface DesktopSettingsNavigationItem {
  id: SettingsSection;
  label: string;
  icon: JSX.Element;
  keywords: readonly string[];
}

interface DesktopSettingsNavigationGroup extends Omit<SettingsNavigationGroup, 'items'> {
  items: readonly DesktopSettingsNavigationItem[];
}

// v2 设置整合：12 个旧分区重组为 7 个任务分区；旧 key 继续兼容深链。
const NAV_GROUPS: readonly DesktopSettingsNavigationGroup[] = [
  {
    id: 'access',
    label: '账户与接入',
    icon: <LayoutGrid />,
    items: [
      {
        id: 'account',
        label: '账号',
        icon: <UserRound />,
        keywords: ['登录', '注册', '积分', '云同步', '豆包', '体验通道', '扫码', '兑换码', '服务器'],
      },
      {
        id: 'relay',
        label: '中转站',
        icon: <Server />,
        keywords: ['服务商', 'API Key', '模型', '网关', '文本模型', 'Agent', '生图'],
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
        keywords: ['比例', '质量', '背景', '数量', '方案优先级', '主题', '深色', '浅色', '动效', '密度'],
      },
      {
        id: 'open',
        label: '开放能力',
        icon: <Blocks />,
        keywords: ['本地控制面', 'Token', '预算', 'CLI', 'Skill', 'Cloud MCP', '授权'],
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
        keywords: ['用量', '统计', '积分', '渠道', '成本', '模型', '趋势', '成功率'],
      },
      {
        id: 'data',
        label: '数据与关于',
        icon: <HardDrive />,
        keywords: ['导入', '导出', '备份', '路径', '日志', '重置', '版本', '更新', '文档', '许可', '快捷键'],
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

const VISIBLE_NAV_GROUPS: SettingsNavigationGroup[] = NAV_GROUPS.map((group) => ({
  ...group,
  items: group.items.filter((item) =>
    isCapabilityEntryVisible(SETTINGS_SECTION_CAPABILITY, item.id),
  ),
})).filter((group) => group.items.length > 0);

const SECTIONS: Record<SettingsSection, () => JSX.Element> = {
  account: AccountSettingsSection,
  relay: RelaySection,
  preferences: PreferencesSection,
  open: OpenCapabilitiesSection,
  usage: UsageStatisticsSection,
  data: DataAndAboutSection,
  archived: ArchivedChatsSection,
};

export function SettingsView() {
  const section = useSettingsStore((state) => state.section);
  const setSection = useSettingsStore((state) => state.setSection);
  const setView = useAppStore((state) => state.setView);
  const [search, setSearch] = useState('');
  const ActiveSection = SECTIONS[section];

  return (
    <SettingsWorkspace
      className="settings-view"
      testId="settings-workspace"
      groups={VISIBLE_NAV_GROUPS}
      activeSection={section}
      onSectionChange={(nextSection) => setSection(nextSection as SettingsSection)}
      searchValue={search}
      onSearchChange={setSearch}
      headerAction={
        <button
          type="button"
          className="mf-settings-header-action-button"
          onClick={() => setView('generate')}
        >
          <ArrowLeft aria-hidden="true" />
          返回工作区
        </button>
      }
    >
      <div className="mf-settings-content">
        <ActiveSection />
      </div>
    </SettingsWorkspace>
  );
}
