// sync 域桥行为守护:登录 ≠ 同步、开启即全量跑、换账号隔离、未登录拒绝开启。
// transport 全 mock(不触网),库为内存 SQLite(core legacy 链建表)。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: { getVersion: () => '2.5.0-test', getPath: () => '/tmp' },
  readSessionCredentials:
    vi.fn<() => Promise<import('../account-session-store').SessionCredentials | null>>(),
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
vi.mock('../account-domain', async () => ({
  accountWorkspaceOwner: (await import('../account-session-store')).accountWorkspaceOwner,
  apiBase: () => 'http://127.0.0.1:0',
  readSessionCredentials: mocks.readSessionCredentials,
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
  AccountSummary,
  DesktopSyncStatus,
  LocalWorkspaceRecoveryStatus,
  LocalWorkspacePreview,
  PromptDocument,
  PromptFolder,
  SyncPushRequest,
  SyncUsagePushRequest,
} from '@musefold/contracts';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { ensureAccountWorkspace, resolveAccountWorkspace } from '@musefold/core/db/workspaces';
import { runMigrations } from '@musefold/core/db/run-migrations';
import { resolveLocalContentWorkspace } from '@musefold/core/db/workspaces';
import { configureCoreRuntime } from '@musefold/core/runtime';
import {
  DesktopSyncEngine,
  DesktopSyncRepository,
  type DesktopSyncTransport,
} from '@musefold/core';
import Database from 'better-sqlite3';
import {
  accountWorkspaceOwner,
  sessionForAccount,
  withAccountTransition,
} from '../account-session-store';
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

const databases: Database.Database[] = [];
const scratch: string[] = [];
function setup(existing?: Database.Database): Harness {
  const db = existing ?? new Database(':memory:');
  databases.push(db);
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  const repository = new DesktopSyncRepository(db);
  const transport = fakeTransport();
  const transportFactory = vi.fn(() => transport);
  mocks.beforeAccountChangeListeners.length = 0;
  mocks.accountChangeCancelledListeners.length = 0;
  mocks.accountChangedListeners.length = 0;
  resetSyncRuntimeForTests({
    database: db,
    repository,
    engine: new DesktopSyncEngine(repository),
    transportFactory,
    getWorkspace: (ownerId) => resolveAccountWorkspace(db, ownerId),
  });
  const methods = buildSyncDomainMethods() as Harness['methods'];
  return { methods, repository, transport, transportFactory, db };
}

function account(id: string) {
  return {
    id,
    username: id,
    displayName: null,
    quota: 1,
    quotaUnit: 'quota',
    canGenerate: true,
    identity: {
      apiIssuer: 'http://127.0.0.1:0',
      principalId: `principal-${id}`,
      status: 'active',
      identityVersion: 1,
    },
  } satisfies AccountSummary;
}
const owner = (id: string) => accountWorkspaceOwner(account(id));
const session = (id: string, token = `token-${id}`) =>
  sessionForAccount(token, 'http://127.0.0.1:0', account(id));

async function syncReview(methods: Harness['methods']) {
  const status = (await methods['sync.getStatus'].handle(undefined)) as DesktopSyncStatus;
  return status.reviewRef;
}
async function prepareReview(methods: Harness['methods']) {
  const status = (await methods['sync.listLocalWorkspaces'].handle(
    undefined,
  )) as LocalWorkspaceRecoveryStatus;
  return status.reviewRef ?? '';
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
  process.env.MUSEFOLD_API_URL = 'http://127.0.0.1:0';
  mocks.readSessionCredentials.mockReset();
  mocks.fetchAccountStatus.mockReset();
});

describe('sync 域桥', () => {
  it('注册真实九方法并返回显式 signed_out 三态状态', async () => {
    const { methods } = setup();
    expect(Object.keys(methods).sort()).toEqual([
      'sync.getStatus',
      'sync.listConflicts',
      'sync.listLocalWorkspaces',
      'sync.prepareLocalWorkspace',
      'sync.previewLocalWorkspace',
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
    await expect(
      methods['sync.setConsent'].handle({
        consent: 'enabled',
        reviewRef: await syncReview(methods),
      }),
    ).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('尚未建立库的已验证账号不隐式创建或保留上传同意', async () => {
    const { methods, db, repository, transportFactory } = setup();
    mocks.readSessionCredentials.mockResolvedValue(session('owner-1'));
    mocks.fetchAccountStatus.mockResolvedValue(account('owner-1'));
    for (const listener of mocks.accountChangedListeners) await listener(account('owner-1'));
    for (const listener of mocks.accountChangedListeners) await listener(account('owner-1'));
    await expect(
      methods['sync.setConsent'].handle({
        consent: 'enabled',
        reviewRef: await syncReview(methods),
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(resolveAccountWorkspace(db, owner('owner-1'))).toBeNull();
    expect(repository.getActiveAccount()).toMatchObject({
      ownerId: owner('owner-1'),
      consent: 'unset',
    });
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it('同步失败落为 error 状态而不抛给渲染层', async () => {
    const { methods, db, transport } = setup();
    ensureAccountWorkspace(db, owner('owner-1'));
    mocks.readSessionCredentials.mockResolvedValue(session('owner-1', 'token-1'));
    mocks.fetchAccountStatus.mockResolvedValue(account('owner-1'));
    for (const listener of mocks.accountChangedListeners) await listener(account('owner-1'));
    vi.mocked(transport.registerDevice).mockRejectedValue(new Error('网关不可达'));

    const status = (await methods['sync.setConsent'].handle({
      consent: 'enabled',
      reviewRef: await syncReview(methods),
    })) as {
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
    ensureAccountWorkspace(db, owner('owner-a'));
    mocks.readSessionCredentials.mockResolvedValue(session('owner-a', 'token-a'));
    repository.activateAccount({
      ownerId: owner('owner-a'),
      username: 'account-a',
      deviceName: 'Device A',
      platform: 'macos',
      clientVersion: '2.5.0',
    });
    repository.setEnabled(owner('owner-a'), true);

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

    const accountB = account('owner-b');
    for (const listener of mocks.accountChangedListeners) await listener(accountB);

    expect(transportFactory.mock.calls.map(([token]) => token)).toEqual(['token-a']);
    expect(transport.bootstrap).not.toHaveBeenCalled();
    expect(
      db
        .prepare(
          'SELECT owner_id, active, enabled, consent_state FROM cloud_sync_accounts ORDER BY owner_id',
        )
        .all()
        .sort((a, b) => (a as { active: number }).active - (b as { active: number }).active),
    ).toEqual([
      { owner_id: owner('owner-a'), active: 0, enabled: 1, consent_state: 'enabled' },
      { owner_id: owner('owner-b'), active: 1, enabled: 0, consent_state: 'unset' },
    ]);
    expect(
      db
        .prepare('SELECT owner_id FROM local_workspaces WHERE id = ?')
        .get(`account:${owner('owner-b')}`),
    ).toBeUndefined();
  });

  it('token owner 与 active owner 脱钩时不发网、不改 consent 并派生 auth_blocked', async () => {
    const { methods, repository, transportFactory, db } = setup();
    ensureAccountWorkspace(db, owner('owner-a'));
    repository.activateAccount({
      ownerId: owner('owner-a'),
      username: 'account-a',
      deviceName: 'Device A',
      platform: 'macos',
      clientVersion: '2.5.0',
    });
    repository.setConsent(owner('owner-a'), 'enabled');
    mocks.readSessionCredentials.mockResolvedValue(session('owner-b', 'token-b'));

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
        .get(owner('owner-a')),
    ).toEqual({ active: 1, enabled: 1, consent_state: 'enabled' });
  });

  it('真实 SQLite 冲突只暴露安全摘要并支持 Prompt 三种决议', async () => {
    const { methods, repository, transportFactory, db } = setup();
    const ownerId = owner('owner-conflicts');
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
    const ownerId = owner('owner-folder-conflict');
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

  it('已永久删除分类的保留本地请求返回稳定错误且不处理掉原冲突', async () => {
    const { methods, repository, db, transportFactory } = setup();
    const ownerId = owner('owner-deleted-folder');
    const workspaceId = ensureAccountWorkspace(db, ownerId);
    repository.activateAccount({
      ownerId,
      username: 'Synthetic',
      deviceName: 'Owned',
      platform: 'macos',
      clientVersion: '2.5.0',
    });
    repository.setConsent(ownerId, 'paused');
    const base = remoteFolder('deleted-folder', 'Base', 1);
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'folder', base);
    db.prepare('UPDATE folders SET name=? WHERE workspace_id=? AND id=?').run(
      'Local edit',
      workspaceId,
      base.id,
    );
    repository.enqueue(ownerId, workspaceId, 'folder', base.id, 'update');
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'folder', {
      ...base,
      version: 2,
      deletedAt: '2026-09-13T00:00:00Z',
    });
    const [conflict] = repository.listConflicts(ownerId, workspaceId);
    if (!conflict) throw new Error('Expected deleted folder conflict');
    const before = db.prepare('SELECT * FROM cloud_sync_outbox').all();
    await expect(
      methods['sync.resolveConflict'].handle({ conflictId: conflict.id, resolution: 'local' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: '分类已永久删除，不能保留本地版本',
    });
    expect(db.prepare('SELECT * FROM cloud_sync_outbox').all()).toEqual(before);
    expect(repository.listConflicts(ownerId, workspaceId)).toHaveLength(1);
    await expect(
      methods['sync.resolveConflict'].handle({ conflictId: conflict.id, resolution: 'remote' }),
    ).resolves.toMatchObject({ consent: 'paused', conflicts: 0 });
    expect(
      db.prepare('SELECT id FROM folders WHERE workspace_id=? AND id=?').get(workspaceId, base.id),
    ).toBeUndefined();
    expect(transportFactory).not.toHaveBeenCalled();
  });

  it('登出只 deactivate,同 owner 重登恢复 consent 与同步元数据', async () => {
    const { methods, repository, db } = setup();
    ensureAccountWorkspace(db, owner('owner-1'));
    mocks.readSessionCredentials.mockResolvedValue(session('owner-1', 'token-1'));
    mocks.fetchAccountStatus.mockResolvedValue(account('owner-1'));
    for (const listener of mocks.accountChangedListeners) await listener(account('owner-1'));
    await methods['sync.setConsent'].handle({
      consent: 'enabled',
      reviewRef: await syncReview(methods),
    });

    for (const listener of mocks.beforeAccountChangeListeners) await listener();
    for (const listener of mocks.accountChangedListeners) await listener(null);

    expect(repository.getActiveAccount()).toBeNull();
    expect(
      db
        .prepare(
          'SELECT active, consent_state, cursor, bootstrap_completed_at FROM cloud_sync_accounts WHERE owner_id = ?',
        )
        .get(owner('owner-1')),
    ).toMatchObject({
      active: 0,
      consent_state: 'enabled',
      cursor: '1',
      bootstrap_completed_at: expect.any(Number),
    });
    const signedOut = await methods['sync.getStatus'].handle(undefined);
    expect(signedOut).toMatchObject({ consent: 'unset', phase: 'signed_out' });

    for (const listener of mocks.accountChangedListeners) {
      await listener(account('owner-1'));
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

afterEach(() => {
  resetSyncRuntimeForTests(null);
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function insertPrompt(db: Database.Database, workspace: string, id = 'old-prompt') {
  db.prepare(`INSERT INTO prompts (workspace_id, id, title, content, content_negative, usage_count, last_used_at, preview_image_path, created_at, updated_at)
    VALUES (?, ?, '旧庭院', 'private garden', 'fog', 7, 4, '/synthetic/local-cover.png', 1, 2)`).run(
    workspace,
    id,
  );
}

async function signIn(id: string) {
  const credentials = session(id);
  mocks.readSessionCredentials.mockResolvedValue(credentials);
  mocks.fetchAccountStatus.mockResolvedValue(account(id));
  for (const listener of mocks.accountChangedListeners) await listener(account(id));
  return credentials;
}

describe('explicit local workspace recovery and epoch commits', () => {
  it('真实旧 SQLite 重开后查看旧 account:<upstream>，显式复制到 issuer+principal scope，再首次同意才上传', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'musefold-workspace-recovery-'));
    scratch.push(directory);
    const path = join(directory, 'legacy.sqlite');
    const old = new Database(path);
    runMigrations(old);
    takeoverDesktopDatabase(old);
    const source = ensureAccountWorkspace(old, 'upstream-7');
    const repo = new DesktopSyncRepository(old);
    repo.activateAccount({
      ownerId: 'upstream-7',
      username: '旧账号名',
      deviceName: 'old',
      platform: 'macos',
      clientVersion: '2.1',
    });
    repo.setConsent('upstream-7', 'enabled');
    insertPrompt(old, source);
    old
      .prepare(
        `INSERT INTO folders (workspace_id,id,name,created_at) VALUES (?, 'old-folder', '庭院文件夹', 1)`,
      )
      .run(source);
    old
      .prepare(
        `INSERT INTO tags (workspace_id,id,name,created_at) VALUES (?, 'old-tag', '标签一', 1)`,
      )
      .run(source);
    old.prepare(`UPDATE prompts SET folder_id = 'old-folder' WHERE workspace_id = ?`).run(source);
    old
      .prepare(
        `INSERT INTO prompt_tags (workspace_id,prompt_id,tag_id) VALUES (?, 'old-prompt', 'old-tag')`,
      )
      .run(source);
    repo.enqueue('upstream-7', source, 'prompt', 'old-prompt', 'create');
    old.close();
    const { methods, db, repository, transportFactory } = setup(new Database(path));
    await signIn('upstream-7');
    expect(resolveLocalContentWorkspace(db)).toBe('local-only-legacy');
    expect(resolveAccountWorkspace(db, owner('upstream-7'))).toBeNull();
    const list = (await methods['sync.listLocalWorkspaces'].handle(
      undefined,
    )) as LocalWorkspaceRecoveryStatus;
    const entry = list.sources.find((item) => item.label.includes('旧账号名'));
    if (!entry) throw new Error('historical source missing');
    expect(list).toMatchObject({ targetReady: false, canPrepare: true });
    expect(entry.counts).toEqual({ prompts: 1, folders: 1, tags: 1 });
    const preview = (await methods['sync.previewLocalWorkspace'].handle({
      sourceId: entry.sourceId,
    })) as LocalWorkspacePreview;
    expect(preview.prompts[0]).toMatchObject({
      content: 'private garden',
      negative: 'fog',
      folderName: '庭院文件夹',
      tags: ['标签一'],
    });
    expect(JSON.stringify([list.sources, preview])).not.toMatch(
      /upstream-7|account:|preview_image_path|local-cover|token/,
    );
    await expect(
      methods['sync.prepareLocalWorkspace'].handle({
        mode: 'copy',
        reviewRef: await prepareReview(methods),
        sourceId: entry.sourceId,
        expectedRevision: preview.revision,
      }),
    ).resolves.toMatchObject({ consent: 'unset', phase: 'awaiting_consent', enabled: false });
    const target = `account:${owner('upstream-7')}`;
    expect(resolveLocalContentWorkspace(db)).toBe(target);
    expect(
      db
        .prepare(
          'SELECT usage_count,last_used_at,preview_image_path FROM prompts WHERE workspace_id = ?',
        )
        .get(target),
    ).toEqual({
      usage_count: 7,
      last_used_at: 4,
      preview_image_path: '/synthetic/local-cover.png',
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM prompts WHERE id = ?').get('old-prompt')).toEqual({
      n: 2,
    });
    expect(repository.getActiveAccount()).toMatchObject({
      ownerId: owner('upstream-7'),
      consent: 'unset',
    });
    expect(
      db
        .prepare('SELECT consent_state,active FROM cloud_sync_accounts WHERE owner_id = ?')
        .get('upstream-7'),
    ).toEqual({ consent_state: 'enabled', active: 0 });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM cloud_sync_outbox WHERE workspace_id = ?').get(source),
    ).toEqual({ n: 1 });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM cloud_sync_outbox WHERE workspace_id = ?').get(target),
    ).toEqual({ n: 0 });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM cloud_entity_state WHERE workspace_id = ?').get(target),
    ).toEqual({ n: 0 });
    expect(transportFactory).not.toHaveBeenCalled();
    await methods['sync.setConsent'].handle({
      consent: 'enabled',
      reviewRef: await syncReview(methods),
    });
    expect(transportFactory).toHaveBeenCalledOnce();
    expect(repository.getActiveAccount()).toMatchObject({ consent: 'enabled' });
  });

  it('view revision changed / forged source / populated target cannot copy or merge', async () => {
    const { methods, db } = setup();
    await signIn('a');
    const source = ensureAccountWorkspace(db, 'old-owner');
    insertPrompt(db, source);
    const list = (await methods['sync.listLocalWorkspaces'].handle(
      undefined,
    )) as LocalWorkspaceRecoveryStatus;
    const entry = list.sources.find((item) => item.kind === 'account');
    if (!entry) throw new Error('account source missing');
    db.prepare('UPDATE prompts SET usage_count = 9 WHERE workspace_id = ?').run(source);
    await expect(
      methods['sync.prepareLocalWorkspace'].handle({
        mode: 'copy',
        reviewRef: await prepareReview(methods),
        sourceId: entry.sourceId,
        expectedRevision: entry.revision,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(resolveAccountWorkspace(db, owner('a'))).toBeNull();
    await expect(
      methods['sync.previewLocalWorkspace'].handle({ sourceId: 'f'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await methods['sync.prepareLocalWorkspace'].handle({
      mode: 'empty',
      reviewRef: await prepareReview(methods),
    });
    const fresh = (await methods['sync.previewLocalWorkspace'].handle({
      sourceId: entry.sourceId,
    })) as LocalWorkspacePreview;
    await expect(
      methods['sync.prepareLocalWorkspace'].handle({
        mode: 'copy',
        reviewRef: await prepareReview(methods),
        sourceId: entry.sourceId,
        expectedRevision: fresh.revision,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM prompts WHERE workspace_id = ?')
        .get(`account:${owner('a')}`),
    ).toEqual({ n: 0 });
    expect(
      db.prepare('SELECT usage_count FROM prompts WHERE workspace_id = ?').get(source),
    ).toEqual({ usage_count: 9 });
  });

  it('recovery-only allows local view but cannot adopt or consent; legacy identity cannot establish a new target', async () => {
    const { methods, db, transportFactory } = setup();
    insertPrompt(db, 'local-only-legacy');
    const restricted: AccountSummary = {
      ...account('a'),
      canGenerate: false,
      identity: { ...account('a').identity, status: 'recovery_required' },
    };
    mocks.readSessionCredentials.mockResolvedValue(
      sessionForAccount('restricted', 'http://127.0.0.1:0', restricted),
    );
    mocks.fetchAccountStatus.mockResolvedValue(restricted);
    const list = (await methods['sync.listLocalWorkspaces'].handle(
      undefined,
    )) as LocalWorkspaceRecoveryStatus;
    expect(list.canPrepare).toBe(false);
    await expect(
      methods['sync.previewLocalWorkspace'].handle({ sourceId: list.sources[0].sourceId }),
    ).resolves.toMatchObject({ prompts: [{ content: 'private garden' }] });
    for (const [method, input] of [
      ['sync.prepareLocalWorkspace', { mode: 'empty', reviewRef: await prepareReview(methods) }],
      ['sync.setConsent', { consent: 'enabled' }],
    ] as const) {
      await expect(methods[method].handle(input)).rejects.toMatchObject({
        code: 'ACCOUNT_IDENTITY_UNVERIFIED',
      });
    }
    expect(transportFactory).not.toHaveBeenCalled();
    const legacy: AccountSummary = {
      id: 'a',
      username: 'a',
      displayName: null,
      quota: 1,
      quotaUnit: 'quota',
      canGenerate: true,
    };
    mocks.readSessionCredentials.mockResolvedValue(
      sessionForAccount('legacy', 'http://127.0.0.1:0', legacy),
    );
    mocks.fetchAccountStatus.mockResolvedValue(legacy);
    await expect(
      methods['sync.prepareLocalWorkspace'].handle({
        mode: 'empty',
        reviewRef: await prepareReview(methods),
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_IDENTITY_UNVERIFIED' });
  });

  it.each(['sync.setConsent', 'sync.prepareLocalWorkspace'])(
    'late A %s verification cannot overwrite a committed B',
    async (method) => {
      const { methods, db, repository, transportFactory } = setup();
      await signIn('a');
      if (method === 'sync.setConsent') ensureAccountWorkspace(db, owner('a'));
      let resolveStatus!: (status: AccountSummary) => void;
      mocks.fetchAccountStatus.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStatus = resolve;
          }),
      );
      const pending = methods[method].handle(
        method === 'sync.setConsent'
          ? { consent: 'enabled', reviewRef: await syncReview(methods) }
          : { mode: 'empty', reviewRef: await prepareReview(methods) },
      );
      const failed = expect(pending).rejects.toMatchObject({ code: 'CONFLICT' });
      await vi.waitFor(() => expect(resolveStatus).toBeTypeOf('function'));
      // Uses the real production transition lock and real issuer+principal hashing.
      await withAccountTransition(async () => {
        for (const listener of mocks.beforeAccountChangeListeners) await listener();
        await signIn('b');
      });
      resolveStatus(account('a'));
      await failed;
      expect(repository.getActiveAccount()).toMatchObject({
        ownerId: owner('b'),
        consent: 'unset',
      });
      expect(
        db
          .prepare('SELECT consent_state FROM cloud_sync_accounts WHERE owner_id = ?')
          .get(owner('a')),
      ).toEqual({ consent_state: 'unset' });
      expect(resolveAccountWorkspace(db, owner('b'))).toBeNull();
      if (method === 'sync.prepareLocalWorkspace')
        expect(resolveAccountWorkspace(db, owner('a'))).toBeNull();
      expect(transportFactory).not.toHaveBeenCalled();
    },
  );

  it.each(['authEpoch', 'ownerId', 'principalId', 'apiIssuer', 'token', 'restricted'] as const)(
    'full session %s changed after verification is rejected',
    async (field) => {
      const { methods, db } = setup();
      const captured = await signIn('a');
      ensureAccountWorkspace(db, owner('a'));
      mocks.fetchAccountStatus.mockImplementationOnce(async () => {
        mocks.readSessionCredentials.mockResolvedValue({
          ...captured,
          [field]: field === 'restricted' ? true : 'different',
        });
        return account('a');
      });
      await expect(
        methods['sync.setConsent'].handle({
          consent: 'enabled',
          reviewRef: await syncReview(methods),
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    },
  );
});

describe('reviewed account binding before submit', () => {
  it.each(['other-principal', 'same-principal-new-login'] as const)(
    'rejects all old confirmations after %s before the request is sent',
    async (transition) => {
      const { methods, db, repository, transportFactory } = setup();
      await signIn('a');
      insertPrompt(db, 'local-only-legacy');
      const listA = (await methods['sync.listLocalWorkspaces'].handle(
        undefined,
      )) as LocalWorkspaceRecoveryStatus;
      const statusA = (await methods['sync.getStatus'].handle(undefined)) as DesktopSyncStatus;
      const previewA = (await methods['sync.previewLocalWorkspace'].handle({
        sourceId: listA.sources[0].sourceId,
      })) as LocalWorkspacePreview;
      expect(listA.targetAccount).toEqual({ username: 'a' });
      expect(listA.reviewRef).toBe(statusA.reviewRef);
      const next = transition === 'other-principal' ? 'b' : 'a';
      await withAccountTransition(async () => {
        for (const listener of mocks.beforeAccountChangeListeners) await listener();
        await signIn(next);
      });
      const listB = (await methods['sync.listLocalWorkspaces'].handle(
        undefined,
      )) as LocalWorkspaceRecoveryStatus;
      expect(listB.reviewRef).not.toBe(listA.reviewRef);
      for (const input of [
        { mode: 'empty', reviewRef: listA.reviewRef },
        {
          mode: 'copy',
          reviewRef: listA.reviewRef,
          sourceId: previewA.sourceId,
          expectedRevision: previewA.revision,
        },
      ]) {
        await expect(methods['sync.prepareLocalWorkspace'].handle(input)).rejects.toMatchObject({
          code: 'CONFLICT',
        });
      }
      expect(resolveAccountWorkspace(db, owner(next))).toBeNull();
      ensureAccountWorkspace(db, owner(next));
      await expect(
        methods['sync.setConsent'].handle({ consent: 'enabled', reviewRef: statusA.reviewRef }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        methods['sync.setEnabled'].handle({ enabled: true, reviewRef: statusA.reviewRef }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        methods['sync.setConsent'].handle({ consent: 'paused', reviewRef: statusA.reviewRef }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(repository.getActiveAccount()).toMatchObject({
        ownerId: owner(next),
        consent: 'unset',
      });
      expect(transportFactory).not.toHaveBeenCalled();
    },
  );

  it('requires a review for new host enable aliases and returns null review while signed out/restricted', async () => {
    const { methods, db, repository, transportFactory } = setup();
    mocks.readSessionCredentials.mockResolvedValue(null);
    expect(await methods['sync.listLocalWorkspaces'].handle(undefined)).toMatchObject({
      reviewRef: null,
      targetAccount: null,
      canPrepare: false,
    });
    expect(await methods['sync.getStatus'].handle(undefined)).toMatchObject({ reviewRef: null });
    await signIn('a');
    ensureAccountWorkspace(db, owner('a'));
    for (const reviewRef of [undefined, null]) {
      await expect(
        methods['sync.setConsent'].handle({ consent: 'enabled', reviewRef }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        methods['sync.setEnabled'].handle({ enabled: true, reviewRef }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    expect(repository.getActiveAccount()?.consent).toBe('unset');
    expect(transportFactory).not.toHaveBeenCalled();
    const restricted = { ...session('a'), restricted: true, ownerId: null };
    mocks.readSessionCredentials.mockResolvedValue(restricted);
    expect(await methods['sync.listLocalWorkspaces'].handle(undefined)).toMatchObject({
      reviewRef: null,
      targetAccount: null,
      canPrepare: false,
    });
    expect(await methods['sync.getStatus'].handle(undefined)).toMatchObject({ reviewRef: null });
  });
});
