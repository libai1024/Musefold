import type {
  AppInfo,
  AppPreferences,
  BackupInfo,
  StorageLocation,
  UpdateWorkbenchSession,
  WorkbenchSession,
  WorkbenchSessionListQuery,
} from '@musefold/contracts';
import {
  CLEAR_ALL_DATA_CONFIRMATION,
  defaultAppPreferences,
  thirdPartyNoticeSchema,
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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenIntent } from '../../shell/screen-intent-store';
import { PRODUCT_SHORTCUTS } from '../../shell/shortcuts';
import { formatArchivedAt } from '../ArchivedSessionsPanel';
import { DensitySync } from '../DensitySync';
import { resolveThemeClass } from '../hooks';
import { MotionSync } from '../MotionSync';
import {
  availableSettingsSections,
  filterSettingsSections,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  sectionForIntent,
} from '../sections';
import { useSettingsNav } from '../settings-nav-store';
import { SettingsScreen, type SettingsScreenProps } from '../SettingsScreen';
import { THIRD_PARTY_NOTICES } from '../third-party-notices';

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

const DESKTOP_APP_INFO: AppInfo = {
  version: '2.5.0',
  platform: 'darwin',
  arch: 'arm64',
  schemaVersion: 7,
  channel: 'stable',
};

function makeBackup(file: string, createdAt: string, size = 2_097_152): BackupInfo {
  return { file, size, createdAt, kind: 'manual' };
}

const STORAGE_LOCATIONS: StorageLocation[] = [
  { id: 'database', label: '数据库', displayPath: '/Users/tester/Musefold/data.db' },
  { id: 'backups', label: '备份目录', displayPath: '/Users/tester/Musefold/backups' },
];

interface SystemStubOptions {
  appInfo?: AppInfo;
  appInfoMode?: CallMode;
  backups?: BackupInfo[];
  backupsMode?: CallMode;
  createMode?: CallMode;
  restoreMode?: CallMode | 'restart-required';
  locationsMode?: CallMode;
  openMode?: CallMode;
  logText?: string;
  logMode?: CallMode;
  clearMode?: CallMode;
}

/** 桌面 system 域内存桩:备份列表随「立即备份」增长,方法模式可逐个切 pending/error。 */
function createSystemStub(options: SystemStubOptions) {
  const backups = [...(options.backups ?? [])];
  const spies = {
    getAppInfo: vi.fn(async () => {
      if (options.appInfoMode === 'error') throw new Error('APP_INFO_FAILED');
      return options.appInfo ?? DESKTOP_APP_INFO;
    }),
    listBackups: vi.fn(() => {
      if (options.backupsMode === 'pending') return new Promise<BackupInfo[]>(() => {});
      if (options.backupsMode === 'error') return Promise.reject(new Error('BACKUP_LIST_FAILED'));
      return Promise.resolve([...backups]);
    }),
    createBackup: vi.fn(() => {
      if (options.createMode === 'pending') return new Promise<never>(() => {});
      if (options.createMode === 'error') return Promise.reject(new Error('磁盘空间不足'));
      const backup = makeBackup('backup-20260906-120000-000-manual.db', '2026-09-06T12:00:00.000Z');
      backups.unshift(backup);
      return Promise.resolve({ backup });
    }),
    restoreBackup: vi.fn((input: { file: string }) => {
      if (options.restoreMode === 'error') return Promise.reject(new Error('备份文件损坏'));
      if (options.restoreMode === 'restart-required')
        return Promise.reject(
          Object.assign(new Error('恢复未完成,请重启应用并核对备份'), { code: 'RESTORE_FAILED' }),
        );
      return Promise.resolve({
        safetyBackupFile: `safety-${input.file}`,
        needsRestart: true as const,
      });
    }),
    listStorageLocations: vi.fn(() => {
      if (options.locationsMode === 'pending') return new Promise<StorageLocation[]>(() => {});
      if (options.locationsMode === 'error') return Promise.reject(new Error('目录不可读'));
      return Promise.resolve(STORAGE_LOCATIONS);
    }),
    openStorageLocation: vi.fn(() =>
      options.openMode === 'error'
        ? Promise.reject(new Error('目录已不存在'))
        : Promise.resolve(undefined),
    ),
    readDiagnosticLog: vi.fn(() => {
      if (options.logMode === 'pending') return new Promise<never>(() => {});
      if (options.logMode === 'error') return Promise.reject(new Error('LOG_FAILED'));
      return Promise.resolve({ text: options.logText ?? '', truncated: false });
    }),
    clearAllData: vi.fn(() =>
      options.clearMode === 'error'
        ? Promise.reject(new Error('数据库被占用'))
        : Promise.resolve({ safetyBackupFile: 'backup-20260906-115900-000-pre-reset.db' }),
    ),
    openExternal: vi.fn(async () => undefined),
    openProductDocs: vi.fn(async () => undefined),
    relaunch: vi.fn(async () => undefined),
  };
  return spies;
}

