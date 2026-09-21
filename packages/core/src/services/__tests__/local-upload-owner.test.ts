import Database from 'better-sqlite3';
import { runDesignSchemeDbMigrations } from '../../db/design-scheme/migrations';
import { getDesignSchemeDb } from '../../db/design-scheme';
import { enqueueLocalAssetCleanup } from '../local-asset-cleanup';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadManagedFilesystem, type ManagedFilesystem } from '@musefold/managed-fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '../../db';
import { closeDesignSchemeDb } from '../../db/design-scheme';
import { stageLocalImageBytes } from '../../providers/local-image';
import { configureTestCoreRuntime, testCorePaths } from '../../testing';
import { drainLocalAssetCleanup } from '../local-asset-cleanup';
import { createLocalUploadOwner, type LocalUploadOwner } from '../local-upload-owner';

const native = loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node'));
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
let root: string;
let filesystem: ManagedFilesystem;
let owners: LocalUploadOwner[];
const queue = () => getDb().prepare('SELECT * FROM local_asset_cleanup ORDER BY path').all();
const due = () =>
  (
    getDb().prepare('SELECT MAX(next_attempt_at) AS n FROM local_asset_cleanup').get() as {
      n: number;
    }
  ).n;
const upload = (owner: LocalUploadOwner, bytes = png) =>
  stageLocalImageBytes({ name: 'owned.png', bytes }, owner);
function owner() {
  const result = createLocalUploadOwner();
  owners.push(result);
  return result;
}
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'musefold-upload-owner-')));
  filesystem = Object.fromEntries(
    Object.getOwnPropertyNames(native).map((name) => [name, Reflect.get(native, name)]),
  ) as unknown as ManagedFilesystem;
  configureTestCoreRuntime(root, { managedFilesystem: () => filesystem });
  owners = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const entry of owners) entry.close();
  closeDesignSchemeDb();
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

it('persists intent before actual creation and protects a successful upload until its owner releases it', async () => {
  let observed = 0;
  vi.spyOn(filesystem, 'openFile').mockImplementation((directory, name, mode) => {
    if (mode === 'create') {
      expect(queue()).toEqual([expect.objectContaining({ device: null, inode: null })]);
      expect(drainLocalAssetCleanup(due())).toMatchObject({ protected: 1, deleted: 0 });
      observed++;
    }
    return native.openFile(directory, name, mode);
  });
  const lifetime = owner();
  const image = await upload(lifetime);
  expect(observed).toBe(1);
  expect(fs.readFileSync(image.path)).toEqual(png);
  expect(drainLocalAssetCleanup(due())).toMatchObject({ protected: 1, deleted: 0 });
  lifetime.release([image.path]);
  expect(fs.existsSync(image.path)).toBe(false);
  expect(queue()).toEqual([]);
  lifetime.close();
  lifetime.close();
});

it('does not let one owner release another owner or adopt an arbitrary original', async () => {
  const one = owner();
  const two = owner();
  const a = await upload(one);
  const b = await upload(two);
  const original = join(testCorePaths(root).previews, 'original.png');
  fs.writeFileSync(original, png);
  two.release([a.path, original]);
  expect(drainLocalAssetCleanup(due())).toMatchObject({ protected: 2, deleted: 0 });
  one.close();
  expect(fs.existsSync(a.path)).toBe(false);
  expect(fs.readFileSync(b.path)).toEqual(png);
  two.close();
  expect(fs.existsSync(b.path)).toBe(false);
  expect(fs.readFileSync(original)).toEqual(png);
  expect(queue()).toEqual([]);
});

it('retains a released upload referenced by a surviving run, then removes it after the last reference', async () => {
  const lifetime = owner();
  const image = await upload(lifetime);
  getDb()
    .prepare(`INSERT INTO generation_runs(id,run_kind,provider_id,model,base_prompt,final_prompt,params_json,prompt_snapshot_json,status,created_at)
    VALUES ('reader','free_generation','owned','owned','Owned','Owned',?,'{}','failed',1)`)
    .run(JSON.stringify({ referenceImages: [{ path: image.path, source: 'upload' }] }));
  lifetime.close();
  expect(fs.readFileSync(image.path)).toEqual(png);
  expect(queue()).toEqual([expect.objectContaining({ last_error: 'referenced' })]);
  getDb().prepare("DELETE FROM generation_runs WHERE id='reader'").run();
  expect(drainLocalAssetCleanup(due())).toMatchObject({ deleted: 1, failed: 0 });
  expect(fs.existsSync(image.path)).toBe(false);
});

