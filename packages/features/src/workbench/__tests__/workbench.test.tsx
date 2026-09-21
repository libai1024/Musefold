import { beginAccountTransition } from '../../account/account-session';
import { toast } from '@musefold/ui/components/sonner';
import type {
  AccountSummary,
  AccountModelCatalog,
  AppPreferences,
  CreateGenerationInput,
  GenerationJob,
  NewPromptDocument,
  PromptDocument,
  SaveAssetInput,
  WorkbenchDraft,
  WorkbenchSession,
} from '@musefold/contracts';
import { defaultAppPreferences } from '@musefold/contracts';
import type {
  GenerationGateway,
  MusefoldGateway,
  SettingsGateway,
  WorkbenchGateway,
} from '@musefold/platform';
import {
  DESKTOP_CAPABILITIES,
  PlatformProvider,
  queryKeys,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  groupWorkbenchSessions,
  NewSessionAction,
  SessionListPanel,
  sessionRelativeTime,
} from '../SessionListPanel';
import {
  isSessionUnread,
  resolveInheritedGenerationParams,
  useActiveSession,
} from '../session-store';
import { useScreenIntent } from '../../shell/screen-intent-store';
import { resetQuotaRecovery, peekQuotaRecovery } from '../../history/spend-recovery-store';
import { useRedeem } from '../../account/hooks';
import { emptyStateGreeting } from '../WorkbenchEmptyState';
import {
  deriveSessionTitle,
  formatSessionTitle,
  workbenchTaskSummary,
  WorkbenchScreen,
} from '../WorkbenchScreen';

const EMPTY_DRAFT: WorkbenchDraft = {
  prompt: '',
  negative: '',
  params: {},
  promptReferenceSelections: [],
  promptReferenceIds: [],
};

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().replace(/Z$/, '+00:00');
}

/** 可控软键盘视口:jsdom 无 visualViewport;支持中途切到 md+ 断言桌面不抬。 */
function stubSoftKeyboardViewport(options: {
  desktop: boolean;
  innerHeight: number;
  viewportHeight: number;
  offsetTop?: number;
}) {
  const viewport = Object.assign(new EventTarget(), {
    height: options.viewportHeight,
    offsetTop: options.offsetTop ?? 0,
  });
  let desktop = options.desktop;
  const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();
  const previousInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const previousMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  const previousVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: options.innerHeight,
  });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: viewport,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        if (query.includes('min-width: 768px')) return desktop;
        if (query.includes('max-width: 767px')) return !desktop;
        return false;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
        mediaListeners.add(cb);
      },
      removeEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
        mediaListeners.delete(cb);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  return {
    setDesktop(next: boolean) {
      desktop = next;
      act(() => {
        for (const listener of mediaListeners) listener({ matches: next } as MediaQueryListEvent);
      });
    },
    restore() {
      if (previousInnerHeight) Object.defineProperty(window, 'innerHeight', previousInnerHeight);
      if (previousMatchMedia) Object.defineProperty(window, 'matchMedia', previousMatchMedia);
      else Reflect.deleteProperty(window, 'matchMedia');
      if (previousVisualViewport) {
        Object.defineProperty(window, 'visualViewport', previousVisualViewport);
      } else {
        Reflect.deleteProperty(window, 'visualViewport');
      }
    },
  };
}

/** 时间线种子回合:只覆盖测试关心的 id / sessionId / status。 */
function makeSeedJob(
  partial: Partial<GenerationJob> & Pick<GenerationJob, 'id' | 'sessionId'>,
): GenerationJob {
  return {
    parentRunId: null,
    promptId: null,
    userPrompt: 'seed prompt',
    promptReferences: [],
    actorType: 'web',
    approvalStatus: 'not_required',
    status: 'succeeded',
    progress: 100,
    request: {
      prompt: 'seed prompt',
      size: 'auto',
      quality: 'auto',
      count: 1,
      referenceImages: [],
    },
    providerModel: 'test-model',
    costPoints: null,
    assets: [],
    error: null,
    createdAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: nowIso(1_000),
    deletedAt: null,
    ...partial,
  };
}

