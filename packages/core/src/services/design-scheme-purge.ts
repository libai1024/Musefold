import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import type { ManagedFilesystem } from '@musefold/managed-fs';
import {
  purgeDesignSchemeInputSchema,
  purgeDesignSchemeResultSchema,
  type PurgeDesignSchemeInput,
} from '@musefold/contracts';
import { getDb } from '../db';
import { getDesignSchemeDb } from '../db/design-scheme';
import { DesignSchemeVersionConflictError } from '../db/design-scheme/repositories';
import { createLogger, getCoreRuntime, getPaths } from '../runtime';
import { isDesignSchemeOperationActive } from './design-scheme-lifetime';
import { retainedLocalAssetPaths } from './local-asset-cleanup';
import { unlinkManagedAsset } from './local-asset-file';
import { isLocalAssetWriteActive } from './local-asset-write-leases';

type Paths = Pick<ReturnType<typeof getPaths>, 'userData' | 'pictures' | 'previews'>;
export interface LocalSchemePurgeOptions {
  db?: Database.Database;
  coreDb?: Database.Database;
  now?: number;
  paths?: Paths;
  filesystem?: ManagedFilesystem;
}
const logger = createLogger('design-scheme-purge');
const retryMs = 60_000;
const managedRoots = (paths: Paths) => [
  paths.pictures,
  paths.previews,
  join(paths.userData, 'design-scheme-sources'),
  join(paths.userData, 'design-scheme-imports'),
];
const within = (root: string, path: string) => {
  const part = relative(root, path);
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};

/** Capture the original inode before committing deletion intent; never adopt a later replacement. */
function inspect(raw: string, paths: Paths) {
  const path = resolve(paths.userData, raw);
  const roots = managedRoots(paths).flatMap((configured) => {
    try {
      const root = join(realpathSync(dirname(configured)), basename(configured));
      const stat = lstatSync(root);
      return stat.isDirectory() && !stat.isSymbolicLink()
        ? [{ root, configured: resolve(configured) }]
        : [];
    } catch {
      return [];
    }
  });
  if (!roots.some(({ root, configured }) => within(root, path) || within(configured, path)))
    return { path, kind: 'unsafe' } as const;
  try {
    const stat = lstatSync(path, { bigint: true });
    const canonical = realpathSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !roots.some(({ root }) => within(root, canonical))
    )
      return { path, kind: 'unsafe' } as const;
    return {
      path: canonical,
      kind: 'file',
      device: String(stat.dev),
      inode: String(stat.ino),
    } as const;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { path, kind: 'missing' } as const;
    throw error;
  }
}

/** Machine-local scope, no renderer-provided owner/path. Both databases stay locked, only the
 * scheme database is mutated. No cross-database commit or filesystem delete can lose the outbox. */
