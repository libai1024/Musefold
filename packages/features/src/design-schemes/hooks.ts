'use client';

import type {
  CheckDesignSchemeUpdateInput,
  DesignSchemeListQuery,
  ExportDesignSchemeInput,
  FormalizeDesignSchemeInput,
  GenerationJob,
  PromoteWorkingDraftInput,
  MarketSearchQuery,
  MarketSearchResult,
  RemoveDesignSchemeInput,
  RenameDesignSchemeInput,
  SelectCoverInput,
  UpdateDesignSchemeInput,
} from '@musefold/contracts';
import {
  type DesignSchemesGateway,
  queryKeys,
  useCapabilities,
  usePlatform,
} from '@musefold/platform';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';

/**
 * 方案域数据 hooks:只经 MusefoldGateway.designSchemes(可选域)。
 * 能力关闭或宿主未注入适配器时返回 null,查询保持 disabled——
 * 调用方(SchemesScreen)此时整体不渲染入口,绝不出现假可用 UI。
 */
export function useDesignSchemesGateway(): DesignSchemesGateway | null {
  const capabilities = useCapabilities();
  const { gateway } = usePlatform();
  if (!capabilities.hasDesignSchemes) return null;
  return gateway.designSchemes ?? null;
}

/**
 * 我的方案列表(承旧语义):一次取回(limit 100 = 契约上限),名称/摘要/来源过滤、
 * 草稿/正式分节都在客户端完成;不做分页 UI(个人库量级,承旧整表加载)。
 */
export function useSchemeList(query: DesignSchemeListQuery = { limit: 100 }) {
  const designSchemes = useDesignSchemesGateway();
  return useQuery({
    queryKey: queryKeys.designSchemes.list(query),
    enabled: designSchemes != null,
    queryFn: () => {
      if (!designSchemes) throw new Error('当前宿主不提供设计方案能力');
      return designSchemes.list(query);
    },
  });
}

/** 详情优先展示待验证 revision；current 查询同时提供生命周期 summary 与 selector。 */
export function useSchemeDetail(id: string | null) {
  const designSchemes = useDesignSchemesGateway();
  const currentRevision = { kind: 'current' } as const;
  const current = useQuery({
    queryKey: queryKeys.designSchemes.detail(id ?? '__none__', currentRevision),
    enabled: designSchemes != null && id != null,
    queryFn: () => {
      if (!designSchemes || !id) throw new Error('当前宿主不提供设计方案详情');
      return designSchemes.get(id, currentRevision);
    },
  });

  const workingDraftRevisionId = current.data?.summary.workingDraftRevisionId ?? null;
  const workingDraftRevision = {
    kind: 'working-draft',
    revisionId: workingDraftRevisionId ?? '__none__',
  } as const;
  const workingDraft = useQuery({
    queryKey: queryKeys.designSchemes.detail(id ?? '__none__', workingDraftRevision),
    enabled: designSchemes != null && id != null && workingDraftRevisionId != null,
    queryFn: () => {
      if (!designSchemes || !id || !workingDraftRevisionId) {
        throw new Error('当前方案没有待验证版本');
      }
      return designSchemes.get(id, {
        kind: 'working-draft',
        revisionId: workingDraftRevisionId,
      });
    },
  });

  return workingDraftRevisionId ? workingDraft : current;
}

/** 市场搜索(承旧):只在用户显式发起时请求,不自动加载;结果不落 query 缓存。 */
export function useMarketSearch(): UseMutationResult<MarketSearchResult, Error, MarketSearchQuery> {
  const designSchemes = useDesignSchemesGateway();
  return useMutation({
    mutationFn: (query: MarketSearchQuery) => {
      if (!designSchemes) throw new Error('当前宿主不提供设计方案能力');
      return designSchemes.searchMarket(query);
    },
  });
}

function useInvalidateDesignSchemes() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKeys.designSchemes.all() });
}

export function useRenameScheme() {
  const designSchemes = useDesignSchemesGateway();
  const invalidate = useInvalidateDesignSchemes();
  return useMutation({
    mutationFn: (input: RenameDesignSchemeInput) => {
      if (!designSchemes) throw new Error('当前宿主不提供设计方案能力');
      return designSchemes.rename(input);
    },
    onSuccess: invalidate,
  });
}

