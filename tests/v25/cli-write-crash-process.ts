import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath } from './electron-helpers';

/** Actual distributed CLI writes and then recovers its own partial file after SIGKILL. */
export async function verifyCliWriteCrash(executable: string, entry: string, packaged = false) {
  test.skip(
    process.platform === 'win32',
    'Real POSIX SIGSTOP/SIGKILL; Windows console recovery needs its native gate.',
  );
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'musefold-cli-write-crash-')));
  const pictures = join(root, 'Pictures');
  mkdirSync(pictures);
  const bytes = Buffer.alloc(32 * 1024 * 1024);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  // Large synthetic local response gives the OS watcher a real chunked-write window.
  const payload = JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] });
  let sends = 0;
  let upstream: ServerResponse | undefined;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* consume synthetic request */
    }
    sends++;
    upstream = response;
  });
  const handles: Array<ReturnType<typeof launch>> = [];
  let observer: ReturnType<typeof spawn> | undefined;
  let observerDone: Promise<number | null> | undefined;
  function launch() {
    const child = spawn(executable, [entry, 'serve', '--data-dir', root, '--port', '0'], {
      cwd: tmpdir(),
      env: {
        ...process.env,
        MUSEFOLD_E2E: '1',
        MUSEFOLD_PROVIDER_KEY_OWNED: 'synthetic-cli-crash-key',
        ...(packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.resume();
    const terminal = new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    );
    void terminal.catch(() => undefined);
    const live = () => child.exitCode === null && child.signalCode === null;
    const handle = {
      child,
      terminal,
      live,
      async ready() {
        await expect
          .poll(
            () => {
              if (!live()) throw new Error(`CLI exited before readiness: ${stderr}`);
              return stderr.includes('守护运行中');
            },
            { timeout: 15000 },
          )
          .toBe(true);
      },
      async stop(signal: 'SIGKILL' | 'SIGINT') {
        expect(child.kill(signal)).toBe(true);
        await expect.poll(() => live(), { timeout: 10000 }).toBe(false);
        return terminal;
      },
    };
    handles.push(handle);
    return handle;
  }
  function facts() {
    const db = new Database(desktopDbPath(root), { readonly: true });
    try {
      return {
        rows: db
          .prepare('SELECT path,device,inode,state,last_error FROM local_asset_cleanup')
          .all() as Array<{
          path: string;
          device: string | null;
          inode: string | null;
          state: string;
          last_error: string | null;
        }>,
        assets: db.prepare('SELECT COUNT(*) AS n FROM generated_assets').get(),
        run: db.prepare('SELECT id,status FROM generation_runs').get() as {
          id: string;
          status: string;
        },
      };
    } finally {
      db.close();
    }
  }
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    const writer = launch();
    await writer.ready();
    const seed = new Database(desktopDbPath(root));
    try {
      seed
        .prepare(
          "INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,created_at,updated_at) VALUES('owned','Owned','openai-compatible',?,'fixture-image',1,1,1,1)",
        )
        .run(`http://127.0.0.1:${address.port}/v1`);
    } finally {
      seed.close();
    }
    const discovery = JSON.parse(readFileSync(join(root, 'automation.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    const response = await fetch(`http://127.0.0.1:${discovery.port}/v1/generations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${discovery.token}`,
        'content-type': 'application/json',
        'idempotency-key': 'owned-real-cli-crash',
      },
      body: JSON.stringify({
        providerId: 'owned',
        prompt: 'Owned fixture',
        consent: 'interactive',
        n: 1,
      }),
      signal: AbortSignal.timeout(15000),
    });
    expect(response.status).toBe(202);
    await response.json();
    await expect.poll(() => upstream !== undefined, { timeout: 15000 }).toBe(true);
    const run = facts().run;
    const file = join(pictures, `${run.id}.png`);
    // Observe from an independent OS process before releasing the upstream bytes.
    // Directory fs.watch on macOS coalesces notifications and can arrive after a
    // fast write completes. The observer polls the known file without delaying IO.
    observer = spawn(
      process.execPath,
      [
        '-e',
        `
      const fs = require('node:fs');
      const pid = Number(process.argv[1]), file = process.argv[2];
      const deadline = Date.now() + 15000;
      const pause = new Int32Array(new SharedArrayBuffer(4));
      process.stdout.write('ready\\n');
      while (Date.now() < deadline) {
        try {
          if (fs.statSync(file).size > 0) { process.kill(pid, 'SIGSTOP'); process.exit(0); }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        Atomics.wait(pause, 0, 0, 0.1);
      }
      process.exit(2);
    `,
        String(writer.child.pid),
        file,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let observerOutput = '';
    observer.stdout?.on('data', (chunk) => {
      observerOutput += chunk.toString();
    });
    observer.stderr?.resume();
    observerDone = new Promise<number | null>((resolve, reject) => {
      observer?.once('error', reject);
      observer?.once('exit', (code) => resolve(code));
    });
    void observerDone.catch(() => undefined);
    await expect
      .poll(
        () => {
          if (observer?.exitCode !== null)
            throw new Error('Write observer exited before readiness');
          return observerOutput.includes('ready');
        },
        { timeout: 5000 },
      )
      .toBe(true);
    upstream?.writeHead(200, { 'content-type': 'application/json' });
    upstream?.end(payload);
    expect(await observerDone).toBe(0);
    await expect
      .poll(
        () =>
          spawnSync('ps', ['-o', 'stat=', '-p', String(writer.child.pid)], {
            encoding: 'utf8',
            timeout: 5000,
          }).stdout.trim(),
        { timeout: 5000 },
      )
      .toContain('T');
    const partialBytes = statSync(file).size;
    expect(partialBytes).toBeGreaterThan(0);
    expect(partialBytes).toBeLessThan(bytes.length);
    const before = facts();
    expect(before.rows).toEqual([
      expect.objectContaining({
        path: file,
        device: expect.any(String),
        inode: expect.any(String),
        state: 'pending',
      }),
    ]);
    expect(before.assets).toEqual({ n: 0 });
    expect(before.run.status).toBe('running');
    expect(await writer.stop('SIGKILL')).toEqual({ code: null, signal: 'SIGKILL' });
    const recovery = launch();
    await recovery.ready();
    expect(recovery.child.pid).not.toBe(writer.child.pid);
    const after = facts();
    expect(after).toEqual({
      rows: [],
      assets: { n: 0 },
      run: { id: before.run.id, status: 'failed' },
    });
    expect(existsSync(file)).toBe(false);
    expect(sends).toBe(1);
    expect(await recovery.stop('SIGINT')).toEqual({ code: 0, signal: null });
    expect(existsSync(join(root, 'owner.lock'))).toBe(false);
    return {
      packaged,
      writerPid: writer.child.pid,
      recoveryPid: recovery.child.pid,
      partialBytes,
      totalBytes: bytes.length,
      before,
      after,
      sends,
      ownerLockReleased: true,
      scope:
        'Actual CLI Automation API, local HTTP and OS payload writes; SIGSTOP state verified before SIGKILL, then fresh same-host CLI startup handles stale ownership and cleanup. No seeded cleanup row, direct drain or generation replay.',
    };
  } finally {
    if (observer && observer.exitCode === null && observer.signalCode === null) {
      observer.kill('SIGKILL');
      await observerDone;
    }
    for (const handle of handles) {
      if (handle.live()) await handle.stop('SIGKILL');
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}
