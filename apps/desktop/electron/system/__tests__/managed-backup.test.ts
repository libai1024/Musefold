import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureCipher } from '@musefold/core/services/__tests__/fixtures/managed-anchor-cipher';
import { configureTestCoreRuntime, testCorePaths } from '@musefold/core/testing';
import {
  beginDatabaseRestore,
  captureDatabaseAccess,
  closeDb,
  getDb,
  initDb,
} from '@musefold/core/db/index';
import { ManagedExecutionRepository } from '@musefold/core/db/repositories/managed-execution';
import { ManagedExecutionGuard } from '@musefold/core/services/managed-execution-guard';

const state = vi.hoisted(() => ({
  root: '',
  available: true,
  failInstall: false,
  encrypt: (s: string): Buffer => Buffer.from(s),
  decrypt: (b: Buffer): string => b.toString(),
  stop: vi.fn(async () => {}),
}));
vi.mock('electron', () => ({
  app: { getPath: () => state.root },
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (s: string) => state.encrypt(s),
    decryptString: (b: Buffer) => state.decrypt(b),
    getSelectedStorageBackend: () => 'gnome_libsecret',
  },
}));
vi.mock('../../main/ipc-v25/sync-domain', () => ({ stopV25CloudSync: state.stop }));
vi.mock('../logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {} }) }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (state.failInstall && from.includes('.restore-next-'))
        throw new Error('fixture install failure');
      return actual.rename(from, to);
    },
  };
});
import { createBackup, listBackups, pruneBackups, restoreBackup } from '../backup';
import {
  createManagedExecutionAnchor,
  MANAGED_ANCHOR_FILE,
} from '../../security/managed-execution-anchor';
import {
  managedExecutionWorkScope,
  ManagedExecutionWorkScope,
  withManagedExecution,
} from '../managed-execution';

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'musefold-managed-restore-'));
  state.available = true;
  state.failInstall = false;
  state.encrypt = fixtureCipher.encrypt;
  state.decrypt = fixtureCipher.decrypt;
  state.stop.mockReset();
  state.stop.mockResolvedValue();
  configureTestCoreRuntime(state.root);
  initDb();
  getDb()
    .prepare('INSERT INTO workbench_sessions(id,title,created_at,updated_at) VALUES (?,?,?,?)')
    .run('fixture-session', 'old', 1, 1);
});
afterEach(() => {
  closeDb();
  rmSync(state.root, { recursive: true, force: true });
});

async function enable() {
  const anchor = createManagedExecutionAnchor();
  const guard = new ManagedExecutionGuard(new ManagedExecutionRepository(getDb()), anchor);
  await guard.enable();
  return { anchor, guard };
}
function title(path: string): string {
  const db = new Database(path, { readonly: true });
  try {
    return (
      db.prepare('SELECT title FROM workbench_sessions WHERE id=?').get('fixture-session') as {
        title: string;
      }
    ).title;
  } finally {
    db.close();
  }
}

