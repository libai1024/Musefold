import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { aiProviderSchema, generationJobSchema } from '@musefold/contracts';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localExecutionFixture, localInvoke as invoke } from './local-execution-fixture';

const root = resolve(import.meta.dirname, '../..');
test.beforeAll(async () => {
  await promisify(execFile)(process.execPath, ['scripts/build-cli.mjs'], {
    cwd: root,
    timeout: 30000,
  });
});

test('实际 serve 自备生成与旧账号拒绝；桌面接管在途任务前等待守护正常退出', async () => {
  test.setTimeout(90000);
  const fixture = await localExecutionFixture();
  let app: ElectronApplication | undefined;
  let directory = '';
  const children: ChildProcess[] = [];
  try {
    const first = await launchV25App('musefold-real-serve-', { env: fixture.env });
    app = first.app;
    directory = first.userDataDir;
    let page = await v25ShellPage(app);
    const byok = aiProviderSchema.parse(
      await invoke(page, 'aiProviders.create', {
        name: '自备守护连接',
        baseUrl: `${fixture.baseUrl}/v1`,
        model: 'fixture-a',
        apiKey: 'synthetic-a',
        activate: true,
      }),
    );
    const legacy = aiProviderSchema.parse(
      await invoke(page, 'aiProviders.create', {
        name: '旧账号连接',
        baseUrl: `${fixture.baseUrl}/v1`,
        model: 'fixture-a',
        apiKey: 'synthetic-a',
      }),
    );
    await app.close();
    app = undefined;
    const seed = new Database(desktopDbPath(directory));
    seed.prepare("UPDATE providers SET managed_by = 'account' WHERE id = ?").run(legacy.id);
    seed.close();
    const start = () => {
      let stderr = '';
      const child = spawn(
        process.execPath,
        ['packages/cli/dist/musefold.mjs', 'serve', '--data-dir', directory, '--port', '0'],
        {
          cwd: root,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: {
            ...process.env,
            MUSEFOLD_E2E: '1',
            [`MUSEFOLD_PROVIDER_KEY_${byok.id.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`]:
              'synthetic-a',
            [`MUSEFOLD_PROVIDER_KEY_${legacy.id.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`]:
              'synthetic-a',
          },
        },
      );
      child.stderr.on('data', (value) => {
        stderr += value.toString();
      });
      children.push(child);
      return { child, errors: () => stderr };
    };
    const serving = start();
    await expect
      .poll(() => {
        if (!existsSync(join(directory, 'automation.json'))) return false;
        const current = JSON.parse(readFileSync(join(directory, 'automation.json'), 'utf8'));
        return current.owner === 'headless-daemon' && current.pid === serving.child.pid;
      })
      .toBe(true);
    const discovery = JSON.parse(readFileSync(join(directory, 'automation.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    const submit = async (providerId: string, key: string) => {
      const response = await fetch(`http://127.0.0.1:${discovery.port}/v1/generations`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${discovery.token}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({
          providerId,
          prompt: '真实守护合成验证',
          consent: 'interactive',
          n: 1,
        }),
      });
      expect(response.status).toBe(202);
      return (await response.json()) as { jobId: string };
    };
    const readRun = (id: string) => {
      const db = new Database(desktopDbPath(directory), { readonly: true });
      try {
        return db
          .prepare('SELECT status,error_code,actual_cost FROM generation_runs WHERE id = ?')
          .get(id) as { status: string; error_code: string | null; actual_cost: number | null };
      } finally {
        db.close();
      }
    };
    const success = await submit(byok.id, 'serve-byok-success');
    await expect.poll(() => readRun(success.jobId)?.status).toBe('success');
    expect(fixture.imageCalls).toHaveLength(1);
    const rejected = await submit(legacy.id, 'serve-unbound-account');
    await expect.poll(() => readRun(rejected.jobId)?.status).toBe('failed');
    expect(readRun(rejected.jobId)?.error_code).toBe('PAYMENT_IDENTITY_UNBOUND');
    expect(fixture.imageCalls).toHaveLength(1);
    fixture.holdImages(true);
    const held = await submit(byok.id, 'serve-held-before-takeover');
    await expect.poll(() => fixture.imageCalls.length).toBe(2);
    expect(readRun(held.jobId)?.status).toBe('running');
    // Real desktop startup uses its existing owner takeover, including SIGTERM.
    ({ app } = await launchV25App('musefold-real-serve-', {
      reuseUserDataDir: directory,
      env: fixture.env,
    }));
    page = await v25ShellPage(app);
    await expect.poll(() => serving.child.exitCode).toBe(0);
    expect(serving.child.signalCode).toBeNull();
    expect(serving.errors()).not.toMatch(/database connection is not open|database is closed/i);
    expect(readRun(held.jobId)).toMatchObject({ status: 'cancelled', actual_cost: null });
    expect(fixture.imageCalls).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(directory, 'owner.lock'), 'utf8'))).toMatchObject({
      owner: 'desktop-app',
      pid: app.process().pid,
    });
    const refused = start();
    await expect.poll(() => refused.child.exitCode).not.toBeNull();
    expect(refused.child.exitCode).not.toBe(0);
    expect(refused.errors()).toContain('桌面应用');
    expect(fixture.imageCalls).toHaveLength(2);
    fixture.holdImages(false);
    const created = generationJobSchema.parse(
      await invoke(page, 'generation.create', {
        providerId: byok.id,
        prompt: '接管后新的自备意图',
        count: 1,
      }),
    );
    await expect
      .poll(
        async () =>
          generationJobSchema.parse(await invoke(page, 'generation.get', created.id)).status,
      )
      .toBe('succeeded');
    expect(fixture.imageCalls).toHaveLength(3);
    expect(fixture.imageCredentials).toEqual(['a', 'a', 'a']);
    expect(readRun(rejected.jobId)?.error_code).toBe('PAYMENT_IDENTITY_UNBOUND');
    expect(readRun(held.jobId)).toMatchObject({ status: 'cancelled', actual_cost: null });
  } finally {
    await app?.close();
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await new Promise<void>((done) => child.once('exit', () => done()));
      }
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
    await fixture.close();
  }
});
