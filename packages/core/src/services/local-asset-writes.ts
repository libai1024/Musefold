import { AsyncLocalStorage } from 'node:async_hooks';
import { basename, dirname, join, resolve } from 'node:path';
import { closeSync, fstatSync, fsyncSync, lstatSync, realpathSync, write } from 'node:fs';
import type Database from 'better-sqlite3';
import type { DirectoryHandle, ManagedFilesystem } from '@musefold/managed-fs';
import { getDb } from '../db';
import { createLogger, getCoreRuntime, type CoreRuntime } from '../runtime';
import { drainLocalAssetCleanup } from './local-asset-cleanup';
import { retainLocalAssetWrite } from './local-asset-write-leases';
import type { LocalUploadOwner } from './local-upload-owner';

// Internal local IO state, never serialized into an entity, renderer message or export.
interface WriteEntry {
  path: string;
  declaredPath: string;
  rootPath: string;
  rootIdentity: string;
  device: string | null;
  inode: string | null;
  release: () => void;
  uploadOwner?: LocalUploadOwner;
}
interface WriteScope {
  db: Database.Database;
  schemeDb?: Database.Database;
  runtime: CoreRuntime;
  assertCurrent: () => void;
  entries: WriteEntry[];
  filesystem?: ManagedFilesystem;
}
const scopes = new AsyncLocalStorage<WriteScope>();
const logger = createLogger('local-asset-writes');
const unavailable = () =>
  Object.assign(new Error('图片保存失败，请检查本机存储'), { code: 'IMAGE_WRITE_FAILED' });

function current(scope = scopes.getStore()): WriteScope {
  if (!scope || getCoreRuntime() !== scope.runtime || !scope.db.open) throw unavailable();
  scope.assertCurrent();
  return scope;
}
function filesystem(scope: WriteScope): ManagedFilesystem {
  scope.filesystem ??= scope.runtime.managedFilesystem?.();
  if (!scope.filesystem) throw unavailable();
  return scope.filesystem;
}

/** Refuse missing host IO before the Provider spends money or sends an HTTP request. */
export function assertLocalAssetWriteScope(): void {
  try {
    filesystem(current());
  } catch {
    throw unavailable();
  }
}

function assertPublishedIdentity(scope: WriteScope, entry: WriteEntry): void {
  current(scope);
  const fs = filesystem(scope);
  const directory = fs.openRoot(entry.rootPath, entry.rootIdentity);
  try {
    if (
      !entry.device ||
      !entry.inode ||
      fs.fileIdentity(directory, basename(entry.path)) !== `${entry.device}:${entry.inode}`
    )
      throw unavailable();
  } finally {
    fs.close(directory);
  }
}

/** Revalidate output identity at the transition from writing to canonical publication. */
export function assertLocalAssetWriteOutputs(images: ReadonlyArray<{ imagePath: string }>): void {
  const scope = scopes.getStore();
  if (!scope) return;
  const paths = new Set(images.map((image) => image.imagePath));
  try {
    for (const entry of scope.entries) {
      if (paths.has(entry.path) || paths.has(entry.declaredPath))
        assertPublishedIdentity(scope, entry);
    }
  } catch {
    throw unavailable();
  }
}

function finish(scope: WriteScope): void {
  for (const entry of scope.entries) {
    if (!entry.uploadOwner) entry.release();
  }
  if (!scope.entries.length) return;
  try {
    current(scope);
    scope.db
      .transaction(() => {
        for (const entry of scope.entries) {
          if (entry.uploadOwner) continue;
          if (
            entry.device &&
            entry.inode &&
            scope.db
              .prepare('SELECT 1 FROM generated_assets WHERE media_path IN (?,?) LIMIT 1')
              .get(entry.path, entry.declaredPath)
          ) {
            // Removing an intent never deletes the asset. Future purge owns a fresh intent.
            assertPublishedIdentity(scope, entry);
            scope.db
              .prepare('DELETE FROM local_asset_cleanup WHERE path=? AND device=? AND inode=?')
              .run(entry.path, entry.device, entry.inode);
          } else {
            // Expire only this operation's writing hold, preserving actual deletion-failure backoff.
            scope.db
              .prepare(
                "UPDATE local_asset_cleanup SET next_attempt_at=MIN(next_attempt_at,?),last_error=NULL WHERE path=? AND last_error='writing'",
              )
              .run(Date.now(), entry.path);
          }
        }
      })
      .immediate();
    drainLocalAssetCleanup(Date.now(), scope.db, scope.schemeDb, filesystem(scope));
  } catch {
    // The original result/exception wins. Keep persisted intent if the host, DB or namespace changed.
    logger.warn('图片写入清理尚未完成，已保留持久记录');
  }
}

/** Covers the whole generation and its final DB commit, including all asynchronous image writes. */
export async function withLocalAssetWriteScope<T>(
  action: () => Promise<T>,
  options: {
    db?: Database.Database;
    schemeDb?: Database.Database;
    assertCurrent?: () => void;
  } = {},
): Promise<T> {
  options.assertCurrent?.();
  const scope: WriteScope = {
    db: options.db ?? getDb(),
    schemeDb: options.schemeDb,
    runtime: getCoreRuntime(),
    assertCurrent: options.assertCurrent ?? (() => undefined),
    entries: [],
  };
  try {
    return await scopes.run(scope, action);
  } finally {
    finish(scope);
  }
}

