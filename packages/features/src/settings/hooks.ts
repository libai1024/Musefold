import {
  type AppPreferences,
  type AppPreferencesPatch,
  type AppTheme,
  CLEAR_ALL_DATA_CONFIRMATION,
  type StorageLocationId,
} from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function usePreferences() {
  const gateway = useGateway();
  return useQuery({
    queryKey: queryKeys.settings.preferences(),
    queryFn: () => gateway.settings.getPreferences(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useUpdatePreferences() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: AppPreferencesPatch) => gateway.settings.updatePreferences(patch),
    onMutate: async (patch) => {
      const key = queryKeys.settings.preferences();
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<AppPreferences>(key);
      if (previous) {
        queryClient.setQueryData<AppPreferences>(key, { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.settings.preferences(), context.previous);
      }
    },
    onSettled: (result) => {
      if (result) {
        queryClient.setQueryData(queryKeys.settings.preferences(), result);
      }
    },
  });
}

// 账号状态 hook 已随 M4d 移入 account 域;设置屏经 AccountPanel 使用。
export { useAccountStatus } from '../account/hooks';

// ── 本机数据面(gateway.system,仅桌面宿主提供)───────────────────────────
// 备份 / 存储位置 / 诊断日志 / 危险区四块由 capabilities.hasLocalDataManagement 门控,
// 门内组件才调下面 useSystemGateway 系 hook;关于卡双端共用,走 useAppInfo(缺省即 Web 版)。

function useSystemGateway() {
  const gateway = useGateway();
  if (!gateway.system) {
    throw new Error('当前宿主不提供本机数据管理(hasLocalDataManagement=false)');
  }
  return gateway.system;
}

/** 版本信息:桌面走桥;Web 没有 system 域 → 不发请求,data 恒 null(关于卡显示「Web 版」)。 */
export function useAppInfo() {
  const system = useGateway().system;
  return useQuery({
    queryKey: queryKeys.system.appInfo(),
    queryFn: async () => (system ? await system.getAppInfo() : null),
    enabled: Boolean(system),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useBackups() {
  const system = useSystemGateway();
  return useQuery({
    queryKey: queryKeys.system.backups(),
    queryFn: () => system.listBackups(),
    retry: false,
  });
}

/** 立即备份:成功后把新列表写回缓存,新备份在展开的列表里立刻可见(承 v2.1 就近反馈)。 */
export function useCreateBackup() {
  const system = useSystemGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => system.createBackup(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.backups() }),
  });
}

/** 恢复备份:主进程已换掉磁盘库文件,调用方必须随即 relaunch(结果 needsRestart 恒 true)。 */
export function useRestoreBackup() {
  const system = useSystemGateway();
  return useMutation({
    mutationFn: (file: string) => system.restoreBackup({ file }),
  });
}

export function useStorageLocations() {
  const system = useSystemGateway();
  return useQuery({
    queryKey: queryKeys.system.storageLocations(),
    queryFn: () => system.listStorageLocations(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function useOpenStorageLocation() {
  const system = useSystemGateway();
  return useMutation({
    mutationFn: (id: StorageLocationId) => system.openStorageLocation({ id }),
  });
}

/** 诊断日志按需读取:用户点「查看」才 enabled,不在设置屏挂载时白读一遍磁盘。 */
export function useDiagnosticLog(enabled: boolean) {
  const system = useSystemGateway();
  return useQuery({
    queryKey: queryKeys.system.diagnosticLog(),
    queryFn: () => system.readDiagnosticLog(),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** 危险区:成功后整库业务表已空,全量失效让各屏重读(承 v2.1「否则切回资源库还是旧列表」)。 */
export function useClearAllData() {
  const system = useSystemGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => system.clearAllData({ confirmation: CLEAR_ALL_DATA_CONFIRMATION }),
    onSuccess: () => {
      // 只失效本机业务数据域,且不 await:onSuccess 返回 Promise 会让 mutation 一直 pending
      // 直到所有 refetch 完成,而账号/同步一类网络查询在离线或网关不可达时可能长期挂起,
      // 会把「清空已完成」这件事对用户无限期隐藏。清空边界不含账号/连接/偏好,无需失效它们。
      for (const key of [
        queryKeys.prompts.all(),
        queryKeys.workbench.all(),
        queryKeys.generation.all(),
        queryKeys.system.all(),
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** 重启应用(恢复备份后的唯一收尾动作)。 */
export function useRelaunchApp() {
  const system = useSystemGateway();
  return useMutation({ mutationFn: () => system.relaunch() });
}

/** 打开随应用分发的产品文档(桌面);Web 宿主无 system 域,关于卡不渲染该行。 */
export function useOpenProductDocs() {
  const system = useSystemGateway();
  return useMutation({ mutationFn: () => system.openProductDocs() });
}

/** 把主题偏好解析为要挂载的 class:'dark' 或 null(浅色)。宿主挂到 <html>。 */
export function resolveThemeClass(theme: AppTheme, systemPrefersDark: boolean): 'dark' | null {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return null;
  return systemPrefersDark ? 'dark' : null;
}
