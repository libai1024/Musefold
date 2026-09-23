#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const desktopRoot = resolve(repoRoot, 'apps', 'desktop');
const packageJsonPath = resolve(desktopRoot, 'package.json');
const builderConfigPath = resolve(desktopRoot, 'electron-builder.yml');
const afterPackPath = resolve(repoRoot, 'scripts', 'after-pack.cjs');
const builderBin = resolve(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);

/**
 * electron-builder 对相对路径钩子做「不得越出工作区根」校验(app-builder-lib resolve.js),
 * 但 Windows + pnpm 下工作区根探测会拿到 Git Bash 风格的 POSIX 路径(/d/…)或探测失败,
 * rootSearchDir 回退到 apps/desktop,`../../scripts/after-pack.cjs` 即被判越界。
 * 绝对路径不进该校验;与默认 yml 指向同一文件,macOS/Linux 语义不变。
 * 仅在使用默认配置文件时注入;用户自带 --config(含点号键)时原样透传,其自定义键仍随后合并生效。
 */
export function buildBuilderArgs(cliArgs, { configPath, afterPack }) {
  const hasConfigArg = cliArgs.some(
    (arg) =>
      arg === '--config' || arg === '-c' || arg.startsWith('--config=') || arg.startsWith('-c='),
  );
  if (hasConfigArg) return cliArgs;
  const value = afterPack.includes(' ') ? `"${afterPack}"` : afterPack;
  return ['--config', configPath, `--config.afterPack=${value}`, ...cliArgs];
}

async function main() {
  const args = buildBuilderArgs(process.argv.slice(2), {
    configPath: builderConfigPath,
    afterPack: afterPackPath,
  });
  const before = await readFile(packageJsonPath, 'utf8');

  const runBuilder = () =>
    new Promise((resolveRun, rejectRun) => {
      const child = spawn(builderBin, args, {
        cwd: desktopRoot,
        env: process.env,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      child.on('error', rejectRun);
      child.on('close', (code, signal) => resolveRun({ code, signal }));
    });

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
}

// import 安全:单测只拿 buildBuilderArgs,直接 import 不得触发 electron-builder。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
