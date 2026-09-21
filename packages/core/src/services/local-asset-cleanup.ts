import { unlinkManagedAsset } from './local-asset-file';
import { isLocalAssetWriteActive } from './local-asset-write-leases';
import type { ManagedFilesystem } from '@musefold/managed-fs';
import type Database from 'better-sqlite3';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { getDb } from '../db/index';
import { getDesignSchemeDb } from '../db/design-scheme';
import { getPaths, createLogger, getCoreRuntime } from '../runtime';

const BATCH_SIZE = 100;
const RETRY_MS = 60_000;
const logger = createLogger('local-asset-cleanup');
const within = (root: string, path: string) => {
  const offset = relative(root, path);
  return offset !== '' && offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
};

/** Canonical image roots only. userData also contains databases, credentials and backups. */
function inspect(path: string) {
  if (!isAbsolute(path)) return { kind: 'unsafe' } as const;
  const target = resolve(path);
  const roots = [getPaths().pictures, getPaths().previews].flatMap((root) => {
    try {
      return [realpathSync(root)];
    } catch {
      return [];
    }
  });
  try {
    const stat = lstatSync(target, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) return { kind: 'unsafe' } as const;
    const canonical = realpathSync(target);
    if (!roots.some((root) => within(root, canonical))) return { kind: 'unsafe' } as const;
    return {
      kind: 'file',
      path: canonical,
      device: String(stat.dev),
      inode: String(stat.ino),
    } as const;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' } as const;
    throw error;
  }
}

function canonicalReference(raw: string, userData: string): string {
  const path = resolve(userData, raw);
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Stream retained references; keep at most one entry per candidate in memory. */
export function retainedLocalAssetPaths(
  db: Database.Database,
  schemes: Database.Database,
  candidates: Set<string>,
  userData = getPaths().userData,
) {
  const protectedSet = new Set<string>();
  const add = (raw: string | null) => {
    if (!raw) return;
    const path = canonicalReference(raw, userData);
    if (candidates.has(path)) protectedSet.add(path);
  };
  for (const row of db
    .prepare('SELECT media_path FROM generated_assets WHERE media_path IS NOT NULL')
    .iterate() as Iterable<{ media_path: string }>)
    add(row.media_path);
  // A surviving execution/retry keeps its original reference images, even after its source is purged.
  for (const row of db.prepare('SELECT params_json FROM generation_runs').iterate() as Iterable<{
    params_json: string;
  }>) {
    const params = JSON.parse(row.params_json) as { referenceImages?: Array<{ path?: string }> };
    for (const image of params.referenceImages ?? []) {
      if (typeof image.path === 'string') add(image.path);
    }
  }
  // Local Automation freezes references before confirmation and before any generation row exists.
  // Its retained snapshots outlive the host, account scope and terminal execution state.
  for (const row of db
    .prepare(
      "SELECT action,frozen_input_json FROM automation_spend_requests WHERE action IN ('generate_image','run_scheme','run_github_skill')",
    )
    .iterate() as Iterable<{ action: string; frozen_input_json: string }>) {
    const input: unknown = JSON.parse(row.frozen_input_json);
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid retained Automation input');
    if (row.action !== 'generate_image') {
      // R/S freezes nested body/params/source data. Preserve its explicitly named file
      // references too; retained receipts must not lose bytes when the library is purged.
      let visited = 0;
      const visit = (value: unknown, depth: number): void => {
        if (++visited > 100_000 || depth > 64) throw new Error('Invalid retained run input');
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          for (const item of value) visit(item, depth + 1);
          return;
        }
        for (const [key, nested] of Object.entries(value)) {
          if (
            ['path', 'imagePath', 'storeKey', 'mediaPath'].includes(key) &&
            typeof nested === 'string'
          )
            add(nested);
          else visit(nested, depth + 1);
        }
      };
      visit(input, 0);
      continue;
    }
    const references = Reflect.get(input, 'references');
    if (references === undefined) continue;
    if (!Array.isArray(references)) throw new Error('Invalid retained Automation references');
    for (const reference of references) {
      if (!reference || typeof reference !== 'object' || typeof reference.path !== 'string')
        throw new Error('Invalid retained Automation reference');
      add(reference.path);
    }
  }
  for (const row of schemes
    .prepare(
      'SELECT store_key FROM design_scheme_assets UNION ALL SELECT store_key FROM source_files WHERE store_key IS NOT NULL UNION ALL SELECT store_key FROM design_scheme_retained_assets',
    )
    .iterate() as Iterable<{ store_key: string }>)
    add(row.store_key);
  return protectedSet;
}

/** Queue only caller-owned output candidates; final deletion still rechecks every retained reference. */
export function enqueueLocalAssetCleanup(
  paths: string[],
  db: Database.Database = getDb(),
  now = Date.now(),
): number {
  return db
    .transaction(() => {
      const insert = db.prepare(`INSERT INTO local_asset_cleanup
      (path,device,inode,state,created_at,next_attempt_at,last_error) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(path) DO NOTHING`);
      let count = 0;
      for (const path of paths) {
        const file = inspect(path);
        count += insert.run(
          file.kind === 'file' ? file.path : path,
          file.kind === 'file' ? file.device : null,
          file.kind === 'file' ? file.inode : null,
          file.kind === 'unsafe' ? 'blocked' : 'pending',
          now,
          now,
          file.kind === 'unsafe' ? 'unsafe_path' : null,
        ).changes;
      }
      return count;
    })
    .immediate();
}

