import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopExtras } from '@musefold/desktop-contracts/desktop-extras';
import type { AccountStatus } from '@musefold/desktop-contracts/account';
import { DEFAULT_ACCOUNT_SERVER_URL } from '@musefold/domain/constants';
import { desktopGateway } from '../../../runtime';

const managed = vi.hoisted(() => ({
  loadProviders: vi.fn(async () => undefined),
  loadAi: vi.fn(async () => undefined),
}));

vi.mock('../../generation/store', () => ({
  useGenerationStore: {
    getState: () => ({ loadProviders: managed.loadProviders }),
  },
}));

vi.mock('../../settings/ai-connection-store', () => ({
  useAiConnectionStore: {
    getState: () => ({ load: managed.loadAi }),
  },
}));

import { desktopQueryClient } from '../../../runtime/query-client';
import {
  getAccountDesktopExtras,
  setAccountDesktopExtrasForTests,
  useAccountStore,
} from '../store';

const storeSource = readFileSync(new URL('../store.ts', import.meta.url), 'utf8');

const EMPTY_STATUS: AccountStatus = {
  loggedIn: false,
  userId: null,
  username: null,
  serverUrl: DEFAULT_ACCOUNT_SERVER_URL,
  isDefaultServer: true,
  quota: null,
  estImagesRemaining: null,
  deviceTokenSuffix: null,
  health: 'unknown',
  notices: [],
};

const loggedIn: AccountStatus = {
  ...EMPTY_STATUS,
  loggedIn: true,
  userId: '7',
  username: 'alice',
  quota: { value: 1000, at: 1 },
  health: 'ok',
  deviceTokenSuffix: 'ab12',
};

function unused(name: string) {
  return vi.fn(async () => {
    throw new Error(`${name} 不应被 account store 调用`);
  });
}

function createFakeExtras(): DesktopExtras {
  return {
    listLibraryPrompts: unused('listLibraryPrompts'),
    getLibraryPrompt: unused('getLibraryPrompt'),
    listDeletedLibraryPrompts: unused('listDeletedLibraryPrompts'),
    libraryStats: unused('libraryStats'),
    createLibraryPrompt: unused('createLibraryPrompt'),
    toggleLibraryPin: unused('toggleLibraryPin'),
    reorderLibraryPins: unused('reorderLibraryPins'),
    purgeLibraryPrompt: unused('purgeLibraryPrompt'),
    purgeLibraryPrompts: unused('purgeLibraryPrompts'),
    listSearchHistory: unused('listSearchHistory'),
    addSearchHistory: unused('addSearchHistory'),
    clearSearchHistory: unused('clearSearchHistory'),
    listAiConnectionPresets: unused('listAiConnectionPresets'),
    listAiConnections: unused('listAiConnections'),
    createAiConnection: unused('createAiConnection'),
    updateAiConnection: unused('updateAiConnection'),
    deleteAiConnection: unused('deleteAiConnection'),
    saveAiConnectionKey: unused('saveAiConnectionKey'),
    deleteAiConnectionKey: unused('deleteAiConnectionKey'),
    hasAiConnectionKey: unused('hasAiConnectionKey'),
    setActiveAiConnection: unused('setActiveAiConnection'),
    listAiConnectionModels: unused('listAiConnectionModels'),
    validateAiConnection: unused('validateAiConnection'),
    relatedHistory: unused('relatedHistory'),
    linkHistoryPrompt: unused('linkHistoryPrompt'),
    listHistory: unused('listHistory'),
    getHistory: unused('getHistory'),
    historyStats: unused('historyStats'),
    deleteHistory: unused('deleteHistory'),
    clearHistory: unused('clearHistory'),
    getSystemVersion: unused('getSystemVersion'),
    listProviders: unused('listProviders'),
    createProvider: unused('createProvider'),
    updateProvider: unused('updateProvider'),
    deleteProvider: unused('deleteProvider'),
    saveProviderKey: unused('saveProviderKey'),
    hasProviderKey: unused('hasProviderKey'),
    setActiveProvider: unused('setActiveProvider'),
    validateProvider: unused('validateProvider'),
    listProviderModels: unused('listProviderModels'),
    accountStatus: vi.fn(),
    accountRegister: vi.fn(),
    accountLogin: vi.fn(),
    accountLogout: vi.fn(),
    accountRedeem: vi.fn(),
    accountRefreshQuota: vi.fn(),
    accountSetServerUrl: vi.fn(),
    onAccountChanged: vi.fn(() => () => {}),
    cloudSyncStatus: unused('cloudSyncStatus'),
    cloudSyncSetEnabled: unused('cloudSyncSetEnabled'),
    cloudSyncNow: unused('cloudSyncNow'),
    cloudSyncConflicts: unused('cloudSyncConflicts'),
    cloudSyncResolve: unused('cloudSyncResolve'),
    onCloudSyncChanged: vi.fn(() => {
      throw new Error('onCloudSyncChanged 不应被 account store 调用');
    }),
    listDesktopWorkbenchSessions: unused('listDesktopWorkbenchSessions'),
    getDesktopWorkbenchSession: unused('getDesktopWorkbenchSession'),
    onImageGenerationProgress: vi.fn(() => {
      throw new Error('onImageGenerationProgress 不应被 account store 调用');
    }),
  };
}

