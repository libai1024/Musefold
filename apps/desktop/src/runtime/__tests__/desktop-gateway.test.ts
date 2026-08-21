import { describe, expect, it, vi } from 'vitest';
import type { McpConnectionPage, NewPromptDocument } from '@musefold/contracts';
import type {
  HistoryLinkPromptRequest,
  ListPromptsQuery,
  RelatedHistoryQuery,
  UpdatePromptPatch,
} from '@musefold/desktop-contracts/ipc';
import type { HistoryRecord, NewPrompt, Prompt } from '@musefold/desktop-contracts/models';
import type {
  EnsureWorkbenchSessionCommand,
  WorkbenchSession,
  WorkbenchSessionDocument,
  WorkbenchSessionListQuery,
} from '@musefold/desktop-contracts/workbench';
import type { AccountStatus } from '@musefold/desktop-contracts/account';
import type {
  CloudSyncConflictResolution,
  CloudSyncSummary,
} from '@musefold/desktop-contracts/cloud-sync';
import {
  createDesktopGateway,
  DesktopGatewayError,
  DesktopGatewayNotImplementedError,
  type WindowApi,
} from '../index';
import {
  pickReversiblePromptRow,
  promptDocumentToRow,
  promptRowToDocument,
} from '../mappers/prompt';

function promptRow(id: string, patch: Partial<Prompt> = {}): Prompt {
  return {
    id,
    title: `标题 ${id}`,
    description: null,
    content: `body ${id}`,
    contentNegative: 'blur',
    folderId: null,
    modelId: null,
    params: { schemaVersion: 1 },
    previewImagePath: `/tmp/${id}-preview.png`,
    coverImagePath: `/tmp/${id}-cover.png`,
    rating: 0,
    isPinned: false,
    pinOrder: null,
    usageCount: 0,
    lastUsedAt: null,
    source: 'manual',
    sourceUrl: null,
    tags: [
      {
        id: 'tag-1',
        name: '风景',
        tagGroup: '场景',
        color: '#112233',
        createdAt: 1_700_000_000_000,
      },
    ],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    deletedAt: null,
    ...patch,
  };
}

function historyRow(id: string, patch: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id,
    promptId: null,
    providerId: 'prov',
    model: 'gpt-image-2',
    promptText: 'a cat',
    negativeText: null,
    params: { schemaVersion: 1, size: '1024x1024', quality: 'auto' },
    status: 'success',
    errorCode: null,
    errorMessage: null,
    imagePath: `/tmp/${id}.png`,
    cost: 10,
    costUnit: 'point',
    durationMs: 100,
    createdAt: 1_728_000_000_000,
    ...patch,
  };
}

function sessionRow(id: string, patch: Partial<WorkbenchSession> = {}): WorkbenchSession {
  return {
    id,
    title: `对话 ${id}`,
    createdAt: 1_000,
    updatedAt: 2_000,
    archivedAt: null,
    deletedAt: null,
    ...patch,
  };
}

const emptyConnections: McpConnectionPage = { items: [] };

const loggedOut: AccountStatus = {
  loggedIn: false,
  username: null,
  serverUrl: 'https://example',
  isDefaultServer: true,
  quota: null,
  estImagesRemaining: null,
  deviceTokenSuffix: null,
  health: 'unknown',
  notices: [],
};

const loggedIn: AccountStatus = {
  ...loggedOut,
  loggedIn: true,
  username: 'alice',
  quota: { value: 1000, at: 1 },
  health: 'ok',
};

const idleCloudSync: CloudSyncSummary = {
  available: true,
  unavailableReason: null,
  status: 'idle',
  account: {
    ownerId: 'alice',
    username: 'alice',
    deviceName: 'Mac',
    enabled: true,
    lastSyncAt: null,
    lastError: null,
  },
  pendingMutations: 0,
  conflicts: 0,
};

