import type {
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
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  groupWorkbenchSessions,
  NewSessionAction,
  SessionListPanel,
  sessionRelativeTime,
} from '../SessionListPanel';
import { isSessionUnread, useActiveSession } from '../session-store';
import { emptyStateGreeting } from '../WorkbenchEmptyState';
import { deriveSessionTitle, WorkbenchScreen } from '../WorkbenchScreen';

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

/** 内存版 workbench + generation:提交即 queued,一次读取后翻成 succeeded。 */
function createMemoryWorkbench(options?: { noProviders?: boolean; holdQueued?: boolean }) {
  let seq = 0;
  const sessions = new Map<string, WorkbenchSession>();
  const jobs = new Map<string, GenerationJob>();
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
  };

  const generation: GenerationGateway = {
    create: async (input: CreateGenerationInput) => {
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
        : [{ id: 'p1', label: '测试连接', model: 'test-model', kind: 'local', available: true }],
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
  };

  // 会话置顶走偏好通道(SessionListPanel → usePreferences)。
  let preferences: AppPreferences = { ...defaultAppPreferences };
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

  return {
    workbench,
    generation,
    settings,
    prompts,
    promptCreates,
    assetSaves,
    draftWriteVersions,
  };
}

/** 组合渲染:壳侧栏会话区 + 工作台屏(与宿主同构),经共享 store 协作。 */
function renderWorkbench(options?: {
  noProviders?: boolean;
  holdQueued?: boolean;
  onOpenSettings?: () => void;
  /** 预置会话行(「新设计」已不直接建行,行级测试用种子行作靶)。 */
  seedSessions?: string[];
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
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
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
  return memory;
}

describe('Workbench(壳会话区 + 屏)', () => {
  beforeEach(() => {
    useActiveSession.setState({
      activeSessionId: null,
      draftSession: false,
      pendingDraft: null,
      seenAt: {},
      unreadMarks: {},
    });
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
      expect(screen.getByText('a cat in the rain')).toBeTruthy();
    });
    await waitFor(
      () => {
        expect(screen.getByTestId('job-status').getAttribute('data-status')).toBe('succeeded');
      },
      { timeout: 4_000 },
    );
    // 03-C6 结果就位 reveal:本次会话内经历「生成中→成图」的回合带落定动画类。
    expect(screen.getByTestId('job-asset').className).toContain('mf-workbench-result-reveal');
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
      expect(screen.getByText('ime guarded prompt')).toBeTruthy();
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
