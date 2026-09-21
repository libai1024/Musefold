// design-scheme-imports 崩溃孤儿启动 GC 的就地单测（D02.5/D02.1）。
// 真实 SQLite（design-scheme DB 迁移到 v9）+ 真实原生 managed-fs 句柄 IO；
// 只在既有原语外包裹 spy 观察顺序/注入失败，不伪造字节或路径。

import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolve } from 'node:path';
import { loadManagedFilesystem, type ManagedFilesystem } from '@musefold/managed-fs';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureTestCoreRuntime } from '../../testing';
import { closeDesignSchemeDb, getDesignSchemeDb } from '../../db/design-scheme';
import {
  DESIGN_SCHEME_IMPORTS_ROOT_NAME,
  DESIGN_SCHEME_IMPORT_ROOT_PATTERN,
  isDesignSchemeImportSessionHeld,
  retainDesignSchemeImportSession,
  sweepDesignSchemeImportOrphans,
} from '../design-scheme-import-gc';

const native = loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node'));
let filesystem: ManagedFilesystem;

let nameSeed = 0;
const rootName = () => `dsch_${(++nameSeed).toString(16).padStart(32, '0')}`;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
let root: string;
let db: Database.Database;
const now = Date.UTC(2026, 8, 14);

function importDir(name: string): string {
  return join(root, DESIGN_SCHEME_IMPORTS_ROOT_NAME, name);
}

function makeOrphan(name: string, files: Array<{ path: string; bytes?: string }> = []): string {
  const dir = importDir(name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const file of files) {
    const target = join(dir, file.path);
    fs.mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, file.bytes ?? 'orphan bytes', { flag: 'wx', mode: 0o600 });
  }
  return dir;
}

/** 最小引用链：scheme → revision → asset(store_key)；供「已提交导入」属主事实。 */
function referenceAsset(name: string, storeKey: string, id = 'dsa_gc'): void {
  db.exec(`
    INSERT INTO design_schemes
      (id, name, status, source_presentation, current_revision_id, fidelity,
       created_at, updated_at, version)
    VALUES ('scheme_gc', 'GC', 'draft', 'musefold-created', 'revision_gc', 'adapted', 10, 10, 1);
    INSERT INTO design_scheme_revisions
      (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
    VALUES ('revision_gc', 'scheme_gc', 1, '{}', 'import', 10);
  `);
  db.prepare(
    `INSERT INTO design_scheme_assets (id, revision_id, store_key, role, origin, created_at)
     VALUES (?, 'revision_gc', ?, 'example', 'local-run', 20)`,
  ).run(id, storeKey);
}

