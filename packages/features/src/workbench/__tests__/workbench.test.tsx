import type {
  CreateGenerationInput,
  GenerationJob,
  WorkbenchDraft,
  WorkbenchSession,
} from '@musefold/contracts';
import type { GenerationGateway, MusefoldGateway, WorkbenchGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { NewSessionAction, SessionListPanel } from '../SessionListPanel';
import { useActiveSession } from '../session-store';
import { WorkbenchScreen } from '../WorkbenchScreen';

const EMPTY_DRAFT: WorkbenchDraft = {
  prompt: '',
  negative: '',
  params: {},
  promptReferenceIds: [],
};

function nowIso(): string {
  return new Date().toISOString().replace(/Z$/, '+00:00');
}

/** 内存版 workbench + generation:提交即 queued,一次读取后翻成 succeeded。 */
function createMemoryWorkbench() {
  let seq = 0;
  const sessions = new Map<string, WorkbenchSession>();
  const jobs = new Map<string, GenerationJob>();

  function requireSession(id: string): WorkbenchSession {
    const session = sessions.get(id);
    if (!session) throw new Error('NOT_FOUND');
    return session;
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
        createdAt: nowIso(),
        updatedAt: nowIso(),
        archivedAt: null,
        deletedAt: null,
      };
      sessions.set(session.id, session);
      return session;
    },
    getSession: async (id) => requireSession(id),
    updateSession: async (id, patch) => {
      const session = requireSession(id);
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
        actorType: 'web',
        approvalStatus: 'not_required',
        status: 'queued',
        progress: 0,
        request: {
          prompt: input.prompt,
          size: input.size ?? 'auto',
          quality: input.quality ?? 'auto',
          count: 1,
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
        (job) => !query.sessionId || job.sessionId === query.sessionId,
      );
      // 读取即推进:queued → succeeded(模拟后台完成,驱动轮询终止)。
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
      return generation.create({
        prompt: source.request.prompt,
        sessionId: source.sessionId ?? undefined,
      });
    },
    remove: async (id) => generation.get(id),
    restore: async (id) => generation.get(id),
    listProviders: async () => [
      { id: 'p1', label: '测试连接', model: 'test-model', kind: 'local', available: true },
    ],
  };

  return { workbench, generation };
}

/** 组合渲染:壳侧栏会话区 + 工作台屏(与宿主同构),经共享 store 协作。 */
function renderWorkbench() {
  const memory = createMemoryWorkbench();
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
      <WorkbenchScreen />
    </>,
    { wrapper: Providers },
  );
  return memory;
}

describe('Workbench(壳会话区 + 屏)', () => {
  beforeEach(() => {
    useActiveSession.setState({ activeSessionId: null });
  });

  it('「新设计」建会话并进入空时间线', async () => {
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('session-create')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('session-create'));
    await waitFor(() => {
      expect(within(screen.getByTestId('session-panel')).getByText('未命名创作')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByTestId('timeline-empty')).toBeTruthy();
    });
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
    expect(screen.getByTestId('job-asset')).toBeTruthy();
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toBe('');
  });

  it('行内重命名会话', async () => {
    const memory = renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('session-create')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('session-create'));
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
    const memory = renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('session-create')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('session-create'));
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

  it('比例与设置弹层写入 Composer 值', async () => {
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('composer-ratio')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('composer-ratio'));
    await waitFor(() => {
      expect(screen.getByTestId('composer-ratio-16x9')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('composer-ratio-16x9'));
    await waitFor(() => {
      expect(screen.getByTestId('composer-ratio').textContent).toContain('16:9');
    });

    fireEvent.click(screen.getByTestId('composer-settings'));
    await waitFor(() => {
      expect(screen.getByTestId('composer-negative')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('composer-negative'), {
      target: { value: 'blurry, low quality' },
    });
    expect((screen.getByTestId('composer-negative') as HTMLTextAreaElement).value).toBe(
      'blurry, low quality',
    );
  });
});
