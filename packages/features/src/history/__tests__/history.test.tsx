import type {
  GenerationCleanupScope,
  GenerationHistoryQuery,
  GenerationJob,
  GenerationStorageUsage,
  NewPromptDocument,
  PromptDocument,
  SaveAssetInput,
} from '@musefold/contracts';
import type { GenerationGateway, MusefoldGateway } from '@musefold/platform';
import { DESKTOP_CAPABILITIES, PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenIntent } from '../../shell/screen-intent-store';
import { peekQuotaRecovery, resetQuotaRecovery } from '../spend-recovery-store';
import { HistoryScreen } from '../HistoryScreen';
import {
  canRetryGeneration,
  historyErrorPresentation,
  isSettingsGuidance,
  normalizeHistoryErrorCode,
} from '../error';
import {
  formatBytes,
  formatDurationMs,
  jobDurationMs,
  refinementLabel,
  refinementTitle,
  groupHistoryThreads,
  threadJobs,
} from '../format';
import { buildHistoryQuery, DEFAULT_HISTORY_FILTERS, historyDateBounds } from '../hooks';

// Radix Select / 深链滚动在 jsdom 缺 pointer capture 与 scrollIntoView 实现,补桩后才能驱动。
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().replace(/Z$/, '+00:00');
}

function makeJob(partial: Partial<GenerationJob> & { id: string }): GenerationJob {
  return {
    sessionId: null,
    parentRunId: null,
    promptId: null,
    promptReferences: [],
    actorType: 'web',
    approvalStatus: 'not_required',
    status: 'succeeded',
    progress: 100,
    request: {
      prompt: `prompt ${partial.id}`,
      size: 'auto',
      quality: 'auto',
      count: 1,
      referenceImages: [],
    },
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

function createMemoryHistory(jobs: GenerationJob[], pageSize?: number) {
  const store = new Map(jobs.map((job) => [job.id, job]));
  const calls: GenerationHistoryQuery[] = [];
  // 「保存图片」链路:记录入参供断言,固定返回 saved。
  const assetSaves: SaveAssetInput[] = [];
  // 批量清理 / 本机资产动作:记录入参供断言(05 §7)。
  const cleanupCalls: GenerationCleanupScope[] = [];
  const revealed: string[] = [];
  const copied: string[] = [];
  let storageUsage: GenerationStorageUsage = { bytes: 3 * 1024 * 1024, fileCount: 7 };

  const generation: Pick<
    GenerationGateway,
    | 'list'
    | 'cancel'
    | 'retry'
    | 'remove'
    | 'restore'
    | 'purge'
    | 'saveAsset'
    | 'cleanup'
    | 'getStorageUsage'
    | 'revealAsset'
    | 'copyAssetToClipboard'
  > = {
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
      if (query.from) items = items.filter((job) => job.createdAt >= (query.from as string));
      if (query.to) items = items.filter((job) => job.createdAt <= (query.to as string));
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (pageSize == null) return { items, nextCursor: null };
      // offset cursor 分页(与桌面桥同口径),用于哨兵自动加载用例。
      const offset = Number(query.cursor ?? 0);
      const page = items.slice(offset, offset + pageSize);
      const next = offset + pageSize;
      return { items: page, nextCursor: next < items.length ? String(next) : null };
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
    purge: async (id) => {
      const job = store.get(id);
      if (!job || job.deletedAt == null) throw new Error('VALIDATION_FAILED');
      store.delete(id);
    },
    saveAsset: async (input) => {
      assetSaves.push(input);
      return 'saved';
    },
    cleanup: async ({ scope }) => {
      cleanupCalls.push(scope);
      let affected = 0;
      for (const job of [...store.values()]) {
        if (scope === 'empty-trash') {
          if (job.deletedAt == null) continue;
          store.delete(job.id);
          affected += 1;
          continue;
        }
        const match =
          scope === 'failed-and-cancelled'
            ? job.status === 'failed' || job.status === 'cancelled'
            : job.createdAt < new Date(Date.now() - 30 * 86_400_000).toISOString();
        if (job.deletedAt != null || !match) continue;
        store.set(job.id, { ...job, deletedAt: nowIso() });
        affected += 1;
      }
      return { affected };
    },
    getStorageUsage: async () => storageUsage,
    revealAsset: async (assetId) => {
      revealed.push(assetId);
    },
    copyAssetToClipboard: async (assetId) => {
      copied.push(assetId);
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
    generation,
    prompts,
    promptCreates,
    assetSaves,
    calls,
    store,
    cleanupCalls,
    revealed,
    copied,
    setStorageUsage: (next: GenerationStorageUsage) => {
      storageUsage = next;
    },
  };
}

interface RenderHistoryOptions {
  onOpenSession?(id: string): void;
  onOpenSettings?(): void;
  /** 桌面宿主视角(canRevealLocalFile=true):磁盘占用与本机文件动作才渲染。 */
  desktop?: boolean;
  /** 让 fake 宿主分页(offset cursor),用于滚动哨兵用例。 */
  pageSize?: number;
}

function renderHistory(jobs: GenerationJob[], options: RenderHistoryOptions = {}) {
  const memory = createMemoryHistory(jobs, options.pageSize);
  const gateway = memory as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider
          runtime={{
            gateway,
            capabilities: options.desktop ? DESKTOP_CAPABILITIES : WEB_CAPABILITIES,
          }}
        >
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  render(
    <HistoryScreen onOpenSession={options.onOpenSession} onOpenSettings={options.onOpenSettings} />,
    { wrapper: Providers },
  );
  return memory;
}

describe('threadJobs', () => {
  it('把同页重试链挂到父行之后并缩进,线程按最新活动浮到顶部', () => {
    const parent = makeJob({ id: 'a', createdAt: nowIso(-3000) });
    const child = makeJob({ id: 'b', parentRunId: 'a', createdAt: nowIso(-1000) });
    const other = makeJob({ id: 'c', createdAt: nowIso(-2000) });
    // 入参按 createdAt 倒序(宿主口径):b 最新 → 其线程(a,b)整体先出。
    const rows = threadJobs([child, other, parent]);
    expect(rows.map((row) => row.job.id)).toEqual(['a', 'b', 'c']);
    expect(rows[1]?.depth).toBe(1);
    expect(rows[1]?.refinementIndex).toBe(1);
    // 根行的「+n 微调」计数 = threadSize - 1。
    expect(rows[0]?.threadSize).toBe(2);
    expect(rows[0]?.childCount).toBe(1);
    expect(rows[2]?.threadSize).toBe(1);
  });

  it('父行不在本页时子行降级为孤儿根并标注', () => {
    const orphan = makeJob({ id: 'x', parentRunId: 'missing' });
    const rows = threadJobs([orphan]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      job: orphan,
      depth: 0,
      orphan: true,
      threadRootId: 'x',
      threadSize: 1,
    });
    expect(rows.map(refinementLabel)).toEqual(['微调']);
    expect(rows.map(refinementTitle)).toEqual(['微调(来源记录已删除)']);
  });

  it('父子成环时任何记录只输出一次', () => {
    const a = makeJob({ id: 'a', parentRunId: 'b', createdAt: nowIso(-2000) });
    const b = makeJob({ id: 'b', parentRunId: 'a', createdAt: nowIso(-1000) });
    const rows = threadJobs([b, a]);
    expect(rows.map((row) => row.job.id).sort()).toEqual(['a', 'b']);
  });

  it('groupHistoryThreads 按线程根归组,子回合留在父组', () => {
    const parent = makeJob({ id: 'a', createdAt: nowIso(-3000) });
    const child = makeJob({ id: 'b', parentRunId: 'a', createdAt: nowIso(-1000) });
    const other = makeJob({ id: 'c', createdAt: nowIso(-2000) });
    const groups = groupHistoryThreads(threadJobs([child, other, parent]));
    expect(groups).toHaveLength(2);
    expect(groups[0]?.map((row) => row.job.id)).toEqual(['a', 'b']);
    expect(groups[1]?.map((row) => row.job.id)).toEqual(['c']);
  });
});

describe('formatDurationMs / jobDurationMs', () => {
  it('亚秒给毫秒,其余一位小数的秒;负值与缺省不伪造 0', () => {
    expect(formatDurationMs(820)).toBe('820ms');
    expect(formatDurationMs(1_500)).toBe('1.5s');
    expect(formatDurationMs(62_300)).toBe('62.3s');
    expect(formatDurationMs(null)).toBeNull();
    expect(formatDurationMs(-5)).toBeNull();
  });

  it('宿主上报的 durationMs 优先于时间戳差值', () => {
    const job = makeJob({
      id: 'd',
      durationMs: 4_200,
      startedAt: nowIso(0),
      finishedAt: nowIso(1_000),
    });
    expect(jobDurationMs(job)).toBe(4_200);
    expect(jobDurationMs(makeJob({ id: 'e', startedAt: null, finishedAt: null }))).toBeNull();
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

  it('自定义区间取本地日首尾(含首含尾),只填一头也生效', () => {
    const bounds = historyDateBounds({
      ...DEFAULT_HISTORY_FILTERS,
      datePreset: 'custom',
      customFrom: '2026-03-02',
      customTo: '2026-03-04',
    });
    expect(new Date(bounds.from as string).getHours()).toBe(0);
    expect(new Date(bounds.to as string).getHours()).toBe(23);
    expect(new Date(bounds.to as string).getMinutes()).toBe(59);
    // 起始日 00:00 本地 → 结束日 23:59:59.999 本地,跨度含两端共 3 天。
    expect(
      Math.round(
        (Date.parse(bounds.to as string) - Date.parse(bounds.from as string)) / 86_400_000,
      ),
    ).toBe(3);

    const openEnded = historyDateBounds({
      ...DEFAULT_HISTORY_FILTERS,
      datePreset: 'custom',
      customFrom: '2026-03-02',
      customTo: null,
    });
    expect(openEnded.from).toBeTruthy();
    expect(openEnded.to).toBeUndefined();
  });

  it('自定义区间未填日期时不带任何时间条件(等价全部时间)', () => {
    const query = buildHistoryQuery(
      { ...DEFAULT_HISTORY_FILTERS, datePreset: 'custom' },
      '',
      false,
    );
    expect(query.from).toBeUndefined();
    expect(query.to).toBeUndefined();
  });
});

describe('historyErrorPresentation', () => {
  it('guides an unverified account connection to settings without offering another retry or redemption', () => {
    const error = { code: 'ACCOUNT_IDENTITY_UNVERIFIED' as const, message: '旧账号连接需要核对' };
    expect(historyErrorPresentation(error)).toMatchObject({
      actionKind: 'setup_provider',
      canRetry: false,
    });
    expect(canRetryGeneration(makeJob({ id: 'unbound', status: 'failed', error }))).toBe(false);
  });
  it('契约错误码给标题 + 建议动作,并决定重试可用性', () => {
    const auth = historyErrorPresentation({ code: 'AUTH_CREDENTIALS_INVALID', message: 'bad key' });
    expect(auth).toMatchObject({ action: '检查密钥', canRetry: false });
    expect(auth?.title).toBe('API Key 无效或已失效');

    const limited = historyErrorPresentation({ code: 'RATE_LIMITED', message: '429' });
    expect(limited).toMatchObject({ action: '稍后重试', canRetry: true });

    const quota = historyErrorPresentation({
      code: 'ACCOUNT_QUOTA_INSUFFICIENT',
      message: 'no balance',
    });
    expect(quota).toMatchObject({ action: '去兑换', actionKind: 'top_up', canRetry: false });
    expect(isSettingsGuidance('top_up')).toBe(true);
    expect(isSettingsGuidance('retry')).toBe(false);

    // 已计费但结果未知:绝不给「重试」以免二次扣费。
    expect(
      historyErrorPresentation({ code: 'GENERATION_UPSTREAM_UNKNOWN', message: 'x' }),
    ).toMatchObject({ action: null, canRetry: false });
  });

  it('旧宿主自由错误码经别名表归一,归一不到用原始 message 当标题', () => {
    expect(normalizeHistoryErrorCode('auth')).toBe('AUTH_CREDENTIALS_INVALID');
    expect(normalizeHistoryErrorCode('ACCOUNT/AUTH')).toBe('AUTH_CREDENTIALS_INVALID');
    expect(normalizeHistoryErrorCode('INSUFFICIENT_BALANCE')).toBe('ACCOUNT_QUOTA_INSUFFICIENT');
    expect(normalizeHistoryErrorCode('DOUBAO_DAILY_LIMIT')).toBe('RATE_LIMITED');
    expect(normalizeHistoryErrorCode('who-knows')).toBe('UNKNOWN');
    // 旧宿主/上游可能落下不在契约枚举里的自由码,运行时仍要归一;类型上刻意越过枚举。
    const legacyError = { code: 'who-knows', message: '上游炸了' } as unknown as NonNullable<
      GenerationJob['error']
    >;
    expect(historyErrorPresentation(legacyError)?.title).toBe('上游炸了');
    expect(historyErrorPresentation(null)).toBeNull();
  });

  it('账号云已结失败可重试，purge与未知费用不可，失败文案不替代账本状态', () => {
    const source = makeJob({
      id: 'managed-failed',
      status: 'failed',
      error: { code: 'INTERNAL_ERROR', message: '结束' },
      recovery: {
        requestId: 'r',
        remoteStatus: 'failed',
        costKnown: true,
        result: 'not_ready',
        message: '已核对',
      },
    });
    if (!source.recovery) throw new Error('Missing recovery');
    expect(canRetryGeneration(source)).toBe(true);
    expect(
      canRetryGeneration({ ...source, recovery: { ...source.recovery, costKnown: false } }),
    ).toBe(false);
    expect(
      canRetryGeneration({ ...source, recovery: { ...source.recovery, result: 'purged' } }),
    ).toBe(false);
  });

  it('重试可用性:成功/进行中不可重试,已取消可重试', () => {
    expect(canRetryGeneration(makeJob({ id: 'ok', status: 'succeeded' }))).toBe(false);
    expect(canRetryGeneration(makeJob({ id: 'run', status: 'running' }))).toBe(false);
    expect(canRetryGeneration(makeJob({ id: 'cancel', status: 'cancelled' }))).toBe(true);
    expect(
      canRetryGeneration(
        makeJob({
          id: 'nokey',
          status: 'failed',
          error: { code: 'AUTH_CREDENTIALS_INVALID', message: 'x' },
        }),
      ),
    ).toBe(false);
    expect(
      canRetryGeneration(
        makeJob({ id: 'rate', status: 'failed', error: { code: 'RATE_LIMITED', message: 'x' } }),
      ),
    ).toBe(true);
  });
});

describe('formatBytes', () => {
  it('按二进制单位换算,负值与非法值给 0 B', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2 * 1024)).toBe('2.00 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.50 MB');
    expect(formatBytes(12 * 1024 * 1024 * 1024)).toBe('12.0 GB');
    expect(formatBytes(-1)).toBe('0 B');
  });
});

describe('HistoryScreen', () => {
  // 意图是全局 zustand:上个用例没消费干净不能污染下一个。
  beforeEach(() => {
    useScreenIntent.setState({ intent: null });
    resetQuotaRecovery();
  });

  it('列表与详情共享进行中重试，重复点击仅提交一次且失败后恢复可用', async () => {
    const source = makeJob({ id: 'retry-pending', status: 'cancelled' });
    const memory = renderHistory([source]);
    let reject!: (error: Error) => void;
    const retry = vi.spyOn(memory.generation, 'retry').mockImplementation(
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        }),
    );
    await userEvent.click(await screen.findByTestId('history-row-open'));
    const row = screen.getByTestId('history-row-retry');
    const detail = await screen.findByTestId('history-inspector-retry');
    fireEvent.click(row);
    fireEvent.click(detail);
    fireEvent.click(row);
    await waitFor(() => {
      expect(retry).toHaveBeenCalledTimes(1);
      expect(row.hasAttribute('disabled')).toBe(true);
      expect(detail.hasAttribute('disabled')).toBe(true);
      expect(detail.getAttribute('aria-label')).toBe('正在提交重试');
    });
    await act(async () => reject(new Error('synthetic retry refused')));
    await waitFor(() => {
      expect(row.hasAttribute('disabled')).toBe(false);
      expect(detail.hasAttribute('disabled')).toBe(false);
    });
  });

  it.each(['failed', 'cancelled'] as const)(
    '账号云%s按费用状态提供重试和原任务核对',
    async (status) => {
      const memory = renderHistory([
        makeJob({
          id: 'managed-unknown',
          status,
          recovery: {
            requestId: 'request-unknown',
            remoteStatus: status,
            costKnown: false,
            result: 'not_ready',
            message: '原费用未知',
          },
        }),
      ]);
      const retry = vi.spyOn(memory.generation, 'retry');
      await userEvent.click(await screen.findByTestId('history-row-open'));
      expect(screen.queryByTestId('history-row-retry')).toBeNull();
      expect(screen.queryByTestId('history-inspector-retry')).toBeNull();
      expect(screen.getByTestId('generation-recovery-notice').textContent).toContain(
        '费用尚未核对完成',
      );
      expect(screen.getByRole('button', { name: '核对原任务' })).toBeTruthy();
      expect(retry).not.toHaveBeenCalled();
    },
  );

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

  it('列表行显示已知成本,未知成本不伪造为零', async () => {
    renderHistory([
      makeJob({ id: 'priced', costPoints: 12 }),
      makeJob({ id: 'unknown', costPoints: null }),
    ]);
    await waitFor(() => expect(screen.getAllByTestId('history-row')).toHaveLength(2));

    const rows = screen.getAllByTestId('history-row');
    const pricedRow = rows.find((row) => row.textContent?.includes('prompt priced'));
    const unknownRow = rows.find((row) => row.textContent?.includes('prompt unknown'));
    expect(pricedRow?.textContent).toContain('12 积分');
    expect(unknownRow?.textContent).not.toContain('积分');
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

  it('回收站行永久删除:确认对话框后记录彻底消失', async () => {
    const memory = renderHistory([makeJob({ id: 'j1', deletedAt: nowIso() })]);
    await userEvent.click(screen.getByTestId('history-tab-trash'));
    await waitFor(() => {
      expect(screen.getByTestId('history-row-purge')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('history-row-purge'));
    // 破坏性动作必须有确认对话框(V25-UI-SPEC §8-I3)。
    await waitFor(() => {
      expect(screen.getByTestId('history-purge-confirm')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('history-purge-confirm'));

    await waitFor(() => {
      expect(screen.queryAllByTestId('history-row')).toHaveLength(0);
    });
    expect(memory.store.has('j1')).toBe(false);
  });

  it('检视「存为提示词」经 Dialog 确认建条目(03/05 §7 共用链路)', async () => {
    const memory = renderHistory([makeJob({ id: 'j1', providerModel: 'model-x' })]);
    await waitFor(() => {
      expect(screen.getByTestId('history-row-open')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('history-row-open'));
    await waitFor(() => {
      expect(screen.getByTestId('history-inspector-save-prompt')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('history-inspector-save-prompt'));
    await waitFor(() => {
      expect(screen.getByTestId('save-prompt-dialog')).toBeTruthy();
    });
    expect(screen.getByTestId('save-prompt-preview').textContent).toBe('prompt j1');

    fireEvent.change(screen.getByTestId('save-prompt-title'), {
      target: { value: '我的灯塔提示词' },
    });
    fireEvent.click(screen.getByTestId('save-prompt-confirm'));

    await waitFor(() => {
      expect(memory.promptCreates.length).toBe(1);
    });
    expect(memory.promptCreates[0]).toMatchObject({
      title: '我的灯塔提示词',
      content: 'prompt j1',
      source: 'generation',
      modelId: 'model-x',
    });
    await waitFor(() => {
      expect(screen.queryByTestId('save-prompt-dialog')).toBeNull();
    });
  });

  it('检视「保存图片」:走 gateway.saveAsset,文件名按资产 id + mime 派生(05 §3)', async () => {
    const memory = renderHistory([
      makeJob({
        id: 'j1',
        assets: [
          {
            id: 'asset-lighthouse',
            url: 'https://cdn.test/lighthouse.webp',
            mimeType: 'image/webp',
            width: 512,
            height: 512,
            byteSize: 2048,
            expiresAt: '2099-01-01T00:00:00+00:00',
          },
        ],
      }),
    ]);
    await waitFor(() => {
      expect(screen.getByTestId('history-row-open')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('history-row-open'));
    await waitFor(() => {
      expect(screen.getByTestId('history-inspector-save-asset')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('history-inspector-save-asset'));

    await waitFor(() => {
      expect(memory.assetSaves.length).toBe(1);
    });
    expect(memory.assetSaves[0]).toEqual({
      url: 'https://cdn.test/lighthouse.webp',
      name: 'musefold-asset-li.webp',
    });
  });

  it('Lightbox:缩略点击放大,按钮/方向键在成功集合内翻图,选中行跟随,可保存图片(05 §7)', async () => {
    const makeAsset = (id: string, url: string) => ({
      id,
      url,
      mimeType: 'image/png' as const,
      width: 512,
      height: 512,
      byteSize: 1024,
      expiresAt: '2099-01-01T00:00:00+00:00',
    });
    const memory = renderHistory([
      makeJob({
        id: 'j1',
        createdAt: nowIso(-1000),
        assets: [makeAsset('asset-a1', 'https://cdn.test/1.png')],
      }),
      makeJob({
        id: 'j2',
        createdAt: nowIso(-2000),
        assets: [makeAsset('asset-a2', 'https://cdn.test/2.png')],
      }),
      makeJob({ id: 'j3', status: 'failed', createdAt: nowIso(-3000) }),
    ]);
    await waitFor(() => {
      expect(screen.getAllByTestId('history-thumb').length).toBe(3);
    });

    // 失败行缩略仍是「查看详情」,不入 Lightbox 集合。
    expect(screen.getAllByTestId('history-thumb')[2]?.getAttribute('aria-label')).toBe('查看详情');

    fireEvent.click(screen.getAllByTestId('history-thumb')[0]!);
    await waitFor(() => {
      expect(screen.getByTestId('history-lightbox')).toBeTruthy();
    });
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('1 / 2');
    expect(screen.queryByTestId('lightbox-prev')).toBeNull();

    // 按钮翻到下一张:计数推进,选中行跟随(检视显示 j2)。
    fireEvent.click(screen.getByTestId('lightbox-next'));
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('2 / 2');
    expect(screen.queryByTestId('lightbox-next')).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('history-inspector-prompt').textContent).toBe('prompt j2');
    });

    // 方向键翻回上一张。
    fireEvent.keyDown(screen.getByTestId('history-lightbox'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('1 / 2');

    // Lightbox 内保存图片走同一条 saveAsset 链路。
    fireEvent.click(screen.getByTestId('lightbox-save-asset'));
    await waitFor(() => {
      expect(memory.assetSaves.length).toBe(1);
    });
    expect(memory.assetSaves[0]).toEqual({
      url: 'https://cdn.test/1.png',
      name: 'musefold-asset-a1.png',
    });

    // Esc 关闭(Radix 原生,焦点归还由 Dialog 承接)。
    fireEvent.keyDown(screen.getByTestId('history-lightbox'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('history-lightbox')).toBeNull();
    });
  });

  it('详情面板「查看会话」回调宿主', async () => {
    const opened: string[] = [];
    renderHistory([makeJob({ id: 'j1', sessionId: 'session-9' })], {
      onOpenSession: (id) => opened.push(id),
    });
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

  it('成功行显示「x 积分 · ys」;检视参数区补齐尺寸/比例/质量/种子/成本/用时', async () => {
    renderHistory([
      makeJob({
        id: 'meta',
        costPoints: 2,
        durationMs: 1_500,
        seed: 987_654,
        request: {
          prompt: 'prompt meta',
          size: '1024x1536',
          quality: 'high',
          aspectRatio: '2:3',
          count: 1,
          referenceImages: [],
        },
      }),
    ]);
    await waitFor(() => expect(screen.getByTestId('history-row')).toBeTruthy());
    // 元信息项以「·」相隔(承旧 mf-history-meta-item 分隔点)。
    const rowText = screen.getByTestId('history-row').textContent ?? '';
    expect(rowText).toContain('2 积分');
    expect(rowText).toContain('1.5s');
    expect(rowText).toContain('·2 积分·1.5s');

    fireEvent.click(screen.getByTestId('history-row-open'));
    await waitFor(() => expect(screen.getByTestId('history-inspector-params')).toBeTruthy());
    const params = screen.getByTestId('history-inspector-params').textContent ?? '';
    for (const fragment of [
      '模型',
      '尺寸',
      '1024x1536',
      '比例',
      '2:3',
      '质量',
      'high',
      '种子',
      '987654',
      '成本',
      '2 积分',
      '用时',
      '1.5s',
      '创建时间',
    ]) {
      expect(params).toContain(fragment);
    }
  });

  it('失败行检视显示错误标题 + 建议动作;不可重试的错误码不给重试入口', async () => {
    renderHistory([
      makeJob({
        id: 'bad-key',
        status: 'failed',
        error: { code: 'AUTH_CREDENTIALS_INVALID', message: 'invalid api key' },
      }),
    ]);
    await waitFor(() => expect(screen.getByTestId('history-row')).toBeTruthy());
    // 错误码不可重试 → 行与检视都不给重试。
    expect(screen.queryByTestId('history-row-retry')).toBeNull();

    fireEvent.click(screen.getByTestId('history-row-open'));
    await waitFor(() => expect(screen.getByTestId('history-inspector-error')).toBeTruthy());
    expect(screen.getByTestId('history-inspector-error').textContent).toContain(
      'API Key 无效或已失效',
    );
    const action = screen.getByTestId('history-detail-error-action');
    expect(action.tagName).toBe('BUTTON');
    expect(action.textContent).toContain('检查密钥');
    expect(screen.queryByTestId('history-inspector-retry')).toBeNull();
  });

  it('检查密钥按钮写入连接分区意图并调用 onOpenSettings', async () => {
    const onOpenSettings = vi.fn();
    renderHistory(
      [
        makeJob({
          id: 'bad-key-cta',
          status: 'failed',
          error: { code: 'AUTH_CREDENTIALS_INVALID', message: 'invalid api key' },
        }),
      ],
      { onOpenSettings },
    );
    await waitFor(() => expect(screen.getByTestId('history-row')).toBeTruthy());
    fireEvent.click(screen.getByTestId('history-row-open'));
    await userEvent.click(await screen.findByTestId('history-detail-error-action'));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(useScreenIntent.getState().intent).toEqual({
      kind: 'settings-section',
      section: 'connections',
    });
  });

  it('去兑换按钮写入账号分区意图并记下待重试 job', async () => {
    const onOpenSettings = vi.fn();
    renderHistory(
      [
        makeJob({
          id: 'quota-job',
          status: 'failed',
          error: { code: 'ACCOUNT_QUOTA_INSUFFICIENT', message: 'no balance' },
        }),
      ],
      { onOpenSettings },
    );
    await waitFor(() => expect(screen.getByTestId('history-row')).toBeTruthy());
    fireEvent.click(screen.getByTestId('history-row-open'));
    await userEvent.click(await screen.findByTestId('history-detail-error-action'));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(useScreenIntent.getState().intent).toEqual({
      kind: 'settings-section',
      section: 'account',
    });
    expect(peekQuotaRecovery()).toEqual({ kind: 'retry-job', jobId: 'quota-job' });
  });

  it('可重试的错误码给重试入口,成功行不给(宿主 retry 只受理 failed/cancelled)', async () => {
    renderHistory([
      makeJob({
        id: 'rate',
        status: 'failed',
        error: { code: 'RATE_LIMITED', message: 'too many' },
      }),
    ]);
    await waitFor(() => expect(screen.getByTestId('history-row-retry')).toBeTruthy());
    fireEvent.click(screen.getByTestId('history-row-open'));
    await waitFor(() => expect(screen.getByTestId('history-inspector-retry')).toBeTruthy());
  });

  it('自定义时间区间:选「自定义」出两个日期输入并进入查询(含首含尾)', async () => {
    const memory = renderHistory([makeJob({ id: 'j1' })]);
    await waitFor(() => expect(screen.getByTestId('history-row')).toBeTruthy());
    expect(screen.queryByTestId('history-filter-custom-range')).toBeNull();

    await userEvent.click(screen.getByTestId('history-filter-date'));
    await userEvent.click(screen.getByRole('option', { name: '自定义' }));
    await waitFor(() => expect(screen.getByTestId('history-filter-custom-range')).toBeTruthy());

    fireEvent.change(screen.getByTestId('history-filter-custom-from'), {
      target: { value: '2026-03-02' },
    });
    fireEvent.change(screen.getByTestId('history-filter-custom-to'), {
      target: { value: '2026-03-04' },
    });

    // 含首含尾:起始取当日 00:00、结束取当日 23:59:59(本地时区)。
    await waitFor(() => {
      const last = memory.calls.at(-1);
      expect(new Date(String(last?.from)).getHours()).toBe(0);
      expect(new Date(String(last?.to)).getHours()).toBe(23);
    });
  });

  it('回收站清理菜单:三项各带确认,「清空回收站」永久删除并报条数', async () => {
    const memory = renderHistory([
      makeJob({ id: 'trashed-1', deletedAt: nowIso() }),
      makeJob({ id: 'trashed-2', deletedAt: nowIso() }),
      makeJob({ id: 'alive' }),
    ]);
    await userEvent.click(screen.getByTestId('history-tab-trash'));
    await waitFor(() => expect(screen.getAllByTestId('history-row')).toHaveLength(2));

    await userEvent.click(screen.getByTestId('history-cleanup-menu'));
    await waitFor(() => expect(screen.getByTestId('history-cleanup-empty-trash')).toBeTruthy());
    await userEvent.click(screen.getByTestId('history-cleanup-empty-trash'));

    // 破坏性动作必须有确认对话框(V25-UI-SPEC §8-I3)。
    await waitFor(() => expect(screen.getByTestId('history-cleanup-confirm')).toBeTruthy());
    expect(screen.getByText('清空回收站?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('history-cleanup-confirm'));

    await waitFor(() => expect(memory.cleanupCalls).toEqual(['empty-trash']));
    await waitFor(() => expect(screen.queryAllByTestId('history-row')).toHaveLength(0));
    expect(memory.store.has('trashed-1')).toBe(false);
    expect(memory.store.has('alive')).toBe(true);
  });

  it('清理「失败与已取消」软删入回收站,记录仍可恢复', async () => {
    const memory = renderHistory([
      makeJob({ id: 'failed-1', status: 'failed' }),
      makeJob({ id: 'ok-1', status: 'succeeded' }),
    ]);
    await userEvent.click(screen.getByTestId('history-tab-trash'));
    await userEvent.click(screen.getByTestId('history-cleanup-menu'));
    await waitFor(() =>
      expect(screen.getByTestId('history-cleanup-failed-and-cancelled')).toBeTruthy(),
    );
    await userEvent.click(screen.getByTestId('history-cleanup-failed-and-cancelled'));
    await waitFor(() => expect(screen.getByTestId('history-cleanup-confirm')).toBeTruthy());
    // 软删文案必须说清图片文件仍保留。
    expect(screen.getByText(/图片文件仍保留/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('history-cleanup-confirm'));

    await waitFor(() => expect(memory.store.get('failed-1')?.deletedAt).not.toBeNull());
    expect(memory.store.get('ok-1')?.deletedAt).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId('history-row')).toHaveLength(1));
  });

  it('磁盘占用只在桌面宿主渲染,刷新钮重取', async () => {
    const memory = renderHistory([makeJob({ id: 'j1', deletedAt: nowIso() })], { desktop: true });
    await userEvent.click(screen.getByTestId('history-tab-trash'));
    await waitFor(() =>
      expect(screen.getByTestId('history-disk-usage').textContent).toContain('3.00 MB'),
    );
    expect(screen.getByTestId('history-disk-usage').textContent).toContain('7 个文件');

    memory.setStorageUsage({ bytes: 1024, fileCount: 1 });
    fireEvent.click(screen.getByTestId('history-disk-usage-refresh'));
    await waitFor(() =>
      expect(screen.getByTestId('history-disk-usage').textContent).toContain('1.00 KB'),
    );
  });

  it('Web 宿主不渲染磁盘占用与本机文件动作', async () => {
    renderHistory(
      [
        makeJob({
          id: 'j1',
          deletedAt: null,
          assets: [
            {
              id: 'asset-a',
              url: 'https://cdn.test/a.png',
              mimeType: 'image/png',
              width: 8,
              height: 8,
              byteSize: 8,
              expiresAt: '2099-01-01T00:00:00+00:00',
            },
          ],
        }),
      ],
      { desktop: false },
    );
    await waitFor(() => expect(screen.getByTestId('history-row-open')).toBeTruthy());

    // 回收站工具行仍有清理菜单,但没有磁盘占用 readout(Web 资产在云端对象存储)。
    await userEvent.click(screen.getByTestId('history-tab-trash'));
    await waitFor(() => expect(screen.getByTestId('history-cleanup-menu')).toBeTruthy());
    expect(screen.queryByTestId('history-disk-usage')).toBeNull();

    await userEvent.click(screen.getByTestId('history-tab-all'));
    await waitFor(() => expect(screen.getByTestId('history-row-open')).toBeTruthy());
    fireEvent.click(screen.getByTestId('history-row-open'));
    await waitFor(() => expect(screen.getByTestId('history-inspector')).toBeTruthy());
    expect(screen.queryByTestId('history-inspector-reveal-asset')).toBeNull();
    expect(screen.queryByTestId('history-inspector-copy-asset')).toBeNull();
  });

  it('桌面检视「在文件夹中显示」/「复制图片」只送资产 id', async () => {
    const memory = renderHistory(
      [
        makeJob({
          id: 'j1',
          assets: [
            {
              id: 'asset-managed',
              url: 'media://images/a.png',
              mimeType: 'image/png',
              width: 8,
              height: 8,
              byteSize: 8,
              expiresAt: '2099-01-01T00:00:00+00:00',
            },
          ],
        }),
      ],
      { desktop: true },
    );
    await waitFor(() => expect(screen.getByTestId('history-row-open')).toBeTruthy());
    fireEvent.click(screen.getByTestId('history-row-open'));
    await waitFor(() => expect(screen.getByTestId('history-inspector-reveal-asset')).toBeTruthy());

    fireEvent.click(screen.getByTestId('history-inspector-reveal-asset'));
    await waitFor(() => expect(memory.revealed).toEqual(['asset-managed']));
    fireEvent.click(screen.getByTestId('history-inspector-copy-asset'));
    await waitFor(() => expect(memory.copied).toEqual(['asset-managed']));
  });

  it('谱系区:「来自」与「派生 n 条」可点跳,孤儿链路给降级文案', async () => {
    renderHistory([
      makeJob({ id: 'root', createdAt: nowIso(-3000) }),
      makeJob({ id: 'child', parentRunId: 'root', createdAt: nowIso(-2000) }),
      makeJob({ id: 'lost', parentRunId: 'gone', createdAt: nowIso(-1000) }),
    ]);
    await waitFor(() => expect(screen.getAllByTestId('history-row')).toHaveLength(3));
    // 根行显示「+n 微调」计数。
    expect(screen.getByTestId('history-thread-count').textContent).toBe('+1 微调');

    // 选中根:谱系列出派生 1 条,点击跳到子记录。
    const openRow = (id: string) =>
      fireEvent.click(
        document.querySelector(
          `[data-job-row="${id}"] [data-testid="history-row-open"]`,
        ) as HTMLElement,
      );
    openRow('root');
    await waitFor(() => expect(screen.getByTestId('history-lineage')).toBeTruthy());
    expect(screen.getByTestId('history-lineage').textContent).toContain('派生 1 条');
    fireEvent.click(screen.getByTestId('history-lineage-node'));
    await waitFor(() =>
      expect(screen.getByTestId('history-inspector-prompt').textContent).toBe('prompt child'),
    );
    // 子记录的谱系里有「来自」可回跳。
    expect(screen.getByTestId('history-lineage').textContent).toContain('来自');

    // 孤儿微调:行标注 + 检视降级文案。
    const orphanRow = screen
      .getAllByTestId('history-row')
      .find((row) => row.getAttribute('data-orphan') === 'true');
    expect(orphanRow?.textContent).toContain('微调');
    openRow('lost');
    await waitFor(() =>
      expect(screen.getByTestId('history-lineage-missing-parent').textContent).toContain(
        '来源记录已删除',
      ),
    );
  });

  it('滚动哨兵:进视口自动取下一页(无 IntersectionObserver 时退化到按钮)', async () => {
    const observed: Element[] = [];
    // 用容器对象承接回调:类的构造器里赋值不参与 TS 控制流收窄,裸 let 会被推成 never。
    const sentinel: { trigger: (() => void) | null } = { trigger: null };
    class FakeObserver {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        sentinel.trigger = () => callback([{ isIntersecting: true }]);
      }
      observe(node: Element) {
        observed.push(node);
      }
      disconnect() {
        sentinel.trigger = null;
      }
    }
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
    try {
      const memory = renderHistory([makeJob({ id: 'p1' }), makeJob({ id: 'p2' })], {
        pageSize: 1,
      });
      await waitFor(() => expect(screen.getByTestId('history-load-sentinel')).toBeTruthy());
      expect(observed).toHaveLength(1);
      expect(memory.calls).toHaveLength(1);

      sentinel.trigger?.();
      await waitFor(() => expect(screen.getAllByTestId('history-row')).toHaveLength(2));
      // 第二页走 cursor,不是重复取第一页。
      expect(memory.calls[1]?.cursor).toBe('1');
      await waitFor(() => expect(screen.queryByTestId('history-load-sentinel')).toBeNull());
    } finally {
      globalThis.IntersectionObserver = original;
    }
  });

  it('行 class 消费密度 token,缩略保持舒适态 size-11', async () => {
    renderHistory([makeJob({ id: 'density' })]);
    await waitFor(() => expect(screen.getByTestId('history-row')).toBeTruthy());
    const row = screen.getByTestId('history-row');
    expect(row.className).toContain('--density-row-padding');
    expect(row.className).toContain('px-3');
    expect(screen.getByTestId('history-thumb').className).toContain('--density-history-thumb');
    expect(screen.getByTestId('history-thumb').className).toContain('size-11');
  });

  it('>150 线程只渲染视口内若干组,子回合与父行成组', async () => {
    const jobs = Array.from({ length: 160 }, (_, index) => [
      makeJob({ id: `p${index}`, createdAt: nowIso(-2000 - index) }),
      makeJob({
        id: `c${index}`,
        parentRunId: `p${index}`,
        createdAt: nowIso(-1000 - index),
      }),
    ]).flat();
    renderHistory(jobs);
    await waitFor(() => expect(screen.getByTestId('history-virtual-list')).toBeTruthy());
    expect(screen.getByTestId('history-list-scroll').getAttribute('data-virtualized')).toBe('true');
    const groups = screen.getAllByTestId('history-thread-group');
    expect(groups.length).toBeLessThan(160);
    expect(groups.length).toBeGreaterThan(0);
    const rows = screen.getAllByTestId('history-row');
    expect(rows.length).toBeLessThan(320);
    for (const group of groups) {
      const groupRows = group.querySelectorAll('[data-testid="history-row"]');
      expect(groupRows.length).toBeGreaterThanOrEqual(1);
      if (groupRows.length > 1) {
        expect(group.querySelector('[data-testid="history-thread-connector"]')).toBeTruthy();
      }
    }
  });

  it('虚拟化下深链 scrollToIndex 能露出目标行', async () => {
    useScreenIntent.getState().setIntent({ kind: 'history-select', jobId: 'job-140' });
    renderHistory(
      Array.from({ length: 160 }, (_, index) =>
        makeJob({ id: `job-${index}`, createdAt: nowIso(-index) }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('history-inspector-prompt').textContent).toBe('prompt job-140'),
    );
    await waitFor(() => expect(document.querySelector('[data-job-row="job-140"]')).toBeTruthy());
    expect(useScreenIntent.getState().intent).toBeNull();
  });

  it('虚拟化列表末尾哨兵仍触发下一页', async () => {
    const observed: Element[] = [];
    const sentinel: { trigger: (() => void) | null } = { trigger: null };
    class FakeObserver {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        sentinel.trigger = () => callback([{ isIntersecting: true }]);
      }
      observe(node: Element) {
        observed.push(node);
      }
      disconnect() {
        sentinel.trigger = null;
      }
    }
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
    try {
      renderHistory(
        Array.from({ length: 180 }, (_, index) =>
          makeJob({ id: `page-${index}`, createdAt: nowIso(-index) }),
        ),
        { pageSize: 160 },
      );
      await waitFor(() => expect(screen.getByTestId('history-virtual-list')).toBeTruthy());
      await waitFor(() => expect(screen.getByTestId('history-load-sentinel')).toBeTruthy());
      expect(observed).toHaveLength(1);
      sentinel.trigger?.();
      await waitFor(() =>
        expect(screen.getAllByTestId('history-thread-group').length).toBeGreaterThan(0),
      );
      await waitFor(() => expect(screen.queryByTestId('history-load-sentinel')).toBeNull());
      expect(screen.getAllByTestId('history-row').length).toBeLessThan(180);
    } finally {
      globalThis.IntersectionObserver = original;
    }
  });

  it('提示词库深链意图:mount 时选中指定记录', async () => {
    useScreenIntent.getState().setIntent({ kind: 'history-select', jobId: 'target' });
    renderHistory([
      makeJob({ id: 'other', createdAt: nowIso(-1000) }),
      makeJob({ id: 'target', createdAt: nowIso(-2000) }),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('history-inspector-prompt').textContent).toBe('prompt target'),
    );
    expect(useScreenIntent.getState().intent).toBeNull();
  });
});
