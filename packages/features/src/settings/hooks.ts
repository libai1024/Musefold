import type { AppPreferences, AppPreferencesPatch, AppTheme } from '@musefold/contracts';
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

/** 把主题偏好解析为要挂载的 class:'dark' 或 null(浅色)。宿主挂到 <html>。 */
export function resolveThemeClass(theme: AppTheme, systemPrefersDark: boolean): 'dark' | null {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return null;
  return systemPrefersDark ? 'dark' : null;
}
