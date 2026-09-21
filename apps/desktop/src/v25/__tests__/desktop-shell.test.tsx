// @vitest-environment jsdom
//
// 桌面壳设计方案挂载(P01-7)与 Composer 运行缝(P01-4/P01-10)证据:
// - 导航目录随 DESKTOP_CAPABILITIES.hasDesignSchemes 注册/注销入口;
// - design-schemes 视图把 SchemesScreen 接到桌面 gateway(列表查询、media:// 封面解析);
// - 能力关闭时视图整体不渲染(D2 无死入口);
// - 工作台 designSchemes 集成 prop:导航缝(详情深链写 scheme-detail intent + 切屏)+
//   运行缝 onRun(主进程权威 prepareRun → run 原样往返,text-and-images:参考图以上传暂存 id 提交)/ onCancelRun(cancel by executionId)+
//   Agent 缝 onCreate(brief / 历史来源身份 → create)/ onModify(exact revision → modify);
//   GitHub 地址在安装确认通道部署前于 renderer 拒绝并解释,不伪造。

import type {
  CancelDesignSchemeResult,
  CreateDesignSchemeInput,
  CreateDesignSchemeResult,
  DesignSchemeDetail,
  DesignSchemeRevisionDocument,
  DesignSchemeSummary,
  ModifyDesignSchemeInput,
  PrepareDesignSchemeRunInput,
  RunResult,
} from '@musefold/contracts';
import type {
  SchemeComposerHandlers,
  SchemeCreateSubmission,
  SchemeModifySubmission,
  SchemeRunSubmission,
} from '@musefold/features/design-schemes';
import { getShellNavItems, useScreenIntent } from '@musefold/features/shell';
import type { MusefoldGateway } from '@musefold/platform';
import { DESKTOP_CAPABILITIES, PlatformProvider } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_NAV_ITEMS, DesktopShellHost, DesktopView } from '../desktop-shell';

const NOW = '2026-09-01T00:00:00.000Z';

// 壳级渲染(DesktopShellHost)会挂 ThemeSync/动效闸门,它们读 matchMedia;jsdom 未提供,补最小实现。
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/** 首启引导层结构式替身:只捕获挂载与切屏回调,不跑 gate 查询(判定矩阵在 features 单测)。 */
const onboardingPropsSpy = vi.fn();
vi.mock('@musefold/features/onboarding', () => ({
  OnboardingFlow: (props: Record<string, unknown>) => {
    onboardingPropsSpy(props);
    // 真身在 gate 未放行时同样渲染 null;这里保持同构,壳的默认视图不受影响。
    return null;
  },
}));

/** WorkbenchScreen 结构式替身:只捕获集成 prop,不跑工作台数据面。 */
const workbenchPropsSpy = vi.fn();
vi.mock('@musefold/features/workbench', async (importActual) => {
  const actual = await importActual<typeof import('@musefold/features/workbench')>();
  return {
    ...actual,
    WorkbenchScreen: (props: Record<string, unknown>) => {
      workbenchPropsSpy(props);
      return <div data-testid="workbench-stub" />;
    },
  };
});

