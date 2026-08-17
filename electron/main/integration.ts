// 客户端接入（Electron 侧）：路径解析、客户端检测、一键动作、CLI shim 安装。
// 目标（私下分发）：用户装完 App，即可在 Cursor / ChatGPT 桌面 / Claude Code 里直接用，
// 不需要 Node/npm/网络下载。

import { execFile, execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { delimiter, join, resolve } from 'path';
import { app, shell } from 'electron';
import { MUSEFOLD_SKILL_URL } from '@shared/constants';
import type {
  IntegrationAction,
  IntegrationActionResult,
  IntegrationInfo,
} from '@shared/types/ipc';
import { createLogger } from '../system/logger';
import {
  claudeCodeAddCommand,
  cliShimPosix,
  cliShimWindows,
  codexConfigSnippet,
  cursorConfigSnippet,
  cursorInstallDeeplink,
  mcpLaunchSpec,
  type IntegrationPaths,
} from './integration-snippets';
import { validateMusefoldSkill } from './integration-skill';

const logger = createLogger('integration');
const SHIM_NAME = process.platform === 'win32' ? 'musefold.cmd' : 'musefold';

export function resolveIntegrationPaths(): IntegrationPaths {
  if (app.isPackaged) {
    return {
      execPath: process.execPath,
      mcpScriptPath: join(process.resourcesPath, 'integration', 'musefold-mcp.mjs'),
      cliScriptPath: join(process.resourcesPath, 'integration', 'musefold-cli.mjs'),
      nodeModulesPath: join(process.resourcesPath, 'integration', 'node_modules'),
    };
  }
  // 开发态：Electron 二进制 + 仓库内产物（node scripts/build-cli.mjs 生成）。
  // appPath 随启动方式漂移（electron . → 仓库根；electron out/main/index.js → out/main），
  // 按候选目录扫描真实存在的产物。
  const appPath = resolve(app.getAppPath());
  const candidates = [appPath, resolve(appPath, '..'), resolve(appPath, '..', '..'), process.cwd()];
  const repoRoot =
    candidates.find((dir) => existsSync(join(dir, 'packages', 'mcp', 'dist', 'musefold-mcp.mjs'))) ?? appPath;
  return {
    execPath: process.execPath,
    mcpScriptPath: join(repoRoot, 'packages', 'mcp', 'dist', 'musefold-mcp.mjs'),
    cliScriptPath: join(repoRoot, 'packages', 'cli', 'dist', 'musefold.mjs'),
    nodeModulesPath: join(repoRoot, 'node_modules'),
  };
}

/** shim 安装目录：E2E 隔离进 userData → /usr/local/bin（可写时）→ ~/.local/bin */
function shimTargets(): string[] {
  if (process.env['MUSEFOLD_E2E'] === '1') {
    return [join(app.getPath('userData'), 'bin')];
  }
  if (process.platform === 'win32') {
    return [join(homedir(), '.musefold', 'bin')];
  }
  return ['/usr/local/bin', join(homedir(), '.local', 'bin')];
}

function installedShimPath(): string | null {
  for (const dir of shimTargets()) {
    const candidate = join(dir, SHIM_NAME);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function pathEntryEquals(left: string, right: string): boolean {
  const clean = (value: string) => value.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
  const a = clean(left);
  const b = clean(right);
  return process.platform === 'win32' ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
}

function windowsUserPath(): string {
  if (process.platform !== 'win32') return '';
  try {
    const output = execFileSync('reg.exe', ['query', 'HKCU\\Environment', '/v', 'Path'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return output.match(/REG_(?:EXPAND_)?SZ\s+([^\r\n]*)/i)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

function isDirectoryOnPath(dir: string): boolean {
  const processEntries = (process.env.PATH ?? '').split(delimiter);
  const userEntries = process.platform === 'win32' ? windowsUserPath().split(';') : [];
  return [...processEntries, ...userEntries].some((entry) => entry && pathEntryEquals(entry, dir));
}

/** shim 内容是否指向当前 App（升级/换位后需要重装） */
function shimUpToDate(paths: IntegrationPaths): boolean {
  const existing = installedShimPath();
  if (!existing) return false;
  try {
    const content = readFileSync(existing, 'utf8');
    return content.includes(paths.execPath) && content.includes(paths.cliScriptPath);
  } catch {
    return false;
  }
}

function detectBinary(name: string): boolean {
  const pathValues = [process.env.PATH ?? '', ...(process.platform === 'win32' ? [windowsUserPath()] : [])];
  return pathValues.flatMap((value) => value.split(process.platform === 'win32' ? ';' : delimiter)).some((dir) => {
    if (!dir) return false;
    return existsSync(join(dir, name)) || (process.platform === 'win32' && existsSync(join(dir, `${name}.exe`)));
  });
}

function fileContains(path: string, needle: string): boolean {
  try {
    return readFileSync(path, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

/** Skill 安装目标（通用 Agent Skill，SKILL.md 格式三家通吃）。E2E 隔离进 userData。 */
function skillTargets(): Record<'claude' | 'codex' | 'cursor', string> {
  if (process.env['MUSEFOLD_E2E'] === '1') {
    const base = join(app.getPath('userData'), 'skills');
    return {
      claude: join(base, 'claude', 'musefold'),
      codex: join(base, 'codex', 'musefold'),
      cursor: join(base, 'cursor', 'musefold'),
    };
  }
  return {
    claude: join(homedir(), '.claude', 'skills', 'musefold'),
    codex: join(homedir(), '.codex', 'skills', 'musefold'),
    cursor: join(homedir(), '.cursor', 'skills', 'musefold'),
  };
}

function skillContent(): string {
  const packaged = join(process.resourcesPath, 'integration', 'musefold-skill.md');
  const appPath = resolve(app.getAppPath());
  const candidates = app.isPackaged
    ? [packaged]
    : [
        join(appPath, 'website', 'Musefold', 'skills', 'musefold', 'SKILL.md'),
        join(resolve(appPath, '..'), 'website', 'Musefold', 'skills', 'musefold', 'SKILL.md'),
        join(resolve(appPath, '..', '..'), 'website', 'Musefold', 'skills', 'musefold', 'SKILL.md'),
        join(process.cwd(), 'website', 'Musefold', 'skills', 'musefold', 'SKILL.md'),
      ];
  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) throw new Error('Musefold Skill 文档缺失');
  return validateMusefoldSkill(readFileSync(source, 'utf8'));
}

function isShimOnPath(): boolean {
  const existing = installedShimPath();
  if (!existing) return false;
  const dir = existing.slice(0, existing.length - SHIM_NAME.length - 1);
  return isDirectoryOnPath(dir);
}

function installSkill(target: 'claude' | 'codex' | 'cursor'): IntegrationActionResult {
  const dir = skillTargets()[target];
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), skillContent(), 'utf8');
    logger.info('Agent Skill 已安装', dir);
    return { ok: true, message: `已写入 ${join(dir, 'SKILL.md')}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function getIntegrationInfo(): IntegrationInfo {
  const paths = resolveIntegrationPaths();
  const spec = mcpLaunchSpec(paths);
  const bundledReady = existsSync(paths.mcpScriptPath) && existsSync(paths.cliScriptPath);
  const codexConfigPath = join(homedir(), '.codex', 'config.toml');
  const cursorConfigPath = join(homedir(), '.cursor', 'mcp.json');
  const shimPath = installedShimPath();
  return {
    bundledReady,
    launch: spec,
    snippets: {
      cursorJson: cursorConfigSnippet(paths),
      cursorDeeplink: cursorInstallDeeplink(paths),
      claudeCommand: claudeCodeAddCommand(paths),
      codexToml: codexConfigSnippet(paths),
      skillUrl: MUSEFOLD_SKILL_URL,
      skillMarkdown: skillContent(),
    },
    skills: {
      targets: skillTargets(),
      installed: Object.fromEntries(
        Object.entries(skillTargets()).map(([key, dir]) => [key, existsSync(join(dir, 'SKILL.md'))]),
      ) as Record<'claude' | 'codex' | 'cursor', boolean>,
    },
    clients: {
      cursor: {
        configPath: cursorConfigPath,
        registered: fileContains(cursorConfigPath, 'musefold'),
      },
      claudeCode: {
        cliDetected: detectBinary('claude'),
        registered: fileContains(join(homedir(), '.claude.json'), '"musefold"'),
      },
      codex: {
        configPath: codexConfigPath,
        configExists: existsSync(codexConfigPath),
        registered: fileContains(codexConfigPath, 'mcp_servers.musefold'),
      },
    },
    cli: {
      installed: shimPath != null,
      upToDate: shimUpToDate(paths),
      onPath: isShimOnPath(),
      path: shimPath,
      installDirs: shimTargets(),
    },
  };
}

function setWindowsUserPath(dir: string, add: boolean): Promise<void> {
  if (process.platform !== 'win32' || process.env['MUSEFOLD_E2E'] === '1') return Promise.resolve();
  const target = Buffer.from(dir, 'utf8').toString('base64');
  const script = [
    `$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${target}'))`,
    `$current = [Environment]::GetEnvironmentVariable('Path', 'User')`,
    `$parts = @($current -split ';' | Where-Object { $_ -and $_.Trim() })`,
    `$parts = @($parts | Where-Object { $_.TrimEnd('\\') -ine $target.TrimEnd('\\') })`,
    ...(add ? ['$parts += $target'] : []),
    `[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')`,
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolvePromise, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 15_000, windowsHide: true },
      (error, _stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolvePromise();
      },
    );
  });
}

function updateProcessPath(dir: string, add: boolean): void {
  const entries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const filtered = entries.filter((entry) => !pathEntryEquals(entry, dir));
  process.env.PATH = (add ? [...filtered, dir] : filtered).join(delimiter);
}

async function installCliShim(): Promise<IntegrationActionResult> {
  const paths = resolveIntegrationPaths();
  const content = process.platform === 'win32' ? cliShimWindows(paths) : cliShimPosix(paths);
  const errors: string[] = [];
  for (const dir of shimTargets()) {
    const target = join(dir, SHIM_NAME);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(target, content, 'utf8');
      if (process.platform !== 'win32') chmodSync(target, 0o755);
      if (process.platform === 'win32') {
        await setWindowsUserPath(dir, true);
        updateProcessPath(dir, true);
      }
      logger.info('CLI shim 已安装', target);
      const onPath = isDirectoryOnPath(dir);
      return {
        ok: true,
        message: onPath
          ? `已安装到 ${target}`
          : `已安装到 ${target}（该目录不在 PATH 中，请把 ${dir} 加入 PATH）`,
      };
    } catch (error) {
      errors.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: false, message: `安装失败：${errors.join('；')}` };
}

async function uninstallCliShim(): Promise<IntegrationActionResult> {
  const existing = installedShimPath();
  if (!existing) return { ok: true, message: '未安装' };
  try {
    const dir = existing.slice(0, existing.length - SHIM_NAME.length - 1);
    rmSync(existing, { force: true });
    if (process.platform === 'win32') {
      await setWindowsUserPath(dir, false);
      updateProcessPath(dir, false);
    }
    return { ok: true, message: `已移除 ${existing}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Claude Code：检测到 claude CLI 时直接替用户执行注册（user 作用域，全项目可用）。 */
function registerClaudeCode(): Promise<IntegrationActionResult> {
  const paths = resolveIntegrationPaths();
  const spec = mcpLaunchSpec(paths);
  return new Promise((resolvePromise) => {
    const envArgs = Object.entries(spec.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
    execFile(
      'claude',
      ['mcp', 'add', 'musefold', '-s', 'user', ...envArgs, '--', spec.command, ...spec.args],
      { timeout: 20_000, env: { ...process.env } },
      (error, stdout, stderr) => {
        if (error) {
          resolvePromise({ ok: false, message: `claude mcp add 失败：${stderr || error.message}` });
        } else {
          logger.info('Claude Code 已注册 musefold');
          resolvePromise({ ok: true, message: stdout.trim() || '已注册到 Claude Code（user 作用域）' });
        }
      },
    );
  });
}

export async function runIntegrationAction(action: IntegrationAction): Promise<IntegrationActionResult> {
  switch (action) {
    case 'install-cli':
      return installCliShim();
    case 'uninstall-cli':
      return uninstallCliShim();
    case 'open-skill-url':
      await shell.openExternal(MUSEFOLD_SKILL_URL);
      return { ok: true, message: '已在浏览器打开 Musefold 自动化 Skill' };
    case 'open-cursor-deeplink': {
      const link = cursorInstallDeeplink(resolveIntegrationPaths());
      await shell.openExternal(link);
      return { ok: true, message: '已唤起 Cursor 安装确认' };
    }
    case 'register-claude-code':
      return registerClaudeCode();
    case 'install-skill-claude':
      return installSkill('claude');
    case 'install-skill-codex':
      return installSkill('codex');
    case 'install-skill-cursor':
      return installSkill('cursor');
    case 'install-skill-all': {
      const results = (['claude', 'codex', 'cursor'] as const).map((target) => installSkill(target));
      const failed = results.filter((result) => !result.ok);
      return failed.length === 0
        ? { ok: true, message: '已安装到 Claude Code、Codex/ChatGPT、Cursor 的技能目录' }
        : { ok: false, message: failed.map((result) => result.message).join('；') };
    }
    default:
      return { ok: false, message: `未知动作：${String(action)}` };
  }
}
