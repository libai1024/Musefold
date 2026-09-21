// Web 宿主设计方案路由挂载(P01-7)证据:
// - /design-schemes 页面把共享 SchemesScreen 接到云端 gateway(列表/详情确定性 CRUD);
// - ?scheme=<id> 深链打开整屏详情;
// - 集成层动作(试运行/使用/修改/创建)落到「意图 + 路由回工作台」;
// - 能力关闭时屏整体不渲染(D2 无死入口)。

import type {
  DesignSchemeDetail,
  DesignSchemeRevisionDocument,
  DesignSchemeSummary,
} from '@musefold/contracts';
import { useSchemeIntegration } from '@musefold/features/design-schemes';
import type { MusefoldGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DesignSchemesPage from '../page';

const NOW = '2026-09-01T00:00:00.000Z';
const user = userEvent.setup({ pointerEventsCheck: 0 });

const routerPush = vi.fn();
const routerReplace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  usePathname: () => '/design-schemes',
  useSearchParams: () => searchParams,
}));

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

function makeHarness(options: { capabilities?: typeof WEB_CAPABILITIES } = {}) {
  const summary = makeSummary();
  const detail: DesignSchemeDetail = {
    summary,
    document: makeDocument(),
    assets: [],
    sourceSnapshots: [],
  };
  const designSchemes = {
    list: vi.fn(async () => ({ items: [summary], nextCursor: null })),
    get: vi.fn(async () => detail),
    remove: vi.fn(async () => ({ schemeId: summary.id, removed: true as const })),
  };
  const gateway = { designSchemes } as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const enabledCapabilities = { ...WEB_CAPABILITIES, hasDesignSchemes: true };
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider
          runtime={{
            gateway,
            capabilities: options.capabilities ?? enabledCapabilities,
          }}
        >
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return { designSchemes, Providers, summary };
}

beforeEach(() => {
  routerPush.mockClear();
  routerReplace.mockClear();
  searchParams = new URLSearchParams();
  useSchemeIntegration.getState().consumeWorkbenchIntent();
});

afterEach(() => cleanup());

describe('Web /design-schemes 路由挂载', () => {
  it('方案封面消费同源图片解析接缝', async () => {
    const { Providers, summary } = makeHarness();
    summary.coverAssetId = 'cover-1';
    render(<DesignSchemesPage />, { wrapper: Providers });
    const row = await screen.findByTestId('runtime-scheme-row-scheme-1');
    expect(row.querySelector('img')?.getAttribute('src')).toBe(
      '/api/v1/design-schemes/assets/cover-1/content',
    );
  });

  it('enabled fixture:页面经云端 gateway 拉取并渲染列表', async () => {
    const enabled = { ...WEB_CAPABILITIES, hasDesignSchemes: true };
    const { designSchemes, Providers } = makeHarness({ capabilities: enabled });
    render(<DesignSchemesPage />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId('design-schemes-page')).toBeTruthy());
    await waitFor(() => expect(designSchemes.list).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
  });

  it('?scheme=<id> 深链直接打开整屏详情', async () => {
    searchParams = new URLSearchParams('scheme=scheme-1');
    const { designSchemes, Providers } = makeHarness();
    render(<DesignSchemesPage />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId('runtime-scheme-detail')).toBeTruthy());
    await waitFor(() =>
      expect(designSchemes.get).toHaveBeenCalledWith('scheme-1', { kind: 'current' }),
    );
  });

  it('详情返回清理 query 且回到列表', async () => {
    searchParams = new URLSearchParams('scheme=scheme-1');
    const { Providers } = makeHarness();
    render(<DesignSchemesPage />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId('runtime-scheme-detail')).toBeTruthy());
    await user.click(screen.getByTestId('runtime-scheme-detail-back'));

    await waitFor(() => expect(screen.getByTestId('scheme-list-workspace')).toBeTruthy());
    expect(routerReplace).toHaveBeenCalledWith('/design-schemes');
  });

  it('详情删除成功清理 query 并回到列表', async () => {
    searchParams = new URLSearchParams('scheme=scheme-1');
    const { designSchemes, Providers } = makeHarness();
    designSchemes.get.mockResolvedValueOnce({
      summary: makeSummary(),
      document: makeDocument(),
      assets: [],
      sourceSnapshots: [],
    });
    render(<DesignSchemesPage />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId('runtime-scheme-detail')).toBeTruthy());
    await user.click(screen.getByTestId('runtime-scheme-menu'));
    await user.click(screen.getByTestId('runtime-scheme-menu-remove'));
    await user.click(screen.getByTestId('scheme-list-remove-confirm'));

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/design-schemes'));
    expect(designSchemes.remove).toHaveBeenCalledWith({
      schemeId: 'scheme-1',
      expectedVersion: 1,
    });
  });

  it('非法 scheme query 不请求详情并清理地址', async () => {
    searchParams = new URLSearchParams('scheme=%20');
    const { designSchemes, Providers } = makeHarness();
    render(<DesignSchemesPage />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByTestId('scheme-list-workspace')).toBeTruthy());
    expect(designSchemes.get).not.toHaveBeenCalled();
    expect(routerReplace).toHaveBeenCalledWith('/design-schemes');
  });

  it('能力关闭时屏整体不渲染(防御:路由直达也不出死页面)', () => {
    const { designSchemes, Providers } = makeHarness({
      capabilities: { ...WEB_CAPABILITIES, hasDesignSchemes: false },
    });
    render(<DesignSchemesPage />, { wrapper: Providers });

    expect(screen.queryByTestId('design-schemes-page')).toBeNull();
    expect(designSchemes.list).not.toHaveBeenCalled();
  });

  it('列表打开详情写入 scheme query', async () => {
    const { Providers } = makeHarness();
    render(<DesignSchemesPage />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await user.click(screen.getByTestId('runtime-scheme-open-scheme-1'));
    await waitFor(() => expect(screen.getByTestId('scheme-inspector')).toBeTruthy());
    await user.click(screen.getByTestId('scheme-inspector-open-detail'));

    await waitFor(() => expect(screen.getByTestId('runtime-scheme-detail')).toBeTruthy());
    expect(routerPush).toHaveBeenCalledWith('/design-schemes?scheme=scheme-1');
  });

  it('行主动作「使用」经集成层写 attach 意图并路由回工作台', async () => {
    const { Providers } = makeHarness();
    render(<DesignSchemesPage />, { wrapper: Providers });

    await waitFor(() => expect(screen.getByText('水彩海报')).toBeTruthy());
    await user.click(screen.getByTestId('runtime-scheme-action-scheme-1'));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/workbench'));
    const intent = useSchemeIntegration.getState().consumeWorkbenchIntent();
    expect(intent?.kind).toBe('attach');
    if (intent?.kind === 'attach') {
      expect(intent.attachment.schemeId).toBe('scheme-1');
      expect(intent.attachment.mode).toBe('formal');
    }
  });
});
