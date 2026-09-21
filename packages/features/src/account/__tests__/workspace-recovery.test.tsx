import type {
  AccountSummary,
  DesktopSyncStatus,
  LocalWorkspacePreview,
  LocalWorkspaceRecoveryStatus,
} from '@musefold/contracts';
import {
  DESKTOP_CAPABILITIES,
  type MusefoldGateway,
  PlatformProvider,
  queryKeys,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { applyAccountSession, beginAccountTransition } from '../account-session';
import { CloudSyncPanel } from '../CloudSyncPanel';
import { useSetSyncConsent } from '../hooks';
import { usePrepareLocalWorkspace } from '../workspace-recovery-hooks';

const ACCOUNT = {
  id: 'same-upstream-id',
  username: '当前用户',
  displayName: '账号 A',
  quota: 1,
  quotaUnit: 'quota',
  canGenerate: true,
  identity: {
    apiIssuer: 'https://api.example.test',
    principalId: 'principal-a',
    status: 'active',
    identityVersion: 1,
  },
} satisfies AccountSummary;
const STATUS: DesktopSyncStatus = {
  reviewRef: 'd'.repeat(64),
  consent: 'unset',
  phase: 'awaiting_consent',
  enabled: false,
  state: 'disabled',
  account: { username: '当前用户', deviceName: '本机' },
  lastSyncedAt: null,
  pendingMutations: 0,
  conflicts: 0,
  error: null,
};
const SOURCE: LocalWorkspaceRecoveryStatus['sources'][number] = {
  sourceId: 'a'.repeat(64),
  label: '本机账号提示词库 · 旧名称',
  kind: 'account',
  createdAt: '2026-01-01T00:00:00.000Z',
  counts: { prompts: 21, folders: 1, tags: 1 },
  revision: 'b'.repeat(64),
};
const PREVIEW: LocalWorkspacePreview = {
  sourceId: SOURCE.sourceId,
  revision: 'c'.repeat(64),
  prompts: [
    {
      id: 'p1',
      title: '旧庭院',
      content: '庭院的原始提示词',
      negative: '灰雾',
      folderName: '庭院文件夹',
      tags: ['庭院标签'],
      isDeleted: false,
    },
  ],
  folders: [{ id: 'f1', name: '庭院文件夹', parentId: null }],
  tags: [{ id: 't1', name: '庭院标签' }],
  nextCursor: '20',
};

function setup(options: { ready?: boolean; restricted?: boolean } = {}) {
  const state = {
    account: options.restricted
      ? {
          ...ACCOUNT,
          canGenerate: false,
          identity: { ...ACCOUNT.identity, status: 'recovery_required' as const },
        }
      : ACCOUNT,
    status: options.restricted ? { ...STATUS, phase: 'auth_blocked' as const } : STATUS,
    recovery: {
      reviewRef: options.restricted ? null : 'd'.repeat(64),
      targetAccount: options.restricted ? null : { username: '账号 A' },
      targetReady: !!options.ready,
      canPrepare: !options.ready && !options.restricted,
      sources: [SOURCE],
    } satisfies LocalWorkspaceRecoveryStatus,
  };
  const sync = {
    getStatus: vi.fn(async () => state.status),
    setConsent: vi.fn<NonNullable<MusefoldGateway['sync']>['setConsent']>(async (consent) => {
      state.status = {
        ...STATUS,
        consent,
        enabled: consent === 'enabled',
        phase: 'idle',
        state: 'idle',
      };
      return state.status;
    }),
    setEnabled: vi.fn(),
    syncNow: vi.fn(async () => state.status),
    listConflicts: vi.fn(async () => []),
    resolveConflict: vi.fn(),
    listLocalWorkspaces: vi.fn(async () => state.recovery),
    previewLocalWorkspace: vi.fn<
      NonNullable<NonNullable<MusefoldGateway['sync']>['previewLocalWorkspace']>
    >(async () => PREVIEW),
    prepareLocalWorkspace: vi.fn<
      NonNullable<NonNullable<MusefoldGateway['sync']>['prepareLocalWorkspace']>
    >(async () => {
      state.recovery = { ...state.recovery, targetReady: true, canPrepare: false };
      return state.status;
    }),
  } satisfies NonNullable<MusefoldGateway['sync']>;
  const account = { getStatus: vi.fn(async () => state.account) };
  const gateway = { account, sync } as unknown as MusefoldGateway;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.account.status(), state.account);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PlatformProvider runtime={{ gateway, capabilities: DESKTOP_CAPABILITIES }}>
        {children}
      </PlatformProvider>
    </QueryClientProvider>
  );
  return { state, sync, client, Wrapper };
}
async function view() {
  await userEvent.click(await screen.findByRole('button', { name: `查看 ${SOURCE.label}` }));
  await screen.findByText('庭院的原始提示词');
}

