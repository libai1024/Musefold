// sync 域桥行为守护:登录 ≠ 同步、开启即全量跑、换账号隔离、未登录拒绝开启。
// transport 全 mock(不触网),库为内存 SQLite(core legacy 链建表)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: { getVersion: () => '2.5.0-test', getPath: () => '/tmp' },
  readSessionCredentials: vi.fn<() => Promise<{ token: string; ownerId: string | null } | null>>(),
  bindSessionOwner: vi.fn<() => Promise<void>>(),
  fetchAccountStatus: vi.fn(),
  beforeAccountChangeListeners: [] as Array<() => Promise<void> | void>,
  accountChangeCancelledListeners: [] as Array<() => Promise<void> | void>,
  accountChangedListeners: [] as Array<
    (
      status: {
        id: string;
        username: string;
        displayName: string | null;
        quota: number;
        quotaUnit: string;
        canGenerate: boolean;
      } | null,
    ) => Promise<void> | void
  >,
}));

vi.mock('electron', () => ({ app: mocks.app }));
vi.mock('../../../system/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../account-domain', () => ({
  apiBase: () => 'http://127.0.0.1:0',
  readSessionCredentials: mocks.readSessionCredentials,
  bindSessionOwner: mocks.bindSessionOwner,
  fetchAccountStatus: mocks.fetchAccountStatus,
  onBeforeAccountChange: (listener: () => Promise<void> | void) => {
    mocks.beforeAccountChangeListeners.push(listener);
  },
  onAccountChangeCancelled: (listener: () => Promise<void> | void) => {
    mocks.accountChangeCancelledListeners.push(listener);
  },
  onAccountChanged: (
    listener: (
      status: {
        id: string;
        username: string;
        displayName: string | null;
        quota: number;
        quotaUnit: string;
        canGenerate: boolean;
      } | null,
    ) => Promise<void> | void,
  ) => {
    mocks.accountChangedListeners.push(listener);
  },
}));

import type {
  PromptDocument,
  PromptFolder,
  SyncPushRequest,
  SyncUsagePushRequest,
} from '@musefold/contracts';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { ensureAccountWorkspace, resolveAccountWorkspace } from '@musefold/core/db/workspaces';
import { configureCoreRuntime } from '@musefold/core/runtime';
import {
  DesktopSyncEngine,
  DesktopSyncRepository,
  type DesktopSyncTransport,
} from '@musefold/core';
import Database from 'better-sqlite3';
import { buildSyncDomainMethods, resetSyncRuntimeForTests } from '../sync-domain';

configureCoreRuntime({
  getPaths: () => ({
    userData: '/tmp',
    db: '/tmp/unused.db',
    backups: '/tmp',
    previews: '/tmp',
    pictures: '/tmp',
    logs: '/tmp',
  }),
  loadApiKey: () => null,
  createLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
  estimateProviderCost: () => null,
});

function fakeTransport(): DesktopSyncTransport {
  return {
    registerDevice: vi.fn(async (input) => ({
      ...input,
      revoked: false,
      lastPullCursor: '0',
    })),
    bootstrap: vi.fn(async () => ({ snapshotCursor: '1', items: [], nextPage: null })),
    pull: vi.fn(async () => ({ changes: [], nextCursor: '1', hasMore: false })),
    // 本地种子数据在首轮会全量入 outbox 被推送,逐条回 applied。
    push: vi.fn(async (input: SyncPushRequest) => ({
      results: input.mutations.map((mutation, index) => ({
        mutationId: mutation.mutationId,
        status: 'applied' as const,
        version: (mutation.baseVersion ?? 0) + index + 1,
        snapshot: null,
        errorCode: null,
      })),
    })),
    pushUsage: vi.fn(async (input: SyncUsagePushRequest) => ({
      results: input.events.map((event) => ({
        eventId: event.eventId,
        status: 'applied' as const,
        errorCode: null,
      })),
    })),
  };
}

interface Harness {
  methods: Record<string, { handle(input: unknown): Promise<unknown> }>;
  repository: DesktopSyncRepository;
  transport: DesktopSyncTransport;
  transportFactory: ReturnType<typeof vi.fn>;
  db: Database.Database;
}

