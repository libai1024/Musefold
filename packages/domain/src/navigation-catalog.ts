import {
  isCapabilityManifest,
  isHostFeatureAvailable,
  isProductFeatureAvailable,
  type CapabilitySource,
  type HostFeature,
  type MusefoldSurface,
  type ProductCapabilities,
  type ProductFeature,
} from './capabilities';

export type ProductCommandGroup = '快速动作' | '导航' | '操作';

export type ProductShortcutId = 'command-palette' | 'new-design' | 'search' | 'submit' | 'newline';

export interface ProductShortcutSpec {
  id: ProductShortcutId;
  label: string;
  keys: readonly string[];
  modifier: boolean;
}

/** 关于页与全局快捷键共用的声明。⌘K / ⌘N 由命令面板监听；F / Enter 只作展示。 */
export const PRODUCT_SHORTCUTS: readonly ProductShortcutSpec[] = [
  { id: 'command-palette', label: '命令面板', keys: ['K'], modifier: true },
  { id: 'new-design', label: '新建', keys: ['N'], modifier: true },
  { id: 'search', label: '搜索', keys: ['F'], modifier: true },
  { id: 'submit', label: '发送（生成）', keys: ['Enter'], modifier: false },
  { id: 'newline', label: '换行', keys: ['Shift', 'Enter'], modifier: false },
];

export interface ProductNavSpec {
  id: string;
  label: string;
  /** 侧栏 / testid。未列出的宿主不展示该项。Web 提示词库保持 `prompts`（既有 E2E）。 */
  sidebarId: Partial<Record<MusefoldSurface, string>>;
  capability?: Partial<Record<MusefoldSurface, keyof ProductCapabilities>>;
}

export const PRODUCT_NAV_CATALOG: readonly ProductNavSpec[] = [
  {
    id: 'library',
    label: '提示词库',
    sidebarId: { desktop: 'library', web: 'prompts' },
    capability: { desktop: 'localPrompts', web: 'cloudPrompts' },
  },
  {
    id: 'design-schemes',
    label: '设计方案',
    sidebarId: { desktop: 'design-schemes' },
    capability: { desktop: 'designSchemes' },
  },
  {
    id: 'history',
    label: '生成历史',
    sidebarId: { desktop: 'history', web: 'history' },
    capability: { desktop: 'generationHistory', web: 'generationHistory' },
  },
];

export const PRODUCT_VIEW_TITLES: Readonly<Record<string, string>> = {
  generate: '新设计',
  library: '提示词库',
  prompts: '提示词库',
  'design-schemes': '设计方案',
  history: '生成历史',
  settings: '设置',
  connections: '已连接应用',
  account: '账户',
  'web-settings': '设置',
};

export type ProductCommandAction =
  | 'new-design'
  | 'import-skill'
  | 'navigate'
  | 'settings'
  | 'toggle-theme'
  | 'toggle-sidebar';

export interface ProductCommandSpec {
  id: string;
  label: string;
  hint?: string;
  group: ProductCommandGroup;
  keywords?: string;
  hosts: readonly MusefoldSurface[];
  /** 与导航目录同构的按宿主能力闸门；未列出的宿主不受限。 */
  capability?: Partial<Record<MusefoldSurface, keyof ProductCapabilities>>;
  action: ProductCommandAction;
  navigate?: string;
  settingsSection?: string;
}

/**
 * 命令面板静态项。会话命中 / 提示词检索仍由宿主注入。
 * 桌面独有项（Skill、方案、BYOK、Agent）用 hosts: desktop 登记，Web 不出现。
 */
export const PRODUCT_COMMAND_CATALOG: readonly ProductCommandSpec[] = [
  {
    id: 'act-new-conversation',
    label: '新设计',
    hint: '开一条新的设计对话（⌘N）',
    group: '快速动作',
    keywords: 'new conversation chat design xin sheji duihua',
    hosts: ['desktop'],
    action: 'new-design',
  },
  {
    // Web 不占用 ⌘N（浏览器保留新窗口），hint 不声明快捷键。
    id: 'act-new-design',
    label: '新设计',
    hint: '开始一条新的设计对话',
    group: '快速动作',
    keywords: 'new conversation chat design xin sheji duihua',
    hosts: ['web'],
    action: 'new-design',
  },
  {
    id: 'act-import-skill',
    label: '用 Skill 创建设计方案',
    hint: '粘贴 GitHub Skill 地址',
    group: '快速动作',
    keywords: 'skill import daoru github design scheme',
    hosts: ['desktop'],
    capability: { desktop: 'designSchemes' },
    action: 'import-skill',
  },
  {
    id: 'nav-library',
    label: '提示词库',
    hint: '浏览与管理',
    group: '导航',
    keywords: 'library prompt tkck',
    hosts: ['desktop', 'web'],
    capability: { desktop: 'localPrompts', web: 'cloudPrompts' },
    action: 'navigate',
    navigate: 'library',
  },
  {
    id: 'nav-design-schemes',
    label: '设计方案',
    hint: '创建、探索与运行',
    group: '导航',
    keywords: 'design scheme agent skill sheji fang an',
    hosts: ['desktop'],
    capability: { desktop: 'designSchemes' },
    action: 'navigate',
    navigate: 'design-schemes',
  },
  {
    id: 'nav-history',
    label: '生成历史',
    hint: '生图记录',
    group: '导航',
    keywords: 'history lishi',
    hosts: ['desktop', 'web'],
    capability: { desktop: 'generationHistory', web: 'generationHistory' },
    action: 'navigate',
    navigate: 'history',
  },
  {
    id: 'nav-settings',
    label: '设置',
    hint: '服务商 · 生成 · 外观',
    group: '导航',
    keywords: 'settings preferences shezhi peizhi',
    hosts: ['desktop', 'web'],
    action: 'navigate',
    navigate: 'settings',
  },
  {
    id: 'act-providers',
    label: '管理生图模型',
    hint: '生图接入 / 密钥 / 测试连接',
    group: '操作',
    keywords: 'provider api key fuwushang moxing',
    hosts: ['desktop'],
    capability: { desktop: 'byokProviders' },
    action: 'settings',
    settingsSection: 'providers',
    navigate: 'settings',
  },
  {
    id: 'act-ai-connections',
    label: '管理 Agent 模型',
    hint: '文本模型 / 密钥 / 能力检测',
    group: '操作',
    keywords: 'ai agent assistant api key text model design',
    hosts: ['desktop'],
    capability: { desktop: 'agent' },
    action: 'settings',
    settingsSection: 'ai',
    navigate: 'settings',
  },
  {
    id: 'act-theme',
    label: '切换到浅色',
    group: '操作',
    keywords: 'theme dark light zhuti',
    hosts: ['desktop'],
    action: 'toggle-theme',
  },
  {
    id: 'act-sidebar',
    label: '折叠 / 展开侧栏',
    group: '操作',
    keywords: 'sidebar collapse cebian',
    hosts: ['desktop'],
    action: 'toggle-sidebar',
  },
];