describe('local workspace recovery controls', () => {
  it('requires preview, confirms the viewed revision and separately asks for first sync consent', async () => {
    const { sync, Wrapper } = setup();
    render(<CloudSyncPanel />, { wrapper: Wrapper });
    await screen.findByText(/为 账号 A 选择初始提示词库/);
    expect(screen.queryByTestId('sync-consent-enable')).toBeNull();
    await view();
    expect(sync.prepareLocalWorkspace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '复制这份库到当前账号' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('不会删除原库');
    expect(sync.prepareLocalWorkspace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '确认并在本机保存' }));
    await waitFor(() =>
      expect(sync.prepareLocalWorkspace).toHaveBeenCalledExactlyOnceWith({
        mode: 'copy',
        reviewRef: 'd'.repeat(64),
        sourceId: SOURCE.sourceId,
        expectedRevision: PREVIEW.revision,
      }),
    );
    await screen.findByText(/当前账号的本机提示词库已准备好/);
    expect(sync.setConsent).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: '开启云同步' }));
    await waitFor(() =>
      expect(sync.setConsent).toHaveBeenCalledExactlyOnceWith('enabled', 'd'.repeat(64)),
    );
  });

  it('names the reviewed target from the same host response even when the account cache is stale', async () => {
    const { state, client, sync, Wrapper } = setup();
    state.recovery = {
      ...state.recovery,
      targetAccount: { username: '宿主已验证的 B' },
      reviewRef: 'e'.repeat(64),
    };
    // Stale account A stays cached; it must not label a B review as belonging to A.
    expect(client.getQueryData(queryKeys.account.status())).toEqual(ACCOUNT);
    render(<CloudSyncPanel />, { wrapper: Wrapper });
    await view();
    await userEvent.click(screen.getByRole('button', { name: '复制这份库到当前账号' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('宿主已验证的 B');
    expect(screen.getByRole('alertdialog').textContent).not.toContain('账号 A');
    await userEvent.click(screen.getByRole('button', { name: '确认并在本机保存' }));
    await waitFor(() =>
      expect(sync.prepareLocalWorkspace).toHaveBeenCalledExactlyOnceWith({
        mode: 'copy',
        sourceId: SOURCE.sourceId,
        expectedRevision: PREVIEW.revision,
        reviewRef: 'e'.repeat(64),
      }),
    );
  });

  it('a new review epoch for the same named account closes the old confirmation', async () => {
    const { state, client, sync, Wrapper } = setup();
    render(<CloudSyncPanel />, { wrapper: Wrapper });
    await view();
    await userEvent.click(screen.getByRole('button', { name: '复制这份库到当前账号' }));
    await act(async () => {
      state.recovery = { ...state.recovery, reviewRef: 'f'.repeat(64) };
      await client.invalidateQueries({ queryKey: queryKeys.sync.localWorkspaces() });
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(sync.prepareLocalWorkspace).not.toHaveBeenCalled();
  });

  it('empty setup requires explicit confirmation and keeps old data viewable', async () => {
    const { sync, Wrapper } = setup();
    render(<CloudSyncPanel />, { wrapper: Wrapper });
    await userEvent.click(await screen.findByRole('button', { name: '建立空的提示词库' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('旧库仍可查看');
    await userEvent.click(screen.getByRole('button', { name: '返回查看' }));
    expect(sync.prepareLocalWorkspace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '建立空的提示词库' }));
    await userEvent.click(screen.getByRole('button', { name: '确认并在本机保存' }));
    await waitFor(() =>
      expect(sync.prepareLocalWorkspace).toHaveBeenCalledExactlyOnceWith({
        mode: 'empty',
        reviewRef: 'd'.repeat(64),
      }),
    );
    await view();
    expect(screen.getByText('庭院的原始提示词')).toBeTruthy();
    expect(sync.setConsent).not.toHaveBeenCalled();
  });

  it('changed source returns an actionable refresh; it never resubmits automatically', async () => {
    const { sync, Wrapper } = setup();
    sync.prepareLocalWorkspace.mockRejectedValueOnce(
      new Error('本机数据在查看后发生了变化，请重新查看后再复制'),
    );
    render(<CloudSyncPanel />, { wrapper: Wrapper });
    await view();
    await userEvent.click(screen.getByRole('button', { name: '复制这份库到当前账号' }));
    await userEvent.click(screen.getByRole('button', { name: '确认并在本机保存' }));
    await screen.findByText(/本机数据在查看后发生了变化/);
    await userEvent.click(screen.getByRole('button', { name: '刷新并重新查看' }));
    await waitFor(() => expect(sync.previewLocalWorkspace).toHaveBeenCalledTimes(2));
    expect(sync.prepareLocalWorkspace).toHaveBeenCalledTimes(1);
  });

  it('recovery-only can inspect local data, while prepare and sync actions remain unavailable', async () => {
    const { sync, Wrapper } = setup({ restricted: true });
    render(<CloudSyncPanel />, { wrapper: Wrapper });
    await view();
    expect(screen.getByText(/现在仍可查看本机旧数据/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '复制这份库到当前账号' })).toBeNull();
    expect(screen.queryByRole('button', { name: '建立空的提示词库' })).toBeNull();
    expect(screen.queryByRole('button', { name: '开启云同步' })).toBeNull();
    expect(screen.queryByTestId('sync-now')).toBeNull();
    expect(sync.prepareLocalWorkspace).not.toHaveBeenCalled();
  });

  it('an existing target only offers inspection and paginates the local source', async () => {
    const { sync, Wrapper } = setup({ ready: true });
    sync.previewLocalWorkspace.mockImplementation(async (input) =>
      input.cursor === '20'
        ? {
            ...PREVIEW,
            prompts: [
              { ...PREVIEW.prompts[0], title: '末页', content: '最后一条', isDeleted: true },
            ],
            nextCursor: null,
          }
        : PREVIEW,
    );
    render(<CloudSyncPanel />, { wrapper: Wrapper });
    await view();
    expect(screen.queryByRole('button', { name: '复制这份库到当前账号' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByText('最后一条');
    expect(sync.previewLocalWorkspace).toHaveBeenLastCalledWith({
      sourceId: SOURCE.sourceId,
      cursor: '20',
    });
    expect(screen.getByText(/复制后仍保留删除状态/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '上一页' }));
    await screen.findByText('庭院的原始提示词');
  });

  it('account switch closes the old confirmation even when the upstream ID stays the same', async () => {
    const { state, client, sync, Wrapper } = setup();
    render(<CloudSyncPanel />, { wrapper: Wrapper });
    await view();
    await userEvent.click(screen.getByRole('button', { name: '复制这份库到当前账号' }));
    await act(async () => {
      state.account = {
        ...ACCOUNT,
        displayName: '账号 B',
        identity: { ...ACCOUNT.identity, principalId: 'principal-b' },
      };
      state.recovery = {
        ...state.recovery,
        reviewRef: 'e'.repeat(64),
        targetAccount: { username: '账号 B' },
      };
      await applyAccountSession(client, state.account, beginAccountTransition(client));
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByText('庭院的原始提示词')).toBeNull();
    expect(sync.prepareLocalWorkspace).not.toHaveBeenCalled();
  });

  it.each(['prepare', 'consent'] as const)(
    'late %s mutation does not overwrite the next account sync cache',
    async (kind) => {
      const { client, sync, Wrapper } = setup();
      let finish!: (status: DesktopSyncStatus) => void;
      const deferred = new Promise<DesktopSyncStatus>((resolve) => {
        finish = resolve;
      });
      sync.prepareLocalWorkspace.mockReturnValueOnce(deferred);
      sync.setConsent.mockReturnValueOnce(deferred);
      const { result } = renderHook(
        () => ({ prepare: usePrepareLocalWorkspace(), consent: useSetSyncConsent() }),
        { wrapper: Wrapper },
      );
      let pending!: Promise<unknown>;
      await act(async () => {
        pending =
          kind === 'prepare'
            ? result.current.prepare.mutateAsync({ mode: 'empty', reviewRef: 'd'.repeat(64) })
            : result.current.consent.mutateAsync({ consent: 'enabled', reviewRef: 'd'.repeat(64) });
      });
      const rejected = expect(pending).rejects.toThrow('账号已切换');
      beginAccountTransition(client);
      const bStatus = { ...STATUS, account: { username: '账号 B', deviceName: '本机' } };
      client.setQueryData(queryKeys.sync.status(), bStatus);
      await act(async () => {
        finish(STATUS);
        await rejected;
      });
      expect(client.getQueryData(queryKeys.sync.status())).toEqual(bStatus);
    },
  );
});
