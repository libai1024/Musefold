import type { GenerationHistoryQuery, GenerationJob } from '@musefold/contracts';
import type { GenerationGateway, MusefoldGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { HistoryScreen } from '../HistoryScreen';
import { buildHistoryQuery, DEFAULT_HISTORY_FILTERS } from '../hooks';
import { threadJobs } from '../format';

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().replace(/Z$/, '+00:00');
}

function makeJob(partial: Partial<GenerationJob> & { id: string }): GenerationJob {
  return {
    sessionId: null,
    parentRunId: null,
    promptId: null,
    actorType: 'web',
    approvalStatus: 'not_required',
    status: 'succeeded',
    progress: 100,
    request: { prompt: `prompt ${partial.id}`, size: 'auto', quality: 'auto', count: 1 },
    providerModel: 'model-a',
    costPoints: null,
    assets: [],
    error: null,
    createdAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: nowIso(1000),
    deletedAt: null,
    ...partial,
  };
}

function createMemoryHistory(jobs: GenerationJob[]) {
  const store = new Map(jobs.map((job) => [job.id, job]));
  const calls: GenerationHistoryQuery[] = [];

  const generation: Pick<GenerationGateway, 'list' | 'cancel' | 'retry' | 'remove' | 'restore'> = {
    list: async (query) => {
      calls.push(query);
      let items = [...store.values()];
      items = query.deletedOnly
        ? items.filter((job) => job.deletedAt != null)
        : items.filter((job) => job.deletedAt == null);
      if (query.status) items = items.filter((job) => job.status === query.status);
      if (query.search) {
        const needle = query.search.toLowerCase();
        items = items.filter((job) => job.request.prompt.toLowerCase().includes(needle));
      }
      if (query.providerModel) {
        items = items.filter((job) => job.providerModel === query.providerModel);
      }
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { items, nextCursor: null };
    },
    cancel: async (id) => {
      const job = { ...store.get(id)!, status: 'cancelled' as const };
      store.set(id, job);
      return job;
    },
    retry: async (id) => {
      const source = store.get(id)!;
      const retry = makeJob({ id: `${id}-retry`, parentRunId: id, status: 'queued', progress: 0 });
      store.set(retry.id, retry);
      return retry;
    },
    remove: async (id) => {
      const job = { ...store.get(id)!, deletedAt: nowIso() };
      store.set(id, job);
      return job;
    },
    restore: async (id) => {
      const job = { ...store.get(id)!, deletedAt: null };
      store.set(id, job);
      return job;
    },
  };

  return { generation, calls, store };
}

function renderHistory(jobs: GenerationJob[], onOpenSession?: (id: string) => void) {
  const memory = createMemoryHistory(jobs);
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
  render(<HistoryScreen onOpenSession={onOpenSession} />, { wrapper: Providers });
  return memory;
}

describe('threadJobs', () => {
  it('把同页重试链挂到父行之后并缩进', () => {
    const parent = makeJob({ id: 'a', createdAt: nowIso(-3000) });
    const child = makeJob({ id: 'b', parentRunId: 'a', createdAt: nowIso(-1000) });
    const other = makeJob({ id: 'c', createdAt: nowIso(-2000) });
    const rows = threadJobs([child, other, parent]);
    expect(rows.map((row) => row.job.id)).toEqual(['c', 'a', 'b']);
    expect(rows[2]?.depth).toBe(1);
  });

  it('父行不在本页时子行平铺', () => {
    const orphan = makeJob({ id: 'x', parentRunId: 'missing' });
    const rows = threadJobs([orphan]);
    expect(rows).toEqual([{ job: orphan, depth: 0 }]);
  });
});

describe('buildHistoryQuery', () => {
  it('默认 30 天窗口且不带回收站标记', () => {
    const query = buildHistoryQuery(DEFAULT_HISTORY_FILTERS, '', false);
    expect(query.from).toBeTruthy();
    expect(query.deletedOnly).toBeUndefined();
    expect(query.search).toBeUndefined();
  });

  it('回收站视图带 deletedOnly', () => {
    const query = buildHistoryQuery(
      { ...DEFAULT_HISTORY_FILTERS, datePreset: 'all' },
      ' cat ',
      true,
    );
    expect(query).toMatchObject({ deletedOnly: true, search: 'cat' });
    expect(query.from).toBeUndefined();
  });
});

describe('HistoryScreen', () => {
  it('渲染列表行与状态徽标', async () => {
    renderHistory([
      makeJob({ id: 'j1' }),
      makeJob({
        id: 'j2',
        status: 'failed',
        error: { code: 'GENERATION_UPSTREAM_REJECTED', message: '上游拒绝' },
      }),
    ]);
    await waitFor(() => {
      expect(screen.getAllByTestId('history-row')).toHaveLength(2);
    });
    const statuses = screen
      .getAllByTestId('history-row')
      .map((row) => row.getAttribute('data-status'));
    expect(statuses).toContain('succeeded');
    expect(statuses).toContain('failed');
  });

  it('空态与筛选空态', async () => {
    renderHistory([makeJob({ id: 'j1' })]);
    await waitFor(() => {
      expect(screen.getByTestId('history-row')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('history-filter-search'), {
      target: { value: 'no-match-needle' },
    });
    await waitFor(
      () => {
        expect(screen.getByTestId('history-empty')).toBeTruthy();
      },
      { timeout: 3_000 },
    );
    expect(screen.getByText('没有匹配的记录')).toBeTruthy();
  });

  it('打开详情面板并复制提示词入口存在', async () => {
    renderHistory([makeJob({ id: 'j1', sessionId: 'session-9' })]);
    await waitFor(() => {
      expect(screen.getByTestId('history-row-open')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('history-row-open'));
    await waitFor(() => {
      expect(screen.getByTestId('history-inspector')).toBeTruthy();
    });
    expect(screen.getByTestId('history-inspector-prompt').textContent).toBe('prompt j1');
    expect(screen.getByTestId('history-inspector-copy-prompt')).toBeTruthy();
  });

  it('移入回收站后从列表消失,回收站可恢复', async () => {
    const memory = renderHistory([makeJob({ id: 'j1' })]);
    await waitFor(() => {
      expect(screen.getByTestId('history-row-remove')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('history-row-remove'));
    await waitFor(() => {
      expect(screen.queryAllByTestId('history-row')).toHaveLength(0);
    });
    expect(memory.store.get('j1')?.deletedAt).not.toBeNull();

    await userEvent.click(screen.getByTestId('history-tab-trash'));
    await waitFor(() => {
      expect(screen.getByTestId('history-row-restore')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('history-row-restore'));
    await waitFor(() => {
      expect(memory.store.get('j1')?.deletedAt).toBeNull();
    });
  });

  it('详情面板「查看会话」回调宿主', async () => {
    const opened: string[] = [];
    renderHistory([makeJob({ id: 'j1', sessionId: 'session-9' })], (id) => opened.push(id));
    await waitFor(() => {
      expect(screen.getByTestId('history-row-open')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('history-row-open'));
    await waitFor(() => {
      expect(screen.getByTestId('history-inspector-open-session')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('history-inspector-open-session'));
    expect(opened).toEqual(['session-9']);
  });
});
