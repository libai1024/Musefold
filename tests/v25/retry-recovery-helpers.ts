import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect } from '@playwright/test';
import { CloudServiceProcess } from '../../apps/desktop/electron/system/__tests__/fixtures/cloud-service-process';
import {
  cloudAnchor,
  cloudInvoke,
  cloudLocalState,
  cloudSpendState,
  connectCloud,
} from './cloud-crash-helpers';
import { launchV25App, v25ShellPage } from './electron-helpers';

export type RetrySnapshot = {
  runs: Array<{ id: string; status: string; parent_run_id: string | null }>;
  calls: Array<{ method: string; path: string; key: string | null }>;
  providerCalls: unknown[];
  receipts: Array<{ original_run_id: string; idempotency_key: string; cost_points: number | null }>;
};
export async function retryRecoveryFixture() {
  const service = new CloudServiceProcess();
  let app: ElectronApplication | undefined;
  let root = '';
  let release = '';
  try {
    const info = await service.ready;
    const first = await launchV25App('musefold-retry-recovery-', {
      env: { MUSEFOLD_API_URL: info.baseUrl },
    });
    app = first.app;
    root = first.userDataDir;
    let page = await v25ShellPage(app);
    const invoke = (method: string, input?: unknown) => cloudInvoke(page, method, input);
    const remote = () => service.request<RetrySnapshot>('snapshot');
    await connectCloud(page);
    await page.getByTestId('nav-workbench').click();
    await page.getByTestId('composer-prompt').fill('synthetic retry recovery parent');
    await page.getByTestId('composer-submit').click();
    await expect.poll(async () => (await remote()).runs.length).toBe(1);
    await page.getByTestId('job-cancel').click();
    await expect(page.getByTestId('job-retry')).toBeVisible();
    const parent = cloudLocalState(root).records[0];
    if (!parent.receipt || !parent.localGenerationId) throw new Error('Missing parent receipt');
    const command = { id: parent.localGenerationId, idempotencyKey: randomUUID() };
    const parentSpend = cloudSpendState(root, parent.requestId);
    const pids = [app.process().pid];
    return {
      root,
      info,
      parent,
      command,
      parentSpend,
      spend: (id: string) => cloudSpendState(root, id),
      pids,
      service,
      invoke,
      remote,
      local: () => cloudLocalState(root),
      get page() {
        return page;
      },
      get app() {
        if (!app) throw new Error('No live app');
        return app;
      },
      anchor: () => {
        if (!app) throw new Error('No live app');
        return cloudAnchor(app, root);
      },
      retry: () => invoke('generation.retry', command),
      async restart() {
        if (!app) throw new Error('No live app');
        if (release) writeFileSync(release, 'release');
        await app.close();
        app = undefined;
        ({ app } = await launchV25App('unused-', {
          reuseUserDataDir: root,
          env: { MUSEFOLD_API_URL: info.baseUrl },
        }));
        expect(pids).not.toContain(app.process().pid);
        pids.push(app.process().pid);
        page = await v25ShellPage(app);
      },
      async hold(point: 'binding' | 'before-claim' | 'receipt') {
        if (!app) throw new Error('No live app');
        const marker = join(root, 'retry-wait.json');
        release = join(root, 'retry-release');
        await app.evaluate(
          (_, { marker, release, origin, parentKey, point }) => {
            const fs = process.getBuiltinModule('fs');
            const original = globalThis.fetch;
            let binding = 0;
            let fired = false;
            globalThis.fetch = async (input, init) => {
              const url =
                typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
              const response = await original(input, init);
              if (fired || !url.startsWith(origin)) return response;
              const target = new URL(url);
              // Explicit-model retries read authority from the account catalog; retain
              // the legacy endpoint so the same barrier also covers old frozen requests.
              const isBinding = [
                '/api/v1/account/execution-binding',
                '/api/v1/account/models',
              ].includes(target.pathname);
              if (isBinding) binding++;
              const match =
                point === 'receipt'
                  ? target.pathname === '/api/v1/generations/receipts/by-key' &&
                    target.searchParams.get('key') !== parentKey
                  : isBinding && binding === (point === 'binding' ? 1 : 2);
              if (!match) return response;
              fired = true;
              fs.writeFileSync(
                marker,
                JSON.stringify({ point, pid: process.pid, url, status: response.status, binding }),
                { mode: 0o600 },
              );
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                  clearInterval(poll);
                  reject(new Error('Retry test barrier timeout'));
                }, 30000);
                const poll = setInterval(() => {
                  if (!fs.existsSync(release)) return;
                  clearInterval(poll);
                  clearTimeout(timer);
                  resolve();
                }, 10);
              });
              return response;
            };
          },
          { marker, release, origin: info.baseUrl, parentKey: parent.remoteKey, point },
        );
        return async () => {
          await expect.poll(() => existsSync(marker), { timeout: 20000 }).toBe(true);
          return JSON.parse(readFileSync(marker, 'utf8'));
        };
      },
      release() {
        if (release) writeFileSync(release, 'release');
      },
      async breakCancel(runId: string) {
        if (!app) throw new Error('No live app');
        await app.evaluate((_, target) => {
          const original = globalThis.fetch;
          globalThis.fetch = async (input, init) => {
            const url =
              typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            const result = await original(input, init);
            return url === target && init?.method === 'POST' && result.status === 200
              ? new Response('{', { status: 200, headers: { 'content-type': 'application/json' } })
              : result;
          };
        }, `${info.baseUrl}/api/v1/generations/${runId}/cancel`);
      },
      async close() {
        if (release) writeFileSync(release, 'release');
        await app?.close();
        await service.stop();
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (release) writeFileSync(release, 'release');
    await app?.close();
    await service.stop();
    if (root) rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