/** 内存版 workbench + generation:提交即 queued,一次读取后翻成 succeeded。 */
function createMemoryWorkbench(options?: {
  noProviders?: boolean;
  holdQueued?: boolean;
  createError?: Error & { code?: string };
  seedJobs?: GenerationJob[];
  preferences?: Partial<AppPreferences>;
  accountStatus?: AccountSummary;
  readModelCatalog?: () => Promise<AccountModelCatalog>;
}) {
  let seq = 0;
  const sessions = new Map<string, WorkbenchSession>();
  const jobs = new Map<string, GenerationJob>();
  for (const job of options?.seedJobs ?? []) jobs.set(job.id, job);
  // 「保存图片」链路:记录入参供断言,固定返回 saved。
  const assetSaves: SaveAssetInput[] = [];
  const draftWriteVersions: number[] = [];

  function requireSession(id: string): WorkbenchSession {
    const session = sessions.get(id);
    if (!session) throw new Error('NOT_FOUND');
    return session;
  }

  /** 会话行状态点派生:与真实两端一致,从 runs(jobs)推导最近一次生成。 */
  function withLatestJob(session: WorkbenchSession): WorkbenchSession {
    const latest = [...jobs.values()]
      .filter((job) => job.sessionId === session.id && job.deletedAt == null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return {
      ...session,
      latestJobStatus: latest?.status ?? null,
      latestJobFinishedAt: latest?.finishedAt ?? null,
    };
  }

  const workbench: WorkbenchGateway = {
    listSessions: async () => ({
      items: [...sessions.values()]
        .filter((session) => session.deletedAt == null && session.archivedAt == null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(withLatestJob),
      nextCursor: null,
    }),
    createSession: async (input) => {
      seq += 1;
      const session: WorkbenchSession = {
        id: `session-${seq}`,
        title: input.title ?? '未命名创作',
        draft: { ...EMPTY_DRAFT, ...input.draft },
        version: 1,
        // 每行错开 1ms:同批种子会话的 updatedAt 序确定(新者在前)。
        createdAt: nowIso(seq),
        updatedAt: nowIso(seq),
        archivedAt: null,
        deletedAt: null,
        latestJobStatus: null,
        latestJobFinishedAt: null,
      };
      sessions.set(session.id, session);
      return session;
    },
    getSession: async (id) => requireSession(id),
    updateSession: async (id, patch) => {
      const session = requireSession(id);
      if (patch.expectedVersion !== session.version) throw new Error('WORKBENCH_VERSION_CONFLICT');
      if (patch.draft !== undefined) draftWriteVersions.push(patch.expectedVersion);
      const next: WorkbenchSession = {
        ...session,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.draft !== undefined ? { draft: patch.draft } : {}),
        ...(patch.archived !== undefined ? { archivedAt: patch.archived ? nowIso() : null } : {}),
        version: session.version + 1,
        updatedAt: nowIso(),
      };
      sessions.set(id, next);
      return next;
    },
    removeSession: async (id) => {
      const session = { ...requireSession(id), deletedAt: nowIso() };
      sessions.set(id, session);
      return session;
    },
    restoreSession: async (id) => {
      const session = { ...requireSession(id), deletedAt: null };
      sessions.set(id, session);
      return session;
    },
    purgeSession: async () => {
      throw new Error('Session cleanup is not used by this workbench fixture');
    },
    emptyTrash: async () => {
      throw new Error('Session cleanup is not used by this workbench fixture');
    },
  };

  const generation: GenerationGateway = {
    releaseReferenceImage: async () => {},
    create: async (input: CreateGenerationInput) => {
      if (options?.createError) throw options.createError;
      seq += 1;
      const job: GenerationJob = {
        id: `job-${seq}`,
        sessionId: input.sessionId ?? null,
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
          size: input.size ?? 'auto',
          quality: input.quality ?? 'auto',
          count: 1,
          referenceImages: (input.referenceImages ?? []).map((reference) => ({ ...reference })),
        },
        providerModel: 'test-model',
        costPoints: null,
        assets: [],
        error: null,
        createdAt: nowIso(),
        startedAt: null,
        finishedAt: null,
        deletedAt: null,
      };
      jobs.set(job.id, job);
      return job;
    },
    list: async (query) => {
      const items = [...jobs.values()].filter(
        (job) => (!query.sessionId || job.sessionId === query.sessionId) && job.deletedAt == null,
      );
      // 读取即推进:queued → succeeded(模拟后台完成,驱动轮询终止);holdQueued 时冻结。
      for (const job of items) {
        if (!options?.holdQueued && job.status === 'queued') {
          jobs.set(job.id, {
            ...job,
            status: 'succeeded',
            progress: 100,
            assets: [
              {
                id: `${job.id}-asset`,
                url: 'https://example.test/image.png',
                mimeType: 'image/png',
                width: 512,
                height: 512,
                byteSize: 1024,
                expiresAt: '2099-01-01T00:00:00+00:00',
              },
            ],
            finishedAt: nowIso(),
          });
        }
      }
      return { items, nextCursor: null };
    },
    get: async (id) => {
      const job = jobs.get(id);
      if (!job) throw new Error('NOT_FOUND');
      return job;
    },
    cancel: async (id) => {
      const job = { ...(await generation.get(id)), status: 'cancelled' as const };
      jobs.set(id, job);
      return job;
    },
    retry: async (id) => {
      const source = await generation.get(id);
      return generation.create(
        {
          prompt: source.request.prompt,
          sessionId: source.sessionId ?? undefined,
        },
        'memory-retry-intent',
      );
    },
    remove: async (id) => {
      const job = { ...(await generation.get(id)), deletedAt: nowIso() };
      jobs.set(id, job);
      return job;
    },
    restore: async (id) => generation.get(id),
    purge: async (id) => {
      jobs.delete(id);
    },
    listProviders: async () =>
      options?.noProviders
        ? []
        : [
            {
              id: 'p1',
              label: '测试连接',
              model: 'test-model',
              kind: options?.readModelCatalog ? 'cloud' : 'local',
              available: true,
            },
          ],
    uploadReferenceImage: async (input) => {
      seq += 1;
      return {
        id: `REF${String(seq).padStart(23, '0')}`,
        url: `media://local/?p=%2Fuploads%2Fref-${seq}.png`,
        name: input.name,
        mimeType: 'image/png',
        byteSize: input.bytes.byteLength,
      };
    },
    saveAsset: async (input) => {
      assetSaves.push(input);
      return 'saved';
    },
    // 批量清理走历史屏,工作台不用;桩到返回 0 满足网关形状即可。
    cleanup: async () => ({ affected: 0 }),
  };

  // 会话置顶走偏好通道(SessionListPanel → usePreferences)。
  let preferences: AppPreferences = { ...defaultAppPreferences, ...options?.preferences };
  const settings: SettingsGateway = {
    getPreferences: async () => preferences,
    updatePreferences: async (patch) => {
      preferences = { ...preferences, ...patch };
      return preferences;
    },
  };

  // 「存为提示词」链路只需要 create;记录入参供断言。
  const promptCreates: NewPromptDocument[] = [];
  const prompts = {
    create: async (input: NewPromptDocument): Promise<PromptDocument> => {
      promptCreates.push(input);
      const timestamp = nowIso();
      return {
        id: `prompt-${promptCreates.length}`,
        title: input.title,
        description: input.description ?? null,
        content: input.content,
        negative: input.negative ?? null,
        folderId: input.folderId ?? null,
        tags: [],
        modelId: input.modelId ?? null,
        params: input.params ?? null,
        rating: input.rating ?? 0,
        isPinned: input.isPinned ?? false,
        pinOrder: null,
        usageCount: 0,
        lastUsedAt: null,
        source: input.source ?? 'manual',
        sourceUrl: input.sourceUrl ?? null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
    },
  };

  const account = {
    ...(options?.readModelCatalog ? { getModelCatalog: options.readModelCatalog } : {}),
    getStatus: async () => {
      if (!options?.accountStatus) throw new Error('桌面端尚未登录');
      return options.accountStatus;
    },
    login: async () => {
      throw new Error('not implemented');
    },
    register: async () => {
      throw new Error('not implemented');
    },
    logout: async () => {},
    redeem: async () => {
      throw new Error('not implemented');
    },
  };

  return {
    workbench,
    generation,
    settings,
    prompts,
    account,
    promptCreates,
    assetSaves,
    draftWriteVersions,
  };
}

/** 组合渲染:壳侧栏会话区 + 工作台屏(与宿主同构),经共享 store 协作。 */
function renderWorkbench(options?: {
  noProviders?: boolean;
  holdQueued?: boolean;
  createError?: Error & { code?: string };
  seedJobs?: GenerationJob[];
  onOpenSettings?: () => void;
  preferences?: Partial<AppPreferences>;
  /** 预置会话行(「新设计」已不直接建行,行级测试用种子行作靶)。 */
  seedSessions?: string[];
  accountStatus?: AccountSummary;
  readModelCatalog?: () => Promise<AccountModelCatalog>;
  desktop?: boolean;
}) {
  const memory = createMemoryWorkbench(options);
  // memory 网关无 await 点,种子会话同步落 Map。
  for (const title of options?.seedSessions ?? []) {
    void memory.workbench.createSession({ title });
  }
  const gateway = memory as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider
          runtime={{
            gateway,
            capabilities: options?.desktop ? DESKTOP_CAPABILITIES : WEB_CAPABILITIES,
          }}
        >
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  render(
    <>
      <NewSessionAction onOpen={() => {}} />
      <SessionListPanel onOpen={() => {}} />
      <WorkbenchScreen onOpenSettings={options?.onOpenSettings} />
    </>,
    { wrapper: Providers },
  );
  return { ...memory, queryClient, Providers };
}

describe('Workbench(壳会话区 + 屏)', () => {
  beforeEach(() => {
    useActiveSession.setState({
      activeSessionId: null,
      draftSession: false,
      pendingDraft: null,
      draftParamOverrides: {},
      seenAt: {},
      unreadMarks: {},
    });
    useScreenIntent.setState({ intent: null });
    resetQuotaRecovery();
  });

  it.each([false, true])(
    'account model selector sends the displayed cloud choice (desktop=%s)',
    async (desktop) => {
      const identity = {
        apiIssuer: 'https://api.test',
        principalId: 'principal-model-test',
        status: 'active' as const,
        identityVersion: 1,
      };
      const catalog: AccountModelCatalog = {
        identity: {
          apiIssuer: identity.apiIssuer,
          principalId: identity.principalId,
          payer: { issuer: 'https://payer.test', ownerId: 'owner-model-test' },
          credential: { ref: 'credential-model-test', version: 1 },
        },
        group: 'vip',
        checkedAt: '2026-09-20T00:00:00.000Z',
        models: ['image-a', 'image-b'].map((model, index) => ({
          model,
          imageGeneration: true,
          supportedEndpointTypes: ['image-generation'],
          pricing: {
            kind: 'per_call',
            baseUsd: 0.1,
            groupRatio: 1,
            quotaPerCall: 50000 * (index + 1),
          },
        })),
      };
      const readModelCatalog = vi.fn(async () => catalog);
      const stored = new Map<string, string>();
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      });
      const scroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: () => {},
      });
      try {
        const memory = renderWorkbench({
          desktop,
          readModelCatalog,
          accountStatus: {
            id: 'owner-model-test',
            username: 'model-test',
            displayName: null,
            quota: 1_000_000,
            quotaUnit: 'quota',
            canGenerate: true,
            identity,
          },
        });
        const create = vi.spyOn(memory.generation, 'create');
        await waitFor(() =>
          expect(screen.getByTestId('composer-model-price').textContent).toContain('1 积分/计费次'),
        );
        const trigger = screen.getByRole('combobox', { name: '账号模型' });
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const option = await screen.findByRole('option', { name: /image-b/ });
        fireEvent.keyDown(option, { key: 'Enter' });
        await waitFor(() =>
          expect(screen.getByTestId('composer-model-price').textContent).toContain('2 积分/计费次'),
        );
        expect([...stored.values()]).toEqual(['image-b']);
        fireEvent.change(screen.getByTestId('composer-prompt'), {
          target: { value: 'selected model request' },
        });
        fireEvent.click(screen.getByTestId('composer-submit'));
        await waitFor(() => expect(create).toHaveBeenCalledOnce());
        expect(create.mock.calls[0]?.[0]).toMatchObject({
          model: 'image-b',
          expectedBinding: { model: 'image-b', principalId: identity.principalId },
          prompt: 'selected model request',
          providerId: 'p1',
        });
        expect(readModelCatalog).toHaveBeenCalledTimes(2);
      } finally {
        cleanup();
        vi.unstubAllGlobals();
        if (scroll) Object.defineProperty(Element.prototype, 'scrollIntoView', scroll);
        else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      }
    },
  );

  async function addHeldImage(name = 'held.png') {
    await screen.findByTestId('composer-prompt');
    const file = new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('composer-reference')
          .every((element) => element.getAttribute('data-status') === 'ready'),
      ).toBe(true),
    );
  }
  function pendingResult<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  }

  it.each(['remove', 'unmount', 'account-change', 'session-change'] as const)(
    'reference host release: unused ready image leaves through %s',
    async (exit) => {
      const memory = renderWorkbench({ seedSessions: ['older', 'newer'] });
      await act(async () => {
        await memory.queryClient.refetchQueries();
      });
      const release = vi.spyOn(memory.generation, 'releaseReferenceImage');
      await addHeldImage();
      expect(release).not.toHaveBeenCalled();
      if (exit === 'remove')
        fireEvent.click(screen.getByRole('button', { name: '移除参考图 held.png' }));
      else if (exit === 'unmount') cleanup();
      else if (exit === 'account-change')
        act(() => {
          beginAccountTransition(memory.queryClient);
        });
      else fireEvent.click(screen.getByTestId('session-session-1'));
      await waitFor(() => expect(release).toHaveBeenCalledOnce());
      expect(release.mock.calls[0]?.[0]).toEqual({ id: expect.stringMatching(/^REF/) });
      expect(screen.queryByTestId('composer-reference')).toBeNull();
      cleanup();
      await act(async () => {});
      expect(release).toHaveBeenCalledOnce();
    },
  );

  it('reference host release: a late successful upload returns its unused host hold', async () => {
    const memory = renderWorkbench();
    await screen.findByTestId('composer-prompt');
    const release = vi.spyOn(memory.generation, 'releaseReferenceImage');
    const gate = pendingResult<Awaited<ReturnType<GenerationGateway['uploadReferenceImage']>>>();
    const upload = vi
      .spyOn(memory.generation, 'uploadReferenceImage')
      .mockReturnValue(gate.promise);
    fireEvent.change(screen.getByTestId('composer-file-input'), {
      target: {
        files: [new File([new Uint8Array([137, 80, 78, 71])], 'late.png', { type: 'image/png' })],
      },
    });
    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    cleanup();
    expect(release).not.toHaveBeenCalled();
    await act(async () =>
      gate.resolve({
        id: 'late-reference',
        url: 'https://example.test/late.png',
        name: 'late.png',
        mimeType: 'image/png',
        byteSize: 4,
      }),
    );
    await waitFor(() => expect(release).toHaveBeenCalledExactlyOnceWith({ id: 'late-reference' }));
  });

  it.each(['success', 'failure', 'account-change'] as const)(
    'reference host release: leaving during generation retains images until %s settles',
    async (exit) => {
      const memory = renderWorkbench({ seedSessions: ['existing'] });
      await act(async () => {
        await memory.queryClient.refetchQueries();
      });
      const release = vi.spyOn(memory.generation, 'releaseReferenceImage');
      await addHeldImage();
      const gate = pendingResult<GenerationJob>();
      const create = vi.spyOn(memory.generation, 'create').mockReturnValue(gate.promise);
      fireEvent.change(screen.getByTestId('composer-prompt'), {
        target: { value: 'with original image' },
      });
      fireEvent.click(screen.getByTestId('composer-submit'));
      await waitFor(() => expect(create).toHaveBeenCalledOnce());
      expect(create.mock.calls[0]?.[0].referenceImages?.[0]?.name).toBe('held.png');
      cleanup();
      if (exit === 'account-change') beginAccountTransition(memory.queryClient);
      await act(async () => {});
      expect(release).not.toHaveBeenCalled();
      await act(async () => {
        if (exit === 'success')
          gate.resolve(makeSeedJob({ id: 'accepted', sessionId: 'session-1' }));
        else gate.reject(new Error('generation unavailable'));
      });
      await waitFor(() => expect(release).toHaveBeenCalledOnce());
      expect(create).toHaveBeenCalledOnce();
    },
  );

  it.each(['same-account', 'account-change'] as const)(
    'reference host release: submission pins precede asynchronous first-session creation (%s)',
    async (identity) => {
      const memory = renderWorkbench();
      const release = vi.spyOn(memory.generation, 'releaseReferenceImage');
      await addHeldImage();
      const gate = pendingResult<WorkbenchSession>();
      const realCreateSession = memory.workbench.createSession;
      const sessionCreate = vi
        .spyOn(memory.workbench, 'createSession')
        .mockReturnValue(gate.promise);
      const create = vi.spyOn(memory.generation, 'create');
      fireEvent.change(screen.getByTestId('composer-prompt'), {
        target: { value: 'first submission' },
      });
      fireEvent.click(screen.getByTestId('composer-submit'));
      await waitFor(() => expect(sessionCreate).toHaveBeenCalledOnce());
      cleanup();
      await act(async () => {});
      expect(release).not.toHaveBeenCalled();
      if (identity === 'account-change') beginAccountTransition(memory.queryClient);
      await act(async () => gate.resolve(await realCreateSession(sessionCreate.mock.calls[0]![0])));
      await waitFor(() => expect(release).toHaveBeenCalledOnce());
      expect(create).toHaveBeenCalledTimes(identity === 'same-account' ? 1 : 0);
      if (identity === 'same-account')
        expect(create.mock.calls[0]?.[0].referenceImages?.[0]?.name).toBe('held.png');
    },
  );

  it('reference host release: quota recovery keeps the uploaded input after leaving workbench and until replay finishes', async () => {
    const memory = renderWorkbench({ seedSessions: ['existing'] });
    await act(async () => {
      await memory.queryClient.refetchQueries();
    });
    const release = vi.spyOn(memory.generation, 'releaseReferenceImage');
    await addHeldImage();
    const gate = pendingResult<GenerationJob>();
    const create = vi
      .spyOn(memory.generation, 'create')
      .mockRejectedValueOnce(
        Object.assign(new Error('quota insufficient'), { code: 'ACCOUNT_QUOTA_INSUFFICIENT' }),
      )
      .mockReturnValueOnce(gate.promise);
    fireEvent.change(screen.getByTestId('composer-prompt'), { target: { value: 'frozen input' } });
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(peekQuotaRecovery()?.kind).toBe('replay-create'));
    cleanup();
    await act(async () => {});
    expect(release).not.toHaveBeenCalled();
    const credited = {
      id: 'owner-a',
      username: 'owner-a',
      displayName: null,
      quota: 500000,
      quotaUnit: '点',
      canGenerate: true,
    };
    const redeem = vi.fn(async () => ({ account: credited, creditedQuota: 500000 }));
    Object.assign(memory.account, { redeem });
    const hook = renderHook(() => useRedeem(), { wrapper: memory.Providers });
    act(() => hook.result.current.mutate('CODE'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
    expect(release).not.toHaveBeenCalled();
    await act(async () => gate.resolve(makeSeedJob({ id: 'accepted', sessionId: 'session-1' })));
    await waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(redeem).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it('参考图生命周期： unmount releases the actual preview URL', async () => {
    const previousCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const previousRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:owned-preview',
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    try {
      renderWorkbench();
      await screen.findByTestId('composer-prompt');
      fireEvent.change(screen.getByTestId('composer-file-input'), {
        target: {
          files: [
            new File([new Uint8Array([137, 80, 78, 71])], 'owned.png', { type: 'image/png' }),
          ],
        },
      });
      await waitFor(() =>
        expect(screen.getByTestId('composer-reference').getAttribute('data-status')).toBe('ready'),
      );
      cleanup();
      expect(revoke).toHaveBeenCalledWith('blob:owned-preview');
    } finally {
      cleanup();
      if (previousCreate) Object.defineProperty(URL, 'createObjectURL', previousCreate);
      else Reflect.deleteProperty(URL, 'createObjectURL');
      if (previousRevoke) Object.defineProperty(URL, 'revokeObjectURL', previousRevoke);
      else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('参考图生命周期： cleared pending read never starts a host upload', async () => {
    const memory = renderWorkbench({ seedSessions: ['first', 'second'] });
    fireEvent.click(await screen.findByTestId('session-session-1'));
    await waitFor(() => expect(useActiveSession.getState().activeSessionId).toBe('session-1'));
    let finishRead!: (value: ArrayBuffer) => void;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'pending.png', {
      type: 'image/png',
    });
    const arrayBuffer = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishRead = resolve;
        }),
    );
    Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer });
    const upload = vi.spyOn(memory.generation, 'uploadReferenceImage');
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('session-session-2'));
    await waitFor(() => expect(screen.queryByTestId('composer-reference')).toBeNull());
    await act(async () => {
      finishRead(new Uint8Array([137, 80, 78, 71]).buffer);
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(['read', 'upload'] as const)(
    '参考图生命周期： leaving a page silences its late %s error',
    async (phase) => {
      const memory = renderWorkbench({ seedSessions: ['first', 'second'] });
      fireEvent.click(await screen.findByTestId('session-session-1'));
      await waitFor(() => expect(useActiveSession.getState().activeSessionId).toBe('session-1'));
      let rejectPending!: (error: Error) => void;
      const file = new File([new Uint8Array([137, 80, 78, 71])], 'old.png', { type: 'image/png' });
      const upload = vi.spyOn(memory.generation, 'uploadReferenceImage');
      if (phase === 'read')
        Object.defineProperty(file, 'arrayBuffer', {
          value: () =>
            new Promise<ArrayBuffer>((_resolve, reject) => {
              rejectPending = reject;
            }),
        });
      else
        upload.mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectPending = reject;
            }),
        );
      const errorToast = vi.spyOn(toast, 'error');
      try {
        fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
        await waitFor(() => expect(rejectPending).toBeTypeOf('function'));
        fireEvent.click(screen.getByTestId('session-session-2'));
        await waitFor(() => expect(screen.queryByTestId('composer-reference')).toBeNull());
        await act(async () => {
          rejectPending(new Error('old page upload failed'));
        });
        expect(errorToast).not.toHaveBeenCalledWith('old page upload failed');
        expect(screen.queryByTestId('composer-reference')).toBeNull();
      } finally {
        errorToast.mockRestore();
      }
    },
  );

  it('参考图生命周期： unmounted pending read never uploads', async () => {
    const memory = renderWorkbench();
    await screen.findByTestId('composer-prompt');
    let finishRead!: (value: ArrayBuffer) => void;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'unmounted.png', {
      type: 'image/png',
    });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishRead = resolve;
        }),
    });
    const upload = vi.spyOn(memory.generation, 'uploadReferenceImage');
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
    cleanup();
    await act(async () => {
      finishRead(new Uint8Array([137, 80, 78, 71]).buffer);
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('参考图生命周期： current upload failures still explain the error', async () => {
    const memory = renderWorkbench();
    await screen.findByTestId('composer-prompt');
    vi.spyOn(memory.generation, 'uploadReferenceImage').mockRejectedValueOnce(
      new Error('current upload failed'),
    );
    const errorToast = vi.spyOn(toast, 'error');
    try {
      fireEvent.change(screen.getByTestId('composer-file-input'), {
        target: {
          files: [
            new File([new Uint8Array([137, 80, 78, 71])], 'current.png', { type: 'image/png' }),
          ],
        },
      });
      await waitFor(() => expect(errorToast).toHaveBeenCalledWith('current upload failed'));
      expect(screen.queryByTestId('composer-reference')).toBeNull();
    } finally {
      errorToast.mockRestore();
    }
  });

  it.each(['read', 'upload'] as const)(
    '参考图生命周期： account transition invalidates pending %s',
    async (phase) => {
      const memory = renderWorkbench();
      await screen.findByTestId('composer-prompt');
      let finishRead!: (bytes: ArrayBuffer) => void;
      let finishUpload!: (
        image: Awaited<ReturnType<GenerationGateway['uploadReferenceImage']>>,
      ) => void;
      const file = new File([new Uint8Array([137, 80, 78, 71])], 'old-account.png', {
        type: 'image/png',
      });
      const upload = vi.spyOn(memory.generation, 'uploadReferenceImage');
      if (phase === 'read')
        Object.defineProperty(file, 'arrayBuffer', {
          value: () =>
            new Promise<ArrayBuffer>((resolve) => {
              finishRead = resolve;
            }),
        });
      else
        upload.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishUpload = resolve;
            }),
        );
      fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });
      await waitFor(() =>
        expect(phase === 'read' ? finishRead : finishUpload).toBeTypeOf('function'),
      );
      await act(async () => {
        beginAccountTransition(memory.queryClient);
        if (phase === 'read') finishRead(new Uint8Array([137, 80, 78, 71]).buffer);
        else
          finishUpload({
            id: 'old-account-reference',
            name: file.name,
            mimeType: 'image/png',
            byteSize: 4,
            url: '/api/v1/reference-images/old-account-reference/url',
          });
      });
      expect(screen.queryByTestId('composer-reference')).toBeNull();
      expect(upload).toHaveBeenCalledTimes(phase === 'read' ? 0 : 1);
    },
  );

  it.each(['unmount', 'account'] as const)(
    '参考图生命周期： mutation admission rechecks %s after an asynchronous callback',
    async (change) => {
      const memory = renderWorkbench();
      await screen.findByTestId('composer-prompt');
      let resume!: () => void;
      let admissionStarted = false;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      memory.queryClient.getMutationCache().config.onMutate = async () => {
        admissionStarted = true;
        await gate;
      };
      const upload = vi.spyOn(memory.generation, 'uploadReferenceImage');
      fireEvent.change(screen.getByTestId('composer-file-input'), {
        target: {
          files: [
            new File([new Uint8Array([137, 80, 78, 71])], 'admission.png', { type: 'image/png' }),
          ],
        },
      });
      await waitFor(() => expect(admissionStarted).toBe(true));
      await act(async () => {
        if (change === 'account') beginAccountTransition(memory.queryClient);
        else cleanup();
        resume();
      });
      expect(upload).not.toHaveBeenCalled();
      expect(screen.queryByTestId('composer-reference')).toBeNull();
    },
  );

  it('防抖尚未提交时切走再载入新草稿，旧定时器不得覆盖已载入内容', async () => {
    const memory = renderWorkbench({ seedSessions: ['原会话', '另一会话'] });
    fireEvent.click(await screen.findByTestId('session-session-1'));
    await waitFor(() => expect(useActiveSession.getState().activeSessionId).toBe('session-1'));
    const original = await memory.workbench.getSession('session-1');
    fireEvent.change(screen.getByTestId('composer-prompt'), { target: { value: '旧定时输入' } });
    fireEvent.click(screen.getByTestId('session-session-2'));
    await waitFor(() => expect(useActiveSession.getState().activeSessionId).toBe('session-2'));
    const loaded = await memory.workbench.updateSession('session-1', {
      expectedVersion: original.version,
      draft: { ...original.draft, prompt: '重新载入的远端内容' },
    });
    await act(async () => {
      await memory.queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() });
    });
    fireEvent.click(screen.getByTestId('session-session-1'));
    await waitFor(() =>
      expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(
        '重新载入的远端内容',
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });
    expect(await memory.workbench.getSession('session-1')).toEqual(loaded);
    expect(screen.queryByTestId('session-draft-save-error')).toBeNull();
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: '载入后新的编辑' },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });
    expect((await memory.workbench.getSession('session-1')).draft.prompt).toBe('载入后新的编辑');
  });

  it('后台刷新不得把远端草稿版本授予本页旧输入，冲突核对后显式保存', async () => {
    const memory = renderWorkbench({ seedSessions: ['并发草稿'] });
    await waitFor(() => expect(useActiveSession.getState().activeSessionId).toBe('session-1'));
    const original = await memory.workbench.getSession('session-1');
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: '本地未保存输入' },
    });
    await act(async () => {
      await memory.workbench.updateSession('session-1', {
        expectedVersion: original.version,
        draft: { ...original.draft, prompt: '另一个窗口已提交的输入' },
      });
      await memory.queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() });
    });
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(
      '本地未保存输入',
    );
    // Give the real autosave debounce a chance to reach the versioned gateway.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });
    expect((await memory.workbench.getSession('session-1')).draft.prompt).toBe(
      '另一个窗口已提交的输入',
    );
    await screen.findByTestId('session-draft-save-error');
    expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('session-draft-review'));
    const dialog = await screen.findByTestId('session-draft-conflict-dialog');
    expect(within(dialog).getByLabelText('最新保存的草稿').textContent).toContain(
      '另一个窗口已提交的输入',
    );
    expect(within(dialog).getByLabelText('本页草稿').textContent).toContain('本地未保存输入');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByTestId('session-draft-conflict-dialog')).toBeNull());
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(
      '本地未保存输入',
    );
    fireEvent.click(screen.getByTestId('session-draft-review'));
    await screen.findByTestId('session-draft-conflict-dialog');
    const second = await memory.workbench.getSession('session-1');
    await act(async () => {
      await memory.workbench.updateSession('session-1', {
        expectedVersion: second.version,
        draft: { ...second.draft, prompt: '核对后再次修改' },
      });
      await memory.queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() });
    });
    fireEvent.click(screen.getByTestId('session-draft-save-local'));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('session-draft-conflict-dialog')).getByRole('alert'),
      ).toBeTruthy(),
    );
    expect((await memory.workbench.getSession('session-1')).draft.prompt).toBe('核对后再次修改');
    expect((screen.getByTestId('session-draft-save-local') as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByTestId('session-draft-review-refresh'));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('session-draft-conflict-dialog')).getByLabelText('最新保存的草稿')
          .textContent,
      ).toContain('核对后再次修改'),
    );
    fireEvent.click(screen.getByTestId('session-draft-save-local'));
    await waitFor(() => expect(screen.queryByTestId('session-draft-conflict-dialog')).toBeNull());
    expect((await memory.workbench.getSession('session-1')).draft.prompt).toBe('本地未保存输入');
    expect(screen.queryByTestId('session-draft-save-error')).toBeNull();
  });

  it('库「使用」送来的草稿装进 Composer,消费一次即清,不被会话草稿装载覆盖', async () => {
    useActiveSession.setState({
      pendingDraft: {
        prompt: 'film street photo',
        negative: 'blurry',
        params: { aspectRatio: '16:9', quality: 'high' },
        promptReferenceSelections: [],
        promptReferenceIds: [],
      },
    });
    // 预置一个会话(空草稿),验证送稿优先级:会话草稿装载不覆盖送来的稿。
    renderWorkbench({ seedSessions: ['未命名创作'] });

    await waitFor(() => {
      const textarea = screen.getByTestId('composer-prompt') as HTMLTextAreaElement;
      expect(textarea.value).toBe('film street photo');
    });
    expect(useActiveSession.getState().pendingDraft).toBeNull();
    // 比例参数一并送达(工具条比例钮显示 16:9)。
    expect(screen.getByTestId('composer-ratio').textContent).toContain('16:9');
  });

  it('引用-only 草稿写入与提交后清空按返回版本串行,不会在重载后复活', async () => {
    const memory = renderWorkbench({ seedSessions: ['引用创作'] });
    await waitFor(() => {
      expect(useActiveSession.getState().activeSessionId).toBe('session-1');
    });

    act(() => {
      useActiveSession.setState({
        pendingDraft: {
          prompt: '',
          negative: '',
          params: {},
          promptReferenceSelections: [
            { promptId: 'prompt-reference-1', scope: 'full', expectedVersion: 1 },
          ],
          promptReferenceIds: [],
        },
      });
    });

    await waitFor(() => {
      expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('composer-submit'));

    await waitFor(async () => {
      const session = await memory.workbench.getSession('session-1');
      expect(session.draft.promptReferenceSelections).toEqual([]);
      expect(session.version).toBe(3);
    });
    expect(memory.draftWriteVersions).toEqual([1, 2]);
  });

  it('「新设计」进入草稿空态:不建会话行,品牌空态呈现(标语 + 内联 Composer + 快捷建议)', async () => {
    // 预置一行:验证草稿态不回落最近会话、也不新增行。
    const memory = renderWorkbench({ seedSessions: ['旧创作'] });
    await waitFor(() => {
      expect(screen.getByTestId('session-create')).toBeTruthy();
    });

    // C-2:钮内快捷键提示走 Kbd 原语 + 单源(jsdom 非 mac 平台显示 Ctrl 系)。
    await waitFor(() => {
      const kbd = screen.getByTestId('session-create').querySelector('kbd');
      expect(kbd?.textContent).toBe('Ctrl+N');
      expect(kbd?.getAttribute('data-slot')).toBe('kbd');
    });
    // 初始自动定位到最近会话。
    await waitFor(() => {
      expect(useActiveSession.getState().activeSessionId).toBe('session-1');
    });

    fireEvent.click(screen.getByTestId('session-create'));
    await waitFor(() => {
      expect(screen.getByTestId('workbench-empty')).toBeTruthy();
    });
    // 草稿态:无新行、不回落既有会话、面板只剩种子行。
    expect(useActiveSession.getState().activeSessionId).toBeNull();
    expect(useActiveSession.getState().draftSession).toBe(true);
    expect(within(screen.getByTestId('session-panel')).queryByText('未命名创作')).toBeNull();
    expect((await memory.workbench.listSessions({})).items).toHaveLength(1);
    expect(screen.getByTestId('workbench-empty-slogan').textContent).toBe('把想法变成可生成的视觉');
    // 时段问候语(01 §3 承 ZCode):挂载后按本地时间落一条,tagline 降为副标。
    await waitFor(() => {
      expect(screen.getByTestId('workbench-empty-greeting').textContent).toBe(emptyStateGreeting());
    });
    // 空态问候不被时间线头顶标题行抢走(B5-T4)。
    expect(screen.queryByTestId('workbench-session-title')).toBeNull();
    expect(screen.queryByTestId('workbench-task-summary')).toBeNull();
    // 空态内联 Composer 与快捷建议共存;建议点击只回填草稿,不自动生成。
    const empty = screen.getByTestId('workbench-empty');
    expect(within(empty).getByTestId('composer-prompt')).toBeTruthy();

    // 03 §5 品牌动效恢复:水印逐字母拆分(8 字母,--i 错相),横滚轨道渲染双份序列。
    const watermark = within(empty).getByTestId('workbench-empty-watermark');
    const letters = watermark.querySelectorAll('span');
    expect(letters.length).toBe('Musefold'.length);
    expect((letters[3] as HTMLElement).style.getPropertyValue('--i')).toBe('3');
    const tracks = empty.querySelectorAll('.mf-workbench-direction-track');
    expect(tracks.length).toBe(3);
    expect(tracks[0]?.querySelectorAll('.mf-workbench-direction-item').length).toBe(8);

    const suggestions = screen.getAllByTestId('generation-example');
    expect(suggestions.length).toBe(3);
    fireEvent.click(suggestions[0]);
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(
      suggestions[0].textContent,
    );
    // 回填路径统一聚焦置尾(03 §6):建议点击后焦点落输入框,光标在末尾。
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('composer-prompt'));
    });
    const prompt = screen.getByTestId('composer-prompt') as HTMLTextAreaElement;
    expect(prompt.selectionStart).toBe(prompt.value.length);
    expect(screen.queryByTestId('job-status')).toBeNull();
  });

  it('有回合的活动会话在时间线头顶显示标题与排队摘要', async () => {
    const longTitle = `霓虹雨夜的城市街景${'一'.repeat(10)}`;
    renderWorkbench({
      seedSessions: [longTitle],
      seedJobs: [
        makeSeedJob({ id: 'job-seed', sessionId: 'session-1', status: 'queued', progress: 0 }),
      ],
      holdQueued: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId('timeline')).toBeTruthy();
    });
    const title = screen.getByTestId('workbench-session-title');
    expect(title.getAttribute('title')).toBe(longTitle);
    expect(title.textContent).toBe(formatSessionTitle(longTitle));
    expect(screen.getByTestId('workbench-task-summary').textContent).toBe('排队中');
    // md+ 行,不替代移动端会话选择器。
    expect(screen.getByTestId('session-picker')).toBeTruthy();
  });

  it('新会话草稿继承默认比例/质量;已改草稿不被覆盖', async () => {
    renderWorkbench({
      preferences: { defaultAspectRatio: '16:9', defaultQuality: 'high' },
    });

    fireEvent.click(await screen.findByTestId('session-create'));
    await waitFor(() => {
      expect(screen.getByTestId('composer-ratio').textContent).toContain('16:9');
    });
    fireEvent.click(screen.getByTestId('composer-settings'));
    expect(screen.getByTestId('composer-quality-high').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByTestId('composer-ratio'));
    fireEvent.click(await screen.findByTestId('composer-ratio-1x1'));
    await waitFor(() => {
      expect(screen.getByTestId('composer-ratio').textContent).toContain('1:1');
    });
    expect(useActiveSession.getState().draftParamOverrides.aspectRatio).toBe('1:1');

    // 默认值变更只覆盖未显式改过的字段(质量仍继承,比例保持用户选择)。
    expect(
      resolveInheritedGenerationParams(
        { defaultAspectRatio: '21:9', defaultQuality: 'low', defaultCount: 1 },
        useActiveSession.getState().draftParamOverrides,
      ),
    ).toEqual({ aspectRatio: '1:1', quality: 'low', count: 1 });
  });

  it('新会话继承默认张数;显式改张数后按覆盖值提交(§9-D3)', async () => {
    const memory = renderWorkbench({ preferences: { defaultCount: 4 } });
    const createSpy = vi.spyOn(memory.generation, 'create');

    fireEvent.click(await screen.findByTestId('session-create'));
    fireEvent.click(await screen.findByTestId('composer-settings'));
    await waitFor(() => {
      expect(screen.getByTestId('composer-count-4').getAttribute('aria-checked')).toBe('true');
    });
    expect(screen.getByTestId('composer-settings').textContent).toContain('4 张');

    fireEvent.click(screen.getByTestId('composer-count-2'));
    await waitFor(() => {
      expect(useActiveSession.getState().draftParamOverrides.count).toBe(2);
    });

    fireEvent.change(screen.getByTestId('composer-prompt'), { target: { value: '两张试试' } });
    fireEvent.click(screen.getByTestId('composer-submit'));

    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    expect(createSpy.mock.calls[0]?.[0]).toMatchObject({ count: 2 });
  });

  it('草稿态首次发送才建会话,标题由首句派生', async () => {
    const memory = renderWorkbench({ seedSessions: ['旧创作'] });
    await waitFor(() => {
      expect(screen.getByTestId('session-create')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('session-create'));
    await waitFor(() => {
      expect(screen.getByTestId('workbench-empty')).toBeTruthy();
    });
    expect((await memory.workbench.listSessions({})).items).toHaveLength(1);

    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: '霓虹雨夜的城市街景' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));

    // 发送时建会话:标题=首句派生,新行入列并成为活动会话。
    await waitFor(async () => {
      const sessions = await memory.workbench.listSessions({});
      expect(sessions.items).toHaveLength(2);
      expect(sessions.items.map((s) => s.title)).toContain('霓虹雨夜的城市街景');
    });
    await waitFor(() => {
      expect(
        within(screen.getByTestId('session-panel')).getByText('霓虹雨夜的城市街景'),
      ).toBeTruthy();
    });
    expect(useActiveSession.getState().draftSession).toBe(false);
  });

  it('提交生成:渲染完成回合与资产,输入清空', async () => {
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'a cat in the rain' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));

    // 提交自动建会话,job 进时间线;内存 gateway 在下一次 list 读取翻成 succeeded。
    await waitFor(() => {
      expect(within(screen.getByTestId('timeline')).getByText('a cat in the rain')).toBeTruthy();
    });
    await waitFor(
      () => {
        expect(screen.getByTestId('job-status').getAttribute('data-status')).toBe('succeeded');
      },
      { timeout: 4_000 },
    );
    // 03-C6 结果就位 reveal:本次会话内经历「生成中→成图」的回合带落定动画类(落在图格上)。
    expect(screen.getByTestId('job-asset-tile').className).toContain('mf-workbench-result-reveal');
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe('');
  });

  it('时间线离底出现「回到最新」pill,点击回贴底并消失(03 §4)', async () => {
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'seaside town at dusk' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('timeline')).toBeTruthy();
    });

    // 贴底(初始)不显示 pill。
    expect(screen.queryByTestId('timeline-back-to-latest')).toBeNull();

    // jsdom 无布局:注入滚动几何模拟「离底 > 80px」。
    const viewport = screen.getByTestId('timeline');
    Object.defineProperty(viewport, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: 400, configurable: true });
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);
    const pill = await screen.findByTestId('timeline-back-to-latest');

    // 点击回贴底:滚动到底部,pill 消失。
    const scrollTo = vi.fn();
    (viewport as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    fireEvent.click(pill);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1000 }));
    expect(screen.queryByTestId('timeline-back-to-latest')).toBeNull();
  });

  it('贴底时内容尺寸变化会继续贴底', async () => {
    const callbacks: ResizeObserverCallback[] = [];
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class MockResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }

        observe = observe;
        disconnect = disconnect;
      },
    );
    try {
      renderWorkbench();
      await waitFor(() => {
        expect(screen.getByTestId('composer-prompt')).toBeTruthy();
      });
      fireEvent.change(screen.getByTestId('composer-prompt'), {
        target: { value: 'resize while pinned' },
      });
      fireEvent.click(screen.getByTestId('composer-submit'));
      await waitFor(
        () => {
          expect(screen.getByTestId('job-status').getAttribute('data-status')).toBe('succeeded');
        },
        { timeout: 4_000 },
      );
      await waitFor(() => expect(callbacks.length).toBeGreaterThan(0));

      const timeline = screen.getByTestId('timeline');
      let scrollHeight = 600;
      Object.defineProperty(timeline, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      });
      Object.defineProperty(timeline, 'clientHeight', {
        configurable: true,
        value: 400,
      });
      timeline.scrollTop = 200;
      scrollHeight = 1_000;
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver));
      expect(timeline.scrollTop).toBe(1_000);
      expect(observe).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('用户离底后内容尺寸变化不会抢回滚动位置', async () => {
    const callbacks: ResizeObserverCallback[] = [];
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class MockResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }

        observe = observe;
        disconnect = disconnect;
      },
    );
    try {
      renderWorkbench();
      await waitFor(() => {
        expect(screen.getByTestId('composer-prompt')).toBeTruthy();
      });
      fireEvent.change(screen.getByTestId('composer-prompt'), {
        target: { value: 'resize while reading' },
      });
      fireEvent.click(screen.getByTestId('composer-submit'));
      await waitFor(
        () => {
          expect(screen.getByTestId('job-status').getAttribute('data-status')).toBe('succeeded');
        },
        { timeout: 4_000 },
      );
      await waitFor(() => expect(callbacks.length).toBeGreaterThan(0));

      const timeline = screen.getByTestId('timeline');
      let scrollHeight = 1_000;
      Object.defineProperty(timeline, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight,
      });
      Object.defineProperty(timeline, 'clientHeight', {
        configurable: true,
        value: 400,
      });
      timeline.scrollTop = 100;
      fireEvent.scroll(timeline);
      await waitFor(() => {
        expect(screen.getByTestId('timeline-back-to-latest')).toBeTruthy();
      });

      scrollHeight = 1_400;
      act(() => callbacks.at(-1)?.([], {} as ResizeObserver));
      expect(timeline.scrollTop).toBe(100);
      expect(screen.getByTestId('timeline-back-to-latest')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('用户消息「编辑」回填请求参数并聚焦置尾;「复制」写剪贴板(03 §4)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'a cat in the rain' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(
      () => {
        expect(screen.getByTestId('job-status').getAttribute('data-status')).toBe('succeeded');
      },
      { timeout: 4_000 },
    );
    // 提交后输入已清空;「编辑」把原消息回填。
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(screen.getByTestId('job-edit-message'));
    const prompt = screen.getByTestId('composer-prompt') as HTMLTextAreaElement;
    expect(prompt.value).toBe('a cat in the rain');
    await waitFor(() => {
      expect(document.activeElement).toBe(prompt);
    });
    expect(prompt.selectionStart).toBe('a cat in the rain'.length);

    fireEvent.click(screen.getByTestId('job-copy-message'));
    expect(writeText).toHaveBeenCalledWith('a cat in the rain');
  });

  it('结果动作「存为提示词」:Dialog 预览确认建条目,默认标题取前 20 字(03 §7)', async () => {
    const memory = renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'sunset harbor with tall ships' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(
      () => {
        expect(screen.getByTestId('job-status').getAttribute('data-status')).toBe('succeeded');
      },
      { timeout: 4_000 },
    );

    fireEvent.click(screen.getByTestId('job-save-prompt'));
    await waitFor(() => {
      expect(screen.getByTestId('save-prompt-dialog')).toBeTruthy();
    });
    expect(screen.getByTestId('save-prompt-preview').textContent).toBe(
      'sunset harbor with tall ships',
    );
    fireEvent.click(screen.getByTestId('save-prompt-confirm'));

    await waitFor(() => {
      expect(memory.promptCreates.length).toBe(1);
    });
    expect(memory.promptCreates[0]).toMatchObject({
      title: 'sunset harbor with t',
      content: 'sunset harbor with tall ships',
      source: 'generation',
      modelId: 'test-model',
    });
    await waitFor(() => {
      expect(screen.queryByTestId('save-prompt-dialog')).toBeNull();
    });
  });

  it('结果动作「保存图片」:走 gateway.saveAsset,文件名按资产 id + mime 派生(03 §5)', async () => {
    const memory = renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'harbor at dawn' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(
      () => {
        expect(screen.getByTestId('job-status').getAttribute('data-status')).toBe('succeeded');
      },
      { timeout: 4_000 },
    );

    fireEvent.click(screen.getByTestId('job-save-asset'));
    await waitFor(() => {
      expect(memory.assetSaves.length).toBe(1);
    });
    // 提交时自动建会话占 seq 1,回合是 job-2;资产 id job-2-asset 取前 8 位。
    expect(memory.assetSaves[0]).toEqual({
      url: 'https://example.test/image.png',
      name: 'musefold-job-2-as.png',
    });
  });

  it('生成中「编辑消息」禁用(旧版语义:running 时不改稿)', async () => {
    renderWorkbench({ holdQueued: true });
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'city lights' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('job-status').getAttribute('data-status')).toBe('queued');
    });
    expect((screen.getByTestId('job-edit-message') as HTMLButtonElement).disabled).toBe(true);
  });

  it('参考图:选择入图成 chip、可移除,随提交带入请求并在回合附件区显示', async () => {
    const memory = renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });

    // 文件选择路入图(拖拽/粘贴共用同一汇聚点,E2E 另覆盖拖拽)。
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'ref.png', {
      type: 'image/png',
    });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('composer-reference').getAttribute('data-status')).toBe('ready');
    });

    // 第二张添加后立即移除。
    const second = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'ref2.jpg', {
      type: 'image/jpeg',
    });
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [second] } });
    // 等两张都 ready(uploading 态 chip 是 Spinner,没有移除按钮),再精确移除第二张。
    await waitFor(() => {
      const chips = screen.getAllByTestId('composer-reference');
      expect(chips).toHaveLength(2);
      expect(chips.every((chip) => chip.getAttribute('data-status') === 'ready')).toBe(true);
    });
    fireEvent.click(screen.getByLabelText('移除参考图 ref2.jpg'));
    await waitFor(() => {
      expect(screen.getAllByTestId('composer-reference')).toHaveLength(1);
    });

    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'remix with reference' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));

    // 请求携带参考图;回合附件区显示缩略;提交后草稿缩略条清空。
    await waitFor(() => {
      expect(screen.getByTestId('job-references')).toBeTruthy();
    });
    expect(screen.getByTestId('job-references').querySelectorAll('img')).toHaveLength(1);
    expect(screen.queryByTestId('composer-reference')).toBeNull();
    const page = await memory.generation.list({});
    expect(page.items[0]?.request.referenceImages).toHaveLength(1);
    expect(page.items[0]?.request.referenceImages[0]?.name).toBe('ref.png');
  });

  it('删除回合经 AlertDialog 确认后从时间线移除', async () => {
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'to be removed' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(
      () => {
        expect(screen.getByTestId('job-status').getAttribute('data-status')).toBe('succeeded');
      },
      { timeout: 4_000 },
    );

    fireEvent.click(screen.getByTestId('job-remove'));
    await waitFor(() => {
      expect(screen.getByTestId('job-remove-confirm')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('job-remove-confirm'));

    // 软删后时间线回到品牌空态。
    await waitFor(() => {
      expect(screen.queryByTestId('job-status')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('workbench-empty')).toBeTruthy();
    });
  });

  it('行内重命名会话', async () => {
    const memory = renderWorkbench({ seedSessions: ['未命名创作'] });
    await waitFor(() => {
      expect(screen.getByTestId('session-rename')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('session-rename'));
    fireEvent.change(screen.getByTestId('session-rename-input'), {
      target: { value: '霓虹雨夜' },
    });
    fireEvent.click(screen.getByTestId('session-rename-commit'));

    await waitFor(() => {
      expect(within(screen.getByTestId('session-panel')).getByText('霓虹雨夜')).toBeTruthy();
    });
    const sessions = await memory.workbench.listSessions({});
    expect(sessions.items[0]?.title).toBe('霓虹雨夜');
  });

  it('删除会话需经确认对话框', async () => {
    const memory = renderWorkbench({ seedSessions: ['未命名创作'] });
    await waitFor(() => {
      expect(screen.getByTestId('session-remove')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('session-remove'));
    await waitFor(() => {
      expect(screen.getByTestId('session-remove-confirm')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('session-remove-confirm'));

    await waitFor(() => {
      expect(within(screen.getByTestId('session-panel')).queryByText('未命名创作')).toBeNull();
    });
    const sessions = await memory.workbench.listSessions({});
    expect(sessions.items).toHaveLength(0);
  });

  it('删除失败保留当前输入和确认框，重试成功后隔离最后一条会话的未保存草稿', async () => {
    const memory = renderWorkbench({ seedSessions: ['最后一条'] });
    await waitFor(() => expect(useActiveSession.getState().activeSessionId).toBe('session-1'));
    const remove = vi
      .spyOn(memory.workbench, 'removeSession')
      .mockRejectedValueOnce(new Error('删除离线'));
    const write = vi.spyOn(memory.workbench, 'updateSession');
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: '不能带到新会话的草稿' },
    });
    fireEvent.click(screen.getByTestId('session-remove'));
    fireEvent.click(await screen.findByTestId('session-remove-confirm'));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((screen.getByTestId('session-remove-confirm') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(
      '不能带到新会话的草稿',
    );
    expect(useActiveSession.getState().activeSessionId).toBe('session-1');
    fireEvent.click(screen.getByTestId('session-remove-confirm'));
    await waitFor(() => expect(useActiveSession.getState().draftSession).toBe(true));
    await waitFor(() =>
      expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(''),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 850));
    });
    expect(write).not.toHaveBeenCalled();
    expect((await memory.workbench.getSession('session-1')).draft.prompt).toBe('');
    remove.mockRestore();
    write.mockRestore();
  });

  it('活动会话仅从分页消失时按id核对，保留未保存输入而不切到列表首', async () => {
    const memory = renderWorkbench({ seedSessions: ['旧会话', '活动会话'] });
    await waitFor(() => expect(useActiveSession.getState().activeSessionId).toBe('session-2'));
    fireEvent.change(screen.getByTestId('composer-prompt'), { target: { value: '还在编辑' } });
    const kept = await memory.workbench.getSession('session-1');
    const list = vi
      .spyOn(memory.workbench, 'listSessions')
      .mockResolvedValue({ items: [kept], nextCursor: 'has-more' });
    const get = vi.spyOn(memory.workbench, 'getSession');
    await act(async () => {
      await memory.queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() });
    });
    await waitFor(() => expect(get).toHaveBeenCalledWith('session-2'));
    expect(useActiveSession.getState().activeSessionId).toBe('session-2');
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe('还在编辑');
    list.mockRestore();
    get.mockRestore();
  });

  it('刷新确认其他页面已删除当前会话后清除旧输入，回退到剩余会话且草稿不串会话', async () => {
    const memory = renderWorkbench({ seedSessions: ['保留会话', '远端删除目标'] });
    await waitFor(() => expect(useActiveSession.getState().activeSessionId).toBe('session-2'));
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: '被删除会话的草稿' },
    });
    await act(async () => {
      await memory.workbench.removeSession('session-2');
      await memory.queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() });
    });
    await waitFor(() => expect(useActiveSession.getState().activeSessionId).toBe('session-1'));
    expect(useActiveSession.getState().draftSession).toBe(false);
    await waitFor(() =>
      expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(''),
    );
    expect(screen.getByTestId('session-session-1')).toBeTruthy();
  });

  it('活动会话核对失败保留输入并阻止发送，显式重新核对后恢复', async () => {
    const memory = renderWorkbench({ seedSessions: ['活动会话'] });
    await waitFor(() => expect(useActiveSession.getState().activeSessionId).toBe('session-1'));
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: '网络失败不要丢' },
    });
    const list = vi
      .spyOn(memory.workbench, 'listSessions')
      .mockResolvedValue({ items: [], nextCursor: null });
    const get = vi
      .spyOn(memory.workbench, 'getSession')
      .mockRejectedValueOnce(new Error('读取离线'));
    const generate = vi.spyOn(memory.generation, 'create');
    await act(async () => {
      await memory.queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() });
    });
    await screen.findByTestId('session-current-error');
    expect(useActiveSession.getState().activeSessionId).toBe('session-1');
    fireEvent.click(screen.getByTestId('composer-submit'));
    expect(generate).not.toHaveBeenCalled();
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe(
      '网络失败不要丢',
    );
    fireEvent.click(screen.getByRole('button', { name: '重新核对' }));
    await waitFor(() => expect(screen.queryByTestId('session-current-error')).toBeNull());
    expect(useActiveSession.getState().activeSessionId).toBe('session-1');
    list.mockRestore();
    get.mockRestore();
    generate.mockRestore();
  });

  it('置顶会话排到列表首并写入偏好,取消后复原', async () => {
    // 预置两行:较新的 session-2 默认排前。
    const memory = renderWorkbench({ seedSessions: ['未命名创作', '未命名创作'] });
    await waitFor(() => {
      expect(screen.getByTestId('session-session-1')).toBeTruthy();
      expect(screen.getByTestId('session-session-2')).toBeTruthy();
    });

    // 置顶较旧的 session-1 → 跃居列表首,行带置顶标记。
    // 分组渲染(02 §7)下置顶会把行迁入「置顶」组重建 DOM,断言后重新取行节点。
    const panel = screen.getByTestId('session-panel');
    const rowOf = (id: string) =>
      screen.getByTestId(`session-${id}`).closest('div[class*="group"]') as HTMLElement;
    fireEvent.click(within(rowOf('session-1')).getByTestId('session-pin'));
    await waitFor(async () => {
      const prefs = await memory.settings.getPreferences();
      expect(prefs.pinnedSessionIds).toEqual(['session-1']);
    });
    await waitFor(() => {
      const rows = within(panel).getAllByTestId(/^session-session-/);
      expect(rows[0]?.getAttribute('data-testid')).toBe('session-session-1');
    });
    expect(within(rowOf('session-1')).getByLabelText('已置顶')).toBeTruthy();
    // 分组标题:置顶组与今天组并存(承旧 groupWorkbenchSessions)。
    expect(
      within(panel)
        .getAllByTestId('session-group-label')
        .map((label) => label.textContent),
    ).toEqual(['置顶', '今天']);

    // 取消置顶 → 恢复 updatedAt 序(session-2 在前)。
    fireEvent.click(within(rowOf('session-1')).getByTestId('session-pin'));
    await waitFor(() => {
      const rows = within(panel).getAllByTestId(/^session-session-/);
      expect(rows[0]?.getAttribute('data-testid')).toBe('session-session-2');
    });
  });

  it('右键菜单五项;「标记为未读」点亮行首点,打开会话即清(02 §7)', async () => {
    // 预置两行:活动会话落较新的 session-2,session-1 非活动(活动会话不显未读点)。
    renderWorkbench({ seedSessions: ['未命名创作', '未命名创作'] });
    await waitFor(() => {
      expect(screen.getByTestId('session-session-1')).toBeTruthy();
      expect(screen.getByTestId('session-session-2')).toBeTruthy();
    });

    fireEvent.contextMenu(screen.getByTestId('session-session-1'));
    const menu = await screen.findByTestId('session-context-menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['置顶对话', '重命名', '归档对话', '标记为未读', '删除对话']);

    fireEvent.click(within(menu).getByTestId('session-context-unread'));
    await waitFor(() => {
      const row = screen
        .getByTestId('session-session-1')
        .closest('div[class*="group"]') as HTMLElement;
      expect(within(row).getByTestId('session-status-unread')).toBeTruthy();
    });

    // 打开该会话 → 未读点即清(setActiveSessionId 清 unreadMarks)。
    fireEvent.click(screen.getByTestId('session-session-1'));
    await waitFor(() => {
      expect(screen.queryByTestId('session-status-unread')).toBeNull();
    });
  });

  it('提交生成后会话行出现运行状态点', async () => {
    renderWorkbench({ holdQueued: true });
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'status dot check' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));

    // 提交自动建会话并 invalidate 会话列表 → 行首出现 running 动画点(§3.3)。
    await waitFor(() => {
      expect(
        within(screen.getByTestId('session-panel')).getByTestId('session-status-running'),
      ).toBeTruthy();
    });
  });

  it('无可用 Provider:发送禁用并显示去设置引导', async () => {
    const onOpenSettings = vi.fn();
    renderWorkbench({ noProviders: true, onOpenSettings });
    await waitFor(() => {
      expect(screen.getByTestId('composer-no-provider')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'should not submit' },
    });
    expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText('前往设置添加'));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(useScreenIntent.getState().intent).toEqual({
      kind: 'settings-section',
      section: 'connections',
    });
  });

  it('提交失败带 AUTH 码时 generation-error 可点检查密钥', async () => {
    const onOpenSettings = vi.fn();
    const createError = Object.assign(new Error('API Key 无效或无权限'), {
      code: 'AUTH_CREDENTIALS_INVALID',
    });
    renderWorkbench({ onOpenSettings, createError });
    await waitFor(() => expect(screen.getByTestId('composer-prompt')).toBeTruthy());
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'will fail auth' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(screen.getByTestId('generation-error')).toBeTruthy());
    expect(screen.getByTestId('generation-error').textContent).toContain('API Key 无效');
    fireEvent.click(screen.getByTestId('generation-error-action'));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(useScreenIntent.getState().intent).toEqual({
      kind: 'settings-section',
      section: 'connections',
    });
  });

  it('提交失败带额度码时 generation-error 可点去兑换', async () => {
    const onOpenSettings = vi.fn();
    const createError = Object.assign(new Error('账户额度不足'), {
      code: 'ACCOUNT_QUOTA_INSUFFICIENT',
    });
    renderWorkbench({ onOpenSettings, createError });
    await waitFor(() => expect(screen.getByTestId('composer-prompt')).toBeTruthy());
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'will fail quota' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => expect(screen.getByTestId('generation-error')).toBeTruthy());
    expect(screen.getByTestId('generation-error').textContent).toContain('账户额度不足');
    fireEvent.click(screen.getByTestId('generation-error-action'));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(useScreenIntent.getState().intent).toEqual({
      kind: 'settings-section',
      section: 'account',
    });
  });

  it('Web 云端 canGenerate=false 时不打网关并展示去兑换', async () => {
    const onOpenSettings = vi.fn();
    const memory = renderWorkbench({
      onOpenSettings,
      accountStatus: {
        id: 'u1',
        username: 'xiaomiao',
        displayName: null,
        quota: 0,
        quotaUnit: '点',
        canGenerate: false,
      },
    });
    const createSpy = vi.spyOn(memory.generation, 'create');
    await waitFor(() => expect(screen.getByTestId('generation-error')).toBeTruthy());
    expect(screen.getByTestId('generation-error').textContent).toContain('账户额度不足');
    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'need quota' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));
    expect(createSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('generation-error-action'));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(useScreenIntent.getState().intent).toEqual({
      kind: 'settings-section',
      section: 'account',
    });
  });

  it('待审批回合显示只读审批卡,已拒绝显示拒绝卡', async () => {
    renderWorkbench({
      seedSessions: ['审批中'],
      seedJobs: [
        makeSeedJob({
          id: 'job-approve',
          sessionId: 'session-1',
          status: 'pending_approval',
          progress: 0,
          finishedAt: null,
        }),
      ],
      holdQueued: true,
    });
    await waitFor(() => expect(screen.getByTestId('job-approval-card')).toBeTruthy());
    expect(screen.getByTestId('job-approval-card').textContent).toContain('等待批准');
    expect(screen.getByTestId('workbench-task-summary').textContent).toBe('待审批');
  });

  it('已拒绝回合显示只读拒绝卡,不提供批准入口', async () => {
    renderWorkbench({
      seedSessions: ['已拒绝'],
      seedJobs: [
        makeSeedJob({
          id: 'job-rejected',
          sessionId: 'session-1',
          status: 'rejected',
          progress: 0,
        }),
      ],
    });
    await waitFor(() => expect(screen.getByTestId('job-approval-rejected')).toBeTruthy());
    expect(screen.getByTestId('job-approval-rejected').textContent).toContain('未获批准');
    expect(screen.queryByTestId('job-approve')).toBeNull();
    expect(screen.queryByTestId('job-approval-card')).toBeNull();
  });

  it('比例与设置弹层写入 Composer 值(11 档目录 + 质量档承旧命名)', async () => {
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('composer-ratio')).toBeTruthy();
    });
    // 触发钮初始显示 auto(mono 承旧)。
    expect(screen.getByTestId('composer-ratio').textContent).toContain('auto');

    fireEvent.click(screen.getByTestId('composer-ratio'));
    await waitFor(() => {
      expect(screen.getByTestId('composer-ratio-16x9')).toBeTruthy();
    });
    // 比例目录承旧 v2.1 全集(11 档,auto 殿后)。
    const grid = screen.getByTestId('composer-ratio-grid');
    expect(within(grid).getAllByRole('option')).toHaveLength(11);
    expect(within(grid).getByTestId('composer-ratio-2x3')).toBeTruthy();
    expect(within(grid).getByTestId('composer-ratio-21x9')).toBeTruthy();
    fireEvent.click(screen.getByTestId('composer-ratio-16x9'));
    await waitFor(() => {
      expect(screen.getByTestId('composer-ratio').textContent).toContain('16:9');
    });

    // 设置触发钮显示当前质量档值摘要(承旧 generation-trigger)。
    expect(screen.getByTestId('composer-settings').textContent).toContain('自动');
    fireEvent.click(screen.getByTestId('composer-settings'));
    await waitFor(() => {
      expect(screen.getByTestId('composer-negative')).toBeTruthy();
    });
    // 质量档为 radio 组,文案承旧(自动/标准/高清/超清)。
    const qualityGroup = screen.getByTestId('composer-quality');
    expect(
      within(qualityGroup)
        .getAllByRole('radio')
        .map((option) => option.textContent),
    ).toEqual(['自动', '标准', '高清', '超清']);
    fireEvent.click(screen.getByTestId('composer-quality-high'));
    await waitFor(() => {
      expect(screen.getByTestId('composer-quality-high').getAttribute('aria-checked')).toBe('true');
    });
    expect(screen.getByTestId('composer-settings').textContent).toContain('超清');

    fireEvent.change(screen.getByTestId('composer-negative'), {
      target: { value: 'blurry, low quality' },
    });
    expect((screen.getByTestId('composer-negative') as HTMLTextAreaElement).value).toBe(
      'blurry, low quality',
    );
    // 反向词非空后触发钮摘要追加提示。
    expect(screen.getByTestId('composer-settings').textContent).toContain('反向词');
  });

  it('⌘/Ctrl+Enter 发送;IME 组合期(keyCode 229)Enter 不触发', async () => {
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });

    const prompt = screen.getByTestId('composer-prompt');
    fireEvent.change(prompt, { target: { value: 'ime guarded prompt' } });
    // 组合态回车(keyCode 229)不提交(承旧 IME 守卫)。
    fireEvent.keyDown(prompt, { key: 'Enter', keyCode: 229 });
    expect(screen.queryByTestId('job-status')).toBeNull();

    // 修饰键回车提交(⌘/Ctrl+Enter 别名,承旧)。
    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(within(screen.getByTestId('timeline')).getByText('ime guarded prompt')).toBeTruthy();
    });
    await waitFor(() => {
      expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe('');
    });
  });

  it('Esc 停止进行中的生成(承旧窗口级快捷键)', async () => {
    renderWorkbench({ holdQueued: true });
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('composer-prompt'), {
      target: { value: 'escape to cancel' },
    });
    fireEvent.click(screen.getByTestId('composer-submit'));
    // 进入运行态:提交钮换成停止钮。
    await waitFor(() => {
      expect(screen.getByTestId('composer-cancel')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByTestId('job-status').getAttribute('data-status')).toBe('cancelled');
    });
  });

  it('移动端悬浮 Composer 按 visualViewport 抬离软键盘;md+ 不抬', async () => {
    const keyboard = stubSoftKeyboardViewport({
      desktop: false,
      innerHeight: 800,
      viewportHeight: 500,
      offsetTop: 20,
    });
    try {
      renderWorkbench({
        seedSessions: ['已有创作'],
        seedJobs: [makeSeedJob({ id: 'job-seed', sessionId: 'session-1' })],
      });
      await waitFor(() => {
        expect(screen.getByTestId('composer-dock')).toBeTruthy();
      });
      expect(screen.getByTestId('composer-dock').style.bottom).toBe('280px');

      keyboard.setDesktop(true);
      await waitFor(() => {
        expect(screen.getByTestId('composer-dock').style.bottom).toBe('');
      });
    } finally {
      keyboard.restore();
    }
  });

  it('空态内联 Composer 同步套用软键盘 paddingBottom', async () => {
    const keyboard = stubSoftKeyboardViewport({
      desktop: false,
      innerHeight: 800,
      viewportHeight: 500,
      offsetTop: 20,
    });
    try {
      renderWorkbench();
      await waitFor(() => {
        expect(screen.getByTestId('composer-empty-inset')).toBeTruthy();
      });
      expect(screen.getByTestId('composer-empty-inset').style.paddingBottom).toBe('280px');
    } finally {
      keyboard.restore();
    }
  });

  it('移动端时间线底部 padding 叠加软键盘 inset;md+ 保持 172/220', async () => {
    const keyboard = stubSoftKeyboardViewport({
      desktop: false,
      innerHeight: 800,
      viewportHeight: 500,
      offsetTop: 20,
    });
    try {
      renderWorkbench({
        seedSessions: ['已有创作'],
        seedJobs: [makeSeedJob({ id: 'job-seed', sessionId: 'session-1' })],
      });
      await waitFor(() => {
        expect(screen.getByTestId('timeline')).toBeTruthy();
      });
      const timeline = screen.getByTestId('timeline');
      // 800 - 500 - 20 = 280; 172 + 280 = 452
      expect(timeline.getAttribute('data-keyboard-inset')).toBe('280');
      expect(timeline.style.paddingBottom).toBe('452px');

      keyboard.setDesktop(true);
      await waitFor(() => {
        expect(timeline.getAttribute('data-keyboard-inset')).toBe('0');
      });
      expect(timeline.style.paddingBottom).toBe('');
      expect(timeline.className).toContain('pb-[172px]');
      expect(timeline.className).toContain('md:pb-[220px]');
    } finally {
      keyboard.restore();
    }
  });
});

