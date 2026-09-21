import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { accountCloudStatusSchema } from '@musefold/contracts';
import { type ElectronApplication, expect } from '@playwright/test';
import { CloudServiceProcess } from '../../apps/desktop/electron/system/__tests__/fixtures/cloud-service-process';
import {
  cloudAnchor,
  cloudInvoke,
  cloudLocalState,
  connectCloud,
  killCloudProcess,
} from './cloud-crash-helpers';
import { launchV25App, v25ShellPage } from './electron-helpers';

export type ResumeFault = {
  point: 'binding' | 'open' | 'write' | 'sync' | 'rename' | 'dirsync' | 'compact';
  stage: 'prepare' | 'compact';
  action: 'hold' | 'fail' | 'kill';
};

/** Changes only builtins in the test-owned main process; no production endpoint or cipher fake. */
async function arm(app: ElectronApplication, root: string, origin: string, fault: ResumeFault) {
  const marker = join(root, 'resume-fault.json');
  const release = join(root, 'resume-release');
  await app.evaluate(
    ({ safeStorage }, { root, origin, marker, release, fault }) => {
      const fs = process.getBuiltinModule('fs');
      const promises = process.getBuiltinModule('fs/promises');
      const modules = process.getBuiltinModule('module');
      const canonicalRoot = fs.realpathSync(root);
      const originalOpen = promises.open;
      const originalRename = promises.rename;
      const encrypt = safeStorage.encryptString.bind(safeStorage);
      let stage: 'prepare' | 'compact' = 'prepare';
      let prepared = false;
      let fired = false;
      const hit = async (point: string, currentStage: string) => {
        if (fired || fault.point !== point || fault.stage !== currentStage) return;
        fired = true;
        fs.writeFileSync(
          marker,
          JSON.stringify({ pid: process.pid, point, stage: currentStage, action: fault.action }),
          { mode: 0o600 },
        );
        if (fault.action === 'kill') {
          process.kill(process.pid, 'SIGSTOP');
          return;
        }
        if (fault.action === 'fail') throw new Error('test-owned resume I/O failure');
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            clearInterval(poll);
            reject(new Error('test resume barrier expired'));
          }, 30000);
          const poll = setInterval(() => {
            if (!fs.existsSync(release)) return;
            clearInterval(poll);
            clearTimeout(timer);
            resolve();
          }, 10);
        });
      };
      safeStorage.encryptString = (plaintext) => {
        let value;
        try {
          value = JSON.parse(plaintext);
        } catch {
          return encrypt(plaintext);
        }
        if (value.version === 1 && value.pending?.kind === 'resume') {
          prepared = true;
          stage = 'prepare';
        } else if (prepared && value.version === 1 && value.pending === null) {
          stage = 'compact';
          if (!fired && fault.point === 'compact' && fault.action === 'kill') {
            fired = true;
            fs.writeFileSync(
              marker,
              JSON.stringify({ pid: process.pid, point: 'compact', stage, action: 'kill' }),
            );
            process.kill(process.pid, 'SIGSTOP');
          }
        }
        return encrypt(plaintext);
      };
      const anchorTemp = (path: unknown) =>
        String(path).startsWith(`${canonicalRoot}/managed-execution.anchor.`) &&
        String(path).endsWith('.tmp');
      promises.open = async (...args) => {
        const currentStage = stage;
        const isAnchor = prepared && anchorTemp(args[0]);
        const isDirectory = prepared && String(args[0]) === canonicalRoot;
        if (isAnchor) await hit('open', currentStage);
        const file = await originalOpen(...args);
        const originalWrite = file.writeFile.bind(file);
        const originalSync = file.sync.bind(file);
        if (isAnchor)
          file.writeFile = async (...data) => {
            await originalWrite(...data);
            await hit('write', currentStage);
          };
        if (isAnchor || isDirectory)
          file.sync = async () => {
            await hit(isDirectory ? 'dirsync' : 'sync', currentStage);
            await originalSync();
          };
        return file;
      };
      promises.rename = async (from, to) => {
        if (prepared && anchorTemp(from)) {
          if (fault.action !== 'kill') await hit('rename', stage);
          await originalRename(from, to);
          if (fault.action === 'kill') await hit('rename', stage);
        } else await originalRename(from, to);
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const response = await originalFetch(input, init);
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === `${origin}/api/v1/account/execution-binding`) await hit('binding', 'prepare');
        return response;
      };
      modules.syncBuiltinESMExports();
    },
    { root, origin, marker, release, fault },
  );
  return { marker, release };
}

