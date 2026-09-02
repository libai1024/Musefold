import type {
  DesignSchemeDetail,
  DesignSchemeRevisionDocument,
  DesignSchemeSummary,
  GenerationJob,
  WorkbenchSession,
} from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type SchemeComposerSubmission,
  useSchemeIntegration,
} from '../../design-schemes/integration-store';
import { WorkbenchScreen } from '../WorkbenchScreen';

const user = userEvent.setup({ pointerEventsCheck: 0 });
const NOW = '2026-08-30T08:00:00.000Z';
const SCHEME_CAPABILITIES = { ...WEB_CAPABILITIES, hasDesignSchemes: true };

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
    inputLabels: ['主题'],
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
    inputs: [{ id: 'subject', label: '主题', kind: 'text', required: true, description: '主体' }],
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

/** 内存 gateway:工作台/生图最小闭环 + 方案域适配器;generation.create 间谍用于「不伪造」断言。 */
function createMemoryGateway(seed?: { schemes?: DesignSchemeSummary[] }) {
  let seq = 0;
  const sessions = new Map<string, WorkbenchSession>();
  const generationCreate = vi.fn(async (input: { prompt: string }): Promise<GenerationJob> => {
    seq += 1;
    return {
      id: `job-${seq}`,
      sessionId: null,
      parentRunId: null,
      promptId: null,
      userPrompt: input.prompt,
      promptReferences: [],
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'queued',
      progress: 0,
      request: {
        prompt: input.prompt,
        size: 'auto',
        quality: 'auto',
        count: 1,
        referenceImages: [],
      },
      providerModel: 'test-model',
      costPoints: null,
      assets: [],
      error: null,
      createdAt: NOW,
      startedAt: null,
      finishedAt: null,
      deletedAt: null,
    } as GenerationJob;
  });
  const schemes = seed?.schemes ?? [];
  const designSchemes = {
    list: vi.fn(async () => ({ items: schemes, nextCursor: null })),
    get: vi.fn(
      async (id: string): Promise<DesignSchemeDetail> => ({
        summary: schemes.find((scheme) => scheme.id === id) ?? makeSummary({ id }),
        document: makeDocument({ schemeId: id }),
        assets: [],
        sourceSnapshots: [],
      }),
    ),
  };
  const gateway = {
    workbench: {
      listSessions: async () => ({ items: [...sessions.values()], nextCursor: null }),
      createSession: async (input: { title?: string }) => {
        seq += 1;
        const session = {
          id: `session-${seq}`,
          title: input.title ?? '未命名创作',
          draft: {
            prompt: '',
            negative: '',
            params: {},
            promptReferenceSelections: [],
            promptReferenceIds: [],
          },
          version: 1,
          createdAt: NOW,
          updatedAt: NOW,
          archivedAt: null,
          deletedAt: null,
          latestJobStatus: null,
          latestJobFinishedAt: null,
        } as WorkbenchSession;
        sessions.set(session.id, session);
        return session;
      },
      getSession: async (id: string) => {
        const session = sessions.get(id);
        if (!session) throw new Error('NOT_FOUND');
        return session;
      },
      updateSession: async (id: string) => {
        const session = sessions.get(id);
        if (!session) throw new Error('NOT_FOUND');
        return session;
      },
      removeSession: async () => {
        throw new Error('unused');
      },
      restoreSession: async () => {
        throw new Error('unused');
      },
    },
    generation: {
      create: generationCreate,
      list: async () => ({ items: [], nextCursor: null }),
      get: async () => {
        throw new Error('NOT_FOUND');
      },
      cancel: async () => {
        throw new Error('unused');
      },
      retry: async () => {
        throw new Error('unused');
      },
      remove: async () => {
        throw new Error('unused');
      },
      restore: async () => {
        throw new Error('unused');
      },
      purge: async () => {},
      listProviders: async () => [
        { id: 'p1', label: '测试连接', model: 'test-model', kind: 'local', available: true },
      ],
      uploadReferenceImage: async () => {
        throw new Error('unused');
      },
      saveAsset: async () => 'saved' as const,
    },
    designSchemes,
  } as unknown as MusefoldGateway;
  return { gateway, designSchemes, generationCreate };
}