it('retains failed deletion intent and retries after actual database reopen', async () => {
  const lifetime = owner();
  const image = await upload(lifetime);
  vi.spyOn(filesystem, 'unlinkFile').mockImplementationOnce(() => {
    throw new Error('owned failure');
  });
  lifetime.close();
  expect(queue()).toEqual([
    expect.objectContaining({ attempt_count: 1, last_error: 'file_delete_failed' }),
  ]);
  expect(fs.readFileSync(image.path)).toEqual(png);
  const next = due();
  closeDesignSchemeDb();
  closeDb();
  expect(drainLocalAssetCleanup(next - 1).examined).toBe(0);
  expect(drainLocalAssetCleanup(next)).toMatchObject({ deleted: 1, failed: 0 });
  expect(queue()).toEqual([]);
});

it('refuses closed owners before creating files', async () => {
  const lifetime = owner();
  lifetime.close();
  await expect(upload(lifetime)).rejects.toMatchObject({ code: 'IMAGE_UPLOAD_CLOSED' });
  expect(fs.existsSync(join(testCorePaths(root).previews, 'uploads'))).toBe(false);
});

it('rejects a close during native creation and recovers the known empty file from its durable intent', async () => {
  const lifetime = owner();
  vi.spyOn(filesystem, 'openFile').mockImplementationOnce((directory, name, mode) => {
    const fd = native.openFile(directory, name, mode);
    lifetime.close();
    return fd;
  });
  await expect(upload(lifetime)).rejects.toMatchObject({ code: 'IMAGE_READ_FAILED' });
  expect(drainLocalAssetCleanup(due())).toMatchObject({ missing: 1, deleted: 0, protected: 0 });
  expect(fs.readdirSync(join(testCorePaths(root).previews, 'uploads'))).toEqual([]);
  expect(queue()).toEqual([]);
});

it('stops after the in-flight first chunk when closed during actual async writing, then recovers without another upload', async () => {
  const lifetime = owner();
  const bytes = Buffer.alloc(8 * 1024 * 1024);
  png.copy(bytes);
  vi.spyOn(filesystem, 'openFile').mockImplementationOnce((directory, name, mode) => {
    const fd = native.openFile(directory, name, mode);
    // The writer submits its first asynchronous chunk before returning to microtasks.
    queueMicrotask(() => lifetime.close());
    return fd;
  });
  await expect(upload(lifetime, bytes)).rejects.toMatchObject({ code: 'IMAGE_READ_FAILED' });
  const rows = queue() as Array<{ path: string; device: string; inode: string }>;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.device).not.toBeNull();
  expect(fs.statSync(rows[0]!.path).size).toBe(65536);
  expect(drainLocalAssetCleanup(due())).toMatchObject({ deleted: 1, protected: 0 });
  expect(queue()).toEqual([]);
});

it('rejects reconfigured runtime and closed database without sending writes to a different database', async () => {
  const lifetime = owner();
  const image = await upload(lifetime);
  configureTestCoreRuntime(join(root, 'next'), { managedFilesystem: () => filesystem });
  await expect(upload(lifetime)).rejects.toMatchObject({ code: 'IMAGE_UPLOAD_CLOSED' });
  lifetime.close();
  expect(fs.readFileSync(image.path)).toEqual(png);
  configureTestCoreRuntime(root, { managedFilesystem: () => filesystem });
  expect(drainLocalAssetCleanup(due())).toMatchObject({ deleted: 1, protected: 0 });
  const next = owner();
  next.assertCurrent();
  closeDb();
  await expect(upload(next)).rejects.toMatchObject({ code: 'IMAGE_UPLOAD_CLOSED' });
});

