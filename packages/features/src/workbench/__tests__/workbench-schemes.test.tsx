import type {
  DesignSchemeDetail,
  DesignSchemeEvent,
  DesignSchemeRevisionDocument,
  DesignSchemeSummary,
  GenerationJob,
  RunResult,
  WorkbenchSession,
} from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type SchemeComposerHandlers,
  type SchemeComposerSubmission,
  type SchemeRunSubmission,
  type SchemeWorkbenchIntent,
  useSchemeIntegration,
} from '../../design-schemes/integration-store';
import { useActiveSession } from '../session-store';
import { WorkbenchScreen } from '../WorkbenchScreen';

const user = userEvent.setup({ pointerEventsCheck: 0 });
const NOW = '2026-08-30T08:00:00.000Z';
const SCHEME_CAPABILITIES = { ...WEB_CAPABILITIES, hasDesignSchemes: true };

/** 宿主运行缝的终态结果替身(canonical RunResult 最小合法形状)。 */
function makeRunResult(
  submission: SchemeRunSubmission,
  overrides: Partial<RunResult> = {},
): RunResult {
  return {
    runId: 'run-1',
    schemeId: submission.attachment.schemeId,
    revisionId: submission.attachment.revisionId,
    mode: submission.attachment.mode === 'modify' ? 'trial' : submission.attachment.mode,
    status: 'completed',
    compiledPrompt: '画一幅 猫 的水彩海报',
    outputs: [],
    steps: [],
    evaluation: null,
    repair: null,
    error: null,
    createdAt: NOW,
    completedAt: NOW,
    ...overrides,
  };
}

/** 可从测试外部结算的 deferred,用来卡住运行中状态。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
function createMemoryGateway(seed?: { schemes?: DesignSchemeSummary[]; confirmInstall?: boolean }) {
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
  // 事件总线替身:宿主(测试)经 emitEvent 推送 canonical 事件,屏内订阅者按 executionId 过滤。
  const listeners = new Set<(event: DesignSchemeEvent) => void>();
  const emitEvent = (event: DesignSchemeEvent) => {
    for (const listener of listeners) listener(event);
  };
  const confirmInstall = vi.fn(
    async (input: { executionId: string; decision: 'install' | 'cancel' }) => ({
      executionId: input.executionId,
      status: input.decision === 'install' ? ('accepted' as const) : ('cancelled' as const),
    }),
  );
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
    subscribeEvents: vi.fn((listener: (event: DesignSchemeEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    ...(seed?.confirmInstall === false ? {} : { confirmInstall }),
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
  return { gateway, designSchemes, generationCreate, emitEvent, confirmInstall };
}

interface RenderOptions {
  submissions?: SchemeComposerSubmission[];
  /**
   * 'full' = 三条生命周期接缝齐备(run 立即成功);'no-submit' = 只接导航不接任何提交缝;
   * 'none' = 宿主完全未接方案域(prop 缺省)。handlers 可覆盖个别接缝(如卡住运行、text-only)。
   */
  integration?: 'full' | 'no-submit' | 'none';
  handlers?: Partial<SchemeComposerHandlers>;
  schemes?: DesignSchemeSummary[];
  /** false = 宿主 gateway 无 confirmInstall(如云端):不弹安装确认层。 */
  confirmInstall?: boolean;
}