/** Persist cleanup intent in the same transaction that removes the generation rows. */
export function purgeLocalGenerationRecords(
  ids: string[],
  db: Database.Database = getDb(),
  now = Date.now(),
): number {
  if (!ids.length) return 0;
  return db
    .transaction(() => {
      const select = db.prepare(
        "SELECT id FROM generation_runs WHERE id=? AND deleted_at IS NOT NULL AND status IN ('success','failed','cancelled')",
      );
      const assets = db.prepare(
        'SELECT id,media_path FROM generated_assets WHERE run_id=? AND media_path IS NOT NULL AND id>? ORDER BY id LIMIT 100',
      );
      const remove = db.prepare('DELETE FROM generation_runs WHERE id=?');
      let affected = 0;
      for (const id of ids) {
        if (!select.get(id)) continue;
        let cursor = '';
        while (true) {
          const page = assets.all(id, cursor) as Array<{ id: string; media_path: string }>;
          if (!page.length) break;
          enqueueLocalAssetCleanup(
            page.map((asset) => asset.media_path),
            db,
            now,
          );
          cursor = page[page.length - 1]!.id;
        }
        affected += remove.run(id).changes;
      }
      return affected;
    })
    .immediate();
}

/** Bounded, synchronous owned-file cleanup. Failed deletes retain their durable intent. */
export function drainLocalAssetCleanup(
  now = Date.now(),
  db: Database.Database = getDb(),
  schemes: Database.Database = getDesignSchemeDb(),
  filesystem: ManagedFilesystem | undefined = getCoreRuntime().managedFilesystem?.(),
) {
  const counts = { examined: 0, deleted: 0, missing: 0, protected: 0, blocked: 0, failed: 0 };
  // The application owner lock excludes a second app. Both SQLite write locks also protect
  // reference snapshots against other database clients until each filesystem decision completes.
  db.transaction(() =>
    schemes
      .transaction(() => {
        const rows = db
          .prepare(
            "SELECT path,device,inode,attempt_count FROM local_asset_cleanup WHERE state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,path LIMIT ?",
          )
          .all(now, BATCH_SIZE) as Array<{
          path: string;
          device: string | null;
          inode: string | null;
          attempt_count: number;
        }>;
        if (!rows.length) return;
        counts.examined = rows.length;
        const protectedSet = retainedLocalAssetPaths(
          db,
          schemes,
          new Set(rows.map((row) => row.path)),
        );
        const remove = db.prepare('DELETE FROM local_asset_cleanup WHERE path=?');
        const defer = db.prepare(
          'UPDATE local_asset_cleanup SET next_attempt_at=?,last_error=? WHERE path=?',
        );
        const block = db.prepare(
          "UPDATE local_asset_cleanup SET state='blocked',last_error=? WHERE path=?",
        );
        const fail = db.prepare(
          'UPDATE local_asset_cleanup SET attempt_count=attempt_count+1,next_attempt_at=?,last_error=? WHERE path=?',
        );
        for (const row of rows) {
          if (isLocalAssetWriteActive(db, row.path)) {
            counts.protected++;
            defer.run(now + RETRY_MS, 'writing', row.path);
            continue;
          }
          if (protectedSet.has(row.path)) {
            counts.protected++;
            defer.run(now + RETRY_MS, 'referenced', row.path);
            continue;
          }
          try {
            const file = inspect(row.path);
            if (file.kind === 'missing') {
              remove.run(row.path);
              counts.missing++;
            } else if (
              file.kind === 'unsafe' ||
              file.device !== row.device ||
              file.inode !== row.inode
            ) {
              block.run('file_identity_changed', row.path);
              counts.blocked++;
            } else {
              if (!filesystem) throw new Error('Managed filesystem unavailable');
              unlinkManagedAsset(
                filesystem,
                [getPaths().pictures, getPaths().previews],
                file.path,
                `${file.device}:${file.inode}`,
              );
              remove.run(row.path);
              counts.deleted++;
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'UNSAFE_PATH') {
              block.run('file_identity_changed', row.path);
              counts.blocked++;
              continue;
            }
            const delay = Math.min(
              RETRY_MS * 2 ** Math.min(row.attempt_count, 10),
              24 * 60 * RETRY_MS,
            );
            fail.run(now + delay, 'file_delete_failed', row.path);
            counts.failed++;
          }
        }
      })
      .immediate(),
  ).immediate();
  return counts;
}

/** Hosts call after admission and periodically; errors expose neither paths nor filesystem messages. */
export function tryDrainLocalAssetCleanup(): void {
  try {
    const counts = drainLocalAssetCleanup();
    if (counts.failed || counts.blocked) logger.warn('本机资产清理待处理', counts);
  } catch {
    logger.warn('本机资产清理暂未完成，已保留待重试记录');
  }
}
