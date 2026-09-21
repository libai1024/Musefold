// 分享导入崩溃孤儿启动 GC（D02.5/D02.1，§5.103 开放项①）。
//
// 受管事实：分享导入把展开内容写进 <userData>/design-scheme-imports/<dsch_…>/，
// 成功后在 design-scheme DB 落 store_key 引用（design_scheme_assets / source_files），
// 目录随即转为该方案的永久受管存储；失败路径由 importDesignScheme 就地 rmSync 回滚
// （share.test.ts:723-797）。唯一缺口是崩溃/强杀发生在「目录已建、DB 未提交」之间：
// 没有任何在途进程持有它，也没有引用行认领它——本服务在新 owner PID 启动时回收这类孤儿。
//
// 孤儿谓词（刻意不是年龄）：imports 根下的一级目录 <name> 可回收 iff
//   1) 形状：name 匹配导入根命名 dsch_[0-9a-f]{32}（opaqueId('dsch') 的产出）且是真实目录；
//      根内任何其它名字/类型只登记 skipped，永不删除；
//   2) 无持久属主：design-scheme DB 中没有任何 store_key 指向 design-scheme-imports/<name>/…
//      （相对键与绝对键都识别；'..' 段直接拒绝）；
//   3) 无活跃会话属主：本进程导入注册表（retainDesignSchemeImportSession）未持有 <name>。
// 跨进程并发由应用 owner lock 排除（桌面单实例 + headless 接管；serve 与桌面互斥），
// 因此持有 owner lock 的新 PID 扫描时，不满足 2/3 的目录只能属于已死会话。
//
// 删除授权纪律：先落 design_scheme_import_gc 意图行（immediate 事务）再动磁盘；
// 删除只经 managed-fs 句柄（锚定 realpath(userData) 的 dev:ino，逐级 openChild，
// openChild 拒绝 symlink），树先整棵验证（类型/规模/深度）再删；每个运行轮有界，
// 失败记 attempt 与退避、静默重试被禁止，超过上限转 blocked 留待人工处理；
// 崩溃中断后意图行仍在，下次启动对同目录续跑。绝不触碰受管根之外的任何路径
// （用户自选原件与 userData/staging 暂存都在本根之外，构造上排除）。

import type { DirectoryHandle, ManagedFilesystem } from '@musefold/managed-fs';
import type Database from 'better-sqlite3';
import { lstatSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { getDesignSchemeDb } from '../db/design-scheme';
import { createLogger, getCoreRuntime, getPaths } from '../runtime';

const logger = createLogger('design-scheme-import-gc');

/** 受管导入根目录名（userData 之下）；目录本身永不被删除。 */
export const DESIGN_SCHEME_IMPORTS_ROOT_NAME = 'design-scheme-imports';
/** 导入会话创建的一级目录名形状：opaqueId('dsch') === `dsch_${randomUUID 去连字符}`。 */
export const DESIGN_SCHEME_IMPORT_ROOT_PATTERN = /^dsch_[0-9a-f]{32}$/;

/** 每轮扫描的候选上限（对齐 package-staging GC 的有界节奏）。 */
const SCAN_LIMIT = 24;
/** 每轮实际删除的根目录上限。 */
const DELETE_LIMIT = 8;
/** 单棵树的上界：包条目上限 1024（contracts DESIGN_SCHEME_PACKAGE_LIMITS.entries）再留余量。 */
const MAX_TREE_ENTRIES = 2048;
const MAX_TREE_DIRECTORIES = 128;
const MAX_TREE_DEPTH = 12;
const RETRY_MS = 60_000;
const MAX_BACKOFF_MS = 24 * 60 * RETRY_MS;
/** 重试上限：超过后转 blocked（人工处置），不再自动重试。 */
const MAX_ATTEMPTS = 5;

export interface DesignSchemeImportSweepCounts {
  /** 本轮检查过的一级子项数。 */
  examined: number;
  /** DB 引用保护（已提交导入的永久存储）。 */
  referenced: number;
  /** 进程内活跃导入会话保护。 */
  held: number;
  /** 新落的意图行数。 */
  enqueued: number;
  /** 成功回收（含删除时已消失）的根数。 */
  reclaimed: number;
  /** 删除时目录已不存在、仅清掉意图行的根数。 */
  missing: number;
  /** 因引用出现而撤销的既有意图行数。 */
  canceled: number;
  /** 删除失败（保留意图行退避重试）的根数。 */
  failed: number;
  /** 转入 blocked 的根数。 */
  blocked: number;
  /** 受管根内非候选形状、只登记不动的子项数。 */
  skipped: number;
}

export interface DesignSchemeImportSweepOptions {
  now?: number;
  db?: Database.Database;
  /** null 显式表示无原生文件系统能力；缺省回退到 core runtime 注入。 */
  filesystem?: ManagedFilesystem | null;
  userDataDir?: string;
}

const liveImportSessions = new Set<string>();

/**
 * 导入会话持有登记（hold 先行）：importDesignScheme 在创建目录之前 retain，
 * 提交/回滚/抛错路径统一 release。清扫把它视为活跃属主，即使 DB 引用尚未落库。
 */
export function retainDesignSchemeImportSession(rootName: string): () => void {
  liveImportSessions.add(rootName);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    liveImportSessions.delete(rootName);
  };
}

