import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { loadManagedFilesystem, type ManagedFilesystem } from '@musefold/managed-fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_MIGRATIONS } from '@musefold/desktop-db/migrations.generated';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { configureTestCoreRuntime, testCorePaths } from '../../testing';
import { closeDb, getDb } from '../../db/index';
import { closeDesignSchemeDb, getDesignSchemeDb } from '../../db/design-scheme';
import { drainLocalAssetCleanup, purgeLocalGenerationRecords } from '../local-asset-cleanup';

const native = loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node'));
let filesystem: ManagedFilesystem;

let root: string;
const now = Date.UTC(2026, 8, 13);
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'musefold-owned-file-gc-'));
  filesystem = Object.fromEntries(
    Object.getOwnPropertyNames(native).map((name) => [name, Reflect.get(native, name)]),
  ) as unknown as ManagedFilesystem;
  configureTestCoreRuntime(root, { managedFilesystem: () => filesystem });
  fs.mkdirSync(testCorePaths(root).pictures, { recursive: true });
  fs.mkdirSync(testCorePaths(root).previews, { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  closeDesignSchemeDb();
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});
function run(id: string, path: string, deletedAt: number | null = now) {
  getDb()
    .prepare(`INSERT INTO generation_runs(id,run_kind,provider_id,model,base_prompt,final_prompt,params_json,prompt_snapshot_json,status,created_at,deleted_at)
    VALUES (?,'free_generation','owned','owned','Owned','Owned','{}','{}','success',?,?)`)
    .run(id, now, deletedAt);
  getDb()
    .prepare(
      "INSERT INTO generated_assets(id,run_id,position,status,media_path,created_at) VALUES (?,?,0,'available',?,?)",
    )
    .run(`asset-${id}`, id, path, now);
}
function image(name = 'owned.png') {
  const path = join(testCorePaths(root).pictures, name);
  fs.writeFileSync(path, 'owned bytes');
  return path;
}
const queue = () => getDb().prepare('SELECT * FROM local_asset_cleanup ORDER BY path').all();