const intentRows = () =>
  db.prepare('SELECT * FROM design_scheme_import_gc ORDER BY root_name').all() as Array<{
    root_name: string;
    state: string;
    attempt_count: number;
    next_attempt_at: number;
    last_error: string | null;
  }>;

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'musefold-import-gc-'));
  filesystem = Object.fromEntries(
    Object.getOwnPropertyNames(native).map((name) => [name, Reflect.get(native, name)]),
  ) as unknown as ManagedFilesystem;
  configureTestCoreRuntime(root, { managedFilesystem: () => filesystem });
  db = getDesignSchemeDb();
});
afterEach(() => {
  vi.restoreAllMocks();
  closeDesignSchemeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('design-scheme-imports crash orphan startup GC', () => {
  it('谓词形状：目录名是 dsch_<32hex>，其余一律 skipped 不动', () => {
    expect(DESIGN_SCHEME_IMPORT_ROOT_PATTERN.test(rootName())).toBe(true);
    expect(DESIGN_SCHEME_IMPORT_ROOT_PATTERN.test('dsch_short')).toBe(false);
    expect(DESIGN_SCHEME_IMPORT_ROOT_PATTERN.test('snap_0000')).toBe(false);
    expect(DESIGN_SCHEME_IMPORT_ROOT_PATTERN.test('../escape')).toBe(false);
  });

  it('已提交导入（DB 引用属主）永久存活：不落意图、目录字节不变', () => {
    const name = rootName();
    const dir = makeOrphan(name, [{ path: 'assets/a.png', bytes: 'referenced png' }]);
    referenceAsset(name, `${DESIGN_SCHEME_IMPORTS_ROOT_NAME}/${name}/assets/a.png`);

    const counts = sweepDesignSchemeImportOrphans({ now });

    expect(counts).toMatchObject({ examined: 1, referenced: 1, enqueued: 0, reclaimed: 0 });
    expect(fs.readdirSync(dir)).toEqual(['assets']);
    expect(fs.readFileSync(join(dir, 'assets/a.png'), 'utf8')).toBe('referenced png');
    expect(intentRows()).toEqual([]);
  });

  it('绝对路径 store_key 同样构成属主（防别名逃逸）', () => {
    const name = rootName();
    makeOrphan(name, [{ path: 'assets/a.png' }]);
    referenceAsset(
      name,
      join(root, DESIGN_SCHEME_IMPORTS_ROOT_NAME, name, 'assets/a.png'),
      'dsa_abs',
    );

    const counts = sweepDesignSchemeImportOrphans({ now });

    expect(counts).toMatchObject({ referenced: 1, enqueued: 0, reclaimed: 0 });
    expect(fs.existsSync(importDir(name))).toBe(true);
  });

  it('活跃导入会话（进程内注册表）受保护；释放后可回收', () => {
    const name = rootName();
    makeOrphan(name, [{ path: 'sources/snap/f.txt' }]);

    const release = retainDesignSchemeImportSession(name);
    expect(isDesignSchemeImportSessionHeld(name)).toBe(true);
    expect(sweepDesignSchemeImportOrphans({ now })).toMatchObject({ held: 1, enqueued: 0 });
    expect(fs.existsSync(importDir(name))).toBe(true);
    expect(intentRows()).toEqual([]);

    release();
    expect(isDesignSchemeImportSessionHeld(name)).toBe(false);
    expect(sweepDesignSchemeImportOrphans({ now })).toMatchObject({ reclaimed: 1 });
    expect(fs.existsSync(importDir(name))).toBe(false);
  });

  it('canonical absolute cleanup intents protect a root reached through a userData alias', () => {
    const name = rootName();
    const dir = makeOrphan(name, [{ path: 'assets/a.png', bytes: 'held bytes' }]);
    const alias = join(root, 'user-data-alias');
    fs.symlinkSync(root, alias, 'junction');
    const path = fs.realpathSync(join(dir, 'assets/a.png'));
    db.prepare(`INSERT INTO design_scheme_asset_cleanup
      (path,state,created_at,next_attempt_at) VALUES (?,'blocked',?,?)`).run(path, now, now);
    expect(sweepDesignSchemeImportOrphans({ now, userDataDir: alias })).toMatchObject({
      referenced: 1,
      enqueued: 0,
      reclaimed: 0,
    });
    expect(fs.readFileSync(path, 'utf8')).toBe('held bytes');
    expect(intentRows()).toEqual([]);
  });

  it('崩溃孤儿：意图行先于删除落库，回收后意图清空', () => {
    const name = rootName();
    makeOrphan(name, [
      { path: 'sources/snap_x/readme.md', bytes: 'text' },
      { path: 'sources/snap_x/img.png', bytes: 'png' },
      { path: 'assets/dsa_y.png', bytes: 'asset' },
    ]);
    const seen: string[] = [];
    const openChild = vi.spyOn(filesystem, 'openChild');
    const close = vi.spyOn(filesystem, 'close');
    const removeDirectory = vi.spyOn(filesystem, 'removeDirectory');
    removeDirectory.mockImplementation((parent, entry) => {
      seen.push(JSON.stringify(intentRows().map((row) => row.root_name)));
      return native.removeDirectory(parent, entry);
    });

    const counts = sweepDesignSchemeImportOrphans({ now });

    expect(counts).toMatchObject({ examined: 1, enqueued: 1, reclaimed: 1, skipped: 0 });
    expect(fs.existsSync(importDir(name))).toBe(false);
    expect(fs.existsSync(join(root, DESIGN_SCHEME_IMPORTS_ROOT_NAME))).toBe(true);
    expect(intentRows()).toEqual([]);
    // 每次真实 removeDirectory 执行时，意图行必须已在库中（意图先行）。
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const snapshot of seen) expect(snapshot).toContain(name);
    for (const result of openChild.mock.results) {
      if (result.type === 'return') expect(close).toHaveBeenCalledWith(result.value);
    }
  });

  it('受管根内非候选形状只登记 skipped：文件、异名目录、symlink 一律不动', () => {
    const outsider = join(root, 'user-originals');
    fs.mkdirSync(outsider, { recursive: true });
    fs.writeFileSync(join(outsider, 'original.musefold.design'), 'user original bytes');
    fs.mkdirSync(join(root, DESIGN_SCHEME_IMPORTS_ROOT_NAME), { recursive: true });
    fs.writeFileSync(join(root, DESIGN_SCHEME_IMPORTS_ROOT_NAME, 'notes.txt'), 'x');
    fs.mkdirSync(join(root, DESIGN_SCHEME_IMPORTS_ROOT_NAME, 'other-dir'), { recursive: true });
    // 名字合法但类型是 symlink：绝不 openChild（openChild 拒绝链接），也不删除目标。
    fs.symlinkSync(outsider, join(root, DESIGN_SCHEME_IMPORTS_ROOT_NAME, rootName()), 'dir');

    const counts = sweepDesignSchemeImportOrphans({ now });

    expect(counts).toMatchObject({ skipped: 3, enqueued: 0, reclaimed: 0 });
    expect(fs.readFileSync(join(outsider, 'original.musefold.design'), 'utf8')).toBe(
      'user original bytes',
    );
    expect(fs.existsSync(join(root, DESIGN_SCHEME_IMPORTS_ROOT_NAME, 'notes.txt'))).toBe(true);
    expect(fs.existsSync(join(root, DESIGN_SCHEME_IMPORTS_ROOT_NAME, 'other-dir'))).toBe(true);
    expect(intentRows()).toEqual([]);
  });

  it('孤儿树内的 symlink 只删链接本身，目标字节不变', () => {
    const name = rootName();
    makeOrphan(name, [{ path: 'assets/real.png', bytes: 'real' }]);
    const targetFile = join(root, 'Pictures', 'user.png');
    fs.mkdirSync(join(root, 'Pictures'), { recursive: true });
    fs.writeFileSync(targetFile, 'user picture bytes');
    fs.symlinkSync(targetFile, join(importDir(name), 'assets', 'link.png'));

    const counts = sweepDesignSchemeImportOrphans({ now });

    expect(counts).toMatchObject({ reclaimed: 1 });
    expect(fs.existsSync(importDir(name))).toBe(false);
    expect(fs.readFileSync(targetFile, 'utf8')).toBe('user picture bytes');
  });

  it('删除分批有界：一轮最多 DELETE_LIMIT 个根，下一轮续跑收敛', () => {
    for (let index = 0; index < 10; index += 1) makeOrphan(rootName());

    const first = sweepDesignSchemeImportOrphans({ now });
    expect(first.reclaimed).toBe(8);
    expect(intentRows()).toHaveLength(2);

    const second = sweepDesignSchemeImportOrphans({ now: now + 1000 });
    expect(second.reclaimed).toBe(2);
    expect(intentRows()).toEqual([]);
  });

  it('失败不静默：记录 attempt 与退避，到期重试成功；超上限转 blocked', () => {
    const name = rootName();
    makeOrphan(name, [{ path: 'assets/a.png' }]);
    const unlinkFile = vi.spyOn(filesystem, 'unlinkFile');
    unlinkFile.mockImplementation((parent, entry) => {
      throw Object.assign(new Error('injected secret path'), { code: 'EIO' });
    });

    let counts = sweepDesignSchemeImportOrphans({ now });
    expect(counts).toMatchObject({ enqueued: 1, failed: 1, reclaimed: 0 });
    expect(intentRows()).toEqual([
      expect.objectContaining({
        root_name: name,
        state: 'pending',
        attempt_count: 1,
        last_error: 'delete_failed',
      }),
    ]);
    const retryAt = intentRows()[0]!.next_attempt_at;
    expect(retryAt).toBe(now + 60_000);

    // 未到退避时间：不重试、不新增失败。
    expect(sweepDesignSchemeImportOrphans({ now: retryAt - 1 })).toMatchObject({ failed: 0 });

    // 到期重试仍失败 → 退避指数增长；第五次失败转 blocked，不再自动重试。
    let time = retryAt;
    for (let attempt = 2; attempt <= 4; attempt += 1) {
      counts = sweepDesignSchemeImportOrphans({ now: time });
      expect(counts).toMatchObject({ failed: 1 });
      expect(intentRows()[0]).toMatchObject({ attempt_count: attempt, state: 'pending' });
      time = intentRows()[0]!.next_attempt_at;
    }
    counts = sweepDesignSchemeImportOrphans({ now: time });
    expect(counts).toMatchObject({ blocked: 1 });
    expect(intentRows()[0]).toMatchObject({
      state: 'blocked',
      attempt_count: 5,
      last_error: 'delete_failed',
    });

    // blocked 不再被选中；恢复文件系统能力后也不会自动复活，需人工清行。
    unlinkFile.mockRestore();
    expect(sweepDesignSchemeImportOrphans({ now: time + DAY })).toMatchObject({
      reclaimed: 0,
      failed: 0,
    });
    expect(intentRows()[0]!.state).toBe('blocked');
  });

  it('崩溃中断后下次启动续跑：既有意图行直接复用，目录已消失则只清行', () => {
    // 模拟「上次运行已落意图、删除前被强杀」。
    const name = rootName();
    makeOrphan(name, [{ path: 'sources/s/f' }]);
    db.prepare(
      "INSERT INTO design_scheme_import_gc (root_name, state, created_at, next_attempt_at) VALUES (?, 'pending', ?, ?)",
    ).run(name, now - DAY, now - HOUR);

    expect(sweepDesignSchemeImportOrphans({ now })).toMatchObject({ enqueued: 0, reclaimed: 1 });
    expect(fs.existsSync(importDir(name))).toBe(false);

    // 模拟「删除中途崩溃、目录已空/已消失但意图行残留」。
    const gone = rootName();
    db.prepare(
      "INSERT INTO design_scheme_import_gc (root_name, state, created_at, next_attempt_at, attempt_count, last_error) VALUES (?, 'pending', ?, ?, 1, 'delete_failed')",
    ).run(gone, now - DAY, now - HOUR);

    expect(sweepDesignSchemeImportOrphans({ now })).toMatchObject({ missing: 1 });
    expect(intentRows()).toEqual([]);
  });

  it('缺原生文件系统能力：不扫描；到期意图保留为失败记录而非静默丢弃', () => {
    const name = rootName();
    makeOrphan(name);
    db.prepare(
      "INSERT INTO design_scheme_import_gc (root_name, state, created_at, next_attempt_at) VALUES (?, 'pending', ?, ?)",
    ).run(name, now - DAY, now);

    const counts = sweepDesignSchemeImportOrphans({ now, filesystem: null });

    expect(counts).toMatchObject({ examined: 0, failed: 1, reclaimed: 0 });
    expect(fs.existsSync(importDir(name))).toBe(true);
    expect(intentRows()[0]).toMatchObject({
      state: 'pending',
      last_error: 'filesystem_unavailable',
    });
  });

  it('受管根之外的同库数据不受影响（staging、用户目录）', () => {
    const stagingFile = join(root, 'staging', 'design-scheme-packages', 'keep.bin');
    fs.mkdirSync(dirname(stagingFile), { recursive: true });
    fs.writeFileSync(stagingFile, 'staging bytes');
    makeOrphan(rootName());

    sweepDesignSchemeImportOrphans({ now });

    expect(fs.readFileSync(stagingFile, 'utf8')).toBe('staging bytes');
  });
});
