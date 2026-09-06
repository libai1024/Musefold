import type { PlatformCapabilities } from '@musefold/platform';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Separator } from '@musefold/ui/components/separator';
import {
  ChevronRight,
  CloudUpload,
  Database,
  History,
  Library,
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
import { useScreenIntent } from '../shell/screen-intent-store';
import { AppearanceCard } from './AppearanceCard';
import { ArchivedSessionsPanel } from './ArchivedSessionsPanel';

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

export type SettingsSectionId = 'appearance' | 'account' | 'sync' | 'connections' | 'data';

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

/**
 * 「数据」分区:回收站入口(经 useScreenIntent 跨屏直达 trash tab)+ 已归档对话列表。
 * 组件化以便在注册表 render 内使用 hook。
 */
function DataSection({
  onOpenScreen,
}: {
  onOpenScreen: NonNullable<SettingsSectionContext['onOpenScreen']>;
}) {
  const setIntent = useScreenIntent((s) => s.setIntent);
  return (
    <Card data-testid="settings-data-card">
      <CardHeader>
        <CardTitle>数据</CardTitle>
        <CardDescription>已删除的内容进入回收站;已归档对话可就地恢复或删除</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pt-0">
        <button
          type="button"
          className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm transition-colors hover:bg-muted"
          data-testid="settings-open-prompt-trash"
          onClick={() => {
            setIntent({ kind: 'prompts-trash' });
            onOpenScreen('prompts');
          }}
        >
          <Library className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1 text-foreground">提示词回收站</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        <button
          type="button"
          className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm transition-colors hover:bg-muted"
          data-testid="settings-open-history-trash"
          onClick={() => {
            setIntent({ kind: 'history-trash' });
            onOpenScreen('history');
          }}
        >
          <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1 text-foreground">生成历史回收站</span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        <Separator className="my-1" />
        <ArchivedSessionsPanel />
      </CardContent>
    </Card>
  );
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    id: 'appearance',
    group: 'general',
    title: '外观',
    description: '主题、动效与语言,仅保存在本机',
    icon: Palette,
    keywords: ['主题', '深色', '浅色', '动效', '语言', 'theme', 'motion'],
    intents: [],
    isAvailable: () => true,
    render: () => <AppearanceCard />,
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
    description: '回收站与已归档对话',
    icon: Database,
    keywords: ['回收站', '归档', '删除', '恢复', 'trash', 'archive'],
    intents: [],
    isAvailable: ({ onOpenScreen }) => Boolean(onOpenScreen),
    render: ({ onOpenScreen }) =>
      onOpenScreen ? <DataSection onOpenScreen={onOpenScreen} /> : null,
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