describe('durable local generation file cleanup', () => {
  it('rolls back the deletion and all intents when an outbox insert fails', () => {
    const path = image();
    run('one', path);
    getDb().exec(
      "CREATE TRIGGER fail_owned_cleanup BEFORE INSERT ON local_asset_cleanup BEGIN SELECT RAISE(ABORT,'owned failure'); END",
    );
    expect(() => purgeLocalGenerationRecords(['one'], getDb(), now)).toThrow('owned failure');
    expect(getDb().prepare('SELECT id FROM generation_runs').all()).toEqual([{ id: 'one' }]);
    expect(getDb().prepare('SELECT id FROM generated_assets').all()).toEqual([{ id: 'asset-one' }]);
    expect(queue()).toEqual([]);
    expect(fs.readFileSync(path, 'utf8')).toBe('owned bytes');
  });

  it('persists a failed delete, waits for backoff and resumes after reopening both databases', () => {
    const path = image();
    run('one', path);
    expect(purgeLocalGenerationRecords(['one'], getDb(), now)).toBe(1);
    const unlink = vi.spyOn(filesystem, 'unlinkFile').mockImplementationOnce(() => {
      throw new Error('owned secret path');
    });
    expect(drainLocalAssetCleanup(now)).toMatchObject({ examined: 1, failed: 1, deleted: 0 });
    unlink.mockClear();
    expect(queue()).toEqual([
      expect.objectContaining({
        path: fs.realpathSync(path),
        attempt_count: 1,
        state: 'pending',
        last_error: 'file_delete_failed',
        next_attempt_at: now + 60_000,
      }),
    ]);
    closeDb();
    closeDesignSchemeDb();
    expect(drainLocalAssetCleanup(now + 59_999).examined).toBe(0);
    expect(fs.existsSync(path)).toBe(true);
    expect(drainLocalAssetCleanup(now + 60_000)).toMatchObject({
      examined: 1,
      deleted: 1,
      failed: 0,
    });
    expect(fs.existsSync(path)).toBe(false);
    expect(queue()).toEqual([]);
    expect(drainLocalAssetCleanup(now + 60_000).examined).toBe(0);
  });

  it('recovers a crash after unlink but before acknowledgement without deleting a replacement', () => {
    const path = image();
    run('one', path);
    purgeLocalGenerationRecords(['one'], getDb(), now);
    // Keeping the old inode alive makes the replacement identity deterministically different.
    const replacement = image('replacement.png');
    fs.renameSync(path, join(testCorePaths(root).pictures, 'retained-original.png'));
    fs.renameSync(replacement, path);
    closeDb();
    closeDesignSchemeDb();
    expect(drainLocalAssetCleanup(now)).toMatchObject({ blocked: 1, deleted: 0 });
    expect(fs.existsSync(path)).toBe(true);
    expect(queue()).toEqual([
      expect.objectContaining({ state: 'blocked', last_error: 'file_identity_changed' }),
    ]);
  });

  it('acknowledges an already absent file after reopening without another unlink', () => {
    const path = image();
    run('one', path);
    purgeLocalGenerationRecords(['one'], getDb(), now);
    fs.unlinkSync(path);
    closeDb();
    closeDesignSchemeDb();
    const unlink = vi.spyOn(filesystem, 'unlinkFile');
    expect(drainLocalAssetCleanup(now)).toMatchObject({ missing: 1, deleted: 0 });
    expect(unlink).not.toHaveBeenCalled();
    expect(queue()).toEqual([]);
  });

  it('defers a surviving execution reference, then cleans only after that reference is removed', () => {
    const path = image();
    run('one', path);
    run('reader', image('reader.png'), null);
    getDb()
      .prepare('UPDATE generation_runs SET params_json=? WHERE id=?')
      .run(JSON.stringify({ referenceImages: [{ path, historyId: 'one' }] }), 'reader');
    purgeLocalGenerationRecords(['one'], getDb(), now);
    expect(drainLocalAssetCleanup(now)).toMatchObject({ protected: 1, deleted: 0 });
    expect(fs.existsSync(path)).toBe(true);
    getDb().prepare("UPDATE generation_runs SET params_json='{}' WHERE id='reader'").run();
    expect(drainLocalAssetCleanup(now + 60_000).deleted).toBe(1);
  });

  it.each(['root', 'ancestor', 'parent'] as const)(
    'keeps deletion on the owned directory when another process replaces the %s',
    (boundary) => {
      const pictures = testCorePaths(root).pictures;
      const ancestor = join(pictures, 'ancestor');
      const parent = join(ancestor, 'parent');
      fs.mkdirSync(parent, { recursive: true });
      const path = join(parent, 'owned.png');
      fs.writeFileSync(path, 'owned generated bytes');
      run('one', path);
      purgeLocalGenerationRecords(['one'], getDb(), now);
      const directory =
        boundary === 'root' ? pictures : boundary === 'ancestor' ? ancestor : parent;
      const suffix = relative(directory, path);
      const outside = join(root, 'originals');
      const original = join(outside, suffix);
      fs.mkdirSync(join(original, '..'), { recursive: true });
      fs.writeFileSync(original, 'outside original bytes');
      const detached = join(root, 'detached');
      let substituted = false;
      vi.spyOn(filesystem, 'unlinkFile').mockImplementationOnce((handle, name) => {
        const child = spawnSync(
          process.execPath,
          [
            '-e',
            "const fs=require('node:fs');fs.renameSync(process.argv[1],process.argv[2]);fs.symlinkSync(process.argv[3],process.argv[1],'junction');",
            directory,
            detached,
            outside,
          ],
          { encoding: 'utf8', timeout: 5_000 },
        );
        expect(child.status, child.stderr).toBe(0);
        substituted = true;
        native.unlinkFile(handle, name);
      });
      expect(drainLocalAssetCleanup(now)).toMatchObject({ deleted: 1, failed: 0, blocked: 0 });
      expect(substituted).toBe(true);
      expect(fs.readFileSync(original, 'utf8')).toBe('outside original bytes');
      expect(fs.existsSync(join(detached, suffix))).toBe(false);
      expect(queue()).toEqual([]);
    },
  );

  it('blocks a replacement found at the pinned file identity check and preserves both files', () => {
    const path = image();
    run('one', path);
    purgeLocalGenerationRecords(['one'], getDb(), now);
    const detached = join(root, 'detached.png');
    vi.spyOn(filesystem, 'fileIdentity').mockImplementationOnce((parent, name) => {
      fs.renameSync(path, detached);
      fs.writeFileSync(path, 'replacement bytes');
      return native.fileIdentity(parent, name);
    });
    expect(drainLocalAssetCleanup(now)).toMatchObject({ deleted: 0, blocked: 1 });
    expect(fs.readFileSync(path, 'utf8')).toBe('replacement bytes');
    expect(fs.readFileSync(detached, 'utf8')).toBe('owned bytes');
    expect(queue()).toEqual([
      expect.objectContaining({ state: 'blocked', last_error: 'file_identity_changed' }),
    ]);
  });

  it('keeps a durable retry when the host does not supply the native capability', () => {
    const path = image();
    run('one', path);
    purgeLocalGenerationRecords(['one'], getDb(), now);
    configureTestCoreRuntime(root, { managedFilesystem: undefined });
    expect(drainLocalAssetCleanup(now)).toMatchObject({ deleted: 0, failed: 1 });
    expect(fs.readFileSync(path, 'utf8')).toBe('owned bytes');
    expect(queue()).toEqual([
      expect.objectContaining({
        state: 'pending',
        attempt_count: 1,
        last_error: 'file_delete_failed',
      }),
    ]);
  });

  it('keeps a scheme source file, including a relative legacy store key', () => {
    const path = image();
    run('one', path);
    const schemes = getDesignSchemeDb();
    // Valid source-package/snapshot fixture, independent of image-generation history.
    schemes
      .prepare("INSERT INTO source_packages(id,kind,created_at) VALUES ('pkg','user-brief',?)")
      .run(now);
    schemes
      .prepare(
        "INSERT INTO source_snapshots(id,package_id,ref,content_hash,scan_json,created_at) VALUES ('snap','pkg','owned','owned','{}',?)",
      )
      .run(now);
    schemes
      .prepare(
        "INSERT INTO source_files(snapshot_id,path,kind,content_hash,size_bytes,store_key) VALUES ('snap','owned.png','image','owned',11,?)",
      )
      .run(relative(root, path));
    purgeLocalGenerationRecords(['one'], getDb(), now);
    expect(drainLocalAssetCleanup(now)).toMatchObject({ protected: 1, deleted: 0 });
    expect(fs.readFileSync(path, 'utf8')).toBe('owned bytes');
    expect(schemes.prepare('SELECT count(*) AS count FROM source_files').get()).toEqual({
      count: 1,
    });
  });

  // This is 1001 actual file creations/deletions plus SQLite transactions under the
  // full repository's concurrent IO load. The batch bound is asserted below, not a 5s latency SLO.
  it('bounds a filesystem drain to 100 candidates and continues 1001 files to a no-op', () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `run-${i}`);
    getDb().transaction(() => {
      for (const id of ids) run(id, image(`${id}.png`));
    })();
    expect(purgeLocalGenerationRecords(ids, getDb(), now)).toBe(1001);
    for (let i = 0; i < 10; i++)
      expect(drainLocalAssetCleanup(now)).toMatchObject({ examined: 100, deleted: 100 });
    expect(drainLocalAssetCleanup(now)).toMatchObject({ examined: 1, deleted: 1 });
    expect(drainLocalAssetCleanup(now).examined).toBe(0);
    expect(fs.readdirSync(testCorePaths(root).pictures)).toEqual([]);
  }, 15000);

  it('blocks userData databases, directories and file symlinks instead of deleting them', () => {
    const regular = image();
    const link = join(testCorePaths(root).pictures, 'linked.png');
    fs.symlinkSync(regular, link);
    const original = join(root, 'owned-original.db');
    fs.writeFileSync(original, 'do not delete');
    const directory = join(testCorePaths(root).pictures, 'folder');
    fs.mkdirSync(directory);
    for (const [i, path] of [link, original, directory].entries()) run(`run-${i}`, path);
    purgeLocalGenerationRecords(['run-0', 'run-1', 'run-2'], getDb(), now);
    expect(drainLocalAssetCleanup(now).examined).toBe(0);
    expect(queue()).toHaveLength(3);
    expect(queue()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ last_error: 'unsafe_path', state: 'blocked' }),
      ]),
    );
    expect(fs.readFileSync(regular, 'utf8')).toBe('owned bytes');
    expect(fs.readFileSync(original, 'utf8')).toBe('do not delete');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.statSync(directory).isDirectory()).toBe(true);
  });
});

