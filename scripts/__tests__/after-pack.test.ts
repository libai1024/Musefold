import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createPackageWithOptions } = require('@electron/asar');
const { assertPackagedSqlite } = require('../after-pack.cjs') as {
  assertPackagedSqlite: (resources: string, platform: string, arch: string) => void;
};
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('afterPack SQLite gate', () => {
  it('requires the native module inside the asar layout and its unpacked payload', async () => {
    const root = mkdtempSync(join(tmpdir(), 'musefold-after-pack-'));
    roots.push(root);
    const source = join(root, 'source');
    const resources = join(root, 'resources');
    const moduleRoot = join(source, 'node_modules', 'better-sqlite3');
    const nativeName = `${process.platform}-${process.arch}.node`;
    mkdirSync(join(moduleRoot, 'lib'), { recursive: true });
    mkdirSync(join(moduleRoot, 'prebuilds'), { recursive: true });
    mkdirSync(resources);
    writeFileSync(join(moduleRoot, 'package.json'), '{"name":"better-sqlite3"}');
    writeFileSync(join(moduleRoot, 'lib', 'index.js'), 'module.exports = {}');
    writeFileSync(join(moduleRoot, 'prebuilds', nativeName), 'fixture');
    await createPackageWithOptions(source, join(resources, 'app.asar'), {
      unpackDir: 'node_modules/better-sqlite3',
    });

    expect(() => assertPackagedSqlite(resources, process.platform, process.arch)).not.toThrow();
    const unpackedNative = join(
      resources,
      'app.asar.unpacked',
      'node_modules',
      'better-sqlite3',
      'prebuilds',
      nativeName,
    );
    expect(existsSync(unpackedNative)).toBe(true);
    rmSync(unpackedNative);
    expect(() => assertPackagedSqlite(resources, process.platform, process.arch)).toThrow(
      'PACKAGED_SQLITE_NOT_UNPACKED',
    );
  });

  it('rejects rebuilt SQLite files that can expose the build machine path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'musefold-after-pack-'));
    roots.push(root);
    const source = join(root, 'source');
    const resources = join(root, 'resources');
    const moduleRoot = join(source, 'node_modules', 'better-sqlite3');
    mkdirSync(join(moduleRoot, 'lib'), { recursive: true });
    mkdirSync(join(moduleRoot, 'prebuilds'), { recursive: true });
    mkdirSync(join(moduleRoot, 'build'), { recursive: true });
    mkdirSync(resources);
    writeFileSync(join(moduleRoot, 'package.json'), '{"name":"better-sqlite3"}');
    writeFileSync(join(moduleRoot, 'lib', 'index.js'), 'module.exports = {}');
    writeFileSync(
      join(moduleRoot, 'prebuilds', `${process.platform}-${process.arch}.node`),
      'fixture',
    );
    writeFileSync(join(moduleRoot, 'build', 'module.vcxproj'), 'generated build file');
    await createPackageWithOptions(source, join(resources, 'app.asar'), {
      unpackDir: 'node_modules/better-sqlite3',
    });

    expect(() => assertPackagedSqlite(resources, process.platform, process.arch)).toThrow(
      'PACKAGED_SQLITE_BUILD_FILES',
    );
  });
});
