'use client';

import {
  type NewPromptDocument,
  type NewPromptFolder,
  type NewPromptTag,
  type PromptDocument,
  type PromptListQuery,
  type PromptUseInput,
  type UpdatePromptDocument,
  type WorkbenchDraft,
  workbenchDraftSchema,
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

export function usePurgePrompt() {
  const gateway = useGateway();
  const invalidate = useInvalidatePrompts();
  return useMutation({
    mutationFn: (id: string) => gateway.prompts.purge(id),
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

/**
 * 「使用」= 送工作台草稿(ui-parity 04 P0,承旧 openDraft):
 * 正文/反向词必达;params 是宽松 record,仅收编契约认可的比例与质量,
 * 奇形旧档丢参数保正文——使用动作不因参数失败。
 */
export function promptToWorkbenchDraft(prompt: PromptDocument): WorkbenchDraft {
  const raw = prompt.params ?? {};
  const parsed = workbenchDraftSchema.shape.params.safeParse({
    ...(typeof raw.aspectRatio === 'string' ? { aspectRatio: raw.aspectRatio } : {}),
    ...(typeof raw.quality === 'string' ? { quality: raw.quality } : {}),
  });
  const params = parsed.success ? parsed.data : {};
  return {
    prompt: prompt.content,
    negative: prompt.negative ?? '',
    // 与 Composer 草稿口径一致:auto/缺省不落键,size 不进草稿。
    params: {
      ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
      ...(params.quality && params.quality !== 'auto' ? { quality: params.quality } : {}),
    },
    promptReferenceIds: [],
  };
}
