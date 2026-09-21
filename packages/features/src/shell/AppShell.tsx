'use client';

import { MusefoldMark } from '@musefold/ui/components/brand-mark';
import { Button } from '@musefold/ui/components/button';
import { Sheet, SheetContent, SheetTitle } from '@musefold/ui/components/sheet';
import { TooltipProvider } from '@musefold/ui/components/tooltip';
import { PanelLeft, Search } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { SHELL_NAV_ITEMS, type ShellNavItem } from './nav';
import { useScreenIntent } from './screen-intent-store';
import {
  SHELL_SIDEBAR_COMPACT_BREAKPOINT,
  SHELL_SIDEBAR_DRAWER_WIDTH,
  SHELL_SIDEBAR_MIN_WIDTH,
  SHELL_SIDEBAR_RESIZE_STEP,
  resolveSidebarMaxWidth,
  useMediaQuery,
  useSidebarWidth,
} from './sidebar-layout';

export interface AppShellProps {
  /** 当前激活的导航项 id。 */
  activeId: ShellNavItem['id'] | null;
  /** 宿主决定跳转方式:Web 用 router.push,桌面壳切本地视图。 */
  onNavigate: (id: ShellNavItem['id']) => void;
  /** 宿主可裁剪导航目录(如桌面迁移期只放已迁入的域)。 */
  items?: readonly ShellNavItem[];
  /** 品牌行下方的首要动作槽(「新设计」钮,V25-UI-SPEC §2.2-2)。 */
  action?: ReactNode;
  /** 导航下方的「对话」会话区槽(V25-UI-SPEC §2.2-4)。 */
  sessions?: ReactNode;
  /** 侧栏底部槽(账号/设置区,M4d 接入)。 */
  footer?: ReactNode;
  /** macOS 红绿灯让位:品牌行左侧额外缩进(px),桌面宿主注入。 */
  brandInset?: number;
  /** 移动顶栏右侧插槽(额度 readout 等,V25-UI-SPEC §2.3)。 */
  mobileExtra?: ReactNode;
  /**
   * Win/Linux 自绘窗口控件槽(D5:主区右上 32px 窄带,只放三钮,不恢复整条顶栏)。
   * 桌面宿主 `!IS_MAC` 时注入;mac / Web 不传。
   */
  windowControls?: ReactNode;
  children: ReactNode;
}

interface SidebarBodyProps {
  activeId: ShellNavItem['id'] | null;
  onNavigate: (id: ShellNavItem['id']) => void;
  railItems: readonly ShellNavItem[];
  action?: ReactNode;
  sessions?: ReactNode;
  footer?: ReactNode;
  brandInset: number;
  /** 品牌行收起钮语义分叉(承旧同一钮):常驻栏 = 收起侧栏;抽屉 = 关闭抽屉。 */
  onCollapse: () => void;
}

/** 侧栏五段内容(品牌行/新设计/主导航/对话区/底部账号),常驻栏与 compact 抽屉共用一份。 */
function SidebarBody({
  activeId,
  onNavigate,
  railItems,
  action,
  sessions,
  footer,
  brandInset,
  onCollapse,
}: SidebarBodyProps) {
  return (
    <>
      <div
        className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4"
        style={brandInset > 0 ? { paddingLeft: brandInset } : undefined}
      >
        <MusefoldMark className="size-4 shrink-0 text-sidebar-foreground" aria-hidden />
        <span className="font-semibold text-[13px] text-sidebar-foreground">Musefold</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7 text-muted-foreground"
          aria-label="收起侧栏"
          data-testid="sidebar-collapse"
          onClick={onCollapse}
        >
          <PanelLeft className="size-4" />
        </Button>
      </div>

      {action && <div className="px-3 pt-1 pb-0.5">{action}</div>}

      <nav className="flex flex-col gap-px px-3 pt-0.5 pb-2" aria-label="主导航">
        {railItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            aria-current={activeId === id ? 'page' : undefined}
            data-testid={`nav-${id}`}
            className={cn(
              'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors duration-(--dur-fast)',
              activeId === id
                ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
            )}
          >
            <Icon
              className={cn(
                'size-4',
                activeId === id ? 'text-sidebar-foreground' : 'text-muted-foreground/80',
              )}
              aria-hidden
            />
            {label}
          </button>
        ))}
      </nav>

      {sessions && <div className="flex min-h-0 flex-1 flex-col px-3">{sessions}</div>}

      {footer && <div className="shrink-0 border-border/70 border-t px-2 py-1.5">{footer}</div>}
    </>
  );
}

