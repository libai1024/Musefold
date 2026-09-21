import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

let buildRoot: string;
let entry: string;
beforeAll(() => {
  const output = resolve('tests/v25/.results');
  fs.mkdirSync(output, { recursive: true });
  buildRoot = fs.mkdtempSync(join(output, 'write-crash-build-'));
  entry = join(buildRoot, 'process.cjs');
  const build = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import {build} from 'esbuild';
    import {pickAliases,SHARED_ALIAS_RELATIVE} from './tooling/aliases.mjs';
    await build({entryPoints:['tests/v25/fixtures/local-asset-write-process.ts'],outfile:process.argv[1],
      bundle:true,platform:'node',format:'cjs',external:['better-sqlite3'],
      alias:pickAliases(Object.keys(SHARED_ALIAS_RELATIVE)),logLevel:'error'});
  `,
      entry,
    ],
    { encoding: 'utf8', timeout: 20000 },
  );
  expect(build.status, build.stderr).toBe(0);
}, 25000);
afterAll(() => {
  if (buildRoot) fs.rmSync(buildRoot, { recursive: true, force: true });
});

it.skipIf(process.platform === 'win32').each(['reserved', 'empty', 'payload'])(
  'recovers a real killed writer at the %s checkpoint in a new process',
  async (checkpoint) => {
    const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'musefold-crash-write-')));
    let sends = 0;
    const server = createServer(async (request, response) => {
      for await (const _bytes of request) {
        /* consume real request */
      }
      sends++;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          created: 1,
          data: [{ b64_json: Buffer.from('owned payload').toString('base64') }],
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    const child = spawn(
      process.execPath,
      [entry, 'write', root, `http://127.0.0.1:${address.port}/v1`, checkpoint],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (bytes) => {
      stderr += bytes.toString();
    });
    child.stdout.resume();
    const terminal = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    void terminal.catch(() => undefined);
    try {
      await expect
        .poll(
          () => {
            if (child.exitCode !== null || child.signalCode !== null)
              throw new Error(`Writer exited: ${stderr}`);
            return fs.existsSync(join(root, 'checkpoint.json'));
          },
          { timeout: 10000, interval: 20 },
        )
        .toBe(true);
      await expect
        .poll(
          () =>
            spawnSync('ps', ['-o', 'stat=', '-p', String(child.pid)], {
              encoding: 'utf8',
            }).stdout.trim(),
          { timeout: 5000, interval: 20 },
        )
        .toContain('T');
      const observed = JSON.parse(fs.readFileSync(join(root, 'checkpoint.json'), 'utf8'));
      expect(observed).toMatchObject({
        pid: child.pid,
        stage: checkpoint,
        exists: checkpoint !== 'reserved',
      });
      if (checkpoint === 'payload') {
        expect(observed.bytes).toBe(Buffer.byteLength('owned payload'));
        expect(observed.row.device).toEqual(expect.any(String));
        expect(observed.row.inode).toEqual(expect.any(String));
      } else {
        expect(observed.row).toMatchObject({ device: null, inode: null });
        expect(observed.bytes).toBe(checkpoint === 'empty' ? 0 : null);
      }
      expect(child.kill('SIGKILL')).toBe(true);
      expect(await terminal).toEqual({ code: null, signal: 'SIGKILL' });
      const recovery = spawnSync(process.execPath, [entry, 'recover', root], {
        encoding: 'utf8',
        timeout: 10000,
      });
      expect(recovery.status, recovery.stderr).toBe(0);
      const report = JSON.parse(recovery.stdout.trim());
      expect(report.pid).not.toBe(observed.pid);
      expect(report.before).toHaveLength(1);
      expect(report.assets).toEqual({ n: 0 });
      expect(report.run).toEqual({ status: 'failed' });
      if (checkpoint === 'empty') {
        expect(report.counts).toMatchObject({ blocked: 1, deleted: 0 });
        expect(report.after).toEqual([
          { device: null, inode: null, state: 'blocked', last_error: 'file_identity_changed' },
        ]);
        expect(report.exists).toBe(true);
        expect(report.bytes).toBe(0);
      } else {
        expect(report.counts).toMatchObject(
          checkpoint === 'reserved' ? { missing: 1, deleted: 0 } : { deleted: 1, blocked: 0 },
        );
        expect(report.after).toEqual([]);
        expect(report.exists).toBe(false);
      }
      expect(sends).toBe(1);
      // SIGSTOP/SIGKILL is POSIX-specific. This is a production core process test,
      // not evidence for native Windows console events or packaged host admission.
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await terminal;
      }
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  20000,
);