function makeSummary(overrides: Partial<DesignSchemeSummary> = {}): DesignSchemeSummary {
  return {
    id: 'scheme-1',
    name: '水彩海报',
    summary: '柔和水彩质感的活动海报配方',
    status: 'formal',
    sourcePresentation: 'musefold-created',
    sourceLabel: 'Musefold 创建',
    currentRevisionId: 'rev-1',
    version: 1,
    workingDraftRevisionId: null,
    coverAssetId: null,
    fidelity: 'faithful',
    inputLabels: [],
    hasSuccessfulTrial: true,
    lastRunAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeDocument(): DesignSchemeRevisionDocument {
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
    promptProgram: [],
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
  };
}

/** 主进程 prepareRun 的替身:把 renderer 输入原样扩展成 canonical run input(最小合法形状)。 */
function makePreparedRun(input: PrepareDesignSchemeRunInput) {
  return {
    ...input,
    priorityMode: 'scheme_first' as const,
    schemeStatus: 'formal' as const,
    schemeFidelity: 'faithful' as const,
    plan: {
      id: 'plan_1',
      schemaVersion: 1 as const,
      schemeRevisionId: input.revisionId,
      sourceSnapshotIds: [],
      inputs: [],
      steps: [],
      provider: {
        providerId: input.executionSettings.providerId,
        providerName: '测试连接',
        model: 'test-model',
        providerVersion: null,
        capabilities: { text: true, vision: false, image: true, multiImage: false, editing: false },
      },
      evaluation: { ratio: null, requiredChecks: [] },
    },
    repair: null,
  };
}

function makeRunResult(prepared: ReturnType<typeof makePreparedRun>): RunResult {
  return {
    runId: 'dsr_1',
    schemeId: prepared.schemeId,
    revisionId: prepared.revisionId,
    mode: prepared.mode,
    status: 'completed',
    compiledPrompt: 'compiled',
    outputs: [],
    steps: [],
    evaluation: null,
    repair: null,
    error: null,
    createdAt: NOW,
    completedAt: NOW,
  };
}

/** 主进程 Agent create / modify 的替身结果(canonical createDesignSchemeResult 最小合法形状)。 */
function makeAgentResult(executionId: string): CreateDesignSchemeResult {
  const summary = makeSummary({ id: `scheme-${executionId}`, status: 'draft' });
  return {
    scheme: summary,
    document: { ...makeDocument(), schemeId: summary.id },
    revisionId: 'rev-1',
    creationSummary: '已整理出可复用的方案草稿。',
    trace: [],
  };
}

function makeHarness(options: {
  schemes?: DesignSchemeSummary[];
  capabilities?: typeof DESKTOP_CAPABILITIES;
  /** false = 模拟旧桥缺 prepareRun:运行缝整组缺省。 */
  prepareRun?: boolean;
  /** false = 模拟旧桥缺 confirmInstall:GitHub 来源在 renderer 拒绝。 */
  confirmInstall?: boolean;
}) {
  const summary = options.schemes?.[0];
  const detail: DesignSchemeDetail = {
    summary: summary ?? makeSummary(),
    document: makeDocument(),
    assets: [],
    sourceSnapshots: [],
  };
  const designSchemes = {
    list: vi.fn(async () => ({ items: options.schemes ?? [], nextCursor: null })),
    get: vi.fn(async () => detail),
    prepareImportPackage: vi.fn(async () => ({ status: 'cancelled' as const })),
    ...(options.prepareRun === false
      ? {}
      : {
          prepareRun: vi.fn(async (input: PrepareDesignSchemeRunInput) => makePreparedRun(input)),
        }),
    run: vi.fn(async (prepared: ReturnType<typeof makePreparedRun>) => makeRunResult(prepared)),
    cancel: vi.fn(
      async (input: { executionId: string }): Promise<CancelDesignSchemeResult> => ({
        executionId: input.executionId,
        status: 'cancelled',
      }),
    ),
    create: vi.fn(
      async (input: CreateDesignSchemeInput): Promise<CreateDesignSchemeResult> =>
        makeAgentResult(input.executionId),
    ),
    modify: vi.fn(
      async (input: ModifyDesignSchemeInput): Promise<CreateDesignSchemeResult> =>
        makeAgentResult(input.executionId),
    ),
    ...(options.confirmInstall === false
      ? {}
      : {
          confirmInstall: vi.fn(async (input: { executionId: string }) => ({
            executionId: input.executionId,
            status: 'accepted' as const,
          })),
        }),
    subscribeEvents: vi.fn(() => vi.fn()),
  };
  const gateway = { designSchemes } as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const capabilities = options.capabilities ?? DESKTOP_CAPABILITIES;
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities }}>{children}</PlatformProvider>
      </QueryClientProvider>
    );
  }
  return { designSchemes, Providers };
}

beforeEach(() => {
  workbenchPropsSpy.mockClear();
  onboardingPropsSpy.mockClear();
  useScreenIntent.setState({ intent: null });
});

afterEach(() => cleanup());

