// 客户端接入（Electron 侧）：路径解析、客户端检测、一键动作、CLI shim 安装。
// 目标（私下分发）：用户装完 App，即可在 Cursor / ChatGPT 桌面 / Claude Code 里直接用，
// 不需要 Node/npm/网络下载。

import { execFile, execFileSync } from 'child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { delimiter, dirname, join } from 'path';
import { app, shell } from 'electron';
import { resolveAppRoot } from './app-paths';
import {
  MUSEFOLD_SKILL_MANIFEST_URL,
  MUSEFOLD_SKILL_URL,
  MUSEFOLD_SKILL_VERSION,
} from '@shared/constants';
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
import {
  compareReleaseVersions,
  extractMusefoldSkillVersion,
  replaceMusefoldSkillDirectory,
  sha256Text,
  SKILL_INSTALL_METADATA_FILE,
  validateSkillReleaseManifest,
  type MusefoldSkillReleaseManifest,
} from './integration-skill-release';
import {
  managedCliPathBlock,
  removeManagedCliPathBlock,
  resolvePosixShellProfile,
  upsertManagedCliPathBlock,
} from './integration-cli-path';
import {
  getSkillAutoUpdateEnabled,
  setSkillAutoUpdateEnabled,
} from '../settings/automation';

const logger = createLogger('integration');
const SHIM_NAME = process.platform === 'win32' ? 'musefold.cmd' : 'musefold';
const SKILL_RELEASE_FILES = ['SKILL.md', 'references/compatibility.md'] as const;
const SKILL_FETCH_TIMEOUT_MS = 8_000;
const SKILL_FILE_MAX_BYTES = 512 * 1024;

let remoteSkillRelease: MusefoldSkillReleaseManifest | null = null;
let skillReleaseCheckedAt: string | null = null;
let skillReleaseCheckError: string | null = null;

export function resolveIntegrationPaths(): IntegrationPaths {
  if (app.isPackaged) {
    return {
      execPath: process.execPath,
      mcpScriptPath: join(process.resourcesPath, 'integration', 'musefold-mcp.mjs'),
      cliScriptPath: join(process.resourcesPath, 'integration', 'musefold-cli.mjs'),
      nodeModulesPath: join(process.resourcesPath, 'integration', 'node_modules'),
    };
  }
  // 开发态产物在仓库 packages/ 下，必须先解析应用根；app.getAppPath() 在 electron-vite
  // 未打包运行时指向 out/main。
  const repoRoot = resolveAppRoot();
  return {
    execPath: process.execPath,
    mcpScriptPath: join(repoRoot, 'packages', 'mcp', 'dist', 'musefold-mcp.mjs'),
    cliScriptPath: join(repoRoot, 'packages', 'cli', 'dist', 'musefold.mjs'),
    nodeModulesPath: join(repoRoot, 'node_modules'),
  };
}

/** CLI 默认使用用户级目录；macOS 不应为命令行入口要求管理员权限。 */
function shimTargets(): string[] {
  if (process.env['MUSEFOLD_E2E'] === '1') {
    return [join(app.getPath('userData'), 'bin')];
  }
  if (process.platform === 'win32') {
    return [join(homedir(), '.musefold', 'bin')];
  }
  return [join(homedir(), '.local', 'bin')];
}

function shimSearchDirs(): string[] {
  const current = shimTargets();
  // v0.5 之前可能由用户手动装到 /usr/local/bin；继续识别，以便显示和卸载。
  return process.platform === 'darwin' ? [...current, '/usr/local/bin'] : current;
}

