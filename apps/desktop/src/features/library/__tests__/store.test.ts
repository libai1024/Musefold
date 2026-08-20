import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptGateway } from '@musefold/domain';
import type { DesktopExtras } from '@musefold/desktop-contracts/desktop-extras';
import type { Prompt } from '@musefold/desktop-contracts/models';
import { desktopGateway } from '../../../runtime';
import {
  DESKTOP_SYNTHETIC_ENTITY_VERSION,
  promptRowToDocument,
} from '../../../runtime/mappers';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  listDeleted: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  restore: vi.fn(),
  incrementUsage: vi.fn(),
  togglePin: vi.fn(),
  reorderPins: vi.fn(),
  purge: vi.fn(),
  purgeAll: vi.fn(),
  searchHistoryList: vi.fn(),
  searchHistoryAdd: vi.fn(),
  searchHistoryClear: vi.fn(),
}));

vi.mock('../../../lib/ipc', () => ({
  default: {
    prompt: {
      list: mocks.list,
      stats: mocks.stats,
      listDeleted: mocks.listDeleted,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.delete,
      restore: mocks.restore,
      incrementUsage: mocks.incrementUsage,
      togglePin: mocks.togglePin,
      reorderPins: mocks.reorderPins,
      purge: mocks.purge,
      purgeAll: mocks.purgeAll,
    },
    searchHistory: {
      list: mocks.searchHistoryList,
      add: mocks.searchHistoryAdd,
      clear: mocks.searchHistoryClear,
    },
  },
}));

import {
  setLibraryDesktopExtrasForTests,
  setLibraryPromptGatewayForTests,
  useLibraryStore,
} from '../store';

const EMPTY_STATS = {
  total: 0,
  unfiled: 0,
  trashed: 0,
  pinned: 0,
  byFolder: {},
  byTag: {},
};

function makePrompt(patch: Partial<Prompt> = {}): Prompt {
  return {
    id: 'prompt-1',
    title: '雨巷海报',
    description: '湿润空气',
    content: 'cinematic rain alley poster',
    contentNegative: 'blur, watermark',
    folderId: 'folder-1',
    modelId: 'gpt-image-2',
    params: { schemaVersion: 1, size: '1024x1024' },
    previewImagePath: '/tmp/preview.png',
    coverImagePath: '/tmp/cover.png',
    rating: 4,
    isPinned: false,
    pinOrder: null,
    usageCount: 7,
    lastUsedAt: 1_721_000_000_000,
    source: 'manual',
    sourceUrl: null,
    tags: [
      {
        id: 'tag-ink',
        name: '水墨',
        tagGroup: '风格',
        color: '#aabbcc',
        createdAt: 1_720_000_000_000,
      },
    ],
    createdAt: 1_719_000_000_000,
    updatedAt: 1_722_000_000_000,
    deletedAt: null,
    ...patch,
  };
}

function unusedGatewayMethod(name: string) {
  return vi.fn(async () => {
    throw new Error(`${name} 不应被 library store 调用`);
  });
}

function unusedExtrasMethod(name: string) {
  return vi.fn(async () => {
    throw new Error(`${name} 不应被 library store 调用`);
  });
}

function createFakeGateway(): PromptGateway {
  return {
    listPrompts: unusedGatewayMethod('listPrompts'),
    getPrompt: unusedGatewayMethod('getPrompt'),
    createPrompt: unusedGatewayMethod('createPrompt'),
    updatePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    restorePrompt: vi.fn(),
    usePrompt: vi.fn(),
  };
}

function createFakeExtras(): DesktopExtras {
  return {
    listLibraryPrompts: vi.fn(),
    listDeletedLibraryPrompts: vi.fn(),
    libraryStats: vi.fn(),
    createLibraryPrompt: vi.fn(),
    toggleLibraryPin: vi.fn(),
    reorderLibraryPins: vi.fn(),
    purgeLibraryPrompt: vi.fn(),
    purgeLibraryPrompts: vi.fn(),
    listSearchHistory: vi.fn(),
    addSearchHistory: vi.fn(),
    clearSearchHistory: vi.fn(),
    accountStatus: unusedExtrasMethod('accountStatus'),
    accountRegister: unusedExtrasMethod('accountRegister'),
    accountLogin: unusedExtrasMethod('accountLogin'),
    accountLogout: unusedExtrasMethod('accountLogout'),
    accountRedeem: unusedExtrasMethod('accountRedeem'),
    accountRefreshQuota: unusedExtrasMethod('accountRefreshQuota'),
    accountSetServerUrl: unusedExtrasMethod('accountSetServerUrl'),
    onAccountChanged: vi.fn(() => {
      throw new Error('onAccountChanged 不应被 library store 调用');
    }),
    cloudSyncStatus: unusedExtrasMethod('cloudSyncStatus'),
    cloudSyncSetEnabled: unusedExtrasMethod('cloudSyncSetEnabled'),
    cloudSyncNow: unusedExtrasMethod('cloudSyncNow'),
    cloudSyncConflicts: unusedExtrasMethod('cloudSyncConflicts'),
    cloudSyncResolve: unusedExtrasMethod('cloudSyncResolve'),
    onCloudSyncChanged: vi.fn(() => {
      throw new Error('onCloudSyncChanged 不应被 library store 调用');
    }),
  };
}