describe('桌面壳设计方案导航挂载', () => {
  it('导航目录随 capability 注册设计方案项(单一事实源 getShellNavItems)', () => {
    expect(DESKTOP_CAPABILITIES.hasDesignSchemes).toBe(true);
    expect(DESKTOP_NAV_ITEMS).toEqual(getShellNavItems(DESKTOP_CAPABILITIES));
    expect(DESKTOP_NAV_ITEMS.map((item) => item.id)).toContain('design-schemes');
    expect(getShellNavItems({ hasDesignSchemes: false }).map((item) => item.id)).not.toContain(
      'design-schemes',
    );
  });
});

describe('桌面壳首启引导挂载(U01-onboarding)', () => {
  it('壳内挂载引导层并接宿主切屏;gate 未放行时不显示任何引导 UI', async () => {
    render(<DesktopShellHost />);

    await waitFor(() => expect(onboardingPropsSpy).toHaveBeenCalled());
    const props = onboardingPropsSpy.mock.calls.at(-1)?.[0] as {
      onOpenScreen?: (id: string) => void;
    };
    // 切屏回调复用壳自己的视图路由(setView),引导层不自建导航。
    expect(typeof props.onOpenScreen).toBe('function');
    expect(screen.queryByTestId('onboarding-flow')).toBeNull();
    expect(screen.getByTestId('v25-shell')).toBeTruthy();
  });
});

describe('桌面壳 design-schemes 视图挂载', () => {
  it('视图经桌面 gateway 拉取列表并渲染方案屏', async () => {
    const { designSchemes, Providers } = makeHarness({ schemes: [makeSummary()] });
    render(<DesktopView view="design-schemes" onOpenView={vi.fn()} />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId('design-schemes-page')).toBeTruthy());
    await waitFor(() => expect(designSchemes.list).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
  });

  it('封面资产经桌面 media:// 解析器呈现(契约 opaque id)', async () => {
    const { Providers } = makeHarness({ schemes: [makeSummary({ coverAssetId: 'asset_1' })] });
    const { container } = render(<DesktopView view="design-schemes" onOpenView={vi.fn()} />, {
      wrapper: Providers,
    });

    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    const cover = container.querySelector('img[src="media://scheme-asset/asset_1"]');
    expect(cover).not.toBeNull();
  });

  it('能力关闭时视图整体不渲染(D2 无死入口)', () => {
    const { designSchemes, Providers } = makeHarness({
      capabilities: { ...DESKTOP_CAPABILITIES, hasDesignSchemes: false },
    });
    render(<DesktopView view="design-schemes" onOpenView={vi.fn()} />, { wrapper: Providers });

    expect(screen.queryByTestId('design-schemes-page')).toBeNull();
    expect(designSchemes.list).not.toHaveBeenCalled();
  });

  it('scheme-detail 深链 intent 在视图 mount 时一次性消费并打开整屏详情', async () => {
    useScreenIntent.getState().setIntent({ kind: 'scheme-detail', schemeId: 'scheme-1' });
    const { designSchemes, Providers } = makeHarness({ schemes: [makeSummary()] });
    render(<DesktopView view="design-schemes" onOpenView={vi.fn()} />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId('runtime-scheme-detail')).toBeTruthy());
    await waitFor(() =>
      expect(designSchemes.get).toHaveBeenCalledWith('scheme-1', { kind: 'current' }),
    );
    expect(useScreenIntent.getState().intent).toBeNull();
  });
});

type WorkbenchSchemeProps = SchemeComposerHandlers & {
  onOpenDesignSchemes(detailId?: string): void;
};

function lastWorkbenchSchemeProps(): WorkbenchSchemeProps {
  const props = workbenchPropsSpy.mock.calls.at(-1)?.[0] as {
    designSchemes?: WorkbenchSchemeProps;
  };
  expect(props.designSchemes).toBeDefined();
  return props.designSchemes as WorkbenchSchemeProps;
}