/** Durable reservation → exclusive create → durable fd identity → payload; no path write fallback. */
export async function writeLocalGeneratedImage(path: string, bytes: Uint8Array): Promise<void> {
  return writeManagedImage(path, bytes);
}

/** Upload success transfers the writing hold to an explicit host/execution lifetime. */
export async function writeLocalUploadedImage(
  path: string,
  bytes: Uint8Array,
  owner: LocalUploadOwner,
): Promise<void> {
  owner.assertCurrent();
  return withLocalAssetWriteScope(() => writeManagedImage(path, bytes, owner), {
    db: owner.db,
    schemeDb: owner.schemeDb,
    assertCurrent: owner.assertCurrent,
  });
}

async function writeManagedImage(
  path: string,
  bytes: Uint8Array,
  owner?: LocalUploadOwner,
): Promise<void> {
  const scope = current();
  const fs = filesystem(scope);
  const pictures = owner
    ? join(scope.runtime.getPaths().previews, 'uploads')
    : scope.runtime.getPaths().pictures;
  const name = basename(path);
  if (resolve(path) !== resolve(pictures, name)) throw unavailable();
  const rootPath = join(realpathSync(dirname(pictures)), basename(pictures));
  const rootStat = lstatSync(rootPath, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw unavailable();
  const rootIdentity = `${rootStat.dev}:${rootStat.ino}`;
  let directory: DirectoryHandle | undefined;
  let fd: number | undefined;
  try {
    directory = fs.openRoot(rootPath, rootIdentity);
    const entry: WriteEntry = {
      path: join(rootPath, name),
      declaredPath: path,
      rootPath,
      rootIdentity,
      device: null,
      inode: null,
      release: () => undefined,
    };
    current(scope);
    const now = Date.now();
    scope.db
      .prepare(
        "INSERT INTO local_asset_cleanup(path,device,inode,state,created_at,next_attempt_at) VALUES (?,NULL,NULL,'pending',?,?)",
      )
      .run(entry.path, now, now);
    entry.release = retainLocalAssetWrite(scope.db, entry.path);
    scope.entries.push(entry);
    if (fs.writeWholeFile) {
      // Windows 整块通道:排他新建+全量写入+落盘由原生一次完成(FILE_CREATE 语义,
      // 已存在即 EEXIST,对齐 openFile('create') 的独占口径);身份沿用 fileIdentity
      //(与 fstat 的 dev:ino 同构);写后崩溃留下的 NULL pending 行由 janitor 既有语义清理。
      try {
        fs.writeWholeFile(
          directory,
          name,
          Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        );
      } catch (error) {
        scope.db
          .prepare(
            'DELETE FROM local_asset_cleanup WHERE path=? AND device IS NULL AND inode IS NULL',
          )
          .run(entry.path);
        throw error;
      }
      const identity = fs.fileIdentity(directory, name);
      const separator = identity.indexOf(':');
      entry.device = identity.slice(0, separator);
      entry.inode = identity.slice(separator + 1);
      try {
        current(scope);
        const updated = scope.db
          .prepare(
            'UPDATE local_asset_cleanup SET device=?,inode=? WHERE path=? AND device IS NULL AND inode IS NULL',
          )
          .run(entry.device, entry.inode, entry.path).changes;
        if (updated !== 1) throw unavailable();
      } catch (error) {
        if (fs.fileIdentity(directory, name) === `${entry.device}:${entry.inode}`)
          fs.unlinkFile(directory, name);
        throw error;
      }
      assertPublishedIdentity(scope, entry);
      if (owner) {
        owner.hold(entry.path, entry.release, entry.declaredPath);
        entry.uploadOwner = owner;
      }
      return;
    }
    try {
      fd = fs.openFile(directory, name, 'create');
    } catch (error) {
      // Exclusive create failed: no ownership of any pre-existing target was obtained.
      scope.db
        .prepare(
          'DELETE FROM local_asset_cleanup WHERE path=? AND device IS NULL AND inode IS NULL',
        )
        .run(entry.path);
      throw error;
    }
    const stat = fstatSync(fd, { bigint: true });
    entry.device = String(stat.dev);
    entry.inode = String(stat.ino);
    try {
      current(scope);
      const updated = scope.db
        .prepare(
          'UPDATE local_asset_cleanup SET device=?,inode=? WHERE path=? AND device IS NULL AND inode IS NULL',
        )
        .run(entry.device, entry.inode, entry.path).changes;
      if (updated !== 1) throw unavailable();
    } catch (error) {
      if (fs.fileIdentity(directory, name) === `${entry.device}:${entry.inode}`)
        fs.unlinkFile(directory, name);
      throw error;
    }
    const outputFd = fd;
    let offset = 0;
    while (offset < bytes.byteLength) {
      current(scope);
      const count = await new Promise<number>((resolve, reject) =>
        write(
          outputFd,
          bytes,
          offset,
          Math.min(65536, bytes.byteLength - offset),
          offset,
          (error, written) => (error ? reject(error) : resolve(written)),
        ),
      );
      if (!count) throw unavailable();
      offset += count;
    }
    fsyncSync(fd);
    assertPublishedIdentity(scope, entry);
    if (owner) {
      owner.hold(entry.path, entry.release, entry.declaredPath);
      entry.uploadOwner = owner;
    }
  } catch {
    throw unavailable();
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
    } finally {
      if (directory) fs.close(directory);
    }
  }
}