it('upgrades a populated 0011 database using the inline migration and safely replays', () => {
  const db = new Database(join(root, 'old-prefix.db'));
  try {
    db.exec(
      'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)',
    );
    for (const migration of DESKTOP_MIGRATIONS.slice(0, -1)) {
      for (const statement of migration.sql) db.exec(statement);
      db.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)').run(
        migration.hash,
        migration.folderMillis,
      );
    }
    db.prepare(
      "INSERT INTO generation_runs(id,run_kind,provider_id,model,base_prompt,final_prompt,params_json,prompt_snapshot_json,status,created_at) VALUES ('old','free_generation','owned','owned','Old','Old','{}','{}','success',?)",
    ).run(now);
    const original = db.prepare('SELECT * FROM generation_runs').all();
    takeoverDesktopDatabase(db, { backupDir: join(root, 'owned-backup') });
    expect(db.prepare('SELECT * FROM generation_runs').all()).toEqual(original);
    expect(db.prepare('SELECT * FROM local_asset_cleanup').all()).toEqual([]);
    const ledger = db.prepare('SELECT * FROM __drizzle_migrations').all();
    expect(ledger).toHaveLength(DESKTOP_MIGRATIONS.length);
    takeoverDesktopDatabase(db);
    expect(db.prepare('SELECT * FROM __drizzle_migrations').all()).toEqual(ledger);
  } finally {
    db.close();
  }
});
