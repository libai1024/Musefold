import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationSpendRepository } from '../../db/repositories/automation-spend';
import { ManagedExecutionRepository } from '../../db/repositories/managed-execution';
import { EncryptedManagedAnchorFile } from '../managed-execution-anchor-file';
import { ManagedExecutionGuard } from '../managed-execution-guard';
import { fixtureCipher } from './fixtures/managed-anchor-cipher';
import { managedCommand } from './fixtures/managed-generation';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function message<T>(child: ChildProcess, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`Missing ${type}`)), 10000);
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

describe('durable managed request recovery in a new OS process', () => {
  it.each(['registered', 'claimed', 'accepted', 'purged'])(
    'never sends a second POST after SIGKILL at %s',
    async (phase) => {
      const dir = mkdtempSync(join(tmpdir(), 'musefold-managed-remote-process-'));
      cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
      const path = join(dir, 'data.db');
      const anchorPath = join(dir, 'anchor');
      const db = new Database(path);
      try {
        takeoverDesktopDatabase(db);
        new AutomationSpendRepository(db).initializeBudget(
          { monthlyLimitPoints: 10, usedPoints: 0, month: '2026-09' },
          1,
        );
        await new ManagedExecutionGuard(
          new ManagedExecutionRepository(db),
          new EncryptedManagedAnchorFile(anchorPath, fixtureCipher),
        ).enable();
      } finally {
        db.close();
      }
      const command = managedCommand();
      let posts = 0;
      let gets = 0;
      let key: string | null = null;
      let accepted = () => {};
      const admission = new Promise<void>((resolve) => {
        accepted = resolve;
      });
      const server = createServer((req, res) => {
        if (req.method === 'POST') {
          posts++;
          key = String(req.headers['idempotency-key']);
          req.resume();
          req.on('end', accepted);
          // Intentionally no response: admission succeeded but the caller never receives it.
          return;
        }
        gets++;
        if (!key) {
          res.writeHead(404).end();
          return;
        }
        const requested = new URL(req.url ?? '/', 'http://localhost').searchParams.get('key');
        if (requested !== key) {
          res.writeHead(404).end();
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'synthetic-receipt',
            principalId: command.binding.principalId,
            idempotencyKey: key,
            operation: 'ordinary_create',
            originalRunId: 'synthetic-run',
            sourceRunId: null,
            bindingState: 'bound',
            binding: command.binding,
            status: phase === 'purged' ? 'cancelled' : 'queued',
            dispatch: phase === 'purged' ? 'confirmed_not_sent' : 'not_started',
            costProvenance: 'not_sent',
            costPoints: 0,
            revision: 1,
            createdAt: '2026-09-08T01:00:00.000Z',
            updatedAt: '2026-09-08T01:00:00.000Z',
            terminalAt: phase === 'purged' ? '2026-09-08T01:00:00.000Z' : null,
            purgedAt: phase === 'purged' ? '2026-09-08T01:00:00.000Z' : null,
          }),
        );
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
      if (!address || typeof address === 'string') throw new Error('Missing server');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      async function start(mode: string) {
        const child = fork(
          fileURLToPath(new URL('./fixtures/managed-generation-process.ts', import.meta.url)),
          [path, anchorPath, baseUrl, mode],
          { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
        );
        const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
          (resolve) => child.once('close', (code, signal) => resolve({ code, signal })),
        );
        cleanup.push(async () => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          await closed;
        });
        await message(child, 'ready');
        return { child, closed };
      }
      const original = await start(phase);
      const paused = ['registered', 'claimed'].includes(phase)
        ? message(original.child, 'paused')
        : admission;
      original.child.send(command);
      await paused;
      expect(posts).toBe(['registered', 'claimed'].includes(phase) ? 0 : 1);
      expect(original.child.kill('SIGKILL')).toBe(true);
      expect(await original.closed).toEqual({ code: null, signal: 'SIGKILL' });
      const replacement = await start('recover');
      const result = message<{ pid: number; key: string; status: number; sendRefused: boolean }>(
        replacement.child,
        'result',
      );
      replacement.child.send(command);
      const recovered = await result;
      expect(recovered.pid).not.toBe(original.child.pid);
      expect(recovered.sendRefused).toBe(true);
      expect(recovered.status).toBe(key ? 200 : 404);
      if (key) expect(recovered.key).toBe(key);
      expect(posts).toBe(['registered', 'claimed'].includes(phase) ? 0 : 1);
      expect(gets).toBe(1);
      expect(await replacement.closed).toEqual({ code: 0, signal: null });
    },
    30000,
  );
});
