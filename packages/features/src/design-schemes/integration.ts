'use client';

import type { DesignSchemeSummary } from '@musefold/contracts';
import { toast } from '@musefold/ui/components/sonner';
import { useMemo } from 'react';
import { useDesignSchemesGateway } from './hooks';
import {
  buildSchemeHistorySeed,
  resolveSchemeAttachment,
  useSchemeIntegration,
} from './integration-store';
import type { DesignSchemesActions } from './types';

/**
 * 现成的设计方案集成层:宿主只需注入「切工作台」导航回调,即可获得一套
 * 可用的 DesignSchemesActions(试运行/使用/修改/创建/历史来源创建)。
 * 实现 = 解析附件/组装种子 → 写一次性意图(integration-store)→ 回调切屏,
 * 工作台屏消费意图落 Composer。方案运行/创建/修改的真正执行仍是宿主运行
 * 管线(经 WorkbenchScreen 的 designSchemes.onSubmit 接缝),此处不伪造。
 *
 * onImportScheme / onInstallMarketCandidate 不在此提供:导入文件对话框与
 * 市场快照下载 staging 是宿主/运行管线职责,缺省时对应入口禁用并解释(I4)。
 */
export function useDesignSchemesIntegration(options: {
  /** 宿主切屏到工作台(意图落地页);缺省时整套动作为空(入口禁用并解释)。 */
  onOpenWorkbench?: () => void;
}): DesignSchemesActions {
  const designSchemes = useDesignSchemesGateway();
  const { onOpenWorkbench } = options;

  return useMemo<DesignSchemesActions>(() => {
    if (!designSchemes || !onOpenWorkbench) return {};
    const setWorkbenchIntent = useSchemeIntegration.getState().setWorkbenchIntent;

    const attach = (scheme: DesignSchemeSummary, mode: 'trial' | 'formal' | 'modify') => {
      void resolveSchemeAttachment(designSchemes, scheme, mode)
        .then((attachment) => {
          setWorkbenchIntent({ kind: 'attach', attachment });
          onOpenWorkbench();
        })
        .catch((error: unknown) => {
          // 承旧 run-store.attach:详情打不开就地报错,不写意图不切屏。
          toast.error('无法打开方案', {
            description: error instanceof Error ? error.message : '读取方案详情失败',
          });
        });
    };

    return {
      onRunScheme: (scheme, mode) => attach(scheme, mode),
      onModifyScheme: (scheme) => attach(scheme, 'modify'),
      onCreateScheme: (createKind) => {
        setWorkbenchIntent({ kind: 'create', createKind, seed: '', source: null });
        onOpenWorkbench();
      },
      onCreateFromHistory: (selection) => {
        setWorkbenchIntent({
          kind: 'create',
          createKind: 'history',
          seed: buildSchemeHistorySeed(selection),
          source: { kind: 'history', selection },
        });
        onOpenWorkbench();
      },
    };
  }, [designSchemes, onOpenWorkbench]);
}
