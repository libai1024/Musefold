import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadManagedFilesystem, type ManagedFilesystem } from '@musefold/managed-fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '../../db';
import { closeDesignSchemeDb } from '../../db/design-scheme';
import { configureTestCoreRuntime, testCorePaths } from '../../testing';
import { generate } from '../generation';
import { drainLocalAssetCleanup } from '../local-asset-cleanup';
import { withLocalAssetWriteScope, writeLocalGeneratedImage } from '../local-asset-writes';

// Actual HTTP, SQLite and native file IO. Fault injection wraps native calls or uses
// SQLite triggers; no Provider/write-port replacement can hide a partial file.
const native = loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node'));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYuQAAAAASUVORK5CYII=',
  'base64',
);
let root: string;
let pictures: string;
let first: string;
let second: string;
let filesystem: ManagedFilesystem;
let server: Server;
let sends: number;
let count: number;
let logs: unknown[][];

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'musefold-write-intents-')));
  pictures = testCorePaths(root).pictures;
  fs.mkdirSync(pictures, { recursive: true });
  first = join(pictures, 'owned-write.png');
  second = join(pictures, 'owned-write-2.png');
  filesystem = Object.fromEntries(
    Object.getOwnPropertyNames(native).map((name) => [name, Reflect.get(native, name)]),
  ) as unknown as ManagedFilesystem;
  sends = 0;
  count = 1;
  logs = [];
  const log = (...values: unknown[]) => logs.push(values);
  configureTestCoreRuntime(root, {
    managedFilesystem: () => filesystem,
    loadApiKey: () => 'synthetic-write-key',
    createLogger: () => ({ debug: log, info: log, warn: log, error: log }),
  });
  server = createServer(async (request, response) => {
    for await (const _bytes of request) {
      /* consume actual request */
    }
    sends++;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        created: 1,
        data: Array.from({ length: count }, () => ({ b64_json: png.toString('base64') })),
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  getDb()
    .prepare(`INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,created_at,updated_at)
    VALUES ('owned','Owned','openai-compatible',?,'gpt-image-1',1,1,1,1)`)
    .run(`http://127.0.0.1:${address.port}/v1`);
});

