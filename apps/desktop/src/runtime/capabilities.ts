// 桌面宿主能力清单：侧栏 / 设置分组 / 命令面板入口闸门。工作台内部按钮不读这里。

import {
  getProductCapabilities,
  productCommandCapabilityMap,
  productSidebarCapabilityMap,
  type ProductCapabilities,
} from '@musefold/domain';

/** 桌面是单一宿主：当前把全部桌面功能画出来；关 flag 只藏入口，不改产品范围。 */
export const capabilities = getProductCapabilities('desktop');

export type DesktopCapabilityFlag = keyof ProductCapabilities;

/** 侧栏导航 id → 能力 flag。未列入的项永远显示。由共享目录派生。 */
export const SIDEBAR_NAV_CAPABILITY = productSidebarCapabilityMap('desktop') as Record<
  string,
  DesktopCapabilityFlag
>;

/**
 * 设置分区 key → 能力 flag。account / data / preferences / archived 等未列入的永远显示。
 * 数组表示「任一能力开启即显示」：中转站含生图+Agent 两条通道，开放能力含自动化+已连接应用。
 */
export const SETTINGS_SECTION_CAPABILITY = {
  relay: ['byokProviders', 'agent'],
  open: ['automation', 'cloudMcpConnections'],
} as const satisfies Record<string, DesktopCapabilityFlag | readonly DesktopCapabilityFlag[]>;

/**
 * 命令面板动作 id → 能力 flag。
 * 导航项、设置分区动作与侧栏 / SettingsView 同一套 flag；
 * 「用 Skill 创建设计方案」仅在整份 designSchemes 关闭时隐藏。
 */
export const COMMAND_ACTION_CAPABILITY = productCommandCapabilityMap('desktop') as Record<
  string,
  DesktopCapabilityFlag
>;

/** 无对应 flag 的入口保持可见；有 flag 则跟清单走（数组 = 任一开启即可见）。 */
export function isCapabilityEntryVisible(
  mapping: {
    readonly [id: string]: DesktopCapabilityFlag | readonly DesktopCapabilityFlag[];
  },
  id: string,
): boolean {
  const flag = mapping[id];
  if (flag === undefined) return true;
  if (typeof flag !== 'string') return flag.some((entry) => capabilities[entry]);
  return capabilities[flag];
}