interface RenderOptions {
  submissions?: SchemeComposerSubmission[];
  /** false = 宿主完全未接方案域(prop 缺省);'no-submit' = 只接导航不接运行缝。 */
  integration?: 'full' | 'no-submit' | 'none';
  schemes?: DesignSchemeSummary[];
}

function renderWorkbench(options: RenderOptions = {}) {
  const memory = createMemoryGateway({ schemes: options.schemes });
  const submissions: SchemeComposerSubmission[] = options.submissions ?? [];
  const onOpenDesignSchemes = vi.fn();
  const designSchemesProp =
    options.integration === 'none'
      ? undefined
      : {
          onOpenDesignSchemes,
          ...(options.integration === 'no-submit'
            ? {}
            : { onSubmit: (submission: SchemeComposerSubmission) => submissions.push(submission) }),
        };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway: memory.gateway, capabilities: SCHEME_CAPABILITIES }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return {
    ...memory,
    onOpenDesignSchemes,
    ...render(<WorkbenchScreen designSchemes={designSchemesProp} />, { wrapper: Providers }),
  };
}

beforeEach(() => {
  useSchemeIntegration.getState().consumeWorkbenchIntent();
});

describe('WorkbenchScreen 方案入口闸门', () => {
  it('宿主未接方案域(prop 缺省):能力开也不出现方案菜单项(D2)', async () => {
    renderWorkbench({ integration: 'none' });
    await waitFor(() => expect(screen.getByTestId('composer-attach')).toBeTruthy());
    await user.click(screen.getByTestId('composer-attach'));
    await screen.findByTestId('workbench-image-picker');
    expect(screen.queryByTestId('workbench-context-ref-scheme')).toBeNull();
    expect(screen.queryByTestId('composer-menu-design-plan')).toBeNull();
  });

  it('接入后菜单四项齐备;「寻找设计方案」调宿主切屏回调', async () => {
    const { onOpenDesignSchemes } = renderWorkbench({ integration: 'full' });
    await waitFor(() => expect(screen.getByTestId('composer-attach')).toBeTruthy());
    await user.click(screen.getByTestId('composer-attach'));
    expect(await screen.findByTestId('workbench-context-ref-scheme')).toBeTruthy();
    expect(screen.getByTestId('composer-menu-design-plan')).toBeTruthy();
    expect(screen.getByTestId('workbench-context-history-source')).toBeTruthy();
    await user.click(screen.getByTestId('workbench-context-find-scheme'));
    expect(onOpenDesignSchemes).toHaveBeenCalledTimes(1);
  });

  it('只接导航不接运行缝:创建项禁用并解释,附件可挂载但提交禁用(不伪造)', async () => {
    renderWorkbench({ integration: 'no-submit' });
    await waitFor(() => expect(screen.getByTestId('composer-attach')).toBeTruthy());
    await user.click(screen.getByTestId('composer-attach'));
    expect(
      (await screen.findByTestId('composer-menu-design-plan')).getAttribute('aria-disabled'),
    ).toBe('true');

    // 跨屏「试运行」意图照常落地,但提交钮给出理由而非伪造运行。
    useSchemeIntegration.getState().setWorkbenchIntent({
      kind: 'attach',
      attachment: {
        schemeId: 'scheme-1',
        revisionId: 'rev-1',
        name: '水彩海报',
        summary: '柔和水彩质感的活动海报配方',
        mode: 'trial',
        fidelity: 'faithful',
        sourceLabel: 'Musefold 创建',
        inputs: [],
        coverAssetId: null,
        hasSuccessfulTrial: false,
      },
    });
    await waitFor(() => expect(screen.getByTestId('scheme-run-attachment')).toBeTruthy());
    const submit = screen.getByTestId('composer-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('title')).toBe('当前环境暂未接入方案运行');
  });
});

describe('WorkbenchScreen 方案选择器与运行提交', () => {
  it('「设计方案」选择器:列出正式方案 → 选中挂载附件 → 集齐必需输入后提交到运行缝', async () => {
    const submissions: SchemeComposerSubmission[] = [];
    renderWorkbench({ integration: 'full', submissions, schemes: [makeSummary()] });
    await waitFor(() => expect(screen.getByTestId('composer-attach')).toBeTruthy());

    await user.click(screen.getByTestId('composer-attach'));
    await user.click(await screen.findByTestId('workbench-context-ref-scheme'));
    await waitFor(() => expect(screen.getByTestId('scheme-run-picker')).toBeTruthy());
    await user.click(await screen.findByTestId('scheme-run-pick-scheme-1'));

    // 附件挂载:必填槽位未填,提交禁用。
    await waitFor(() => expect(screen.getByTestId('scheme-run-attachment')).toBeTruthy());
    expect(screen.getByTestId('scheme-run-attachment').getAttribute('data-mode')).toBe('formal');
    expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(true);

    await user.type(await screen.findByTestId('scheme-run-variable-subject'), '猫');
    const submit = screen.getByTestId('composer-submit') as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    await user.click(submit);

    expect(submissions).toHaveLength(1);
    const submission = submissions[0];
    expect(submission?.kind).toBe('run');
    if (submission?.kind === 'run') {
      expect(submission.attachment.schemeId).toBe('scheme-1');
      expect(submission.attachment.mode).toBe('formal');
      expect(submission.inputValues).toEqual({ subject: '猫' });
      expect(submission.providerId).toBe('p1');
      expect(submission.params.quality).toBe('auto');
    }
    // 附件保留支持多轮;正文已清。
    expect(screen.getByTestId('scheme-run-attachment')).toBeTruthy();
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe('');
  });
});

describe('WorkbenchScreen 跨屏方案意图消费', () => {
  it('create 意图(提示词库「创建方案」):种子进正文 + 创建态芯片带来源;提交走创建缝不碰普通生成', async () => {
    const submissions: SchemeComposerSubmission[] = [];
    const { generationCreate } = renderWorkbench({ integration: 'full', submissions });
    useSchemeIntegration.getState().setWorkbenchIntent({
      kind: 'create',
      createKind: 'prompt',
      seed: '把这段提示词整理成一个可以反复使用的方案，区分固定规则、必需变量和本次补充。\n\n画一只水彩猫',
      source: { kind: 'prompt', promptId: 'p-1', title: '水彩猫' },
    });

    await waitFor(() =>
      expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toContain(
        '画一只水彩猫',
      ),
    );
    expect(screen.getByTestId('composer-scheme-creation-source').textContent).toBe('来源:水彩猫');
    expect(useSchemeIntegration.getState().workbenchIntent).toBeNull();

    await user.click(screen.getByTestId('composer-submit'));
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toEqual({
      kind: 'create',
      createKind: 'prompt',
      brief:
        '把这段提示词整理成一个可以反复使用的方案，区分固定规则、必需变量和本次补充。\n\n画一只水彩猫',
      source: { kind: 'prompt', promptId: 'p-1', title: '水彩猫' },
    });
    // 绝不伪造:普通生成通道零调用。
    expect(generationCreate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('composer-scheme-creation')).toBeNull());
  });

  it('attach 意图(方案中心「试运行」):挂载草稿为试运行模式;修改意图走 modify 提交', async () => {
    const submissions: SchemeComposerSubmission[] = [];
    renderWorkbench({ integration: 'full', submissions });
    useSchemeIntegration.getState().setWorkbenchIntent({
      kind: 'attach',
      attachment: {
        schemeId: 'scheme-2',
        revisionId: 'rev-9',
        name: '霓虹城市',
        summary: '夜景配方',
        mode: 'modify',
        fidelity: 'adapted',
        sourceLabel: 'aa/bb',
        inputs: [],
        coverAssetId: null,
        hasSuccessfulTrial: true,
      },
    });
    await waitFor(() => expect(screen.getByTestId('scheme-run-attachment')).toBeTruthy());
    expect(screen.getByTestId('scheme-run-attachment').getAttribute('data-mode')).toBe('modify');

    // 修改要求以正文为 brief;空正文禁用。
    expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByTestId('composer-prompt'), '把默认比例改成 3:4');
    await user.click(screen.getByTestId('composer-submit'));
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({ kind: 'modify', brief: '把默认比例改成 3:4' });
  });
});
