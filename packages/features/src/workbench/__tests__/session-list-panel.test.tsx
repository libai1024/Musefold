import type { AppPreferences, WorkbenchSession } from '@musefold/contracts';
import { defaultAppPreferences } from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NewSessionAction,
  SESSION_TITLE_MAX_LENGTH,
  SessionListPanel,
  WORKBENCH_SESSION_RESTART_REQUIRED,
} from '../SessionListPanel';
import { useScreenIntent } from '../../shell/screen-intent-store';
import { useActiveSession } from '../session-store';

function nowIso(): string {
  return new Date().toISOString().replace(/Z$/, '+00:00');
}

function makeSession(id = 'session-1', title = '未命名创作'): WorkbenchSession {
  const timestamp = nowIso();
  return {
    id,
    title,
    draft: {
      prompt: '',
      negative: '',
      params: {},
      promptReferenceSelections: [],
      promptReferenceIds: [],
    },
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    deletedAt: null,
    latestJobStatus: null,
    latestJobFinishedAt: null,
  };
}

function coded(code: string, message = '对话服务尚未加载'): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function renderPanel(options?: {
  listError?: Error;
  seed?: WorkbenchSession[];
  pinnedSessionIds?: string[];
  system?: { relaunch: () => Promise<void> };
}) {
  let preferences: AppPreferences = {
    ...defaultAppPreferences,
    pinnedSessionIds: options?.pinnedSessionIds ?? [],
  };
  let items = options?.seed ?? [makeSession()];
  const relaunch = options?.system?.relaunch ?? vi.fn(async () => undefined);
  const gateway = {
    workbench: {
      listSessions: vi.fn(async () => {
        if (options?.listError) throw options.listError;
        return { items, nextCursor: null };
      }),
      updateSession: vi.fn(async (id: string, patch: { title?: string }) => ({
        ...makeSession(id, patch.title ?? '未命名创作'),
      })),
      removeSession: vi.fn(async (id: string) => {
        const removed = items.find((session) => session.id === id);
        if (!removed) throw new Error('对话不存在');
        items = items.filter((session) => session.id !== id);
        return { ...removed, deletedAt: nowIso() };
      }),
    },
    settings: {
      getPreferences: async () => preferences,
      updatePreferences: vi.fn(async (patch: Partial<AppPreferences>) => {
        preferences = { ...preferences, ...patch };
        return preferences;
      }),
    },
    ...(options?.system ? { system: { relaunch } } : {}),
  } as unknown as MusefoldGateway;
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
  const view = render(<SessionListPanel onOpen={() => {}} />, { wrapper: Providers });
  return { gateway, relaunch, unmount: view.unmount };
}

