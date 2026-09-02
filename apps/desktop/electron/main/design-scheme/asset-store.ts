import type Database from 'better-sqlite3';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const SCHEME_ASSET_MEDIA_HOST = 'scheme-asset' as const;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface ManagedFileIdentity {
  dev: bigint;
  ino: bigint;
}

export interface SchemeAssetMediaDescriptor {
  path: string;
  identity: ManagedFileIdentity;
}

function isWithin(root: string, target: string): boolean {
  const offset = relative(root, target);
  return (
    offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset))
  );
}

export function isSchemeAssetId(value: string): boolean {
  return OPAQUE_ID_PATTERN.test(value);
}

/** Legacy store keys may be relative to userData or absolute under a managed image root. */
export function resolveManagedStoreKey(
  storeKey: string,
  userDataDir: string,
  picturesDir: string,
): string | null {
  const target = resolve(isAbsolute(storeKey) ? storeKey : resolve(userDataDir, storeKey));
  const roots = [userDataDir, picturesDir].map((root) => resolve(root));
  if (roots.some((root) => isWithin(root, target))) return target;

  // macOS may expose the same temporary/user-data directory through aliases such
  // as /var and /private/var. Resolve existing targets before rejecting them.
  try {
    const realTarget = realpathSync(target);
    const realRoots = roots.flatMap((root) => {
      try {
        return [realpathSync(root)];
      } catch {
        return [];
      }
    });
    return realRoots.some((root) => isWithin(root, realTarget)) ? target : null;
  } catch {
    return null;
  }
}

/**
 * Resolves an untrusted local path to a managed regular file (no symlink, real path
 * still inside userData/pictures after symlink resolution) and captures the file
 * identity. Hosts that receive a path from outside the process (e.g. legacy
 * renderer-facing history items) must resolve through this before reading bytes.
 */
export function resolveManagedMediaFile(
  rawPath: string,
  userDataDir: string,
  picturesDir: string,
): SchemeAssetMediaDescriptor | null {
  const target = resolveManagedStoreKey(rawPath, userDataDir, picturesDir);
  if (!target) return null;

  try {
    const stat = lstatSync(target, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const realTarget = realpathSync(target);
    const realRoots = [userDataDir, picturesDir].map((root) => realpathSync(root));
    if (!realRoots.some((root) => isWithin(root, realTarget))) return null;
    return {
      path: realTarget,
      identity: { dev: stat.dev, ino: stat.ino },
    };
  } catch {
    return null;
  }
}

/**
 * Resolves an opaque asset id and captures the validated file identity before opening it.
 * The media reader must compare this identity with the opened descriptor to reject a
 * parent-directory or symlink swap between validation and read.
 */
export function resolveSchemeAssetMediaDescriptor(
  db: Database.Database,
  assetId: string,
  userDataDir: string,
  picturesDir: string,
): SchemeAssetMediaDescriptor | null {
  if (!isSchemeAssetId(assetId)) return null;
  const row = db.prepare('SELECT store_key FROM design_scheme_assets WHERE id = ?').get(assetId) as
    | { store_key: string }
    | undefined;
  if (!row) return null;

  return resolveManagedMediaFile(row.store_key, userDataDir, picturesDir);
}

/** Resolves an opaque asset id without exposing its store key or local path to the renderer. */
export function resolveSchemeAssetMediaTarget(
  db: Database.Database,
  assetId: string,
  userDataDir: string,
  picturesDir: string,
): string | null {
  return resolveSchemeAssetMediaDescriptor(db, assetId, userDataDir, picturesDir)?.path ?? null;
}