export function purgeLocalDesignScheme(
  raw: PurgeDesignSchemeInput,
  options: LocalSchemePurgeOptions = {},
) {
  const input = purgeDesignSchemeInputSchema.parse(raw);
  const db = options.db ?? getDesignSchemeDb();
  const core = options.coreDb ?? getDb();
  const now = options.now ?? Date.now();
  return core
    .transaction(() =>
      db
        .transaction(() => {
          const prior = db
            .prepare(
              'SELECT version, retired_keys, deferred_keys FROM design_scheme_purge_identities WHERE scheme_id=?',
            )
            .get(input.schemeId) as
            | { version: number; retired_keys: number; deferred_keys: number }
            | undefined;
          if (prior) {
            if (prior.version !== input.expectedVersion)
              throw new DesignSchemeVersionConflictError(input.schemeId, input.expectedVersion);
            return purgeDesignSchemeResultSchema.parse({
              schemeId: input.schemeId,
              purged: true,
              retiredKeys: prior.retired_keys,
              deferredKeys: prior.deferred_keys,
            });
          }
          const row = db
            .prepare('SELECT version, deleted_at FROM design_schemes WHERE id=?')
            .get(input.schemeId) as { version: number; deleted_at: number | null } | undefined;
          if (!row) throw new Error('设计方案不存在');
          if (row.version !== input.expectedVersion)
            throw new DesignSchemeVersionConflictError(input.schemeId, input.expectedVersion);
          if (row.deleted_at === null) throw new Error('只能永久删除已移除的方案');
          const running = db
            .prepare(`SELECT 1 FROM design_scheme_runs run JOIN design_scheme_revisions r ON r.revision_id=run.revision_id
      WHERE r.scheme_id=? AND run.status IN ('planning','executing','evaluating') LIMIT 1`)
            .get(input.schemeId);
          const unsettled = core
            .prepare(`SELECT 1 FROM automation_spend_requests
      WHERE action IN ('run_scheme','run_github_skill')
      AND (state<>'terminal' OR reservation_state='unknown')
      AND (json_extract(frozen_input_json,'$.frozenRun.source.schemeId')=?
        OR json_extract(frozen_input_json,'$.input.schemeId')=?) LIMIT 1`)
            .get(input.schemeId, input.schemeId);
          if (running || unsettled || isDesignSchemeOperationActive(db, input.schemeId))
            throw new Error('方案仍有运行或未结算的任务，请等待任务结束');

          const keys = new Set(
            (
              db
                .prepare(`SELECT a.store_key FROM design_scheme_assets a
      JOIN design_scheme_revisions r ON r.revision_id=a.revision_id WHERE r.scheme_id=?`)
                .all(input.schemeId) as Array<{ store_key: string }>
            ).map((item) => item.store_key),
          );
          const snapshots = db
            .prepare(`SELECT DISTINCT s.id, s.package_id FROM source_snapshots s
      JOIN design_scheme_source_bindings b ON b.source_snapshot_id=s.id
      JOIN design_scheme_revisions r ON r.revision_id=b.revision_id WHERE r.scheme_id=?`)
            .all(input.schemeId) as Array<{ id: string; package_id: string }>;
          db.prepare('INSERT INTO design_scheme_purge_identities VALUES (?, ?, 0, 0, ?)').run(
            input.schemeId,
            input.expectedVersion,
            now,
          );
          db.prepare(`INSERT INTO design_scheme_purge_revision_identities
      SELECT revision_id, scheme_id, ? FROM design_scheme_revisions WHERE scheme_id=?`).run(
            now,
            input.schemeId,
          );
          // Legacy run receipts can point to a scheme asset rather than a core history row.
          db.prepare(`INSERT OR IGNORE INTO design_scheme_retained_assets (asset_id, run_id, store_key)
      SELECT a.id, run.run_id, a.store_key FROM design_scheme_assets a
      JOIN design_scheme_revisions r ON r.revision_id=a.revision_id
      JOIN design_scheme_run_steps step ON json_extract(step.output_json,'$.assetId')=a.id
      JOIN design_scheme_runs run ON run.run_id=step.run_id
      WHERE r.scheme_id=?`).run(input.schemeId);
          db.prepare(`UPDATE design_scheme_runs SET
      origin_scheme_id=COALESCE(origin_scheme_id, ?), origin_revision_id=COALESCE(origin_revision_id, revision_id), revision_id=NULL
      WHERE revision_id IN (SELECT revision_id FROM design_scheme_revisions WHERE scheme_id=?)`).run(
            input.schemeId,
            input.schemeId,
          );
          // Exported archives are user-owned. Remove only the library index, never their chosen files.
          db.prepare('DELETE FROM share_packages WHERE scheme_id=?').run(input.schemeId);
          db.prepare('DELETE FROM design_schemes WHERE id=?').run(input.schemeId);
          for (const snapshot of snapshots) {
            if (
              db
                .prepare(
                  'SELECT 1 FROM design_scheme_source_bindings WHERE source_snapshot_id=? LIMIT 1',
                )
                .get(snapshot.id)
            )
              continue;
            for (const file of db
              .prepare(
                'SELECT store_key FROM source_files WHERE snapshot_id=? AND store_key IS NOT NULL',
              )
              .all(snapshot.id) as Array<{ store_key: string }>)
              keys.add(file.store_key);
            db.prepare('DELETE FROM source_snapshots WHERE id=?').run(snapshot.id);
            db.prepare(
              'DELETE FROM source_packages WHERE id=? AND NOT EXISTS (SELECT 1 FROM source_snapshots WHERE package_id=?)',
            ).run(snapshot.package_id, snapshot.package_id);
          }
          const paths = options.paths ?? getPaths();
          const files = [
            ...new Map(
              [...keys].map((key) => {
                const file = inspect(key, paths);
                return [file.path, file] as const;
              }),
            ).values(),
          ];
          const retained = retainedLocalAssetPaths(
            core,
            db,
            new Set(files.map((file) => file.path)),
            paths.userData,
          );
          const enqueue =
            db.prepare(`INSERT INTO design_scheme_asset_cleanup (path,device,inode,state,created_at,next_attempt_at,last_error)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(path) DO NOTHING`);
          let deferredKeys = 0;
          for (const file of files) {
            if (retained.has(file.path) || isLocalAssetWriteActive(core, file.path)) deferredKeys++;
            enqueue.run(
              file.path,
              file.kind === 'file' ? file.device : null,
              file.kind === 'file' ? file.inode : null,
              file.kind === 'unsafe' ? 'blocked' : 'pending',
              now,
              now,
              file.kind === 'unsafe' ? 'unsafe_path' : null,
            );
          }
          const result = purgeDesignSchemeResultSchema.parse({
            schemeId: input.schemeId,
            purged: true,
            retiredKeys: files.length - deferredKeys,
            deferredKeys,
          });
          db.prepare(
            'UPDATE design_scheme_purge_identities SET retired_keys=?, deferred_keys=? WHERE scheme_id=?',
          ).run(result.retiredKeys, result.deferredKeys, input.schemeId);
          return result;
        })
        .immediate(),
    )
    .immediate();
}