/** 删除草稿/移除方案:列表乐观移除,失败回滚(I6)。 */
export function useRemoveScheme() {
  const designSchemes = useDesignSchemesGateway();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDesignSchemes();
  return useMutation({
    mutationFn: (input: RemoveDesignSchemeInput) => {
      if (!designSchemes) throw new Error('当前宿主不提供设计方案能力');
      return designSchemes.remove(input);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.designSchemes.all() });
      const snapshots = queryClient.getQueriesData({
        queryKey: queryKeys.designSchemes.all(),
      });
      queryClient.setQueriesData(
        { queryKey: queryKeys.designSchemes.list({ limit: 100 }) },
        (old: { items: Array<{ id: string }>; nextCursor: string | null } | undefined) =>
          old ? { ...old, items: old.items.filter((item) => item.id !== input.schemeId) } : old,
      );
      return { snapshots };
    },
    onError: (_error, _input, context) => {
      for (const [key, data] of context?.snapshots ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: invalidate,
  });
}

export function useSelectCover() {
  const designSchemes = useDesignSchemesGateway();
  const invalidate = useInvalidateDesignSchemes();
  return useMutation({
    mutationFn: (input: SelectCoverInput) => {
      if (!designSchemes) throw new Error('当前宿主不提供设计方案能力');
      return designSchemes.selectCover(input);
    },
    onSuccess: invalidate,
  });
}

/** 草稿在成功试运行且选择封面后转为正式方案。 */
export function useFormalizeScheme() {
  const designSchemes = useDesignSchemesGateway();
  const invalidate = useInvalidateDesignSchemes();
  return useMutation({
    mutationFn: (input: FormalizeDesignSchemeInput) => {
      if (!designSchemes) throw new Error('当前宿主不提供设计方案能力');
      return designSchemes.formalize(input);
    },
    onSuccess: invalidate,
  });
}

/** 正式方案的待验证新版本在成功试运行后显式替换当前正式版本。 */
export function usePromoteWorkingDraft() {
  const designSchemes = useDesignSchemesGateway();
  const invalidate = useInvalidateDesignSchemes();
  return useMutation({
    mutationFn: (input: PromoteWorkingDraftInput) => {
      if (!designSchemes) throw new Error('当前宿主不提供设计方案能力');
      return designSchemes.promoteWorkingDraft(input);
    },
    onSuccess: invalidate,
  });
}

/** 修改输入要求(草稿限定):staged 编辑保存为一次性新 revision(update 携完整不可变文档 + expectedVersion)。 */
export function useUpdateSchemeDocument() {
  const designSchemes = useDesignSchemesGateway();
  const invalidate = useInvalidateDesignSchemes();
  return useMutation({
    mutationFn: (input: UpdateDesignSchemeInput) => {
      if (!designSchemes) throw new Error('当前宿主不提供设计方案能力');
      return designSchemes.update(input);
    },
    onSuccess: invalidate,
  });
}

/** 检查更新(GitHub 源):对比上游 commit,有变化自动编译为待验证草稿。 */
export function useCheckSchemeUpdate() {
  const designSchemes = useDesignSchemesGateway();
  const invalidate = useInvalidateDesignSchemes();
  return useMutation({
    mutationFn: (input: CheckDesignSchemeUpdateInput) => {
      if (!designSchemes) throw new Error('当前宿主不提供设计方案能力');
      return designSchemes.checkUpdate(input);
    },
    onSuccess: (result) => {
      if (result.status === 'draft-created') invalidate();
    },
  });
}

/** 导出 .musefold.design 分享包(仅正式方案);宿主负责保存对话框。 */
export function useExportScheme() {
  const designSchemes = useDesignSchemesGateway();
  return useMutation({
    mutationFn: (input: ExportDesignSchemeInput) => {
      if (!designSchemes) throw new Error('当前宿主不提供设计方案能力');
      return designSchemes.exportPackage(input);
    },
  });
}

const HISTORY_SOURCE_QUERY = { status: 'succeeded', limit: 60 } as const;

/** 「从历史内容创建」的来源集:成功且有成图的生成记录(承旧 listHistory success+有图 过滤,limit 60)。 */
export function useSchemeHistorySources(enabled: boolean) {
  const { gateway } = usePlatform();
  return useQuery({
    queryKey: [...queryKeys.generation.all(), 'scheme-sources'] as const,
    enabled,
    queryFn: async () => {
      const page = await gateway.generation.list({ ...HISTORY_SOURCE_QUERY });
      return page.items.filter((job: GenerationJob) => job.assets.length > 0);
    },
  });
}
