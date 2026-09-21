import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { managedGenerationRecordSchema } from '../../packages/desktop-contracts/src/managed-generation';
import { type ElectronApplication, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath } from './electron-helpers';

export function cloudInvoke(page: Page, method: string, payload?: unknown) {
  return page.evaluate(
    ({ method, payload }) => {
      const host = window as unknown as {
        musefoldV25: {
          invoke(
            method: string,
            payload?: unknown,
          ): Promise<{
            ok: boolean;
            data?: unknown;
            code?: string;
          }>;
        };
      };
      return host.musefoldV25.invoke(method, payload);
    },
    { method, payload },
  );
}

export async function connectCloud(page: Page) {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-nav-account').click();
  await page.getByTestId('account-username').fill('joint-a');
  await page.getByTestId('account-password').fill('synthetic-password');
  await page.getByTestId('account-auth-submit').click();
  await expect(page.getByTestId('account-points')).toBeVisible();
  await page.getByTestId('settings-nav-connections').click();
  await page.getByTestId('account-cloud-review').click();
  await page.getByTestId('account-cloud-confirm').click();
  await expect(page.getByTestId('account-cloud-default')).toHaveText('当前默认连接');
}

export function cloudLocalState(userData: string) {
  const db = new Database(desktopDbPath(userData), { readonly: true });
  try {
    return {
      records: db
        .prepare('SELECT record_json FROM managed_generation_requests ORDER BY request_id')
        .all()
        .map((row) =>
          managedGenerationRecordSchema.parse(
            JSON.parse((row as { record_json: string }).record_json),
          ),
        ),
      runs: db.prepare('SELECT id,status,actual_cost FROM generation_runs ORDER BY id').all(),
      assets: db
        .prepare('SELECT id,position,media_path,checksum FROM generated_assets ORDER BY position')
        .all() as Array<{
        id: string;
        position: number;
        media_path: string;
        checksum: string;
      }>,
      checkpoint: db.prepare('SELECT * FROM managed_execution_checkpoint').all(),
    };
  } finally {
    db.close();
  }
}

export async function cloudAnchor(app: ElectronApplication, userData: string) {
  const encoded = readFileSync(join(userData, 'managed-execution.anchor')).toString('base64');
  return decodeCloudAnchor(app, encoded);
}

/** Read only the original request's payer/month and financial facts, excluding mutable audit times. */
export function cloudSpendState(userData: string, requestId: string) {
  const db = new Database(desktopDbPath(userData), { readonly: true });
  try {
    return {
      request: db
        .prepare(`SELECT id,budget_month,bindings_json,reservation_state,reservation_points
        FROM automation_spend_requests WHERE id = ?`)
        .get(requestId),
      calls: db
        .prepare(`SELECT id,state,binding_json,reported_points,policy_points,cost_source
        FROM automation_spend_calls WHERE request_id = ? ORDER BY id`)
        .all(requestId),
    };
  } finally {
    db.close();
  }
}

export function cloudEvidence(value: unknown, userData: string): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === 'string' ? item.replaceAll(userData, '<test-userData>') : item,
  );
}

export async function decodeCloudAnchor(app: ElectronApplication, encoded: string) {
  return app.evaluate(
    ({ safeStorage }, encoded) =>
      JSON.parse(safeStorage.decryptString(Buffer.from(encoded, 'base64'))),
    encoded,
  );
}

export type CloudCrashPhase =
  | 'before-claim'
  | 'claim-committed'
  | 'before-submit'
  | 'after-submit'
  | 'after-cancel'
  | 'during-download'
  | 'before-file'
  | 'after-file';

/** Test-owned main process only. No production hooks, fake encryption or new IPC methods. */
export async function armCloudCrash(
  app: ElectronApplication,
  userData: string,
  origin: string,
  phase: CloudCrashPhase,
  retryRunId?: string,
) {
  const marker = join(userData, 'test-crash-window.json');
  await app.evaluate(
    ({ safeStorage }, { marker, origin, phase, retryRunId }) => {
      const fs = process.getBuiltinModule('fs');
      const module = process.getBuiltinModule('module');
      const write = fs.writeFileSync;
      let fired = false;
      const stop = (detail: Record<string, unknown>) => {
        if (fired) return;
        fired = true;
        write(marker, JSON.stringify({ phase, pid: process.pid, detail }), { mode: 0o600 });
        // Parent observes the exact boundary, then kills this child without graceful shutdown.
        process.kill(process.pid, 'SIGSTOP');
      };
      if (phase === 'before-claim' || phase === 'claim-committed') {
        const encrypt = safeStorage.encryptString.bind(safeStorage);
        let submits = 0;
        safeStorage.encryptString = (plaintext) => {
          const value = JSON.parse(plaintext);
          if (
            value.version === 1 &&
            value.pending?.kind === 'submit' &&
            ++submits === 2 &&
            phase === 'before-claim'
          )
            stop({ pending: value.pending, committed: value.committed });
          if (value.version === 1 && !value.pending && submits === 2 && phase === 'claim-committed')
            stop({ committed: value.committed });
          return encrypt(plaintext);
        };
      } else if (phase === 'before-file' || phase === 'after-file') {
        const rename = fs.renameSync;
        if (phase === 'before-file') {
          fs.writeFileSync = (file, bytes, options) => {
            if (/[/\\]cloud-[a-f0-9]+\.[a-z]+\..+\.tmp$/.test(String(file)))
              stop({
                bytes: typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength,
              });
            return write(file, bytes, options);
          };
        } else {
          fs.renameSync = (from, to) => {
            rename(from, to);
            if (/[/\\]cloud-[a-f0-9]+\.[a-z]+$/.test(String(to)))
              stop({ basename: String(to).split(/[/\\]/).at(-1), bytes: fs.statSync(to).size });
          };
        }
        module.syncBuiltinESMExports();
      } else {
        const original = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          const submitPath = retryRunId
            ? `/api/v1/generations/${retryRunId}/retry`
            : '/api/v1/generations';
          const create = url === `${origin}${submitPath}` && init?.method === 'POST';
          const cancel =
            url.startsWith(`${origin}/api/v1/generations/`) &&
            url.endsWith('/cancel') &&
            init?.method === 'POST';
          if (create && phase === 'before-submit')
            stop({ method: 'POST', path: submitPath, accepted: false });
          const response = await original(input, init);
          if (
            phase === 'during-download' &&
            url.startsWith(`${origin}/api/v1/assets/`) &&
            url.endsWith('/content')
          ) {
            const reader = response.body?.getReader();
            if (!reader) throw new Error('Expected real asset stream');
            return new Response(
              new ReadableStream({
                async pull(controller) {
                  const chunk = await reader.read();
                  if (chunk.done) controller.close();
                  else {
                    stop({
                      path: new URL(url).pathname,
                      status: response.status,
                      firstChunkBytes: chunk.value.byteLength,
                    });
                    controller.enqueue(chunk.value);
                  }
                },
                cancel(reason) {
                  return reader.cancel(reason);
                },
              }),
              { status: response.status, headers: response.headers },
            );
          }
          if ((create && phase === 'after-submit') || (cancel && phase === 'after-cancel'))
            stop({ method: 'POST', path: new URL(url).pathname, status: response.status });
          return response;
        };
      }
    },
    { marker, origin, phase, retryRunId },
  );
  return marker;
}

export async function killCloudProcess(app: ElectronApplication) {
  const child = app.process();
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  expect(child.kill('SIGKILL')).toBe(true);
  const result = await exited;
  expect(result).toEqual({ code: null, signal: 'SIGKILL' });
  return result;
}