afterEach(async () => {
  vi.restoreAllMocks();
  closeDesignSchemeDb();
  closeDb();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

const queue = () => getDb().prepare('SELECT * FROM local_asset_cleanup ORDER BY path').all();
const assets = () => getDb().prepare('SELECT COUNT(*) AS n FROM generated_assets').get();
const due = () =>
  (
    getDb().prepare('SELECT MAX(next_attempt_at) AS n FROM local_asset_cleanup').get() as {
      n: number;
    }
  ).n;
const run = () =>
  generate({
    jobId: 'owned-write',
    providerId: 'owned',
    prompt: 'Owned fixture',
    size: '1024x1024',
    quality: 'medium',
    n: count,
  });
function failIdentityCommit() {
  getDb().exec(
    "CREATE TRIGGER identity_fault BEFORE UPDATE ON local_asset_cleanup WHEN NEW.device IS NOT NULL BEGIN SELECT RAISE(ABORT,'owned identity failure'); END",
  );
}

it('reserves before exclusive creation, protects the empty file during maintenance, then publishes actual bytes', async () => {
  let observed = 0;
  vi.spyOn(filesystem, 'openFile').mockImplementation((directory, name, mode) => {
    if (mode !== 'create') return native.openFile(directory, name, mode);
    expect(queue()).toEqual([expect.objectContaining({ path: first, device: null, inode: null })]);
    expect(fs.existsSync(first)).toBe(false);
    const fd = native.openFile(directory, name, mode);
    expect(fs.fstatSync(fd).size).toBe(0);
    expect(drainLocalAssetCleanup(due())).toMatchObject({ protected: 1, deleted: 0, blocked: 0 });
    observed++;
    return fd;
  });
  expect((await run()).status).toBe('success');
  expect(observed).toBe(1);
  expect(sends).toBe(1);
  expect(fs.readFileSync(first)).toEqual(png);
  expect(assets()).toEqual({ n: 1 });
  expect(queue()).toEqual([]);
});

it('removes the first actual image when the second exclusive creation fails on a directory', async () => {
  count = 2;
  fs.mkdirSync(second);
  let sawFirst = false;
  vi.spyOn(filesystem, 'openFile').mockImplementation((directory, name, mode) => {
    if (mode === 'create' && name.endsWith('-2.png')) {
      expect(fs.readFileSync(first)).toEqual(png);
      expect(queue()).toHaveLength(2);
      expect(drainLocalAssetCleanup(due())).toMatchObject({ protected: 2, deleted: 0 });
      sawFirst = true;
    }
    return native.openFile(directory, name, mode);
  });
  expect((await run()).status).toBe('failed');
  expect(sawFirst).toBe(true);
  expect(sends).toBe(1);
  expect(assets()).toEqual({ n: 0 });
  expect(fs.existsSync(first)).toBe(false);
  expect(fs.statSync(second).isDirectory()).toBe(true);
  expect(queue()).toEqual([]);
});

it('does not create a file if the durable reservation INSERT fails', async () => {
  getDb().exec(
    "CREATE TRIGGER intent_fault BEFORE INSERT ON local_asset_cleanup BEGIN SELECT RAISE(ABORT,'owned insert failure'); END",
  );
  const open = vi.spyOn(filesystem, 'openFile');
  expect((await run()).status).toBe('failed');
  expect(open).not.toHaveBeenCalled();
  expect(fs.readdirSync(pictures)).toEqual([]);
  expect(assets()).toEqual({ n: 0 });
  expect(queue()).toEqual([]);
});

it('removes only the exclusively created empty file when committing its identity fails', async () => {
  failIdentityCommit();
  const unlink = vi.spyOn(filesystem, 'unlinkFile');
  expect((await run()).status).toBe('failed');
  expect(unlink).toHaveBeenCalledTimes(1);
  expect(fs.existsSync(first)).toBe(false);
  expect(queue()).toEqual([]);
});

it('retains a blocked reservation if both identity commit and empty-file compensation fail', async () => {
  failIdentityCommit();
  vi.spyOn(filesystem, 'unlinkFile').mockImplementationOnce(() => {
    throw new Error(`owned private ${first}`);
  });
  expect((await run()).status).toBe('failed');
  expect(fs.statSync(first).size).toBe(0);
  expect(queue()).toEqual([
    expect.objectContaining({
      device: null,
      inode: null,
      state: 'blocked',
      last_error: 'file_identity_changed',
    }),
  ]);
  expect(assets()).toEqual({ n: 0 });
  expect(JSON.stringify(logs)).not.toContain(first);
  // Ambiguous ownership is recorded, not misreported as successful physical cleanup.
});

it('never truncates or adopts an existing original at the generated filename', async () => {
  fs.writeFileSync(first, 'owned original');
  expect((await run()).status).toBe('failed');
  expect(fs.readFileSync(first, 'utf8')).toBe('owned original');
  expect(queue()).toEqual([]);
  expect(assets()).toEqual({ n: 0 });
});

it('retries a partial-batch deletion after reopening both databases, respecting persisted backoff', async () => {
  count = 2;
  fs.mkdirSync(second);
  vi.spyOn(filesystem, 'unlinkFile').mockImplementationOnce(() => {
    throw new Error(`owned private ${first}`);
  });
  expect((await run()).status).toBe('failed');
  expect(queue()).toEqual([
    expect.objectContaining({ attempt_count: 1, last_error: 'file_delete_failed' }),
  ]);
  expect(fs.readFileSync(first)).toEqual(png);
  expect(JSON.stringify(logs)).not.toContain(first);
  const next = due();
  closeDesignSchemeDb();
  closeDb();
  expect(drainLocalAssetCleanup(next - 1).examined).toBe(0);
  expect(drainLocalAssetCleanup(next)).toMatchObject({ deleted: 1, failed: 0 });
  expect(fs.existsSync(first)).toBe(false);
  expect(queue()).toEqual([]);
  expect(sends).toBe(1);
});

it('retains a partial image while another run references it, then deletes after the last reference', async () => {
  count = 2;
  fs.mkdirSync(second);
  getDb()
    .prepare(`INSERT INTO generation_runs(id,run_kind,provider_id,model,base_prompt,final_prompt,params_json,prompt_snapshot_json,status,created_at)
    VALUES ('reader','free_generation','owned','owned','Owned','Owned',?,'{}','failed',1)`)
    .run(
      JSON.stringify({
        referenceImages: [{ path: first, source: 'history', historyId: 'owned-write' }],
      }),
    );
  expect((await run()).status).toBe('failed');
  expect(fs.readFileSync(first)).toEqual(png);
  expect(queue()).toEqual([expect.objectContaining({ last_error: 'referenced' })]);
  getDb().prepare("UPDATE generation_runs SET params_json='{}' WHERE id='reader'").run();
  expect(drainLocalAssetCleanup(due()).deleted).toBe(1);
  expect(fs.existsSync(first)).toBe(false);
});

it('rejects publication after an independent process replaces the pictures root, preserving outside originals', async () => {
  const detached = join(root, 'detached');
  const outside = join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(join(outside, 'owned-write.png'), 'outside original');
  let replaced = false;
  vi.spyOn(filesystem, 'openFile').mockImplementationOnce((directory, name, mode) => {
    const fd = native.openFile(directory, name, mode);
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        "const fs=require('node:fs');fs.renameSync(process.argv[1],process.argv[2]);fs.symlinkSync(process.argv[3],process.argv[1],'junction');",
        pictures,
        detached,
        outside,
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    expect(child.status, child.stderr).toBe(0);
    replaced = true;
    return fd;
  });
  expect((await run()).status).toBe('failed');
  expect(replaced).toBe(true);
  expect(assets()).toEqual({ n: 0 });
  expect(fs.readFileSync(join(outside, 'owned-write.png'), 'utf8')).toBe('outside original');
  expect(fs.readFileSync(join(detached, 'owned-write.png'))).toEqual(png);
  expect(queue()).toEqual([expect.objectContaining({ state: 'blocked' })]);
});

it('protects overlapping scopes independently and releases only the completed writer', async () => {
  function start(path: string) {
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = withLocalAssetWriteScope(async () => {
      await writeLocalGeneratedImage(path, png);
      entered();
      await hold;
    });
    return { ready, release: () => release(), pending };
  }
  const one = start(first);
  const two = start(second);
  try {
    await Promise.all([one.ready, two.ready]);
    expect(drainLocalAssetCleanup(due())).toMatchObject({ protected: 2, deleted: 0 });
    one.release();
    await one.pending;
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.readFileSync(second)).toEqual(png);
    expect(queue()).toHaveLength(1);
    expect(drainLocalAssetCleanup(due())).toMatchObject({ protected: 1, deleted: 0 });
  } finally {
    one.release();
    two.release();
    await Promise.all([one.pending, two.pending]);
  }
  expect(fs.existsSync(second)).toBe(false);
  expect(queue()).toEqual([]);
});

it('refuses an unavailable host filesystem before any Provider HTTP dispatch', async () => {
  configureTestCoreRuntime(root, {
    managedFilesystem: undefined,
    loadApiKey: () => 'synthetic-write-key',
  });
  const result = await run();
  expect(result.status).toBe('failed');
  expect(sends).toBe(0);
  expect(fs.readdirSync(pictures)).toEqual([]);
});
