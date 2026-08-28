'use client';

import type {
  NewPromptDocument,
  NewPromptFolder,
  NewPromptTag,
  PromptDocument,
  PromptListQuery,
  PromptUseInput,
  UpdatePromptDocument,
} from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** 列表查询(cursor 无限分页)。query 不含 cursor,由分页器注入。 */
export function usePromptList(query: Omit<PromptListQuery, 'cursor'>) {
  const gateway = useGateway();
  return useInfiniteQuery({
    queryKey: queryKeys.prompts.list(query),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => gateway.prompts.list({ ...query, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function usePromptFolders() {
  const gateway = useGateway();
  return useQuery({
    queryKey: queryKeys.prompts.folders(),
    queryFn: () => gateway.prompts.listFolders(),
  });
}

export function usePromptTags() {
  const gateway = useGateway();
  return useQuery({
    queryKey: queryKeys.prompts.tags(),
    queryFn: () => gateway.prompts.listTags(),
  });
}

function useInvalidatePrompts() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all() });
}

export function useCreatePrompt() {
  const gateway = useGateway();
  const invalidate = useInvalidatePrompts();
  return useMutation({
    mutationFn: (input: NewPromptDocument) => gateway.prompts.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdatePrompt() {
  const gateway = useGateway();
  const invalidate = useInvalidatePrompts();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdatePromptDocument }) =>
      gateway.prompts.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useRemovePrompt() {
  const gateway = useGateway();
  const invalidate = useInvalidatePrompts();
  return useMutation({
    mutationFn: (id: string) => gateway.prompts.remove(id),
    onSuccess: invalidate,
  });
}

export function useRestorePrompt() {
  const gateway = useGateway();
  const invalidate = useInvalidatePrompts();
  return useMutation({
    mutationFn: (id: string) => gateway.prompts.restore(id),
    onSuccess: invalidate,
  });
}

export function useUsePrompt() {
  const gateway = useGateway();
  const invalidate = useInvalidatePrompts();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PromptUseInput }) =>
      gateway.prompts.use(id, input),
    onSuccess: invalidate,
  });
}

export function useCreateFolder() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPromptFolder) => gateway.prompts.createFolder(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.prompts.folders() }),
  });
}

export function useRemoveFolder() {
  const gateway = useGateway();
  const invalidate = useInvalidatePrompts();
  return useMutation({
    mutationFn: (id: string) => gateway.prompts.removeFolder(id),
    onSuccess: invalidate,
  });
}

export function useCreateTag() {
  const gateway = useGateway();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPromptTag) => gateway.prompts.createTag(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.prompts.tags() }),
  });
}

export function useRemoveTag() {
  const gateway = useGateway();
  const invalidate = useInvalidatePrompts();
  return useMutation({
    mutationFn: (id: string) => gateway.prompts.removeTag(id),
    onSuccess: invalidate,
  });
}

/** 把「使用(复制)」动作落到剪贴板 + 使用计数。 */
export async function copyPromptContent(prompt: PromptDocument): Promise<void> {
  await navigator.clipboard.writeText(
    prompt.negative ? `${prompt.content}\n\nNegative: ${prompt.negative}` : prompt.content,
  );
}
