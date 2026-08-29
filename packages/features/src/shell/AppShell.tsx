'use client';

import { MusefoldMark } from '@musefold/ui/components/brand-mark';
import { Button } from '@musefold/ui/components/button';
import { PanelLeft, Search } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { type ReactNode, useState } from 'react';
import { SHELL_NAV_ITEMS, type ShellNavItem } from './nav';

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
  children: ReactNode;
}

/**
 * 产品自适应壳(唯一实现,双宿主共用,V25-UI-SPEC §2):
 * md+ 左侧栏(品牌/新设计/导航/对话/底部,可收起),移动端顶栏 + 底部标签栏。
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
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const activeLabel = items.find((item) => item.id === activeId)?.label ?? '未像';
  // 设置不占导航轨(承 ZCode/Codex/Cursor 布局语法):入口在左下角账号区齿轮;
  // 移动端无侧栏账号区,底部标签栏保留完整目录。
  const railItems = items.filter((item) => item.id !== 'settings');

  return (
    <div className="flex min-h-dvh bg-background">
      {!collapsed && (
        <aside
          className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-border/70 border-r bg-sidebar md:flex"
          data-testid="app-sidebar"
        >
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
              onClick={() => setCollapsed(true)}
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
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 left-2 z-40 hidden size-8 text-muted-foreground md:inline-flex"
            style={brandInset > 0 ? { left: brandInset } : undefined}
            aria-label="展开侧栏"
            data-testid="sidebar-expand"
            onClick={() => setCollapsed(false)}
          >
            <PanelLeft className="size-4" />
          </Button>
        )}
        <header className="flex h-12 items-center gap-2 border-border border-b px-4 md:hidden">
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
        <main className="flex-1 pb-16 md:pb-0">{children}</main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch justify-around border-border border-t bg-background/95 backdrop-blur md:hidden"
        data-testid="app-bottom-nav"
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
    </div>
  );
}