function makeRunSubmission(overrides: Partial<SchemeRunSubmission> = {}): SchemeRunSubmission {
  return {
    kind: 'run',
    executionId: 'exec-1',
    workbenchSessionId: 'session-1',
    attachment: {
      schemeId: 'scheme-1',
      revisionId: 'rev-1',
      expectedVersion: makeSummary().version,
      name: '水彩海报',
      summary: '柔和水彩质感的活动海报配方',
      mode: 'formal',
      fidelity: 'faithful',
      sourceLabel: 'Musefold 创建',
      inputs: [],
      coverAssetId: null,
      hasSuccessfulTrial: true,
    },
    brief: '偏冷色',
    inputValues: { subject: '猫' },
    referenceImages: [],
    promptReferenceSelections: [],
    params: { aspectRatio: '3:4', quality: 'high', negative: '文字' },
    providerId: 'p1',
    ...overrides,
  };
}

describe('工作台 designSchemes 集成 prop(桌面)', () => {
  it('导航缝:深链写 intent 并切屏;运行缝与 Agent 缝齐备,声明 text-and-images', () => {
    const { Providers } = makeHarness({});
    const onOpenView = vi.fn();
    render(<DesktopView view="workbench" onOpenView={onOpenView} />, { wrapper: Providers });

    const props = lastWorkbenchSchemeProps();
    expect(props.runInputSupport).toBe('text-and-images');
    expect(typeof props.onRun).toBe('function');
    expect(typeof props.onCancelRun).toBe('function');
    expect(typeof props.onCreate).toBe('function');
    expect(typeof props.onModify).toBe('function');

    props.onOpenDesignSchemes('scheme-9');
    expect(onOpenView).toHaveBeenCalledWith('design-schemes');
    expect(useScreenIntent.getState().intent).toEqual({
      kind: 'scheme-detail',
      schemeId: 'scheme-9',
    });
  });

  it('无 detailId 的纯切屏不写深链 intent', () => {
    const { Providers } = makeHarness({});
    const onOpenView = vi.fn();
    render(<DesktopView view="workbench" onOpenView={onOpenView} />, { wrapper: Providers });

    lastWorkbenchSchemeProps().onOpenDesignSchemes();
    expect(onOpenView).toHaveBeenCalledWith('design-schemes');
    expect(useScreenIntent.getState().intent).toBeNull();
  });

  it('onRun:renderer 只交选择/文本/执行设置 → prepareRun → 计划原样交 run,返回终态结果', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });
    const props = lastWorkbenchSchemeProps();

    const result = await props.onRun?.(makeRunSubmission());
    expect(result?.status).toBe('completed');
    expect(result?.runId).toBe('dsr_1');

    expect(designSchemes.prepareRun).toHaveBeenCalledTimes(1);
    const prepareInput = designSchemes.prepareRun?.mock.calls[0]?.[0];
    expect(prepareInput).toEqual({
      executionId: 'exec-1',
      schemeId: 'scheme-1',
      revisionId: 'rev-1',
      mode: 'formal',
      priorityMode: 'scheme_first',
      brief: '偏冷色',
      inputValues: { subject: '猫' },
      executionSettings: {
        providerId: 'p1',
        size: 'auto',
        aspectRatio: '3:4',
        quality: 'high',
        negativePrompt: '文字',
        outputCount: 1,
        referenceAssetIds: [],
        promptReferenceSelections: [],
        workbenchSessionId: 'session-1',
      },
    });
    // renderer 不得夹带计划/快照字段:严格入参里没有 plan/schemeStatus/schemeFidelity。
    expect(prepareInput).not.toHaveProperty('plan');
    expect(prepareInput).not.toHaveProperty('schemeStatus');
    // 主进程返回的完整 canonical run input 原样交给 run(不在 renderer 二次改写)。
    const prepared = await designSchemes.prepareRun?.mock.results[0]?.value;
    expect(designSchemes.run).toHaveBeenCalledWith(prepared);
  });

  it('onRun:可选参数缺省时不夹带 undefined 键(strict schema 友好)', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });

    await lastWorkbenchSchemeProps().onRun?.(
      makeRunSubmission({ params: { quality: 'auto' }, brief: '' }),
    );
    const settings = designSchemes.prepareRun?.mock.calls[0]?.[0].executionSettings;
    expect(settings).not.toHaveProperty('aspectRatio');
    expect(settings).not.toHaveProperty('negativePrompt');
  });

  it('onRun:Composer 选择的张数随运行设置提交,不静默降为一张', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });
    await lastWorkbenchSchemeProps().onRun?.(
      makeRunSubmission({ params: { quality: 'auto', count: 4 } }),
    );
    expect(designSchemes.prepareRun?.mock.calls[0]?.[0].executionSettings.outputCount).toBe(4);
  });

  it('onRun:Composer 参考图只以上传暂存 id 进入 referenceAssetIds(去重保序),不夹带 URL / 名称 / 字节', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });

    await lastWorkbenchSchemeProps().onRun?.(
      makeRunSubmission({
        referenceImages: [
          {
            id: 'ref_00000001',
            url: 'media://local/?p=%2Fsecret%2Fa.png',
            name: 'a.png',
            mimeType: 'image/png',
            byteSize: 1,
          },
          {
            id: 'ref_00000002',
            url: 'media://local/?p=%2Fsecret%2Fb.png',
            name: 'b.png',
            mimeType: 'image/webp',
            byteSize: 2,
          },
          {
            id: 'ref_00000001',
            url: 'media://local/?p=%2Fsecret%2Fa.png',
            name: 'a.png',
            mimeType: 'image/png',
            byteSize: 1,
          },
        ],
      }),
    );
    const prepareInput = designSchemes.prepareRun?.mock
      .calls[0]?.[0] as PrepareDesignSchemeRunInput;
    expect(prepareInput.executionSettings.referenceAssetIds).toEqual([
      'ref_00000001',
      'ref_00000002',
    ]);
    expect(JSON.stringify(prepareInput)).not.toMatch(/media:\/\/|secret|a\.png|byteSize/);
  });

  it('onRun fail-closed:无 Provider / modify 附件不进入 prepareRun,错误可读', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });
    const props = lastWorkbenchSchemeProps();

    await expect(props.onRun?.(makeRunSubmission({ providerId: undefined }))).rejects.toThrow(
      '请先在设置中连接 AI 服务商',
    );
    await expect(
      props.onRun?.(
        makeRunSubmission({
          attachment: { ...makeRunSubmission().attachment, mode: 'modify' },
        }),
      ),
    ).rejects.toThrow('修改要求不走运行管线');
    expect(designSchemes.prepareRun).not.toHaveBeenCalled();
    expect(designSchemes.run).not.toHaveBeenCalled();
  });

  it('onRun:prepareRun 结构化拒绝(如 REVISION_MISMATCH)原样上抛,不调用 run', async () => {
    const { designSchemes, Providers } = makeHarness({});
    designSchemes.prepareRun?.mockRejectedValueOnce(new Error('正式运行必须使用当前正式版本'));
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });

    await expect(lastWorkbenchSchemeProps().onRun?.(makeRunSubmission())).rejects.toThrow(
      '正式运行必须使用当前正式版本',
    );
    expect(designSchemes.run).not.toHaveBeenCalled();
  });

  /** 让 run 停在进行中,以便在窗口内测试取消;返回结算函数。 */
  function holdRun(designSchemes: ReturnType<typeof makeHarness>['designSchemes']) {
    let release!: () => void;
    designSchemes.run.mockImplementationOnce(
      (prepared: ReturnType<typeof makePreparedRun>) =>
        new Promise<RunResult>((resolve) => {
          release = () => resolve(makeRunResult(prepared));
        }),
    );
    return () => release();
  }

  it('onCancelRun:运行进行中按 executionId 调 cancel;宿主已终态也正常完成,终态仍由 run 返回裁决', async () => {
    const { designSchemes, Providers } = makeHarness({});
    const releaseRun = holdRun(designSchemes);
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });
    const props = lastWorkbenchSchemeProps();

    const running = props.onRun?.(makeRunSubmission({ executionId: 'exec-7' }));
    await vi.waitFor(() => expect(designSchemes.run).toHaveBeenCalledTimes(1));
    await props.onCancelRun?.('exec-7');
    expect(designSchemes.cancel).toHaveBeenCalledWith({ executionId: 'exec-7' });

    designSchemes.cancel.mockResolvedValueOnce({
      executionId: 'exec-7',
      status: 'already-terminal' as const,
    });
    await expect(props.onCancelRun?.('exec-7')).resolves.toBeUndefined();
    releaseRun();
    expect((await running)?.status).toBe('completed');
  });

  it('onCancelRun:没有进行中的运行(陈旧/未知 executionId)是 no-op,不打主进程', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });

    await expect(lastWorkbenchSchemeProps().onCancelRun?.('exec-stale')).resolves.toBeUndefined();
    expect(designSchemes.cancel).not.toHaveBeenCalled();
  });

  it('onRun:按 executionId 订阅主进程事件驱动账本刷新,终态后退订', async () => {
    const { designSchemes, Providers } = makeHarness({});
    const unsubscribe = vi.fn();
    designSchemes.subscribeEvents.mockReturnValueOnce(unsubscribe);
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });

    await lastWorkbenchSchemeProps().onRun?.(makeRunSubmission());
    expect(designSchemes.subscribeEvents).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('取消先于主进程登记(cancel → EXECUTION_NOT_FOUND):prepareRun 返回后不再启动 run', async () => {
    const { designSchemes, Providers } = makeHarness({});
    let releasePrepare!: () => void;
    designSchemes.prepareRun?.mockImplementationOnce(
      (input: PrepareDesignSchemeRunInput) =>
        new Promise<ReturnType<typeof makePreparedRun>>((resolve) => {
          releasePrepare = () => resolve(makePreparedRun(input));
        }),
    );
    designSchemes.cancel.mockRejectedValueOnce(
      Object.assign(new Error('执行不存在或不属于当前窗口'), {
        code: 'DESIGN_SCHEME_EXECUTION_NOT_FOUND',
      }),
    );
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });
    const props = lastWorkbenchSchemeProps();

    const running = props.onRun?.(makeRunSubmission({ executionId: 'exec-race' }));
    await expect(props.onCancelRun?.('exec-race')).resolves.toBeUndefined();
    releasePrepare();

    await expect(running).rejects.toThrow('方案运行已取消');
    expect(designSchemes.run).not.toHaveBeenCalled();
  });

  it('取消真实失败(非 NOT_FOUND)原样上抛,不把进行中的执行标记为已取消', async () => {
    const { designSchemes, Providers } = makeHarness({});
    const releaseRun = holdRun(designSchemes);
    designSchemes.cancel.mockRejectedValueOnce(new Error('执行取消需要有效的 renderer 所有者'));
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });
    const props = lastWorkbenchSchemeProps();

    const running = props.onRun?.(makeRunSubmission({ executionId: 'exec-9' }));
    await vi.waitFor(() => expect(designSchemes.run).toHaveBeenCalledTimes(1));
    await expect(props.onCancelRun?.('exec-9')).rejects.toThrow(
      '执行取消需要有效的 renderer 所有者',
    );
    // 运行未被误标为已取消:照常收到主进程终态。
    releaseRun();
    expect((await running)?.status).toBe('completed');
  });

  it('旧桥缺 prepareRun:运行缝整组缺省(Composer 按 I4 禁用并解释),Agent 缝不受影响,仍声明 text-and-images', () => {
    const { Providers } = makeHarness({ prepareRun: false });
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });

    const props = lastWorkbenchSchemeProps();
    expect(props.onRun).toBeUndefined();
    expect(props.onCancelRun).toBeUndefined();
    expect(typeof props.onCreate).toBe('function');
    expect(typeof props.onModify).toBe('function');
    expect(props.runInputSupport).toBe('text-and-images');
  });

  function makeCreateSubmission(
    overrides: Partial<SchemeCreateSubmission> = {},
  ): SchemeCreateSubmission {
    return {
      kind: 'create',
      executionId: 'exec-create-1',
      createKind: 'idea',
      brief: '做一套柔和水彩质感的活动海报方案',
      source: null,
      ...overrides,
    };
  }

  it('onCreate:brief 走严格 renderer 入参 → create;不夹带预解析来源;成功后失效方案缓存', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });

    await lastWorkbenchSchemeProps().onCreate?.(makeCreateSubmission());
    expect(designSchemes.create).toHaveBeenCalledTimes(1);
    expect(designSchemes.create.mock.calls[0]?.[0]).toEqual({
      executionId: 'exec-create-1',
      brief: '做一套柔和水彩质感的活动海报方案',
      sourceUris: [],
      sourceBindings: [],
      sourcePackages: [],
      sourceSnapshots: [],
      sourceAssetIds: [],
      sourceAssets: [],
      historySources: [],
    });
    expect(designSchemes.create.mock.calls[0]?.[0]).not.toHaveProperty('document');
  });

  it('onCreate:历史来源只交 runId / assetId / includePrompt 身份,不交 URL 或提示词正文', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });

    await lastWorkbenchSchemeProps().onCreate?.(
      makeCreateSubmission({
        createKind: 'history',
        source: {
          kind: 'history',
          selection: {
            items: [
              { jobId: 'job-1', assetId: 'asset-1', assetUrl: 'media://a.png', prompt: '一只猫' },
              { jobId: 'job-2', assetId: 'asset-2', assetUrl: 'media://b.png', prompt: null },
            ],
            note: '保留构图',
          },
        },
      }),
    );
    const input = designSchemes.create.mock.calls[0]?.[0] as CreateDesignSchemeInput;
    expect(input.historySources).toEqual([
      { runId: 'job-1', assetId: 'asset-1', includePrompt: true },
      { runId: 'job-2', assetId: 'asset-2', includePrompt: false },
    ]);
    expect(JSON.stringify(input)).not.toContain('media://');
    expect(JSON.stringify(input)).not.toContain('一只猫');
  });

  it('onCreate:brief 中的 GitHub 地址提取为 sourceUris(归一为仓库地址、去重),正文剔除地址', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });

    await lastWorkbenchSchemeProps().onCreate?.(
      makeCreateSubmission({
        brief:
          '按 https://github.com/acme/zine-kit/tree/main/skills/poster 和 https://github.com/acme/zine-kit.git 做一套方案，参考 https://github.com/other/palette/blob/v2/SKILL.md。',
      }),
    );
    const input = designSchemes.create.mock.calls[0]?.[0] as CreateDesignSchemeInput;
    expect(input.sourceUris).toEqual([
      'https://github.com/acme/zine-kit',
      'https://github.com/other/palette',
    ]);
    expect(input.brief).toBe('按 和 做一套方案，参考 。');
  });

  it('onCreate:只有 GitHub 地址没有正文也能创建;非法 github.com 地址(凭据/查询参数/非仓库路径)拒绝并解释', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });
    const props = lastWorkbenchSchemeProps();

    await props.onCreate?.(makeCreateSubmission({ brief: 'https://github.com/acme/zine-kit' }));
    const urlOnly = designSchemes.create.mock.calls[0]?.[0] as CreateDesignSchemeInput | undefined;
    expect(urlOnly?.brief).toBe('');
    expect(urlOnly?.sourceUris).toEqual(['https://github.com/acme/zine-kit']);

    for (const brief of [
      'https://user:token@github.com/acme/zine-kit',
      'https://github.com/acme/zine-kit?ref=main',
      'https://github.com/acme/zine-kit/issues/1',
      'https://github.com/acme',
    ]) {
      await expect(props.onCreate?.(makeCreateSubmission({ brief }))).rejects.toThrow(
        /GitHub 地址/,
      );
    }
    expect(designSchemes.create).toHaveBeenCalledTimes(1);
  });

  it('旧桥缺 confirmInstall:brief 含 GitHub 地址在 renderer 即拒绝并解释,不进入 create', async () => {
    const { designSchemes, Providers } = makeHarness({ confirmInstall: false });
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });

    await expect(
      lastWorkbenchSchemeProps().onCreate?.(
        makeCreateSubmission({ brief: '按 https://github.com/acme/zine-kit 做一套方案' }),
      ),
    ).rejects.toThrow('安装确认通道');
    expect(designSchemes.create).not.toHaveBeenCalled();
  });

  it('onCreate fail-closed:空输入 / 历史资产缺 id 都不进入 create,错误可读', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });
    const props = lastWorkbenchSchemeProps();

    await expect(props.onCreate?.(makeCreateSubmission({ brief: '   ' }))).rejects.toThrow(
      '请描述你的方案想法',
    );
    await expect(
      props.onCreate?.(
        makeCreateSubmission({
          createKind: 'history',
          source: {
            kind: 'history',
            selection: {
              items: [{ jobId: 'job-1', assetId: '', assetUrl: '', prompt: null }],
              note: '',
            },
          },
        }),
      ),
    ).rejects.toThrow('历史作品');
    expect(designSchemes.create).not.toHaveBeenCalled();
  });

  it('onCreate:主进程结构化拒绝(如 AGENT_AI_UNAVAILABLE)原样上抛', async () => {
    const { designSchemes, Providers } = makeHarness({});
    designSchemes.create.mockRejectedValueOnce(
      new Error('设计方案 Agent 需要可用的文本模型连接(chat/completions)。'),
    );
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });

    await expect(lastWorkbenchSchemeProps().onCreate?.(makeCreateSubmission())).rejects.toThrow(
      '文本模型连接',
    );
  });

  it('onModify:基线锁定挂载附件的 exact revision,指令取正文;空指令不进入 modify', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });
    const props = lastWorkbenchSchemeProps();
    const submission: SchemeModifySubmission = {
      kind: 'modify',
      executionId: 'exec-modify-1',
      attachment: { ...makeRunSubmission().attachment, mode: 'modify', revisionId: 'rev-wd' },
      brief: '  把默认比例改成 3:4  ',
    };

    await props.onModify?.(submission);
    expect(designSchemes.modify).toHaveBeenCalledWith({
      executionId: 'exec-modify-1',
      schemeId: 'scheme-1',
      baseRevisionId: 'rev-wd',
      instruction: '把默认比例改成 3:4',
    } satisfies ModifyDesignSchemeInput);

    await expect(props.onModify?.({ ...submission, brief: '  ' })).rejects.toThrow(
      '请描述要修改的内容',
    );
    expect(designSchemes.modify).toHaveBeenCalledTimes(1);
  });
});