function createTestGateway(overrides?: {
  accountRejects?: boolean;
  preferences?: Partial<AppPreferences>;
  preferencesMode?: CallMode;
  archived?: WorkbenchSession[];
  listByCursor?: Record<string, { items: WorkbenchSession[]; nextCursor: string | null }>;
  listMode?: CallMode;
  updateMode?: CallMode;
  removeMode?: CallMode;
  /** 桌面本机数据域;缺省即宿主不提供(Web 形态)。 */
  system?: SystemStubOptions;
}): {
  gateway: MusefoldGateway;
  updateSpy: ReturnType<typeof vi.fn>;
  getPreferencesSpy: ReturnType<typeof vi.fn>;
  listSessionsSpy: ReturnType<typeof vi.fn>;
  updateSessionSpy: ReturnType<typeof vi.fn>;
  removeSessionSpy: ReturnType<typeof vi.fn>;
  system: ReturnType<typeof createSystemStub> | null;
  resolveHeldUpdate(): void;
  resolveHeldRemove(): void;
} {
  let preferences: AppPreferences = {
    ...defaultAppPreferences,
    ...overrides?.preferences,
  };
  const updateSpy = vi.fn(async (patch: Partial<AppPreferences>) => {
    preferences = { ...preferences, ...patch };
    return preferences;
  });
  const getPreferencesSpy = vi.fn(async () => {
    if (overrides?.preferencesMode === 'error') throw new Error('PREFERENCES_FAILED');
    if (overrides?.preferencesMode === 'pending') return new Promise<AppPreferences>(() => {});
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
    if (overrides?.listByCursor) {
      const cursor = typeof query.cursor === 'string' ? query.cursor : '';
      return Promise.resolve(overrides.listByCursor[cursor] ?? { items: [], nextCursor: null });
    }
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

  const system = overrides?.system ? createSystemStub(overrides.system) : null;

  const gateway = {
    settings: {
      getPreferences: getPreferencesSpy,
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
    agentConnections: {
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
    cloudMcp: {
      listAuthorizations: async () => ({ items: [] }),
      revokeAuthorization: vi.fn(async (input: { clientId: string }) => ({
        revoked: true as const,
        clientId: input.clientId,
      })),
    },
    ...(system ? { system } : {}),
  } as unknown as MusefoldGateway;

  return {
    gateway,
    updateSpy,
    getPreferencesSpy,
    listSessionsSpy,
    updateSessionSpy,
    removeSessionSpy,
    system,
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

/** 进入某个分区(点分组导航项);分区不存在时抛错,测试据此断言可达性。 */
async function openSection(id: string) {
  fireEvent.click(await screen.findByTestId(`settings-nav-${id}`));
  await screen.findByTestId(`settings-section-${id}`);
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    useSettingsNav.setState({ activeSectionId: null });
    useScreenIntent.setState({ intent: null });
  });

  it('默认停在「外观」分区;导航按分组列出宿主可用分区(Web 无云同步/连接)', async () => {
    const { gateway } = createTestGateway();
    renderSettings(gateway, { onOpenScreen: vi.fn() });

    await screen.findByTestId('settings-section-appearance');
    expect((await screen.findByTestId('settings-theme-trigger')).textContent).toContain('跟随系统');
    expect(screen.getByTestId('settings-host-badge').textContent).toBe('Web 版');
    expect(screen.getByTestId('settings-nav-appearance').getAttribute('aria-current')).toBe('page');
    expect(
      Array.from(
        screen.getByTestId('settings-nav').querySelectorAll('[data-testid^="settings-nav-"]'),
      ).map((node) => node.getAttribute('data-testid')),
    ).toEqual([
      'settings-nav-appearance',
      'settings-nav-account',
      'settings-nav-data',
      'settings-nav-open',
      'settings-nav-usage',
      'settings-nav-about',
    ]);
    expect(screen.getByTestId('settings-group-general')).toBeTruthy();
    expect(screen.getByTestId('settings-group-access')).toBeTruthy();
    expect(screen.getByTestId('settings-group-app')).toBeTruthy();
    // 其他分区的卡不在 DOM 里:分区面板只渲染当前分区。
    expect(screen.queryByTestId('settings-account-card')).toBeNull();
  });

  it('renders account summary in the account section after loading', async () => {
    const { gateway } = createTestGateway();
    renderSettings(gateway);

    await openSection('account');
    await waitFor(() => {
      expect(screen.getByTestId('account-signed-in')).toBeTruthy();
    });
    expect(screen.getByText('测试者')).toBeTruthy();
    expect(screen.getByTestId('account-points').textContent).toBe('3 积分');
    expect(screen.getByTestId('settings-nav-account').getAttribute('aria-current')).toBe('page');
    expect(screen.queryByTestId('settings-appearance-card')).toBeNull();
  });

  it('remembers the last section across remounts and falls back when it is no longer available', async () => {
    const { gateway } = createTestGateway();
    const first = renderSettings(gateway, undefined, DESKTOP_CAPABILITIES);
    await openSection('sync');
    first.unmount();

    // 回到设置:停在上次的「云同步」。
    const second = renderSettings(gateway, undefined, DESKTOP_CAPABILITIES);
    await screen.findByTestId('settings-section-sync');
    second.unmount();

    // 宿主不再提供云同步(如 Web):兜底首个可用分区而不是空面板。
    renderSettings(gateway);
    await screen.findByTestId('settings-section-appearance');
    expect(screen.queryByTestId('settings-nav-sync')).toBeNull();
  });

  it('search filters sections by title / description / keywords and reports no match', async () => {
    const { gateway } = createTestGateway();
    renderSettings(gateway, { onOpenScreen: vi.fn() }, DESKTOP_CAPABILITIES);
    await screen.findByTestId('settings-section-appearance');

    fireEvent.change(screen.getByTestId('settings-search'), { target: { value: '比例' } });
    expect(screen.getByTestId('settings-nav-appearance')).toBeTruthy();
    expect(screen.queryByTestId('settings-nav-connections')).toBeNull();

    fireEvent.change(screen.getByTestId('settings-search'), { target: { value: '密钥' } });
    expect(screen.getByTestId('settings-nav-connections')).toBeTruthy();
    expect(screen.queryByTestId('settings-nav-appearance')).toBeNull();
    expect(screen.queryByTestId('settings-group-general')).toBeNull();
    // 当前分区被过滤掉时面板仍保留,不闪空。
    expect(screen.getByTestId('settings-section-appearance')).toBeTruthy();

    fireEvent.change(screen.getByTestId('settings-search'), { target: { value: 'ZZZ' } });
    expect(screen.getByTestId('settings-search-empty').textContent).toContain('ZZZ');

    fireEvent.change(screen.getByTestId('settings-search'), { target: { value: '' } });
    expect(screen.getByTestId('settings-nav-appearance')).toBeTruthy();
  });

  it('mobile flow: back button returns to the section list and the nav shows chevrons only below md', async () => {
    const { gateway } = createTestGateway();
    renderSettings(gateway);
    await openSection('account');
    // 二级面板打开后导航在移动端隐藏(md+ 仍常驻,由 class 表达)。
    expect(screen.getByTestId('settings-nav').className).toContain('hidden md:flex');
    fireEvent.click(screen.getByTestId('settings-section-back'));
    expect(screen.getByTestId('settings-nav').className).not.toContain('hidden');
    expect(screen.getByTestId('settings-section-account').className).toContain('hidden md:flex');
  });

  it('updates motion level through the three-option toggle group', async () => {
    const { gateway, updateSpy } = createTestGateway();
    renderSettings(gateway);

    const trigger = await screen.findByTestId('settings-motion-trigger');
    expect(trigger.textContent).toContain('跟随系统');

    fireEvent.click(await screen.findByTestId('settings-motion-on'));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ reducedMotion: 'on' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-motion-on').getAttribute('data-state')).toBe('on');
    });
  });

  it('renders generation defaults and writes ratio / quality', async () => {
    const { gateway, updateSpy } = createTestGateway();
    renderSettings(gateway);

    await screen.findByTestId('settings-generation-defaults-card');
    const ratioTrigger = await screen.findByTestId('settings-default-ratio-trigger');
    expect(ratioTrigger.textContent).toContain('auto');

    fireEvent.keyDown(screen.getByTestId('settings-default-ratio-trigger'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByTestId('settings-default-ratio-16x9'));
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ defaultAspectRatio: '16:9' });
    });

    fireEvent.click(screen.getByTestId('settings-default-quality-high'));
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ defaultQuality: 'high' });
    });
  });

  it('默认张数行:maxGenerationCount > 1 时渲染 1/2/4 并写偏好(§9-D3)', async () => {
    const { gateway, updateSpy } = createTestGateway();
    renderSettings(gateway);

    const group = await screen.findByTestId('settings-default-count');
    expect([...group.querySelectorAll('[data-slot="toggle-group-item"]')]).toHaveLength(3);
    expect(screen.getByTestId('settings-default-count-1').getAttribute('data-state')).toBe('on');

    fireEvent.click(screen.getByTestId('settings-default-count-4'));
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ defaultCount: 4 });
    });
  });

  it('宿主 maxGenerationCount === 1:默认张数行整块不渲染(不留死控件,D2)', async () => {
    const { gateway } = createTestGateway();
    renderSettings(gateway, undefined, { ...WEB_CAPABILITIES, maxGenerationCount: 1 });

    await screen.findByTestId('settings-default-quality');
    expect(screen.queryByTestId('settings-default-count')).toBeNull();
  });

  it('consumes density tokens on the page, nav, and setting rows', async () => {
    const { gateway } = createTestGateway();
    renderSettings(gateway);
    await screen.findByTestId('settings-screen');
    expect(screen.getByTestId('settings-screen').className).toContain('--density-page-padding');
    expect(screen.getByTestId('settings-nav-appearance').className).toContain('--density-nav-y');
    await screen.findByTestId('settings-theme-trigger');
    expect(screen.getByTestId('settings-theme-trigger').parentElement?.className).toContain(
      '--density-setting-row-y',
    );
    expect(screen.getByTestId('settings-default-quality').parentElement?.className).toContain(
      '--density-setting-row-y',
    );
  });

  it('writes density preference from the two-option toggle group', async () => {
    const { gateway, updateSpy } = createTestGateway();
    renderSettings(gateway);

    fireEvent.click(await screen.findByTestId('settings-density-compact'));
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ density: 'compact' });
    });
  });

  it('shows dynamic theme and motion hints after mount', async () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches:
        query.includes('prefers-color-scheme: dark') || query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })) as typeof window.matchMedia;

    const { gateway } = createTestGateway();
    renderSettings(gateway);

    await waitFor(() => {
      expect(screen.getByTestId('settings-theme-hint').textContent).toContain('当前为深色');
    });
    expect(screen.getByTestId('settings-motion-hint').textContent).toContain('当前:减少动效');
  });

  it('shows a retry button when preferences fail to load', async () => {
    const { gateway, getPreferencesSpy } = createTestGateway({ preferencesMode: 'error' });
    renderSettings(gateway);

    expect(await screen.findByTestId('settings-preferences-retry')).toBeTruthy();
    expect(screen.getAllByText('偏好读取失败,请重试').length).toBeGreaterThan(0);
    const callsBefore = getPreferencesSpy.mock.calls.length;
    fireEvent.click(screen.getByTestId('settings-preferences-retry'));
    await waitFor(() => {
      expect(getPreferencesSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('shows signed-out hint when account status is unavailable', async () => {
    const { gateway } = createTestGateway({ accountRejects: true });
    renderSettings(gateway);

    await openSection('account');
    await waitFor(() => {
      expect(screen.getByTestId('settings-account-signed-out')).toBeTruthy();
    });
  });

  it('consumes sidebar deep-link intents: opens the target section and highlights the panel', async () => {
    useScreenIntent.setState({ intent: { kind: 'settings-account' } });
    const { gateway } = createTestGateway();
    const { unmount } = renderSettings(gateway);

    const panel = await screen.findByTestId('settings-section-account');
    expect(panel.className).toContain('ring-2');
    expect(screen.getByTestId('settings-account-anchor')).toBeTruthy();
    expect(useScreenIntent.getState().intent).toBeNull();
    // 深链直接进二级面板(移动端不停在列表)。
    expect(panel.className).not.toContain('hidden');
    unmount();

    // 桌面:connections 意图落到「AI 连接」分区。
    useScreenIntent.setState({ intent: { kind: 'settings-connections' } });
    const desktop = renderSettings(gateway, undefined, DESKTOP_CAPABILITIES);
    await screen.findByTestId('settings-section-connections');
    expect(screen.getByTestId('settings-connections-anchor')).toBeTruthy();
    expect(useScreenIntent.getState().intent).toBeNull();
    desktop.unmount();

    // Web 无连接分区:connections 意图兜底到账号分区,不悬空。
    useScreenIntent.setState({ intent: { kind: 'settings-connections' } });
    renderSettings(gateway);
    await screen.findByTestId('settings-section-account');
    expect(screen.queryByTestId('settings-connections-anchor')).toBeNull();
    expect(useScreenIntent.getState().intent).toBeNull();
  });

  it('consumes settings-section intent and optionally highlights a testid', async () => {
    useScreenIntent.setState({
      intent: { kind: 'settings-section', section: 'account', highlight: 'settings-account-card' },
    });
    const { gateway } = createTestGateway();
    renderSettings(gateway);

    const panel = await screen.findByTestId('settings-section-account');
    expect(panel.className).toContain('ring-2');
    const card = await screen.findByTestId('settings-account-card');
    expect(card.getAttribute('data-settings-highlight')).toBe('true');
    expect(useScreenIntent.getState().intent).toBeNull();
  });

  it('shows the doubao login card only when the desktop capability is on', async () => {
    const { gateway } = createTestGateway();
    const desktop = renderSettings(gateway, undefined, DESKTOP_CAPABILITIES);
    // 桌面:「AI 连接」分区内含生图连接卡 + Agent 连接卡 + 豆包免费试用卡(未登录给扫码入口)。
    await openSection('connections');
    await screen.findByTestId('settings-doubao-card');
    expect(screen.getByTestId('settings-connections-anchor')).toBeTruthy();
    expect(screen.getByTestId('settings-ai-connections-card')).toBeTruthy();
    expect(screen.getByTestId('settings-agent-connections-card')).toBeTruthy();
    expect(await screen.findByTestId('doubao-login-start')).toBeTruthy();
    desktop.unmount();

    // Web:能力关闭,连接分区整个不注册(导航无入口,深链兜底账号)。
    renderSettings(gateway);
    await screen.findByTestId('settings-screen');
    expect(screen.queryByTestId('settings-nav-connections')).toBeNull();
    expect(screen.queryByTestId('settings-nav-sync')).toBeNull();
    expect(screen.queryByTestId('settings-doubao-card')).toBeNull();
    expect(screen.queryByTestId('settings-agent-connections-card')).toBeNull();
  });

  it('agent connections card follows hasAgentConnections independently of image providers', async () => {
    const { gateway } = createTestGateway();
    renderSettings(gateway, undefined, {
      ...DESKTOP_CAPABILITIES,
      hasLocalAiProviders: false,
      hasDoubaoWebLogin: false,
    });
    await openSection('connections');
    await screen.findByTestId('settings-agent-connections-card');
    expect(screen.getByTestId('settings-connections-anchor')).toBeTruthy();
    expect(screen.queryByTestId('settings-ai-connections-card')).toBeNull();
  });

  it('data section opens prompt trash via screen intent; not registered without onOpenScreen', async () => {
    const { gateway } = createTestGateway();
    const onOpenScreen = vi.fn();
    const { unmount } = renderSettings(gateway, { onOpenScreen });

    await openSection('data');
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
    useSettingsNav.setState({ activeSectionId: null });
    renderSettings(gateway);
    await screen.findByTestId('settings-appearance-card');
    expect(screen.queryByTestId('settings-nav-data')).toBeNull();
    expect(screen.queryByTestId('settings-data-card')).toBeNull();
  });
});

describe('settings section registry(sections.tsx)', () => {
  it('every section has a group in SETTINGS_GROUPS and unique ids; intents map to registered sections', () => {
    const groupIds = new Set(SETTINGS_GROUPS.map((group) => group.id));
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of SETTINGS_SECTIONS) {
      expect(groupIds.has(section.group)).toBe(true);
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.description.length).toBeGreaterThan(0);
    }
    const desktop = availableSettingsSections({
      capabilities: DESKTOP_CAPABILITIES,
      onOpenScreen: vi.fn(),
    });
    expect(desktop.map((section) => section.id)).toEqual([
      'appearance',
      'account',
      'sync',
      'connections',
      'data',
      'open',
      'usage',
      'about',
    ]);
    expect(sectionForIntent('settings-connections', desktop)).toBe('connections');
    const web = availableSettingsSections({ capabilities: WEB_CAPABILITIES });
    // 「关于」双端都注册(Web 版本行显示「Web 版」);「数据」要宿主接了切屏回调才注册。
    expect(web.map((section) => section.id)).toEqual([
      'appearance',
      'account',
      'open',
      'usage',
      'about',
    ]);
    expect(sectionForIntent('settings-connections', web)).toBe('account');
    expect(filterSettingsSections(desktop, '豆包').map((section) => section.id)).toEqual([
      'connections',
    ]);
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
    // 归档面板住「数据」分区:直接从记忆落到该分区,不经导航点击。
    useSettingsNav.setState({ activeSectionId: 'data' });
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
    expect(listSessionsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ archivedOnly: true, limit: 100 }),
    );
  });

  it('消费 nextCursor:加载更多带上 cursor,计数在还有下一页时显示 N+', async () => {
    const first = makeArchivedSession('s1', '第一页', ARCHIVED_AT);
    const second = makeArchivedSession('s2', '第二页', '2026-01-20T09:15:00.000Z');
    const { listSessionsSpy } = renderWithArchived({
      listByCursor: {
        '': { items: [first], nextCursor: 'c2' },
        c2: { items: [second], nextCursor: null },
      },
    });

    expect((await screen.findByTestId('archived-count')).textContent).toBe('1+');
    await expand();
    expect(await screen.findByTestId('archived-session-s1')).toBeTruthy();
    expect(screen.queryByTestId('archived-session-s2')).toBeNull();

    fireEvent.click(screen.getByTestId('archived-load-more'));
    expect(await screen.findByTestId('archived-session-s2')).toBeTruthy();
    expect(listSessionsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ archivedOnly: true, limit: 100, cursor: 'c2' }),
    );
    expect(screen.getByTestId('archived-count').textContent).toBe('2');
    expect(screen.queryByTestId('archived-load-more')).toBeNull();
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
    expect(listSessionsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ archivedOnly: true, limit: 100 }),
    );
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

