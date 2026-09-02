// @vitest-environment jsdom
//
// 桌面壳设计方案挂载(P01-7)证据:
// - 导航目录随 DESKTOP_CAPABILITIES.hasDesignSchemes 注册/注销入口;
// - design-schemes 视图把 SchemesScreen 接到桌面 gateway(列表查询、media:// 封面解析);
// - 能力关闭时视图整体不渲染(D2 无死入口);
// - 工作台 designSchemes 集成 prop:只接导航缝(详情深链写 scheme-detail intent + 切屏),
//   不接运行缝(onSubmit 缺省,提交禁用并解释,不伪造方案运行)。

import type {
  DesignSchemeDetail,
  DesignSchemeRevisionDocument,
  DesignSchemeSummary,
} from '@musefold/contracts';
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

function makeHarness(options: {
  schemes?: DesignSchemeSummary[];
  capabilities?: typeof DESKTOP_CAPABILITIES;
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

describe('工作台 designSchemes 集成 prop(桌面)', () => {
  it('只接导航缝:不接运行缝,深链写 intent 并切屏', () => {
    const { Providers } = makeHarness({});
    const onOpenView = vi.fn();
    render(<DesktopView view="workbench" onOpenView={onOpenView} />, { wrapper: Providers });

    const props = workbenchPropsSpy.mock.calls.at(-1)?.[0] as {
      designSchemes?: { onOpenDesignSchemes(detailId?: string): void; onSubmit?: unknown };
    };
    expect(props.designSchemes).toBeDefined();
    // 运行缝缺省:方案运行/创建/修改的桌面固定 plan 组装管线未落地,不伪造。
    expect(props.designSchemes?.onSubmit).toBeUndefined();

    props.designSchemes?.onOpenDesignSchemes('scheme-9');
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

    const props = workbenchPropsSpy.mock.calls.at(-1)?.[0] as {
      designSchemes?: { onOpenDesignSchemes(detailId?: string): void };
    };
    props.designSchemes?.onOpenDesignSchemes();
    expect(onOpenView).toHaveBeenCalledWith('design-schemes');
    expect(useScreenIntent.getState().intent).toBeNull();
  });
});
