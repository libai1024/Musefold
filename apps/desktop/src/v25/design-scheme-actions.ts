// v2.5 桌面壳:设计方案宿主动作接缝(挂载切片)。
//
// onImportScheme 在 features 集成层刻意缺省(文件对话框 + staging 是宿主职责),
// 这里用已部署的桥方法组合:prepareImportPackage(主进程安全 staging,可取消)
// → importPackage(domain 导入,产出草稿)。run/Agent 编译/修改管线未接入,
// 本文件不伪造——提交缝(designSchemes.onSubmit)继续缺省,由 Composer 禁用并解释。

import { queryKeys, usePlatform } from '@musefold/platform';
import { toast } from '@musefold/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * 「导入 .musefold.design」宿主动作:staging 被取消时静默返回;
 * 成功后失效方案列表缓存并 toast;任一步失败按 I4 toast 保留上下文。
 */
export function useImportDesignScheme(): () => void {
  const { gateway } = usePlatform();
  const queryClient = useQueryClient();

  return useCallback(() => {
    const designSchemes = gateway.designSchemes;
    const prepareImportPackage = designSchemes?.prepareImportPackage;
    if (!designSchemes || !prepareImportPackage) {
      toast.error('当前环境暂不支持导入方案', { description: '分享包 staging 通道不可用。' });
      return;
    }
    void (async () => {
      try {
        const prepared = await prepareImportPackage({});
        if (prepared.status === 'cancelled') return;
        const result = await designSchemes.importPackage({
          stagedPackageId: prepared.stagedPackageId,
          packageHash: prepared.packageHash,
          formatVersion: prepared.formatVersion,
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.designSchemes.all() });
        toast.success('已导入为草稿', {
          description: `「${result.scheme.name}」试运行通过并选封面后可设为正式。`,
        });
      } catch (error) {
        toast.error('导入方案失败', {
          description: error instanceof Error ? error.message : '分享包校验或导入失败',
        });
      }
    })();
  }, [gateway, queryClient]);
}