/** 测试/诊断查询：某导入根当前是否被活跃会话持有。 */
export function isDesignSchemeImportSessionHeld(rootName: string): boolean {
  return liveImportSessions.has(rootName);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** 从 store_key（相对 userData 或绝对路径）解析其认领的导入根名；不认领返回 null。 */
function importRootNameOfStoreKey(storeKey: string, userDataRoots: string[]): string | null {
  if (storeKey.split(/[\\/]/).includes('..')) return null;
  for (const root of userDataRoots) {
    const [prefix, name] = relative(root, resolve(root, storeKey)).split(sep);
    if (
      prefix === DESIGN_SCHEME_IMPORTS_ROOT_NAME &&
      name &&
      DESIGN_SCHEME_IMPORT_ROOT_PATTERN.test(name)
    )
      return name;
  }
  return null;
}

function referencedImportRootNames(
  db: Database.Database,
  userDataDir: string,
  candidates: Set<string>,
): Set<string> {
  const referenced = new Set<string>();
  if (!candidates.size) return referenced;
  // Cleanup intents use canonical paths. The configured userData may instead use
  // an OS alias (/var vs /private/var on macOS); both name the same owned root.
  const roots = [resolve(userDataDir)];
  try {
    roots.push(realpathSync(userDataDir));
  } catch {
    /* Unreachable roots are never deleted. */
  }
  const collect = (raw: string | null) => {
    if (!raw) return;
    const name = importRootNameOfStoreKey(raw, roots);
    if (name && candidates.has(name)) referenced.add(name);
  };
  const keys = db.prepare(
    `SELECT store_key FROM design_scheme_assets
     UNION ALL
     SELECT store_key FROM source_files
      WHERE store_key IS NOT NULL
     UNION ALL SELECT store_key FROM design_scheme_retained_assets
     UNION ALL SELECT path AS store_key FROM design_scheme_asset_cleanup`,
  );
  for (const row of keys.iterate() as Iterable<{ store_key: string }>) collect(row.store_key);
  return referenced;
}

interface TreeEntry {
  name: string;
  type: 'directory' | 'file' | 'link' | 'missing' | 'other';
}

function readEntries(filesystem: ManagedFilesystem, handle: DirectoryHandle): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const reader = filesystem.openReader(handle);
  try {
    for (;;) {
      const batch = filesystem.readReader(reader, 64);
      if (!batch.length) break;
      entries.push(...batch);
    }
  } finally {
    filesystem.closeReader(reader);
  }
  return entries;
}

function unsafeShape(reason: string): Error {
  return Object.assign(new Error(`导入孤儿目录形状不安全：${reason}`), { code: 'TREE_UNSAFE' });
}

/**
 * 整棵树只经句柄遍历：先验证（类型/规模/深度），再按同一次遍历删除。
 * 'link' 只 unlink 链接本身，绝不跟随；'other'（套接字等）视为不安全。
 */
function validateTree(filesystem: ManagedFilesystem, root: DirectoryHandle): void {
  let entries = 0;
  let directories = 0;
  const walk = (handle: DirectoryHandle, depth: number): void => {
    if (depth > MAX_TREE_DEPTH) throw unsafeShape('depth');
    for (const entry of readEntries(filesystem, handle)) {
      entries += 1;
      if (entries > MAX_TREE_ENTRIES) throw unsafeShape('entries');
      if (entry.name === '' || entry.name === '.' || entry.name === '..') {
        throw unsafeShape('name');
      }
      if (entry.type === 'missing') continue;
      if (entry.type === 'file' || entry.type === 'link') continue;
      if (entry.type !== 'directory') throw unsafeShape('type');
      directories += 1;
      if (directories > MAX_TREE_DIRECTORIES) throw unsafeShape('directories');
      const child = filesystem.openChild(handle, entry.name, false);
      try {
        walk(child, depth + 1);
      } finally {
        filesystem.close(child);
      }
    }
  };
  walk(root, 0);
}

