import {
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  symlinkSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { DESKTOP_MIGRATIONS } from '@musefold/desktop-db/migrations.generated';
import { afterEach, describe, expect, it } from 'vitest';
import { ManagedExecutionGuard, type ManagedExecutionAnchorPort } from '../managed-execution-guard';
import { EncryptedManagedAnchorFile } from '../managed-execution-anchor-file';
import {
  ManagedExecutionRepository,
  planManagedOperation,
} from '../../db/repositories/managed-execution';
import { AutomationSpendRepository } from '../../db/repositories/automation-spend';
import { fixtureCipher } from './fixtures/managed-anchor-cipher';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-managed-guard-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const db = new Database(join(dir, 'data.db'));
  cleanup.push(() => {
    if (db.open) db.close();
  });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  const repository = new ManagedExecutionRepository(db);
  const path = join(dir, 'managed.anchor');
  const anchor = new EncryptedManagedAnchorFile(path, fixtureCipher);
  const guard = new ManagedExecutionGuard(repository, anchor);
  const spend = new AutomationSpendRepository(db);
  spend.initializeBudget({ monthlyLimitPoints: 10, usedPoints: 0, month: '2026-09' }, 1);
  return { dir, path, db, repository, anchor, guard, spend };
}

describe('managed execution checkpoint coordination', () => {
  it('does not enable a migrated database or write a file when inspected', async () => {
    const f = fixture();
    expect(await f.guard.status()).toEqual({ mode: 'not_enabled' });
    expect(f.repository.checkpoint()).toBeNull();
    expect(await f.anchor.read()).toBeNull();
    await f.guard.enable();
    expect(await f.guard.status()).toMatchObject({ mode: 'active', checkpoint: { revision: 0 } });
    await expect(f.guard.enable()).rejects.toMatchObject({ code: 'MANAGED_ALREADY_INITIALIZED' });
    expect(readFileSync(f.path).toString('utf8')).not.toContain(
      f.repository.checkpoint()?.namespace,
    );
    if (process.platform !== 'win32') expect(statSync(f.path).mode & 0o777).toBe(0o600);
  });

  it('commits budget and checkpoint together, preserving lineage across accounts and months', async () => {
    const f = fixture();
    await f.guard.enable();
    const original = f.repository.checkpoint();
    await f.guard.mutate('budget', { limit: 4 }, () => f.spend.setBudgetLimit(4, 2));
    expect(f.spend.budget(Date.UTC(2026, 9, 1)).monthlyLimitPoints).toBe(4);
    expect(f.repository.checkpoint()).toMatchObject({
      lineageId: original?.lineageId,
      namespace: original?.namespace,
      revision: 1,
    });
    expect((await f.anchor.read())?.committed).toEqual(f.repository.checkpoint());
  });

  it('serializes separate guard/file instances sharing the same canonical destination', async () => {
    const f = fixture();
    await f.guard.enable();
    const second = new ManagedExecutionGuard(
      f.repository,
      new EncryptedManagedAnchorFile(f.path, fixtureCipher),
    );
    await Promise.all([
      f.guard.mutate('budget', { limit: 4 }, () => f.spend.setBudgetLimit(4, 2)),
      second.mutate('budget', { limit: 3 }, () => f.spend.setBudgetLimit(3, 3)),
    ]);
    expect(f.repository.checkpoint()?.revision).toBe(2);
    expect(f.spend.budget(3).monthlyLimitPoints).toBe(3);
    expect(await second.status()).toMatchObject({ mode: 'active' });
  });

  it('rolls back business writes on failure, but does not erase the durable pending marker', async () => {
    const f = fixture();
    await f.guard.enable();
    await expect(
      f.guard.mutate('budget', { limit: 99 }, () => {
        f.spend.setBudgetLimit(99, 2);
        throw new Error('fixture failure');
      }),
    ).rejects.toThrow('fixture failure');
    expect(f.spend.budget(2).monthlyLimitPoints).toBe(10);
    expect(f.repository.checkpoint()?.revision).toBe(0);
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
    expect(await f.guard.recoverCommittedOperation()).toBe(false);
    await expect(
      f.guard.mutate('budget', {}, () => f.spend.setBudgetLimit(99, 3)),
    ).rejects.toMatchObject({ code: 'MANAGED_RECONCILIATION_REQUIRED' });
  });

  it('does not touch SQLite if the pending anchor write fails', async () => {
    const f = fixture();
    await f.guard.enable();
    const failing: ManagedExecutionAnchorPort = {
      scope: f.anchor.scope,
      read: () => f.anchor.read(),
      write: async () => {
        throw new Error('fixture IO failure');
      },
    };
    const guard = new ManagedExecutionGuard(f.repository, failing);
    await expect(guard.mutate('budget', {}, () => f.spend.setBudgetLimit(99, 3))).rejects.toThrow(
      'fixture IO failure',
    );
    expect(f.repository.checkpoint()?.revision).toBe(0);
    expect(f.spend.budget(3).monthlyLimitPoints).toBe(10);
  });

  it('repairs only the exact committed DB target after the final anchor write fails', async () => {
    const f = fixture();
    await f.guard.enable();
    const failing: ManagedExecutionAnchorPort = {
      scope: f.anchor.scope,
      read: () => f.anchor.read(),
      write: async (value) => {
        if (!value.pending) throw new Error('fixture final flush');
        await f.anchor.write(value);
      },
    };
    await expect(
      new ManagedExecutionGuard(f.repository, failing).mutate('budget', { limit: 4 }, () =>
        f.spend.setBudgetLimit(4, 2),
      ),
    ).rejects.toThrow('fixture final flush');
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
    expect(f.spend.budget(2).monthlyLimitPoints).toBe(4);
    expect(await f.guard.recoverCommittedOperation()).toBe(true);
    expect(await f.guard.recoverCommittedOperation()).toBe(false);
    expect(await f.guard.status()).toMatchObject({ mode: 'active', checkpoint: { revision: 1 } });
  });

  it('rejects restored older, newer and same-revision divergent DB checkpoints', async () => {
    const f = fixture();
    await f.guard.enable();
    await f.guard.mutate('budget', {}, () => f.spend.setBudgetLimit(4, 2));
    for (const revision of [0, 2]) {
      f.db.prepare('UPDATE managed_execution_checkpoint SET revision = ?').run(revision);
      expect(await f.guard.status()).toEqual({ mode: 'query_only' });
      await expect(f.guard.resumeMatchingCheckpoint()).rejects.toMatchObject({
        code: 'MANAGED_RECONCILIATION_REQUIRED',
      });
    }
    f.db
      .prepare('UPDATE managed_execution_checkpoint SET revision = 1, head_hash = ?')
      .run('a'.repeat(64));
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
  });

  it('does not regenerate missing or unreadable anchors after a DB lineage exists', async () => {
    const f = fixture();
    await f.guard.enable();
    unlinkSync(f.path);
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
    await expect(f.guard.enable()).rejects.toMatchObject({ code: 'MANAGED_ALREADY_INITIALIZED' });
    writeFileSync(f.path, 'fixture corrupt ciphertext');
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
    await expect(f.guard.enable()).rejects.toMatchObject({ code: 'MANAGED_ANCHOR_UNREADABLE' });
  });

  it('requires explicit matching-backup resume after restore suspension', async () => {
    const f = fixture();
    await f.guard.enable();
    await f.guard.suspendForRestore();
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
    expect(await f.guard.recoverCommittedOperation()).toBe(false);
    await f.guard.resumeMatchingCheckpoint();
    expect(await f.guard.status()).toMatchObject({ mode: 'active' });
    f.db.exec('DELETE FROM managed_execution_checkpoint');
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
    await expect(f.guard.enable()).rejects.toMatchObject({ code: 'MANAGED_ALREADY_INITIALIZED' });
  });

  it('does not activate when a resume file write reports failure after installing bytes', async () => {
    const f = fixture();
    await f.guard.enable();
    await f.guard.suspendForRestore();
    const before = f.repository.checkpoint();
    const failing = new ManagedExecutionGuard(f.repository, {
      scope: f.anchor.scope,
      read: () => f.anchor.read(),
      write: async (value) => {
        await f.anchor.write(value);
        throw new Error('fixture directory flush failed after rename');
      },
    });
    await expect(failing.resumeMatchingCheckpoint()).rejects.toThrow('fixture directory flush');
    expect(f.repository.checkpoint()).toEqual(before);
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
    expect(await f.guard.recoverCommittedOperation()).toBe(false);
  });

  it('revalidates the live review after asynchronous persistence before activation', async () => {
    const f = fixture();
    await f.guard.enable();
    await f.guard.suspendForRestore();
    const before = f.repository.checkpoint();
    let valid = true;
    const changing = new ManagedExecutionGuard(f.repository, {
      scope: f.anchor.scope,
      read: () => f.anchor.read(),
      write: async (value) => {
        await f.anchor.write(value);
        valid = false;
      },
    });
    await expect(
      changing.resumeMatchingCheckpoint(() => {
        if (!valid) throw new Error('fixture review changed');
      }),
    ).rejects.toThrow('fixture review changed');
    expect(f.repository.checkpoint()).toEqual(before);
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
    expect(await f.guard.recoverCommittedOperation()).toBe(false);
    expect(await f.guard.canResumeMatchingCheckpoint()).toBe(true);
    const pending = await f.anchor.read();
    expect(pending?.pending?.kind).toBe('resume');
    await f.guard.resumeMatchingCheckpoint();
    expect(f.repository.checkpoint()).toEqual(pending?.pending?.to);
    expect(f.repository.checkpoint()?.revision).toBe((before?.revision ?? -1) + 1);
    const committed = f.repository.checkpoint();
    await f.guard.resumeMatchingCheckpoint();
    expect(f.repository.checkpoint()).toEqual(committed);
    expect(f.spend.budget(2).usedPoints).toBe(0);
  });

  it.each([false, true])(
    'committed resume survives cleanup failure (installed=%s) and supports later operations',
    async (installed) => {
      const f = fixture();
      await f.guard.enable();
      await f.guard.suspendForRestore();
      const before = f.repository.checkpoint();
      const cleanupFailure = new ManagedExecutionGuard(f.repository, {
        scope: f.anchor.scope,
        read: () => f.anchor.read(),
        write: async (value) => {
          if (!value.pending) {
            if (installed) await f.anchor.write(value);
            throw new Error('fixture optional compaction failure');
          }
          await f.anchor.write(value);
        },
      });
      await cleanupFailure.resumeMatchingCheckpoint();
      expect(f.repository.checkpoint()?.revision).toBe((before?.revision ?? -1) + 1);
      expect(await f.guard.status()).toMatchObject({
        mode: 'active',
        checkpoint: f.repository.checkpoint(),
      });
      if (!installed) expect((await f.anchor.read())?.pending?.kind).toBe('resume');
      await f.guard.suspendForRestore();
      expect(await f.anchor.read()).toMatchObject({
        mode: 'query_only',
        pending: null,
        committed: f.repository.checkpoint(),
      });
      expect(await f.guard.canResumeMatchingCheckpoint()).toBe(true);
      await cleanupFailure.resumeMatchingCheckpoint();
      await f.guard.mutate('budget', { limit: 4 }, () => f.spend.setBudgetLimit(4, 2));
      expect(f.spend.budget(2).monthlyLimitPoints).toBe(4);
      expect(await f.guard.status()).toMatchObject({ mode: 'active' });
    },
  );

  it('does not treat an uncommitted spend operation as a resumable confirmation', async () => {
    const f = fixture();
    await f.guard.enable();
    await expect(
      f.guard.mutate('budget', {}, () => {
        throw new Error('fixture rollback');
      }),
    ).rejects.toThrow();
    expect(await f.guard.canResumeMatchingCheckpoint()).toBe(false);
    await expect(f.guard.resumeMatchingCheckpoint()).rejects.toThrow(
      'MANAGED_RECONCILIATION_REQUIRED',
    );
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
  });

  it('rejects a stale SQLite CAS without applying its business callback', async () => {
    const f = fixture();
    await f.guard.enable();
    const stale = planManagedOperation(f.repository.checkpoint(), 'budget', {});
    await f.guard.mutate('budget', {}, () => f.spend.setBudgetLimit(4, 2));
    expect(() => f.repository.commit(stale, () => f.spend.setBudgetLimit(99, 3))).toThrow(
      'MANAGED_CHECKPOINT_CONFLICT',
    );
    expect(f.spend.budget(3).monthlyLimitPoints).toBe(4);
  });

  it('rejects async callbacks before invocation and nested outer transactions', async () => {
    const f = fixture();
    await f.guard.enable();
    const plan = planManagedOperation(f.repository.checkpoint(), 'budget', {});
    let invoked = false;
    expect(() =>
      f.repository.commit(plan, async () => {
        invoked = true;
        await Promise.resolve();
        f.spend.setBudgetLimit(99, 3);
      }),
    ).toThrow('MANAGED_ASYNC_TRANSACTION');
    await Promise.resolve();
    expect(invoked).toBe(false);
    expect(() => f.db.transaction(() => f.repository.commit(plan, () => undefined))()).toThrow(
      'MANAGED_NESTED_TRANSACTION',
    );
    expect(f.repository.checkpoint()?.revision).toBe(0);
    expect(f.spend.budget(3).monthlyLimitPoints).toBe(10);
  });

  it('migrates an actual 0007 database without enabling a lineage or changing its policy', () => {
    const f = fixture();
    const old = new Database(join(f.dir, 'old.db'));
    cleanup.push(() => old.close());
    old.exec(
      'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)',
    );
    for (const migration of DESKTOP_MIGRATIONS.slice(0, 8)) {
      for (const sql of migration.sql) old.exec(sql);
      old
        .prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)')
        .run(migration.hash, migration.folderMillis);
    }
    const spend = new AutomationSpendRepository(old);
    spend.initializeBudget({ monthlyLimitPoints: 6, usedPoints: 2.5, month: '2026-09' }, 1);
    expect(
      old.prepare("SELECT name FROM sqlite_master WHERE name='managed_execution_checkpoint'").get(),
    ).toBeUndefined();
    takeoverDesktopDatabase(old);
    takeoverDesktopDatabase(old);
    expect(new ManagedExecutionRepository(old).checkpoint()).toBeNull();
    expect(spend.budget(Date.UTC(2026, 8, 8))).toMatchObject({
      monthlyLimitPoints: 6,
      usedPoints: 2.5,
    });
    expect(old.pragma('foreign_key_check')).toEqual([]);
    expect(old.pragma('integrity_check', { simple: true })).toBe('ok');
  });
});

