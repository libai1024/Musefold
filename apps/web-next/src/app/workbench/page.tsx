'use client';

import { WorkbenchScreen } from '@musefold/features/workbench';

export default function WorkbenchPage() {
  // 窄屏壳有 3rem 顶栏 + 4rem 底部导航;md+ 全高。
  return (
    <div className="h-[calc(100dvh-7rem)] md:h-dvh">
      <WorkbenchScreen />
    </div>
  );
}
