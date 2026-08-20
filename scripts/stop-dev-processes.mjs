#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { dirname, resolve, sep } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const help = args.has('--help') || args.has('-h');

if (help) {
  console.log(`Usage: npm run dev:stop -- [--dry-run]

Stops Musefold development processes started from this repository, including
Vite, esbuild, Electron, unpacked release builds, the development CLI daemon,
and the development MCP server.

The installed production app is never matched because its executable lives
outside the repository (for example /Applications/Musefold.app).

Options:
  --dry-run  List matching processes without stopping them.`);
  process.exit(0);
}

if (process.platform === 'win32') {
  console.error('dev:stop currently supports macOS and Linux.');
  process.exit(1);
}

const normalizedRoot = normalizePath(repoRoot);
const processes = await listProcesses();
const protectedPids = ancestorPids(processes);
const targets = processes.filter(isDevelopmentProcess).sort((left, right) => left.pid - right.pid);
if (targets.length === 0) {
  console.log('No Musefold development processes are running.');
  process.exit(0);
}

for (const target of targets) {
  console.log(`${dryRun ? '[dry-run] ' : ''}${target.pid}\t${target.command}`);
}

if (dryRun) {
  console.log(`Found ${targets.length} development process(es). Production app was not touched.`);
  process.exit(0);
}

const targetPids = new Set(targets.map((item) => item.pid));
const roots = targets.filter((item) => !targetPids.has(item.ppid));
for (const target of roots) {
  sendSignal(target.pid, 'SIGTERM');
}

await wait(1800);

const survivors = new Map((await listProcesses()).map((item) => [item.pid, item]));
let forced = 0;
for (const target of targets) {
  const current = survivors.get(target.pid);
  if (!current || current.command !== target.command) continue;
  if (sendSignal(target.pid, 'SIGKILL')) forced += 1;
}

await wait(150);
const remaining = new Map((await listProcesses()).map((item) => [item.pid, item]));
const failed = targets.filter((target) => remaining.get(target.pid)?.command === target.command);

if (failed.length > 0) {
  console.error(`Failed to stop ${failed.length} development process(es): ${failed.map((item) => item.pid).join(', ')}`);
  process.exit(1);
}

const forcedSuffix = forced > 0 ? ` (${forced} required forced termination)` : '';
console.log(`Stopped ${targets.length} Musefold development process(es)${forcedSuffix}. Production app was not touched.`);

function normalizePath(value) {
  return value.split(sep).join('/').replaceAll('\\', '/');
}

function ancestorPids(items) {
  const byPid = new Map(items.map((item) => [item.pid, item]));
  const pids = new Set([process.pid]);
  let pid = process.ppid;
  while (pid > 1 && !pids.has(pid)) {
    pids.add(pid);
    const parent = byPid.get(pid);
    if (!parent) break;
    pid = parent.ppid;
  }
  return pids;
}

async function listProcesses() {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const parsed = stdout
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3],
    }));
  return parsed;
}

function isDevelopmentProcess(item) {
  if (protectedPids.has(item.pid)) return false;
  const command = normalizePath(item.command);
  if (command.includes('/Applications/Musefold.app/')) return false;
  if (!command.includes(`${normalizedRoot}/`)) return false;

  const releaseApp = command.includes(`${normalizedRoot}/release/`) && command.includes('Musefold.app/');
  const electronRuntime = command.includes(`${normalizedRoot}/node_modules/electron/`);
  const electronVite = command.includes(`${normalizedRoot}/node_modules/`) && command.includes('electron-vite');
  const vite = command.includes(`${normalizedRoot}/node_modules/`) && /(?:^|[/ ])vite(?:\.js)?(?: |$)/.test(command);
  const esbuild = command.includes(`${normalizedRoot}/node_modules/@esbuild/`);
  const builtMain = command.includes(`${normalizedRoot}/apps/desktop/out/main/`);
  const cliDaemon = command.includes(`${normalizedRoot}/packages/cli/dist/musefold.mjs`) && /(?:^| )serve(?: |$)/.test(command);
  const mcpServer = command.includes(`${normalizedRoot}/packages/mcp/dist/musefold-mcp.mjs`);

  return releaseApp || electronRuntime || electronVite || vite || esbuild || builtMain || cliDaemon || mcpServer;
}

function sendSignal(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    console.error(`Could not send ${signal} to pid ${pid}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
