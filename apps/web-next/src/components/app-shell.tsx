'use client';

import { History, Image as ImageIcon, Library, Settings } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/workbench', label: '工作台', icon: ImageIcon },
  { href: '/prompts', label: '提示词库', icon: Library },
  { href: '/history', label: '历史', icon: History },
  { href: '/settings', label: '设置', icon: Settings },
] as const;

/** 自适应壳:md 及以上左侧栏,移动端底部导航;内容区共用同一 features 屏幕。 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

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
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                data-testid={`nav-${href.slice(1)}`}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
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
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              data-testid={`bottom-nav-${href.slice(1)}`}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
