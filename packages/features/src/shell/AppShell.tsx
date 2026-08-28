'use client';

import { cn } from '@musefold/ui/lib/utils';
import type { ReactNode } from 'react';
import { SHELL_NAV_ITEMS, type ShellNavItem } from './nav';

export interface AppShellProps {
  /** 当前激活的导航项 id。 */
  activeId: ShellNavItem['id'] | null;
  /** 宿主决定跳转方式:Web 用 router.push,桌面壳切本地视图。 */
  onNavigate: (id: ShellNavItem['id']) => void;
  /** 宿主可裁剪导航目录(如桌面迁移期只放已迁入的域)。 */
  items?: readonly ShellNavItem[];
  children: ReactNode;
}

/**
 * 产品自适应壳(唯一实现,双宿主共用):md 及以上左侧栏,移动端底部导航。
 * 视觉与结构在此收口,宿主不再各自维护壳骨架。
 */
export function AppShell({
  activeId,
  onNavigate,
  items = SHELL_NAV_ITEMS,
  children,
}: AppShellProps) {
  return (
    <div className="flex min-h-dvh bg-background">
      <aside
        className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-border border-r bg-sidebar md:flex"
        data-testid="app-sidebar"
      >
        <div className="flex h-14 items-center gap-2 px-5">
          <span className="inline-block size-3 rounded-full bg-primary" aria-hidden />
          <span className="font-semibold text-sidebar-foreground text-sm">未像 Musefold</span>
        </div>
        <nav className="flex flex-col gap-1 px-3 py-2">
          {items.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
              data-testid={`nav-${id}`}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
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
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
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
