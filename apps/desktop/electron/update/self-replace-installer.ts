// macOS 自替换安装:Squirrel.Mac 会校验更新包与当前应用签名一致(Designated Requirement),
// 无 Developer ID 的 ad-hoc 构建永远过不了 —— 这是 ad-hoc 发布链「下载成功但装不上」的根因。
// 本安装器改走系统路径:ditto 解压已下载 zip(sha512 已由 electron-updater 校验)→
// 原子换 .app(旧包先挪进暂存区,失败可回滚)→ relaunch。
// Windows(NSIS)与正式签名的 macOS 构建不走这里,仍用 Squirrel/NSIS 安装。

import type { app } from 'electron';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** `codesign -dv --verbose=2` 输出里 ad-hoc 的判定行;正式签名带 `Authority=Developer ID ...`。 */
export function isAdhocCodeSignOutput(output: string): boolean {
  return /^Signature=adhoc$/m.test(output) && !/^Authority=/m.test(output);
}

/** 从可执行文件路径推导 .app bundle 根:…/Musefold.app/Contents/MacOS/Musefold → …/Musefold.app。 */
export function appBundlePathFromExe(exePath: string): string | null {
  // exe/..=MacOS, ../../=Contents, ../../../=Musefold.app
  const bundle = resolve(exePath, '..', '..', '..');
  return bundle.endsWith('.app') ? bundle : null;
}

export interface SelfReplaceDeps {
  exec(
    command: string,
    args: string[],
    options?: { cwd?: string },
  ): Promise<{ stdout: string; stderr: string }>;
  mkdtemp(prefix: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  access(path: string): Promise<void>;
  relaunch(): void;
  exit(code: number): void;
}

const defaultDeps: SelfReplaceDeps = {
  exec(command, args, options) {
    return new Promise((resolveExec, rejectExec) => {
      const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', rejectExec);
      child.on('close', (code) => {
        if (code === 0) resolveExec({ stdout, stderr });
        else rejectExec(new Error(`${command} 退出码 ${code}: ${stderr.slice(0, 300)}`));
      });
    });
  },
  mkdtemp: (prefix) => mkdtemp(prefix),
  rename: (from, to) => rename(from, to),
  rm: (path, options) => rm(path, options),
  access: (path) => access(path),
  relaunch: () => undefined,
  exit: () => undefined,
};

export interface SelfReplaceHost {
  exePath(): string;
}

/**
 * 解压 + 原子替换 + 重启。任何一步失败都先回滚再抛错(旧应用保持可用),
 * 只有新包就位之后才会 relaunch/exit —— 交给宿主注入(electron 的 app.relaunch/app.exit)。
 */
export async function performSelfReplaceInstall(
  zipPath: string,
  host: SelfReplaceHost,
  electronApp: { relaunch(): void; exit(code: number): void },
  deps: SelfReplaceDeps = defaultDeps,
): Promise<void> {
  const bundle = appBundlePathFromExe(host.exePath());
  if (!bundle) throw new Error('无法定位当前应用 bundle,已取消安装');
  if (!zipPath.endsWith('.zip')) throw new Error('更新包不是 zip,已取消安装');

  const staging = await deps.mkdtemp(join(tmpdir(), 'musefold-selfreplace-'));
  try {
    // ditto 保留符号链接/权限/资源分支;unzip 不保,解出的 app 无法运行。
    await deps.exec('ditto', ['-x', '-k', '--sequesterRsrc', zipPath, staging]);
    const newApp = join(staging, 'Musefold.app');
    await deps.access(join(newApp, 'Contents', 'Info.plist'));

    const backup = join(staging, 'previous-app');
    await deps.rename(bundle, backup);
    try {
      await deps.rename(newApp, bundle);
    } catch (error) {
      await deps.rename(backup, bundle);
      throw error;
    }
  } catch (error) {
    await deps.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  // 新包已就位;staging 里只剩备份与空壳,退出后由系统回收(tmp 目录),不阻塞重启。
  electronApp.relaunch();
  electronApp.exit(0);
}

/** 读取当前 bundle 的 codesign 概要,判定是否 ad-hoc(仅 darwin;失败按非 ad-hoc 处理)。 */
export function isRunningAppBundleAdhocSignedSync(
  host: SelfReplaceHost,
  run: (
    command: string,
    args: string[],
  ) => { stdout: string; stderr: string; status: number | null },
): boolean {
  if (process.platform !== 'darwin') return false;
  const bundle = appBundlePathFromExe(host.exePath());
  if (!bundle) return false;
  try {
    const result = run('codesign', ['-dv', '--verbose=2', bundle]);
    // codesign -dv 的概要写在 stderr;退出码非 0 视为不可判定(按非 ad-hoc 走默认安装)。
    if (result.status !== 0) return false;
    return isAdhocCodeSignOutput(result.stderr);
  } catch {
    return false;
  }
}

/** electron/update/index.ts 组装用:从 electron-updater 内部读已下载的更新包路径。 */
export function downloadedUpdateFilePath(updater: unknown): string | null {
  const helper = (updater as { downloadedUpdateHelper?: { file?: string | null } } | null)
    ?.downloadedUpdateHelper;
  return typeof helper?.file === 'string' ? helper.file : null;
}

/** 宿主接缝:electron/update/index.ts 注入,避免本模块顶层 import electron(单测可跑)。 */
export function createElectronSelfReplaceHost(appModule: typeof app): SelfReplaceHost & {
  electronApp: { relaunch(): void; exit(code: number): void };
} {
  return {
    exePath: () => appModule.getPath('exe'),
    electronApp: { relaunch: () => appModule.relaunch(), exit: (code) => appModule.exit(code) },
  };
}