it('releases captured ownership after root replacement while preserving the outside original', async () => {
  const lifetime = owner();
  const image = await upload(lifetime);
  const uploads = join(testCorePaths(root).previews, 'uploads');
  const detached = join(root, 'detached');
  const outside = join(root, 'outside');
  fs.mkdirSync(outside);
  const name = image.path.slice(image.path.lastIndexOf('/') + 1);
  fs.writeFileSync(join(outside, name), 'outside original');
  fs.renameSync(uploads, detached);
  fs.symlinkSync(outside, uploads, 'junction');
  lifetime.release([image.path]);
  expect(queue()).toEqual([
    expect.objectContaining({ state: 'blocked', last_error: 'file_identity_changed' }),
  ]);
  expect(fs.readFileSync(join(outside, name), 'utf8')).toBe('outside original');
  expect(fs.readFileSync(join(detached, name))).toEqual(png);
});

it('refuses uploads after the explicit scheme database has closed', async () => {
  const schemeDb = getDesignSchemeDb();
  const lifetime = createLocalUploadOwner({ schemeDb });
  owners.push(lifetime);
  lifetime.assertCurrent();
  closeDesignSchemeDb();
  await expect(upload(lifetime)).rejects.toMatchObject({ code: 'IMAGE_UPLOAD_CLOSED' });
  expect(queue()).toEqual([]);
});

it('uses the supplied scheme database during both write finalization and owner release', async () => {
  const schemeDb = new Database(':memory:');
  runDesignSchemeDbMigrations(schemeDb);
  const lifetime = createLocalUploadOwner({ schemeDb });
  owners.push(lifetime);
  try {
    const previous = join(testCorePaths(root).previews, 'retained-source.png');
    fs.mkdirSync(testCorePaths(root).previews, { recursive: true });
    fs.writeFileSync(previous, png);
    schemeDb
      .prepare("INSERT INTO source_packages(id,kind,created_at) VALUES ('pkg','user-brief',1)")
      .run();
    schemeDb
      .prepare(
        "INSERT INTO source_snapshots(id,package_id,ref,content_hash,scan_json,created_at) VALUES ('snap','pkg','owned','owned','{}',1)",
      )
      .run();
    schemeDb
      .prepare(
        "INSERT INTO source_files(snapshot_id,path,kind,content_hash,size_bytes,store_key) VALUES ('snap','owned.png','image','owned',12,?)",
      )
      .run(previous);
    enqueueLocalAssetCleanup([previous]);
    const image = await upload(lifetime);
    expect(fs.readFileSync(previous)).toEqual(png);
    expect(queue()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: previous, last_error: 'referenced' }),
      ]),
    );
    lifetime.close();
    expect(fs.existsSync(image.path)).toBe(false);
    expect(fs.readFileSync(previous)).toEqual(png);
    schemeDb.prepare("DELETE FROM source_files WHERE snapshot_id='snap'").run();
    expect(drainLocalAssetCleanup(due(), getDb(), schemeDb)).toMatchObject({
      deleted: 1,
      failed: 0,
    });
    expect(queue()).toEqual([]);
  } finally {
    lifetime.close();
    schemeDb.close();
  }
});

const { AutomationSpendRepository } = await import('../../db/repositories/automation-spend');
const spendBinding = {
  providerId: 'owned-provider',
  providerType: 'openai-compatible',
  model: 'owned-model',
  baseUrl: 'http://127.0.0.1:12345/v1',
  credentialEpoch: 'owned-epoch',
  payerKind: 'account' as const,
  ownerId: 'owned-account',
  issuer: 'http://127.0.0.1:12346',
  policy: 'managed' as const,
};
function registerReference(path: string, key = 'owned-reference', scopeId?: string) {
  const db = getDb();
  const spend = new AutomationSpendRepository(db, scopeId);
  const now = Date.now();
  spend.initializeBudget(
    { monthlyLimitPoints: 0, usedPoints: 0, month: new Date(now).toISOString().slice(0, 7) },
    now,
  );
  const { request } = spend.register({
    idempotencyKey: key,
    action: 'generate_image',
    caller: 'local-automation',
    input: { prompt: 'Owned', referenceImagePaths: [path] },
    frozenInput: {
      body: { prompt: 'Owned', referenceImagePaths: [path] },
      providerId: spendBinding.providerId,
      model: spendBinding.model,
      references: [{ path, source: 'upload' }],
      referenceHashes: ['0'.repeat(64)],
    },
    bindings: [spendBinding],
    promptText: 'Owned',
    executionId: key,
    maxImageCalls: 1,
    maxTextCalls: 0,
    estimatedPoints: 5,
    now,
  });
  return { request, spend, now };
}

