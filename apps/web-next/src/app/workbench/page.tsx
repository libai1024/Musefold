'use client';

import { WorkbenchScreen } from '@musefold/features/workbench';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { WorkbenchSessionUrlSync } from './session-url-sync';

export default function WorkbenchPage() {
  const router = useRouter();
  // 窄屏壳有 3rem 顶栏 + 4rem 底部导航;md+ 全高。
  return (
    <Suspense fallback={null}>
      <WorkbenchSessionUrlSync>
        <div className="h-[calc(100dvh-7rem)] md:h-full">
          <WorkbenchScreen
            onOpenSettings={() => router.push('/settings')}
            onOpenPrompts={() => router.push('/prompts')}
            // 方案域只接导航缝:云端 run/创建/修改管线未部署,onRun/onCancelRun/
            // onCreate/onModify 均缺省;Composer 按生命周期禁用并解释,不伪造方案执行。
            designSchemes={{
              onOpenDesignSchemes: (detailId) =>
                router.push(
                  detailId
                    ? `/design-schemes?scheme=${encodeURIComponent(detailId)}`
                    : '/design-schemes',
                ),
            }}
          />
        </div>
      </WorkbenchSessionUrlSync>
    </Suspense>
  );
}
