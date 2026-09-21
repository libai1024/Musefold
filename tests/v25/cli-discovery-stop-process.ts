import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath } from './electron-helpers';

/** Real macOS file protection, isolated compiled CLI, and two actual daemon processes. */
export async function verifyCliDiscoveryStop(executable: string, entry: string, packaged = false) {
  test.skip(
    process.platform !== 'darwin',
    'The immutable discovery fixture uses macOS uchg. Windows/Linux native deletion-failure behavior requires its own platform fixture.',
  );
  const root = mkdtempSync(join(tmpdir(), 'musefold-cli-discovery-stop-'));
  const discovery = join(root, 'automation.json');
  const cleanups: Array<() => Promise<void>> = [];
  function launch() {
    const child = spawn(executable, [entry, 'serve', '--data-dir', root, '--port', '0'], {
      cwd: tmpdir(),
      env: {
        ...process.env,
        MUSEFOLD_E2E: '1',
        ...(packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostic = '';
    child.stdout.resume();
    child.stderr.on('data', (bytes) => {
      diagnostic += bytes.toString();
    });
    let result: { code: number | null; signal: string | null } | undefined;
    const terminal = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        result = { code, signal };
        resolve();
      });
    });
    void terminal.catch(() => undefined);
    const handle = {
      child,
      terminal,
      outcome: () => result,
      async ready() {
        await expect
          .poll(
            () => {
              if (result) throw new Error(`CLI exited before readiness (code ${result.code})`);
              return diagnostic.includes('守护运行中');
            },
            { timeout: 15000 },
          )
          .toBe(true);
        return JSON.parse(readFileSync(discovery, 'utf8')) as { port: number; token: string };
      },
    };
    cleanups.push(async () => {
      if (!result) child.kill('SIGKILL');
      await terminal;
    });
    return handle;
  }
  try {
    const first = launch();
    const info = await first.ready();
    const response = await fetch(`http://127.0.0.1:${info.port}/v1/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'image/png' },
      body: Buffer.from('89504e470d0a1a0a00000000', 'hex'),
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(201);
    const { image } = (await response.json()) as { image: { path: string } };
    expect(existsSync(image.path)).toBe(true);
    execFileSync('chflags', ['uchg', discovery]);
    expect(first.child.kill('SIGTERM')).toBe(true);
    await expect.poll(() => first.outcome(), { timeout: 10000 }).toEqual({ code: 0, signal: null });
    await first.terminal;
    expect(existsSync(image.path)).toBe(false);
    expect(existsSync(join(root, 'owner.lock'))).toBe(false);
    expect(existsSync(discovery)).toBe(true);
    await expect(
      fetch(`http://127.0.0.1:${info.port}/v1/health`, {
        headers: { authorization: `Bearer ${info.token}` },
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toThrow();
    // The stale locator deliberately survived; remove only our file protection before restart.
    execFileSync('chflags', ['nouchg', discovery]);
    const second = launch();
    await second.ready();
    expect(second.child.pid).not.toBe(first.child.pid);
    const db = new Database(desktopDbPath(root), { readonly: true });
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM local_asset_cleanup').get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
    expect(second.child.kill('SIGTERM')).toBe(true);
    await expect
      .poll(() => second.outcome(), { timeout: 10000 })
      .toEqual({ code: 0, signal: null });
    await second.terminal;
    return {
      firstPid: first.child.pid,
      secondPid: second.child.pid,
      packaged,
      uploadReleased: true,
      lockReleased: true,
      oldListenerClosed: true,
      remainingCleanup: 0,
      scope:
        'Real compiled CLI/native IO/SQLite; macOS immutable discovery; no generation requests.',
    };
  } finally {
    if (existsSync(discovery)) execFileSync('chflags', ['nouchg', discovery]);
    for (const cleanup of cleanups) await cleanup();
    rmSync(root, { recursive: true, force: true });
  }
}