function removeTree(filesystem: ManagedFilesystem, root: DirectoryHandle): void {
  for (const entry of readEntries(filesystem, root)) {
    if (entry.type === 'missing') continue;
    if (entry.type === 'file' || entry.type === 'link') {
      filesystem.unlinkFile(root, entry.name);
      continue;
    }
    if (entry.type !== 'directory') throw unsafeShape('type');
    const child = filesystem.openChild(root, entry.name, false);
    try {
      removeTree(filesystem, child);
    } finally {
      filesystem.close(child);
    }
    filesystem.removeDirectory(root, entry.name);
  }
}

/**
 * 单轮有界清扫：扫描受管 imports 根 → 孤儿候选先落意图行 → 到期意图（含崩溃残留）
 * 复核谓词后经锚定句柄删除。同步、幂等、可重入；失败保留意图行。
 */
export function sweepDesignSchemeImportOrphans(
  options: DesignSchemeImportSweepOptions = {},
): DesignSchemeImportSweepCounts {
  const now = options.now ?? Date.now();
  const db = options.db ?? getDesignSchemeDb();
  const userDataDir = resolve(options.userDataDir ?? getPaths().userData);
  const filesystem =
    options.filesystem === null
      ? undefined
      : (options.filesystem ?? getCoreRuntime().managedFilesystem?.());
  const counts: DesignSchemeImportSweepCounts = {
    examined: 0,
    referenced: 0,
    held: 0,
    enqueued: 0,
    reclaimed: 0,
    missing: 0,
    canceled: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
  };
  const enqueue = db.prepare(
    `INSERT INTO design_scheme_import_gc (root_name, state, created_at, next_attempt_at)
     VALUES (?, 'pending', ?, ?)
     ON CONFLICT(root_name) DO NOTHING`,
  );

  if (!filesystem) {
    // 无原生文件系统能力：扫描不可行；到期意图按既有纪律记录失败并退避。
    const due = dueIntents(db, now);
    if (due.length) {
      const fail = failureWriter(db);
      for (const row of due) {
        if (fail(row, now, 'filesystem_unavailable') === 'blocked') counts.blocked += 1;
        else counts.failed += 1;
      }
    }
    return counts;
  }

  let anchor: DirectoryHandle | undefined;
  let importsRoot: DirectoryHandle | undefined;
  try {
    const canonicalUserData = realpathSync(userDataDir);
    const stat = lstatSync(canonicalUserData, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw unsafeShape('anchor');
    anchor = filesystem.openRoot(canonicalUserData, `${stat.dev}:${stat.ino}`);
    try {
      importsRoot = filesystem.openChild(anchor, DESIGN_SCHEME_IMPORTS_ROOT_NAME, false);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  } catch (error) {
    // 受管根不可达（如 userData 缺失）：只处理 DB 侧到期意图，目录无从删起。
    logger.warn('design-scheme-imports 根不可达，本轮仅处理既有意图', {
      code: (error as NodeJS.ErrnoException)?.code,
    });
    anchor = undefined;
    importsRoot = undefined;
  }

  // —— 扫描：孤儿候选先落意图行（意图先行，删除在后）——
  if (importsRoot) {
    const scanned = new Set<string>();
    for (const entry of readEntries(filesystem, importsRoot)) {
      counts.examined += 1;
      if (entry.type !== 'directory' || !DESIGN_SCHEME_IMPORT_ROOT_PATTERN.test(entry.name)) {
        counts.skipped += 1;
        continue;
      }
      if (liveImportSessions.has(entry.name)) {
        counts.held += 1;
        continue;
      }
      scanned.add(entry.name);
    }
    if (scanned.size) {
      const referenced = referencedImportRootNames(db, userDataDir, scanned);
      counts.referenced = referenced.size;
      let budget = SCAN_LIMIT;
      const names = [...scanned].filter((name) => !referenced.has(name));
      counts.enqueued += db
        .transaction(() => {
          let inserted = 0;
          for (const name of names) {
            if (budget-- <= 0) break;
            inserted += enqueue.run(name, now, now).changes;
          }
          return inserted;
        })
        .immediate();
    }
  }

  // —— 到期意图（含上轮崩溃残留）：复核谓词后删除 ——
  const due = dueIntents(db, now);
  if (due.length) {
    const referenced = referencedImportRootNames(
      db,
      userDataDir,
      new Set(due.map((row) => row.root_name)),
    );
    const removeIntent = db.prepare('DELETE FROM design_scheme_import_gc WHERE root_name = ?');
    const fail = failureWriter(db);
    for (const row of due) {
      const name = row.root_name;
      if (liveImportSessions.has(name) || referenced.has(name)) {
        // 属主已出现：撤销意图，目录不动（新导入的随机名不会复用旧名，此处仅防御）。
        removeIntent.run(name);
        counts.canceled += 1;
        continue;
      }
      if (!anchor || !importsRoot) {
        if (fail(row, now, 'anchor_unavailable') === 'blocked') counts.blocked += 1;
        else counts.failed += 1;
        continue;
      }
      try {
        // 删除决策锚定已验证句柄：重开根级身份校验，拒绝锚点被替换。
        const revalidated = filesystem.openRoot(
          realpathSync(userDataDir),
          filesystem.identity(anchor),
        );
        filesystem.close(revalidated);
        let orphan: DirectoryHandle;
        try {
          orphan = filesystem.openChild(importsRoot, name, false);
        } catch (error) {
          if (!isMissing(error)) throw error;
          removeIntent.run(name);
          counts.missing += 1;
          continue;
        }
        try {
          validateTree(filesystem, orphan);
          removeTree(filesystem, orphan);
          filesystem.removeDirectory(importsRoot, name);
        } finally {
          filesystem.close(orphan);
        }
        removeIntent.run(name);
        counts.reclaimed += 1;
      } catch (error) {
        const deterministic = (error as NodeJS.ErrnoException)?.code === 'TREE_UNSAFE';
        if (deterministic) {
          db.prepare(
            "UPDATE design_scheme_import_gc SET state='blocked', last_error=? WHERE root_name=?",
          ).run('tree_unsafe', name);
          counts.blocked += 1;
        } else {
          if (fail(row, now, 'delete_failed') === 'blocked') counts.blocked += 1;
          else counts.failed += 1;
        }
      }
    }
  }

  if (importsRoot) filesystem.close(importsRoot);
  if (anchor) filesystem.close(anchor);
  return counts;
}

interface DueIntent {
  root_name: string;
  attempt_count: number;
}

function dueIntents(db: Database.Database, now: number): DueIntent[] {
  return db
    .prepare(
      "SELECT root_name, attempt_count FROM design_scheme_import_gc WHERE state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at, root_name LIMIT ?",
    )
    .all(now, DELETE_LIMIT) as DueIntent[];
}

function failureWriter(db: Database.Database) {
  return (row: DueIntent, now: number, reason: string): 'pending' | 'blocked' => {
    const delay = Math.min(RETRY_MS * 2 ** Math.min(row.attempt_count, 10), MAX_BACKOFF_MS);
    if (row.attempt_count + 1 >= MAX_ATTEMPTS) {
      db.prepare(
        "UPDATE design_scheme_import_gc SET state='blocked', attempt_count=attempt_count+1, next_attempt_at=?, last_error=? WHERE root_name=?",
      ).run(now + delay, reason, row.root_name);
      return 'blocked';
    }
    db.prepare(
      'UPDATE design_scheme_import_gc SET attempt_count=attempt_count+1, next_attempt_at=?, last_error=? WHERE root_name=?',
    ).run(now + delay, reason, row.root_name);
    return 'pending';
  };
}

/** 宿主入口（桌面/serve 启动）：有界清扫，永不抛错；失败保留意图行下次续跑。 */
export function trySweepDesignSchemeImportOrphans(): void {
  try {
    const counts = sweepDesignSchemeImportOrphans();
    if (counts.reclaimed || counts.enqueued) logger.info('design-scheme-imports 孤儿清扫', counts);
    if (counts.failed || counts.blocked)
      logger.warn('design-scheme-imports 清扫有待处理项', counts);
  } catch {
    logger.warn('design-scheme-imports 孤儿清扫未完成，已保留意图行待下轮续跑');
  }
}
