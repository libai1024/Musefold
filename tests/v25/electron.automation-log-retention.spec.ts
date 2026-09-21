import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOGS_DIR_NAME } from '@musefold/core/constants';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { localInvoke } from './local-execution-fixture';

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('actual Electron bounds legacy endpoint logs, drains on disable and resumes after a new PID', async ({}, info) => {
  test.setTimeout(120_000);
  const userData = mkdtempSync(join(tmpdir(), 'musefold-owned-audit-retention-'));
  const logs = join(userData, LOGS_DIR_NAME);
  mkdirSync(logs);
  const names = ['automation-audit.ndjson', 'automation-audit.1.ndjson'];
  const paths = names.map((name) => join(logs, name));
  const line = `${JSON.stringify({ at: '2026-09-13T00:00:00.000Z', method: 'GET', path: '/legacy', status: 200, durationMs: 1 })}\n`;
  for (const path of paths)
    writeFileSync(path, line.repeat(Math.ceil((3 * 1024 * 1024) / line.length)));
  let app: ElectronApplication | undefined;
  const call = async (path: string) => {
    const discovery = JSON.parse(readFileSync(join(userData, 'automation.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    const response = await fetch(`http://127.0.0.1:${discovery.port}${path}`, {
      headers: { authorization: `Bearer ${discovery.token}` },
    });
    await response.text();
    return response.status;
  };
  const readRows = (path: string) =>
    readFileSync(path, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((row) => JSON.parse(row));
  try {
    app = (await launchV25App('musefold-owned-audit-retention-', userData)).app;
    const page = await v25ShellPage(app);
    await expect.poll(() => readdirSync(userData).includes('automation.json')).toBe(true);
    expect(await call('/v1/health')).toBe(200);
    await localInvoke(page, 'automation.setEnabled', { enabled: false });
    for (const path of paths) expect(statSync(path).size).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(readRows(paths[0]).at(-1)).toMatchObject({ path: '/v1/health', status: 200 });
    expect(readdirSync(logs)).not.toContain('automation-audit.pending.ndjson');
    await localInvoke(page, 'automation.setEnabled', { enabled: true });
    const firstPid = app.process().pid;
    await app.close();
    app = (await launchV25App('musefold-owned-audit-retention-', userData)).app;
    expect(app.process().pid).not.toBe(firstPid);
    const restarted = await v25ShellPage(app);
    await expect.poll(() => readdirSync(userData).includes('automation.json')).toBe(true);
    expect(await call('/v1/no-such-endpoint')).toBe(404);
    await localInvoke(restarted, 'automation.setEnabled', { enabled: false });
    expect(readRows(paths[0]).at(-1)).toMatchObject({ path: '/<unmatched>', status: 404 });
    expect(readRows(paths[0]).some((row) => row.path === '/v1/health')).toBe(true);
    for (const path of paths) expect(statSync(path).size).toBeLessThanOrEqual(2 * 1024 * 1024);
    await info.attach('actual-audit-retention', {
      contentType: 'application/json',
      body: JSON.stringify({
        firstPid,
        restartedPid: app.process().pid,
        files: paths.map((path, i) => ({
          name: names[i],
          bytes: statSync(path).size,
          rows: readRows(path).length,
        })),
      }),
    });
  } finally {
    await app?.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