describe('official backup restore with managed anchor and database barrier', () => {
  it('restores real old bytes, pins the safety backup and prohibits lazy reopen by this process', async () => {
    const source = await createBackup();
    const { anchor } = await enable();
    getDb().prepare('UPDATE workbench_sessions SET title=?').run('new');
    const assertCurrent = captureDatabaseAccess();
    const oldDb = getDb();
    const result = await restoreBackup(basename(source));
    expect(state.stop).toHaveBeenCalledOnce();
    expect(title(testCorePaths(state.root).db)).toBe('old');
    expect(title(result.safetyBackupPath)).toBe('new');
    expect(basename(result.safetyBackupPath)).toMatch(/^recovery-safety-/);
    expect(await anchor.read()).toMatchObject({ mode: 'query_only', reason: 'restore_pending' });
    expect(() => assertCurrent()).toThrow('数据库恢复期间');
    expect(() => getDb()).toThrow('数据库恢复期间');
    expect(() => initDb()).toThrow('数据库恢复期间');
    expect(oldDb.open).toBe(false);
    expect(() => oldDb.prepare('UPDATE workbench_sessions SET title=?').run('late')).toThrow();
    for (let i = 0; i < 15; i++)
      writeFileSync(join(testCorePaths(state.root).backups, `backup-99999999-${i}.db`), 'fixture');
    await pruneBackups();
    expect(existsSync(result.safetyBackupPath)).toBe(true);
    expect((await listBackups()).find((row) => row.path === result.safetyBackupPath)).toMatchObject(
      { kind: 'auto' },
    );
  });

  it('does not bootstrap an anchor for a user who never enabled managed execution', async () => {
    const source = await createBackup();
    await restoreBackup(basename(source));
    expect(existsSync(join(state.root, MANAGED_ANCHOR_FILE))).toBe(false);
  });

  it('rejects malformed backups before fencing or modifying the active database', async () => {
    const source = await createBackup();
    writeFileSync(source, 'fixture invalid SQLite');
    await expect(restoreBackup(basename(source))).rejects.toMatchObject({ code: 'INVALID_BACKUP' });
    expect(getDb().open).toBe(true);
    expect(state.stop).not.toHaveBeenCalled();
  });

  it.each(['future', 'rewritten', 'missing'])(
    'rejects a %s Drizzle chain even when user_version matches',
    async (kind) => {
      const source = await createBackup();
      const candidate = new Database(source);
      try {
        if (kind === 'future')
          candidate
            .prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)')
            .run('fixture-future', 9999999999999);
        else if (kind === 'rewritten')
          expect(
            candidate
              .prepare(
                'UPDATE __drizzle_migrations SET hash=? WHERE created_at=(SELECT MAX(created_at) FROM __drizzle_migrations)',
              )
              .run('fixture-rewritten').changes,
          ).toBe(1);
        else
          expect(
            candidate
              .prepare(
                'DELETE FROM __drizzle_migrations WHERE created_at=(SELECT MIN(created_at) FROM __drizzle_migrations)',
              )
              .run().changes,
          ).toBe(1);
      } finally {
        candidate.close();
      }
      await expect(restoreBackup(basename(source))).rejects.toMatchObject({
        code: 'INCOMPATIBLE_BACKUP',
      });
      expect(getDb().open).toBe(true);
      expect(state.stop).not.toHaveBeenCalled();
    },
  );

  it('retains the current DB and safety backup when managed ciphertext cannot be decrypted', async () => {
    const source = await createBackup();
    await enable();
    getDb().prepare('UPDATE workbench_sessions SET title=?').run('new');
    const oldDb = getDb();
    writeFileSync(join(state.root, MANAGED_ANCHOR_FILE), 'fixture corrupt');
    await expect(restoreBackup(basename(source))).rejects.toMatchObject({ code: 'RESTORE_FAILED' });
    expect(oldDb.open).toBe(true);
    expect(title(testCorePaths(state.root).db)).toBe('new');
    expect(() => getDb()).toThrow('数据库恢复期间');
    expect(
      readdirSync(testCorePaths(state.root).backups).filter((name) =>
        name.startsWith('recovery-safety-'),
      ),
    ).toHaveLength(1);
    expect(readdirSync(state.root).filter((name) => name.includes('.restore-next-'))).toHaveLength(
      0,
    );
  });

  it('rolls back a failed file installation but keeps the DB closed and anchor suspended', async () => {
    const source = await createBackup();
    const { anchor } = await enable();
    getDb().prepare('UPDATE workbench_sessions SET title=?').run('new');
    state.failInstall = true;
    await expect(restoreBackup(basename(source))).rejects.toMatchObject({ code: 'RESTORE_FAILED' });
    expect(title(testCorePaths(state.root).db)).toBe('new');
    expect(await anchor.read()).toMatchObject({ mode: 'query_only', reason: 'restore_pending' });
    expect(() => initDb()).toThrow('数据库恢复期间');
  });

  it('fences new work, aborts and drains old managed work before touching the restore file', async () => {
    const source = await createBackup();
    await enable();
    const oldDb = getDb();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let aborted!: () => void;
    const abortSeen = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const work = withManagedExecution(async ({ signal, assertCurrent }) => {
      signal.addEventListener('abort', aborted, { once: true });
      started();
      await barrier;
      expect(() => assertCurrent()).toThrow('数据库恢复期间');
    });
    const workResult = work.catch((error) => error);
    await ready;
    const restore = restoreBackup(basename(source));
    await abortSeen;
    expect(oldDb.open).toBe(true);
    expect(state.stop).not.toHaveBeenCalled();
    await expect(restoreBackup(basename(source))).rejects.toMatchObject({ code: 'RESTORE_FAILED' });
    await expect(managedExecutionWorkScope().run(async () => undefined)).rejects.toMatchObject({
      code: 'MANAGED_RESTART_REQUIRED',
    });
    expect(() => beginDatabaseRestore()).toThrow('数据库恢复期间');
    release();
    await workResult;
    await restore;
    expect(oldDb.open).toBe(false);
  });

  it('never enables a lineage when real OS encryption is unavailable, even in E2E mode', async () => {
    state.available = false;
    const before = process.env.MUSEFOLD_E2E;
    process.env.MUSEFOLD_E2E = '1';
    try {
      await expect(enable()).rejects.toMatchObject({ code: 'MANAGED_ENCRYPTION_UNAVAILABLE' });
    } finally {
      if (before === undefined) delete process.env.MUSEFOLD_E2E;
      else process.env.MUSEFOLD_E2E = before;
    }
    expect(existsSync(join(state.root, MANAGED_ANCHOR_FILE))).toBe(false);
    expect(new ManagedExecutionRepository(getDb()).checkpoint()).toBeNull();
  });

  it('does not expose plaintext in a real file and preserves ciphertext if encryption disappears', async () => {
    const { anchor } = await enable();
    const stored = await anchor.read();
    if (!stored) throw new Error('Missing fixture anchor');
    const bytes = readFileSync(join(state.root, MANAGED_ANCHOR_FILE));
    expect(bytes.toString()).not.toContain(stored.committed?.namespace);
    state.available = false;
    await expect(anchor.write(stored)).rejects.toMatchObject({
      code: 'MANAGED_ENCRYPTION_UNAVAILABLE',
    });
    expect(readFileSync(join(state.root, MANAGED_ANCHOR_FILE))).toEqual(bytes);
  });
});

