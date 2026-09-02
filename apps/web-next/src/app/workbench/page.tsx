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
            // 方案域只接导航缝:云端 run/创建/修改管线未部署,提交缝(onSubmit)缺省,
            // Composer 提交钮禁用并解释(I4),不回落普通生成伪造方案运行。
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
