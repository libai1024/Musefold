import { mkdtempSync, lstatSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { loadServeFilesystem, resolveServeNativeBinary } from '../managed-filesystem';

it.each([
  'src/managed-filesystem.ts',
  'dist/chunks/serve-runtime-owned.mjs',
  '.tsout/managed-filesystem.js',
])('resolves development native IO from the code layout %s', (suffix) => {
  const entry = resolve('packages/cli', suffix);
  expect(resolveServeNativeBinary(pathToFileURL(entry).href)).toBe(
    resolve('packages/managed-fs/build/Release/managed_fs.node'),
  );
});
it('resolves packaged lazy chunks from resources, including spaces and Unicode', () => {
  const resources = join(tmpdir(), 'Owned 未像.app', 'Contents', 'Resources');
  expect(
    resolveServeNativeBinary(
      pathToFileURL(join(resources, 'integration', 'chunks', 'serve-runtime-owned.mjs')).href,
    ),
  ).toBe(join(resources, 'native', 'managed_fs.node'));
});
it('rejects an unsupported relocated bundle instead of searching cwd or userData', () => {
  expect(() =>
    resolveServeNativeBinary(pathToFileURL(join(tmpdir(), 'owned-other', 'serve.mjs')).href),
  ).toThrow('无法定位 CLI 原生资源');
});
it('loads the actual development binding and deletes a regular file through a held directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'musefold-cli-native-'));
  const filesystem = loadServeFilesystem();
  const stat = lstatSync(root, { bigint: true });
  const directory = filesystem.openRoot(root, `${stat.dev}:${stat.ino}`);
  try {
    const file = join(root, 'owned.png');
    writeFileSync(file, 'owned');
    const identity = lstatSync(file, { bigint: true });
    expect(filesystem.fileIdentity(directory, 'owned.png')).toBe(`${identity.dev}:${identity.ino}`);
    filesystem.unlinkFile(directory, 'owned.png');
    expect(existsSync(file)).toBe(false);
  } finally {
    filesystem.close(directory);
    rmSync(root, { recursive: true, force: true });
  }
});
