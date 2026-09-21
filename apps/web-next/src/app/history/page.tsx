'use client';

import { HistoryScreen } from '@musefold/features/history';
import { useActiveSession } from '@musefold/features/workbench';
import { useRouter } from 'next/navigation';
import { createWorkbenchHref } from '../../lib/workbench-session-url';

export default function HistoryPage() {
  const router = useRouter();
  const setActiveSessionId = useActiveSession((s) => s.setActiveSessionId);

  return (
    // 窄屏壳有 3rem 顶栏 + 4rem 底部导航;md+ 全高。
    <div className="h-[calc(100dvh-7rem)] md:h-full">
      <HistoryScreen
        onOpenSession={(sessionId) => {
          setActiveSessionId(sessionId);
          router.push(createWorkbenchHref(sessionId));
        }}
        onOpenPrompts={() => router.push('/prompts')}
        onOpenSettings={() => router.push('/settings')}
      />
    </div>
  );
}