function createFakeApi() {
  const prompts = new Map<string, Prompt>();
  const histories = new Map<string, HistoryRecord>();
  const sessions = new Map<string, WorkbenchSession>();
  let promptSeq = 0;
  let account = { ...loggedOut };

  const list = vi.fn(async (_q?: ListPromptsQuery) =>
    [...prompts.values()].filter((row) => row.deletedAt == null),
  );
  const create = vi.fn(async (input: NewPrompt) => {
    const id = `p-${++promptSeq}`;
    const now = 1_800_000_000_000;
    const row = promptRow(id, {
      title: input.title,
      content: input.content,
      contentNegative: input.contentNegative ?? null,
      description: input.description ?? null,
      isPinned: input.isPinned ?? false,
      folderId: input.folderId ?? null,
      modelId: input.modelId ?? null,
      params: input.params ?? null,
      rating: input.rating ?? 0,
      source: input.source ?? 'manual',
      sourceUrl: input.sourceUrl ?? null,
      tags: (input.tagIds ?? []).map((tagId: string) => ({
        id: tagId,
        name: tagId,
        tagGroup: null,
        color: null,
        createdAt: now,
      })),
      previewImagePath: input.previewImagePath ?? null,
      coverImagePath: null,
      createdAt: now,
      updatedAt: now,
    });
    prompts.set(id, row);
    return row;
  });
  const update = vi.fn(async (id: string, patch: UpdatePromptPatch) => {
    const existing = prompts.get(id);
    if (!existing) throw new Error('missing');
    const next: Prompt = {
      ...existing,
      title: patch.title ?? existing.title,
      description: patch.description !== undefined ? patch.description : existing.description,
      content: patch.content ?? existing.content,
      contentNegative:
        patch.contentNegative !== undefined ? patch.contentNegative : existing.contentNegative,
      isPinned: patch.isPinned ?? existing.isPinned,
      folderId: patch.folderId !== undefined ? patch.folderId : existing.folderId,
      modelId: patch.modelId !== undefined ? patch.modelId : existing.modelId,
      params: patch.params !== undefined ? patch.params : existing.params,
      rating: patch.rating ?? existing.rating,
      source: patch.source ?? existing.source,
      updatedAt: existing.updatedAt + 1,
    };
    prompts.set(id, next);
    return next;
  });
  const incrementUsage = vi.fn(async (id: string) => {
    const existing = prompts.get(id);
    if (existing) {
      prompts.set(id, {
        ...existing,
        usageCount: existing.usageCount + 1,
        lastUsedAt: 1_910_000_000_000,
      });
    }
    return { ok: true as const };
  });
  const ensure = vi.fn(async (command: EnsureWorkbenchSessionCommand) => {
    const row = sessionRow(command.id, { title: command.title });
    sessions.set(row.id, row);
    return row;
  });
  const logout = vi.fn(async () => {
    account = { ...loggedOut };
    return account;
  });
  const accountStatus = vi.fn(async () => account);
  const accountRegister = vi.fn(async (input: { username: string; password: string }) => {
    account = { ...loggedIn, username: input.username };
    return account;
  });
  const accountLogin = vi.fn(async (input: { username: string; password: string }) => {
    account = { ...loggedIn, username: input.username };
    return account;
  });
  const accountRedeem = vi.fn(async () => ({ quotaAdded: 100, status: account }));
  const accountRefreshQuota = vi.fn(async () => account);
  const accountSetServerUrl = vi.fn(async (url: string) => {
    account = { ...account, serverUrl: url };
    return account;
  });
  const accountOnChanged = vi.fn((_cb: (status: AccountStatus) => void) => () => undefined);
  const cloudSyncStatus = vi.fn(async () => idleCloudSync);
  const cloudSyncSetEnabled = vi.fn(async () => idleCloudSync);
  const cloudSyncNow = vi.fn(async () => idleCloudSync);
  const cloudSyncConflicts = vi.fn(async () => []);
  const cloudSyncResolve = vi.fn(async () => idleCloudSync);
  const cloudSyncOnChanged = vi.fn((_cb: (status: CloudSyncSummary) => void) => () => undefined);
  const historyList = vi.fn(async (query?: { limit?: number; offset?: number }) => {
    const all = [...histories.values()];
    const offset = query?.offset ?? 0;
    const limit = query?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  });
  const historyRelated = vi.fn(async (_q: RelatedHistoryQuery) => ({
    items: [] as HistoryRecord[],
    total: 0,
  }));
  const historyLinkPrompt = vi.fn(async (_req: HistoryLinkPromptRequest) => ({
    linked: 0,
    alreadyLinked: 0,
    conflicts: [] as string[],
    missing: [] as string[],
  }));
  const getVersion = vi.fn(async () => ({ app: '0.0.0-test', db: 10 }));

  const api = {
    prompt: {
      list,
      listDeleted: async () => [...prompts.values()].filter((row) => row.deletedAt != null),
      get: async (id: string) => prompts.get(id) ?? null,
      create,
      update,
      delete: async (id: string) => {
        const existing = prompts.get(id);
        if (existing) prompts.set(id, { ...existing, deletedAt: 1_900_000_000_000 });
        return { ok: true as const };
      },
      restore: async (id: string) => {
        const existing = prompts.get(id);
        if (!existing) throw new Error('missing');
        const next = { ...existing, deletedAt: null };
        prompts.set(id, next);
        return next;
      },
      incrementUsage,
    },
    workbenchSession: {
      list: async (query?: WorkbenchSessionListQuery) => {
        const archived = Boolean(query?.archived);
        const items = [...sessions.values()]
          .filter((row) => (archived ? row.archivedAt != null : row.archivedAt == null))
          .map((row) => ({
            ...row,
            turnCount: 0,
            runCount: 0,
            latestAssetPath: null,
            conversationKind: 'chat' as const,
            latestStatus: null,
          }));
        return {
          items,
          total: items.length,
          limit: query?.limit ?? 200,
          offset: query?.offset ?? 0,
        };
      },
      get: async (id: string): Promise<WorkbenchSessionDocument | null> => {
        const session = sessions.get(id);
        return session ? { session, runs: [] } : null;
      },
      ensure,
      delete: async (id: string) => {
        const existing = sessions.get(id);
        if (!existing) throw new Error('missing');
        const next = { ...existing, deletedAt: 3_000 };
        sessions.set(id, next);
        return next;
      },
    },
    history: {
      list: historyList,
      related: historyRelated,
      linkPrompt: historyLinkPrompt,
      get: async (id: string) => histories.get(id) ?? null,
      delete: async (req: string | { id: string }) => {
        const id = typeof req === 'string' ? req : req.id;
        histories.delete(id);
        return { ok: true as const, deleted: 1 };
      },
    },
    system: {
      getVersion,
    },
    image: {
      cancel: async (jobId: string) => {
        const row = histories.get(jobId);
        if (row) histories.set(jobId, { ...row, status: 'cancelled' });
        return { ok: true as const };
      },
      retry: async (historyId: string) => {
        const row = histories.get(historyId);
        if (!row) throw new Error('missing');
        const next = historyRow(`${historyId}-retry`, { promptText: row.promptText });
        histories.set(next.id, next);
        return { historyId: next.id, status: 'success' as const };
      },
    },
    account: {
      status: accountStatus,
      register: accountRegister,
      login: accountLogin,
      logout,
      redeem: accountRedeem,
      refreshQuota: accountRefreshQuota,
      setServerUrl: accountSetServerUrl,
      onChanged: accountOnChanged,
    },
    cloudSync: {
      status: cloudSyncStatus,
      setEnabled: cloudSyncSetEnabled,
      syncNow: cloudSyncNow,
      conflicts: cloudSyncConflicts,
      resolve: cloudSyncResolve,
      onChanged: cloudSyncOnChanged,
    },
    cloudConnections: {
      list: async () => emptyConnections,
      update: async () => emptyConnections,
      revoke: async () => undefined,
    },
  } as unknown as WindowApi;

  return {
    api,
    prompts,
    histories,
    sessions,
    create,
    list,
    update,
    incrementUsage,
    ensure,
    logout,
    accountStatus,
    accountRegister,
    accountLogin,
    accountRedeem,
    accountRefreshQuota,
    accountSetServerUrl,
    accountOnChanged,
    cloudSyncStatus,
    cloudSyncSetEnabled,
    cloudSyncNow,
    cloudSyncConflicts,
    cloudSyncResolve,
    cloudSyncOnChanged,
    historyList,
    historyRelated,
    historyLinkPrompt,
    getVersion,
  };
}

