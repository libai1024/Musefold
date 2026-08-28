import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopSyncRepository } from '@musefold/core';
import { SCHEMA_SQL } from '@musefold/core/db/schema';
import { up as addCloudSync } from '@musefold/core/db/migrations/0017_cloud_prompt_sync';
import { up as addUsageEvents } from '@musefold/core/db/migrations/0019_cloud_sync_usage_events';
const electronMock = vi.hoisted(() => ({
  app: {
    getVersion: vi.fn(() => '1.0.0-test'),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  powerMonitor: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: electronMock.app,
  BrowserWindow: { getAllWindows: () => [] },
  powerMonitor: electronMock.powerMonitor,
}));

vi.mock('../../account', () => ({
  getAccountService: () => {
    throw new Error('测试必须注入 accountService');
  },
}));

import { CloudSyncService } from '../index';

interface Identity {
  ownerId: string;
  username: string;
  cloudBaseUrl: string;
}

let db: Database.Database;
let repository: DesktopSyncRepository;
let identity: Identity | null;
let service: CloudSyncService;
let clientFactory: ReturnType<typeof vi.fn>;
let fetchImpl: ReturnType<typeof vi.fn>;
const managementAccessToken = vi.fn(async () => 'jwt-test');

function accountService() {
  return {
    cloudIdentity: () => identity,
    status: () => ({
      loggedIn: Boolean(identity),
      health: 'unknown' as const,
    }),
    managementAccessToken,
  };
}

function activateOwner(ownerId: string, enabled: boolean, deviceId = `device-${ownerId}`): void {
  repository.activateAccount({
    ownerId,
    username: `user-${ownerId}`,
    deviceId,
    deviceName: 'Musefold test',
    platform: 'macos',
    clientVersion: '1.0.0-test',
  });
  repository.setEnabled(ownerId, enabled);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  addCloudSync(db);
  addUsageEvents(db);
  repository = new DesktopSyncRepository(db);
  identity = null;
  clientFactory = vi.fn();
  fetchImpl = vi.fn();
  service = new CloudSyncService({
    repository,
    accountService: accountService as never,
    clientFactory: clientFactory as never,
    fetchImpl: fetchImpl as never,
  });
});

afterEach(() => {
  service.stop();
  db.close();
});

describe('CloudSyncService account gate', () => {
  it('does not create a client or fetch while signed out', async () => {
    await service.reconcileAccount();

    await expect(service.setEnabled(true)).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    await expect(service.listConnections()).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    expect(clientFactory).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(service.status()).toMatchObject({
      available: false,
      unavailableReason: 'signed-out',
      account: null,
    });
  });

  it('activates a successful login with sync explicitly disabled', async () => {
    identity = {
      ownerId: 'owner-a',
      username: 'alice',
      cloudBaseUrl: 'https://relay.test/api/musefold/v1',
    };
    activateOwner('owner-a', true, 'stable-device-a');

    await service.completeAccountLogin();

    expect(repository.getActiveAccount()).toMatchObject({
      ownerId: 'owner-a',
      deviceId: 'stable-device-a',
      enabled: false,
    });
    expect(clientFactory).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks cloud operations while an account transition is in progress', async () => {
    activateOwner('owner-a', true, 'stable-device-a');
    identity = {
      ownerId: 'owner-a',
      username: 'alice',
      cloudBaseUrl: 'https://relay.test/api/musefold/v1',
    };

    await service.prepareForAccountLogin();

    await expect(service.syncNow()).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    await expect(service.listConnections()).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(clientFactory).not.toHaveBeenCalled();
    expect(repository.getActiveAccount()).toBeNull();
  });

  it('keeps the transition gate closed when owner activation fails', async () => {
    activateOwner('owner-a', true, 'stable-device-a');
    identity = {
      ownerId: 'owner-a',
      username: 'alice',
      cloudBaseUrl: 'https://relay.test/api/musefold/v1',
    };
    await service.prepareForAccountLogin();
    vi.spyOn(repository, 'activateAccount').mockImplementationOnce(() => {
      throw new Error('sqlite unavailable');
    });

    await expect(service.completeAccountLogin()).rejects.toThrow('sqlite unavailable');
    await expect(service.syncNow()).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(repository.getActiveAccount()).toBeNull();
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("preserves each owner's device and cursor metadata across account switches", async () => {
    activateOwner('owner-a', true, 'stable-device-a');
    repository.markBootstrapCompleted('owner-a', '42');
    identity = {
      ownerId: 'owner-a',
      username: 'alice',
      cloudBaseUrl: 'https://relay.test/api/musefold/v1',
    };

    await service.prepareForAccountLogin();
    identity = {
      ownerId: 'owner-b',
      username: 'bob',
      cloudBaseUrl: 'https://relay.test/api/musefold/v1',
    };
    await service.completeAccountLogin();
    repository.markBootstrapCompleted('owner-b', '9');
    const ownerBDeviceId = repository.getActiveAccount()?.deviceId;

    await service.prepareForAccountLogin();
    identity = {
      ownerId: 'owner-a',
      username: 'alice',
      cloudBaseUrl: 'https://relay.test/api/musefold/v1',
    };
    await service.completeAccountLogin();

    expect(repository.getActiveAccount()).toMatchObject({
      ownerId: 'owner-a',
      deviceId: 'stable-device-a',
      cursor: '42',
      enabled: false,
    });
    expect(
      db
        .prepare('SELECT device_id, cursor, enabled FROM cloud_sync_accounts WHERE owner_id = ?')
        .get('owner-b'),
    ).toEqual({
      device_id: ownerBDeviceId,
      cursor: '9',
      enabled: 0,
    });
  });

  it('aborts the active cloud transport before logout removes credentials', async () => {
    identity = {
      ownerId: 'owner-a',
      username: 'alice',
      cloudBaseUrl: 'https://relay.test/api/musefold/v1',
    };
    const transport: { fetch?: typeof fetch; signal?: AbortSignal } = {};
    fetchImpl.mockImplementation(
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal) transport.signal = init.signal;
          transport.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    clientFactory.mockImplementation((_baseUrl: string, options: { fetchImpl: typeof fetch }) => {
      transport.fetch = options.fetchImpl;
      return {
        openDesktopSession: vi.fn(async () => ({ account: { id: 'owner-a' } })),
        listConnections: vi.fn(async () => ({ items: [] })),
      };
    });

    await service.completeAccountLogin();
    await service.listConnections();
    if (!transport.fetch) throw new Error('云客户端未创建 transport');
    const request = transport.fetch('https://relay.test/health');
    expect(transport.signal?.aborted).toBe(false);

    await service.prepareForAccountLogout();

    expect(transport.signal?.aborted).toBe(true);
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(repository.getActiveAccount()).toBeNull();
  });
});
