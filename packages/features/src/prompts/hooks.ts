'use client';

import {
  type GenerationJob,
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
import { type GenerationGateway, queryKeys, useGateway } from '@musefold/platform';
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
    // 不 await 失效:列表 refetch 挂住时编辑器不能一直开着(B1 同类)。
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdatePrompt() {
  const gateway = useGateway();
  const invalidate = useInvalidatePrompts();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdatePromptDocument }) =>
      gateway.prompts.update(id, patch),
    onSuccess: () => {
      void invalidate();
    },
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

/** 「清空回收站」:一次性硬删所有软删提示词(双重确认由屏幕层持有)。 */
export function useEmptyPromptTrash() {
  const gateway = useGateway();
  const invalidate = useInvalidatePrompts();
  return useMutation({
    mutationFn: () => gateway.prompts.emptyTrash(),
    onSuccess: invalidate,
  });
}

/**
 * 详情「相关作品」窗口:服务端按 promptId + succeeded 过滤;
 * 客户端只再去掉无成图的成功回合。
 */
export const PROMPT_RELATED_WORKS_SCAN_LIMIT = 100;

/** 该提示词生成过的成功成图回合(倒序,取最近一页匹配项)。 */
export function usePromptRelatedWorks(promptId: string | null) {
  const gateway = useGateway();
  // 生成域在部分宿主/测试装配里可能缺席:缺席则查询不启用,面板退成「暂无相关作品」。
  const generation: GenerationGateway | undefined = gateway.generation;
  return useQuery({
    queryKey: queryKeys.prompts.relatedWorks(promptId ?? ''),
    enabled: promptId != null && generation != null,
    queryFn: async (): Promise<GenerationJob[]> => {
      if (!generation || !promptId) return [];
      const page = await generation.list({
        promptId,
        status: 'succeeded',
        limit: PROMPT_RELATED_WORKS_SCAN_LIMIT,
      });
      return page.items.filter((job) => job.assets.length > 0);
    },
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
    // 删除已经提交；后台刷新不应阻塞确认框关闭或被误当作删除失败。
    onSuccess: () => {
      void invalidate();
    },
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
    onSuccess: () => {
      void invalidate();
    },
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
    promptReferenceSelections: [],
    promptReferenceIds: [],
  };
}
