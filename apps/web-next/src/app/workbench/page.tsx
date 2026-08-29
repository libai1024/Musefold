'use client';

import { WorkbenchScreen } from '@musefold/features/workbench';
import { useRouter } from 'next/navigation';

export default function WorkbenchPage() {
  const router = useRouter();
  // 窄屏壳有 3rem 顶栏 + 4rem 底部导航;md+ 全高。
  return (
    <div className="h-[calc(100dvh-7rem)] md:h-dvh">
      <WorkbenchScreen
        onOpenSettings={() => router.push('/settings')}
        onOpenPrompts={() => router.push('/prompts')}
      />
    </div>
  );
}