describe('DataStorageCard(设置·数据存储,桌面本机数据面)', () => {
  const writeText = vi.fn(async (_text: string) => undefined);

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  function renderData(system: SystemStubOptions = {}) {
    const utils = createTestGateway({ system });
    useSettingsNav.setState({ activeSectionId: 'data' });
    renderSettings(utils.gateway, { onOpenScreen: vi.fn() }, DESKTOP_CAPABILITIES);
    return utils;
  }

  it('Web 宿主(hasLocalDataManagement=false):只有回收站与归档,四块本机数据面不渲染', async () => {
    const { gateway } = createTestGateway();
    useSettingsNav.setState({ activeSectionId: 'data' });
    renderSettings(gateway, { onOpenScreen: vi.fn() }, WEB_CAPABILITIES);

    await screen.findByTestId('settings-data-card');
    expect(screen.getByTestId('archived-toggle')).toBeTruthy();
    expect(screen.queryByTestId('settings-backup-card')).toBeNull();
    expect(screen.queryByTestId('settings-storage-card')).toBeNull();
    expect(screen.queryByTestId('settings-danger-card')).toBeNull();
  });

  it('备份状态行三态:读取中 / 暂无备份 / 共 n 份 · 最近备份', async () => {
    renderData({ backupsMode: 'pending' });
    expect((await screen.findByTestId('settings-backup-status')).textContent).toBe('正在读取备份…');
    cleanup();

    renderData({ backups: [] });
    await waitFor(() => {
      expect(screen.getByTestId('settings-backup-status').textContent).toBe('暂无备份');
    });
    expect(screen.queryByTestId('settings-backup-toggle')).toBeNull();
    cleanup();

    renderData({
      backups: [
        makeBackup('backup-20260906-101500-000-manual.db', '2026-09-06T10:15:00.000Z'),
        makeBackup('backup-20260901-080000-000-manual.db', '2026-09-01T08:00:00.000Z'),
      ],
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-backup-status').textContent).toContain('共 2 份');
    });
    expect(screen.getByTestId('settings-backup-status').textContent).toContain('最近备份');
  });

  it('读取失败就地红字;创建失败单独报错', async () => {
    renderData({ backupsMode: 'error' });
    expect((await screen.findByTestId('settings-backup-error')).textContent).toContain(
      'BACKUP_LIST_FAILED',
    );
    cleanup();

    renderData({ backups: [], createMode: 'error' });
    fireEvent.click(await screen.findByTestId('settings-backup-create'));
    expect((await screen.findByTestId('settings-backup-create-error')).textContent).toContain(
      '磁盘空间不足',
    );
  });

  it('立即备份:toast 一致性快照文案,新备份直接展开可见', async () => {
    const { system } = renderData({ backups: [] });
    await screen.findByTestId('settings-backup-create');
    // 列表默认收起(且此时无备份可展开)。
    expect(screen.queryByTestId('settings-backup-list')).toBeNull();

    fireEvent.click(screen.getByTestId('settings-backup-create'));
    await waitFor(() => {
      expect(system?.createBackup).toHaveBeenCalledTimes(1);
    });
    expect(toast.success).toHaveBeenCalledWith('当前数据库已保存为一致性快照');
    // 就近反馈:创建后自动展开,新备份行与「大小 · 时间」同行可见。
    const row = await screen.findByTestId(
      'settings-backup-row-backup-20260906-120000-000-manual.db',
    );
    expect(row.textContent).toContain('2.0 MB');
    expect(screen.getByTestId('settings-backup-status').textContent).toContain('共 1 份');
  });

  it('恢复:确认对话框 → 成功后调 relaunch;取消不调用主进程', async () => {
    const file = 'backup-20260906-101500-000-manual.db';
    const { system } = renderData({ backups: [makeBackup(file, '2026-09-06T10:15:00.000Z')] });

    fireEvent.click(await screen.findByTestId('settings-backup-toggle'));
    fireEvent.click(await screen.findByTestId(`settings-backup-restore-${file}`));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('恢复此备份?')).toBeTruthy();
    expect(dialog.textContent).toContain('当前数据将被该备份覆盖,应用将重启');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(system?.restoreBackup).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId(`settings-backup-restore-${file}`));
    fireEvent.click(await screen.findByTestId('settings-backup-restore-confirm'));
    await waitFor(() => {
      expect(system?.restoreBackup).toHaveBeenCalledWith({ file });
    });
    await waitFor(() => {
      expect(system?.relaunch).toHaveBeenCalledTimes(1);
    });
    expect(toast.success).toHaveBeenCalledWith('备份已恢复,应用即将重启');
  });

  it('恢复失败:就地红字,不重启,对话框保留可重试', async () => {
    const file = 'backup-20260906-101500-000-manual.db';
    const { system } = renderData({
      backups: [makeBackup(file, '2026-09-06T10:15:00.000Z')],
      restoreMode: 'error',
    });

    fireEvent.click(await screen.findByTestId('settings-backup-toggle'));
    fireEvent.click(await screen.findByTestId(`settings-backup-restore-${file}`));
    fireEvent.click(await screen.findByTestId('settings-backup-restore-confirm'));

    expect((await screen.findByTestId('settings-backup-restore-error')).textContent).toContain(
      '备份文件损坏',
    );
    expect(system?.relaunch).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-backup-restore-confirm')).toBeTruthy();
  });

  it('恢复隔离失败后关闭确认框并提供显式重启，不能继续提交恢复或创建备份', async () => {
    const file = 'backup-20260906-101500-000-manual.db';
    const { system } = renderData({
      backups: [makeBackup(file, '2026-09-06T10:15:00.000Z')],
      restoreMode: 'restart-required',
    });
    fireEvent.click(await screen.findByTestId('settings-backup-toggle'));
    fireEvent.click(await screen.findByTestId(`settings-backup-restore-${file}`));
    fireEvent.click(await screen.findByTestId('settings-backup-restore-confirm'));
    const restart = await screen.findByTestId('settings-backup-restart');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((screen.getByTestId('settings-backup-create') as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByTestId(`settings-backup-restore-${file}`) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(system?.relaunch).not.toHaveBeenCalled();
    fireEvent.click(restart);
    await waitFor(() => expect(system?.relaunch).toHaveBeenCalledOnce());
  });

  it('存储位置:路径行 mono、复制路径与打开;读取失败就地报错', async () => {
    const { system } = renderData({});
    await screen.findByTestId('settings-storage-row-database');
    expect(screen.getByTestId('settings-storage-path-database').textContent).toBe(
      '/Users/tester/Musefold/data.db',
    );
    expect(screen.getByTestId('settings-storage-path-database').className).toContain('font-mono');

    fireEvent.click(screen.getByTestId('settings-storage-copy-database'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('/Users/tester/Musefold/data.db');
    });
    expect(toast.success).toHaveBeenCalledWith('路径已复制');

    fireEvent.click(screen.getByTestId('settings-storage-open-backups'));
    await waitFor(() => {
      expect(system?.openStorageLocation).toHaveBeenCalledWith({ id: 'backups' });
    });
    cleanup();

    renderData({ locationsMode: 'error' });
    expect((await screen.findByTestId('settings-storage-error')).textContent).toContain(
      '目录不可读',
    );
  });

  it('诊断日志:点「查看」才读取;空日志与失败各有文案', async () => {
    const { system } = renderData({ logText: '2026-09-06 12:00:00 [info] 启动完成' });
    await screen.findByTestId('settings-log-toggle');
    expect(system?.readDiagnosticLog).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('settings-log-toggle'));
    const text = (await screen.findByTestId('settings-log-text')) as HTMLTextAreaElement;
    expect(text.value).toContain('启动完成');
    expect(text.readOnly).toBe(true);
    cleanup();

    renderData({ logText: '' });
    fireEvent.click(await screen.findByTestId('settings-log-toggle'));
    expect(await screen.findByTestId('settings-log-empty')).toBeTruthy();
    cleanup();

    renderData({ logMode: 'error' });
    fireEvent.click(await screen.findByTestId('settings-log-toggle'));
    expect(await screen.findByTestId('settings-log-error')).toBeTruthy();
  });

  it('危险区:短语不匹配禁用,匹配后转 destructive 并执行;成功 toast 含边界文案', async () => {
    const { system } = renderData({});
    const button = (await screen.findByTestId('settings-danger-clear')) as HTMLButtonElement;
    const input = screen.getByTestId('settings-danger-confirm-input') as HTMLInputElement;
    expect(button.disabled).toBe(true);
    expect(input.placeholder).toBe(CLEAR_ALL_DATA_CONFIRMATION);
    expect(input.className).toContain('font-mono');

    fireEvent.change(input, { target: { value: '清空数据' } });
    expect((screen.getByTestId('settings-danger-clear') as HTMLButtonElement).disabled).toBe(true);

    // 粘贴同形:整串写入即解锁,按钮转危险填充。
    fireEvent.change(input, { target: { value: CLEAR_ALL_DATA_CONFIRMATION } });
    expect((screen.getByTestId('settings-danger-clear') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('settings-danger-clear').getAttribute('data-variant')).toBe(
      'destructive',
    );

    fireEvent.click(screen.getByTestId('settings-danger-clear'));
    await waitFor(() => {
      expect(system?.clearAllData).toHaveBeenCalledWith({
        confirmation: CLEAR_ALL_DATA_CONFIRMATION,
      });
    });
    expect(toast.success).toHaveBeenCalledWith('数据已清空 · Provider、API 密钥和图片文件保持不变');
    // 执行后短语清空(不留着一键再清一次),并显示清空前快照文件名。
    await waitFor(() => {
      expect((screen.getByTestId('settings-danger-confirm-input') as HTMLInputElement).value).toBe(
        '',
      );
    });
    expect(screen.getByTestId('settings-danger-backup').textContent).toContain('pre-reset');
  });

  it('危险区失败:就地红字「清空数据失败」', async () => {
    renderData({ clearMode: 'error' });
    const input = await screen.findByTestId('settings-danger-confirm-input');
    fireEvent.change(input, { target: { value: CLEAR_ALL_DATA_CONFIRMATION } });
    fireEvent.click(screen.getByTestId('settings-danger-clear'));

    const error = await screen.findByTestId('settings-danger-error');
    expect(error.textContent).toContain('清空数据失败');
    expect(error.textContent).toContain('数据库被占用');
  });
});

