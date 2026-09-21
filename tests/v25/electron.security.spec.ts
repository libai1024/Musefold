import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { scanArtifacts } from '../../scripts/security/artifact-scan.mjs';
import { launchV25App, v25ShellPage } from './electron-helpers';

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument; this test launches Electron itself.
test('合成密钥经真实安全存储和连接探测,不进入返回值、日志、SQLite或备份', async ({}, testInfo) => {
  const canary = `musefold-synthetic-${randomBytes(24).toString('hex')}`;
  const rotated = `musefold-rotated-${randomBytes(24).toString('hex')}`;
  const privatePath = ['/Users', 'synthetic-owner', 'private-data'].join('/');
  let authorizedProbes = 0;
  let expectedKey = canary;
  const server = createServer((request, response) => {
    if (request.headers.authorization === `Bearer ${expectedKey}`) authorizedProbes++;
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ error: { message: `upstream diagnostic ${expectedKey} ${privatePath}` } }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server failed');
  const output = mkdtempSync(join(tmpdir(), 'musefold-security-output-'));
  let app: ElectronApplication | undefined;
  let userDataDir: string | undefined;
  const logs: string[] = [];
  const replies: unknown[] = [];
  try {
    ({ app, userDataDir } = await launchV25App('musefold-security-userdata-'));
    app.process().stdout?.on('data', (data) => logs.push(String(data)));
    app.process().stderr?.on('data', (data) => logs.push(String(data)));
    const page = await v25ShellPage(app);
    const invoke = async (method: string, payload?: unknown) =>
      page.evaluate(
        async ({ method, payload }) => {
          const host = window as unknown as {
            musefoldV25: {
              invoke(method: string, payload?: unknown): Promise<{ ok: boolean; data?: unknown }>;
            };
          };
          return host.musefoldV25.invoke(method, payload);
        },
        { method, payload },
      );
    const created = await invoke('aiProviders.create', {
      name: '安全扫描连接',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: 'synthetic-model',
      apiKey: canary,
      activate: true,
    });
    expect(created.ok).toBe(true);
    replies.push(created);
    const id = (created.data as { id: string }).id;
    const tested = await invoke('aiProviders.test', { id });
    replies.push(tested);
    expect(tested.ok).toBe(true);
    expect((tested.data as { ok: boolean }).ok).toBe(false);
    expect(authorizedProbes).toBe(1);
    const backup = await invoke('system.createBackup');
    expect(backup.ok).toBe(true);
    replies.push(backup);
    const update = await invoke('aiProviders.update', { id, patch: { apiKey: rotated } });
    expect(update.ok).toBe(true);
    replies.push(update);
    expectedKey = rotated;
    replies.push(await invoke('aiProviders.test', { id }));
    expect(authorizedProbes).toBe(2);
    const listed = await invoke('aiProviders.list');
    replies.push(listed);
    // IPC fixture mutations bypass TanStack Query's UI mutation hooks; reload before
    // inspecting the saved state so the renderer does not retain its startup empty query.
    await page.reload();
    await expect(page.getByTestId('v25-shell')).toBeVisible();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-connections').click();
    await expect(page.getByTestId('ai-providers-list')).toBeVisible();
    writeFileSync(join(output, 'renderer.html'), await page.content());
    writeFileSync(
      join(output, 'renderer-storage.json'),
      await page.evaluate(() =>
        JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
      ),
    );
    const removed = await invoke('aiProviders.remove', { id });
    expect(removed.ok).toBe(true);
    replies.push(removed);
    replies.push(await invoke('aiProviders.test', { id }));
    expect(authorizedProbes).toBe(2);
    writeFileSync(join(output, 'ipc-responses.json'), JSON.stringify(replies));
    const canaries = [
      { id: 'provider-key', value: canary },
      { id: 'rotated-key', value: rotated },
    ];
    // Snapshot the live DB/WAL/backup and encrypted settings while the process still owns it.
    const liveEntries = readdirSync(userDataDir, { withFileTypes: true });
    const transientLocks = liveEntries.filter(
      (entry) =>
        entry.isSymbolicLink() &&
        ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].includes(entry.name),
    );
    const liveTargets = liveEntries
      .filter((entry) => !transientLocks.includes(entry))
      .map((entry, index) => ({
        id: `live-userdata-${index}`,
        kind: entry.isDirectory() ? 'tree' : 'file',
        path: join(userDataDir as string, entry.name),
        allowEmpty: true,
      }));
    const live = await scanArtifacts({
      targets: liveTargets,
      canaries,
    });
    expect(live.findings).toEqual([]);
    expect(live.errors).toEqual([]);
    await app.close();
    app = undefined;
    writeFileSync(join(output, 'process.log'), logs.join(''));
    const persisted = await scanArtifacts({
      targets: [
        { id: 'closed-userdata', kind: 'tree', path: userDataDir },
        { id: 'runtime-output', kind: 'tree', path: output },
      ],
      canaries,
    });
    const responsePaths = await scanArtifacts({
      targets: [
        {
          id: 'response-paths',
          kind: 'file',
          path: join(output, 'ipc-responses.json'),
          detectUserPaths: true,
        },
      ],
    });
    const evidence = {
      excludedLiveMetadata: transientLocks.map((entry) => ({
        entry: entry.name,
        reason:
          'Chromium process coordination symlink; target bytes are outside userData and are not credential storage.',
      })),
      scope:
        'Synthetic provider save/probe/rotate/remove, real Electron IPC, DB/WAL/backup, rendered post-save state and process logs; no login or generation call.',
      live,
      persisted,
      responsePaths,
    };
    const report = testInfo.outputPath('security.json');
    mkdirSync(testInfo.outputDir, { recursive: true });
    writeFileSync(report, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach('security-scan', { path: report, contentType: 'application/json' });
    expect(persisted.findings).toEqual([]);
    expect(persisted.errors).toEqual([]);
    expect(responsePaths.findings).toEqual([]);
    expect(responsePaths.errors).toEqual([]);
  } finally {
    await app?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(output, { recursive: true, force: true });
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  }
});