describe('bounded managed work drain', () => {
  it('excludes enablement from live work and blocks new work while enablement awaits storage', async () => {
    const scope = new ManagedExecutionWorkScope();
    let release!: () => void;
    const work = scope.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await expect(scope.runExclusive(async () => {})).rejects.toThrow('MANAGED_ENABLEMENT_BUSY');
    release();
    await work;
    const enabling = scope.runExclusive(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await expect(scope.run(async () => {})).rejects.toThrow('MANAGED_ENABLEMENT_BUSY');
    await expect(scope.runExclusive(async () => {})).rejects.toThrow('MANAGED_ENABLEMENT_BUSY');
    release();
    await enabling;
    await expect(scope.run(async () => 1)).resolves.toBe(1);
  });

  it('drains an exclusive enablement and never reopens an old process for work', async () => {
    const scope = new ManagedExecutionWorkScope();
    const enabling = scope.runExclusive(
      (signal) =>
        new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        ),
    );
    await Promise.resolve();
    await scope.drainForRestore(1000);
    await enabling;
    await expect(scope.runExclusive(async () => {})).rejects.toThrow('MANAGED_RESTART_REQUIRED');
  });

  it('times out without admitting new work when an operation ignores cancellation', async () => {
    const scope = new ManagedExecutionWorkScope();
    let release!: () => void;
    const work = scope.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    await expect(scope.drainForRestore(10)).rejects.toMatchObject({
      code: 'MANAGED_DRAIN_TIMEOUT',
    });
    await expect(scope.run(async () => undefined)).rejects.toMatchObject({
      code: 'MANAGED_RESTART_REQUIRED',
    });
    release();
    await work;
    await scope.drainForRestore();
  });
});