/**
 * 抽屉内点击会话面板时保持打开的动作(承旧 dismissOn 语义的反向清单):
 * 行内编辑、AlertDialog、DropdownMenu 都锚在抽屉 DOM 内,抽屉一关它们随之卸载;
 * 「更多」菜单虽 portal 到 body,触发器销毁同样让菜单失去锚点。
 */
const DRAWER_KEEP_OPEN_TESTIDS = new Set([
  'session-pin',
  'session-rename',
  'session-rename-input',
  'session-rename-commit',
  'session-archive',
  'session-remove',
  'session-more',
  'session-list-retry',
]);

/**
 * 产品自适应壳(唯一实现,双宿主共用,V25-UI-SPEC §2):
 * md+ 常驻侧栏(220–360 拖宽 + 键盘步进 + 双击复位 + localStorage 持久化,承旧
 * ProductSidebarLayout),收起态为占位式窄轨(不再浮层遮挡内容);<768px 转 overlay
 * 抽屉(焦点圈闭/归还、Esc、主区 inert);移动端顶栏 + 底部标签栏不变。
 */
export function AppShell({
  activeId,
  onNavigate,
  items = SHELL_NAV_ITEMS,
  action,
  sessions,
  footer,
  brandInset = 0,
  mobileExtra,
  windowControls,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const compact = useMediaQuery(`(max-width: ${SHELL_SIDEBAR_COMPACT_BREAKPOINT}px)`);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { width, widthRef, maxWidth, applyWidth, resetWidth } = useSidebarWidth();
  const [resizing, setResizing] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const drawerOpenRef = useRef(drawerOpen);
  drawerOpenRef.current = drawerOpen;

  const activeLabel = items.find((item) => item.id === activeId)?.label ?? '未像';
  // 设置不占导航轨(承 ZCode/Codex/Cursor 布局语法):入口在左下角账号区齿轮;
  // 移动端无侧栏账号区,底部标签栏保留完整目录。
  const railItems = items.filter((item) => item.id !== 'settings');

  // 断点迁移即收抽屉(承旧:进入 compact 强制关闭;离开时常驻栏凭 collapsed 状态自然恢复)。
  const prevCompactRef = useRef(compact);
  useEffect(() => {
    if (prevCompactRef.current === compact) return;
    prevCompactRef.current = compact;
    setDrawerOpen(false);
  }, [compact]);

  // 导航切换即收抽屉(承旧 compactDismissKey 语义;宿主路由/视图切换都会改 activeId)。
  const prevActiveIdRef = useRef(activeId);
  useEffect(() => {
    if (prevActiveIdRef.current === activeId) return;
    prevActiveIdRef.current = activeId;
    setDrawerOpen(false);
  }, [activeId]);

  // ⌘/Ctrl+K 全局唤起提示词搜索(shortcuts.ts 登记 prompts-search):
  // 写一次性意图 + 走宿主导航切屏;提示词屏 mount/意图变化时消费并聚焦搜索框。
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k') return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      useScreenIntent.getState().setIntent({ kind: 'prompts-focus-search' });
      onNavigate('prompts');
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onNavigate]);

  // 焦点归还准备(承旧):抽屉关闭期间持续记录抽屉外最后聚焦的元素。
  useEffect(() => {
    if (!compact) return;
    const remember = (target: EventTarget | null) => {
      if (!drawerOpenRef.current && target instanceof HTMLElement) {
        returnFocusRef.current = target;
      }
    };
    remember(document.activeElement);
    const handleFocusIn = (event: FocusEvent) => remember(event.target);
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [compact]);

  // 抽屉关闭后焦点归还(承旧:rAF 归还到关闭前焦点,失败回退到抽屉触发钮)。
  const handleDrawerCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    const remembered = returnFocusRef.current;
    const raf =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (cb: FrameRequestCallback) => window.setTimeout(cb, 0);
    raf(() => {
      const fallback = document.querySelector<HTMLElement>('[data-testid="sidebar-drawer-open"]');
      const target = remembered?.isConnected ? remembered : fallback;
      target?.focus();
    });
  }, []);

  // 抽屉内「点击即收」:导航项/新设计/会话打开行(承旧 dismissOn 选择器语义)。
  // 底部账号区刻意不收:身份/连接菜单以抽屉为锚,收起会把菜单一起卸载。
  const handleDrawerClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-testid^="nav-"], [data-testid="session-create"]')) {
      setDrawerOpen(false);
      return;
    }
    if (!target.closest('[data-testid="session-panel"]')) return;
    const button = target.closest('button[data-testid^="session-"]');
    const testid = button?.getAttribute('data-testid') ?? '';
    if (button && !DRAWER_KEEP_OPEN_TESTIDS.has(testid)) {
      setDrawerOpen(false);
    }
  };

  // 指针拖宽(承旧:window 级 pointermove/up,主键才触发,data-resizing 抑制选中文本)。
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (compact || collapsed || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    setResizing(true);
    const handleMove = (moveEvent: PointerEvent) => {
      applyWidth(startWidth + moveEvent.clientX - startX);
    };
    const stop = () => {
      setResizing(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  // 键盘调宽(承旧:方向键 ±16,Home 最小,End 最大)。
  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (compact || collapsed) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      applyWidth(widthRef.current + SHELL_SIDEBAR_RESIZE_STEP);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      applyWidth(widthRef.current - SHELL_SIDEBAR_RESIZE_STEP);
    } else if (event.key === 'Home') {
      event.preventDefault();
      applyWidth(SHELL_SIDEBAR_MIN_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      applyWidth(resolveSidebarMaxWidth(window.innerWidth));
    }
  };

  const sidebarBody = (onCollapse: () => void) => (
    <SidebarBody
      activeId={activeId}
      onNavigate={onNavigate}
      railItems={railItems}
      action={action}
      sessions={sessions}
      footer={footer}
      brandInset={brandInset}
      onCollapse={onCollapse}
    />
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'relative flex min-h-dvh bg-background md:h-dvh md:min-h-0 md:overflow-hidden',
          resizing && 'cursor-col-resize select-none',
        )}
        data-resizing={resizing ? 'true' : 'false'}
      >
        {/* 常驻侧栏(md+;compact 抽屉形态时卸载,避免与抽屉双实例双 testid) */}
        {!compact && !collapsed && (
          <aside
            className="sticky top-0 hidden h-dvh shrink-0 flex-col bg-sidebar md:flex"
            style={{ width }}
            aria-label="Musefold 导航"
            data-testid="app-sidebar"
          >
            {sidebarBody(() => setCollapsed(true))}
          </aside>
        )}

        {/* 拖宽手柄(承旧:8px 命中区骑缝,透明静息,hover/focus 显影) */}
        {!compact && !collapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧栏宽度"
            aria-valuemin={SHELL_SIDEBAR_MIN_WIDTH}
            aria-valuemax={maxWidth}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={startResize}
            onDoubleClick={resetWidth}
            onKeyDown={handleResizeKeyDown}
            className="absolute inset-y-0 z-40 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none bg-transparent transition-colors duration-(--dur-fast) hover:bg-sidebar-border/70 focus-visible:outline-none focus-visible:bg-sidebar-border md:block"
            style={{ left: width }}
            data-testid="sidebar-resize-handle"
          />
        )}

        {/* 收起态占位轨(承旧顶栏 leading 展开钮的占位式改写,ui-parity 01 §4-3):
          在布局流内占位而非浮层,不再遮挡工作台/设置内容;macOS 顶部让位红绿灯。 */}
        {!compact && collapsed && (
          <div
            className="sticky top-0 hidden h-dvh w-10 shrink-0 flex-col items-center md:flex"
            style={{ paddingTop: brandInset > 0 ? 36 : 8 }}
            data-testid="sidebar-expand-rail"
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              aria-label="展开侧栏"
              data-testid="sidebar-expand"
              onClick={() => setCollapsed(false)}
            >
              <PanelLeft className="size-4" />
            </Button>
          </div>
        )}

        {/*
        工作面框架(承旧 mainview-frame/surface,ui-parity 01 §7 P1 + 01-C1):
        md+ 四边 4px 窗底内缩,浮岛工作面 rounded-xl(12px=--radius-xl)+ bg-card
        (§1.2:--bg-work 的语义对位)+ shadow-sm;侧栏与工作面之间不画边框,靠
        sidebar/background/card 三阶色差分离。
        移动端(<md)不加内缩与浮岛:底部标签栏为 fixed 覆盖层,几何维持原状。
      */}
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col md:min-h-0',
            activeId === 'settings' ? 'md:p-0' : 'md:p-1',
          )}
          data-testid="mainview-frame"
          inert={compact && drawerOpen}
        >
          <div
            className={cn(
              'relative flex min-h-0 flex-1 flex-col md:overflow-hidden',
              activeId === 'settings' ? 'md:bg-card' : 'md:rounded-xl md:bg-card md:shadow-sm',
            )}
            data-testid="mainview-surface"
            data-window-controls-safe={windowControls ? '' : undefined}
          >
            {/*
              桌面拖拽钩子(features 不写 app-region):内容顶 12px / 设置全出血 32px。
              pointer-events-none 避免 Web 抢点击;桌面宿主 CSS 覆写为 drag。
              `data-window-controls-safe` 仅在注入 windowControls 时出现,供宿主 CSS
              预留 32×138 三钮安全区;mac / Web 不挂钩子、不加 padding。
            */}
            <div
              data-window-drag-band={activeId === 'settings' ? undefined : ''}
              data-settings-window-drag={activeId === 'settings' ? '' : undefined}
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-x-0 top-0 z-20 hidden md:block',
                activeId === 'settings' ? 'h-8' : 'h-3',
              )}
            />
            {windowControls ? (
              <div
                className="absolute top-0 right-0 z-30 hidden h-8 items-stretch md:flex"
                data-window-controls-band=""
                data-testid="window-controls-band"
              >
                {windowControls}
              </div>
            ) : null}
            <header className="flex h-12 shrink-0 items-center gap-2 border-border border-b px-4 md:hidden">
              {compact && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground"
                  aria-label="展开侧栏"
                  data-testid="sidebar-drawer-open"
                  onClick={() => setDrawerOpen(true)}
                >
                  <PanelLeft className="size-4" />
                </Button>
              )}
              <MusefoldMark className="size-4 shrink-0 text-foreground" aria-hidden />
              <span className="min-w-0 truncate font-semibold text-foreground text-sm">
                {activeLabel}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {mobileExtra}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  aria-label="搜索提示词"
                  data-testid="mobile-search"
                  onClick={() => onNavigate('prompts')}
                >
                  <Search className="size-4" />
                </Button>
              </div>
            </header>
            <main className="min-h-0 flex-1 overflow-auto pb-16 md:pb-0">{children}</main>
          </div>
        </div>

        <nav
          className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch justify-around border-border border-t bg-background/95 backdrop-blur md:hidden"
          data-testid="app-bottom-nav"
          inert={compact && drawerOpen}
        >
          {items.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
              data-testid={`bottom-nav-${id}`}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors',
                activeId === id ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </button>
          ))}
        </nav>

        {/* compact(<768px)overlay 抽屉(承旧 Drawer 形态):
          Sheet(radix Dialog)承接焦点圈闭/Esc/overlay;aria-modal 承旧显式声明,
          主区 inert 在上文显式接线;宽度承旧 min(320px, max(220px, 100vw-28px))。 */}
        {compact && (
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              aria-modal="true"
              aria-describedby={undefined}
              onCloseAutoFocus={handleDrawerCloseAutoFocus}
              onClickCapture={handleDrawerClickCapture}
              className="w-auto gap-0 border-r-0 bg-sidebar p-0 shadow-pop ease-(--ease-smooth) data-[state=closed]:duration-(--dur-med) data-[state=open]:duration-(--dur-med) sm:max-w-none"
              style={{ width: SHELL_SIDEBAR_DRAWER_WIDTH }}
            >
              <SheetTitle className="sr-only">主导航</SheetTitle>
              <div className="flex h-full min-h-0 flex-col" data-testid="app-sidebar">
                {sidebarBody(() => setDrawerOpen(false))}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>
    </TooltipProvider>
  );
}