function setup(): Harness {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  const repository = new DesktopSyncRepository(db);
  const transport = fakeTransport();
  const transportFactory = vi.fn(() => transport);
  mocks.beforeAccountChangeListeners.length = 0;
  mocks.accountChangeCancelledListeners.length = 0;
  mocks.accountChangedListeners.length = 0;
  resetSyncRuntimeForTests({
    repository,
    engine: new DesktopSyncEngine(repository),
    transportFactory,
    getWorkspace: (ownerId) => resolveAccountWorkspace(db, ownerId),
  });
  const methods = buildSyncDomainMethods() as Harness['methods'];
  return { methods, repository, transport, transportFactory, db };
}

function remotePrompt(id: string, content: string, version: number): PromptDocument {
  const at = '2026-08-29T00:00:00.000Z';
  return {
    id,
    title: `Prompt ${id}`,
    description: null,
    content,
    negative: null,
    folderId: null,
    tags: [],
    modelId: null,
    params: null,
    rating: 0,
    isPinned: false,
    pinOrder: null,
    usageCount: 0,
    lastUsedAt: null,
    source: 'manual',
    sourceUrl: null,
    version,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}

function remoteFolder(id: string, name: string, version: number): PromptFolder {
  const at = '2026-08-29T00:00:00.000Z';
  return {
    id,
    name,
    parentId: null,
    sortOrder: 0,
    version,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}

function createPromptConflict(
  repository: DesktopSyncRepository,
  db: Database.Database,
  ownerId: string,
  promptId: string,
  localContent: string,
): string {
  const workspaceId = `account:${ownerId}`;
  repository.applyBootstrapSnapshot(
    ownerId,
    workspaceId,
    'prompt',
    remotePrompt(promptId, 'base', 1),
  );
  db.prepare('UPDATE prompts SET content = ? WHERE workspace_id = ? AND id = ?').run(
    localContent,
    workspaceId,
    promptId,
  );
  repository.enqueue(ownerId, workspaceId, 'prompt', promptId, 'update');
  repository.applyRemoteChange(ownerId, workspaceId, {
    seq: '2',
    entityType: 'prompt',
    entityId: promptId,
    operation: 'upsert',
    version: 2,
    snapshot: remotePrompt(promptId, 'remote', 2),
  });
  const conflict = repository
    .listConflicts(ownerId, workspaceId)
    .find((item) => item.entityId === promptId);
  if (!conflict) throw new Error(`conflict missing for ${promptId}`);
  return conflict.id;
}

beforeEach(() => {
  mocks.readSessionCredentials.mockReset();
  mocks.bindSessionOwner.mockReset().mockResolvedValue(undefined);
  mocks.fetchAccountStatus.mockReset();
});

describe('sync 域桥', () => {
  it('注册真实六方法并返回显式 signed_out 三态状态', async () => {
    const { methods } = setup();
    expect(Object.keys(methods).sort()).toEqual([
      'sync.getStatus',
      'sync.listConflicts',
      'sync.resolveConflict',
      'sync.setConsent',
      'sync.setEnabled',
      'sync.syncNow',
    ]);
    const status = await methods['sync.getStatus'].handle(undefined);
    expect(status).toMatchObject({
      consent: 'unset',
      phase: 'signed_out',
      enabled: false,
      state: 'disabled',
      account: null,
    });
  });

  it('未登录时拒绝首次同意(登录不等于同步,身份是前置)', async () => {
    const { methods } = setup();
    mocks.readSessionCredentials.mockResolvedValue(null);
    await expect(methods['sync.setConsent'].handle({ consent: 'enabled' })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('未 adopt 的新 owner 不创建 workspace,不发 transport 且保留可解释状态', async () => {
    const { methods, db, transport, transportFactory } = setup();
    mocks.readSessionCredentials.mockResolvedValue({ token: 'token-1', ownerId: 'owner-1' });
    mocks.fetchAccountStatus.mockResolvedValue({
      id: 'owner-1',
      username: 'xiaomiao',
      displayName: null,
      quota: 1,
      quotaUnit: 'quota',
      canGenerate: true,
    });

    await expect(methods['sync.setConsent'].handle({ consent: 'enabled' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: '当前账号工作区尚未建立,已保留同步设置;请先显式接管本地数据',
    });
    expect(transportFactory).not.toHaveBeenCalled();
    expect(transport.registerDevice).not.toHaveBeenCalled();
    expect(transport.bootstrap).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT owner_id, kind FROM local_workspaces WHERE id = 'account:owner-1'").get(),
    ).toBeUndefined();
    expect(
      db
        .prepare(
          'SELECT active, enabled, consent_state, cursor, bootstrap_completed_at FROM cloud_sync_accounts WHERE owner_id = ?',
        )
        .get('owner-1'),
    ).toMatchObject({
      active: 1,
      enabled: 1,
      consent_state: 'enabled',
      cursor: '0',
      bootstrap_completed_at: null,
    });
    expect(await methods['sync.getStatus'].handle(undefined)).toMatchObject({
      consent: 'enabled',
      phase: 'error',
      enabled: true,
      error: '当前账号工作区尚未建立,请先显式接管本地数据',
    });

    const paused = (await methods['sync.setConsent'].handle({ consent: 'paused' })) as {
      consent: string;
      phase: string;
      account: unknown;
    };
    expect(paused).toMatchObject({ consent: 'paused', phase: 'paused' });
    expect(paused.account).not.toBeNull();
  });

  it('同步失败落为 error 状态而不抛给渲染层', async () => {
    const { methods, db, transport } = setup();
    ensureAccountWorkspace(db, 'owner-1');
    mocks.readSessionCredentials.mockResolvedValue({ token: 'token-1', ownerId: 'owner-1' });
    mocks.fetchAccountStatus.mockResolvedValue({
      id: 'owner-1',
      username: 'xiaomiao',
      displayName: null,
      quota: 1,
      quotaUnit: 'quota',
      canGenerate: true,
    });
    vi.mocked(transport.registerDevice).mockRejectedValue(new Error('网关不可达'));

    const status = (await methods['sync.setConsent'].handle({ consent: 'enabled' })) as {
      enabled: boolean;
      state: string;
      error: string | null;
    };
    expect(status.enabled).toBe(true);
    expect(status.state).toBe('error');
    expect(status.error).toContain('网关不可达');
  });

  it('未开启时 syncNow 拒绝', async () => {
    const { methods } = setup();
    await expect(methods['sync.syncNow'].handle(undefined)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('账号切换前等待旧 run,保留 A 的 consent/账本且 B 不隐式创建 workspace', async () => {
    const { methods, repository, transport, transportFactory, db } = setup();
    ensureAccountWorkspace(db, 'owner-a');
    mocks.readSessionCredentials.mockResolvedValue({ token: 'token-a', ownerId: 'owner-a' });
    repository.activateAccount({
      ownerId: 'owner-a',
      username: 'account-a',
      deviceName: 'Device A',
      platform: 'macos',
      clientVersion: '2.5.0',
    });
    repository.setEnabled('owner-a', true);

    let resolveRegistration: (
      value: Awaited<ReturnType<DesktopSyncTransport['registerDevice']>>,
    ) => void = () => {
      throw new Error('registration resolver missing');
    };
    vi.mocked(transport.registerDevice).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRegistration = resolve;
        }),
    );
    const run = methods['sync.syncNow'].handle(undefined);
    await vi.waitFor(() => expect(transport.registerDevice).toHaveBeenCalledOnce());

    let quiesced = false;
    const before = Promise.all(
      mocks.beforeAccountChangeListeners.map((listener) => listener()),
    ).then(() => {
      quiesced = true;
    });
    await Promise.resolve();
    expect(quiesced).toBe(false);
    await expect(methods['sync.syncNow'].handle(undefined)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const activeBeforeSwitch = repository.getActiveAccount();
    if (!activeBeforeSwitch) throw new Error('active owner A missing before account switch');
    resolveRegistration({
      deviceId: activeBeforeSwitch.deviceId,
      name: 'Device A',
      platform: 'macos',
      clientVersion: '2.5.0',
      revoked: false,
      lastPullCursor: '0',
    });
    await before;
    await run;
    expect(quiesced).toBe(true);

    const accountB = {
      id: 'owner-b',
      username: 'account-b',
      displayName: null,
      quota: 1,
      quotaUnit: 'quota',
      canGenerate: true,
    };
    for (const listener of mocks.accountChangedListeners) await listener(accountB);

    expect(transportFactory.mock.calls.map(([token]) => token)).toEqual(['token-a']);
    expect(transport.bootstrap).not.toHaveBeenCalled();
    expect(
      db
        .prepare(
          'SELECT owner_id, active, enabled, consent_state FROM cloud_sync_accounts ORDER BY owner_id',
        )
        .all(),
    ).toEqual([
      { owner_id: 'owner-a', active: 0, enabled: 1, consent_state: 'enabled' },
      { owner_id: 'owner-b', active: 1, enabled: 0, consent_state: 'unset' },
    ]);
    expect(
      db.prepare("SELECT owner_id FROM local_workspaces WHERE id = 'account:owner-b'").get(),
    ).toBeUndefined();
  });

  it('token owner 与 active owner 脱钩时不发网、不改 consent 并派生 auth_blocked', async () => {
    const { methods, repository, transportFactory, db } = setup();
    ensureAccountWorkspace(db, 'owner-a');
    repository.activateAccount({
      ownerId: 'owner-a',
      username: 'account-a',
      deviceName: 'Device A',
      platform: 'macos',
      clientVersion: '2.5.0',
    });
    repository.setConsent('owner-a', 'enabled');
    mocks.readSessionCredentials.mockResolvedValue({ token: 'token-b', ownerId: 'owner-b' });

    await expect(methods['sync.syncNow'].handle(undefined)).resolves.toMatchObject({
      consent: 'enabled',
      phase: 'auth_blocked',
      enabled: true,
      account: { username: 'account-a' },
    });
    expect(transportFactory).not.toHaveBeenCalled();
    expect(
      db
        .prepare(
          'SELECT active, enabled, consent_state FROM cloud_sync_accounts WHERE owner_id = ?',
        )
        .get('owner-a'),
    ).toEqual({ active: 1, enabled: 1, consent_state: 'enabled' });
  });

  it('真实 SQLite 冲突只暴露安全摘要并支持 Prompt 三种决议', async () => {
    const { methods, repository, transportFactory, db } = setup();
    const ownerId = 'owner-conflicts';
    const workspaceId = ensureAccountWorkspace(db, ownerId);
    repository.activateAccount({
      ownerId,
      username: 'conflict-user',
      deviceName: 'Device',
      platform: 'macos',
      clientVersion: '2.5.0',
    });
    repository.setConsent(ownerId, 'paused');

    const remoteId = createPromptConflict(repository, db, ownerId, 'prompt-remote', 'keep local A');
    const localId = createPromptConflict(repository, db, ownerId, 'prompt-local', 'keep local B');
    const duplicateId = createPromptConflict(
      repository,
      db,
      ownerId,
      'prompt-duplicate',
      'keep local C',
    );

    const conflicts = (await methods['sync.listConflicts'].handle(undefined)) as Array<
      Record<string, unknown>
    >;
    expect(conflicts).toHaveLength(3);
    expect(conflicts.map((conflict) => Object.keys(conflict).sort())).toEqual(
      Array.from({ length: 3 }, () => [
        'canDuplicate',
        'createdAt',
        'entityId',
        'entityType',
        'id',
        'localSnapshot',
        'remoteSnapshot',
      ]),
    );
    expect(JSON.stringify(conflicts)).not.toMatch(/ownerId|workspaceId|mutationId|baseVersion/);
    expect(conflicts).toContainEqual(
      expect.objectContaining({
        id: duplicateId,
        entityType: 'prompt',
        canDuplicate: true,
        localSnapshot: expect.objectContaining({ content: 'keep local C' }),
        remoteSnapshot: expect.objectContaining({ content: 'remote', version: 2 }),
      }),
    );

    await expect(
      methods['sync.resolveConflict'].handle({ conflictId: remoteId, resolution: 'remote' }),
    ).resolves.toMatchObject({ consent: 'paused', phase: 'paused', conflicts: 2 });
    expect(
      db
        .prepare('SELECT content FROM prompts WHERE workspace_id = ? AND id = ?')
        .get(workspaceId, 'prompt-remote'),
    ).toEqual({ content: 'remote' });

    await expect(
      methods['sync.resolveConflict'].handle({ conflictId: localId, resolution: 'local' }),
    ).resolves.toMatchObject({ consent: 'paused', phase: 'paused', conflicts: 1 });
    expect(
      db
        .prepare('SELECT content FROM prompts WHERE workspace_id = ? AND id = ?')
        .get(workspaceId, 'prompt-local'),
    ).toEqual({ content: 'keep local B' });
    expect(repository.listReadyMutations(ownerId, workspaceId)).toContainEqual(
      expect.objectContaining({
        entityId: 'prompt-local',
        operation: 'update',
        baseVersion: 2,
      }),
    );

    await expect(
      methods['sync.resolveConflict'].handle({ conflictId: duplicateId, resolution: 'duplicate' }),
    ).resolves.toMatchObject({ consent: 'paused', phase: 'paused', conflicts: 0 });
    expect(
      db
        .prepare(
          `SELECT title, content FROM prompts
           WHERE workspace_id = ? AND title LIKE '%本地副本%'`,
        )
        .get(workspaceId),
    ).toMatchObject({ content: 'keep local C' });
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it('非 Prompt 禁止 duplicate 且账号切换栅栏拒绝冲突读写', async () => {
    const { methods, repository, db } = setup();
    const ownerId = 'owner-folder-conflict';
    const workspaceId = ensureAccountWorkspace(db, ownerId);
    repository.activateAccount({
      ownerId,
      username: 'folder-user',
      deviceName: 'Device',
      platform: 'macos',
      clientVersion: '2.5.0',
    });
    repository.setConsent(ownerId, 'paused');
    repository.applyBootstrapSnapshot(
      ownerId,
      workspaceId,
      'folder',
      remoteFolder('folder-1', 'Base folder', 1),
    );
    db.prepare('UPDATE folders SET name = ? WHERE workspace_id = ? AND id = ?').run(
      'Local folder',
      workspaceId,
      'folder-1',
    );
    repository.enqueue(ownerId, workspaceId, 'folder', 'folder-1', 'update');
    repository.applyRemoteChange(ownerId, workspaceId, {
      seq: '2',
      entityType: 'folder',
      entityId: 'folder-1',
      operation: 'upsert',
      version: 2,
      snapshot: remoteFolder('folder-1', 'Remote folder', 2),
    });
    const [folderConflict] = repository.listConflicts(ownerId, workspaceId);
    if (!folderConflict) throw new Error('folder conflict missing');
    const conflictId = folderConflict.id;

    await expect(
      methods['sync.resolveConflict'].handle({ conflictId, resolution: 'duplicate' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repository.listConflicts(ownerId, workspaceId)).toHaveLength(1);
    expect(
      db
        .prepare('SELECT name FROM folders WHERE workspace_id = ? AND id = ?')
        .get(workspaceId, 'folder-1'),
    ).toEqual({ name: 'Local folder' });

    for (const listener of mocks.beforeAccountChangeListeners) await listener();
    await expect(methods['sync.listConflicts'].handle(undefined)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(
      methods['sync.resolveConflict'].handle({ conflictId, resolution: 'remote' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.listConflicts(ownerId, workspaceId)).toHaveLength(1);
  });

  it('登出只 deactivate,同 owner 重登恢复 consent 与同步元数据', async () => {
    const { methods, repository, db } = setup();
    ensureAccountWorkspace(db, 'owner-1');
    mocks.readSessionCredentials.mockResolvedValue({ token: 'token-1', ownerId: 'owner-1' });
    mocks.fetchAccountStatus.mockResolvedValue({
      id: 'owner-1',
      username: 'xiaomiao',
      displayName: null,
      quota: 1,
      quotaUnit: 'quota',
      canGenerate: true,
    });
    await methods['sync.setConsent'].handle({ consent: 'enabled' });

    for (const listener of mocks.beforeAccountChangeListeners) await listener();
    for (const listener of mocks.accountChangedListeners) await listener(null);

    expect(repository.getActiveAccount()).toBeNull();
    expect(
      db
        .prepare(
          'SELECT active, consent_state, cursor, bootstrap_completed_at FROM cloud_sync_accounts WHERE owner_id = ?',
        )
        .get('owner-1'),
    ).toMatchObject({
      active: 0,
      consent_state: 'enabled',
      cursor: '1',
      bootstrap_completed_at: expect.any(Number),
    });
    const signedOut = await methods['sync.getStatus'].handle(undefined);
    expect(signedOut).toMatchObject({ consent: 'unset', phase: 'signed_out' });

    for (const listener of mocks.accountChangedListeners) {
      await listener({
        id: 'owner-1',
        username: 'xiaomiao',
        displayName: null,
        quota: 1,
        quotaUnit: 'quota',
        canGenerate: true,
      });
    }
    const resumed = await methods['sync.getStatus'].handle(undefined);
    expect(resumed).toMatchObject({ consent: 'enabled' });
    expect(['syncing', 'idle']).toContain((resumed as { phase: string }).phase);
    await expect(methods['sync.syncNow'].handle(undefined)).resolves.toMatchObject({
      consent: 'enabled',
      phase: 'idle',
    });
  });
});
