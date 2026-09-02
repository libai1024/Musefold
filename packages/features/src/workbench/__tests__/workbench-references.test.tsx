import type {
  CreateGenerationInput,
  GenerationJob,
  NewPromptDocument,
  PromptDocument,
  PromptListQuery,
  PromptReferenceSelection,
  UpdateWorkbenchSession,
  WorkbenchDraft,
  WorkbenchSession,
} from '@musefold/contracts';
import type {
  GenerationGateway,
  MusefoldGateway,
  PromptsGateway,
  WorkbenchGateway,
} from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { toast } from '@musefold/ui/components/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveSession } from '../session-store';
import { WorkbenchScreen } from '../WorkbenchScreen';

vi.mock('@musefold/ui/components/sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@musefold/ui/components/sonner')>();
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn() } };
});

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

function makePrompt(id: string, overrides: Partial<PromptDocument> = {}): PromptDocument {
  return {
    id,
    title: `提示词 ${id}`,
    description: null,
    content: `${id} 正文:霓虹雨夜的城市街景`,
    negative: null,
    folderId: null,
    tags: [],
    modelId: null,
    params: null,
    rating: 0,
    isPinned: false,
    pinOrder: null,
    usageCount: 0,
    lastUsedAt: null,
    source: 'manual',
    sourceUrl: null,
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * 内存宿主:与真实双端同语义 —— create 把严格意图解析为不可变快照(不读任何客户端文本),
 * userPrompt 存原文;retry 原样复用快照;updateSession 按 expectedVersion 乐观锁。
 */
function createMemoryHost(options?: { prompts?: PromptDocument[]; seedJobs?: GenerationJob[] }) {
  let seq = 0;
  const sessions = new Map<string, WorkbenchSession>();
  const jobs = new Map<string, GenerationJob>();
  const promptDocs = new Map((options?.prompts ?? []).map((prompt) => [prompt.id, prompt]));
  const generationCreates: CreateGenerationInput[] = [];
  const draftWrites: UpdateWorkbenchSession[] = [];

  function requireSession(id: string): WorkbenchSession {
    const session = sessions.get(id);
    if (!session) throw new Error('NOT_FOUND');
    return session;
  }

  /** 宿主语义:严格意图 → 不可变快照;源缺失/删除即拒绝(不伪造)。 */
  function resolveSnapshots(input: CreateGenerationInput) {
    return (input.promptReferenceSelections ?? []).map((selection) => {
      const prompt = promptDocs.get(selection.promptId);
      if (!prompt) throw new Error('PROMPT_NOT_FOUND');
      return {
        promptId: prompt.id,
        title: prompt.title,
        text:
          selection.scope === 'full'
            ? prompt.content
            : prompt.content.slice(selection.range.start, selection.range.end),
        scope: selection.scope,
        sourceVersion: selection.expectedVersion,
      };
    });
  }

  function createJob(
    input: CreateGenerationInput,
    inherit?: { userPrompt: string; promptReferences: GenerationJob['promptReferences'] },
  ): GenerationJob {
    seq += 1;
    const job: GenerationJob = {
      id: `job-${seq}`,
      sessionId: input.sessionId ?? null,
      parentRunId: null,
      promptId: null,
      userPrompt: inherit?.userPrompt ?? input.prompt,
      promptReferences: inherit?.promptReferences ?? resolveSnapshots(input),
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'queued',
      progress: 0,
      request: {
        prompt: input.prompt,
        size: input.size ?? 'auto',
        quality: input.quality ?? 'auto',
        count: 1,
        referenceImages: [],
      },
      providerModel: 'test-model',
      costPoints: null,
      assets: [],
      error: null,
      createdAt: nowIso(seq),
      startedAt: null,
      finishedAt: null,
      deletedAt: null,
    };
    jobs.set(job.id, job);
    return job;
  }

  const workbench: WorkbenchGateway = {
    listSessions: async () => ({
      items: [...sessions.values()]
        .filter((session) => session.deletedAt == null && session.archivedAt == null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      nextCursor: null,
    }),
    createSession: async (input) => {
      seq += 1;
      const session: WorkbenchSession = {
        id: `session-${seq}`,
        title: input.title ?? '未命名创作',
        draft: { ...EMPTY_DRAFT, ...input.draft },
        version: 1,
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
      if (patch.draft !== undefined) draftWrites.push(patch);
      const next: WorkbenchSession = {
        ...session,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.draft !== undefined ? { draft: patch.draft } : {}),
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
    restoreSession: async (id) => requireSession(id),
  };

  const generation: GenerationGateway = {
    create: async (input) => {
      generationCreates.push(input);
      return createJob(input);
    },
    list: async (query) => {
      const items = [...jobs.values()].filter(
        (job) => (!query.sessionId || job.sessionId === query.sessionId) && job.deletedAt == null,
      );
      // 读取即推进 queued → succeeded(模拟后台完成,带一张资产)。
      for (const job of items) {
        if (job.status === 'queued') {
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
      // 重试 = 精确快照动作:userPrompt 与不可变引用原样保留。
      return createJob(
        { prompt: source.request.prompt, sessionId: source.sessionId ?? undefined },
        {
          userPrompt: source.userPrompt ?? source.request.prompt,
          promptReferences: source.promptReferences,
        },
      );
    },
    remove: async (id) => generation.get(id),
    restore: async (id) => generation.get(id),
    purge: async () => {},
    listProviders: async () => [
      { id: 'p1', label: '测试连接', model: 'test-model', kind: 'local', available: true },
    ],
    uploadReferenceImage: async (input) => ({
      id: 'REF0000000000000000000001',
      url: 'media://local/?p=%2Fuploads%2Fref-1.png',
      name: input.name,
      mimeType: 'image/png',
      byteSize: input.bytes.byteLength,
    }),
    saveAsset: async () => 'saved',
  };

  const prompts: PromptsGateway = {
    list: async (query: PromptListQuery) => {
      const all = [...promptDocs.values()];
      const filtered = query.q
        ? all.filter(
            (prompt) =>
              prompt.title.includes(query.q ?? '') || prompt.content.includes(query.q ?? ''),
          )
        : all;
      const limit = typeof query.limit === 'number' ? query.limit : 20;
      const start = typeof query.cursor === 'string' && query.cursor ? Number(query.cursor) : 0;
      const items = filtered.slice(start, start + limit);
      return {
        items,
        nextCursor: start + limit < filtered.length ? String(start + limit) : null,
      };
    },
    get: async (id: string) => {
      const prompt = promptDocs.get(id);
      if (!prompt || prompt.deletedAt != null) throw new Error('NOT_FOUND');
      return prompt;
    },
    create: async (input: NewPromptDocument): Promise<PromptDocument> => {
      throw new Error(`not implemented: ${input.title}`);
    },
  } as unknown as PromptsGateway;

  for (const job of options?.seedJobs ?? []) {
    jobs.set(job.id, job);
  }

  return { workbench, generation, prompts, generationCreates, draftWrites };
}

function renderWorkbench(host: ReturnType<typeof createMemoryHost>) {
  const gateway = host as unknown as MusefoldGateway;
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
  render(<WorkbenchScreen />, { wrapper: Providers });
}

/** 打开「添加上下文」菜单并进入参考素材面板(jsdom 默认移动形态:底部 Dialog)。 */
async function openReferencePanel() {
  await userEvent.click(screen.getByTestId('composer-attach'));
  await userEvent.click(await screen.findByTestId('workbench-context-ref-prompt'));
  await waitFor(() => {
    expect(screen.getByTestId('workbench-reference-sidebar')).toBeTruthy();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.getSelection()?.removeAllRanges();
  useActiveSession.setState({
    activeSessionId: null,
    draftSession: false,
    pendingDraft: null,
    seenAt: {},
    unreadMarks: {},
  });
});

describe('工作台 × 提示词引用(端到端)', () => {
  it('菜单进面板:移动形态含背景罩、焦点入搜索,Esc 关闭并归还触发钮', async () => {
    const host = createMemoryHost({ prompts: [makePrompt('p-1')] });
    renderWorkbench(host);
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });

    await openReferencePanel();
    expect(screen.getByTestId('workbench-reference-backdrop')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('workbench-reference-search'));
    });
    // 列表来自 prompts.list(默认最近更新)。
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-row')).toBeTruthy();
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('workbench-reference-sidebar')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('composer-attach'));
    });
  });

  it('引用整条 → 托盘卡解析展示;纯引用提交只携带严格意图,时间线呈现不可变快照', async () => {
    const host = createMemoryHost({
      prompts: [makePrompt('p-1', { title: '霓虹街景', version: 5 })],
    });
    renderWorkbench(host);
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });

    await openReferencePanel();
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-row')).toBeTruthy();
    });
    await userEvent.click(screen.getByTestId('workbench-reference-expand'));
    await userEvent.click(screen.getByTestId('workbench-reference-full'));
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-count').textContent).toBe('已引用 1/6');
    });

    // 关闭面板 → 托盘卡(owner-safe 解析:标题/整条副标/预览)。
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('workbench-reference-sidebar')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('workbench-context-tray')).toBeTruthy();
    });
    const trayCard = screen.getByTestId('prompt-reference-card');
    expect(trayCard.textContent).toContain('霓虹街景');
    expect(trayCard.textContent).toContain('引用提示词 · 整条');
    expect(screen.getByTestId('prompt-reference-preview').textContent).toContain('霓虹雨夜');

    // 纯引用提交(正文为空):发送钮可用。
    fireEvent.click(screen.getByTestId('composer-submit'));
    await waitFor(() => {
      expect(host.generationCreates).toHaveLength(1);
    });
    const created = host.generationCreates[0] as CreateGenerationInput;
    // 严格意图:除 promptId/scope/expectedVersion(/range) 外没有任何客户端文本字段。
    expect(created.prompt).toBe('');
    expect(created.promptReferenceSelections).toEqual([
      { promptId: 'p-1', scope: 'full', expectedVersion: 5 },
    ]);
    for (const selection of created.promptReferenceSelections ?? []) {
      expect(Object.keys(selection).sort()).toEqual(['expectedVersion', 'promptId', 'scope']);
    }

    // 时间线:不可变快照卡(整条徽标 + 冻结正文),无用户气泡,原文为空。
    await waitFor(() => {
      expect(screen.getByTestId('job-prompt-reference')).toBeTruthy();
    });
    const refCard = screen.getByTestId('job-prompt-reference');
    expect(refCard.getAttribute('data-scope')).toBe('full');
    expect(refCard.textContent).toContain('霓虹街景');
    expect(refCard.textContent).toContain('整条');
    expect(screen.getByTestId('job-prompt-reference-text').textContent).toContain('霓虹雨夜');
    expect(screen.queryByTestId('job-prompt-references')).toBeTruthy();

    // 草稿态首发建会话:中性标题(不泄漏引用正文)。
    const sessions = await host.workbench.listSessions({});
    expect(sessions.items[0]?.title).toBe('引用提示词创作');

    // 提交后清空:托盘消失,草稿按返回版本串行清空。
    await waitFor(() => {
      expect(screen.queryByTestId('workbench-context-tray')).toBeNull();
    });
    await waitFor(async () => {
      const session = await host.workbench.getSession('session-1');
      expect(session.draft.promptReferenceSelections).toEqual([]);
    });
  });

  it('引用选中内容:astral 选区按 UTF-16 生成意图,托盘预览按区间解析', async () => {
    const host = createMemoryHost({
      prompts: [makePrompt('p-astral', { title: '星野', content: '前😀后缀文字' })],
    });
    renderWorkbench(host);
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });
    await openReferencePanel();
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-row')).toBeTruthy();
    });
    await userEvent.click(screen.getByTestId('workbench-reference-expand'));

    // '😀' 占 2 个 UTF-16 code unit:[1,5) = '😀后缀'。
    const content = screen.getByTestId('workbench-reference-content');
    const textNode = content.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 5);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    await userEvent.click(screen.getByTestId('workbench-reference-selection'));
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-count').textContent).toBe('已引用 1/6');
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByTestId('workbench-context-tray')).toBeTruthy();
    });
    const trayCard = screen.getByTestId('prompt-reference-card');
    expect(trayCard.textContent).toContain('引用提示词 · 选中片段');
    expect(screen.getByTestId('prompt-reference-preview').textContent).toBe('😀后缀');
  });

  it('草稿意图回写(防抖串行)且切换装载后托盘复原(round-trip)', async () => {
    const host = createMemoryHost({
      prompts: [makePrompt('p-1', { title: '霓虹街景', content: '霓虹雨夜的城市街景' })],
    });
    // 预置会话:草稿内已有片段意图(跨端持久化的选择意图)。
    void host.workbench.createSession({
      title: '既有创作',
      draft: {
        ...EMPTY_DRAFT,
        promptReferenceSelections: [
          { promptId: 'p-1', scope: 'excerpt', expectedVersion: 1, range: { start: 0, end: 4 } },
        ],
      },
    });
    renderWorkbench(host);
    // 草稿装载 → 托盘按意图解析出卡片(预览 = 区间切片)。
    await waitFor(() => {
      expect(screen.getByTestId('workbench-context-tray')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByTestId('prompt-reference-preview').textContent).toBe('霓虹雨夜');
    });
    expect(screen.getByTestId('prompt-reference-card').textContent).toContain('霓虹街景');

    // 再引一条 → 草稿防抖回写携带两条意图。
    await openReferencePanel();
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-row')).toBeTruthy();
    });
    await userEvent.click(screen.getByTestId('workbench-reference-expand'));
    await userEvent.click(screen.getByTestId('workbench-reference-full'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getAllByTestId('prompt-reference-card')).toHaveLength(2);
    });
    await waitFor(
      () => {
        const last = host.draftWrites[host.draftWrites.length - 1];
        expect(last?.draft?.promptReferenceSelections).toHaveLength(2);
      },
      { timeout: 3_000 },
    );
  });

  it('上限 6 条与重复:屏幕层不静默,toast 口径明确', async () => {
    const six: PromptReferenceSelection[] = Array.from({ length: 6 }, (_, index) => ({
      promptId: `p-${index}`,
      scope: 'full',
      expectedVersion: 1,
    }));
    const host = createMemoryHost({
      prompts: [
        ...Array.from({ length: 6 }, (_, index) => makePrompt(`p-${index}`)),
        makePrompt('p-extra', { title: '第七条' }),
      ],
    });
    void host.workbench.createSession({
      title: '已满',
      draft: { ...EMPTY_DRAFT, promptReferenceSelections: six },
    });
    renderWorkbench(host);
    await waitFor(() => {
      expect(screen.getAllByTestId('prompt-reference-card')).toHaveLength(6);
    });

    // 第 7 条:上限 toast(该行标题为「第七条」)。
    await openReferencePanel();
    await waitFor(() => {
      expect(screen.getByText('第七条')).toBeTruthy();
    });
    const rows = screen.getAllByTestId('workbench-reference-row');
    const extraRow = rows.find((row) => row.textContent?.includes('第七条')) as HTMLElement;
    await userEvent.click(within(extraRow).getByTestId('workbench-reference-expand'));
    await userEvent.click(screen.getByTestId('workbench-reference-full'));
    expect(toast.error).toHaveBeenCalledWith('引用数量已满', {
      description: '最多同时引用 6 条提示词。',
    });
  });

  it('重复引用同一内容被拒绝', async () => {
    const intent: PromptReferenceSelection = { promptId: 'p-1', scope: 'full', expectedVersion: 1 };
    const host = createMemoryHost({ prompts: [makePrompt('p-1')] });
    void host.workbench.createSession({
      title: '重复',
      draft: { ...EMPTY_DRAFT, promptReferenceSelections: [intent] },
    });
    renderWorkbench(host);
    await waitFor(() => {
      expect(screen.getByTestId('workbench-context-tray')).toBeTruthy();
    });
    await openReferencePanel();
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-row')).toBeTruthy();
    });
    // 整条已引用时动作禁用(防呆);片段路径重复由判重 toast 拦截。
    await userEvent.click(screen.getByTestId('workbench-reference-expand'));
    expect((screen.getByTestId('workbench-reference-full') as HTMLButtonElement).disabled).toBe(
      true,
    );
    const content = screen.getByTestId('workbench-reference-content');
    const textNode = content.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    await userEvent.click(screen.getByTestId('workbench-reference-selection'));
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-count').textContent).toBe('已引用 2/6');
    });
    // 同区间再选一次 → 重复 toast,计数不变。
    const again = document.createRange();
    again.setStart(textNode, 0);
    again.setEnd(textNode, 3);
    selection?.removeAllRanges();
    selection?.addRange(again);
    await userEvent.click(screen.getByTestId('workbench-reference-selection'));
    expect(toast.error).toHaveBeenCalledWith('已经引用过这段内容');
    expect(screen.getByTestId('workbench-reference-count').textContent).toBe('已引用 2/6');
  });

  it('源已删除/已更新:托盘可见可移除,不伪造内容', async () => {
    const intents: PromptReferenceSelection[] = [
      { promptId: 'p-deleted', scope: 'full', expectedVersion: 1 },
      { promptId: 'p-stale', scope: 'full', expectedVersion: 1 },
    ];
    const host = createMemoryHost({
      prompts: [makePrompt('p-stale', { title: '雨后', version: 2 })],
    });
    void host.workbench.createSession({
      title: '漂移',
      draft: { ...EMPTY_DRAFT, promptReferenceSelections: intents },
    });
    renderWorkbench(host);
    await waitFor(() => {
      expect(screen.getAllByTestId('prompt-reference-card')).toHaveLength(2);
    });
    const cards = screen.getAllByTestId('prompt-reference-card');
    const unavailable = cards.find((card) => card.getAttribute('data-status') === 'unavailable');
    const stale = cards.find((card) => card.getAttribute('data-status') === 'stale');
    expect(unavailable?.textContent).toContain('提示词不可用');
    expect(stale?.textContent).toContain('源已更新');

    // 移除不可用引用。
    fireEvent.click(screen.getByLabelText('移除来源：提示词不可用'));
    await waitFor(() => {
      expect(screen.getAllByTestId('prompt-reference-card')).toHaveLength(1);
    });
  });

  it('编辑历史消息:回填原始用户文本并清空引用选择(不从快照伪造意图)', async () => {
    // 手工种子一条带引用的已完成回合(原文 ≠ 宿主合成稿);session-1 由下方 createSession 落建。
    const seed: GenerationJob = {
      id: 'job-seed',
      sessionId: 'session-1',
      parentRunId: null,
      promptId: null,
      userPrompt: 'raw user words',
      promptReferences: [
        {
          promptId: 'p-1',
          title: '提示词 p-1',
          text: '冻结引用正文',
          scope: 'full',
          sourceVersion: 1,
        },
      ],
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'succeeded',
      progress: 100,
      // 宿主合成稿:绝不能被当用户原文回填。
      request: {
        prompt: 'composed provider prompt with frozen refs',
        size: 'auto',
        quality: 'medium',
        count: 1,
        referenceImages: [],
      },
      providerModel: 'test-model',
      costPoints: null,
      assets: [],
      error: null,
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: nowIso(),
      deletedAt: null,
    };
    const host = createMemoryHost({ prompts: [makePrompt('p-1')], seedJobs: [seed] });
    void host.workbench.createSession({ title: '历史' });
    renderWorkbench(host);
    await waitFor(() => {
      expect(screen.getByTestId('composer-prompt')).toBeTruthy();
    });
    // 种子会话载入,job 时间线渲染。
    await waitFor(() => {
      expect(screen.getByTestId('job-job-seed')).toBeTruthy();
    });

    // 先引一条,验证编辑清空选择。
    await openReferencePanel();
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-row')).toBeTruthy();
    });
    await userEvent.click(screen.getByTestId('workbench-reference-expand'));
    await userEvent.click(screen.getByTestId('workbench-reference-full'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByTestId('workbench-context-tray')).toBeTruthy();
    });

    await userEvent.click(screen.getByTestId('job-edit-message'));
    const promptInput = screen.getByTestId('composer-prompt') as HTMLTextAreaElement;
    // 原文回填(不是合成稿),引用选择清空。
    expect(promptInput.value).toBe('raw user words');
    expect(screen.queryByTestId('workbench-context-tray')).toBeNull();
  });

  it('旧任务无 userPrompt:气泡/复制回落 request.prompt(legacy fallback)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const legacy: GenerationJob = {
      id: 'job-legacy',
      // 归属下方 createSession 落建的 session-1。
      sessionId: 'session-1',
      parentRunId: null,
      promptId: null,
      promptReferences: [],
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'succeeded',
      progress: 100,
      request: {
        prompt: 'legacy raw prompt',
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
      startedAt: null,
      finishedAt: nowIso(),
      deletedAt: null,
    };
    const host = createMemoryHost({ seedJobs: [legacy] });
    void host.workbench.createSession({ title: '旧会话' });
    renderWorkbench(host);
    await waitFor(() => {
      expect(screen.getByTestId('job-job-legacy')).toBeTruthy();
    });
    expect(screen.getByText('legacy raw prompt')).toBeTruthy();
    await userEvent.click(screen.getByTestId('job-copy-message'));
    expect(writeText).toHaveBeenCalledWith('legacy raw prompt');
    // 无引用 → 不渲染引用区。
    expect(screen.queryByTestId('job-prompt-references')).toBeNull();
  });

  it('纯引用回合:复制消息回落冻结引用正文(不取合成稿),资产 alt 参考感知', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const referenceOnly: GenerationJob = {
      id: 'job-ref-only',
      sessionId: 'session-1',
      parentRunId: null,
      promptId: null,
      userPrompt: '',
      promptReferences: [
        {
          promptId: 'p-1',
          title: '霓虹街景',
          text: '冻结正文甲',
          scope: 'full',
          sourceVersion: 2,
        },
        {
          promptId: 'p-2',
          title: '产品光效',
          text: '冻结正文乙',
          scope: 'excerpt',
          sourceVersion: 1,
        },
      ],
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'succeeded',
      progress: 100,
      request: {
        prompt: 'host composed provider prompt',
        size: 'auto',
        quality: 'auto',
        count: 1,
        referenceImages: [],
      },
      providerModel: 'test-model',
      costPoints: null,
      assets: [
        {
          id: 'asset-1',
          url: 'https://example.test/image.png',
          mimeType: 'image/png',
          width: 512,
          height: 512,
          byteSize: 1024,
          expiresAt: '2099-01-01T00:00:00+00:00',
        },
      ],
      error: null,
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: nowIso(),
      deletedAt: null,
    };
    const host = createMemoryHost({ seedJobs: [referenceOnly] });
    void host.workbench.createSession({ title: '引用创作' });
    renderWorkbench(host);
    await waitFor(() => {
      expect(screen.getByTestId('job-job-ref-only')).toBeTruthy();
    });

    // 无用户气泡;两张不可变引用卡,scope 徽标齐全。
    const cards = screen.getAllByTestId('job-prompt-reference');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.getAttribute('data-scope')).toBe('full');
    expect(cards[1]?.getAttribute('data-scope')).toBe('excerpt');
    expect(cards[1]?.textContent).toContain('选中片段');
    expect(screen.queryByText('host composed provider prompt')).toBeNull();

    // 复制消息 = 冻结引用正文合并;复制提示词同口径。
    await userEvent.click(screen.getByTestId('job-copy-message'));
    expect(writeText).toHaveBeenCalledWith('冻结正文甲\n\n冻结正文乙');
    await userEvent.click(screen.getByTestId('job-copy-prompt'));
    expect(writeText).toHaveBeenCalledWith('冻结正文甲\n\n冻结正文乙');

    // 资产 alt 用参考感知回落而非合成稿。
    const assetImage = screen.getByTestId('job-asset').querySelector('img');
    expect(assetImage?.getAttribute('alt')).toBe('引用提示词：霓虹街景、产品光效');

    // 快照可检视:点击展开全文。
    const toggle = screen.getAllByTestId('job-prompt-reference-toggle')[0] as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    // 重试 = 精确快照动作:新回合保留同一 userPrompt 与不可变引用。
    await userEvent.click(screen.getByTestId('job-retry'));
    await waitFor(async () => {
      const retryJob = [...(await host.generation.list({})).items].find(
        (job) => job.id !== 'job-ref-only',
      );
      expect(retryJob?.userPrompt).toBe('');
      expect(retryJob?.promptReferences).toEqual(referenceOnly.promptReferences);
    });
  });
});