function resetStore(patch: Partial<ReturnType<typeof useLibraryStore.getState>> = {}): void {
  useLibraryStore.setState({
    prompts: [],
    stats: EMPTY_STATS,
    searchHistory: [],
    deleted: [],
    search: '',
    filters: {},
    sort: 'updated',
    sortDir: 'desc',
    loading: false,
    initialized: false,
    error: null,
    selectedPromptId: null,
    trashOpen: false,
    highlightPromptId: null,
    ...patch,
  });
}

let gateway: PromptGateway;
let extras: DesktopExtras;

beforeEach(() => {
  vi.clearAllMocks();
  gateway = createFakeGateway();
  extras = createFakeExtras();
  setLibraryPromptGatewayForTests(gateway);
  setLibraryDesktopExtrasForTests(extras);
  vi.mocked(extras.listLibraryPrompts).mockResolvedValue([]);
  vi.mocked(extras.libraryStats).mockResolvedValue(EMPTY_STATS);
  vi.mocked(extras.listDeletedLibraryPrompts).mockResolvedValue([]);
  vi.mocked(extras.listSearchHistory).mockResolvedValue([]);
  resetStore();
});

afterEach(() => {
  setLibraryPromptGatewayForTests(desktopGateway);
  setLibraryDesktopExtrasForTests(desktopGateway);
});

