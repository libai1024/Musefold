import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { closeDb, getDb, initDb } from '@musefold/core/db';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), saveKey: vi.fn(), deleteKey: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => '/unused-test-path' } }));
vi.mock('../account-cloud-connection', () => ({
  useAccountCloudProvider: mocks.verify,
  managedConnectionMessage: () => '账号连接需要重新核对',
}));
vi.mock('../../security/keychain', () => ({
  saveApiKey: mocks.saveKey,
  deleteApiKey: mocks.deleteKey,
  getKeySuffix: () => 'test',
  hasApiKey: () => true,
}));
vi.mock('../../settings/pricing', () => ({ deleteProviderPricing: vi.fn() }));
vi.mock('../backup', () => ({
  createBackup: vi.fn(),
  listBackups: vi.fn(),
  restoreBackup: vi.fn(),
}));
vi.mock('../export', () => ({ runExport: vi.fn(), defaultExportName: vi.fn() }));
vi.mock('../import', () => ({ runImport: vi.fn() }));

import { createElectronLocalAdminOps } from '../../main/automation-local';
import {
  activateImageProvider,
  assertProviderEditable,
  removeImageProviderRow,
} from '../provider-connections';

const directory = mkdtempSync(join(tmpdir(), 'musefold-provider-policy-'));
configureTestCoreRuntime(directory);
beforeAll(() => initDb());
afterAll(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockImplementation(async (_id: string, action: () => unknown) => action());
  getDb().prepare('DELETE FROM providers').run();
  const insert =
    getDb().prepare(`INSERT INTO providers(id,name,type,base_url,model,is_active,managed_by,created_at,updated_at)
    VALUES(?,?,?,'https://fixture.example.invalid/v1','fixture',?,?,1,?)`);
  insert.run('current', 'current', 'openai-compatible', 1, null, 1);
  insert.run('spare', 'spare', 'openai-compatible', 0, null, 2);
  insert.run('legacy', 'legacy', 'openai-compatible', 0, 'account', 3);
  insert.run('cloud', 'cloud', 'musefold-cloud', 0, 'account', 4);
});
const rows = () => getDb().prepare('SELECT * FROM providers ORDER BY id').all();
const active = () =>
  getDb().prepare('SELECT id FROM providers WHERE is_active = 1 ORDER BY id').all();

describe('shared image connection policy', () => {
  it('rejects cloud edits before key storage and preserves the row', async () => {
    const before = rows();
    expect(() => assertProviderEditable('cloud')).toThrow('账号云连接');
    await expect(
      createElectronLocalAdminOps().setProviderKey('cloud', 'synthetic'),
    ).rejects.toMatchObject({ code: 'MANAGED_CONNECTION_IMMUTABLE', status: 409 });
    expect(mocks.saveKey).not.toHaveBeenCalled();
    expect(rows()).toEqual(before);
  });
  it('waits for cloud identity verification before changing the default', async () => {
    let release!: () => void;
    const latch = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.verify.mockImplementation(async (_id: string, action: () => unknown) => {
      await latch;
      return action();
    });
    const pending = activateImageProvider('cloud');
    await vi.waitFor(() => expect(mocks.verify).toHaveBeenCalled());
    expect(active()).toEqual([{ id: 'current' }]);
    release();
    await pending;
    expect(active()).toEqual([{ id: 'cloud' }]);
  });
  it('preserves default when cloud verification or a missing target is rejected', async () => {
    mocks.verify.mockRejectedValue({ code: 'MANAGED_IDENTITY_CHANGED' });
    await expect(createElectronLocalAdminOps().setActiveProvider('cloud')).rejects.toMatchObject({
      code: 'MANAGED_CONNECTION_UNAVAILABLE',
      status: 409,
    });
    await expect(activateImageProvider('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(active()).toEqual([{ id: 'current' }]);
  });
  it('selects BYOK instead of newer cloud or legacy account rows after deletion', async () => {
    await createElectronLocalAdminOps().deleteProvider('current');
    expect(active()).toEqual([{ id: 'spare' }]);
    expect(mocks.deleteKey).toHaveBeenCalledWith('current');
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('leaves no default when only account connections remain', () => {
    removeImageProviderRow('spare');
    removeImageProviderRow('current');
    expect(active()).toEqual([]);
  });
  it('rolls back deletion and keeps the key when replacement activation fails', async () => {
    getDb().exec(
      "CREATE TRIGGER policy_fail_activation BEFORE UPDATE OF is_active ON providers WHEN NEW.id = 'spare' AND NEW.is_active = 1 BEGIN SELECT RAISE(ABORT, 'forced takeover'); END",
    );
    const before = rows();
    try {
      await expect(createElectronLocalAdminOps().deleteProvider('current')).rejects.toThrow(
        'forced takeover',
      );
      expect(rows()).toEqual(before);
      expect(mocks.deleteKey).not.toHaveBeenCalled();
    } finally {
      getDb().exec('DROP TRIGGER policy_fail_activation');
    }
  });
  it.each(['musefold-cloud', 'unregistered-provider'])(
    'rejects local creation type %s before replacing the default',
    (type) => {
      const before = rows();
      expect(() =>
        createElectronLocalAdminOps().createProvider({
          name: 'invalid',
          type,
          baseUrl: 'https://fixture.example.invalid',
          model: 'fixture',
          isActive: true,
        }),
      ).toThrow('支持的本地连接类型');
      expect(rows()).toEqual(before);
    },
  );
  it('rolls back the old default if a valid local creation insert fails', () => {
    getDb().exec(
      "CREATE TRIGGER policy_fail_insert BEFORE INSERT ON providers BEGIN SELECT RAISE(ABORT, 'forced insert'); END",
    );
    const before = rows();
    try {
      expect(() =>
        createElectronLocalAdminOps().createProvider({
          name: 'fixture',
          type: 'openai-compatible',
          baseUrl: 'https://fixture.example.invalid',
          model: 'fixture',
          isActive: true,
        }),
      ).toThrow('forced insert');
      expect(rows()).toEqual(before);
    } finally {
      getDb().exec('DROP TRIGGER policy_fail_insert');
    }
  });
  it('preserves BYOK key/activation and validates cloud through account verification', async () => {
    const ops = createElectronLocalAdminOps();
    await ops.setProviderKey('spare', 'synthetic');
    expect(mocks.saveKey).toHaveBeenCalledWith('spare', 'synthetic');
    await ops.setActiveProvider('spare');
    expect(active()).toEqual([{ id: 'spare' }]);
    expect(mocks.verify).not.toHaveBeenCalled();
    await expect(ops.validateProvider('cloud')).resolves.toMatchObject({ ok: true });
    expect(active()).toEqual([{ id: 'spare' }]);
    expect(mocks.verify).toHaveBeenCalledWith('cloud', expect.any(Function));
  });
});
