import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { expect, it } from 'vitest';
import { WorkbenchSessionStore, type WorkbenchSessionRecord } from '../workbench-sessions';

type Reply = { type: string; pid: number; code?: string; record?: WorkbenchSessionRecord };
function observe(child: ChildProcess, type: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Missing child ${type}`)), 15_000);
    const exited = () => finish(new Error(`Child exited before ${type}`));
    const received = (reply: Reply) => {
      if (reply.type === type) finish(null, reply);
    };
    function finish(error: Error | null, reply?: Reply) {
      clearTimeout(timer);
      child.off('message', received);
      child.off('exit', exited);
      child.off('error', finish);
      if (error) reject(error);
      else if (reply) resolve(reply);
    }
    child.on('message', received);
    child.on('exit', exited);
    child.on('error', finish);
  });
}

it('serializes two real OS writers through SQLite lock contention and preserves the winning version after restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'session-process-'));
  const path = join(directory, 'test.db');
  const db = new Database(path);
  const children: Array<{ child: ChildProcess; exited: Promise<void> }> = [];
  const launch = (id: string) => {
    const child = fork(
      fileURLToPath(new URL('./fixtures/session-store-process.ts', import.meta.url)),
      [path, id],
      {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    children.push({ child, exited });
    return {
      child,
      ready: observe(child, 'ready').catch((error) => {
        throw new Error(`${String(error)}: ${stderr}`);
      }),
    };
  };
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    takeoverDesktopDatabase(db);
    const initial = new WorkbenchSessionStore(db).create({ title: 'Initial' });
    const writers = [launch(initial.row.id), launch(initial.row.id)];
    const ready = await Promise.all(writers.map((writer) => writer.ready));
    expect(new Set(ready.map((reply) => reply.pid)).size).toBe(2);
    expect(
      ready.every((reply) => reply.pid !== process.pid && reply.record?.row.version === 1),
    ).toBe(true);
    db.exec('BEGIN IMMEDIATE');
    let completed = 0;
    const results = writers.map(({ child }) =>
      observe(child, 'result').then((reply) => {
        completed++;
        return reply;
      }),
    );
    // Attach rejection handlers immediately, including while waiting for lock admission.
    const settled = Promise.all(results);
    void settled.catch(() => {});
    const attempting = writers.map(({ child }) => observe(child, 'attempting'));
    writers.forEach(({ child }, index) =>
      child.send({ action: 'update', title: `Writer ${index}` }),
    );
    await Promise.all(attempting);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(completed).toBe(0);
    db.exec('COMMIT');
    const outcomes = await settled;
    expect(outcomes.filter((reply) => reply.record)).toHaveLength(1);
    expect(outcomes.filter((reply) => reply.code === 'WORKBENCH_VERSION_CONFLICT')).toHaveLength(1);
    const winner = outcomes.find((reply) => reply.record)?.record;
    expect(winner?.row.version).toBe(2);
    expect(winner?.draft.prompt).toBe(winner?.row.title);
    await Promise.all(children.map(({ exited }) => exited));
    const reader = launch(initial.row.id);
    const restarted = await reader.ready;
    expect(ready.map((reply) => reply.pid)).not.toContain(restarted.pid);
    expect(restarted.record).toEqual(winner);
    const result = observe(reader.child, 'result');
    reader.child.send({ action: 'read' });
    expect((await result).record).toEqual(winner);
  } finally {
    if (db.inTransaction) db.exec('ROLLBACK');
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await Promise.all(children.map(({ exited }) => exited));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
