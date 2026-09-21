import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import type { GenerationExecutionReceipt } from '@musefold/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationSpendRepository } from '../../db/repositories/automation-spend';
import { ManagedExecutionRepository } from '../../db/repositories/managed-execution';
import { EncryptedManagedAnchorFile } from '../managed-execution-anchor-file';
import { ManagedExecutionGuard } from '../managed-execution-guard';
import { ManagedGenerationLedger } from '../managed-generation-ledger';
import { fixtureCipher } from './fixtures/managed-anchor-cipher';
import { managedCommand } from './fixtures/managed-generation';

// C3-B 第二层（路线图 §6.21）：真实 SQLite 文件 + 回环 HTTP + 真实子进程，
// 在「结算落库前」这一真实边界暂停，验证交错启用/新预留/重复完成/换号/恢复。
// 与 managed-generation-process.test.ts 分工：那边验证丢回包后新 PID 不重发；
// 这里验证结算暂停窗口内的预算保持、重复回执、身份竞争与重启不可解锁。

const now = Date.UTC(2026, 8, 14);
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

interface Paused {
  pid: number;
  requestId: string;
  remoteKey: string;
  receipt: GenerationExecutionReceipt;
}

function message<T>(child: ChildProcess, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`Missing ${type}`)), 20000);
    const exit = () => done(new Error('Fixture exited early'));
    const receive = (raw: unknown) => {
      const value = raw as { type: string; result: T };
      if (value.type === 'error') done(new Error(String(value.result)));
      else if (value.type === type) done(null, value.result);
    };
    function done(error: Error | null, value?: T) {
      clearTimeout(timer);
      child.off('message', receive);
      child.off('exit', exit);
      if (error) reject(error);
      else resolve(value as T);
    }
    child.on('message', receive);
    child.on('exit', exit);
  });
}

async function fixtureDb() {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-c3b-interleave-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'data.db');
  const anchorPath = join(dir, 'anchor');
  const db = new Database(path);
  try {
    takeoverDesktopDatabase(db);
    new AutomationSpendRepository(db).initializeBudget(
      { monthlyLimitPoints: 10, usedPoints: 1, month: '2026-09' },
      now,
    );
    await new ManagedExecutionGuard(
      new ManagedExecutionRepository(db),
      new EncryptedManagedAnchorFile(anchorPath, fixtureCipher),
    ).enable();
  } finally {
    db.close();
  }
  return { path, anchorPath, dir };
}

async function start(mode: string, path: string, anchorPath: string, baseUrl: string) {
  const child = fork(
    fileURLToPath(new URL('./fixtures/c3b-settle-process.ts', import.meta.url)),
    [path, anchorPath, baseUrl, mode],
    { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal })),
  );
  cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
  await message(child, 'ready');
  return { child, closed };
}

function receiptServer(command: ReturnType<typeof managedCommand>) {
  let posts = 0;
  let gets = 0;
  let delivered = 0;
  let key: string | null = null;
  let receipt: GenerationExecutionReceipt | null = null;
  const server = createServer((req, res) => {
    if (req.method === 'POST') {
      posts += 1;
      key = String(req.headers['idempotency-key']);
      receipt = {
        id: 'c3b-receipt',
        principalId: command.binding.principalId,
        idempotencyKey: key,
        operation: 'ordinary_create',
        originalRunId: 'c3b-remote-run',
        sourceRunId: null,
        bindingState: 'bound',
        binding: command.binding,
        status: 'succeeded',
        dispatch: 'claimed',
        costProvenance: 'provider_reported',
        costPoints: 3,
        revision: 1,
        createdAt: '2026-09-14T01:00:00.000Z',
        updatedAt: '2026-09-14T01:00:00.000Z',
        terminalAt: '2026-09-14T01:00:00.000Z',
        purgedAt: null,
      };
      req.resume();
      req.on('end', () => {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { id: receipt?.originalRunId } }));
      });
      return;
    }
    gets += 1;
    const requested = new URL(req.url ?? '/', 'http://localhost').searchParams.get('key');
    if (!key || requested !== key) {
      res.writeHead(404).end();
      return;
    }
    delivered += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(receipt));
  });
  return {
    server,
    counts: () => ({ posts, gets, delivered }),
    receipt: () => {
      if (!receipt) throw new Error('No receipt served yet');
      return receipt;
    },
  };
}