function installedShimPath(): string | null {
  for (const dir of shimSearchDirs()) {
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

function skillSourceDir(): string {
  const source = app.isPackaged
    ? join(process.resourcesPath, 'integration', 'musefold-skill')
    : join(resolveAppRoot(), 'website', 'Musefold', 'skills', 'musefold');
  if (!existsSync(join(source, 'SKILL.md'))) throw new Error('Musefold Skill 文档缺失');
  return source;
}

function bundledSkillFiles(): Map<string, string> {
  const sourceDir = skillSourceDir();
  const files = new Map<string, string>();
  for (const relativePath of SKILL_RELEASE_FILES) {
    const path = join(sourceDir, relativePath);
    if (!existsSync(path)) throw new Error(`Musefold Skill 内置文件缺失：${relativePath}`);
    files.set(relativePath, readFileSync(path, 'utf8'));
  }
  validateMusefoldSkill(files.get('SKILL.md')!);
  return files;
}

function skillContent(): string {
  return bundledSkillFiles().get('SKILL.md')!;
}

function bundledSkillRelease(): MusefoldSkillReleaseManifest {
  const files = bundledSkillFiles();
  return {
    schemaVersion: 1,
    name: 'musefold',
    version: MUSEFOLD_SKILL_VERSION,
    releasedAt: '2026-08-17T00:00:00.000Z',
    minimumAppVersion: '0.0.0',
    files: [...files].map(([path, content]) => ({
      path,
      url: path === 'SKILL.md'
        ? MUSEFOLD_SKILL_URL
        : MUSEFOLD_SKILL_URL.replace(/SKILL\.md$/, path),
      sha256: sha256Text(content),
    })),
  };
}

function sanitizeSkillUpdateError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/[^\s)]+/gi, '[Skill 发布服务器]')
    .slice(0, 240);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(SKILL_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > SKILL_FILE_MAX_BYTES) throw new Error('Skill 发布文件超过大小限制');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > SKILL_FILE_MAX_BYTES) throw new Error('Skill 发布文件超过大小限制');
  return text;
}

async function checkRemoteSkillRelease(): Promise<MusefoldSkillReleaseManifest | null> {
  skillReleaseCheckedAt = new Date().toISOString();
  try {
    const manifest = validateSkillReleaseManifest(JSON.parse(await fetchText(MUSEFOLD_SKILL_MANIFEST_URL)));
    if (compareReleaseVersions(app.getVersion(), manifest.minimumAppVersion) < 0) {
      throw new Error(`最新版 Skill ${manifest.version} 需要 Musefold ${manifest.minimumAppVersion} 或更高版本`);
    }
    remoteSkillRelease = compareReleaseVersions(manifest.version, MUSEFOLD_SKILL_VERSION) >= 0
      ? manifest
      : null;
    skillReleaseCheckError = null;
    return remoteSkillRelease ?? bundledSkillRelease();
  } catch (error) {
    skillReleaseCheckError = sanitizeSkillUpdateError(error);
    logger.warn('Skill 更新检查失败', skillReleaseCheckError);
    return null;
  }
}

function availableSkillRelease(): MusefoldSkillReleaseManifest {
  return remoteSkillRelease ?? bundledSkillRelease();
}

async function releaseFiles(manifest: MusefoldSkillReleaseManifest): Promise<Map<string, string>> {
  if (manifest.version === MUSEFOLD_SKILL_VERSION && manifest !== remoteSkillRelease) {
    return bundledSkillFiles();
  }
  const files = new Map<string, string>();
  for (const file of manifest.files) {
    const content = await fetchText(file.url);
    if (sha256Text(content) !== file.sha256) throw new Error(`Skill 文件校验失败：${file.path}`);
    files.set(file.path, content);
  }
  const skill = validateMusefoldSkill(files.get('SKILL.md') ?? '');
  if (extractMusefoldSkillVersion(skill) !== manifest.version) {
    throw new Error('Skill 正文版本与发布清单不一致');
  }
  return files;
}

