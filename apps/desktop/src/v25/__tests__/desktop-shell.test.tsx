// @vitest-environment jsdom
//
// 桌面壳设计方案挂载(P01-7)与 Composer 运行缝(P01-4/P01-10)证据:
// - 导航目录随 DESKTOP_CAPABILITIES.hasDesignSchemes 注册/注销入口;
// - design-schemes 视图把 SchemesScreen 接到桌面 gateway(列表查询、media:// 封面解析);
// - 能力关闭时视图整体不渲染(D2 无死入口);
// - 工作台 designSchemes 集成 prop:导航缝(详情深链写 scheme-detail intent + 切屏)+
//   运行缝 onRun(主进程权威 prepareRun → run 原样往返,text-only)/ onCancelRun(cancel by executionId);
//   Agent 创建/修改缝(onCreate / onModify)缺省,不伪造。

import type {
  CancelDesignSchemeResult,
  DesignSchemeDetail,
  DesignSchemeRevisionDocument,
  DesignSchemeSummary,
  PrepareDesignSchemeRunInput,
  RunResult,
} from '@musefold/contracts';
import type {
  SchemeComposerHandlers,
  SchemeRunSubmission,
} from '@musefold/features/design-schemes';
import { getShellNavItems, useScreenIntent } from '@musefold/features/shell';
import type { MusefoldGateway } from '@musefold/platform';
import { DESKTOP_CAPABILITIES, PlatformProvider } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_NAV_ITEMS, DesktopView } from '../desktop-shell';

const NOW = '2026-09-01T00:00:00.000Z';

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

function makeHarness(options: {
  schemes?: DesignSchemeSummary[];
  capabilities?: typeof DESKTOP_CAPABILITIES;
  /** false = 模拟旧桥缺 prepareRun:运行缝整组缺省。 */
  prepareRun?: boolean;
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
  it('导航缝:深链写 intent 并切屏;Agent 创建/修改缝缺省(主进程 fail-closed,不伪造)', () => {
    const { Providers } = makeHarness({});
    const onOpenView = vi.fn();
    render(<DesktopView view="workbench" onOpenView={onOpenView} />, { wrapper: Providers });

    const props = lastWorkbenchSchemeProps();
    expect(props.onCreate).toBeUndefined();
    expect(props.onModify).toBeUndefined();
    expect(props.runInputSupport).toBe('text-only');
    expect(typeof props.onRun).toBe('function');
    expect(typeof props.onCancelRun).toBe('function');

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

  it('onRun fail-closed:无 Provider / 带参考图 / modify 附件不进入 prepareRun,错误可读', async () => {
    const { designSchemes, Providers } = makeHarness({});
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });
    const props = lastWorkbenchSchemeProps();

    await expect(props.onRun?.(makeRunSubmission({ providerId: undefined }))).rejects.toThrow(
      '请先在设置中连接 AI 服务商',
    );
    await expect(
      props.onRun?.(
        makeRunSubmission({
          referenceImages: [
            {
              id: 'ref_00000001',
              url: 'media://reference/ref_00000001',
              name: 'a.png',
              mimeType: 'image/png',
              byteSize: 1,
            },
          ],
        }),
      ),
    ).rejects.toThrow('当前环境的方案运行暂不支持参考图');
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

  it('旧桥缺 prepareRun:运行缝整组缺省(Composer 按 I4 禁用并解释),仍声明 text-only', () => {
    const { Providers } = makeHarness({ prepareRun: false });
    render(<DesktopView view="workbench" onOpenView={vi.fn()} />, { wrapper: Providers });

    const props = lastWorkbenchSchemeProps();
    expect(props.onRun).toBeUndefined();
    expect(props.onCancelRun).toBeUndefined();
    expect(props.runInputSupport).toBe('text-only');
  });
});
