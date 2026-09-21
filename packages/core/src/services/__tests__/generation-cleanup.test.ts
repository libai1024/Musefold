import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadManagedFilesystem, type ManagedFilesystem } from '@musefold/managed-fs';
import { closeDb, getDb } from '../../db';
import { closeDesignSchemeDb, getDesignSchemeDb } from '../../db/design-scheme';
import { configureTestCoreRuntime, testCorePaths } from '../../testing';
import { cancelGeneration, generate } from '../generation';
import { drainLocalAssetCleanup } from '../local-asset-cleanup';

const native = loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node'));
let root: string;
let file: string;
let filesystem: ManagedFilesystem;
let logs: unknown[][];
let ready: Promise<void>;
let finish: (value: { historyId: string; status: 'success'; imagePath: string }) => void;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'musefold-generation-cleanup-'));
  logs = [];
  filesystem = Object.fromEntries(
    Object.getOwnPropertyNames(native).map((name) => [name, Reflect.get(native, name)]),
  ) as unknown as ManagedFilesystem;
  let entered: () => void = () => undefined;
  ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const response = new Promise<{ historyId: string; status: 'success'; imagePath: string }>(
    (resolve) => {
      finish = resolve;
    },
  );
  const log = (...values: unknown[]) => {
    logs.push(values);
  };
  configureTestCoreRuntime(root, {
    managedFilesystem: () => filesystem,
    createLogger: () => ({ debug: log, info: log, warn: log, error: log }),
    doubaoWeb: {
      validate: vi.fn(),
      generateImage: () => {
        entered();
        return response;
      },
    },
  });
  const pictures = testCorePaths(root).pictures;
  mkdirSync(join(pictures, 'owned'), { recursive: true });
  file = join(pictures, 'owned', 'image.png');
  writeFileSync(file, 'owned returned bytes');
  getDb()
    .prepare(`INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,created_at,updated_at)
    VALUES ('owned-provider','Owned','doubao-web','https://www.doubao.com/chat/create-image','owned',1,1,1,1)`)
    .run();
});
afterEach(() => {
  vi.restoreAllMocks();
  closeDesignSchemeDb();
  closeDb();
  rmSync(root, { recursive: true, force: true });
});

const queue = () => getDb().prepare('SELECT * FROM local_asset_cleanup').all();
async function returnedAfter(cancel = true) {
  const pending = generate({
    jobId: 'owned-job',
    providerId: 'owned-provider',
    prompt: 'Owned fixture',
    size: '1024x1024',
    quality: 'medium',
    n: 1,
  });
  await ready;
  if (cancel) expect(cancelGeneration('owned-job')).toBe(true);
  finish({ historyId: 'owned-job', status: 'success', imagePath: file });
  return pending;
}

it.each(['absolute', 'legacy-relative'])(
  'protects a %s scheme source and deletes only after its last reference is removed',
  async (kind) => {
    const schemes = getDesignSchemeDb();
    schemes
      .prepare("INSERT INTO source_packages(id,kind,created_at) VALUES ('pkg','user-brief',1)")
      .run();
    schemes
      .prepare(
        "INSERT INTO source_snapshots(id,package_id,ref,content_hash,scan_json,created_at) VALUES ('snap','pkg','owned','owned','{}',1)",
      )
      .run();
    schemes
      .prepare(
        "INSERT INTO source_files(snapshot_id,path,kind,content_hash,size_bytes,store_key) VALUES ('snap','image.png','image','owned',20,?)",
      )
      .run(kind === 'absolute' ? file : relative(root, file));
    expect((await returnedAfter()).status).toBe('cancelled');
    expect(readFileSync(file, 'utf8')).toBe('owned returned bytes');
    const pending = queue();
    expect(pending).toEqual([
      expect.objectContaining({ state: 'pending', last_error: 'referenced' }),
    ]);
    schemes.prepare("DELETE FROM source_files WHERE snapshot_id='snap'").run();
    const due = getDb().prepare('SELECT next_attempt_at AS due FROM local_asset_cleanup').get() as {
      due: number;
    };
    expect(drainLocalAssetCleanup(due.due)).toMatchObject({ deleted: 1, failed: 0 });
    expect(existsSync(file)).toBe(false);
    expect(queue()).toEqual([]);
  },
);