describe('AboutCard(设置·关于)', () => {
  const writeText = vi.fn(async (_text: string) => undefined);

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  function renderAbout(options?: { system?: SystemStubOptions }) {
    const utils = createTestGateway(options);
    useSettingsNav.setState({ activeSectionId: 'about' });
    renderSettings(
      utils.gateway,
      { onOpenScreen: vi.fn() },
      options?.system ? DESKTOP_CAPABILITIES : WEB_CAPABILITIES,
    );
    return utils;
  }

  it('桌面:版本行含版本 / 库结构 / 平台,复制版本信息聚合报障串', async () => {
    renderAbout({ system: {} });
    const version = await screen.findByTestId('settings-about-version');
    await waitFor(() => {
      expect(version.textContent).toContain('版本 2.5.0');
    });
    expect(version.textContent).toContain('库结构 v7');
    expect(version.textContent).toContain('macOS');
    expect(version.className).toContain('tabular-nums');

    fireEvent.click(screen.getByTestId('settings-about-copy-version'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain('2.5.0');
    expect(copied).toContain('darwin arm64');
    expect(copied).toContain('数据库结构版本:7');
    expect(copied).toContain('更新通道:stable');
    expect(toast.success).toHaveBeenCalledWith('版本信息已复制');
  });

  it('Web:版本行显示「Web 版」,不渲染文档入口(无 system 域)', async () => {
    renderAbout();
    expect((await screen.findByTestId('settings-about-version')).textContent).toBe('Web 版');
    expect(screen.queryByTestId('settings-about-docs')).toBeNull();
    expect(screen.getByTestId('settings-about-product').textContent).toContain('Musefold');

    fireEvent.click(screen.getByTestId('settings-about-copy-version'));
    await waitFor(() => {
      expect(writeText.mock.calls[0]?.[0] ?? '').toContain('Web 版');
    });
  });

  it('支持资源:文档经主进程打开(失败 toast),复制反馈信息带日志指引', async () => {
    const { system } = renderAbout({ system: {} });
    fireEvent.click(await screen.findByTestId('settings-about-docs'));
    await waitFor(() => {
      expect(system?.openProductDocs).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('settings-about-copy-feedback'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText.mock.calls[0]?.[0] ?? '').toContain('诊断日志');
    expect(toast.success).toHaveBeenCalledWith('可连同诊断日志一起发送给维护者');
  });

  it('文档打开失败提示「文档打开失败」', async () => {
    const utils = createTestGateway({ system: {} });
    utils.system?.openProductDocs.mockRejectedValueOnce(new Error('DOCS_OPEN_FAILED'));
    useSettingsNav.setState({ activeSectionId: 'about' });
    renderSettings(utils.gateway, { onOpenScreen: vi.fn() }, DESKTOP_CAPABILITIES);

    fireEvent.click(await screen.findByTestId('settings-about-docs'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('文档打开失败');
    });
  });

  it('第三方声明:对话框可打开且逐条渲染许可', async () => {
    renderAbout();
    fireEvent.click(await screen.findByTestId('settings-about-notices'));
    const dialog = await screen.findByTestId('settings-about-notices-dialog');
    expect(THIRD_PARTY_NOTICES.length).toBeGreaterThan(0);
    for (const notice of THIRD_PARTY_NOTICES) {
      expect(within(dialog).getByTestId(`settings-about-notice-${notice.name}`)).toBeTruthy();
    }
  });

  it('快捷键表:PRODUCT_SHORTCUTS 每条渲染,按平台切 ⌘/Ctrl 显示与作用域', async () => {
    renderAbout({ system: {} });
    await screen.findByTestId('settings-about-shortcuts-card');
    for (const shortcut of PRODUCT_SHORTCUTS) {
      const row = screen.getByTestId(`settings-about-shortcut-${shortcut.id}`);
      expect(row.textContent).toContain(shortcut.label);
      expect(row.textContent).toContain(shortcut.scope);
    }
    // 桌面 darwin:mac 串。
    await waitFor(() => {
      expect(screen.getByTestId('settings-about-shortcut-new-session').textContent).toContain('⌘N');
    });
    cleanup();

    renderAbout({ system: { appInfo: { ...DESKTOP_APP_INFO, platform: 'win32', arch: 'x64' } } });
    await waitFor(() => {
      expect(screen.getByTestId('settings-about-shortcut-new-session').textContent).toContain(
        'Ctrl+N',
      );
    });
  });
});

describe('第三方声明清单(third-party-notices.ts)', () => {
  it('逐条符合契约形状,名称唯一且按名排序', () => {
    for (const notice of THIRD_PARTY_NOTICES) {
      expect(thirdPartyNoticeSchema.parse(notice)).toEqual(notice);
    }
    const names = THIRD_PARTY_NOTICES.map((notice) => notice.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names]).toEqual([...names].sort((a, b) => a.localeCompare(b)));
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

describe('DensitySync(密度投影到 <html>)', () => {
  function renderDensitySync(density: AppPreferences['density']) {
    const { gateway } = createTestGateway({ preferences: { density } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          <DensitySync />
        </PlatformProvider>
      </QueryClientProvider>,
    );
  }

  it('compact / comfortable → data-density', async () => {
    const compact = renderDensitySync('compact');
    await waitFor(() => {
      expect(document.documentElement.dataset.density).toBe('compact');
    });
    compact.unmount();

    const comfortable = renderDensitySync('comfortable');
    await waitFor(() => {
      expect(document.documentElement.dataset.density).toBe('comfortable');
    });
    comfortable.unmount();
  });
});