const newDoc: NewPromptDocument = {
  title: '新提示词',
  description: 'desc',
  content: 'a paper lantern',
  negative: 'text',
  folderId: null,
  tagIds: ['tag-x'],
  modelId: null,
  params: { schemaVersion: 1 },
  rating: 1,
  isPinned: false,
  source: 'manual',
  sourceUrl: null,
};

describe('DesktopGateway PromptGateway', () => {
  it('covers CRUD, restore, use, pagination and reversible round-trip through IPC', async () => {
    const fake = createFakeApi();
    const gateway = createDesktopGateway(fake.api);
    fake.prompts.set('seed-a', promptRow('seed-a'));
    fake.prompts.set('seed-b', promptRow('seed-b', { title: '第二' }));
    fake.prompts.set('seed-c', promptRow('seed-c', { title: '第三' }));

    const page = await gateway.listPrompts({ limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('2');

    const created = await gateway.createPrompt(newDoc);
    expect(fake.create).toHaveBeenCalledWith(
      expect.objectContaining({ contentNegative: 'text', folderId: undefined }),
    );
    expect(created.negative).toBe('text');
    expect(created.version).toBe(1);

    const fetched = await gateway.getPrompt(created.id);
    expect(fetched.id).toBe(created.id);
    const stored = fake.prompts.get(created.id);
    expect(stored).toBeDefined();
    expect(pickReversiblePromptRow(promptDocumentToRow(promptRowToDocument(stored!)))).toEqual(
      pickReversiblePromptRow(stored!),
    );

    const updated = await gateway.updatePrompt(created.id, {
      expectedVersion: 99,
      title: '改过',
      negative: 'lowres',
    });
    expect(updated.title).toBe('改过');
    expect(updated.negative).toBe('lowres');
    expect(fake.update.mock.calls[0][1]).not.toHaveProperty('expectedVersion');

    const deleted = await gateway.deletePrompt(created.id, 1);
    expect(deleted.deletedAt).not.toBeNull();
    const restored = await gateway.restorePrompt(created.id, 1);
    expect(restored.deletedAt).toBeNull();

    const used = await gateway.usePrompt(created.id, { action: 'copy' });
    expect(used.recorded).toBe(true);
    expect(used.prompt.usageCount).toBe(1);
    expect(fake.incrementUsage).toHaveBeenCalledWith(created.id);

    await expect(gateway.getPrompt('missing')).rejects.toBeInstanceOf(DesktopGatewayError);
  });
});

describe('DesktopGateway DesktopExtras', () => {
  it('forwards the complete AI connection namespace without mapping secrets into renderer state', async () => {
    const profile = { id: 'ai-1' };
    const aiConnection = {
      listPresets: vi.fn(async () => []),
      list: vi.fn(async () => [profile]),
      create: vi.fn(async () => profile),
      update: vi.fn(async () => profile),
      delete: vi.fn(async () => ({ ok: true as const })),
      saveKey: vi.fn(async () => profile),
      deleteKey: vi.fn(async () => profile),
      hasKey: vi.fn(async () => ({ hasKey: true, suffix: '1234' })),
      setActive: vi.fn(async () => profile),
      listModels: vi.fn(async () => []),
      validate: vi.fn(async () => ({ ok: true })),
    };
    const gateway = createDesktopGateway({ aiConnection } as unknown as WindowApi);
    const input = {
      name: '团队网关',
      routeKind: 'gateway' as const,
      baseUrl: 'https://example.com/v1',
      model: 'text-model',
    };

    await gateway.listAiConnectionPresets();
    await gateway.listAiConnections();
    await gateway.createAiConnection(input);
    await gateway.updateAiConnection('ai-1', { model: 'text-model-2' });
    await gateway.deleteAiConnection('ai-1');
    await gateway.saveAiConnectionKey('ai-1', 'secret');
    await gateway.deleteAiConnectionKey('ai-1');
    await gateway.hasAiConnectionKey('ai-1');
    await gateway.setActiveAiConnection('ai-1');
    await gateway.listAiConnectionModels('ai-1');
    await gateway.validateAiConnection('ai-1');

    expect(aiConnection.listPresets).toHaveBeenCalledOnce();
    expect(aiConnection.list).toHaveBeenCalledOnce();
    expect(aiConnection.create).toHaveBeenCalledWith(input);
    expect(aiConnection.update).toHaveBeenCalledWith('ai-1', { model: 'text-model-2' });
    expect(aiConnection.delete).toHaveBeenCalledWith('ai-1');
    expect(aiConnection.saveKey).toHaveBeenCalledWith('ai-1', 'secret');
    expect(aiConnection.deleteKey).toHaveBeenCalledWith('ai-1');
    expect(aiConnection.hasKey).toHaveBeenCalledWith('ai-1');
    expect(aiConnection.setActive).toHaveBeenCalledWith('ai-1');
    expect(aiConnection.listModels).toHaveBeenCalledWith('ai-1');
    expect(aiConnection.validate).toHaveBeenCalledWith('ai-1');
  });

  it('createLibraryPrompt forwards NewPrompt including previewImagePath to api.prompt.create', async () => {
    const fake = createFakeApi();
    const gateway = createDesktopGateway(fake.api);
    const input: NewPrompt = {
      title: '笺',
      content: 'a slip of paper',
      previewImagePath: '/tmp/slip.png',
      source: 'slip',
    };

    const created = await gateway.createLibraryPrompt(input);

    expect(fake.create).toHaveBeenCalledWith(input);
    expect(fake.create.mock.calls[0][0].previewImagePath).toBe('/tmp/slip.png');
    expect(created.previewImagePath).toBe('/tmp/slip.png');
    expect(created.source).toBe('slip');
    expect(created.createdAtMs).toEqual(expect.any(Number));
  });

  it('listLibraryPrompts forwards ListPromptsQuery as-is to api.prompt.list', async () => {
    const fake = createFakeApi();
    const gateway = createDesktopGateway(fake.api);
    const query: ListPromptsQuery = {
      search: '雨巷',
      folderId: 'folder-1',
      tagIds: ['tag-ink'],
      filters: { isPinned: true, source: 'slip' },
      sort: 'updated',
      sortDir: 'desc',
    };

    fake.list.mockResolvedValueOnce([promptRow('p-rain')]);
    const listed = await gateway.listLibraryPrompts(query);

    expect(fake.list).toHaveBeenCalledWith(query);
    expect(listed[0]).toMatchObject({
      id: 'p-rain',
      negative: 'blur',
      contentNegative: 'blur',
      previewImagePath: '/tmp/p-rain-preview.png',
      coverImagePath: '/tmp/p-rain-cover.png',
      createdAtMs: 1_700_000_000_000,
    });
    await expect(gateway.getLibraryPrompt('missing')).resolves.toBeNull();
  });

  it('relatedHistory / listHistory / getHistory map IPC rows to DesktopGenerationEntry', async () => {
    const fake = createFakeApi();
    fake.histories.set('h1', historyRow('h1'));
    fake.historyRelated.mockResolvedValue({ items: [historyRow('rel-1')], total: 1 });
    const gateway = createDesktopGateway(fake.api);
    const query: RelatedHistoryQuery = {
      promptId: 'prompt-1',
      status: 'success',
      limit: 40,
      offset: 0,
    };
    const linkReq: HistoryLinkPromptRequest = { promptId: 'prompt-1', historyIds: ['h1', 'h2'] };
    const listQuery = { status: 'success' as const, limit: 20 };

    const related = await gateway.relatedHistory(query);
    expect(fake.historyRelated).toHaveBeenCalledWith(query);
    expect(related.total).toBe(1);
    expect(related.items[0]).toMatchObject({
      id: 'rel-1',
      status: 'succeeded',
      imagePath: '/tmp/rel-1.png',
      providerModel: 'gpt-image-2',
    });

    await gateway.linkHistoryPrompt(linkReq);
    expect(fake.historyLinkPrompt).toHaveBeenCalledWith(linkReq);
    expect(fake.historyLinkPrompt.mock.calls[0][0]).toBe(linkReq);

    const listed = await gateway.listHistory(listQuery);
    expect(fake.historyList).toHaveBeenCalledWith(listQuery);
    expect(listed[0]).toMatchObject({
      id: 'h1',
      status: 'succeeded',
      request: expect.objectContaining({ prompt: 'a cat' }),
      createdAtMs: 1_728_000_000_000,
    });
    await expect(gateway.getHistory('missing')).resolves.toBeNull();
    await expect(gateway.getHistory('h1')).resolves.toMatchObject({
      id: 'h1',
      status: 'succeeded',
      imagePath: '/tmp/h1.png',
    });

    await expect(gateway.getSystemVersion()).resolves.toEqual({ app: '0.0.0-test', db: 10 });
    expect(fake.getVersion).toHaveBeenCalledOnce();
  });

  it('account extras forward to api.account and keep desktop AccountStatus', async () => {
    const fake = createFakeApi();
    const gateway = createDesktopGateway(fake.api);
    const credentials = { username: 'alice', password: 'secret' };

    const loggedOutStatus = await gateway.accountStatus();
    expect(loggedOutStatus).toEqual(loggedOut);
    expect(loggedOutStatus).toHaveProperty('deviceTokenSuffix');
    expect(loggedOutStatus).toHaveProperty('serverUrl');
    expect(loggedOutStatus).not.toHaveProperty('csrfToken');
    expect(fake.accountStatus).toHaveBeenCalledOnce();

    const registered = await gateway.accountRegister(credentials);
    expect(fake.accountRegister).toHaveBeenCalledWith(credentials);
    expect(registered.username).toBe('alice');
    expect(registered.loggedIn).toBe(true);
    expect(registered).toHaveProperty('notices');
    expect(registered).not.toHaveProperty('csrfToken');

    const loggedInStatus = await gateway.accountLogin(credentials);
    expect(fake.accountLogin).toHaveBeenCalledWith(credentials);
    expect(loggedInStatus.health).toBe('ok');
    expect(loggedInStatus.quota).toEqual({ value: 1000, at: 1 });

    await gateway.accountRedeem('CODE');
    expect(fake.accountRedeem).toHaveBeenCalledWith('CODE');
    await gateway.accountRefreshQuota();
    expect(fake.accountRefreshQuota).toHaveBeenCalledOnce();
    await gateway.accountSetServerUrl('https://custom');
    expect(fake.accountSetServerUrl).toHaveBeenCalledWith('https://custom');
    await gateway.accountLogout();
    expect(fake.logout).toHaveBeenCalledOnce();

    const cb = vi.fn();
    const unsub = gateway.onAccountChanged(cb);
    expect(fake.accountOnChanged).toHaveBeenCalledWith(cb);
    unsub();
  });

  it('cloudSync extras forward to api.cloudSync without mapping', async () => {
    const fake = createFakeApi();
    const gateway = createDesktopGateway(fake.api);
    const resolution: CloudSyncConflictResolution = 'local';

    await expect(gateway.cloudSyncStatus()).resolves.toEqual(idleCloudSync);
    expect(fake.cloudSyncStatus).toHaveBeenCalledOnce();
    await gateway.cloudSyncSetEnabled(true);
    expect(fake.cloudSyncSetEnabled).toHaveBeenCalledWith(true);
    await gateway.cloudSyncNow();
    expect(fake.cloudSyncNow).toHaveBeenCalledOnce();
    await gateway.cloudSyncConflicts();
    expect(fake.cloudSyncConflicts).toHaveBeenCalledOnce();
    await gateway.cloudSyncResolve('c1', resolution);
    expect(fake.cloudSyncResolve).toHaveBeenCalledWith('c1', resolution);

    const cb = vi.fn();
    const unsub = gateway.onCloudSyncChanged(cb);
    expect(fake.cloudSyncOnChanged).toHaveBeenCalledWith(cb);
    unsub();
  });
});

describe('DesktopGateway other ports', () => {
  it('implements workbench list/get/create/delete against session IPC', async () => {
    const fake = createFakeApi();
    const gateway = createDesktopGateway(fake.api);
    fake.sessions.set('s1', sessionRow('s1'));

    const listed = await gateway.listWorkbenchSessions({ limit: 10 });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].draft.prompt).toBe('');

    const created = await gateway.createWorkbenchSession({ title: '新对话' });
    expect(fake.ensure).toHaveBeenCalledWith(expect.objectContaining({ title: '新对话' }));
    const got = await gateway.getWorkbenchSession(created.id);
    expect(got.id).toBe(created.id);
    const deleted = await gateway.deleteWorkbenchSession(created.id, 1);
    expect(deleted.deletedAt).not.toBeNull();
  });

  it('keeps desktop workbench summaries, runs and native progress lossless in extras', async () => {
    const fake = createFakeApi();
    const progress = vi.fn();
    const unsubscribe = vi.fn();
    (
      fake.api.image as unknown as {
        onProgress: (cb: (value: { jobId: string; phase: 'retrying' }) => void) => () => void;
      }
    ).onProgress = vi.fn((cb) => {
      cb({ jobId: 'j1', phase: 'retrying' });
      return unsubscribe;
    });
    const gateway = createDesktopGateway(fake.api);
    fake.sessions.set('s1', sessionRow('s1'));

    const listed = await gateway.listDesktopWorkbenchSessions({ limit: 200 });
    expect(listed.items[0]).toMatchObject({ id: 's1', turnCount: 0, runCount: 0 });
    await expect(gateway.getDesktopWorkbenchSession('s1')).resolves.toMatchObject({
      session: { id: 's1' },
      runs: [],
    });
    const stop = gateway.onImageGenerationProgress(progress);
    expect(progress).toHaveBeenCalledWith({ jobId: 'j1', phase: 'retrying' });
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('implements history list/delete and generation get/cancel/retry', async () => {
    const fake = createFakeApi();
    const gateway = createDesktopGateway(fake.api);
    fake.histories.set('h1', historyRow('h1'));

    const page = await gateway.listGenerationHistory({ limit: 10 });
    expect(page.items[0].id).toBe('h1');
    expect(page.items[0].status).toBe('succeeded');

    const got = await gateway.getGeneration('h1');
    expect(got.id).toBe('h1');

    const cancelled = await gateway.cancelGeneration('h1');
    expect(cancelled.status).toBe('cancelled');

    fake.histories.set('h1', historyRow('h1'));
    const retried = await gateway.retryGeneration('h1', 'idem-1');
    expect(retried.id).toBe('h1-retry');

    const removed = await gateway.deleteGeneration('h1');
    expect(removed.deletedAt).not.toBeNull();
    expect(fake.histories.has('h1')).toBe(false);
  });

  it('maps account session methods that have a straight IPC counterpart', async () => {
    const fake = createFakeApi();
    const gateway = createDesktopGateway(fake.api);

    await expect(gateway.getSession()).rejects.toBeInstanceOf(DesktopGatewayError);
    const session = await gateway.login({ username: 'alice', password: 'secret' });
    expect(session.account.username).toBe('alice');
    expect(session.csrfToken.length).toBeGreaterThanOrEqual(32);
    await expect(gateway.getSession()).resolves.toMatchObject({ account: { username: 'alice' } });
    await gateway.logout();
    expect(fake.logout).toHaveBeenCalled();

    await expect(gateway.listConnections()).resolves.toEqual(emptyConnections);
    await expect(gateway.updateConnection('c1', { mode: 'ask_each_time' })).resolves.toEqual(
      emptyConnections,
    );
    await expect(gateway.revokeConnection('c1')).resolves.toBeUndefined();
  });
});

describe('DesktopGateway NotImplemented methods', () => {
  it('throws DesktopGatewayNotImplementedError with the method name', async () => {
    const gateway = createDesktopGateway(createFakeApi().api);
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['updateWorkbenchSession', () => gateway.updateWorkbenchSession('s', { expectedVersion: 1 })],
      ['createGeneration', () => gateway.createGeneration({ prompt: 'x' }, 'idem')],
      ['streamGenerationEvents', () => gateway.streamGenerationEvents('g', 0, () => undefined)],
      ['approveGeneration', () => gateway.approveGeneration('g', 'token')],
      ['restoreGeneration', () => gateway.restoreGeneration('h1')],
    ];

    for (const [method, run] of cases) {
      try {
        await run();
        expect.fail(`${method} should throw`);
      } catch (error) {
        expect(error).toBeInstanceOf(DesktopGatewayNotImplementedError);
        expect(error).not.toBeInstanceOf(TypeError);
        expect((error as Error).name).toBe('DesktopGatewayNotImplementedError');
        expect((error as Error).message.startsWith(`${method}:`)).toBe(true);
      }
    }
  });
});
