import type { PrepareLocalWorkspaceInput } from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountEpoch, assertAccountEpoch } from './account-session';

export function useLocalWorkspaceRecovery() {
  const sync = useGateway().sync;
  const client = useQueryClient();
  const supported =
    !!sync?.listLocalWorkspaces && !!sync.previewLocalWorkspace && !!sync.prepareLocalWorkspace;
  const status = useQuery({
    queryKey: queryKeys.sync.localWorkspaces(),
    queryFn: async () => {
      const epoch = accountEpoch(client);
      if (!sync?.listLocalWorkspaces) throw new Error('当前版本尚不支持本机提示词库恢复');
      const result = await sync.listLocalWorkspaces();
      assertAccountEpoch(client, epoch);
      return result;
    },
    enabled: supported,
    retry: false,
  });
  return { supported, status };
}

export function useLocalWorkspacePreview(sourceId: string, cursor?: string) {
  const sync = useGateway().sync;
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.sync.localWorkspacePreview(sourceId, cursor),
    queryFn: async () => {
      const epoch = accountEpoch(client);
      if (!sync?.previewLocalWorkspace) throw new Error('当前版本尚不支持本机提示词库预览');
      const result = await sync.previewLocalWorkspace({ sourceId, ...(cursor ? { cursor } : {}) });
      assertAccountEpoch(client, epoch);
      return result;
    },
    enabled: !!sourceId && !!sync?.previewLocalWorkspace,
    retry: false,
    staleTime: 0,
  });
}

export function usePrepareLocalWorkspace() {
  const sync = useGateway().sync;
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: PrepareLocalWorkspaceInput) => {
      if (!sync?.prepareLocalWorkspace) throw new Error('当前版本尚不支持本机提示词库恢复');
      return sync.prepareLocalWorkspace(input);
    },
    onMutate: () => accountEpoch(client),
    onSuccess: async (status, _input, epoch) => {
      assertAccountEpoch(client, epoch);
      client.setQueryData(queryKeys.sync.status(), status);
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.sync.localWorkspaces() }),
        client.resetQueries({ queryKey: queryKeys.prompts.all() }),
      ]);
      assertAccountEpoch(client, epoch);
    },
    retry: false,
  });
}