function renderWorkbench(options: RenderOptions = {}) {
  const memory = createMemoryGateway({
    schemes: options.schemes,
    confirmInstall: options.confirmInstall,
  });
  const submissions: SchemeComposerSubmission[] = options.submissions ?? [];
  const onOpenDesignSchemes = vi.fn();
  const fullHandlers: SchemeComposerHandlers = {
    onRun: async (submission) => {
      submissions.push(submission);
      return makeRunResult(submission);
    },
    onCreate: async (submission) => {
      submissions.push(submission);
    },
    onModify: async (submission) => {
      submissions.push(submission);
    },
  };
  const designSchemesProp =
    options.integration === 'none'
      ? undefined
      : {
          onOpenDesignSchemes,
          ...(options.integration === 'no-submit' ? {} : fullHandlers),
          ...options.handlers,
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

function setSchemeWorkbenchIntent(intent: SchemeWorkbenchIntent): void {
  act(() => useSchemeIntegration.getState().setWorkbenchIntent(intent));
}

beforeEach(() => {
  useSchemeIntegration.getState().consumeWorkbenchIntent();
  // 运行提交会在草稿态首次建会话并置为活动会话;跨测试残留会让下一屏先按陈旧 id 拉账本再回落,
  // Composer 随之在骨架/空态分支间重挂载,打开中的菜单被销毁。每测从干净指针开始。
  useActiveSession.setState({
    activeSessionId: null,
    draftSession: false,
    pendingDraft: null,
    draftParamOverrides: {},
  });
});

/**
 * 「+」菜单 →「设计方案」选择器 → 选中 scheme-1 挂载附件。
 * 挂载后组件按承旧语义把焦点送回正文(rAF),先等它落地再往槽位输入打字,避免键入被抢焦。
 */
async function attachSchemeViaPicker(schemeId = 'scheme-1') {
  await waitFor(() => expect(screen.getByTestId('composer-attach')).toBeTruthy());
  await user.click(screen.getByTestId('composer-attach'));
  await user.click(await screen.findByTestId('workbench-context-ref-scheme'));
  await waitFor(() => expect(screen.getByTestId('scheme-run-picker')).toBeTruthy());
  await user.click(await screen.findByTestId(`scheme-run-pick-${schemeId}`));
  await waitFor(() => expect(screen.getByTestId('scheme-run-attachment')).toBeTruthy());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('composer-prompt')));
}

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
    setSchemeWorkbenchIntent({
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
    await attachSchemeViaPicker();

    // 附件挂载:必填槽位未填,提交禁用。
    expect(screen.getByTestId('scheme-run-attachment').getAttribute('data-mode')).toBe('formal');
    expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(true);

    await user.type(await screen.findByTestId('scheme-run-variable-subject'), '猫');
    const submit = screen.getByTestId('composer-submit') as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    await user.click(submit);

    await waitFor(() => expect(submissions).toHaveLength(1));
    const submission = submissions[0];
    expect(submission?.kind).toBe('run');
    if (submission?.kind === 'run') {
      expect(submission.attachment.schemeId).toBe('scheme-1');
      expect(submission.attachment.mode).toBe('formal');
      expect(submission.inputValues).toEqual({ subject: '猫' });
      expect(submission.providerId).toBe('p1');
      expect(submission.params.quality).toBe('auto');
      // 运行落在会话账本:草稿态首次运行先建会话,submission 携带会话 id。
      expect(submission.workbenchSessionId).toMatch(/^session-/);
      expect(submission.executionId).toMatch(/[0-9a-f-]{36}/);
    }
    // 终态成功后复位:附件保留支持多轮;正文与槽位值已清。
    await waitFor(() =>
      expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(''),
    );
    expect(screen.getByTestId('scheme-run-attachment')).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByTestId('scheme-run-variable-subject') as HTMLInputElement).value).toBe(
        '',
      ),
    );
    expect(screen.queryByTestId('scheme-submit-error')).toBeNull();
  });

  it('运行中:提交钮转停止钮并经 onCancelRun(executionId) 取消;取消终态不报错、输入保留', async () => {
    const submissions: SchemeComposerSubmission[] = [];
    const pending = deferred<RunResult>();
    const onCancelRun = vi.fn(async (executionId: string) => {
      const submission = submissions[0];
      if (submission?.kind === 'run') {
        expect(executionId).toBe(submission.executionId);
        pending.resolve(
          makeRunResult(submission, {
            status: 'cancelled',
            error: {
              code: 'CANCELLED',
              message: '已取消',
              retryable: false,
              recoveryAction: 'none',
            },
          }),
        );
      }
    });
    renderWorkbench({
      integration: 'full',
      submissions,
      schemes: [makeSummary()],
      handlers: {
        onRun: async (submission) => {
          submissions.push(submission);
          return pending.promise;
        },
        onCancelRun,
      },
    });
    await attachSchemeViaPicker();
    await user.type(screen.getByTestId('scheme-run-variable-subject'), '猫');
    await user.click(screen.getByTestId('composer-submit'));

    // 宿主未返回终态:停止钮出现(会话账本尚无活动任务,运行态来自方案执行)。
    const stop = await screen.findByTestId('composer-cancel');
    expect(screen.queryByTestId('composer-submit')).toBeNull();
    await user.click(stop);
    await waitFor(() => expect(onCancelRun).toHaveBeenCalledTimes(1));

    // 取消终态:回到提交钮,不显示错误行,槽位值保留供再次运行。
    await waitFor(() => expect(screen.getByTestId('composer-submit')).toBeTruthy());
    expect(screen.queryByTestId('scheme-submit-error')).toBeNull();
    expect((screen.getByTestId('scheme-run-variable-subject') as HTMLInputElement).value).toBe(
      '猫',
    );
  });

  it('取消后宿主以异常收尾(取消先于登记):按已取消处理,不显示错误行', async () => {
    const pending = deferred<RunResult>();
    const onCancelRun = vi.fn(async () => {
      pending.reject(new Error('方案运行已取消'));
    });
    renderWorkbench({
      integration: 'full',
      schemes: [makeSummary()],
      handlers: { onRun: async () => pending.promise, onCancelRun },
    });
    await attachSchemeViaPicker();
    await user.type(screen.getByTestId('scheme-run-variable-subject'), '猫');
    await user.click(screen.getByTestId('composer-submit'));
    await user.click(await screen.findByTestId('composer-cancel'));

    await waitFor(() => expect(screen.getByTestId('composer-submit')).toBeTruthy());
    expect(onCancelRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('scheme-submit-error')).toBeNull();
    expect((screen.getByTestId('scheme-run-variable-subject') as HTMLInputElement).value).toBe(
      '猫',
    );
  });

  it('宿主接 onRun 但缺 onCancelRun:运行中停止钮禁用(不假装能停)', async () => {
    const pending = deferred<RunResult>();
    renderWorkbench({
      integration: 'full',
      schemes: [makeSummary()],
      handlers: { onRun: async () => pending.promise, onCancelRun: undefined },
    });
    await attachSchemeViaPicker();
    await user.type(screen.getByTestId('scheme-run-variable-subject'), '猫');
    await user.click(screen.getByTestId('composer-submit'));

    const stop = (await screen.findByTestId('composer-cancel')) as HTMLButtonElement;
    expect(stop.disabled).toBe(true);
  });

  it('运行终态 failed/blocked:错误行就地解释、toast 报错,正文与槽位值保留供修正', async () => {
    const submissions: SchemeComposerSubmission[] = [];
    renderWorkbench({
      integration: 'full',
      submissions,
      schemes: [makeSummary()],
      handlers: {
        onRun: async (submission) => {
          submissions.push(submission);
          return makeRunResult(submission, {
            status: 'blocked',
            error: {
              code: 'DESIGN_SCHEME_INPUT_REQUIRED',
              message: '请先填写必需输入：主题',
              retryable: false,
              recoveryAction: 'edit-input',
            },
          });
        },
      },
    });
    await attachSchemeViaPicker();
    await user.type(screen.getByTestId('scheme-run-variable-subject'), '猫');
    await user.type(screen.getByTestId('composer-prompt'), '偏冷色');
    await user.click(screen.getByTestId('composer-submit'));

    expect((await screen.findByTestId('scheme-submit-error')).textContent).toBe(
      '请先填写必需输入：主题',
    );
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe('偏冷色');
    expect((screen.getByTestId('scheme-run-variable-subject') as HTMLInputElement).value).toBe(
      '猫',
    );
  });

  it('onRun 抛异常(prepare/transport 失败):同样落错误行,不进入普通生成', async () => {
    const { generationCreate } = renderWorkbench({
      integration: 'full',
      schemes: [makeSummary()],
      handlers: {
        onRun: async () => {
          throw new Error('AI 连接配置已变化，请重新生成运行计划');
        },
      },
    });
    await attachSchemeViaPicker();
    await user.type(screen.getByTestId('scheme-run-variable-subject'), '猫');
    await user.click(screen.getByTestId('composer-submit'));

    expect((await screen.findByTestId('scheme-submit-error')).textContent).toBe(
      'AI 连接配置已变化，请重新生成运行计划',
    );
    expect(generationCreate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('text-only 宿主:含图片槽位的方案附件提交禁用并解释;纯文本方案不受影响', async () => {
    renderWorkbench({
      integration: 'full',
      schemes: [makeSummary()],
      handlers: { runInputSupport: 'text-only' },
    });
    await waitFor(() => expect(screen.getByTestId('composer-attach')).toBeTruthy());
    setSchemeWorkbenchIntent({
      kind: 'attach',
      attachment: {
        schemeId: 'scheme-img',
        revisionId: 'rev-img',
        name: '换脸海报',
        summary: '需要一张参考图',
        mode: 'formal',
        fidelity: 'faithful',
        sourceLabel: 'Musefold 创建',
        inputs: [{ id: 'face', label: '人像', kind: 'image', required: false, description: '' }],
        coverAssetId: null,
        hasSuccessfulTrial: true,
      },
    });
    await waitFor(() => expect(screen.getByTestId('scheme-run-attachment')).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('composer-prompt')));
    const submit = screen.getByTestId('composer-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('title')).toBe('当前环境的方案运行暂不支持图片输入');

    // 换成纯文本方案:提交恢复可用(必需槽位集齐后)。
    await attachSchemeViaPicker();
    await user.type(screen.getByTestId('scheme-run-variable-subject'), '猫');
    await waitFor(() =>
      expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(false),
    );
  });
});

describe('WorkbenchScreen 跨屏方案意图消费', () => {
  it('create 意图(提示词库「创建方案」):种子进正文 + 创建态芯片带来源;提交走创建缝不碰普通生成', async () => {
    const submissions: SchemeComposerSubmission[] = [];
    const { generationCreate } = renderWorkbench({ integration: 'full', submissions });
    setSchemeWorkbenchIntent({
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
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toEqual({
      kind: 'create',
      executionId: expect.stringMatching(/[0-9a-f-]{36}/),
      createKind: 'prompt',
      brief:
        '把这段提示词整理成一个可以反复使用的方案，区分固定规则、必需变量和本次补充。\n\n画一只水彩猫',
      source: { kind: 'prompt', promptId: 'p-1', title: '水彩猫' },
    });
    // 绝不伪造:普通生成通道零调用。
    expect(generationCreate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('composer-scheme-creation')).toBeNull());
  });

  it('create 接缝失败:创建态与正文保留,错误行就地解释', async () => {
    renderWorkbench({
      integration: 'full',
      handlers: {
        onCreate: async () => {
          throw new Error('设计方案的 Agent 创建管线尚未纳入共享契约');
        },
      },
    });
    setSchemeWorkbenchIntent({
      kind: 'create',
      createKind: 'idea',
      seed: '做一个夏日海报方案',
      source: null,
    });
    await waitFor(() =>
      expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(
        '做一个夏日海报方案',
      ),
    );
    await user.click(screen.getByTestId('composer-submit'));
    expect((await screen.findByTestId('scheme-submit-error')).textContent).toBe(
      '设计方案的 Agent 创建管线尚未纳入共享契约',
    );
    expect(screen.getByTestId('composer-scheme-creation')).toBeTruthy();
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(
      '做一个夏日海报方案',
    );
  });

  const SOURCE_CONFIRMATION = {
    repositoryUrl: 'https://github.com/acme/zine-kit',
    name: 'zine-kit',
    description: '极简 zine 海报 Skill',
    resolvedRef: 'main',
    commitHash: 'b'.repeat(40),
    textFileCount: 2,
    textNames: ['SKILL.md', 'rules/color.md'],
    imageFileCount: 1,
    license: 'MIT',
  };

  /** 进入创建态并提交,宿主在 onCreate 内推送 confirmation-required 后等待 settle。 */
  async function submitCreationAwaitingConfirmation(
    memory: ReturnType<typeof renderWorkbench>,
    executionRef: { current: string | null },
  ) {
    useSchemeIntegration.getState().setWorkbenchIntent({
      kind: 'create',
      createKind: 'idea',
      seed: '按这个 Skill 做一套 zine 海报方案',
      source: null,
    });
    await waitFor(() =>
      expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toContain(
        'zine',
      ),
    );
    await user.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(executionRef.current).not.toBeNull());
    memory.emitEvent({
      kind: 'confirmation-required',
      executionId: executionRef.current as string,
      source: SOURCE_CONFIRMATION,
    });
    return screen.findByTestId('source-install-dialog');
  }

  it('Agent 创建的 confirmation-required:弹安装确认层展示来源元数据;「确认引入」调 confirmInstall(install) 后创建继续到成功', async () => {
    const executionRef: { current: string | null } = { current: null };
    const settle = deferred<void>();
    const memory = renderWorkbench({
      integration: 'full',
      handlers: {
        onCreate: async (submission) => {
          executionRef.current = submission.executionId;
          await settle.promise;
        },
      },
    });
    const dialog = await submitCreationAwaitingConfirmation(memory, executionRef);
    expect(dialog).toBeTruthy();
    expect(screen.getByTestId('source-install-repository').textContent).toBe(
      'https://github.com/acme/zine-kit',
    );
    expect(screen.getByTestId('source-install-name').textContent).toBe('zine-kit');
    expect(screen.getByTestId('source-install-files').textContent).toBe(
      'SKILL.md · rules/color.md',
    );
    expect(dialog.textContent).toContain('2 个文本文件 · 1 张图片');
    expect(dialog.textContent).toContain('许可证:MIT');
    expect(dialog.textContent).toContain(`固定到 main · ${'b'.repeat(10)}`);

    await user.click(screen.getByTestId('source-install-confirm'));
    await waitFor(() =>
      expect(memory.confirmInstall).toHaveBeenCalledWith({
        executionId: executionRef.current,
        decision: 'install',
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('source-install-dialog')).toBeNull());
    // 宿主随后完成创建:创建态清除、正文清空。
    settle.resolve();
    await waitFor(() => expect(screen.queryByTestId('composer-scheme-creation')).toBeNull());
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByTestId('scheme-submit-error')).toBeNull();
  });

  it('「取消创建」调 confirmInstall(cancel);宿主以 CANCELLED 收尾时按中性取消处理,输入与创建态保留', async () => {
    const executionRef: { current: string | null } = { current: null };
    const settle = deferred<void>();
    const memory = renderWorkbench({
      integration: 'full',
      handlers: {
        onCreate: async (submission) => {
          executionRef.current = submission.executionId;
          await settle.promise;
        },
      },
    });
    await submitCreationAwaitingConfirmation(memory, executionRef);
    await user.click(screen.getByTestId('source-install-cancel'));
    await waitFor(() =>
      expect(memory.confirmInstall).toHaveBeenCalledWith({
        executionId: executionRef.current,
        decision: 'cancel',
      }),
    );
    settle.reject(Object.assign(new Error('创建设计方案已取消'), { code: 'CANCELLED' }));

    await waitFor(() =>
      expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.queryByTestId('source-install-dialog')).toBeNull();
    expect(screen.queryByTestId('scheme-submit-error')).toBeNull();
    expect(screen.getByTestId('composer-scheme-creation')).toBeTruthy();
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toContain('zine');
  });

  it('多来源逐个确认:第一个确认后再次 confirmation-required 会重新弹层;执行结束即使仍有事件也不再弹', async () => {
    const executionRef: { current: string | null } = { current: null };
    const settle = deferred<void>();
    const memory = renderWorkbench({
      integration: 'full',
      handlers: {
        onCreate: async (submission) => {
          executionRef.current = submission.executionId;
          await settle.promise;
        },
      },
    });
    await submitCreationAwaitingConfirmation(memory, executionRef);
    await user.click(screen.getByTestId('source-install-confirm'));
    await waitFor(() => expect(screen.queryByTestId('source-install-dialog')).toBeNull());

    memory.emitEvent({
      kind: 'confirmation-required',
      executionId: executionRef.current as string,
      source: {
        ...SOURCE_CONFIRMATION,
        repositoryUrl: 'https://github.com/acme/second',
        name: 'second',
      },
    });
    expect((await screen.findByTestId('source-install-name')).textContent).toBe('second');
    await user.click(screen.getByTestId('source-install-confirm'));
    await waitFor(() => expect(memory.confirmInstall).toHaveBeenCalledTimes(2));

    settle.resolve();
    await waitFor(() => expect(screen.queryByTestId('composer-scheme-creation')).toBeNull());
    // 执行已结束:订阅已退,迟到的事件不会再弹层。
    memory.emitEvent({
      kind: 'confirmation-required',
      executionId: executionRef.current as string,
      source: SOURCE_CONFIRMATION,
    });
    expect(screen.queryByTestId('source-install-dialog')).toBeNull();
    // 其他执行的事件同样忽略。
    expect(memory.designSchemes.subscribeEvents).toHaveBeenCalledTimes(1);
  });

  it('Agent 创建期间 state / 运行中 trace 事件映射为 Composer 上方一行进度;终态后消失', async () => {
    const executionRef: { current: string | null } = { current: null };
    const settle = deferred<void>();
    const memory = renderWorkbench({
      integration: 'full',
      handlers: {
        onCreate: async (submission) => {
          executionRef.current = submission.executionId;
          await settle.promise;
        },
      },
    });
    useSchemeIntegration.getState().setWorkbenchIntent({
      kind: 'create',
      createKind: 'idea',
      seed: '做一套方案',
      source: null,
    });
    await waitFor(() =>
      expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(
        '做一套方案',
      ),
    );
    await user.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(executionRef.current).not.toBeNull());
    const executionId = executionRef.current as string;

    memory.emitEvent({ kind: 'state', executionId, state: 'analyzing' });
    expect((await screen.findByTestId('scheme-agent-progress')).textContent).toContain(
      'Repository Analyst 正在分析仓库',
    );
    memory.emitEvent({
      kind: 'trace',
      executionId,
      item: { id: 'compiler', kind: 'tool', title: 'Scheme Compiler 编译方案', status: 'running' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('scheme-agent-progress').textContent).toContain(
        'Scheme Compiler 编译方案',
      ),
    );
    // 其他执行的事件与已结束的 trace 不改进度。
    memory.emitEvent({ kind: 'state', executionId: 'someone-else', state: 'source_resolving' });
    memory.emitEvent({
      kind: 'trace',
      executionId,
      item: { id: 'compiler', kind: 'tool', title: 'Scheme Compiler 编译方案', status: 'success' },
    });
    expect(screen.getByTestId('scheme-agent-progress').textContent).toContain('Scheme Compiler');

    settle.resolve();
    await waitFor(() => expect(screen.queryByTestId('scheme-agent-progress')).toBeNull());
    expect(screen.queryByTestId('composer-scheme-creation')).toBeNull();
  });

  it('宿主 gateway 无 confirmInstall(如云端):仍订阅进度事件,但不会弹安装确认层', async () => {
    const executionRef: { current: string | null } = { current: null };
    const settle = deferred<void>();
    const memory = renderWorkbench({
      integration: 'full',
      confirmInstall: false,
      handlers: {
        onCreate: async (submission) => {
          executionRef.current = submission.executionId;
          await settle.promise;
        },
      },
    });
    useSchemeIntegration.getState().setWorkbenchIntent({
      kind: 'create',
      createKind: 'idea',
      seed: '做一套方案',
      source: null,
    });
    await waitFor(() =>
      expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(
        '做一套方案',
      ),
    );
    await user.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(executionRef.current).not.toBeNull());
    memory.emitEvent({
      kind: 'confirmation-required',
      executionId: executionRef.current as string,
      source: SOURCE_CONFIRMATION,
    });
    expect(screen.queryByTestId('source-install-dialog')).toBeNull();
    memory.emitEvent({
      kind: 'state',
      executionId: executionRef.current as string,
      state: 'compiling_scheme',
    });
    expect((await screen.findByTestId('scheme-agent-progress')).textContent).toContain(
      'Scheme Compiler 正在编译方案',
    );
    settle.resolve();
    await waitFor(() => expect(screen.queryByTestId('composer-scheme-creation')).toBeNull());
  });

  it('只接 onRun 不接 onCreate/onModify:创建入口禁用、修改附件提交禁用并各自解释', async () => {
    renderWorkbench({
      integration: 'full',
      handlers: { onCreate: undefined, onModify: undefined },
    });
    await waitFor(() => expect(screen.getByTestId('composer-attach')).toBeTruthy());
    await user.click(screen.getByTestId('composer-attach'));
    expect(
      (await screen.findByTestId('composer-menu-design-plan')).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      screen.getByTestId('workbench-context-history-source').getAttribute('aria-disabled'),
    ).toBe('true');
    await user.keyboard('{Escape}');

    setSchemeWorkbenchIntent({
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
    await user.type(screen.getByTestId('composer-prompt'), '把默认比例改成 3:4');
    const submit = screen.getByTestId('composer-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('title')).toBe('当前环境暂未接入方案修改');
  });

  it('attach 意图(方案中心「试运行」):挂载草稿为试运行模式;修改意图走 modify 提交', async () => {
    const submissions: SchemeComposerSubmission[] = [];
    renderWorkbench({ integration: 'full', submissions });
    setSchemeWorkbenchIntent({
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
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toMatchObject({
      kind: 'modify',
      brief: '把默认比例改成 3:4',
      executionId: expect.stringMatching(/[0-9a-f-]{36}/),
    });
    // 成功后正文清空,附件保留(继续多轮修改)。
    await waitFor(() =>
      expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(''),
    );
    expect(screen.getByTestId('scheme-run-attachment')).toBeTruthy();
  });
});
