#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const desktopRoot = resolve(repoRoot, 'apps', 'desktop');
const packageJsonPath = resolve(desktopRoot, 'package.json');
const builderConfigPath = resolve(desktopRoot, 'electron-builder.yml');
const builderBin = resolve(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);

const cliArgs = process.argv.slice(2);
const hasConfigArg = cliArgs.some((arg) =>
  arg === '--config' || arg === '-c' || arg.startsWith('--config=') || arg.startsWith('-c='),
);
const args = hasConfigArg ? cliArgs : ['--config', builderConfigPath, ...cliArgs];
const before = await readFile(packageJsonPath, 'utf8');

function runBuilder() {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(builderBin, args, {
      cwd: desktopRoot,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', rejectRun);
    child.on('close', (code, signal) => resolveRun({ code, signal }));
  });
}

let result;
try {
  result = await runBuilder();
} finally {
  const after = await readFile(packageJsonPath, 'utf8');
  if (after !== before) {
    await writeFile(packageJsonPath, before, 'utf8');
    console.warn('restored apps/desktop/package.json after electron-builder metadata pruning');
  }
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}
process.exit(result.code ?? 1);