/** Recheck live references and identities on every bounded retry, including after a new owner PID. */
export function drainDesignSchemeAssetCleanup(options: LocalSchemePurgeOptions = {}) {
  const db = options.db ?? getDesignSchemeDb(),
    core = options.coreDb ?? getDb();
  const paths = options.paths ?? getPaths(),
    now = options.now ?? Date.now();
  const filesystem = options.filesystem ?? getCoreRuntime().managedFilesystem?.();
  const counts = { examined: 0, deleted: 0, missing: 0, protected: 0, blocked: 0, failed: 0 };
  core
    .transaction(() =>
      db
        .transaction(() => {
          const rows = db
            .prepare(`SELECT path,device,inode,attempt_count FROM design_scheme_asset_cleanup
      WHERE state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,path LIMIT 100`)
            .all(now) as Array<{
            path: string;
            device: string | null;
            inode: string | null;
            attempt_count: number;
          }>;
          const retained = retainedLocalAssetPaths(
            core,
            db,
            new Set(rows.map((row) => row.path)),
            paths.userData,
          );
          for (const row of rows) {
            counts.examined++;
            if (retained.has(row.path) || isLocalAssetWriteActive(core, row.path)) {
              db.prepare(
                'UPDATE design_scheme_asset_cleanup SET next_attempt_at=?,last_error=? WHERE path=?',
              ).run(now + retryMs, 'referenced', row.path);
              counts.protected++;
              continue;
            }
            try {
              const file = inspect(row.path, paths);
              if (file.kind === 'missing') counts.missing++;
              else {
                if (file.kind !== 'file' || file.device !== row.device || file.inode !== row.inode)
                  throw Object.assign(new Error('Identity changed'), { code: 'UNSAFE_PATH' });
                if (!filesystem) throw new Error('Managed filesystem unavailable');
                unlinkManagedAsset(
                  filesystem,
                  managedRoots(paths),
                  file.path,
                  `${row.device}:${row.inode}`,
                );
                counts.deleted++;
              }
              db.prepare('DELETE FROM design_scheme_asset_cleanup WHERE path=?').run(row.path);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'UNSAFE_PATH') {
                db.prepare(
                  "UPDATE design_scheme_asset_cleanup SET state='blocked',last_error='file_identity_changed' WHERE path=?",
                ).run(row.path);
                counts.blocked++;
              } else {
                db.prepare(
                  `UPDATE design_scheme_asset_cleanup SET attempt_count=attempt_count+1,next_attempt_at=?,last_error='file_delete_failed' WHERE path=?`,
                ).run(
                  now + Math.min(retryMs * 2 ** Math.min(row.attempt_count, 10), 86_400_000),
                  row.path,
                );
                counts.failed++;
              }
            }
          }
        })
        .immediate(),
    )
    .immediate();
  return counts;
}

export function tryDrainDesignSchemeAssetCleanup(): void {
  try {
    const counts = drainDesignSchemeAssetCleanup();
    if (counts.failed || counts.blocked) logger.warn('方案文件清理待处理', counts);
  } catch {
    logger.warn('方案文件清理暂未完成，已保留重试记录');
  }
}
