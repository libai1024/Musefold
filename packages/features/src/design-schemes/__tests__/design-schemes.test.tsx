import type {
  DesignSchemeAsset,
  DesignSchemeDetail,
  DesignSchemeDetailRevisionSelector,
  DesignSchemeRevisionDocument,
  DesignSchemeSummary,
  GenerationJob,
  MarketSearchResult,
} from '@musefold/contracts';
import type {
  DesignSchemesGateway as DesignSchemesGatewayType,
  MusefoldGateway,
} from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SchemesScreen, type SchemesScreenProps } from '../SchemesScreen';
import type { DesignSchemesActions } from '../types';

const user = userEvent.setup({ pointerEventsCheck: 0 });
const NOW = '2026-08-30T08:00:00.000Z';

/* ---------- fixtures(形状对齐 contracts design-scheme / generation 域) ---------- */

function makeSummary(overrides: Partial<DesignSchemeSummary> = {}): DesignSchemeSummary {
  return {
    id: 'scheme-1',
    name: '水彩海报',
    summary: '柔和水彩质感的活动海报配方',
    status: 'draft',
    sourcePresentation: 'musefold-created',
    sourceLabel: 'Musefold 创建',
    currentRevisionId: 'rev-1',
    version: 1,
    workingDraftRevisionId: null,
    coverAssetId: null,
    fidelity: 'faithful',
    inputLabels: [],
    hasSuccessfulTrial: false,
    lastRunAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeDocument(
  overrides: Partial<DesignSchemeRevisionDocument> = {},
): DesignSchemeRevisionDocument {
  return {
    schemaVersion: 1,
    revisionId: 'rev-1',
    schemeId: 'scheme-1',
    name: '水彩海报',
    summary: '柔和水彩质感的活动海报配方',
    fidelity: 'faithful',
    sources: [],
    sourceSnapshotIds: [],
    inputs: [],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'pm-1',
        order: 0,
        kind: 'input-template',
        template: '画一幅 {{subject}} 的水彩海报',
        variables: ['subject'],
        sourceIds: [],
      },
    ],
    assetIds: [],
    compilation: {
      compiledAt: NOW,
      model: { model: 'test-model' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
    parentRevisionId: null,
    createdBy: 'agent',
    createdAt: NOW,
    ...overrides,
  };
}

function makeAsset(overrides: Partial<DesignSchemeAsset> = {}): DesignSchemeAsset {
  return {
    id: 'asset-1',
    origin: 'local-run',
    mimeType: 'image/png',
    width: 512,
    height: 512,
    byteSize: 1024,
    contentHash: 'a'.repeat(64),
    role: 'output',
    license: null,
    createdAt: NOW,
    ...overrides,
  };
}

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: 'job-1',
    sessionId: null,
    parentRunId: null,
    promptId: null,
    userPrompt: '一只水彩风格的猫',
    promptReferences: [],
    actorType: 'desktop_local',
    approvalStatus: 'not_required',
    status: 'succeeded',
    progress: 100,
    request: {
      prompt: '一只水彩风格的猫',
      size: 'auto',
      quality: 'auto',
      count: 1,
      referenceImages: [],
    },
    providerModel: 'test-model',
    costPoints: 10,
    assets: [
      {
        id: 'gen-asset-1',
        url: 'media://gen/gen-asset-1.png',
        mimeType: 'image/png',
        width: 512,
        height: 512,
        byteSize: 2048,
        expiresAt: '2027-01-01T00:00:00.000Z',
      },
    ],
    error: null,
    createdAt: NOW,
    startedAt: NOW,
    finishedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

const MARKET_RESULT: MarketSearchResult = {
  query: 'poster',
  fromCache: false,
  fetchedAt: NOW,
  candidates: [
    {
      candidateId: 'cand-1',
      repositoryUrl: 'https://github.com/aa/bb',
      fullName: 'aa/bb',
      description: '海报生成规则包',
      license: 'MIT',
      ref: 'main',
      commit: null,
      updatedAt: NOW,
      stars: 120,
      topics: ['poster'],
      matchReason: '匹配关键词 poster',
      riskSummary: null,
    },
  ],
  nextCursor: null,
};

/* ---------- 内存 gateway:行为够 UI 流程断言,不实现的管线方法抛错 ---------- */

function createMemoryGateway(seed: {
  schemes?: DesignSchemeSummary[];
  documents?: Record<string, DesignSchemeRevisionDocument>;
  assets?: Record<string, DesignSchemeAsset[]>;
  jobs?: GenerationJob[];
  marketResult?: MarketSearchResult;
  marketError?: Error;
}) {
  const schemes = new Map<string, DesignSchemeSummary>(
    (seed.schemes ?? []).map((scheme) => [scheme.id, scheme]),
  );
  const documents = new Map<string, DesignSchemeRevisionDocument>(
    Object.entries(seed.documents ?? {}),
  );
  const assets = new Map<string, DesignSchemeAsset[]>(Object.entries(seed.assets ?? {}));

  const designSchemes = {
    list: vi.fn(async () => ({ items: [...schemes.values()], nextCursor: null })),
    get: vi.fn(
      async (
        id: string,
        revision: DesignSchemeDetailRevisionSelector = { kind: 'current' },
      ): Promise<DesignSchemeDetail> => {
        const summary = schemes.get(id);
        if (!summary) throw new Error('NOT_FOUND');
        const revisionId =
          revision.kind === 'working-draft' ? revision.revisionId : summary.currentRevisionId;
        if (
          revision.kind === 'working-draft' &&
          revision.revisionId !== summary.workingDraftRevisionId
        ) {
          throw new Error('REVISION_NOT_FOUND');
        }
        const document = documents.get(revisionId);
        if (!document) throw new Error('REVISION_NOT_FOUND');
        return { summary, document, assets: assets.get(id) ?? [], sourceSnapshots: [] };
      },
    ),
    searchMarket: vi.fn(async (): Promise<MarketSearchResult> => {
      if (seed.marketError) throw seed.marketError;
      return seed.marketResult ?? MARKET_RESULT;
    }),
    rename: vi.fn(async (input: { schemeId: string; name: string; expectedVersion: number }) => {
      const summary = schemes.get(input.schemeId);
      if (!summary) throw new Error('NOT_FOUND');
      const next = { ...summary, name: input.name, version: summary.version + 1 };
      schemes.set(next.id, next);
      return { scheme: next };
    }),
    remove: vi.fn(async (input: { schemeId: string; expectedVersion: number }) => {
      schemes.delete(input.schemeId);
      return { schemeId: input.schemeId, removed: true as const };
    }),
    selectCover: vi.fn(
      async (input: { schemeId: string; assetId: string; expectedVersion: number }) => {
        const summary = schemes.get(input.schemeId);
        if (!summary) throw new Error('NOT_FOUND');
        const next = { ...summary, coverAssetId: input.assetId, version: summary.version + 1 };
        schemes.set(next.id, next);
        return { scheme: next, selectedAssetId: input.assetId };
      },
    ),
    formalize: vi.fn(
      async (input: {
        schemeId: string;
        revisionId: string;
        coverAssetId: string;
        expectedVersion: number;
        confirmed: true;
      }) => {
        const summary = schemes.get(input.schemeId);
        if (!summary) throw new Error('NOT_FOUND');
        const next: DesignSchemeSummary = {
          ...summary,
          status: 'formal',
          currentRevisionId: input.revisionId,
          workingDraftRevisionId: null,
          version: summary.version + 1,
        };
        schemes.set(next.id, next);
        return { scheme: next, revisionId: input.revisionId, formalized: true as const };
      },
    ),
    promoteWorkingDraft: vi.fn(
      async (input: {
        schemeId: string;
        workingDraftRevisionId: string;
        expectedVersion: number;
        confirmed: true;
      }) => {
        const summary = schemes.get(input.schemeId);
        if (!summary) throw new Error('NOT_FOUND');
        const next: DesignSchemeSummary = {
          ...summary,
          status: 'formal',
          currentRevisionId: input.workingDraftRevisionId,
          workingDraftRevisionId: null,
          version: summary.version + 1,
        };
        schemes.set(next.id, next);
        return {
          scheme: next,
          promotedRevisionId: input.workingDraftRevisionId,
          promoted: true as const,
        };
      },
    ),
    update: vi.fn(
      async (input: {
        schemeId: string;
        baseRevisionId: string;
        document: DesignSchemeRevisionDocument;
        expectedVersion: number;
      }) => {
        const summary = schemes.get(input.schemeId);
        if (!summary) throw new Error('NOT_FOUND');
        documents.set(input.document.revisionId, input.document);
        const next = {
          ...summary,
          currentRevisionId: input.document.revisionId,
          version: summary.version + 1,
        };
        schemes.set(next.id, next);
        return { scheme: next, document: input.document };
      },
    ),
    checkUpdate: vi.fn(async () => ({
      status: 'up-to-date' as const,
      detail: '上游没有新提交',
      scheme: null,
      revisionId: null,
    })),
    exportPackage: vi.fn(async (input: { schemeId: string; formatVersion: 2 }) => ({
      package: {
        id: 'pkg-1',
        format: 'musefold.design' as const,
        formatVersion: 2 as const,
        contentHash: 'b'.repeat(64),
        sizeBytes: 4096,
        createdAt: NOW,
      },
      schemeId: input.schemeId,
      status: 'delivered' as const,
    })),
    create: vi.fn(async () => {
      throw new Error('unused: 创建管线由集成层承接');
    }),
    modify: vi.fn(async () => {
      throw new Error('unused');
    }),
    cancel: vi.fn(async () => {
      throw new Error('unused');
    }),
    importPackage: vi.fn(async () => {
      throw new Error('unused: 导入 staging 由宿主承接');
    }),
    run: vi.fn(async () => {
      throw new Error('unused: 运行由工作台接缝承接');
    }),
    subscribeEvents: vi.fn(() => () => {}),
  } satisfies DesignSchemesGatewayType;

  const generation = {
    list: vi.fn(async () => ({ items: seed.jobs ?? [], nextCursor: null })),
  };

  const gateway = {
    designSchemes,
    generation,
  } as unknown as MusefoldGateway;
  return { gateway, designSchemes, generation };
}

function renderScreen(
  seed: Parameters<typeof createMemoryGateway>[0],
  props?: SchemesScreenProps,
  capabilities = { ...WEB_CAPABILITIES, hasDesignSchemes: true },
) {
  const memory = createMemoryGateway(seed);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway: memory.gateway, capabilities }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return {
    ...memory,
    ...render(<SchemesScreen {...props} />, { wrapper: Providers }),
  };
}

/** 承旧路径:行 → Inspector → 「打开详情」进入详情页。 */
async function openDetailFromList(schemeId: string) {
  await user.click(screen.getByTestId(`runtime-scheme-open-${schemeId}`));
  await waitFor(() => expect(screen.getByTestId('scheme-inspector')).toBeTruthy());
  await user.click(screen.getByTestId('scheme-inspector-open-detail'));
  await waitFor(() => expect(screen.getByTestId('runtime-scheme-detail')).toBeTruthy());
}

const ALL_ACTIONS: DesignSchemesActions = {
  onRunScheme: vi.fn(),
  onModifyScheme: vi.fn(),
  onCreateScheme: vi.fn(),
  onCreateFromHistory: vi.fn(),
  onImportScheme: vi.fn(),
  onInstallMarketCandidate: vi.fn(),
};

function actionsWithSpies() {
  return {
    onRunScheme: vi.fn(),
    onModifyScheme: vi.fn(),
    onCreateScheme: vi.fn(),
    onCreateFromHistory: vi.fn(),
    onImportScheme: vi.fn(),
    onInstallMarketCandidate: vi.fn(),
  } satisfies DesignSchemesActions;
}

/* ---------- 测试 ---------- */

describe('SchemesScreen 能力闸门', () => {
  it('hasDesignSchemes=false 时整体不渲染(D2 无死入口)', async () => {
    // 生产 Web capability 关闭；enabled fixture 只验证共享屏幕的行为。
    renderScreen(
      { schemes: [makeSummary()] },
      { actions: ALL_ACTIONS },
      { ...WEB_CAPABILITIES, hasDesignSchemes: false },
    );
    await waitFor(() => {
      expect(screen.queryByTestId('design-schemes-page')).toBeNull();
    });
  });
});

describe('SchemesScreen 我的方案(列表)', () => {
  it('空库:零态引导 + 新建 CTA(I5);搜索无结果:承旧文案', async () => {
    renderScreen({}, { actions: ALL_ACTIONS });
    await waitFor(() => expect(screen.getByTestId('scheme-list-empty')).toBeTruthy());
    expect(screen.getByText('还没有设计方案')).toBeTruthy();
    await user.click(screen.getByTestId('scheme-empty-create'));
    expect(screen.getByTestId('scheme-create-menu')).toBeTruthy();
  });

  it('列表:草稿/正式分节、保真度徽标、主动作文案(使用/继续/试运行)与待办圆点', async () => {
    const actions = actionsWithSpies();
    renderScreen(
      {
        schemes: [
          makeSummary({ id: 's-draft-new', name: '新草稿' }),
          makeSummary({ id: 's-draft-ok', name: '可继续草稿', hasSuccessfulTrial: true }),
          makeSummary({
            id: 's-formal',
            name: '正式方案',
            status: 'formal',
            hasSuccessfulTrial: true,
            coverAssetId: 'asset-1',
          }),
        ],
      },
      { actions },
    );
    await waitFor(() => expect(screen.getByTestId('runtime-scheme-row-s-formal')).toBeTruthy());
    expect(screen.getByText('草稿')).toBeTruthy();
    expect(screen.getByText('正式')).toBeTruthy();
    expect(screen.getAllByText('完整还原').length).toBeGreaterThan(0);
    expect(screen.getByTestId('runtime-scheme-action-s-formal').textContent).toBe('使用');
    expect(screen.getByTestId('runtime-scheme-action-s-draft-ok').textContent).toBe('继续');
    expect(screen.getByTestId('runtime-scheme-action-s-draft-new').textContent).toBe('试运行');

    await user.click(screen.getByTestId('runtime-scheme-action-s-formal'));
    expect(actions.onRunScheme).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-formal' }),
      'formal',
    );
    await user.click(screen.getByTestId('runtime-scheme-action-s-draft-new'));
    expect(actions.onRunScheme).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-draft-new' }),
      'trial',
    );
  });

  it('客户端搜索过滤(名称/摘要/来源),无结果给承旧提示并可清除筛选', async () => {
    renderScreen({ schemes: [makeSummary({ name: '水彩海报' })] }, { actions: ALL_ACTIONS });
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    const search = screen.getByTestId('scheme-search');
    await user.type(search, '不存在的东西');
    await waitFor(() => expect(screen.getByTestId('scheme-list-empty-search')).toBeTruthy());
    expect(screen.getByText('没有找到匹配的方案')).toBeTruthy();
    expect(screen.getByTestId('scheme-clear-filter')).toBeTruthy();
    expect(screen.queryByTestId('runtime-scheme-row-scheme-1')).toBeNull();

    await user.click(screen.getByTestId('scheme-clear-filter'));
    await waitFor(() => expect(screen.getByTestId('runtime-scheme-row-scheme-1')).toBeTruthy());
    expect((search as HTMLInputElement).value).toBe('');
  });

  it('选中行 → Inspector(生命周期/输入/来源);关闭后收起', async () => {
    renderScreen(
      {
        schemes: [makeSummary({ inputLabels: ['主题', '风格'] })],
      },
      { actions: ALL_ACTIONS },
    );
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await user.click(screen.getByTestId('runtime-scheme-open-scheme-1'));
    await waitFor(() => expect(screen.getByTestId('scheme-inspector')).toBeTruthy());
    expect(screen.getAllByText('待试运行').length).toBeGreaterThan(0);
    expect(screen.getByText('主题')).toBeTruthy();
    expect(screen.getByTestId('scheme-inspector-run').textContent).toContain('开始试运行');
    await user.click(screen.getByTestId('scheme-inspector-close'));
    await waitFor(() => expect(screen.queryByTestId('scheme-inspector')).toBeNull());
  });

  it('删除草稿:hover 删除钮 → AlertDialog 承旧文案 → 确认后列表移除', async () => {
    const { designSchemes } = renderScreen({ schemes: [makeSummary()] }, { actions: ALL_ACTIONS });
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await user.click(screen.getByTestId('runtime-scheme-remove-scheme-1'));
    await waitFor(() => expect(screen.getByTestId('scheme-list-remove-dialog')).toBeTruthy());
    expect(screen.getByText('删除草稿「水彩海报」？')).toBeTruthy();
    expect(
      screen.getByText('草稿与它的运行记录会从方案库移除；已生成的图片仍保留在历史与图库中。'),
    ).toBeTruthy();
    await user.click(screen.getByTestId('scheme-list-remove-confirm'));
    await waitFor(() => expect(screen.getByTestId('scheme-list-empty')).toBeTruthy());
    expect(designSchemes.remove).toHaveBeenCalledWith({
      schemeId: 'scheme-1',
      expectedVersion: 1,
    });
  });

  it('未接入运行接缝时主动作禁用并给理由(I4 无死按钮)', async () => {
    renderScreen({ schemes: [makeSummary()] }, { actions: {} });
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    const action = screen.getByTestId('runtime-scheme-action-scheme-1');
    expect(action.hasAttribute('disabled')).toBe(true);
    expect(action.getAttribute('title')).toBe('当前环境暂未接入方案运行');
  });

  it('列表错误:就地错误 + 重试(I4)', async () => {
    const memory = renderScreen({ schemes: [makeSummary()] }, { actions: ALL_ACTIONS });
    memory.designSchemes.list.mockRejectedValueOnce(new Error('读取失败:磁盘忙'));
    // 初次渲染已经消费了 mock;改为全新一个总是失败的 gateway 重渲染
    memory.unmount();
    const failing = createMemoryGateway({});
    failing.designSchemes.list.mockImplementation(async () => {
      throw new Error('读取失败:磁盘忙');
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Providers({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <PlatformProvider
            runtime={{
              gateway: failing.gateway,
              capabilities: { ...WEB_CAPABILITIES, hasDesignSchemes: true },
            }}
          >
            {children}
          </PlatformProvider>
        </QueryClientProvider>
      );
    }
    render(<SchemesScreen actions={ALL_ACTIONS} />, { wrapper: Providers });
    await waitFor(() => expect(screen.getByTestId('scheme-list-error')).toBeTruthy());
    expect(screen.getByText('读取失败:磁盘忙')).toBeTruthy();
  });
});

describe('SchemesScreen 发现(市场)', () => {
  it('不自动加载:空闲引导态;显式搜索出候选;添加走安装确认', async () => {
    const actions = actionsWithSpies();
    const { designSchemes } = renderScreen({}, { actions });
    await waitFor(() => expect(screen.getByTestId('scheme-surface-explore')).toBeTruthy());
    await user.click(screen.getByTestId('scheme-surface-explore'));
    expect(screen.getByTestId('market-idle')).toBeTruthy();
    expect(designSchemes.searchMarket).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('market-suggestion-poster prompt'));
    await waitFor(() => expect(screen.getByTestId('market-candidate-cand-1')).toBeTruthy());
    expect(screen.getByText('aa/bb')).toBeTruthy();
    expect(screen.getByText('MIT')).toBeTruthy();

    await user.click(screen.getByTestId('market-add-cand-1'));
    await waitFor(() => expect(screen.getByTestId('market-install-dialog')).toBeTruthy());
    expect(screen.getByText('不会执行仓库脚本')).toBeTruthy();
    await user.click(screen.getByTestId('market-install-confirm'));
    expect(actions.onInstallMarketCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: 'cand-1' }),
    );
  });

  it('市场搜索失败:就地错误条 + 重试;缓存结果给 notice', async () => {
    const { designSchemes } = renderScreen(
      { marketError: new Error('网络不可用') },
      { actions: ALL_ACTIONS },
    );
    await user.click(screen.getByTestId('scheme-surface-explore'));
    await user.type(screen.getByTestId('scheme-search'), 'poster');
    await user.click(screen.getByTestId('market-search-run'));
    await waitFor(() => expect(screen.getByTestId('market-error')).toBeTruthy());
    expect(screen.getByText('搜索市场失败')).toBeTruthy();

    designSchemes.searchMarket.mockImplementationOnce(async () => ({
      ...MARKET_RESULT,
      fromCache: true,
    }));
    await user.click(screen.getByText('重试'));
    await waitFor(() => expect(screen.getByTestId('market-cache-notice')).toBeTruthy());
  });
});

