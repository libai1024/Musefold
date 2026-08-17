#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appPath = resolve(repoRoot, process.argv[2] ?? 'release/mac-arm64/Musefold.app');
const entitlementsPath = resolve(repoRoot, 'resources/entitlements.mac.adhoc.plist');
const signerPath = resolve(repoRoot, 'node_modules/.bin/electron-osx-sign');
const relativeAppPath = relative(repoRoot, appPath);

if (process.platform !== 'darwin') {
  throw new Error('Ad-hoc macOS signing must run on macOS.');
}
if (!relativeAppPath || relativeAppPath.startsWith('..')) {
  throw new Error(`Refusing to sign outside the project: ${appPath}`);
}

await access(appPath);
await access(entitlementsPath);

async function run(command, args) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: repoRoot,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

await run(signerPath, [appPath, '--identity=-', '--no-identityValidation']);

const helperNames = [
  'Musefold Helper.app',
  'Musefold Helper (GPU).app',
  'Musefold Helper (Plugin).app',
  'Musefold Helper (Renderer).app',
];

for (const helperName of helperNames) {
  const helperPath = resolve(appPath, 'Contents', 'Frameworks', helperName);
  await run('codesign', [
    '--force',
    '--sign', '-',
    '--options', 'runtime',
    '--entitlements', entitlementsPath,
    helperPath,
  ]);
}

await run('codesign', [
  '--force',
  '--sign', '-',
  '--options', 'runtime',
  '--entitlements', entitlementsPath,
  appPath,
]);
await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);

console.log(`Ad-hoc signed and verified: ${relativeAppPath}`);
