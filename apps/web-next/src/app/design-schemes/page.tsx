'use client';

import { SchemesScreen, useDesignSchemesIntegration } from '@musefold/features/design-schemes';
import { useActiveSession } from '@musefold/features/workbench';
import { entityIdSchema } from '@musefold/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { createWorkbenchHref } from '../../lib/workbench-session-url';
import { schemeAssetContentUrl } from '../../lib/scheme-asset-url';

/**
 * 设计方案路由(P01-7 挂载):列表/详情/CRUD 走云端确定性语义;
 * 云端运行、市场与导入预览经共享 gateway；正式包交付和 Agent 产品接入继续推进。
 * 图片由同源受保护接口读取，宿主只注入地址解析接缝。
 */
function DesignSchemesView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 详情深链(工作台「查看详情」):/design-schemes?scheme=<id>,变化时重挂载整屏详情。
  const rawDetailId = searchParams.get('scheme');
  const parsedDetailId = rawDetailId === null ? null : entityIdSchema.safeParse(rawDetailId);
  const detailId = parsedDetailId?.success ? parsedDetailId.data : null;

  useEffect(() => {
    if (rawDetailId !== null && !parsedDetailId?.success) {
      router.replace('/design-schemes');
    }
  }, [parsedDetailId?.success, rawDetailId, router]);

  const actions = useDesignSchemesIntegration({
    onOpenWorkbench: () => {
      const { activeSessionId, draftSession } = useActiveSession.getState();
      router.push(createWorkbenchHref(draftSession ? null : activeSessionId));
    },
  });

  return (
    // 窄屏壳有 3rem 顶栏 + 4rem 底部导航;md+ 全高。
    <div className="h-[calc(100dvh-7rem)] md:h-full">
      <SchemesScreen
        key={detailId ?? 'list'}
        initialDetailId={detailId ?? undefined}
        onDetailOpen={(id) => router.push(`/design-schemes?scheme=${encodeURIComponent(id)}`)}
        onDetailBack={() => router.replace('/design-schemes')}
        onDetailRemoved={() => router.replace('/design-schemes')}
        actions={actions}
        resolveAssetUrl={schemeAssetContentUrl}
      />
    </div>
  );
}

export default function DesignSchemesPage() {
  return (
    <Suspense fallback={null}>
      <DesignSchemesView />
    </Suspense>
  );
}
