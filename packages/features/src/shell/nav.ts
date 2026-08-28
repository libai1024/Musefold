import type { LucideIcon } from '@musefold/ui/icons';
import { History, Image as ImageIcon, Library, Settings } from '@musefold/ui/icons';

/** 产品一级导航目录:双宿主同一份,宿主只决定「怎么跳转」。 */
export interface ShellNavItem {
  id: 'workbench' | 'prompts' | 'history' | 'settings';
  label: string;
  icon: LucideIcon;
}

export const SHELL_NAV_ITEMS: readonly ShellNavItem[] = [
  { id: 'workbench', label: '工作台', icon: ImageIcon },
  { id: 'prompts', label: '提示词库', icon: Library },
  { id: 'history', label: '历史', icon: History },
  { id: 'settings', label: '设置', icon: Settings },
] as const;