it('protects the original reference path retained in another generation snapshot', async () => {
  getDb()
    .prepare(`INSERT INTO generation_runs(id,run_kind,provider_id,model,base_prompt,final_prompt,params_json,prompt_snapshot_json,status,created_at)
    VALUES ('retained','free_generation','owned-provider','owned','Owned','Owned',?,'{}','failed',1)`)
    .run(
      JSON.stringify({
        referenceImages: [{ path: file, source: 'history', historyId: 'owned-job' }],
      }),
    );
  expect((await returnedAfter()).status).toBe('cancelled');
  expect(readFileSync(file, 'utf8')).toBe('owned returned bytes');
  expect(queue()).toEqual([
    expect.objectContaining({ state: 'pending', last_error: 'referenced' }),
  ]);
});

it('keeps a failed native deletion durable, hides raw errors, and resumes after reopening both databases', async () => {
  vi.spyOn(filesystem, 'unlinkFile').mockImplementationOnce(() => {
    throw new Error(`owned sensitive error ${file}`);
  });
  expect((await returnedAfter()).status).toBe('cancelled');
  expect(queue()).toEqual([
    expect.objectContaining({
      state: 'pending',
      attempt_count: 1,
      last_error: 'file_delete_failed',
    }),
  ]);
  expect(existsSync(file)).toBe(true);
  expect(JSON.stringify(logs)).not.toContain(file);
  expect(JSON.stringify(logs)).not.toContain('owned sensitive error');
  const row = getDb().prepare('SELECT next_attempt_at AS due FROM local_asset_cleanup').get() as {
    due: number;
  };
  closeDesignSchemeDb();
  closeDb();
  expect(drainLocalAssetCleanup(row.due - 1).examined).toBe(0);
  expect(drainLocalAssetCleanup(row.due)).toMatchObject({ deleted: 1, failed: 0 });
  expect(existsSync(file)).toBe(false);
  expect(queue()).toEqual([]);
});

it('deletes the intended file and preserves an outside original when an independent process replaces its parent', async () => {
  const owned = join(testCorePaths(root).pictures, 'owned');
  const detached = join(testCorePaths(root).pictures, 'detached');
  const outside = join(root, 'originals');
  mkdirSync(outside);
  const original = join(outside, 'image.png');
  writeFileSync(original, 'outside original');
  let replaced = false;
  vi.spyOn(filesystem, 'unlinkFile').mockImplementationOnce((parent, name) => {
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        "const fs=require('node:fs');fs.renameSync(process.argv[1],process.argv[2]);fs.symlinkSync(process.argv[3],process.argv[1],'junction');",
        owned,
        detached,
        outside,
      ],
      { encoding: 'utf8', timeout: 5_000 },
    );
    expect(child.status, child.stderr).toBe(0);
    replaced = true;
    native.unlinkFile(parent, name);
  });
  expect((await returnedAfter()).status).toBe('cancelled');
  expect(replaced).toBe(true);
  expect(readFileSync(original, 'utf8')).toBe('outside original');
  expect(existsSync(join(detached, 'image.png'))).toBe(false);
  expect(queue()).toEqual([]);
});

it('compensates a returned image when the actual asset transaction fails', async () => {
  getDb().exec(
    "CREATE TRIGGER owned_asset_fault BEFORE INSERT ON generated_assets BEGIN SELECT RAISE(ABORT,'owned asset commit failed'); END",
  );
  expect((await returnedAfter(false)).status).toBe('failed');
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM generated_assets').get()).toEqual({ n: 0 });
  expect(existsSync(file)).toBe(false);
  expect(queue()).toEqual([]);
});

it('preserves the file and reports a safe failure if the cleanup intent cannot be committed', async () => {
  getDb().exec(
    "CREATE TRIGGER owned_intent_fault BEFORE INSERT ON local_asset_cleanup BEGIN SELECT RAISE(ABORT,'owned intent failure'); END",
  );
  expect((await returnedAfter()).status).toBe('cancelled');
  expect(existsSync(file)).toBe(true);
  expect(queue()).toEqual([]);
  expect(logs).toContainEqual(['未入账图片清理暂未完成']);
  expect(JSON.stringify(logs)).not.toContain(file);
  // This deliberately records the storage outage boundary. Independent orphan discovery
  // must cover it; absence of a durable row is not evidence that cleanup succeeded.
});