export async function resumeFixture(restored = true) {
  const service = new CloudServiceProcess();
  let app: ElectronApplication | undefined;
  let root = '';
  let release = '';
  const pids: Array<number | undefined> = [];
  try {
    const info = await service.ready;
    await service.request('startWorker');
    ({ app, userDataDir: root } = await launchV25App('musefold-resume-race-', {
      env: { MUSEFOLD_API_URL: info.baseUrl },
    }));
    let page = await v25ShellPage(app);
    const restart = async (change?: () => void) => {
      if (app) {
        pids.push(app.process().pid);
        await app.close();
        app = undefined;
      }
      change?.();
      ({ app } = await launchV25App('unused-', {
        reuseUserDataDir: root,
        env: { MUSEFOLD_API_URL: info.baseUrl },
      }));
      expect(pids).not.toContain(app.process().pid);
      page = await v25ShellPage(app);
    };
    const invoke = (method: string, payload?: unknown) => cloudInvoke(page, method, payload);
    const status = async () => {
      const result = await invoke('accountCloud.getStatus');
      expect(result.ok).toBe(true);
      return accountCloudStatusSchema.parse(result.data);
    };
    await connectCloud(page);
    await page.getByTestId('nav-workbench').click();
    await page.getByTestId('composer-prompt').fill('synthetic real task for resume fault');
    await page.getByTestId('composer-submit').click();
    await expect.poll(() => cloudLocalState(root).assets.length, { timeout: 20000 }).toBe(1);
    const original = cloudLocalState(root);
    const originalAnchor = await cloudAnchor(app, root);
    const backupResult = await invoke('system.createBackup');
    expect(backupResult.ok).toBe(true);
    const backup = (backupResult.data as { backup: { file: string } }).backup.file;
    const restore = () => invoke('system.restoreBackup', { file: backup });
    if (restored) {
      expect(await restore()).toMatchObject({ ok: true, data: { needsRestart: true } });
      await restart();
      expect(await status()).toMatchObject({ mode: 'query_only', reviewAction: 'resume' });
    }
    return {
      root,
      info,
      original,
      originalAnchor,
      pids,
      restart,
      restore,
      status,
      invoke,
      get app() {
        if (!app) throw new Error('No live test app');
        return app;
      },
      get page() {
        return page;
      },
      local: () => cloudLocalState(root),
      anchor: () => {
        if (!app) throw new Error('No live test app');
        return cloudAnchor(app, root);
      },
      async arm(fault: ResumeFault) {
        if (!app) throw new Error('No live test app');
        const target = await arm(app, root, info.baseUrl, fault);
        release = target.release;
        return async () => {
          await expect.poll(() => existsSync(target.marker), { timeout: 20000 }).toBe(true);
          return JSON.parse(readFileSync(target.marker, 'utf8'));
        };
      },
      release() {
        if (release) writeFileSync(release, 'release');
      },
      async kill() {
        if (!app) throw new Error('No live test app');
        const pid = app.process().pid;
        const exit = await killCloudProcess(app);
        pids.push(pid);
        app = undefined;
        return { pid, exit };
      },
      async confirmUI() {
        await page.getByTestId('nav-settings').click();
        await page.getByTestId('settings-nav-connections').click();
        await page.getByTestId('account-cloud-review').click();
        await page.getByTestId('account-cloud-confirm').click();
        await expect.poll(async () => (await status()).mode).toBe('active');
      },
      async remote() {
        const snapshot = await service.request<{
          calls: Array<{ path: string; method: string }>;
          providerCalls: unknown[];
          assets: unknown[];
          receipts: Array<{
            idempotency_key: string;
            cost_provenance: string;
            cost_points: number | null;
          }>;
        }>('snapshot');
        expect(
          snapshot.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/generations'),
        ).toHaveLength(1);
        expect(snapshot.providerCalls).toHaveLength(1);
        expect(snapshot.assets).toHaveLength(1);
        expect(snapshot.receipts).toEqual([
          expect.objectContaining({
            idempotency_key: original.records[0].remoteKey,
            cost_provenance: 'unknown',
            cost_points: null,
          }),
        ]);
        return snapshot;
      },
      async close() {
        if (release) writeFileSync(release, 'release');
        if (app) {
          const marker = join(root, 'resume-fault.json');
          if (existsSync(marker)) {
            const hit = JSON.parse(readFileSync(marker, 'utf8'));
            if (hit.pid === app.process().pid && hit.action === 'kill') await killCloudProcess(app);
          }
          await app.close().catch(() => undefined);
        }
        await service.stop();
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await app?.close();
    await service.stop();
    if (root) rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
