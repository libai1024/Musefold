import type {
  AppPreferences,
  UpdateWorkbenchSession,
  WorkbenchSession,
  WorkbenchSessionListQuery,
} from '@musefold/contracts';
import {
  DESKTOP_CAPABILITIES,
  type MusefoldGateway,
  PlatformProvider,
  type PlatformCapabilities,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { toast } from '@musefold/ui/components/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenIntent } from '../../shell/screen-intent-store';
import { formatArchivedAt } from '../ArchivedSessionsPanel';
import { resolveThemeClass } from '../hooks';
import { MotionSync } from '../MotionSync';
import { SettingsScreen, type SettingsScreenProps } from '../SettingsScreen';

// 归档面板失败提示走 sonner;统一 mock,断言 toast.error 被调即可。
vi.mock('@musefold/ui/components/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Radix Select 在 jsdom 缺 pointer capture / scrollIntoView 实现,补桩后才能开浮层。
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

function makeArchivedSession(
  id: string,
  title: string,
  archivedAt: string,
  version = 3,
): WorkbenchSession {
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
    version,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: archivedAt,
    archivedAt,
    deletedAt: null,
    latestJobStatus: null,
    latestJobFinishedAt: null,
  };
}

type CallMode = 'ready' | 'pending' | 'error';

function createTestGateway(overrides?: {
  accountRejects?: boolean;
  preferences?: Partial<AppPreferences>;
  archived?: WorkbenchSession[];
  listMode?: CallMode;
  updateMode?: CallMode;
  removeMode?: CallMode;
}): {
  gateway: MusefoldGateway;
  updateSpy: ReturnType<typeof vi.fn>;
  listSessionsSpy: ReturnType<typeof vi.fn>;
  updateSessionSpy: ReturnType<typeof vi.fn>;
  removeSessionSpy: ReturnType<typeof vi.fn>;
  resolveHeldUpdate(): void;
  resolveHeldRemove(): void;
} {
  let preferences: AppPreferences = {
    theme: 'system',
    language: 'zh-CN',
    reducedMotion: 'system',
    pinnedSessionIds: [],
    ...overrides?.preferences,
  };
  const updateSpy = vi.fn(async (patch: Partial<AppPreferences>) => {
    preferences = { ...preferences, ...patch };
    return preferences;
  });

  // 内存版 workbench 域:只实现归档面板触达的三个方法,语义对齐契约
  // (archivedOnly 过滤、expectedVersion 校验、软删置 deletedAt)。
  const sessions = new Map((overrides?.archived ?? []).map((session) => [session.id, session]));
  let heldUpdate: (() => void) | null = null;
  let heldRemove: (() => void) | null = null;

  function applyUpdate(id: string, patch: UpdateWorkbenchSession): WorkbenchSession {
    const session = sessions.get(id);
    if (!session) throw new Error('NOT_FOUND');
    if (patch.expectedVersion !== session.version) throw new Error('WORKBENCH_VERSION_CONFLICT');
    const next: WorkbenchSession = {
      ...session,
      ...(patch.archived !== undefined
        ? { archivedAt: patch.archived ? new Date().toISOString() : null }
        : {}),
      version: session.version + 1,
      updatedAt: new Date().toISOString(),
    };
    sessions.set(id, next);
    return next;
  }

  const listSessionsSpy = vi.fn((query: WorkbenchSessionListQuery) => {
    if (overrides?.listMode === 'pending') return new Promise(() => {});
    if (overrides?.listMode === 'error') return Promise.reject(new Error('LIST_FAILED'));
    const archivedOnly = query.archivedOnly === true || query.archivedOnly === 'true';
    return Promise.resolve({
      items: [...sessions.values()].filter(
        (session) =>
          session.deletedAt == null &&
          (archivedOnly ? session.archivedAt != null : session.archivedAt == null),
      ),
      nextCursor: null,
    });
  });
  const updateSessionSpy = vi.fn((id: string, patch: UpdateWorkbenchSession) => {
    if (overrides?.updateMode === 'error') {
      return Promise.reject(new Error('WORKBENCH_VERSION_CONFLICT'));
    }
    if (overrides?.updateMode === 'pending') {
      return new Promise<WorkbenchSession>((resolve) => {
        heldUpdate = () => resolve(applyUpdate(id, patch));
      });
    }
    return Promise.resolve(applyUpdate(id, patch));
  });
  const removeSessionSpy = vi.fn((id: string) => {
    if (overrides?.removeMode === 'error') return Promise.reject(new Error('REMOVE_FAILED'));
    const remove = () => {
      const session = sessions.get(id);
      if (!session) throw new Error('NOT_FOUND');
      const next = { ...session, deletedAt: new Date().toISOString() };
      sessions.set(id, next);
      return next;
    };
    if (overrides?.removeMode === 'pending') {
      return new Promise<WorkbenchSession>((resolve) => {
        heldRemove = () => resolve(remove());
      });
    }
    return Promise.resolve(remove());
  });

  const gateway = {
    settings: {
      getPreferences: async () => preferences,
      updatePreferences: updateSpy,
    },
    account: {
      getStatus: overrides?.accountRejects
        ? async () => {
            throw new Error('AUTH_REQUIRED');
          }
        : async () => ({
            id: 'u1',
            username: 'tester',
            displayName: '测试者',
            quota: 150_000,
            quotaUnit: '点',
            canGenerate: true,
          }),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      redeem: vi.fn(),
    },
    workbench: {
      listSessions: listSessionsSpy,
      createSession: vi.fn(),
      getSession: vi.fn(),
      updateSession: updateSessionSpy,
      removeSession: removeSessionSpy,
      restoreSession: vi.fn(),
    },
    // 桌面专属域的常驻桩:Web 用例不查询它们,桌面能力用例才有真实调用。
    sync: {
      getStatus: async () => ({
        consent: 'unset',
        phase: 'signed_out',
        enabled: false,
        state: 'disabled',
        account: null,
        lastSyncedAt: null,
        pendingMutations: 0,
        conflicts: 0,
        error: null,
      }),
      setConsent: vi.fn(),
      listConflicts: async () => [],
      resolveConflict: vi.fn(),
      setEnabled: vi.fn(),
      syncNow: vi.fn(),
    },
    aiProviders: {
      list: async () => [],
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      setActive: vi.fn(),
      test: vi.fn(),
    },
    doubao: {
      getStatus: async () => ({
        loggedIn: false,
        accountName: null,
        avatarDataUrl: null,
        verificationRequired: false,
        usage: { date: '2026-09-01', limit: 100, used: 0, remaining: 100 },
        loginState: 'logged-out',
        qrCodeDataUrl: null,
        qrExpiresAt: null,
        errorMessage: null,
      }),
      startLogin: vi.fn(),
      refreshLogin: vi.fn(),
      logout: vi.fn(),
    },
  } as unknown as MusefoldGateway;

  return {
    gateway,
    updateSpy,
    listSessionsSpy,
    updateSessionSpy,
    removeSessionSpy,
    resolveHeldUpdate: () => heldUpdate?.(),
    resolveHeldRemove: () => heldRemove?.(),
  };
}

function renderSettings(
  gateway: MusefoldGateway,
  props?: SettingsScreenProps,
  capabilities: PlatformCapabilities = WEB_CAPABILITIES,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities }}>{children}</PlatformProvider>
      </QueryClientProvider>
    );
  }
  return render(<SettingsScreen {...props} />, { wrapper: Providers });
}

