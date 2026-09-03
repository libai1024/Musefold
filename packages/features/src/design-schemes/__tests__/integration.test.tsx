import type {
  DesignSchemeDetail,
  DesignSchemeRevisionDocument,
  DesignSchemeSummary,
} from '@musefold/contracts';
import type { DesignSchemesGateway, MusefoldGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesignSchemesIntegration } from '../integration';
import { useSchemeIntegration } from '../integration-store';

const NOW = '2026-08-30T08:00:00.000Z';
const CAPABILITIES = { ...WEB_CAPABILITIES, hasDesignSchemes: true };

function makeSummary(overrides: Partial<DesignSchemeSummary> = {}): DesignSchemeSummary {
  return {
    id: 'scheme-1',
    name: '水彩海报',
    summary: '柔和水彩质感的活动海报配方',
    status: 'formal',
    sourcePresentation: 'musefold-created',
    sourceLabel: 'Musefold 创建',
    currentRevisionId: 'rev-1',
    version: 3,
    workingDraftRevisionId: null,
    coverAssetId: null,
    fidelity: 'faithful',
    inputLabels: ['subject'],
    hasSuccessfulTrial: true,
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
    inputs: [{ id: 'subject', label: 'subject', kind: 'text', required: true }],
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

function makeGateway(designSchemes: Partial<DesignSchemesGateway> | null) {
  const gateway = {
    ...(designSchemes ? { designSchemes: designSchemes as DesignSchemesGateway } : {}),
  } as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider
          runtime={{
            gateway,
            capabilities: designSchemes ? CAPABILITIES : WEB_CAPABILITIES,
          }}
        >
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return Wrapper;
}

beforeEach(() => {
  useSchemeIntegration.getState().consumeWorkbenchIntent();
});

describe('useDesignSchemesIntegration 接缝闸门', () => {
  it('域能力关闭/适配器缺失时返回空动作集(上游入口禁用并解释,不留死按钮)', () => {
    const { result } = renderHook(() => useDesignSchemesIntegration({ onOpenWorkbench: vi.fn() }), {
      wrapper: makeGateway(null),
    });
    expect(result.current).toEqual({});
  });

  it('宿主未给切屏回调时返回空动作集(意图无法落地,宁可禁用)', () => {
    const { result } = renderHook(() => useDesignSchemesIntegration({}), {
      wrapper: makeGateway({ get: vi.fn() }),
    });
    expect(result.current).toEqual({});
  });

  it('不提供导入/市场安装接缝(宿主文件对话框与 staging 职责)', () => {
    const { result } = renderHook(() => useDesignSchemesIntegration({ onOpenWorkbench: vi.fn() }), {
      wrapper: makeGateway({ get: vi.fn(async () => ({}) as DesignSchemeDetail) }),
    });
    expect(result.current.onImportScheme).toBeUndefined();
    expect(result.current.onInstallMarketCandidate).toBeUndefined();
  });
});

describe('useDesignSchemesIntegration 意图流', () => {
  function readyHarness() {
    const detail: DesignSchemeDetail = {
      summary: makeSummary(),
      document: makeDocument(),
      assets: [],
      sourceSnapshots: [],
    };
    const get = vi.fn(async () => detail);
    const onOpenWorkbench = vi.fn();
    const wrapper = makeGateway({ get });
    return { get, onOpenWorkbench, wrapper };
  }

  it('onRunScheme:解析附件 → attach 意图(正式=formal/草稿=trial 由调用方定)→ 切工作台', async () => {
    const { get, onOpenWorkbench, wrapper } = readyHarness();
    const { result } = renderHook(() => useDesignSchemesIntegration({ onOpenWorkbench }), {
      wrapper,
    });
    result.current.onRunScheme?.(makeSummary(), 'formal');
    await waitFor(() => expect(onOpenWorkbench).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith('scheme-1', { kind: 'current' });
    const intent = useSchemeIntegration.getState().consumeWorkbenchIntent();
    expect(intent?.kind).toBe('attach');
    if (intent?.kind === 'attach') {
      expect(intent.attachment.mode).toBe('formal');
      expect(intent.attachment.revisionId).toBe('rev-1');
      expect(intent.attachment.inputs[0]?.required).toBe(true);
    }
  });

  it('onModifyScheme:attach 意图 mode=modify', async () => {
    const { onOpenWorkbench, wrapper } = readyHarness();
    const { result } = renderHook(() => useDesignSchemesIntegration({ onOpenWorkbench }), {
      wrapper,
    });
    result.current.onModifyScheme?.(makeSummary({ status: 'draft' }));
    await waitFor(() => expect(onOpenWorkbench).toHaveBeenCalledTimes(1));
    const intent = useSchemeIntegration.getState().consumeWorkbenchIntent();
    expect(intent?.kind === 'attach' && intent.attachment.mode).toBe('modify');
  });

  it('onCreateScheme:写 create 意图(空种子,不占正文)并切屏', () => {
    const { onOpenWorkbench, wrapper } = readyHarness();
    const { result } = renderHook(() => useDesignSchemesIntegration({ onOpenWorkbench }), {
      wrapper,
    });
    result.current.onCreateScheme?.('github');
    expect(onOpenWorkbench).toHaveBeenCalledTimes(1);
    expect(useSchemeIntegration.getState().consumeWorkbenchIntent()).toEqual({
      kind: 'create',
      createKind: 'github',
      seed: '',
      source: null,
    });
  });

  it('onCreateFromHistory:选择集原样保留为来源,种子 = 提取说明', () => {
    const { onOpenWorkbench, wrapper } = readyHarness();
    const { result } = renderHook(() => useDesignSchemesIntegration({ onOpenWorkbench }), {
      wrapper,
    });
    const selection = {
      items: [
        {
          jobId: 'job-1',
          assetId: 'asset-1',
          assetUrl: 'media://a.png',
          prompt: '一只水彩风格的猫',
        },
      ],
      note: '保留构图，不保留主体。',
    };
    result.current.onCreateFromHistory?.(selection);
    expect(onOpenWorkbench).toHaveBeenCalledTimes(1);
    const intent = useSchemeIntegration.getState().consumeWorkbenchIntent();
    expect(intent).toEqual({
      kind: 'create',
      createKind: 'history',
      seed: '保留构图，不保留主体。',
      source: { kind: 'history', selection },
    });
  });

  it('附件解析失败:不写意图不切屏(错误已由 toast 呈现)', async () => {
    const get = vi.fn(async () => {
      throw new Error('REVISION_NOT_FOUND');
    });
    const onOpenWorkbench = vi.fn();
    const { result } = renderHook(() => useDesignSchemesIntegration({ onOpenWorkbench }), {
      wrapper: makeGateway({ get }),
    });
    result.current.onRunScheme?.(makeSummary(), 'trial');
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    // 给微任务一轮时间确认没有后续动作。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onOpenWorkbench).not.toHaveBeenCalled();
    expect(useSchemeIntegration.getState().workbenchIntent).toBeNull();
  });
});