describe('桌面壳 Win/Linux 窗口控件(B2-T6)', () => {
  const originalPlatform = navigator.platform;

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
    delete window.musefoldV25;
  });

  function stubPlatform(platform: string) {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: platform,
    });
  }

  function installBridge() {
    const bridge = {
      minimize: vi.fn(),
      maximizeToggle: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
      onMaximizeChange: vi.fn(() => () => {}),
    };
    Object.defineProperty(window, 'musefoldV25', {
      configurable: true,
      writable: true,
      value: bridge,
    });
    return bridge;
  }

  it('IS_MAC=false:主区右上注入三钮,点击转发 musefoldV25', async () => {
    stubPlatform('Win32');
    const bridge = installBridge();
    render(<DesktopShellHost />);

    expect(screen.getByTestId('window-controls-band')).toBeTruthy();
    expect(screen.getByTestId('mainview-surface').hasAttribute('data-window-controls-safe')).toBe(
      true,
    );
    expect(screen.getByTestId('window-control-minimize').getAttribute('aria-label')).toBe('最小化');
    fireEvent.click(screen.getByTestId('window-control-minimize'));
    expect(bridge.minimize).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('window-control-close'));
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });

  it('mac:不渲染窗口控件(原生红绿灯)', () => {
    stubPlatform('MacIntel');
    installBridge();
    render(<DesktopShellHost />);
    expect(screen.queryByTestId('window-controls')).toBeNull();
    expect(screen.queryByTestId('window-controls-band')).toBeNull();
    expect(screen.getByTestId('mainview-surface').hasAttribute('data-window-controls-safe')).toBe(
      false,
    );
  });
});
