import Database from 'better-sqlite3';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveManagedStoreKey,
  resolveSchemeAssetMediaDescriptor,
  resolveSchemeAssetMediaTarget,
} from '../design-scheme/asset-store';
import { handleMediaRequest } from '../media-protocol';

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

function writeBytes(path: string, bytes: Uint8Array = PNG_BYTES): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function assetDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE design_scheme_assets (id TEXT PRIMARY KEY, store_key TEXT NOT NULL)');
  db.exec(
    'CREATE TABLE design_scheme_retained_assets (asset_id TEXT, run_id TEXT, store_key TEXT NOT NULL)',
  );
  return db;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('scheme asset store', () => {
  it('resolves relative and legacy absolute managed keys without exposing arbitrary paths', () => {
    const userData = tempDir('musefold-scheme-user-data-');
    const pictures = tempDir('musefold-scheme-pictures-');
    const relativeAsset = join(userData, 'design-scheme-sources', 'snap-1', 'cover.png');
    const legacyAsset = join(pictures, 'legacy.png');
    const outsideAsset = join(tempDir('musefold-scheme-outside-'), 'secret.png');
    writeBytes(relativeAsset);
    writeBytes(legacyAsset);
    writeBytes(outsideAsset);

    expect(
      resolveManagedStoreKey('design-scheme-sources/snap-1/cover.png', userData, pictures),
    ).toBe(relativeAsset);
    expect(resolveManagedStoreKey(legacyAsset, userData, pictures)).toBe(legacyAsset);
    expect(resolveManagedStoreKey('../secret.png', userData, pictures)).toBeNull();
    expect(resolveManagedStoreKey(outsideAsset, userData, pictures)).toBeNull();
  });

  it('looks up an opaque id and rejects missing, malformed, and symlinked targets', () => {
    const userData = tempDir('musefold-scheme-user-data-');
    const pictures = tempDir('musefold-scheme-pictures-');
    const outside = tempDir('musefold-scheme-outside-');
    const managedAsset = join(userData, 'assets', 'valid.png');
    const outsideAsset = join(outside, 'secret.png');
    const symlinkAsset = join(userData, 'assets', 'linked.png');
    writeBytes(managedAsset);
    writeBytes(outsideAsset);
    symlinkSync(outsideAsset, symlinkAsset);

    const db = assetDb();
    db.prepare('INSERT INTO design_scheme_assets (id, store_key) VALUES (?, ?)').run(
      'asset_valid',
      'assets/valid.png',
    );
    db.prepare('INSERT INTO design_scheme_assets (id, store_key) VALUES (?, ?)').run(
      'asset_linked',
      'assets/linked.png',
    );

    expect(resolveSchemeAssetMediaTarget(db, 'asset_valid', userData, pictures)).toBe(
      realpathSync(managedAsset),
    );
    expect(resolveSchemeAssetMediaTarget(db, 'asset_missing', userData, pictures)).toBeNull();
    expect(resolveSchemeAssetMediaTarget(db, '../asset_valid', userData, pictures)).toBeNull();
    expect(resolveSchemeAssetMediaTarget(db, 'asset_linked', userData, pictures)).toBeNull();
    db.close();
  });

  it('captures the validated file identity for descriptor-bound reads', () => {
    const userData = tempDir('musefold-scheme-user-data-');
    const pictures = tempDir('musefold-scheme-pictures-');
    const managedAsset = join(userData, 'assets', 'valid.png');
    writeBytes(managedAsset);

    const db = assetDb();
    db.prepare('INSERT INTO design_scheme_assets (id, store_key) VALUES (?, ?)').run(
      'asset_valid',
      'assets/valid.png',
    );

    const descriptor = resolveSchemeAssetMediaDescriptor(db, 'asset_valid', userData, pictures);
    expect(descriptor).toMatchObject({ path: realpathSync(managedAsset) });
    expect(descriptor?.identity.dev).toEqual(expect.any(BigInt));
    expect(descriptor?.identity.ino).toEqual(expect.any(BigInt));
    db.close();
  });

  it.each([true, false])(
    'serves retained run results when the pictures root exists=%s, without weakening managed-file checks',
    async (picturesExist) => {
      const userData = tempDir('musefold-retained-scheme-');
      const pictures = join(userData, 'Pictures');
      if (picturesExist) mkdirSync(pictures);
      const path = join(userData, 'design-scheme-imports', 'retained', 'result.png');
      writeBytes(path);
      const db = assetDb();
      db.prepare('INSERT INTO design_scheme_retained_assets VALUES (?,?,?)').run(
        'retained',
        'run',
        path,
      );
      try {
        const response = await handleMediaRequest('media://scheme-asset/retained', {
          resolveSchemeAsset: (id) => resolveSchemeAssetMediaDescriptor(db, id, userData, pictures),
        });
        expect(response.status).toBe(200);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
        renameSync(path, `${path}.original`);
        const outside = join(tempDir('musefold-retained-outside-'), 'secret.png');
        writeBytes(outside);
        symlinkSync(outside, path);
        expect(resolveSchemeAssetMediaDescriptor(db, 'retained', userData, pictures)).toBeNull();
      } finally {
        db.close();
      }
    },
  );
});

