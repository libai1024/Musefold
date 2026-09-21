import { realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import { LOCAL_UPLOAD_TTL_MS } from '../constants';
import { getDb } from '../db';
import { createLogger, getCoreRuntime, getPaths } from '../runtime';
import { drainLocalAssetCleanup, tryDrainLocalAssetCleanup } from './local-asset-cleanup';
import { tryDrainDesignSchemeAssetCleanup } from './design-scheme-purge';

const logger = createLogger('local-upload-owner');

/** Local IO capability; not a persisted entity or public gateway contract. */
export interface LocalUploadOwner {
  readonly db: Database.Database;
  readonly schemeDb?: Database.Database;
  assertCurrent(): void;
  hold(path: string, done: () => void, declaredPath?: string): void;
  release(paths: readonly string[]): void;
  close(): void;
}

interface HeldEntry {
  done: () => void;
  at: number;
}

/** Live owner registry so the host timer can TTL-expire holds without a new timer per host. */
interface OwnerRecord {
  held: Map<string, HeldEntry>;
  release(paths: readonly string[]): void;
  isClosed(): boolean;
}

const liveOwners = new Set<OwnerRecord>();

function uploadsRoot(): string {
  const root = join(getPaths().previews, 'uploads');
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

/** Hold keys are canonical already; compare against the canonical uploads root, no third strategy. */
function isUploadHold(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

/**
 * TTL-expire long-lived upload holds across all live owners. Releasing only returns the
 * in-memory write lease; actual deletion still goes through the drain's reference recheck.
 */
export function expireLocalUploadHolds(now = Date.now(), ttl = LOCAL_UPLOAD_TTL_MS): number {
  const root = uploadsRoot();
  let expired = 0;
  for (const owner of liveOwners) {
    if (owner.isClosed()) continue;
    const due = [...owner.held]
      .filter(([path, held]) => held.at <= now - ttl && isUploadHold(root, path))
      .map(([path]) => path);
    if (due.length) {
      owner.release(due);
      expired += due.length;
    }
  }
  return expired;
}

/**
 * Host timer entry (desktop application timer and headless serve share it): TTL-expire
 * long-lived upload holds first, then run the normal cleanup drain. Never throws.
 */
export function reclaimLocalAssets(now = Date.now()): void {
  try {
    expireLocalUploadHolds(now);
  } catch {
    logger.warn('上传期限回收暂未完成，已保留持久记录');
  }
  tryDrainLocalAssetCleanup();
  tryDrainDesignSchemeAssetCleanup();
}

/** Host-only lifetime capability, never serialized or supplied by renderer/API input. */
export function createLocalUploadOwner(
  options: { db?: Database.Database; schemeDb?: Database.Database } = {},
): LocalUploadOwner {
  let binding: { db: Database.Database; runtime: ReturnType<typeof getCoreRuntime> } | undefined;
  const held = new Map<string, HeldEntry>();
  const aliases = new Map<string, string>();
  let closed = false;
  const assertCurrent = () => {
    if (!closed) binding ??= { db: options.db ?? getDb(), runtime: getCoreRuntime() };
    if (
      closed ||
      !binding?.db.open ||
      (options.schemeDb && !options.schemeDb.open) ||
      getCoreRuntime() !== binding.runtime
    )
      throw Object.assign(new Error('参考图使用上下文已结束，请重新上传'), {
        code: 'IMAGE_UPLOAD_CLOSED',
      });
  };
  const release = (paths: readonly string[]) => {
    const released: string[] = [];
    for (const path of paths) {
      let canonical = resolve(path);
      canonical = aliases.get(canonical) ?? canonical;
      if (!held.has(canonical)) {
        try {
          canonical = realpathSync(canonical);
        } catch {
          /* missing files still release */
        }
      }
      const entry = held.get(canonical);
      if (!entry) continue;
      held.delete(canonical);
      for (const [alias, target] of aliases) if (target === canonical) aliases.delete(alias);
      entry.done();
      released.push(canonical);
    }
    if (!released.length || !binding?.db.open || getCoreRuntime() !== binding.runtime) return;
    const { db } = binding;
    try {
      const due = db.prepare(
        "UPDATE local_asset_cleanup SET next_attempt_at=MIN(next_attempt_at,?),last_error=NULL WHERE path=? AND last_error='writing'",
      );
      db.transaction(() => {
        for (const path of released) due.run(Date.now(), path);
      })();
      // Existing canonical/source/run references remain authoritative after owner release.
      drainLocalAssetCleanup(Date.now(), db, options.schemeDb);
    } catch {
      logger.warn('上传副本清理尚未完成，已保留持久记录');
    }
  };
  const record: OwnerRecord = { held, release, isClosed: () => closed };
  liveOwners.add(record);
  return {
    get schemeDb() {
      assertCurrent();
      return options.schemeDb;
    },
    get db() {
      assertCurrent();
      return (binding as NonNullable<typeof binding>).db;
    },
    assertCurrent,
    hold(path: string, done: () => void, declaredPath = path) {
      assertCurrent();
      if (held.has(path)) throw new Error('Upload lifetime already owns this file');
      held.set(path, { done, at: Date.now() });
      aliases.set(resolve(declaredPath), path);
    },
    release,
    close() {
      if (closed) return;
      closed = true;
      liveOwners.delete(record);
      release([...held.keys()]);
    },
  };
}
