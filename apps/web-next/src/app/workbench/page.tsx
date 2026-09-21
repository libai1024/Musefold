'use client';

import { WorkbenchScreen } from '@musefold/features/workbench';
import { useSchemeRunHandlers } from '@musefold/features/design-schemes';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { WorkbenchSessionUrlSync } from './session-url-sync';

export default function WorkbenchPage() {
  const router = useRouter();
  const schemeRunHandlers = useSchemeRunHandlers();
  // 窄屏壳有 3rem 顶栏 + 4rem 底部导航;md+ 全高。
  return (
    <Suspense fallback={null}>
      <WorkbenchSessionUrlSync>
        <div className="h-[calc(100dvh-7rem)] md:h-full">
          <WorkbenchScreen
            onOpenSettings={() => router.push('/settings')}
            onOpenPrompts={() => router.push('/prompts')}
            designSchemes={{
              ...schemeRunHandlers,
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
