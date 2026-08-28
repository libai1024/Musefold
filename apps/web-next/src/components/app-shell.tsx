'use client';

import { AccountFooter } from '@musefold/features/account';
import { AppShell as SharedAppShell, SHELL_NAV_ITEMS } from '@musefold/features/shell';
import { NewSessionAction, SessionListPanel } from '@musefold/features/workbench';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/** Web 宿主壳:骨架与视觉在 features/shell 收口,这里只接 Next 路由。 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const activeId = SHELL_NAV_ITEMS.find((item) => pathname.startsWith(`/${item.id}`))?.id ?? null;
  const openWorkbench = () => router.push('/workbench');

  return (
    <SharedAppShell
      activeId={activeId}
      onNavigate={(id) => router.push(`/${id}`)}
      action={<NewSessionAction onOpen={openWorkbench} />}
      sessions={<SessionListPanel onOpen={openWorkbench} />}
      footer={<AccountFooter onOpenAccount={() => router.push('/settings')} />}
    >
      {children}
    </SharedAppShell>
  );
}