describe('SettingsScreen', () => {
  it('renders preferences and account summary after loading', async () => {
    const { gateway } = createTestGateway();
    renderSettings(gateway);

    await waitFor(() => {
      expect(screen.getByTestId('account-signed-in')).toBeTruthy();
    });
    expect(screen.getByTestId('settings-theme-trigger').textContent).toContain('跟随系统');
    expect(screen.getByText('测试者')).toBeTruthy();
    expect(screen.getByTestId('account-points').textContent).toBe('3 积分');
    expect(screen.getByTestId('settings-host-badge').textContent).toBe('Web 版');
  });

  it('updates motion level through the three-option select', async () => {
    const { gateway, updateSpy } = createTestGateway();
    renderSettings(gateway);

    const trigger = await screen.findByTestId('settings-motion-trigger');
    expect(trigger.textContent).toContain('跟随系统');

    // Radix Select:键盘展开;jsdom 无 pointer 事件流,click 走触摸分支提交选择。
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const option = await screen.findByTestId('settings-motion-on');
    fireEvent.click(option);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ reducedMotion: 'on' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-motion-trigger').textContent).toContain('减少动效');
    });
  });

  it('shows signed-out hint when account status is unavailable', async () => {
    const { gateway } = createTestGateway({ accountRejects: true });
    renderSettings(gateway);

    await waitFor(() => {
      expect(screen.getByTestId('settings-account-signed-out')).toBeTruthy();
    });
  });

  it('consumes sidebar deep-link intents and scrolls to the target card', async () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy;
    try {
      useScreenIntent.setState({ intent: { kind: 'settings-account' } });
      const { gateway } = createTestGateway();
      const { unmount } = renderSettings(gateway);

      await screen.findByTestId('settings-account-anchor');
      await waitFor(() => {
        expect(scrollSpy).toHaveBeenCalled();
      });
      expect(useScreenIntent.getState().intent).toBeNull();
      unmount();

      // Web 无中转站卡:connections 意图兜底滚到账户卡,不悬空。
      scrollSpy.mockClear();
      useScreenIntent.setState({ intent: { kind: 'settings-connections' } });
      renderSettings(gateway);
      await screen.findByTestId('settings-account-anchor');
      await waitFor(() => {
        expect(scrollSpy).toHaveBeenCalled();
      });
      expect(screen.queryByTestId('settings-connections-anchor')).toBeNull();
      expect(useScreenIntent.getState().intent).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = original;
      useScreenIntent.setState({ intent: null });
    }
  });

  it('shows the doubao login card only when the desktop capability is on', async () => {
    const { gateway } = createTestGateway();
    const desktop = renderSettings(gateway, undefined, DESKTOP_CAPABILITIES);
    // 桌面:连接区锚点内含 AI 连接卡 + 豆包免费试用卡(未登录给扫码入口)。
    await screen.findByTestId('settings-doubao-card');
    expect(screen.getByTestId('settings-connections-anchor')).toBeTruthy();
    expect(screen.getByTestId('settings-ai-connections-card')).toBeTruthy();
    expect(await screen.findByTestId('doubao-login-start')).toBeTruthy();
    desktop.unmount();

    // Web:能力关闭,豆包登录 UI 与连接区锚点都不出现。
    renderSettings(gateway);
    await screen.findByTestId('settings-screen');
    expect(screen.queryByTestId('settings-doubao-card')).toBeNull();
    expect(screen.queryByTestId('settings-connections-anchor')).toBeNull();
  });

  it('data card opens prompt trash via screen intent; hidden without onOpenScreen', async () => {
    useScreenIntent.setState({ intent: null });
    const { gateway } = createTestGateway();
    const onOpenScreen = vi.fn();
    const { unmount } = renderSettings(gateway, { onOpenScreen });

    fireEvent.click(await screen.findByTestId('settings-open-prompt-trash'));
    expect(onOpenScreen).toHaveBeenCalledWith('prompts');
    expect(useScreenIntent.getState().intent).toEqual({ kind: 'prompts-trash' });

    fireEvent.click(screen.getByTestId('settings-open-history-trash'));
    expect(onOpenScreen).toHaveBeenLastCalledWith('history');
    expect(useScreenIntent.getState().intent).toEqual({ kind: 'history-trash' });

    // 归档面板随数据卡渲染(就地展开,不经 onOpenScreen),默认折叠。
    expect(screen.getByTestId('archived-toggle')).toBeTruthy();
    expect(screen.queryByTestId('archived-body')).toBeNull();

    unmount();
    useScreenIntent.setState({ intent: null });
    renderSettings(gateway);
    await screen.findByTestId('settings-appearance-card');
    expect(screen.queryByTestId('settings-data-card')).toBeNull();
    expect(screen.queryByTestId('archived-panel')).toBeNull();
  });
});

