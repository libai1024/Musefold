'use client';

import { AccountFooter, MobileQuotaReadout } from '@musefold/features/account';
import { OnboardingFlow } from '@musefold/features/onboarding';
import { AppShell as SharedAppShell, getShellNavItems } from '@musefold/features/shell';
import { NewSessionAction, SessionListPanel, useActiveSession } from '@musefold/features/workbench';
import { useCapabilities } from '@musefold/platform';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { createWorkbenchHref } from '../lib/workbench-session-url';

/** Web 宿主壳:骨架与视觉在 features/shell 收口,这里只接 Next 路由。 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // 导航目录由 runtime capability 驱动(能力关闭即无入口,不出现死页面)。
  const capabilities = useCapabilities();
  const navItems = getShellNavItems(capabilities);

  const activeId = navItems.find((item) => pathname.startsWith(`/${item.id}`))?.id ?? null;
  const openWorkbench = () => {
    // 会话列表与「新设计」先更新共享指针,再由宿主带着该指针进入工作台。
    if (pathname === '/workbench') return;
    const { activeSessionId, draftSession } = useActiveSession.getState();
    router.push(createWorkbenchHref(draftSession ? null : activeSessionId));
  };

  if (pathname === '/ceramic-button') {
    return <>{children}</>;
  }

  return (
    <>
      <SharedAppShell
        activeId={activeId}
        items={navItems}
        onNavigate={(id) => (id === 'workbench' ? openWorkbench() : router.push(`/${id}`))}
        action={<NewSessionAction onOpen={openWorkbench} />}
        sessions={<SessionListPanel onOpen={openWorkbench} />}
        footer={<AccountFooter onOpenSettings={() => router.push('/settings')} />}
        mobileExtra={<MobileQuotaReadout />}
      >
        {children}
      </SharedAppShell>
      {/* 首启引导(U01-onboarding):未登录且未完成哨兵时自行弹出,否则渲染 null。 */}
      <OnboardingFlow
        onOpenScreen={(screen) =>
          screen === 'workbench' ? openWorkbench() : router.push(`/${screen}`)
        }
      />
    </>
  );
}
