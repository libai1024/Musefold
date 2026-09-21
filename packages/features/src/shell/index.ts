export { AppShell, type AppShellProps } from './AppShell';
export {
  WindowControls,
  type WindowControlsProps,
  WINDOW_CONTROL_BUTTON_WIDTH_PX,
  WINDOW_CONTROLS_BAND_HEIGHT_PX,
  WINDOW_CONTROLS_BAND_WIDTH_PX,
} from './WindowControls';
// 壳级反馈设施(§2.4):花钱确认卡与 Toaster 同级挂载,由宿主放在壳外层。
export {
  AutomationConfirmCard,
  type AutomationConfirmationItem,
  useAutomationConfirmations,
} from '../automation';
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
export { type ScreenIntent, openConnectionsSettings, useScreenIntent } from './screen-intent-store';
export { useDiscardGuard } from './use-discard-guard';
export { ShellErrorBoundary, ShellErrorFallback } from './ShellErrorBoundary';
export {
  isMacPlatform,
  PRODUCT_SHORTCUTS,
  type ProductShortcut,
  shortcutDisplay,
} from './shortcuts';
