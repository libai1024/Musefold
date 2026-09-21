import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import type {
  AutomationPayerBinding,
  RegisterAutomationSpend,
} from '@musefold/desktop-contracts/automation-spend';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationSpendRepository } from '../automation-spend';

const now = Date.UTC(2026, 8, 7);
const binding: AutomationPayerBinding = {
  providerId: 'fixture-provider',
  providerType: 'openai-compatible',
  model: 'fixture-model',
  baseUrl: 'http://127.0.0.1:12345/v1',
  credentialEpoch: 'fixture-key-epoch',
  payerKind: 'account',
  ownerId: 'fixture-owner',
  issuer: 'http://127.0.0.1:12346',
  policy: 'managed',
};
const command: RegisterAutomationSpend = {
  idempotencyKey: 'fixture-shared-key',
  action: 'generate_image',
  caller: 'fixture-client',
  input: { prompt: 'fixture' },
  frozenInput: { prompt: 'fixture' },
  bindings: [binding],
  promptText: 'fixture',
  executionId: 'fixture-execution',
  maxImageCalls: 1,
  maxTextCalls: 0,
  estimatedPoints: 8,
  now,
};
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-spend-process-'));
  const path = join(dir, 'local.db');
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const db = new Database(path);
  cleanup.push(() => {
    db.close();
  });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  const repository = new AutomationSpendRepository(db);
  repository.initializeBudget({ monthlyLimitPoints: 10, usedPoints: 0, month: '2026-09' }, now);
  return { path, db, repository };
}

function message(child: ChildProcess, kind: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${kind}`)), 10_000);
    const onExit = (code: number | null) =>
      finish(new Error(`Fixture exited before ${kind}: ${code}`));
    const onMessage = (payload: unknown) => {
      const value = payload as { type: string; result?: unknown; message?: string };
      if (value.type === 'error') finish(new Error(value.message));
      else if (value.type === kind) finish(null, value.result);
    };
    const finish = (error: Error | null, result?: unknown) => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(result);
    };
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

async function processFixture(path: string, action: string, payload: Record<string, unknown>) {
  const child = fork(
    fileURLToPath(new URL('./fixtures/automation-spend-process.ts', import.meta.url)),
    [path, action, JSON.stringify(payload)],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let diagnostics = '';
  child.stderr?.on('data', (chunk) => {
    diagnostics += String(chunk);
  });
  cleanup.push(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    await exited;
  });
  try {
    await message(child, 'ready');
  } catch (error) {
    throw new Error(`${String(error)} ${diagnostics}`);
  }
  return child;
}

describe('independent-process durable spend arbitration', () => {
  it('arbitrates the same key and a send claim with real SQLite writer processes', async () => {
    const { path, repository, db } = fixture();
    const children = await Promise.all([
      processFixture(path, 'register', { command, now }),
      processFixture(path, 'register', { command, now }),
    ]);
    const results = children.map((child) => message(child, 'result'));
    for (const child of children) child.send('go');
    const registered = (await Promise.all(results)) as Array<{
      request: { id: string };
      replayed: boolean;
    }>;
    expect(registered.map((value) => value.request.id)).toEqual([
      registered[0].request.id,
      registered[0].request.id,
    ]);
    expect(registered.map((value) => value.replayed).sort()).toEqual([false, true]);
    expect(repository.budget(now)).toMatchObject({ reservedPoints: 8, remainingPoints: 2 });
    const request = repository.findByKey(command.idempotencyKey ?? '');
    if (!request) throw new Error('Missing registered request');
    const call = repository.prepareCall({
      requestId: request.id,
      ordinal: 0,
      kind: 'image',
      binding,
      input: { prompt: 'fixture' },
      generationRunId: 'fixture-execution',
    });
    const claimers = await Promise.all([
      processFixture(path, 'claim', { callId: call.id, binding, now }),
      processFixture(path, 'claim', { callId: call.id, binding, now }),
    ]);
    const claims = claimers.map((child) => message(child, 'result'));
    for (const child of claimers) child.send('go');
    expect((await Promise.all(claims)).filter(Boolean)).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM automation_spend_requests').get()).toEqual({
      n: 1,
    });
  });

  it('arbitrates distinct concurrent requests before either can reserve the same funds', async () => {
    const { path, repository } = fixture();
    const children = await Promise.all([
      processFixture(path, 'register', { command, now }),
      processFixture(path, 'register', {
        command: {
          ...command,
          idempotencyKey: 'fixture-second',
          executionId: 'fixture-second-execution',
        },
        now,
      }),
    ]);
    const results = children.map((child) => message(child, 'result'));
    for (const child of children) child.send('go');
    const registered = (await Promise.all(results)) as Array<{ request: { state: string } }>;
    expect(registered.map((value) => value.request.state).sort()).toEqual([
      'authorized',
      'pending_confirmation',
    ]);
    expect(repository.budget(now)).toMatchObject({ reservedPoints: 8, remainingPoints: 2 });
  });

  it.each(['marked-before-send', 'sent-before-result'])(
    'preserves unknown after SIGKILL at %s without automatically resending',
    async (action) => {
      const { path, repository, db } = fixture();
      let sends = 0;
      const server = createServer((_request, response) => {
        sends += 1;
        response.end('{}');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing fake Provider listener');
      const request = repository.register(command).request;
      const call = repository.prepareCall({
        requestId: request.id,
        ordinal: 0,
        kind: 'image',
        binding,
        input: { prompt: 'fixture' },
        generationRunId: 'fixture-execution',
      });
      const child = await processFixture(path, action, {
        callId: call.id,
        binding,
        now,
        providerUrl: `http://127.0.0.1:${address.port}/generate`,
      });
      const marked = message(child, 'marked');
      child.send('go');
      await marked;
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await exited;
      const next = new AutomationSpendRepository(db);
      expect(next.recover('fixture-replacement-process', now + 1)).toBe(1);
      expect(next.get(request.id)).toMatchObject({
        state: 'terminal',
        reservationState: 'unknown',
      });
      expect(next.claimCall(call.id, binding, 'fixture-replacement-process', now + 2)).toBeNull();
      expect(next.register(command).replayed).toBe(true);
      expect(next.budget(now)).toMatchObject({ hasUnknown: true, remainingPoints: 0 });
      expect(sends).toBe(action === 'sent-before-result' ? 1 : 0);
    },
  );
});
