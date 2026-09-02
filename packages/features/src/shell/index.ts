export { AppShell, type AppShellProps } from './AppShell';
export { getShellNavItems, SHELL_NAV_ITEMS, type ShellNavItem } from './nav';
export {
  SHELL_SIDEBAR_COMPACT_BREAKPOINT,
  SHELL_SIDEBAR_DEFAULT_WIDTH,
  SHELL_SIDEBAR_DRAWER_WIDTH,
  SHELL_SIDEBAR_MAX_WIDTH,
  SHELL_SIDEBAR_MIN_WIDTH,
  SHELL_SIDEBAR_RESIZE_STEP,
  SHELL_SIDEBAR_WIDTH_STORAGE_KEY,
} from './sidebar-layout';
export { type ScreenIntent, useScreenIntent } from './screen-intent-store';
export { ShellErrorBoundary, ShellErrorFallback } from './ShellErrorBoundary';
export {
  isMacPlatform,
  PRODUCT_SHORTCUTS,
  type ProductShortcut,
  shortcutDisplay,
} from './shortcuts';
