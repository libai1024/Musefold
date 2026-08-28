'use client';

import { HistoryScreen } from '@musefold/features/history';
import { useActiveSession } from '@musefold/features/workbench';
import { useRouter } from 'next/navigation';

export default function HistoryPage() {
  const router = useRouter();
  const setActiveSessionId = useActiveSession((s) => s.setActiveSessionId);

  return (
    // 窄屏壳有 3rem 顶栏 + 4rem 底部导航;md+ 全高。
    <div className="h-[calc(100dvh-7rem)] md:h-dvh">
      <HistoryScreen
        onOpenSession={(sessionId) => {
          setActiveSessionId(sessionId);
          router.push('/workbench');
        }}
      />
    </div>
  );
}
