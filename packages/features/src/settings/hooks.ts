import {
  type AppPreferences,
  type AppPreferencesPatch,
  type AppTheme,
  CLEAR_ALL_DATA_CONFIRMATION,
  type StorageLocationId,
  type UsageRange,
} from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

/** 重启应用。system 域缺席(Web)时 mutation 不可用,调用方不得渲染死按钮。 */
export function useRelaunchApp() {
  const system = useGateway().system;
  return useMutation({
    mutationFn: () => {
      if (!system) throw new Error('当前宿主不提供应用重启');
      return system.relaunch();
    },
  });
}

/** 打开随应用分发的产品文档(桌面);Web 宿主无 system 域,关于卡不渲染该行。 */
export function useOpenProductDocs() {
  const system = useSystemGateway();
  return useMutation({ mutationFn: () => system.openProductDocs() });
}

/** Cloud MCP 已授权客户端:未登录不发请求;登出随 account.all() 一起失效。 */
export function useCloudMcpAuthorizations(enabled: boolean) {
  const cloudMcp = useGateway().cloudMcp;
  return useQuery({
    queryKey: queryKeys.cloudMcp.authorizations(),
    queryFn: () => {
      if (!cloudMcp) throw new Error('当前宿主不提供已连接应用管理');
      return cloudMcp.listAuthorizations();
    },
    enabled: enabled && Boolean(cloudMcp),
    retry: false,
  });
}

/** 撤销授权:破坏性动作,调用方必须先过 AlertDialog。 */
export function useRevokeCloudMcpAuthorization() {
  const cloudMcp = useGateway().cloudMcp;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => {
      if (!cloudMcp) throw new Error('当前宿主不提供已连接应用管理');
      return cloudMcp.revokeAuthorization({ clientId });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.cloudMcp.authorizations() }),
  });
}

/** 使用统计:切范围时保留旧值不闪骨架(0705-C3)。 */
export function useUsageSummary(range: UsageRange) {
  const gateway = useGateway();
  return useQuery({
    queryKey: queryKeys.usage.summary(range),
    queryFn: () => gateway.usage.summary({ range }),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

// ── 开放能力控制面(gateway.automation,仅桌面宿主提供)─────────────────────
// 本地控制面 / 最近调用 / 接入向导三张卡由 capabilities.hasLocalAutomation 门控。
// 令牌纪律:状态里只有掩码,「复制」是一次 mutation(主进程写系统剪贴板),
// 渲染层没有任何持有明文 bearer 的状态。

function useAutomationGateway() {
  const gateway = useGateway();
  if (!gateway.automation) {
    throw new Error('当前宿主不提供开放能力控制面(hasLocalAutomation=false)');
  }
  return gateway.automation;
}

/** 开关 / 端口 / 掩码令牌 / 预算与本月已用:控制面卡的唯一数据源。 */
export function useAutomationStatus() {
  const automation = useAutomationGateway();
  return useQuery({
    queryKey: queryKeys.automation.status(),
    queryFn: () => automation.getStatus(),
    retry: false,
  });
}

/** 开关一次往返即改端口监听状态;成功后把新状态写回缓存(不再多跑一次读)。 */
export function useSetAutomationEnabled() {
  const automation = useAutomationGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => automation.setEnabled({ enabled }),
    onSuccess: (status) => queryClient.setQueryData(queryKeys.automation.status(), status),
  });
}

/** 轮换令牌:旧令牌立即失效(破坏性动作,调用方必须先过 AlertDialog)。 */
export function useRotateAutomationToken() {
  const automation = useAutomationGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => automation.rotateToken(),
    onSuccess: (status) => queryClient.setQueryData(queryKeys.automation.status(), status),
  });
}

/** 复制令牌:明文只在主进程里进系统剪贴板,渲染层拿不到返回值。 */
export function useCopyAutomationToken() {
  const automation = useAutomationGateway();
  return useMutation({ mutationFn: () => automation.copyToken() });
}

/** 月度预算:入参已由契约收窄成有界整数;草稿防呆在卡内(parseAutomationBudgetDraft)。 */
export function useSetAutomationBudget() {
  const automation = useAutomationGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (points: number) => automation.setMonthlyBudget({ points }),
    onSuccess: (status) => queryClient.setQueryData(queryKeys.automation.status(), status),
  });
}

/** 端点级请求日志:折叠区展开才读(控制面挂载时不白读一遍环形缓冲)。 */
export function useAutomationRequestLog(enabled: boolean) {
  const automation = useAutomationGateway();
  return useQuery({
    queryKey: queryKeys.automation.requestLog(),
    queryFn: () => automation.listRequestLog(),
    enabled,
    staleTime: 0,
    retry: false,
  });
}

/** 花钱审计:同上按需读取;只读面,不提供删除(审计完整性)。 */
export function useAutomationSpendAudit(enabled: boolean) {
  const automation = useAutomationGateway();
  return useQuery({
    queryKey: queryKeys.automation.spendAudit(),
    queryFn: () => automation.listSpendAudit(),
    enabled,
    staleTime: 0,
    retry: false,
  });
}

/** 接入向导片段:随应用分发,进程内不会变,读一次即可。 */
export function useAutomationIntegrationGuide() {
  const automation = useAutomationGateway();
  return useQuery({
    queryKey: queryKeys.automation.integrationGuide(),
    queryFn: () => automation.getIntegrationGuide(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** 把主题偏好解析为要挂载的 class:'dark' 或 null(浅色)。宿主挂到 <html>。 */
export function resolveThemeClass(theme: AppTheme, systemPrefersDark: boolean): 'dark' | null {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return null;
  return systemPrefersDark ? 'dark' : null;
}
