import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type ElectronApplication, expect } from '@playwright/test';

const repoRoot = resolve(import.meta.dirname, '../..');

export async function expectCurrentPackage(app: ElectronApplication, userDataDir: string) {
  expect(
    await app.evaluate(({ app: host }) => ({
      packaged: host.isPackaged,
      arch: process.arch,
      appPath: host.getAppPath(),
      userData: host.getPath('userData'),
    })),
  ).toMatchObject({
    packaged: true,
    arch: process.env.MUSEFOLD_PACKAGE_ARCH || process.arch,
    userData: userDataDir,
  });
  expect(await app.evaluate(({ app: host }) => host.getAppPath())).toMatch(/app\.asar$/);
  const files = readdirSync(join(repoRoot, 'apps/desktop/out'), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(repoRoot.length + 1)
        .replaceAll('\\', '/'),
    )
    .sort();
  expect(files.length).toBeGreaterThan(0);
  const expectedHashes = files.map((file) =>
    createHash('sha256')
      .update(readFileSync(join(repoRoot, file)))
      .digest('hex'),
  );
  const packagedHashes = await app.evaluate(({ app: host }, paths) => {
    const fs = process.getBuiltinModule('fs');
    const path = process.getBuiltinModule('path');
    const crypto = process.getBuiltinModule('crypto');
    return paths.map((file) =>
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(host.getAppPath(), file)))
        .digest('hex'),
    );
  }, files);
  expect(packagedHashes, 'packaged App must match every current desktop build byte').toEqual(
    expectedHashes,
  );
  return {
    files: files.length,
    bundleManifestSha256: createHash('sha256')
      .update(JSON.stringify(files.map((file, index) => [file, packagedHashes[index]])))
      .digest('hex'),
  };
}
