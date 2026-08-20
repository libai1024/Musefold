// 桌面宿主能力清单：侧栏 / 设置分组 / 命令面板入口闸门。工作台内部按钮不读这里。

import {
  getProductCapabilities,
  type ProductCapabilities,
} from '@musefold/domain';

/** 桌面是单一宿主：当前把全部桌面功能画出来；关 flag 只藏入口，不改产品范围。 */
export const capabilities = getProductCapabilities('desktop');

export type DesktopCapabilityFlag = keyof ProductCapabilities;

/** 侧栏导航 id → 能力 flag。未列入的项永远显示。 */
export const SIDEBAR_NAV_CAPABILITY = {
  library: 'localPrompts',
  'design-schemes': 'designSchemes',
  history: 'generationHistory',
} as const satisfies Record<string, DesktopCapabilityFlag>;

/** 设置分区 key → 能力 flag。account / data / appearance / about 等未列入的永远显示。 */
export const SETTINGS_SECTION_CAPABILITY = {
  connections: 'cloudMcpConnections',
  providers: 'byokProviders',
  ai: 'agent',
  automation: 'automation',
} as const satisfies Record<string, DesktopCapabilityFlag>;

/**
 * 命令面板动作 id → 能力 flag。
 * 导航项、设置分区动作与侧栏 / SettingsView 同一套 flag；
 * 「用 Skill 创建设计方案」仅在整份 designSchemes 关闭时隐藏。
 */
export const COMMAND_ACTION_CAPABILITY = {
  'nav-library': 'localPrompts',
  'nav-design-schemes': 'designSchemes',
  'nav-history': 'generationHistory',
  'act-import-skill': 'designSchemes',
  'act-providers': 'byokProviders',
  'act-ai-connections': 'agent',
} as const satisfies Record<string, DesktopCapabilityFlag>;

/** 无对应 flag 的入口保持可见；有 flag 则跟清单走。 */
export function isCapabilityEntryVisible(
  mapping: { readonly [id: string]: DesktopCapabilityFlag },
  id: string,
): boolean {
  const flag = mapping[id];
  return flag === undefined || capabilities[flag];
}
