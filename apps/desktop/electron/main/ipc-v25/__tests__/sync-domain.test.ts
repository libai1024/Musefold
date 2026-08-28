// sync 域桥行为守护:登录 ≠ 同步、开启即全量跑、换账号自动关、未登录拒绝开启。
// transport 全 mock(不触网),库为内存 SQLite(core legacy 链建表)。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: { getVersion: () => '2.5.0-test', getPath: () => '/tmp' },
  readSessionToken: vi.fn<() => Promise<string | null>>(),
  fetchAccountStatus: vi.fn(),
  accountChangedListeners: [] as Array<() => void>,
}));

vi.mock('electron', () => ({ app: mocks.app }));
vi.mock('../../../system/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../account-domain', () => ({
  apiBase: () => 'http://127.0.0.1:0',
  readSessionToken: mocks.readSessionToken,
  fetchAccountStatus: mocks.fetchAccountStatus,
  onAccountChanged: (listener: () => void) => {
    mocks.accountChangedListeners.push(listener);
  },
}));

import type { SyncPushRequest, SyncUsagePushRequest } from '@musefold/contracts';
import { runMigrations } from '@musefold/core/db/run-migrations';
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
  db: Database.Database;
}

function setup(): Harness {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const repository = new DesktopSyncRepository(db);
  const transport = fakeTransport();
  mocks.accountChangedListeners.length = 0;
  resetSyncRuntimeForTests({ repository, engine: new DesktopSyncEngine(repository, transport) });
  const methods = buildSyncDomainMethods() as Harness['methods'];
  return { methods, repository, transport, db };
}

beforeEach(() => {
  mocks.readSessionToken.mockReset();
  mocks.fetchAccountStatus.mockReset();
});

describe('sync 域桥', () => {
  it('初始状态:未开启,无账号', async () => {
    const { methods } = setup();
    const status = (await methods['sync.getStatus'].handle(undefined)) as {
      enabled: boolean;
      state: string;
      account: unknown;
    };
    expect(status).toMatchObject({ enabled: false, state: 'disabled', account: null });
  });

  it('未登录时拒绝开启(登录 ≠ 同步,身份是前置)', async () => {
    const { methods } = setup();
    mocks.readSessionToken.mockResolvedValue(null);
    await expect(methods['sync.setEnabled'].handle({ enabled: true })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('开启即注册设备并全量跑一轮;关闭只停不删', async () => {
    const { methods, transport } = setup();
    mocks.readSessionToken.mockResolvedValue('token-1');
    mocks.fetchAccountStatus.mockResolvedValue({
      id: 'owner-1',
      username: 'xiaomiao',
      displayName: null,
      quota: 1,
      quotaUnit: 'quota',
      canGenerate: true,
    });

    const enabled = (await methods['sync.setEnabled'].handle({ enabled: true })) as {
      enabled: boolean;
      state: string;
      account: { username: string } | null;
      error: string | null;
    };
    expect(enabled.error).toBeNull();
    expect(enabled.enabled).toBe(true);
    expect(enabled.state).toBe('idle');
    expect(enabled.account?.username).toBe('xiaomiao');
    expect(transport.registerDevice).toHaveBeenCalledOnce();
    expect(transport.bootstrap).toHaveBeenCalled();

    const disabled = (await methods['sync.setEnabled'].handle({ enabled: false })) as {
      enabled: boolean;
      account: unknown;
    };
    expect(disabled.enabled).toBe(false);
    // 账号记录仍在(重开免重新 bootstrap),只是开关关了
    expect(disabled.account).not.toBeNull();
  });

  it('同步失败落为 error 状态而不抛给渲染层', async () => {
    const { methods, transport } = setup();
    mocks.readSessionToken.mockResolvedValue('token-1');
    mocks.fetchAccountStatus.mockResolvedValue({
      id: 'owner-1',
      username: 'xiaomiao',
      displayName: null,
      quota: 1,
      quotaUnit: 'quota',
      canGenerate: true,
    });
    vi.mocked(transport.registerDevice).mockRejectedValue(new Error('网关不可达'));

    const status = (await methods['sync.setEnabled'].handle({ enabled: true })) as {
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

  it('账号变化(登录/登出)自动关闭同步开关', async () => {
    const { methods } = setup();
    mocks.readSessionToken.mockResolvedValue('token-1');
    mocks.fetchAccountStatus.mockResolvedValue({
      id: 'owner-1',
      username: 'xiaomiao',
      displayName: null,
      quota: 1,
      quotaUnit: 'quota',
      canGenerate: true,
    });
    await methods['sync.setEnabled'].handle({ enabled: true });

    for (const listener of mocks.accountChangedListeners) listener();

    const status = (await methods['sync.getStatus'].handle(undefined)) as { enabled: boolean };
    expect(status.enabled).toBe(false);
  });
});
