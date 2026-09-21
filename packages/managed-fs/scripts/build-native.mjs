import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const architecture = process.env.MUSEFOLD_PACKAGE_ARCH ?? process.arch;
if (!['arm64', 'x64'].includes(architecture))
  throw new Error('Unsupported managed filesystem architecture');
const digest = createHash('sha256').update(
  JSON.stringify([process.platform, architecture, process.versions.node]),
);
for (const path of ['native/binding.cc', 'binding.gyp', 'scripts/build-native.mjs'])
  digest.update(readFileSync(join(root, path)));
const expected = digest.digest('hex');
const stamp = join(root, 'build', 'native-input.json');
const binary = join(root, 'build', 'Release', 'managed_fs.node');
const lock = join(root, '.native-build-lock');
const started = Date.now();
for (;;) {
  try {
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
    break;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      const { pid } = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (probe) {
          if (probe.code === 'ESRCH') {
            rmSync(lock, { recursive: true, force: true });
            continue;
          }
        }
      }
    } catch {
      /* The competing builder may still be writing its owner record. */
    }
    if (Date.now() - started > 300_000) throw new Error('Managed filesystem build lock timed out');
    await wait(100);
  }
}
try {
  const cached = existsSync(stamp) ? JSON.parse(readFileSync(stamp, 'utf8')) : null;
  if (!existsSync(binary) || cached?.digest !== expected) {
    const command = require.resolve('node-gyp/bin/node-gyp.js');
    const child = spawn(process.execPath, [command, 'rebuild', `--arch=${architecture}`], {
      cwd: root,
      stdio: 'inherit',
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0) throw new Error('Managed filesystem native build failed');
    writeFileSync(
      stamp,
      JSON.stringify({ digest: expected, platform: process.platform, architecture, napi: 8 }) +
        '\n',
    );
  }
  console.info(`[managed-fs] native build ready (${process.platform}/${architecture}, Node-API 8)`);
} finally {
  rmSync(lock, { recursive: true, force: true });
}