describe('isSessionUnread(§3.3 未读点推导)', () => {
  const base = { id: 's1', latestJobStatus: 'succeeded', latestJobFinishedAt: nowIso(60_000) };

  it('运行期内完成且未查看 → 未读;查看后清除', () => {
    expect(isSessionUnread(base, null, {})).toBe(true);
    expect(isSessionUnread(base, null, { s1: Date.now() + 120_000 })).toBe(false);
  });

  it('活动会话与非成功终态不标未读', () => {
    expect(isSessionUnread(base, 's1', {})).toBe(false);
    expect(isSessionUnread({ ...base, latestJobStatus: 'failed' }, null, {})).toBe(false);
    expect(
      isSessionUnread({ ...base, latestJobStatus: null, latestJobFinishedAt: null }, null, {}),
    ).toBe(false);
  });

  it('启动前完成的历史会话不标未读', () => {
    expect(isSessionUnread({ ...base, latestJobFinishedAt: nowIso(-60_000) }, null, {})).toBe(
      false,
    );
  });

  it('手动标记未读:无成功任务也点亮;活动会话不亮(02 §7)', () => {
    const idle = { id: 's1', latestJobStatus: null, latestJobFinishedAt: null };
    expect(isSessionUnread(idle, null, {}, { s1: true })).toBe(true);
    expect(isSessionUnread(idle, 's1', {}, { s1: true })).toBe(false);
    expect(isSessionUnread(idle, null, {}, {})).toBe(false);
  });
});