describe('media protocol request handling', () => {
  it('serves scheme assets by opaque id with magic-sniffed MIME', async () => {
    const readBytes = vi.fn(async () => PNG_BYTES);
    const response = await handleMediaRequest('media://scheme-asset/asset_valid', {
      resolveSchemeAsset: () => ({
        path: '/managed/cover.bin',
        identity: { dev: 0n, ino: 0n },
      }),
      readBytes,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
    expect(readBytes).toHaveBeenCalledWith('/managed/cover.bin');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it('rejects malformed and unknown ids before reading disk', async () => {
    const readBytes = vi.fn(async () => PNG_BYTES);
    const resolveSchemeAsset = vi.fn(() => null);

    const malformed = await handleMediaRequest('media://scheme-asset/%2E%2E%2Fsecret', {
      resolveSchemeAsset,
      readBytes,
    });
    const missing = await handleMediaRequest('media://scheme-asset/asset_missing', {
      resolveSchemeAsset,
      readBytes,
    });

    expect(malformed.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(resolveSchemeAsset).toHaveBeenCalledTimes(1);
    expect(readBytes).not.toHaveBeenCalled();
  });

  it('rejects a managed parent-directory symlink swap before serving outside bytes', async () => {
    const userData = tempDir('musefold-scheme-user-data-');
    const pictures = tempDir('musefold-scheme-pictures-');
    const outside = tempDir('musefold-scheme-outside-');
    const managedDir = join(userData, 'assets');
    const managedAsset = join(managedDir, 'cover.png');
    const outsideDir = join(outside, 'assets');
    const outsideAsset = join(outsideDir, 'cover.png');
    writeBytes(managedAsset);
    writeBytes(
      outsideAsset,
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
    );

    const db = assetDb();
    db.prepare('INSERT INTO design_scheme_assets (id, store_key) VALUES (?, ?)').run(
      'asset_swap',
      'assets/cover.png',
    );
    const descriptor = resolveSchemeAssetMediaDescriptor(db, 'asset_swap', userData, pictures);
    expect(descriptor).not.toBeNull();

    renameSync(managedDir, join(userData, 'assets-original'));
    symlinkSync(outsideDir, managedDir);

    const response = await handleMediaRequest('media://scheme-asset/asset_swap', {
      resolveSchemeAsset: () => descriptor,
    });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Read error');
    db.close();
  });

  it('rejects non-image bytes and keeps resolver failures inside the response envelope', async () => {
    const nonImage = await handleMediaRequest('media://scheme-asset/asset_text', {
      resolveSchemeAsset: () => ({
        path: '/managed/not-image.txt',
        identity: { dev: 0n, ino: 0n },
      }),
      readBytes: async () => Uint8Array.from([1, 2, 3, 4]),
    });
    const failure = await handleMediaRequest('media://scheme-asset/asset_error', {
      resolveSchemeAsset: () => {
        throw new Error('database path must not leak');
      },
    });

    expect(nonImage.status).toBe(404);
    expect(failure.status).toBe(500);
    expect(await failure.text()).toBe('Read error');
  });

  it('rejects unknown hosts and non-image local bytes', async () => {
    const readBytes = vi.fn(async () => Uint8Array.from([1, 2, 3, 4]));
    const root = tempDir('musefold-local-media-');
    const target = join(root, 'generated.png');

    const unknown = await handleMediaRequest(
      `media://unexpected/?p=${encodeURIComponent(target)}`,
      { localRoots: () => [root], readBytes },
    );
    const nonImage = await handleMediaRequest(`media://local/?p=${encodeURIComponent(target)}`, {
      localRoots: () => [root],
      readBytes,
    });

    expect(unknown.status).toBe(400);
    expect(nonImage.status).toBe(404);
    expect(readBytes).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing media://local path behavior', async () => {
    const root = tempDir('musefold-local-media-');
    const target = join(root, 'generated.png');
    const readBytes = vi.fn(async () => PNG_BYTES);

    const response = await handleMediaRequest(`media://local/?p=${encodeURIComponent(target)}`, {
      localRoots: () => [root],
      readBytes,
    });
    const forbidden = await handleMediaRequest(
      `media://local/?p=${encodeURIComponent('/outside/generated.png')}`,
      { localRoots: () => [root], readBytes },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(forbidden.status).toBe(403);
  });
});
