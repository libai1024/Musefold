'use client';

import { Button } from '@musefold/ui/components/button';
import { PanelLeft } from '@musefold/ui/icons';
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
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-dvh bg-background">
      {!collapsed && (
        <aside
          className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-border border-r bg-sidebar md:flex"
          data-testid="app-sidebar"
        >
          <div
            className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4"
            style={brandInset > 0 ? { paddingLeft: brandInset } : undefined}
          >
            <span className="inline-block size-3 rounded-full bg-primary" aria-hidden />
            <span className="font-semibold text-sidebar-foreground text-sm">Musefold</span>
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

          {action && <div className="px-3 pb-1">{action}</div>}

          <nav className="flex flex-col gap-0.5 px-3 py-2" aria-label="主导航">
            {items.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onNavigate(id)}
                aria-current={activeId === id ? 'page' : undefined}
                data-testid={`nav-${id}`}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                  activeId === id
                    ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            ))}
          </nav>

          {sessions && <div className="flex min-h-0 flex-1 flex-col px-3">{sessions}</div>}

          {footer && <div className="shrink-0 border-border border-t px-3 py-2">{footer}</div>}
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
          <span className="inline-block size-2.5 rounded-full bg-primary" aria-hidden />
          <span className="font-semibold text-foreground text-sm">未像</span>
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