describe('groupWorkbenchSessions(02 §7 日期分组,承旧)', () => {
  const now = new Date('2026-08-29T10:00:00+08:00');
  const at = (iso: string) => iso;
  const session = (id: string, updatedAt: string) =>
    ({ id, updatedAt, title: id }) as unknown as Parameters<typeof groupWorkbenchSessions>[0][0];

  it('置顶恒前;今天/昨天按本地日界;更早聚尾;空组不渲染', () => {
    const items = [
      session('today-late', at('2026-08-29T09:30:00+08:00')),
      session('pinned-old', at('2026-08-01T08:00:00+08:00')),
      session('yesterday-night', at('2026-08-28T23:59:00+08:00')),
      session('older', at('2026-08-27T23:59:00+08:00')),
      session('today-first-minute', at('2026-08-29T00:00:30+08:00')),
    ];
    const groups = groupWorkbenchSessions(items, new Set(['pinned-old']), now);
    expect(groups.map((group) => group.label)).toEqual(['置顶', '今天', '昨天', '更早']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['pinned-old']);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(['today-late', 'today-first-minute']);
    expect(groups[2]?.items.map((item) => item.id)).toEqual(['yesterday-night']);
    expect(groups[3]?.items.map((item) => item.id)).toEqual(['older']);
  });

  it('无置顶时不渲染置顶组;组内保持入参顺序(服务端 updatedAt 序)', () => {
    const groups = groupWorkbenchSessions(
      [
        session('a', at('2026-08-29T09:00:00+08:00')),
        session('b', at('2026-08-29T08:00:00+08:00')),
      ],
      new Set(),
      now,
    );
    expect(groups.map((group) => group.label)).toEqual(['今天']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('sessionRelativeTime(01 §2 行尾相对时间)', () => {
  const now = new Date('2026-08-29T12:00:00+08:00');

  it('按刚刚/分钟/小时/天/日期分档,未来时间按刚刚处理', () => {
    expect(sessionRelativeTime('2026-08-29T11:59:40+08:00', now)).toBe('刚刚');
    expect(sessionRelativeTime('2026-08-29T12:00:30+08:00', now)).toBe('刚刚');
    expect(sessionRelativeTime('2026-08-29T11:15:00+08:00', now)).toBe('45 分钟');
    expect(sessionRelativeTime('2026-08-29T09:00:00+08:00', now)).toBe('3 小时');
    expect(sessionRelativeTime('2026-08-25T12:00:00+08:00', now)).toBe('4 天');
    expect(sessionRelativeTime('2026-06-01T12:00:00+08:00', now)).toBe('6月1日');
  });
});

describe('emptyStateGreeting(01 §3 时段问候语)', () => {
  it('按本地小时分四档', () => {
    expect(emptyStateGreeting(new Date('2026-08-29T06:00:00'))).toBe('早上好，从一个想法开始');
    expect(emptyStateGreeting(new Date('2026-08-29T12:30:00'))).toBe('中午好，随手画点什么');
    expect(emptyStateGreeting(new Date('2026-08-29T15:00:00'))).toBe('下午好，继续你的创作');
    expect(emptyStateGreeting(new Date('2026-08-29T20:00:00'))).toBe('晚上好，灵感正好');
    expect(emptyStateGreeting(new Date('2026-08-29T03:00:00'))).toBe('晚上好，灵感正好');
  });
});

describe('deriveSessionTitle(草稿态首发建会话的标题派生)', () => {
  it('压缩空白取首句;超 24 字截断加省略号;空白兜底默认名', () => {
    expect(deriveSessionTitle('霓虹雨夜的城市街景')).toBe('霓虹雨夜的城市街景');
    expect(deriveSessionTitle('  多行\n提示词\t带空白  ')).toBe('多行 提示词 带空白');
    expect(deriveSessionTitle('一'.repeat(30))).toBe(`${'一'.repeat(24)}…`);
    expect(deriveSessionTitle('   \n\t ')).toBe('未命名创作');
  });
});

describe('formatSessionTitle(时间线头顶 16 字截断)', () => {
  it('不超过 16 个 Unicode 字符原样返回;超长截断加省略号', () => {
    expect(formatSessionTitle('霓虹雨夜')).toBe('霓虹雨夜');
    expect(formatSessionTitle('一'.repeat(16))).toBe('一'.repeat(16));
    expect(formatSessionTitle('一'.repeat(17))).toBe(`${'一'.repeat(16)}…`);
    // 代理对按 code point 计 1,不是 UTF-16 length。
    expect(formatSessionTitle(`${'🌟'.repeat(16)}🌙`)).toBe(`${'🌟'.repeat(16)}…`);
  });
});

describe('workbenchTaskSummary(活动任务摘要优先级)', () => {
  it('待审批优先于排队中', () => {
    expect(workbenchTaskSummary([{ status: 'pending_approval' }, { status: 'queued' }])).toBe(
      '待审批',
    );
  });

  it('排队中优先于生成中/方案运行/取消中', () => {
    expect(
      workbenchTaskSummary(
        [{ status: 'queued' }, { status: 'running' }, { status: 'cancelling' }],
        true,
      ),
    ).toBe('排队中');
  });

  it('有生成中任务时显示生成中,即使方案也在跑', () => {
    expect(workbenchTaskSummary([{ status: 'running' }], true)).toBe('生成中');
  });

  it('仅方案运行且无排队/生成中任务时显示方案运行中', () => {
    expect(workbenchTaskSummary([{ status: 'cancelling' }], true)).toBe('方案运行中');
    expect(workbenchTaskSummary([], true)).toBe('方案运行中');
  });

  it('无排队/生成/方案时取消中显示;终态隐藏', () => {
    expect(workbenchTaskSummary([{ status: 'cancelling' }])).toBe('取消中');
    expect(workbenchTaskSummary([{ status: 'succeeded' }, { status: 'failed' }])).toBeNull();
    expect(workbenchTaskSummary([])).toBeNull();
  });
});