function resetStore(): void {
  useAccountStore.setState({
    status: EMPTY_STATUS,
    loaded: false,
    loading: false,
    action: null,
    error: null,
    lastUsername: null,
  });
}

let extras: DesktopExtras;

beforeEach(() => {
  vi.clearAllMocks();
  desktopQueryClient.clear();
  extras = createFakeExtras();
  setAccountDesktopExtrasForTests(extras);
  resetStore();
});

afterEach(() => {
  setAccountDesktopExtrasForTests(desktopGateway);
});

describe('account store DesktopExtras wiring', () => {
  it('不再经 lib/ipc 的 api.account，登录登出走 extras', () => {
    expect(storeSource).not.toContain("from '../../lib/ipc'");
    expect(storeSource).not.toContain('api.account');
    expect(storeSource).toContain('accountLogin');
    expect(storeSource).toContain('accountLogout');
    expect(storeSource).toContain('onAccountChanged');
  });

  it('login 走 extras.accountLogin 并回写桌面 AccountStatus', async () => {
    vi.mocked(extras.accountLogin).mockResolvedValue(loggedIn);

    const result = await useAccountStore.getState().login({
      username: 'alice',
      password: 'secret',
    });

    expect(extras.accountLogin).toHaveBeenCalledWith({
      username: 'alice',
      password: 'secret',
    });
    expect(result).toEqual(loggedIn);
    expect(result).toHaveProperty('deviceTokenSuffix', 'ab12');
    expect(result).not.toHaveProperty('csrfToken');
    expect(useAccountStore.getState()).toMatchObject({
      status: loggedIn,
      lastUsername: 'alice',
      action: null,
      loaded: true,
      error: null,
    });
    expect(managed.loadProviders).toHaveBeenCalledOnce();
    expect(managed.loadAi).toHaveBeenCalledOnce();
  });

  it('logout 走 extras.accountLogout 并保留 lastUsername', async () => {
    useAccountStore.setState({ status: loggedIn, lastUsername: 'alice' });
    vi.mocked(extras.accountLogout).mockResolvedValue(EMPTY_STATUS);

    const result = await useAccountStore.getState().logout();

    expect(extras.accountLogout).toHaveBeenCalledOnce();
    expect(result).toEqual(EMPTY_STATUS);
    expect(useAccountStore.getState()).toMatchObject({
      status: EMPTY_STATUS,
      lastUsername: 'alice',
      action: null,
    });
    expect(managed.loadProviders).toHaveBeenCalledOnce();
    expect(managed.loadAi).toHaveBeenCalledOnce();
  });

  it('initialize 订阅 extras.onAccountChanged 并拉取 accountStatus', async () => {
    vi.mocked(extras.accountStatus).mockResolvedValue(loggedIn);

    await useAccountStore.getState().initialize();

    expect(extras.onAccountChanged).toHaveBeenCalledOnce();
    expect(extras.accountStatus).toHaveBeenCalledOnce();
    expect(useAccountStore.getState().status).toEqual(loggedIn);
    expect(getAccountDesktopExtras()).toBe(extras);
  });
});