describe('SchemesScreen 详情页', () => {
  const detailSeed = {
    schemes: [
      makeSummary({
        id: 'scheme-1',
        hasSuccessfulTrial: true,
        coverAssetId: 'asset-1',
        inputLabels: ['subject'],
      }),
    ],
    documents: {
      'rev-1': makeDocument({
        inputs: [
          {
            id: 'subject',
            label: 'subject',
            kind: 'text' as const,
            required: true,
            description: '主体',
          },
          { id: 'style', label: '风格', kind: 'text' as const, required: false },
        ],
        constraints: [
          {
            id: 'c-1',
            domain: 'color' as const,
            statement: '以暖色系为主',
            mode: 'required' as const,
            sourceIds: [],
            userOverridable: false,
          },
        ],
      }),
    },
    assets: {
      'scheme-1': [makeAsset({ id: 'asset-1' }), makeAsset({ id: 'asset-2' })],
    },
  };

  it('打开详情:头部/分节/相册;返回回列表', async () => {
    const onDetailOpen = vi.fn();
    const onDetailBack = vi.fn();
    renderScreen(detailSeed, {
      actions: ALL_ACTIONS,
      resolveAssetUrl: (assetId) => `media://scheme/${assetId}.png`,
      onDetailOpen,
      onDetailBack,
    });
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');
    expect(onDetailOpen).toHaveBeenCalledWith('scheme-1');
    await waitFor(() => expect(screen.getByTestId('runtime-scheme-detail')).toBeTruthy());
    expect(screen.getByText('方案规则')).toBeTruthy();
    expect(screen.getByText('以暖色系为主')).toBeTruthy();
    expect(screen.getByTestId('runtime-scheme-album')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    await user.click(screen.getByTestId('runtime-scheme-detail-back'));
    await waitFor(() => expect(screen.getByTestId('scheme-list-workspace')).toBeTruthy());
    expect(onDetailBack).toHaveBeenCalledTimes(1);
  });

  it('正式方案详情常驻「在 Composer 中修改」并沿用 summary', async () => {
    const actions = actionsWithSpies();
    const formalSummary = makeSummary({
      status: 'formal',
      hasSuccessfulTrial: true,
      coverAssetId: 'asset-1',
    });
    renderScreen(
      {
        schemes: [formalSummary],
        documents: { 'rev-1': makeDocument() },
        assets: { 'scheme-1': [makeAsset({ id: 'asset-1' })] },
      },
      { actions },
    );

    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');

    const modifyButton = screen.getByTestId('runtime-scheme-modify');
    expect(modifyButton.textContent).toContain('在 Composer 中修改');
    await user.click(modifyButton);
    expect(actions.onModifyScheme).toHaveBeenCalledTimes(1);
    expect(actions.onModifyScheme).toHaveBeenCalledWith(formalSummary);
    expect(screen.getByTestId('runtime-scheme-menu')).toBeTruthy();
  });

  it('正式方案无修改接缝时常驻按钮禁用并解释原因', async () => {
    const actions: DesignSchemesActions = { onRunScheme: vi.fn() };
    renderScreen(
      {
        schemes: [
          makeSummary({
            status: 'formal',
            hasSuccessfulTrial: true,
            coverAssetId: 'asset-1',
          }),
        ],
        documents: { 'rev-1': makeDocument() },
        assets: { 'scheme-1': [makeAsset({ id: 'asset-1' })] },
      },
      { actions },
    );

    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');

    const modifyButton = screen.getByTestId('runtime-scheme-modify');
    expect(modifyButton.hasAttribute('disabled')).toBe(true);
    expect(modifyButton.getAttribute('title')).toBe('当前环境暂未接入方案修改');
  });

  it('详情删除成功通知宿主并回列表', async () => {
    const onDetailRemoved = vi.fn();
    const { designSchemes } = renderScreen(detailSeed, {
      actions: ALL_ACTIONS,
      onDetailRemoved,
    });
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');
    await user.click(screen.getByTestId('runtime-scheme-menu'));
    await user.click(screen.getByTestId('runtime-scheme-menu-remove'));
    await user.click(screen.getByTestId('scheme-list-remove-confirm'));
    await waitFor(() => expect(screen.getByTestId('scheme-list-empty')).toBeTruthy());
    expect(designSchemes.remove).toHaveBeenCalledWith({
      schemeId: 'scheme-1',
      expectedVersion: 1,
    });
    expect(onDetailRemoved).toHaveBeenCalledTimes(1);
  });

  it('重命名:菜单 → 对话框 → 保存后名称更新', async () => {
    const { designSchemes } = renderScreen(detailSeed, { actions: ALL_ACTIONS });
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');
    await waitFor(() => expect(screen.getByTestId('runtime-scheme-detail')).toBeTruthy());
    await user.click(screen.getByTestId('runtime-scheme-menu'));
    await user.click(screen.getByTestId('runtime-scheme-menu-rename'));
    const input = screen.getByTestId('scheme-rename-input');
    await user.clear(input);
    await user.type(input, '极简海报');
    await user.click(screen.getByTestId('scheme-rename-confirm'));
    await waitFor(() =>
      expect(designSchemes.rename).toHaveBeenCalledWith({
        schemeId: 'scheme-1',
        name: '极简海报',
        expectedVersion: 1,
      }),
    );
  });

  it('设为正式(草稿+成功试运行+封面):formalize 携带 confirmed:true 与当前 revision', async () => {
    const { designSchemes } = renderScreen(detailSeed, { actions: ALL_ACTIONS });
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');
    await waitFor(() => expect(screen.getByTestId('runtime-scheme-formalize')).toBeTruthy());
    await user.click(screen.getByTestId('runtime-scheme-formalize'));
    await waitFor(() =>
      expect(designSchemes.formalize).toHaveBeenCalledWith({
        schemeId: 'scheme-1',
        revisionId: 'rev-1',
        coverAssetId: 'asset-1',
        expectedVersion: 1,
        confirmed: true,
      }),
    );
  });

  it('staged 槽位编辑:模板绑定槽位禁删;可选→必需后保存生成新 revision', async () => {
    const { designSchemes } = renderScreen(detailSeed, { actions: ALL_ACTIONS });
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');
    await waitFor(() => expect(screen.getByTestId('runtime-scheme-edit-inputs')).toBeTruthy());

    await user.click(screen.getByTestId('runtime-scheme-edit-inputs'));
    expect(screen.getByTestId('runtime-scheme-inputs-editor')).toBeTruthy();
    // 被 {{subject}} 引用的槽位禁删并给理由
    const boundDelete = screen.getByTestId('runtime-scheme-input-delete-subject');
    expect(boundDelete.hasAttribute('disabled')).toBe(true);
    expect(boundDelete.getAttribute('title')).toBe('被方案提示词模板引用，不能删除');
    // 未修改时保存禁用
    expect(screen.getByTestId('runtime-scheme-inputs-save').hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByTestId('runtime-scheme-input-required-style'));
    await user.click(screen.getByTestId('runtime-scheme-inputs-save'));
    await waitFor(() => expect(designSchemes.update).toHaveBeenCalledTimes(1));
    const updateInput = designSchemes.update.mock.calls[0]?.[0] as {
      baseRevisionId: string;
      document: DesignSchemeRevisionDocument;
    };
    expect(updateInput.baseRevisionId).toBe('rev-1');
    expect(updateInput.document.parentRevisionId).toBe('rev-1');
    expect(updateInput.document.revisionId).not.toBe('rev-1');
    expect(updateInput.document.inputs.find((slot) => slot.id === 'style')?.required).toBe(true);
  });

  it('待验证新版本横幅:替换正式版本走 promoteWorkingDraft', async () => {
    const { designSchemes } = renderScreen(
      {
        schemes: [
          makeSummary({
            id: 'scheme-1',
            status: 'formal',
            hasSuccessfulTrial: true,
            coverAssetId: 'asset-1',
            workingDraftRevisionId: 'rev-2',
          }),
        ],
        documents: {
          'rev-1': makeDocument(),
          'rev-2': makeDocument({ revisionId: 'rev-2', parentRevisionId: 'rev-1' }),
        },
        assets: { 'scheme-1': [makeAsset({ id: 'asset-1' })] },
      },
      { actions: ALL_ACTIONS },
    );
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');
    await waitFor(() => expect(screen.getByTestId('runtime-scheme-working-draft')).toBeTruthy());
    expect(designSchemes.get).toHaveBeenCalledWith('scheme-1', {
      kind: 'working-draft',
      revisionId: 'rev-2',
    });
    expect(screen.getByText(/版本 rev-2/)).toBeTruthy();
    await user.click(screen.getByTestId('runtime-scheme-promote-working-draft'));
    await waitFor(() =>
      expect(designSchemes.promoteWorkingDraft).toHaveBeenCalledWith({
        schemeId: 'scheme-1',
        workingDraftRevisionId: 'rev-2',
        expectedVersion: 1,
        confirmed: true,
      }),
    );
  });

  it('正式方案菜单:导出分享包 + 检查更新(GitHub 源限定)', async () => {
    const { designSchemes } = renderScreen(
      {
        schemes: [
          makeSummary({
            id: 'scheme-1',
            status: 'formal',
            hasSuccessfulTrial: true,
            coverAssetId: 'asset-1',
            sourcePresentation: 'skill',
            sourceLabel: 'aa/bb',
          }),
        ],
        documents: {
          'rev-1': makeDocument({
            sources: [
              {
                id: 'src-1',
                kind: 'github-skill' as const,
                role: 'normative' as const,
                repositoryUrl: 'https://github.com/aa/bb',
                resolvedRef: 'main',
              },
            ],
          }),
        },
        assets: { 'scheme-1': [makeAsset({ id: 'asset-1' })] },
      },
      { actions: ALL_ACTIONS },
    );
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');
    await waitFor(() => expect(screen.getByTestId('runtime-scheme-menu')).toBeTruthy());
    await user.click(screen.getByTestId('runtime-scheme-menu'));
    expect(screen.getByTestId('runtime-scheme-menu-check-update')).toBeTruthy();
    await user.click(screen.getByTestId('runtime-scheme-menu-export'));
    await waitFor(() =>
      expect(designSchemes.exportPackage).toHaveBeenCalledWith({
        schemeId: 'scheme-1',
        formatVersion: 2,
      }),
    );
  });

  it('相册:设为封面走 selectCover;空相册给承旧引导', async () => {
    const { designSchemes } = renderScreen(detailSeed, { actions: ALL_ACTIONS });
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');
    await waitFor(() => expect(screen.getByTestId('runtime-scheme-album')).toBeTruthy());
    // 翻到第二张(非封面)后出现「设为封面」
    await user.click(screen.getByLabelText('下一张'));
    await waitFor(() => expect(screen.getByTestId('runtime-scheme-set-cover')).toBeTruthy());
    await user.click(screen.getByTestId('runtime-scheme-set-cover'));
    await waitFor(() =>
      expect(designSchemes.selectCover).toHaveBeenCalledWith({
        schemeId: 'scheme-1',
        assetId: 'asset-2',
        expectedVersion: 1,
      }),
    );
  });

  it('相册支持左右方向键环绕且不打开全屏预览', async () => {
    renderScreen(detailSeed, { actions: ALL_ACTIONS });
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');

    const album = screen.getByRole('region', { name: '方案示例相册' });
    expect(screen.getByText('1 / 2')).toBeTruthy();

    fireEvent.keyDown(album, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 2')).toBeTruthy();
    fireEvent.keyDown(album, { key: 'ArrowRight' });
    expect(screen.getByText('1 / 2')).toBeTruthy();
    fireEvent.keyDown(album, { key: 'ArrowLeft' });
    expect(screen.getByText('2 / 2')).toBeTruthy();
    expect(screen.queryByTestId('scheme-asset-lightbox')).toBeNull();
  });

  it('相册横向触控滑动切换,短滑和纵向滑动忽略,滑动后不误开全屏', async () => {
    renderScreen(detailSeed, { actions: ALL_ACTIONS });
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');

    const album = screen.getByRole('region', { name: '方案示例相册' });
    const activeButton = screen.getByLabelText('全屏查看当前示例');

    fireEvent.touchStart(album, {
      changedTouches: [{ clientX: 160, clientY: 120 }],
    });
    fireEvent.touchEnd(album, {
      changedTouches: [{ clientX: 80, clientY: 120 }],
    });
    expect(screen.getByText('2 / 2')).toBeTruthy();
    fireEvent.click(activeButton);
    expect(screen.queryByTestId('scheme-asset-lightbox')).toBeNull();

    fireEvent.touchStart(album, {
      changedTouches: [{ clientX: 80, clientY: 120 }],
    });
    fireEvent.touchEnd(album, {
      changedTouches: [{ clientX: 160, clientY: 120 }],
    });
    expect(screen.getByText('1 / 2')).toBeTruthy();

    fireEvent.touchStart(album, {
      changedTouches: [{ clientX: 160, clientY: 120 }],
    });
    fireEvent.touchEnd(album, {
      changedTouches: [{ clientX: 130, clientY: 120 }],
    });
    expect(screen.getByText('1 / 2')).toBeTruthy();

    fireEvent.touchStart(album, {
      changedTouches: [{ clientX: 160, clientY: 120 }],
    });
    fireEvent.touchEnd(album, {
      changedTouches: [{ clientX: 80, clientY: 200 }],
    });
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('单资产相册的键盘与滑动操作保持稳定', async () => {
    renderScreen(
      {
        schemes: [makeSummary({ hasSuccessfulTrial: true, coverAssetId: 'asset-1' })],
        documents: { 'rev-1': makeDocument() },
        assets: { 'scheme-1': [makeAsset({ id: 'asset-1' })] },
      },
      { actions: ALL_ACTIONS },
    );
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await openDetailFromList('scheme-1');

    const album = screen.getByRole('region', { name: '方案示例相册' });
    fireEvent.keyDown(album, { key: 'ArrowLeft' });
    fireEvent.keyDown(album, { key: 'ArrowRight' });
    fireEvent.touchStart(album, {
      changedTouches: [{ clientX: 160, clientY: 120 }],
    });
    fireEvent.touchEnd(album, {
      changedTouches: [{ clientX: 80, clientY: 120 }],
    });

    expect(screen.getByText('1 / 1')).toBeTruthy();
    expect(screen.queryByTestId('runtime-scheme-detail-error')).toBeNull();
  });

  it('详情错误:错误卡 + 返回可用', async () => {
    renderScreen(
      { schemes: [makeSummary()], documents: {} },
      { actions: ALL_ACTIONS, initialDetailId: 'scheme-1' },
    );
    await waitFor(() => expect(screen.getByTestId('runtime-scheme-detail-error')).toBeTruthy());
    expect(screen.getByText('方案读取失败')).toBeTruthy();
  });
});

describe('SchemesScreen 新建入口与历史来源', () => {
  it('新建菜单五类分发:idea/github/prompt → 工作台管线;import → 宿主对话框;history → 打开选择层', async () => {
    const actions = actionsWithSpies();
    renderScreen({ schemes: [makeSummary()] }, { actions });
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());

    await user.click(screen.getByTestId('scheme-create'));
    await user.click(screen.getByTestId('scheme-create-option-idea'));
    expect(actions.onCreateScheme).toHaveBeenCalledWith('idea');

    await user.click(screen.getByTestId('scheme-create'));
    await user.click(screen.getByTestId('scheme-create-option-github'));
    expect(actions.onCreateScheme).toHaveBeenCalledWith('github');

    await user.click(screen.getByTestId('scheme-create'));
    await user.click(screen.getByTestId('scheme-create-option-prompt'));
    expect(actions.onCreateScheme).toHaveBeenCalledWith('prompt');

    await user.click(screen.getByTestId('scheme-create'));
    await user.click(screen.getByTestId('scheme-create-option-import'));
    expect(actions.onImportScheme).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('scheme-create'));
    await user.click(screen.getByTestId('scheme-create-option-history'));
    await waitFor(() => expect(screen.getByTestId('history-source-picker')).toBeTruthy());
  });

  it('历史选择层:多选 + 提示词开关 + 提取说明 → 确认产出选择集', async () => {
    const actions = actionsWithSpies();
    renderScreen(
      {
        schemes: [],
        jobs: [
          makeJob({ id: 'job-1', userPrompt: '一只水彩风格的猫' }),
          makeJob({ id: 'job-2', userPrompt: '霓虹城市夜景' }),
        ],
      },
      { actions },
    );
    await waitFor(() => expect(screen.getByTestId('scheme-list-empty')).toBeTruthy());
    await user.click(screen.getByTestId('scheme-create'));
    await user.click(screen.getByTestId('scheme-create-option-history'));
    await waitFor(() => expect(screen.getByTestId('history-pick-job-1')).toBeTruthy());

    // 未选时确认禁用并给理由
    const confirm = screen.getByTestId('history-source-confirm');
    expect(confirm.hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByTestId('history-pick-job-1'));
    await user.click(screen.getByTestId('history-pick-job-2'));
    expect(screen.getByTestId('history-selected-count').textContent).toContain('2');

    // 关掉提示词携带 → 选择集 prompt 为 null
    await user.click(screen.getByTestId('history-include-prompts'));
    // 建议 chip 追加到说明
    await user.click(screen.getByTestId('history-suggestion-保留人物特征'));

    await user.click(screen.getByTestId('history-source-confirm'));
    await waitFor(() => expect(actions.onCreateFromHistory).toHaveBeenCalledTimes(1));
    const selection = actions.onCreateFromHistory.mock.calls[0]?.[0] as {
      items: Array<{ jobId: string; prompt: string | null }>;
      note: string;
    };
    expect(selection.items).toHaveLength(2);
    expect(selection.items[0]?.prompt).toBeNull();
    expect(selection.note).toContain('补充:保留人物特征。');
  });
});
