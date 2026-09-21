import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { type ElectronApplication, expect, test } from '@playwright/test';
import {
  prepareDesignSchemeImportPackageResultSchema,
  designSchemeDetailSchema,
} from '@musefold/contracts';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { savedCapacityCase } from './package-capacity-helpers';
import { localInvoke } from './local-execution-fixture';

async function hash(path: string) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest('hex');
}
const stages = (base: string) =>
  existsSync(base)
    ? readdirSync(base, { recursive: true })
        .filter((name) => name.endsWith('package.musefold.design'))
        .map((name) => join(base, name))
    : [];

test('actual process pause beyond maintenance interval preserves an in-flight package and resumes import', async ({
  browserName: _browserName,
}, info) => {
  test.skip(
    process.platform === 'win32',
    'Real SIGSTOP/SIGCONT requires POSIX; Windows suspension remains a separate native gate.',
  );
  test.setTimeout(180000);
  const item = await savedCapacityCase(info.outputPath('capacity'), 'archive', 'at');
  const marker = info.outputPath('actual-pause.json');
  const gcLog = info.outputPath('maintenance.jsonl');
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    ({ app, userDataDir: userData } = await launchV25App('musefold-staging-pause-', {
      env: { MUSEFOLD_E2E_DESIGN_IMPORT_PATH: item.path },
    }));
    const page = await v25ShellPage(app);
    const child = app.process();
    await app.evaluate(
      (_electron, { picked, marker, gcLog }) => {
        const fs = process.getBuiltinModule('fs');
        const modules = process.getBuiltinModule('module');
        const open = fs.openSync;
        const read = fs.read;
        const info = console.info;
        let sourceFd = -1;
        let total = 0;
        let paused = false;
        console.info = (...args) => {
          if (args[0] === '[package-staging-gc]') fs.appendFileSync(gcLog, `${String(args[1])}\n`);
          info(...args);
        };
        fs.openSync = (path, flags, mode) => {
          const fd = open(path, flags, mode);
          if (String(path) === picked) sourceFd = fd;
          return fd;
        };
        // Observe real reads, injecting only an OS pause. Never fabricate bytes, time or IO results.
        fs.read = ((fd: number, ...args: unknown[]) => {
          const callback = args.at(-1) as (...values: unknown[]) => void;
          args[args.length - 1] = (error: unknown, bytes: number, ...rest: unknown[]) => {
            if (fd === sourceFd && !error) {
              total += bytes;
              if (!paused && total >= 262144) {
                paused = true;
                fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, totalRead: total }));
                process.kill(process.pid, 'SIGSTOP');
              }
            }
            if (fd === sourceFd && paused && total >= fs.statSync(picked).size) {
              fs.openSync = open;
              fs.read = read;
              modules.syncBuiltinESMExports();
            }
            callback(error, bytes, ...rest);
          };
          return Reflect.apply(read, fs, [fd, ...args]);
        }) as typeof fs.read;
        modules.syncBuiltinESMExports();
      },
      { picked: item.path, marker, gcLog },
    );
    const prepared = page.evaluate(() => {
      const bridge = (
        window as unknown as {
          musefoldV25: {
            prepareDesignSchemeImportPackage(
              input: unknown,
            ): Promise<{ ok: boolean; data?: unknown }>;
          };
        }
      ).musefoldV25;
      return bridge.prepareDesignSchemeImportPackage({ acceptedFormatVersions: [2] });
    });
    void prepared.catch(() => undefined);
    await expect.poll(() => existsSync(marker), { timeout: 15000 }).toBe(true);
    expect(JSON.parse(readFileSync(marker, 'utf8')).pid).toBe(child.pid);
    const state = () =>
      execFileSync('ps', ['-o', 'state=', '-p', String(child.pid)], { encoding: 'utf8' });
    await expect.poll(state).toContain('T');
    const base = join(userData, 'staging', 'design-scheme-packages');
    const partials = stages(base);
    expect(partials).toHaveLength(1);
    const partialBytes = statSync(partials[0]).size;
    expect(partialBytes).toBeGreaterThan(0);
    expect(partialBytes).toBeLessThan(statSync(item.path).size);
    const stoppedAt = Date.now();
    await delay(64000);
    const pausedMs = Date.now() - stoppedAt;
    expect(pausedMs).toBeGreaterThanOrEqual(64000);
    expect(state()).toContain('T');
    expect(statSync(partials[0]).size).toBe(partialBytes);
    expect(child.kill('SIGCONT')).toBe(true);
    const envelope = await prepared;
    expect(envelope.ok).toBe(true);
    const staged = prepareDesignSchemeImportPackageResultSchema.parse(envelope.data);
    if (staged.status !== 'staged') throw new Error('Expected staged package after resume');
    const maintenance = readFileSync(gcLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(
      maintenance.some((row) => row.protected >= 1 && row.deleted === 0 && row.failed === 0),
    ).toBe(true);
    expect(await hash(partials[0])).toBe(item.sha256);
    expect(staged.packageHash).toBe(item.sha256);
    // After an actual process pause use the renderer/preload channel, not the inspector channel.
    const imported = (await localInvoke(page, 'designSchemes.importPackage', {
      stagedPackageId: staged.stagedPackageId,
      packageHash: staged.packageHash,
      formatVersion: staged.formatVersion,
    })) as { status: string; scheme: { id: string } };
    expect(imported.status).toBe('draft');
    const detail = designSchemeDetailSchema.parse(
      await localInvoke(page, 'designSchemes.get', { id: imported.scheme.id }),
    );
    expect(detail.summary.id).toBe(imported.scheme.id);
    expect(stages(base)).toEqual([]);
    expect(await hash(item.path)).toBe(item.sha256);
    await info.attach('actual-pause-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        pid: child.pid,
        pausedMs,
        partialBytes,
        maintenance,
        importedSchemeId: imported.scheme.id,
        originalPreserved: true,
        stagingRemoved: true,
        scope:
          'Actual Electron, native IO, 256 MiB accepted ZIP, real 64s process suspension and production maintenance. Disposable userData, no provider. Bounded owned-process teardown does not prove graceful exit.',
      }),
    });
  } finally {
    if (app) {
      const child = app.process();
      const alive = () => child.exitCode === null && child.signalCode === null;
      if (alive()) child.kill('SIGCONT');
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          app.close().catch(() => undefined),
          new Promise<void>((resolve) => {
            deadline = setTimeout(() => {
              if (alive()) child.kill('SIGKILL');
              resolve();
            }, 10000);
          }),
        ]);
        if (alive()) {
          const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
          child.kill('SIGKILL');
          await exited;
        }
      } finally {
        clearTimeout(deadline);
      }
    }
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});