export function shortcutDisplayKeys(spec: ProductShortcutSpec, modifierLabel: string): string[] {
  return spec.modifier ? [modifierLabel, ...spec.keys] : [...spec.keys];
}

export function matchProductModifierShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): 'command-palette' | 'new-design' | null {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'k') return 'command-palette';
  if (key === 'n') return 'new-design';
  return null;
}

const LEGACY_PRODUCT_CAPABILITY_FEATURES: Partial<
  Record<keyof ProductCapabilities, ProductFeature>
> = {
  generation: 'generation',
  workbench: 'workbench',
  generationHistory: 'generationHistory',
  cloudPrompts: 'promptLibrary',
  cloudMcpConnections: 'mcpConnections',
  localPrompts: 'promptLibrary',
  agent: 'agent',
  designSchemes: 'designSchemes',
  referenceImages: 'referenceImages',
};

const LEGACY_HOST_CAPABILITY_FEATURES: Partial<Record<keyof ProductCapabilities, HostFeature>> = {
  promptSync: 'cloudSyncControl',
  automation: 'localAutomation',
  byokProviders: 'byokProviders',
};

export function isCapabilityFlagAvailable(
  source: CapabilitySource,
  flag: keyof ProductCapabilities,
): boolean {
  if (!isCapabilityManifest(source)) return source[flag];
  const hostFeature = LEGACY_HOST_CAPABILITY_FEATURES[flag];
  if (hostFeature) return isHostFeatureAvailable(source, hostFeature);
  const productFeature = LEGACY_PRODUCT_CAPABILITY_FEATURES[flag];
  if (!productFeature || !isProductFeatureAvailable(source, productFeature)) return false;
  if (flag === 'cloudPrompts') return source.hostFeatures.host === 'web';
  if (flag === 'localPrompts') return source.hostFeatures.host === 'desktop';
  return true;
}

export function visibleProductNav(
  surface: MusefoldSurface,
  capabilities: CapabilitySource,
): Array<{ semanticId: string; sidebarId: string; label: string }> {
  const items: Array<{ semanticId: string; sidebarId: string; label: string }> = [];
  for (const item of PRODUCT_NAV_CATALOG) {
    const sidebarId = item.sidebarId[surface];
    if (!sidebarId) continue;
    const flag = item.capability?.[surface];
    if (flag && !isCapabilityFlagAvailable(capabilities, flag)) continue;
    items.push({ semanticId: item.id, sidebarId, label: item.label });
  }
  return items;
}

export function visibleProductCommands(
  surface: MusefoldSurface,
  capabilities: CapabilitySource,
): ProductCommandSpec[] {
  return PRODUCT_COMMAND_CATALOG.filter((item) => {
    if (!item.hosts.includes(surface)) return false;
    const flag = item.capability?.[surface];
    return !flag || isCapabilityFlagAvailable(capabilities, flag);
  });
}

export function productSidebarCapabilityMap(
  surface: MusefoldSurface,
): Record<string, keyof ProductCapabilities> {
  const mapping: Record<string, keyof ProductCapabilities> = {};
  for (const item of PRODUCT_NAV_CATALOG) {
    const id = item.sidebarId[surface];
    const flag = item.capability?.[surface];
    if (id && flag) mapping[id] = flag;
  }
  return mapping;
}

export function productCommandCapabilityMap(
  surface: MusefoldSurface,
): Record<string, keyof ProductCapabilities> {
  const mapping: Record<string, keyof ProductCapabilities> = {};
  for (const item of PRODUCT_COMMAND_CATALOG) {
    const flag = item.capability?.[surface];
    if (item.hosts.includes(surface) && flag) {
      mapping[item.id] = flag;
    }
  }
  return mapping;
}

export function productViewTitle(view: string): string {
  return PRODUCT_VIEW_TITLES[view] ?? view;
}