describe('ArchivedSessionsPanel(设置·数据卡内已归档对话)', () => {
  const ARCHIVED_AT = '2024-03-05T06:30:00.000Z';

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  function renderWithArchived(options?: Parameters<typeof createTestGateway>[0]) {
    const utils = createTestGateway(options);
    renderSettings(utils.gateway, { onOpenScreen: vi.fn() });
    return utils;
  }

  async function expand() {
    fireEvent.click(await screen.findByTestId('archived-toggle'));
    await screen.findByTestId('archived-body');
  }

  it('展开后 loading 优先于 empty', async () => {
    renderWithArchived({ listMode: 'pending' });
    await expand();

    expect(await screen.findByTestId('archived-loading')).toBeTruthy();
    expect(screen.queryByTestId('archived-empty')).toBeNull();
    expect(screen.queryByTestId('archived-error')).toBeNull();
  });

  it('读取失败显示错误与重试,优先于 empty;重试重新拉取', async () => {
    const { listSessionsSpy } = renderWithArchived({ listMode: 'error' });
    await expand();

    expect(await screen.findByTestId('archived-error')).toBeTruthy();
    expect(screen.queryByTestId('archived-empty')).toBeNull();
    expect(screen.queryByTestId('archived-loading')).toBeNull();

    const callsBefore = listSessionsSpy.mock.calls.length;
    fireEvent.click(screen.getByTestId('archived-retry'));
    await waitFor(() => {
      expect(listSessionsSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('空归档显示空态文案,折叠行计数为 0', async () => {
    renderWithArchived();
    expect((await screen.findByTestId('archived-count')).textContent).toBe('0');

    await expand();
    expect(await screen.findByTestId('archived-empty')).toBeTruthy();
  });

  it('ready:渲染归档行,时间恒带年份,刷新重新请求', async () => {
    const { listSessionsSpy } = renderWithArchived({
      archived: [
        makeArchivedSession('s1', '霓虹城市', ARCHIVED_AT),
        makeArchivedSession('s2', '山间小屋', '2026-01-20T09:15:00.000Z'),
      ],
    });
    expect((await screen.findByTestId('archived-count')).textContent).toBe('2');

    await expand();
    expect(await screen.findByTestId('archived-session-s1')).toBeTruthy();
    expect(screen.getByTestId('archived-session-s2')).toBeTruthy();
    expect(screen.getByTestId('archived-time-s1').textContent).toContain('2024');
    expect(screen.getByTestId('archived-time-s2').textContent).toContain('2026');

    const callsBefore = listSessionsSpy.mock.calls.length;
    expect(screen.getByTestId('archived-refresh').getAttribute('aria-label')).toBe(
      '刷新已归档对话',
    );
    fireEvent.click(screen.getByTestId('archived-refresh'));
    await waitFor(() => expect(listSessionsSpy.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(listSessionsSpy).toHaveBeenLastCalledWith({ archivedOnly: true, limit: 100 });
  });

  it('恢复:versioned update(expectedVersion + archived:false),pending 禁用,成功后失效刷新行消失', async () => {
    const { listSessionsSpy, updateSessionSpy, resolveHeldUpdate } = renderWithArchived({
      archived: [makeArchivedSession('s1', '霓虹城市', ARCHIVED_AT)],
      updateMode: 'pending',
    });
    await expand();
    await screen.findByTestId('archived-session-s1');

    fireEvent.click(screen.getByTestId('archived-restore-s1'));
    await waitFor(() => {
      expect(updateSessionSpy).toHaveBeenCalledWith('s1', {
        expectedVersion: 3,
        archived: false,
      });
    });
    // 恢复进行中:该行两个动作均禁用。
    await waitFor(() => {
      expect((screen.getByTestId('archived-restore-s1') as HTMLButtonElement).disabled).toBe(true);
    });
    expect((screen.getByTestId('archived-remove-s1') as HTMLButtonElement).disabled).toBe(true);

    const callsBefore = listSessionsSpy.mock.calls.length;
    resolveHeldUpdate();
    // 成功 → workbench.all() 失效 → 重拉归档列表,行消失。
    await waitFor(() => {
      expect(screen.queryByTestId('archived-session-s1')).toBeNull();
    });
    expect(listSessionsSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(listSessionsSpy).toHaveBeenLastCalledWith({ archivedOnly: true, limit: 100 });
    expect(toast.success).toHaveBeenCalledWith('聊天已恢复 · 霓虹城市');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('恢复失败 toast 提示且行保留', async () => {
    renderWithArchived({
      archived: [makeArchivedSession('s1', '霓虹城市', ARCHIVED_AT)],
      updateMode: 'error',
    });
    await expand();
    await screen.findByTestId('archived-session-s1');

    fireEvent.click(screen.getByTestId('archived-restore-s1'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('WORKBENCH_VERSION_CONFLICT');
    });
    expect(screen.getByTestId('archived-session-s1')).toBeTruthy();
    expect((screen.getByTestId('archived-restore-s1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('删除需经 AlertDialog 确认;取消不调用软删', async () => {
    const { removeSessionSpy } = renderWithArchived({
      archived: [makeArchivedSession('s1', '霓虹城市', ARCHIVED_AT)],
    });
    await expand();
    await screen.findByTestId('archived-session-s1');

    fireEvent.click(screen.getByTestId('archived-remove-s1'));
    expect(await screen.findByTestId('archived-remove-confirm')).toBeTruthy();
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('删除对话?')).toBeTruthy();
    expect(within(dialog).getByText(/霓虹城市/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByTestId('archived-remove-confirm')).toBeNull();
    });
    expect(removeSessionSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('archived-session-s1')).toBeTruthy();
  });

  it('删除确认:pending 禁用且对话框保持,成功后关框并刷新列表', async () => {
    const { listSessionsSpy, removeSessionSpy, resolveHeldRemove } = renderWithArchived({
      archived: [makeArchivedSession('s1', '霓虹城市', ARCHIVED_AT)],
      removeMode: 'pending',
    });
    await expand();
    await screen.findByTestId('archived-session-s1');

    fireEvent.click(screen.getByTestId('archived-remove-s1'));
    const confirm = await screen.findByTestId('archived-remove-confirm');
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(removeSessionSpy).toHaveBeenCalledWith('s1');
    });
    // pending:确认钮禁用、文案切换,对话框不关闭。
    await waitFor(() => {
      expect((screen.getByTestId('archived-remove-confirm') as HTMLButtonElement).disabled).toBe(
        true,
      );
    });
    expect(screen.getByTestId('archived-remove-confirm').textContent).toContain('删除中');

    const callsBefore = listSessionsSpy.mock.calls.length;
    resolveHeldRemove();
    await waitFor(() => {
      expect(screen.queryByTestId('archived-remove-confirm')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('archived-session-s1')).toBeNull();
    });
    expect(listSessionsSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(toast.success).toHaveBeenCalledWith('聊天已删除');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('删除失败 toast 提示,对话框保留可重试', async () => {
    const { removeSessionSpy } = renderWithArchived({
      archived: [makeArchivedSession('s1', '霓虹城市', ARCHIVED_AT)],
      removeMode: 'error',
    });
    await expand();
    await screen.findByTestId('archived-session-s1');

    fireEvent.click(screen.getByTestId('archived-remove-s1'));
    fireEvent.click(await screen.findByTestId('archived-remove-confirm'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('REMOVE_FAILED');
    });
    // 失败不关框、行仍在,取消可退出。
    expect(screen.getByTestId('archived-remove-confirm')).toBeTruthy();
    expect(screen.getByTestId('archived-session-s1')).toBeTruthy();
    expect(removeSessionSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByTestId('archived-remove-confirm')).toBeNull();
    });
  });
});

describe('formatArchivedAt(归档时间恒带年份)', () => {
  it('输出包含年份与时分', () => {
    const text = formatArchivedAt('2024-03-05T06:30:00.000Z');
    expect(text).toContain('2024');
    expect(text).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('resolveThemeClass', () => {
  it('resolves explicit and system themes', () => {
    expect(resolveThemeClass('dark', false)).toBe('dark');
    expect(resolveThemeClass('light', true)).toBeNull();
    expect(resolveThemeClass('system', true)).toBe('dark');
    expect(resolveThemeClass('system', false)).toBeNull();
  });
});

describe('MotionSync(动效分级投影到 <html>)', () => {
  function renderMotionSync(level: AppPreferences['reducedMotion']) {
    const { gateway } = createTestGateway({ preferences: { reducedMotion: level } });
    return renderSettingsTree(gateway, <MotionSync />);
  }

  function renderSettingsTree(gateway: MusefoldGateway, node: ReactNode) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {node}
        </PlatformProvider>
      </QueryClientProvider>,
    );
  }

  it('on → 挂 reduce-motion class 与 data-motion 标记', async () => {
    const view = renderMotionSync('on');
    await waitFor(() => {
      expect(document.documentElement.classList.contains('reduce-motion')).toBe(true);
    });
    expect(document.documentElement.dataset.motion).toBe('on');
    view.unmount();
  });

  it('off / system → 摘 class,data-motion 表达档位', async () => {
    const offView = renderMotionSync('off');
    await waitFor(() => {
      expect(document.documentElement.dataset.motion).toBe('off');
    });
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(false);
    offView.unmount();

    const systemView = renderMotionSync('system');
    await waitFor(() => {
      expect(document.documentElement.dataset.motion).toBe('system');
    });
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(false);
    systemView.unmount();
  });
});
