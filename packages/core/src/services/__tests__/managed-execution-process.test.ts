import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { afterEach, describe, expect, it } from 'vitest';
import { ManagedExecutionRepository } from '../../db/repositories/managed-execution';
import { AutomationSpendRepository } from '../../db/repositories/automation-spend';
import { EncryptedManagedAnchorFile } from '../managed-execution-anchor-file';
import { ManagedExecutionGuard } from '../managed-execution-guard';
import { fixtureCipher } from './fixtures/managed-anchor-cipher';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function message<T>(child: ChildProcess, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Timeout waiting for ${type}`)), 10_000);
    const onExit = () => finish(new Error(`Process exited before ${type}`));
    const onMessage = (payload: unknown) => {
      const value = payload as { type: string; result: T };
      if (value.type === 'error') finish(new Error(String(value.result)));
      else if (value.type === type) finish(null, value.result);
    };
    function finish(error: Error | null, result?: T) {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(result as T);
    }
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

function closed(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture did not close')), 10_000);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-managed-process-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'local.db');
  const anchorPath = join(dir, 'managed.anchor');
  const backup = join(dir, 'old.db');
  const db = new Database(path);
  try {
    db.pragma('journal_mode = WAL');
    takeoverDesktopDatabase(db);
    new AutomationSpendRepository(db).initializeBudget(
      { monthlyLimitPoints: 10, usedPoints: 0, month: '2026-09' },
      1,
    );
    await new ManagedExecutionGuard(
      new ManagedExecutionRepository(db),
      new EncryptedManagedAnchorFile(anchorPath, fixtureCipher),
    ).enable();
    await db.backup(backup);
  } finally {
    db.close();
  }
  let sends = 0;
  const server = createServer((_req, res) => {
    sends += 1;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
  const providerUrl = `http://127.0.0.1:${address.port}/generate`;
  async function start(action: string) {
    const child = fork(
      fileURLToPath(new URL('./fixtures/managed-execution-process.ts', import.meta.url)),
      [path, anchorPath, action, providerUrl],
      {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    // Subscribe before ready/result to retain actual close evidence and avoid event races.
    const completion = closed(child);
    void completion.catch(() => undefined);
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-8192);
    });
    cleanup.push(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await completion;
    });
    try {
      await message(child, 'ready');
    } catch (error) {
      throw new Error(`${String(error)} ${stderr}`);
    }
    return { child, completion };
  }
  async function inspect() {
    const next = await start('inspect');
    const result = message<{
      pid: number;
      before: { mode: string };
      repaired: boolean;
      after: { mode: string };
      rejected: boolean;
      limit: number;
    }>(next.child, 'result');
    next.child.send('go');
    const value = await result;
    expect(await next.completion).toEqual({ code: 0, signal: null });
    return value;
  }
  return { path, backup, start, inspect, sends: () => sends };
}

describe('managed anchor independent-process crash boundary', () => {
  it.each(['pending-durable', 'db-committed', 'anchor-committed'])(
    'preserves durable evidence through SIGKILL at %s and a new process',
    async (phase) => {
      const f = await fixture();
      const current = await f.start(phase);
      const paused = message<{ pid: number; revision: number }>(current.child, 'paused');
      current.child.send('go');
      const observed = await paused;
      expect(observed.revision).toBe(phase === 'pending-durable' ? 0 : 1);
      expect(f.sends()).toBe(0);
      expect(current.child.kill('SIGKILL')).toBe(true);
      expect(await current.completion).toEqual({ code: null, signal: 'SIGKILL' });
      const recovered = await f.inspect();
      expect(recovered.pid).not.toBe(observed.pid);
      expect(recovered.before.mode).toBe(phase === 'anchor-committed' ? 'active' : 'query_only');
      expect(recovered.repaired).toBe(phase === 'db-committed');
      expect(recovered.after.mode).toBe(phase === 'pending-durable' ? 'query_only' : 'active');
      expect(recovered.rejected).toBe(phase === 'pending-durable');
      expect(recovered.limit).toBe(phase === 'pending-durable' ? 10 : 4);
      expect(f.sends()).toBe(0);
    },
    20_000,
  );

  it('detects an actual old DB backup after a successful operation without overwriting the anchor', async () => {
    const f = await fixture();
    const current = await f.start('complete');
    const result = message<{ pid: number }>(current.child, 'result');
    current.child.send('go');
    await result;
    expect(await current.completion).toEqual({ code: 0, signal: null });
    expect(f.sends()).toBe(1);
    expect((await f.inspect()).after.mode).toBe('active');
    // No process holds the DB: copy an actual SQLite backup with its old checkpoint and budget.
    copyFileSync(f.backup, f.path);
    const recovered = await f.inspect();
    expect(recovered).toMatchObject({
      before: { mode: 'query_only' },
      repaired: false,
      after: { mode: 'query_only' },
      rejected: true,
      limit: 10,
    });
    expect(f.sends()).toBe(1);
  }, 20_000);
});
