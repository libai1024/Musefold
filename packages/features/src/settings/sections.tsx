import type { PlatformCapabilities } from '@musefold/platform';
import {
  CloudUpload,
  Database,
  Info,
  type LucideIcon,
  Palette,
  Plug,
  UserRound,
} from '@musefold/ui/icons';
import type { ReactNode } from 'react';
import { AccountPanel } from '../account/AccountPanel';
import { AgentConnectionsPanel } from '../account/AgentConnectionsPanel';
import { AiConnectionsPanel } from '../account/AiConnectionsPanel';
import { CloudSyncPanel } from '../account/CloudSyncPanel';
import { DoubaoConnectionPanel } from '../account/DoubaoConnectionPanel';
import type { ScreenIntent } from '../shell/screen-intent-store';
import { AboutCard } from './AboutCard';
import { AppearanceCard } from './AppearanceCard';
import { DataStorageCard } from './DataStorageCard';
import { GenerationDefaultsCard } from './GenerationDefaultsCard';

/**
 * 设置分区注册表(V25-UI-SPEC §6.2)—— 设置页的唯一目录。
 *
 * 新增一个设置项的走线(详见 V25-FEATURE-DEV-GUIDE §8-C):
 * 1. 属于已有分区:在该分区的 `render` 里加一张 Card(或在既有卡内加一行控件);
 * 2. 需要新分区:往 `SETTINGS_SECTIONS` 追加一条定义 —— 分组 / 标题 / 描述 / 图标 / 搜索关键词 /
 *    capability 门(`isAvailable`,宿主不具备即整个分区不注册,D2 无死入口)/ 深链意图(`intents`);
 * 3. 同步 UI 规范 §6.2 表格与就地测试;宿主无需改动 —— 导航、搜索、深链、记忆由 SettingsScreen 统一承载。
 *
 * 纪律:分区只做编排(挑卡、排卡),数据面在各卡自己的 hooks 里;不在这里 import 宿主或探测 UA。
 */

export type SettingsGroupId = 'general' | 'access' | 'app';

export interface SettingsGroupDefinition {
  id: SettingsGroupId;
  title: string;
}

/** 分组顺序即导航顺序(承旧 SettingsWorkspace 目录:通用 → 访问 → 应用)。 */
export const SETTINGS_GROUPS: readonly SettingsGroupDefinition[] = [
  { id: 'general', title: '通用' },
  { id: 'access', title: '访问' },
  { id: 'app', title: '应用' },
];

export type SettingsSectionId =
  | 'appearance'
  | 'account'
  | 'sync'
  | 'connections'
  | 'data'
  | 'about';