it.each(['pending_confirmation', 'authorized', 'running', 'terminal'] as const)(
  'keeps a real uploaded reference with only a retained Automation %s snapshot through release and DB reopen',
  async (state) => {
    const lifetime = owner();
    const image = await upload(lifetime);
    const { request, spend, now } = registerReference(image.path);
    expect(request.state).toBe('pending_confirmation');
    if (state !== 'pending_confirmation') {
      expect(spend.resolveConfirmation(request.confirmationId!, true, now + 1)).toBeTruthy();
      if (state === 'running') expect(spend.beginExecution(request.id)).toBeTruthy();
      if (state === 'terminal') spend.finishRequest(request.id, 'cancelled', now + 2);
    }
    const before = getDb().prepare('SELECT * FROM automation_spend_requests').all();
    expect(before).toEqual([expect.objectContaining({ state })]);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM generation_runs').get()).toEqual({ n: 0 });
    lifetime.close();
    expect(fs.existsSync(image.path)).toBe(true);
    expect(fs.readFileSync(image.path)).toEqual(png);
    expect(queue()).toEqual([expect.objectContaining({ last_error: 'referenced' })]);
    const next = due();
    closeDesignSchemeDb();
    closeDb();
    expect(drainLocalAssetCleanup(next)).toMatchObject({ protected: 1, deleted: 0 });
    expect(fs.readFileSync(image.path)).toEqual(png);
    expect(getDb().prepare('SELECT * FROM automation_spend_requests').all()).toEqual(before);
  },
);

it('keeps the same reference across two persisted scopes until the final reference disappears', async () => {
  const lifetime = owner();
  const image = await upload(lifetime);
  const first = registerReference(image.path, 'owned-first', 'owned-previous-scope');
  const second = registerReference(image.path, 'owned-second');
  lifetime.close();
  expect(fs.existsSync(image.path)).toBe(true);
  // Test-only removal expresses the last-reference predicate, not a new production ledger purge API.
  getDb().prepare('DELETE FROM automation_spend_requests WHERE id=?').run(second.request.id);
  expect(drainLocalAssetCleanup(due())).toMatchObject({ protected: 1, deleted: 0 });
  getDb().prepare('DELETE FROM automation_spend_requests WHERE id=?').run(first.request.id);
  expect(drainLocalAssetCleanup(due())).toMatchObject({ deleted: 1 });
  expect(queue()).toEqual([]);
});

it('does not treat a filename in a retained prompt as an asset reference', async () => {
  const lifetime = owner();
  const image = await upload(lifetime);
  const { request } = registerReference(image.path);
  getDb()
    .prepare('UPDATE automation_spend_requests SET frozen_input_json=? WHERE id=?')
    .run(
      JSON.stringify({ body: { prompt: image.path }, references: [], referenceHashes: [] }),
      request.id,
    );
  lifetime.close();
  expect(fs.existsSync(image.path)).toBe(false);
  expect(queue()).toEqual([]);
});

it('retains durable cleanup and files when a stored reference snapshot is corrupt', async () => {
  const lifetime = owner();
  const image = await upload(lifetime);
  const { request } = registerReference(image.path);
  getDb()
    .prepare('UPDATE automation_spend_requests SET frozen_input_json=? WHERE id=?')
    .run('{', request.id);
  lifetime.close();
  expect(fs.existsSync(image.path)).toBe(true);
  expect(queue()).toHaveLength(1);
  expect(() => drainLocalAssetCleanup(due())).toThrow();
  expect(fs.readFileSync(image.path)).toEqual(png);
});