function installedSkillVersion(dir: string): string | null {
  try {
    const metadata = JSON.parse(readFileSync(join(dir, SKILL_INSTALL_METADATA_FILE), 'utf8')) as {
      name?: unknown;
      version?: unknown;
    };
    if (metadata.name === 'musefold' && typeof metadata.version === 'string') {
      compareReleaseVersions(metadata.version, metadata.version);
      return metadata.version;
    }
  } catch {
    // Older/manual installations have no sidecar; use the in-document marker next.
  }
  try {
    return extractMusefoldSkillVersion(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
  } catch {
    return null;
  }
}

function isShimOnPath(): boolean {
  const existing = installedShimPath();
  if (!existing) return false;
  const dir = existing.slice(0, existing.length - SHIM_NAME.length - 1);
  return isDirectoryOnPath(dir);
}

async function installSkill(
  target: 'claude' | 'codex' | 'cursor',
  manifest = availableSkillRelease(),
): Promise<IntegrationActionResult> {
  const dir = skillTargets()[target];
  try {
    const files = await releaseFiles(manifest);
    const source = manifest === remoteSkillRelease ? 'github-release' : 'bundled';
    const backup = replaceMusefoldSkillDirectory(
      dir,
      files,
      manifest,
      source,
      source === 'github-release' ? MUSEFOLD_SKILL_MANIFEST_URL : null,
    );
    logger.info('Agent Skill 已安装', dir);
    return {
      ok: true,
      message: `已安装 Musefold Skill ${manifest.version} 到 ${dir}${backup ? `；旧版备份：${backup}` : ''}`,
    };
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
  const targets = skillTargets();
  const installed = Object.fromEntries(
    Object.entries(targets).map(([key, dir]) => [key, existsSync(join(dir, 'SKILL.md'))]),
  ) as Record<'claude' | 'codex' | 'cursor', boolean>;
  const installedVersions = Object.fromEntries(
    Object.entries(targets).map(([key, dir]) => [key, installedSkillVersion(dir)]),
  ) as Record<'claude' | 'codex' | 'cursor', string | null>;
  const availableVersion = availableSkillRelease().version;
  const updateAvailable = Object.entries(installed).some(([target, isInstalled]) => {
    if (!isInstalled) return false;
    const version = installedVersions[target as keyof typeof installedVersions];
    return version == null || compareReleaseVersions(version, availableVersion) < 0;
  });
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
      targets,
      installed,
      installedVersions,
      bundledVersion: MUSEFOLD_SKILL_VERSION,
      availableVersion,
      updateAvailable,
      checkedAt: skillReleaseCheckedAt,
      checkError: skillReleaseCheckError,
      autoUpdate: getSkillAutoUpdateEnabled(),
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

function configurePosixUserPath(dir: string): string | null {
  if (process.env['MUSEFOLD_E2E'] === '1') {
    updateProcessPath(dir, true);
    return null;
  }
  const profile = resolvePosixShellProfile(homedir(), process.env['SHELL'], existsSync);
  if (!profile) return null;
  const current = existsSync(profile.path) ? readFileSync(profile.path, 'utf8') : '';
  const next = upsertManagedCliPathBlock(current, managedCliPathBlock(profile.kind));
  if (next !== current) {
    mkdirSync(dirname(profile.path), { recursive: true });
    writeFileSync(profile.path, next, 'utf8');
  }
  updateProcessPath(dir, true);
  return profile.path;
}

function removePosixUserPath(): string | null {
  if (process.env['MUSEFOLD_E2E'] === '1') return null;
  const profile = resolvePosixShellProfile(homedir(), process.env['SHELL'], existsSync);
  if (!profile || !existsSync(profile.path)) return null;
  const current = readFileSync(profile.path, 'utf8');
  const next = removeManagedCliPathBlock(current);
  if (next !== current) writeFileSync(profile.path, next, 'utf8');
  return profile.path;
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
      } else {
        const profile = configurePosixUserPath(dir);
        logger.info('CLI PATH 已配置', profile ?? '当前进程');
      }
      logger.info('CLI shim 已安装', target);
      const onPath = isDirectoryOnPath(dir);
      return {
        ok: true,
        message: onPath
          ? `已为当前用户安装到 ${target}；已打开的终端或 Agent 需要重新启动`
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
    } else {
      removePosixUserPath();
      updateProcessPath(dir, false);
    }
    return { ok: true, message: `已移除 ${existing}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 正式版首启/升级后幂等修复 CLI。Windows 安装器通常已完成此步骤；
 * macOS DMG 没有 postinstall，必须等 App 位于 Applications 后由首启完成。
 */
export async function ensureCliInstalledAtStartup(): Promise<void> {
  if (!app.isPackaged || process.env['MUSEFOLD_E2E'] === '1') return;
  if (process.platform === 'darwin' && !app.isInApplicationsFolder()) {
    logger.info('跳过 CLI 自动安装：Musefold 尚未位于 Applications 文件夹');
    return;
  }
  const paths = resolveIntegrationPaths();
  if (!existsSync(paths.cliScriptPath)) {
    logger.warn('跳过 CLI 自动安装：打包内 CLI 产物缺失');
    return;
  }
  if (installedShimPath() && shimUpToDate(paths) && isShimOnPath()) return;
  const result = await installCliShim();
  if (result.ok) logger.info('CLI 自动安装/修复完成', result.message);
  else logger.warn('CLI 自动安装/修复失败', result.message);
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
    case 'check-skill-update': {
      const release = await checkRemoteSkillRelease();
      return release
        ? { ok: true, message: `已检查，最新 Skill 为 ${release.version}` }
        : { ok: false, message: skillReleaseCheckError ?? '暂时无法检查 Skill 更新' };
    }
    case 'enable-skill-auto-update':
      setSkillAutoUpdateEnabled(true);
      return { ok: true, message: '已开启 Skill 自动更新；只更新已安装的 Musefold Skill' };
    case 'disable-skill-auto-update':
      setSkillAutoUpdateEnabled(false);
      return { ok: true, message: '已关闭 Skill 自动更新' };
    case 'install-skill-claude':
      return installSkill('claude');
    case 'install-skill-codex':
      return installSkill('codex');
    case 'install-skill-cursor':
      return installSkill('cursor');
    case 'install-skill-all': {
      const release = availableSkillRelease();
      let files: Map<string, string>;
      try {
        files = await releaseFiles(release);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      const results = await Promise.all(
        (['claude', 'codex', 'cursor'] as const).map(async (target) => {
          const dir = skillTargets()[target];
          try {
            const source = release === remoteSkillRelease ? 'github-release' : 'bundled';
            const backup = replaceMusefoldSkillDirectory(
              dir,
              files,
              release,
              source,
              source === 'github-release' ? MUSEFOLD_SKILL_MANIFEST_URL : null,
            );
            return { ok: true, message: backup ?? '' } satisfies IntegrationActionResult;
          } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
          }
        }),
      );
      const failed = results.filter((result) => !result.ok);
      return failed.length === 0
        ? { ok: true, message: `已将 Musefold Skill ${release.version} 安装到 Claude Code、Codex/ChatGPT、Cursor；现有目录已保留时间戳备份` }
        : { ok: false, message: failed.map((result) => result.message).join('；') };
    }
    default:
      return { ok: false, message: `未知动作：${String(action)}` };
  }
}

/** 启动时只做一次轻量检查；自动更新仅作用于用户已经安装的目标。 */
export async function checkSkillUpdatesAtStartup(): Promise<void> {
  const release = await checkRemoteSkillRelease();
  if (!getSkillAutoUpdateEnabled()) return;
  const selected = release ?? bundledSkillRelease();
  const targets = skillTargets();
  for (const [target, dir] of Object.entries(targets) as Array<[keyof typeof targets, string]>) {
    if (!existsSync(join(dir, 'SKILL.md'))) continue;
    const installedVersion = installedSkillVersion(dir);
    if (installedVersion && compareReleaseVersions(installedVersion, selected.version) >= 0) continue;
    const result = await installSkill(target, selected);
    if (!result.ok) logger.warn(`Skill 自动更新失败（${target}）`, result.message);
  }
}