export interface SettingsSectionContext {
  capabilities: PlatformCapabilities;
  /** 「数据」分区回收站入口的切屏回调;宿主未接线时该分区不注册。 */
  onOpenScreen?(id: 'prompts' | 'history'): void;
}

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  group: SettingsGroupId;
  title: string;
  description: string;
  icon: LucideIcon;
  /** 搜索命中词(标题、描述之外),写用户会搜的口语词。 */
  keywords: readonly string[];
  /** 能落到本分区的跨屏深链意图(§2.2 侧栏账号菜单等)。 */
  intents: readonly ScreenIntent['kind'][];
  /** 宿主能力门:false 即不注册(不渲染导航项,深链落到兜底分区)。 */
  isAvailable(context: SettingsSectionContext): boolean;
  render(context: SettingsSectionContext): ReactNode;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    id: 'appearance',
    group: 'general',
    title: '外观',
    description: '主题、动效、语言、界面密度与生成默认参数,仅保存在本机',
    icon: Palette,
    keywords: [
      '主题',
      '深色',
      '浅色',
      '动效',
      '语言',
      '密度',
      '比例',
      '质量',
      '默认',
      'theme',
      'motion',
      'density',
    ],
    intents: [],
    isAvailable: () => true,
    render: () => (
      <div className="flex flex-col gap-6">
        <AppearanceCard />
        <GenerationDefaultsCard />
      </div>
    ),
  },
  {
    id: 'account',
    group: 'access',
    title: '账号',
    description: '登录、积分额度与兑换码',
    icon: UserRound,
    keywords: ['登录', '注册', '积分', '额度', '兑换', '退出', 'account'],
    intents: ['settings-account'],
    isAvailable: () => true,
    render: () => (
      <div data-testid="settings-account-anchor">
        <AccountPanel />
      </div>
    ),
  },
  {
    id: 'sync',
    group: 'access',
    title: '云同步',
    description: '提示词、文件夹与标签的跨设备同步(登录后可开启)',
    icon: CloudUpload,
    keywords: ['同步', '云端', '冲突', 'sync'],
    intents: [],
    isAvailable: ({ capabilities }) => capabilities.hasCloudSyncControls,
    render: () => <CloudSyncPanel />,
  },
  {
    id: 'connections',
    group: 'access',
    title: 'AI 连接',
    description: '生图服务、Agent 文本模型与豆包网页通道',
    icon: Plug,
    keywords: ['连接', 'provider', 'api key', '密钥', '模型', 'agent', '豆包', '中转'],
    intents: ['settings-connections'],
    isAvailable: ({ capabilities }) =>
      capabilities.hasLocalAiProviders ||
      capabilities.hasAgentConnections ||
      capabilities.hasDoubaoWebLogin,
    render: ({ capabilities }) => (
      <div className="flex flex-col gap-6" data-testid="settings-connections-anchor">
        {capabilities.hasLocalAiProviders && <AiConnectionsPanel />}
        {/* Agent 文本模型连接(§7.2):设计方案创建/修改所需,与生图连接并列。 */}
        {capabilities.hasAgentConnections && <AgentConnectionsPanel />}
        {/* 豆包免费试用(V25-UI-SPEC §0.2 可达入口):仅桌面宿主渲染。 */}
        {capabilities.hasDoubaoWebLogin && <DoubaoConnectionPanel />}
      </div>
    ),
  },
  {
    id: 'data',
    group: 'app',
    title: '数据',
    description: '回收站、已归档对话,以及本机备份、存储位置、诊断日志与清空数据',
    icon: Database,
    keywords: [
      '回收站',
      '归档',
      '删除',
      '恢复',
      '备份',
      '路径',
      '位置',
      '日志',
      '诊断',
      '清空',
      'trash',
      'archive',
      'backup',
      'log',
    ],
    intents: [],
    isAvailable: ({ onOpenScreen }) => Boolean(onOpenScreen),
    render: ({ onOpenScreen }) =>
      onOpenScreen ? <DataStorageCard onOpenScreen={onOpenScreen} /> : null,
  },
  {
    id: 'about',
    group: 'app',
    title: '关于',
    description: '版本信息、支持资源、第三方声明与快捷键',
    icon: Info,
    keywords: [
      '版本',
      '更新',
      '文档',
      '反馈',
      '快捷键',
      '许可',
      '开源',
      'about',
      'version',
      'shortcut',
      'license',
    ],
    intents: [],
    // 关于卡双端都有(Web 版本行显示「Web 版」),不设 capability 门。
    isAvailable: () => true,
    render: () => <AboutCard />,
  },
];

/** 当前宿主可用的分区(保持注册顺序)。 */
export function availableSettingsSections(
  context: SettingsSectionContext,
): SettingsSectionDefinition[] {
  return SETTINGS_SECTIONS.filter((section) => section.isAvailable(context));
}

/** 深链意图 → 分区;宿主没有目标分区时兜底账号(与 v2.1 侧栏语义一致)。 */
export function sectionForIntent(
  kind: ScreenIntent['kind'],
  sections: readonly SettingsSectionDefinition[],
): SettingsSectionId | null {
  const matched = sections.find((section) => section.intents.includes(kind));
  if (matched) return matched.id;
  return sections.some((section) => section.id === 'account') ? 'account' : null;
}

/** 搜索:标题 / 描述 / 关键词任一包含查询串(不区分大小写);空串 = 全部。 */
export function filterSettingsSections(
  sections: readonly SettingsSectionDefinition[],
  query: string,
): SettingsSectionDefinition[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...sections];
  return sections.filter((section) =>
    [section.title, section.description, ...section.keywords].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  );
}