describe('encrypted anchor file boundary', () => {
  it.skipIf(process.platform === 'win32')(
    'rejects a FIFO without waiting for a writer',
    async () => {
      const f = fixture();
      execFileSync('mkfifo', [f.path]);
      await expect(f.anchor.read()).rejects.toMatchObject({ code: 'MANAGED_ANCHOR_UNREADABLE' });
    },
  );

  it('rejects symlinks and directories without changing their targets', async () => {
    const f = fixture();
    await f.guard.enable();
    const anchor = await f.anchor.read();
    if (!anchor) throw new Error('Missing fixture anchor');
    const target = join(f.dir, 'target');
    writeFileSync(target, 'preserve target');
    unlinkSync(f.path);
    symlinkSync(target, f.path);
    await expect(f.anchor.read()).rejects.toMatchObject({ code: 'MANAGED_ANCHOR_UNREADABLE' });
    await expect(f.anchor.write(anchor)).rejects.toMatchObject({
      code: 'MANAGED_ANCHOR_WRITE_FAILED',
    });
    expect(readFileSync(target, 'utf8')).toBe('preserve target');
    await expect(new EncryptedManagedAnchorFile(f.dir, fixtureCipher).read()).rejects.toMatchObject(
      { code: 'MANAGED_ANCHOR_UNREADABLE' },
    );
    expect(readdirSync(f.dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('bounds ciphertext before decrypting and preserves the old file when encryption fails', async () => {
    const f = fixture();
    await f.guard.enable();
    const anchor = await f.anchor.read();
    if (!anchor) throw new Error('Missing fixture anchor');
    const original = readFileSync(f.path);
    const failing = new EncryptedManagedAnchorFile(f.path, {
      ...fixtureCipher,
      encrypt: () => {
        throw new Error('fixture secret canary');
      },
    });
    await expect(failing.write(anchor)).rejects.toThrow('MANAGED_ANCHOR_WRITE_FAILED');
    expect(readFileSync(f.path)).toEqual(original);
    writeFileSync(f.path, Buffer.alloc(65537));
    await expect(f.anchor.read()).rejects.toMatchObject({ code: 'MANAGED_ANCHOR_UNREADABLE' });
  });
});