describe('C3-B settlement pause at the real HTTP/DB boundary', () => {
  it('结算暂停期间：新预留无自动预算，重复完成回调只入账一次，known 费用才释放', async () => {
    const { path, anchorPath } = await fixtureDb();
    const command = { ...managedCommand(), now };
    const loop = receiptServer(command);
    await new Promise<void>((resolve) => loop.server.listen(0, '127.0.0.1', resolve));
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          loop.server.closeAllConnections();
          loop.server.close(() => resolve());
        }),
    );
    const address = loop.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server');
    const original = await start(
      'submit-pause',
      path,
      anchorPath,
      `http://127.0.0.1:${address.port}`,
    );
    const paused = message<Paused>(original.child, 'paused');
    original.child.send(command);
    const window = await paused;
    expect(loop.counts()).toEqual({ posts: 1, gets: 1, delivered: 1 });
    // 落库前直查真实库文件：预留不释放、预算不可用。
    const before = new Database(path, { readonly: true });
    try {
      expect(
        before
          .prepare('SELECT reservation_state FROM automation_spend_requests WHERE id = ?')
          .get(window.requestId),
      ).toEqual({ reservation_state: 'unknown' });
    } finally {
      before.close();
    }
    const result = message<{
      firstApplied: boolean;
      duplicate: boolean;
      secondState: string;
      request: { reservationState: string; state: string };
      budget: { usedPoints: number; reservedPoints: number; remainingPoints: number };
    }>(original.child, 'result');
    original.child.send('go');
    const settled = await result;
    expect(settled.firstApplied).toBe(true);
    expect(settled.duplicate).toBe(false);
    expect(settled.secondState).toBe('pending_confirmation');
    expect(settled.request).toMatchObject({ state: 'terminal', reservationState: 'released' });
    expect(settled.budget).toMatchObject({ usedPoints: 4, remainingPoints: 6 });
    expect(loop.counts()).toEqual({ posts: 1, gets: 1, delivered: 1 });
    expect(await original.closed).toEqual({ code: 0, signal: null });
  }, 30_000);

  // Real child startup/SQLite/HTTP boundaries already have 20-second protocol deadlines.
  // The outer test must not cut off a correct three-process run after the default five seconds.
  it('结算暂停时 SIGKILL：新 PID 换号回执被拒，原主体恢复仅查原 key，POST 数不增', async () => {
    const { path, anchorPath } = await fixtureDb();
    const command = { ...managedCommand(), now };
    const loop = receiptServer(command);
    await new Promise<void>((resolve) => loop.server.listen(0, '127.0.0.1', resolve));
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          loop.server.closeAllConnections();
          loop.server.close(() => resolve());
        }),
    );
    const address = loop.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const original = await start('submit-pause', path, anchorPath, baseUrl);
    const paused = message<Paused>(original.child, 'paused');
    original.child.send(command);
    const window = await paused;
    expect(original.child.kill('SIGKILL')).toBe(true);
    expect(await original.closed).toEqual({ code: null, signal: 'SIGKILL' });

    // 新 PID、他账号：旧回执不得写入新主体；真实库文件零变更。
    const foreign = await start('foreign', path, anchorPath, baseUrl);
    const foreignResult = message<{
      code: string;
      request: { state: string; reservationState: string };
      budget: { hasUnknown: boolean; remainingPoints: number };
    }>(foreign.child, 'result');
    foreign.child.send({
      command,
      receipt: loop.receipt(),
      principalId: 'another-principal',
    });
    const refused = await foreignResult;
    expect(refused.code).toBe('MANAGED_IDENTITY_CHANGED');
    expect(refused.request).toMatchObject({ state: 'running', reservationState: 'unknown' });
    expect(refused.budget).toMatchObject({ hasUnknown: true, remainingPoints: 0 });
    expect(await foreign.closed).toEqual({ code: 0, signal: null });

    // 原主体新 PID 恢复：发送资格不复活，只按原 key 查询并结算一次。
    const replacement = await start('recover', path, anchorPath, baseUrl);
    const recovered = message<{
      pid: number;
      key: string;
      status: number;
      sendRefused: boolean;
      applied: boolean;
      request: { state: string; reservationState: string };
      budget: { usedPoints: number; hasUnknown: boolean };
    }>(replacement.child, 'result');
    replacement.child.send(command);
    const final = await recovered;
    expect(final.pid).not.toBe(window.pid);
    expect(final.sendRefused).toBe(true);
    expect(final.status).toBe(200);
    expect(final.key).toBe(window.remoteKey);
    expect(final.applied).toBe(true);
    expect(final.request).toMatchObject({ state: 'terminal', reservationState: 'released' });
    expect(final.budget).toMatchObject({ usedPoints: 4, hasUnknown: false });
    expect(loop.counts()).toEqual({ posts: 1, gets: 2, delivered: 2 });
    expect(await replacement.closed).toEqual({ code: 0, signal: null });
  }, 30_000);

  it('持久未结不能靠重启解除：新 PID 的二次启用/新预留/直接完成都被拒', async () => {
    const { path, anchorPath, dir } = await fixtureDb();
    const command = { ...managedCommand(), now };
    const loop = receiptServer(command);
    await new Promise<void>((resolve) => loop.server.listen(0, '127.0.0.1', resolve));
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          loop.server.closeAllConnections();
          loop.server.close(() => resolve());
        }),
    );
    const address = loop.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const original = await start('submit-pause', path, anchorPath, baseUrl);
    const paused = message<Paused>(original.child, 'paused');
    original.child.send(command);
    await paused;
    expect(original.child.kill('SIGKILL')).toBe(true);
    expect(await original.closed).toEqual({ code: null, signal: 'SIGKILL' });

    // 不给回执（结算窗口永久悬置）：新 PID 只能读，不能重启用/不能补写终态。
    const db = new Database(path);
    cleanup.push(() => {
      db.close();
    });
    db.pragma('foreign_keys = ON');
    const spend = new AutomationSpendRepository(db);
    const guard = new ManagedExecutionGuard(
      new ManagedExecutionRepository(db),
      new EncryptedManagedAnchorFile(join(dir, 'anchor'), fixtureCipher),
    );
    const ledger = new ManagedGenerationLedger(db, guard, () => {});
    await expect(guard.enable()).rejects.toMatchObject({ code: 'MANAGED_ALREADY_INITIALIZED' });
    const request = spend.findByKey(command.callerKey);
    expect(request).toMatchObject({ state: 'running', reservationState: 'unknown' });
    expect(() => spend.finishRequest(request?.id ?? '', 'cancelled', now + 5)).toThrow(
      'MANAGED_SPEND_COORDINATOR_REQUIRED',
    );
    const retry = {
      ...command,
      callerKey: `retry-${command.callerKey}`,
      executionId: `retry-${command.executionId}`,
    };
    const pending = await ledger.register(retry);
    expect(spend.get(pending.record.requestId)?.state).toBe('pending_confirmation');
    expect(spend.budget(now)).toMatchObject({ hasUnknown: true, remainingPoints: 0 });
    expect(loop.counts()).toEqual({ posts: 1, gets: 1, delivered: 1 });
  }, 30_000);
});
