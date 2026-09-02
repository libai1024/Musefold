import type { PlatformCapabilities } from '@musefold/platform';
import type { LucideIcon } from '@musefold/ui/icons';
import { Blocks, History, Image as ImageIcon, Library, Settings } from '@musefold/ui/icons';

/** 产品一级导航目录:双宿主同一份,宿主只决定「怎么跳转」。 */
export interface ShellNavItem {
  id: 'workbench' | 'prompts' | 'design-schemes' | 'history' | 'settings';
  label: string;
  icon: LucideIcon;
}

const ALL_SHELL_NAV_ITEMS: readonly ShellNavItem[] = [
  { id: 'workbench', label: '工作台', icon: ImageIcon },
  { id: 'prompts', label: '提示词库', icon: Library },
  { id: 'design-schemes', label: '设计方案', icon: Blocks },
  { id: 'history', label: '生成历史', icon: History },
  { id: 'settings', label: '设置', icon: Settings },
] as const;

/** capability 关闭时不注册入口,避免宿主出现可点击但不可用的死页面。 */
export function getShellNavItems(
  capabilities: Pick<PlatformCapabilities, 'hasDesignSchemes'>,
): readonly ShellNavItem[] {
  return capabilities.hasDesignSchemes
    ? ALL_SHELL_NAV_ITEMS
    : ALL_SHELL_NAV_ITEMS.filter((item) => item.id !== 'design-schemes');
}

/** 默认安全目录;双宿主启用可选域时应调用 getShellNavItems(runtime.capabilities)。 */
export const SHELL_NAV_ITEMS = getShellNavItems({ hasDesignSchemes: false });