describe('library store PromptGateway wiring', () => {
  it('loadAll lists via extras.listLibraryPrompts, not PromptGateway.listPrompts', async () => {
    const row = makePrompt();
    vi.mocked(extras.listLibraryPrompts).mockResolvedValue([row]);

    await useLibraryStore.getState().loadAll();

    expect(extras.listLibraryPrompts).toHaveBeenCalledOnce();
    expect(gateway.listPrompts).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().prompts).toEqual([row]);
  });

  it('createPrompt goes through extras.createLibraryPrompt and never calls gateway.createPrompt', async () => {
    const created = makePrompt({ id: 'new-1', title: '新条目' });
    vi.mocked(extras.createLibraryPrompt).mockResolvedValue(created);
    vi.mocked(extras.listLibraryPrompts).mockResolvedValue([created]);

    const result = await useLibraryStore.getState().createPrompt({
      title: '新条目',
      content: 'cinematic rain alley poster',
    });

    expect(extras.createLibraryPrompt).toHaveBeenCalledWith({
      title: '新条目',
      content: 'cinematic rain alley poster',
    });
    expect(gateway.createPrompt).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(extras.listLibraryPrompts).toHaveBeenCalled();
    expect(result?.id).toBe('new-1');
    expect(useLibraryStore.getState().selectedPromptId).toBe('new-1');
  });

  it('createPrompt forwards previewImagePath to extras.createLibraryPrompt as-is', async () => {
    const created = makePrompt({
      id: 'slip-1',
      title: '笺',
      previewImagePath: '/tmp/slip.png',
      source: 'slip',
    });
    vi.mocked(extras.createLibraryPrompt).mockResolvedValue(created);
    vi.mocked(extras.listLibraryPrompts).mockResolvedValue([created]);

    const input = {
      title: '笺',
      content: 'a slip of paper',
      previewImagePath: '/tmp/slip.png',
      source: 'slip' as const,
    };
    const result = await useLibraryStore.getState().createPrompt(input);

    expect(extras.createLibraryPrompt).toHaveBeenCalledWith(input);
    expect(gateway.createPrompt).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(result?.previewImagePath).toBe('/tmp/slip.png');
  });

  it('createPrompt failure keeps the existing list intact', async () => {
    const existing = makePrompt();
    resetStore({ prompts: [existing] });
    vi.mocked(extras.createLibraryPrompt).mockRejectedValue(new Error('创建被拒'));

    const result = await useLibraryStore.getState().createPrompt({
      title: '失败条目',
      content: 'will not land',
    });

    expect(result).toBeNull();
    expect(gateway.createPrompt).not.toHaveBeenCalled();
    expect(extras.createLibraryPrompt).toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().prompts).toEqual([existing]);
    expect(useLibraryStore.getState().error).toBe('创建被拒');
  });

  it('updatePrompt goes through gateway and keeps previous cover paths', async () => {
    const prev = makePrompt();
    resetStore({ prompts: [prev] });
    const returned = promptRowToDocument(
      makePrompt({ title: '改名', previewImagePath: null, coverImagePath: null }),
    );
    vi.mocked(gateway.updatePrompt).mockResolvedValue(returned);

    const result = await useLibraryStore.getState().updatePrompt('prompt-1', { title: '改名' });

    expect(gateway.updatePrompt).toHaveBeenCalledWith(
      'prompt-1',
      expect.objectContaining({
        title: '改名',
        expectedVersion: DESKTOP_SYNTHETIC_ENTITY_VERSION,
      }),
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(result?.title).toBe('改名');
    expect(result?.previewImagePath).toBe('/tmp/preview.png');
    expect(result?.coverImagePath).toBe('/tmp/cover.png');
    expect(useLibraryStore.getState().prompts[0]?.previewImagePath).toBe('/tmp/preview.png');
    expect(useLibraryStore.getState().prompts[0]?.coverImagePath).toBe('/tmp/cover.png');
  });

  it('updatePrompt rolls the list back when the gateway rejects', async () => {
    const prev = makePrompt();
    resetStore({ prompts: [prev] });
    vi.mocked(gateway.updatePrompt).mockRejectedValue(new Error('保存被拒'));

    const result = await useLibraryStore.getState().updatePrompt('prompt-1', { title: '改名' });

    expect(result).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().prompts).toEqual([prev]);
    expect(useLibraryStore.getState().error).toBe('保存被拒');
  });

  it('deletePrompt goes through gateway with synthetic version and does not call api.prompt.delete', async () => {
    const prev = makePrompt();
    resetStore({ prompts: [prev], selectedPromptId: prev.id });
    vi.mocked(gateway.deletePrompt).mockResolvedValue(
      promptRowToDocument(makePrompt({ deletedAt: 1_900_000_000_000 })),
    );

    const ok = await useLibraryStore.getState().deletePrompt('prompt-1');

    expect(ok).toBe(true);
    expect(gateway.deletePrompt).toHaveBeenCalledWith(
      'prompt-1',
      DESKTOP_SYNTHETIC_ENTITY_VERSION,
    );
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().prompts).toEqual([]);
    expect(useLibraryStore.getState().selectedPromptId).toBeNull();
  });

  it('deletePrompt rolls the list and selection back when the gateway rejects', async () => {
    const prev = makePrompt();
    resetStore({ prompts: [prev], selectedPromptId: prev.id });
    vi.mocked(gateway.deletePrompt).mockRejectedValue(new Error('删除被拒'));

    const ok = await useLibraryStore.getState().deletePrompt('prompt-1');

    expect(ok).toBe(false);
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().prompts).toEqual([prev]);
    expect(useLibraryStore.getState().selectedPromptId).toBe('prompt-1');
    expect(useLibraryStore.getState().error).toBe('删除被拒');
  });

  it('restorePrompt goes through gateway and never calls api.prompt.restore', async () => {
    const trashed = makePrompt({ deletedAt: 1_900_000_000_000 });
    const restored = makePrompt({ deletedAt: null });
    resetStore({ deleted: [trashed], prompts: [] });
    vi.mocked(gateway.restorePrompt).mockResolvedValue(promptRowToDocument(restored));
    vi.mocked(extras.listLibraryPrompts).mockResolvedValue([restored]);

    await useLibraryStore.getState().restorePrompt('prompt-1');

    expect(gateway.restorePrompt).toHaveBeenCalledWith(
      'prompt-1',
      DESKTOP_SYNTHETIC_ENTITY_VERSION,
    );
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(extras.listLibraryPrompts).toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().deleted).toEqual([]);
    expect(useLibraryStore.getState().prompts).toEqual([restored]);
  });

  it('copyContent uses gateway.usePrompt and never calls api.prompt.incrementUsage', async () => {
    const prev = makePrompt();
    resetStore({ prompts: [prev] });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.mocked(gateway.usePrompt).mockResolvedValue({
      prompt: promptRowToDocument(
        makePrompt({
          usageCount: 8,
          lastUsedAt: 1_910_000_000_000,
          previewImagePath: null,
          coverImagePath: null,
        }),
      ),
      recorded: true,
    });

    const ok = await useLibraryStore.getState().copyContent('prompt-1');

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith(prev.content);
    expect(gateway.usePrompt).toHaveBeenCalledWith('prompt-1', { action: 'copy' });
    expect(mocks.incrementUsage).not.toHaveBeenCalled();
    const next = useLibraryStore.getState().prompts[0];
    expect(next?.usageCount).toBe(8);
    expect(next?.previewImagePath).toBe('/tmp/preview.png');
    expect(next?.coverImagePath).toBe('/tmp/cover.png');
    vi.unstubAllGlobals();
  });
});