describe('SessionListPanel 逃生门 / 重命名 / 密度', () => {
  beforeEach(() => {
    useActiveSession.setState({
      activeSessionId: null,
      draftSession: false,
      pendingDraft: null,
      draftParamOverrides: {},
      seenAt: {},
      unreadMarks: {},
    });
    document.documentElement.dataset.density = 'comfortable';
  });

  it('普通读取失败只给重试,不出现立即重启钮', async () => {
    renderPanel({ listError: new Error('网络中断') });
    await screen.findByTestId('session-list-error-title');
    expect(screen.getByTestId('session-list-error-title').textContent).toBe('对话读取失败');
    expect(screen.getByTestId('session-list-retry')).toBeTruthy();
    expect(screen.queryByTestId('session-list-relaunch')).toBeNull();
  });

  it('RESTART_REQUIRED + system 域:标题特判并出现立即重启钮', async () => {
    const { relaunch } = renderPanel({
      listError: coded(WORKBENCH_SESSION_RESTART_REQUIRED),
      system: { relaunch: vi.fn(async () => undefined) },
    });
    await screen.findByTestId('session-list-relaunch');
    expect(screen.getByTestId('session-list-error-title').textContent).toBe('需要重启应用');
    expect(screen.getByTestId('session-list-error-hint').textContent).toContain('完全重启');
    expect(screen.queryByTestId('session-list-retry')).toBeNull();
    expect((screen.getByTestId('session-list-relaunch') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('session-list-relaunch'));
    await waitFor(() => {
      expect(relaunch).toHaveBeenCalled();
    });
  });

  it('RESTART_REQUIRED 但无 system 域:只给说明与重试,不留死按钮', async () => {
    renderPanel({ listError: coded(WORKBENCH_SESSION_RESTART_REQUIRED) });
    await screen.findByTestId('session-list-error-title');
    expect(screen.getByTestId('session-list-error-title').textContent).toBe('需要重启应用');
    expect(screen.getByTestId('session-list-error-hint')).toBeTruthy();
    expect(screen.getByTestId('session-list-retry')).toBeTruthy();
    expect(screen.queryByTestId('session-list-relaunch')).toBeNull();
  });

  it('重命名输入 maxLength 对齐契约 120', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('session-rename')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('session-rename'));
    const input = screen.getByTestId('session-rename-input');
    expect(input.getAttribute('maxlength')).toBe(String(SESSION_TITLE_MAX_LENGTH));
    expect(SESSION_TITLE_MAX_LENGTH).toBe(120);
  });

  it('更多菜单的删除先确认,取消保留会话、当前选择与置顶', async () => {
    useActiveSession.getState().setActiveSessionId('session-1');
    const { gateway } = renderPanel({ pinnedSessionIds: ['session-1'] });
    await userEvent.click(await screen.findByTestId('session-more'));
    await userEvent.click(await screen.findByTestId('session-menu-remove'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/未命名创作/)).toBeTruthy();
    expect(gateway.workbench.removeSession).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('session-session-1')).toBeTruthy();
    expect(useActiveSession.getState().activeSessionId).toBe('session-1');
    expect(gateway.workbench.removeSession).not.toHaveBeenCalled();
    expect(gateway.settings.updatePreferences).not.toHaveBeenCalled();
  });

  it.each([true, false])('更多菜单确认仅删除目标并清其置顶,current=%s', async (removeCurrent) => {
    useActiveSession.getState().setActiveSessionId(removeCurrent ? 'session-1' : 'session-2');
    const { gateway } = renderPanel({
      seed: [makeSession('session-1', '待删除'), makeSession('session-2', '保留对话')],
      pinnedSessionIds: ['session-1', 'session-2'],
    });
    const row = (await screen.findByTestId('session-session-1')).parentElement;
    if (!row) throw new Error('会话行缺失');
    await userEvent.click(within(row).getByTestId('session-more'));
    await userEvent.click(await screen.findByTestId('session-menu-remove'));
    await userEvent.click(await screen.findByTestId('session-remove-confirm'));

    await waitFor(() => expect(screen.queryByTestId('session-session-1')).toBeNull());
    expect(screen.getByTestId('session-session-2')).toBeTruthy();
    expect(gateway.workbench.removeSession).toHaveBeenCalledExactlyOnceWith('session-1');
    expect(gateway.settings.updatePreferences).toHaveBeenCalledExactlyOnceWith({
      pinnedSessionIds: ['session-2'],
    });
    // 成功删除当前会话后选中剩余会话，非当前删除不切换。
    expect(useActiveSession.getState().activeSessionId).toBe('session-2');
  });

  it('更多菜单确认最后一个会话后显示空态且不再保留活动指针', async () => {
    useActiveSession.getState().setActiveSessionId('session-1');
    renderPanel();
    await userEvent.click(await screen.findByTestId('session-more'));
    await userEvent.click(await screen.findByTestId('session-menu-remove'));
    await userEvent.click(await screen.findByTestId('session-remove-confirm'));

    expect(await screen.findByText(/还没有对话。点「新设计」开始/)).toBeTruthy();
    expect(screen.queryByTestId('session-session-1')).toBeNull();
    expect(useActiveSession.getState().activeSessionId).toBeNull();
  });

  it('会话行使用 --density-nav-y;紧凑态仍走同一 class', async () => {
    const { unmount } = renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('session-session-1')).toBeTruthy();
    });
    const comfortableClass = screen.getByTestId('session-session-1').className;
    expect(comfortableClass).toContain('--density-nav-y');
    unmount();

    document.documentElement.dataset.density = 'compact';
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('session-session-1')).toBeTruthy();
    });
    expect(screen.getByTestId('session-session-1').className).toContain('--density-nav-y');
    expect(document.documentElement.dataset.density).toBe('compact');
  });
});

describe('NewSessionAction:⌘N 新设计 → 聚焦 Composer 意图(2026-09 走查 P2)', () => {
  beforeEach(() => {
    useScreenIntent.setState({ intent: null });
    useActiveSession.setState({ activeSessionId: null, draftSession: false, pendingDraft: null });
  });

  afterEach(() => {
    useScreenIntent.setState({ intent: null });
  });

  it('点击「新设计」进入草稿态、切屏并写 workbench-focus-composer 意图', () => {
    const onOpen = vi.fn();
    render(<NewSessionAction onOpen={onOpen} />);

    fireEvent.click(screen.getByTestId('session-create'));
    expect(useActiveSession.getState().draftSession).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(useScreenIntent.getState().intent).toEqual({ kind: 'workbench-focus-composer' });
  });

  it('⌘N / Ctrl+N 等价同路径;Shift 组合与裸 N 不触发', () => {
    const onOpen = vi.fn();
    render(<NewSessionAction onOpen={onOpen} />);

    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(useScreenIntent.getState().intent).toEqual({ kind: 'workbench-focus-composer' });

    useScreenIntent.setState({ intent: null });
    useActiveSession.setState({ draftSession: false });
    fireEvent.keyDown(window, { key: 'N', ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(2);

    useScreenIntent.setState({ intent: null });
    fireEvent.keyDown(window, { key: 'n', metaKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 'n' });
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(useScreenIntent.getState().intent).toBeNull();
  });
});
