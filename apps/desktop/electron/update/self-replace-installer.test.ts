import { describe, expect, it, vi } from 'vitest';
import {
  appBundlePathFromExe,
  downloadedUpdateFilePath,
  isAdhocCodeSignOutput,
  isRunningAppBundleAdhocSignedSync,
  performSelfReplaceInstall,
  type SelfReplaceDeps,
} from './self-replace-installer';

const EXE = '/Applications/Musefold.app/Contents/MacOS/Musefold';
const ZIP = '/Users/u/Library/Caches/musefold-app-updater/pending/Musefold-2.5.1-arm64-mac.zip';

function makeDeps(overrides: Partial<SelfReplaceDeps> = {}): SelfReplaceDeps & {
  calls: string[][];
} {
  const calls: string[][] = [];
  const deps: SelfReplaceDeps = {
    exec: vi.fn(async (command, args) => {
      calls.push([command, ...args]);
      return { stdout: '', stderr: '' };
    }),
    mkdtemp: vi.fn(async () => '/tmp/musefold-selfreplace-X'),
    rename: vi.fn(async (from, to) => {
      calls.push(['rename', from, to]);
    }),
    rm: vi.fn(async (path) => {
      calls.push(['rm', path]);
    }),
    access: vi.fn(async () => undefined),
    relaunch: vi.fn(),
    exit: vi.fn(),
    ...overrides,
  };
  return Object.assign(deps, { calls });
}

const host = { exePath: () => EXE };

function makeElectronApp() {
  return { relaunch: vi.fn(), exit: vi.fn() };
}

describe('ad-hoc 签名判定', () => {
  it('recognizes ad-hoc summary and treats Developer ID as not ad-hoc', () => {
    expect(
      isAdhocCodeSignOutput(
        'CodeDirectory v=20500 flags=0x10002(adhoc,runtime)\nSignature=adhoc\n',
      ),
    ).toBe(true);
    expect(
      isAdhocCodeSignOutput(
        'Signature=Developer ID Application: 昭昭月科技有限公司 (ABCDEFG123)\nAuthority=Developer ID Certification Authority\n',
      ),
    ).toBe(false);
  });

  it('derives the .app bundle from the executable path', () => {
    expect(appBundlePathFromExe(EXE)).toBe('/Applications/Musefold.app');
    expect(appBundlePathFromExe('/usr/local/bin/musefold')).toBeNull();
  });

  it('detects synchronously via codesign stderr; failures fall back to not ad-hoc', () => {
    const run = vi.fn(() => ({
      stdout: '',
      stderr: 'Signature=adhoc\n',
      status: 0,
    }));
    expect(isRunningAppBundleAdhocSignedSync(host, run)).toBe(true);
    expect(run).toHaveBeenCalledWith('codesign', [
      '-dv',
      '--verbose=2',
      '/Applications/Musefold.app',
    ]);

    expect(
      isRunningAppBundleAdhocSignedSync(host, () => ({ stdout: '', stderr: 'boom', status: 1 })),
    ).toBe(false);
    expect(
      isRunningAppBundleAdhocSignedSync(host, () => {
        throw new Error('spawn failed');
      }),
    ).toBe(false);
  });
});

describe('downloadedUpdateFilePath', () => {
  it('reads the cached zip path from the electron-updater helper', () => {
    expect(downloadedUpdateFilePath({ downloadedUpdateHelper: { file: ZIP } })).toBe(ZIP);
    expect(downloadedUpdateFilePath({ downloadedUpdateHelper: { file: null } })).toBeNull();
    expect(downloadedUpdateFilePath({})).toBeNull();
    expect(downloadedUpdateFilePath(null)).toBeNull();
  });
});

describe('performSelfReplaceInstall', () => {
  it('unzips with ditto, swaps the bundle atomically, then relaunches', async () => {
    const deps = makeDeps();
    const electronApp = makeElectronApp();
    await performSelfReplaceInstall(ZIP, host, electronApp, deps);

    expect(deps.exec).toHaveBeenCalledWith('ditto', [
      '-x',
      '-k',
      '--sequesterRsrc',
      ZIP,
      '/tmp/musefold-selfreplace-X',
    ]);
    const staging = '/tmp/musefold-selfreplace-X';
    expect(deps.rename).toHaveBeenCalledWith(
      '/Applications/Musefold.app',
      `${staging}/previous-app`,
    );
    expect(deps.rename).toHaveBeenCalledWith(
      `${staging}/Musefold.app`,
      '/Applications/Musefold.app',
    );
    expect(electronApp.relaunch).toHaveBeenCalledTimes(1);
    expect(electronApp.exit).toHaveBeenCalledWith(0);
    // 成功路径不清暂存目录也不删备份:退出前不做多余 IO。
    expect(deps.rm).not.toHaveBeenCalled();
  });

  it('rolls back the previous bundle when moving the new one in fails', async () => {
    const deps = makeDeps();
    const electronApp = makeElectronApp();
    const staging = '/tmp/musefold-selfreplace-X';
    deps.rename = vi.fn(async (from, to) => {
      if (to === '/Applications/Musefold.app' && from === `${staging}/Musefold.app`) {
        throw new Error('EPERM');
      }
    });
    await expect(performSelfReplaceInstall(ZIP, host, electronApp, deps)).rejects.toThrow('EPERM');
    // 回滚:previous-app 移回原位,清理暂存,不重启。
    expect(deps.rename).toHaveBeenLastCalledWith(
      `${staging}/previous-app`,
      '/Applications/Musefold.app',
    );
    expect(deps.rm).toHaveBeenCalledWith(staging, { recursive: true, force: true });
    expect(electronApp.relaunch).not.toHaveBeenCalled();
  });

  it('cleans the staging dir and keeps the app untouched when ditto fails', async () => {
    const deps = makeDeps({
      exec: vi.fn(async () => {
        throw new Error('ditto 退出码 1');
      }),
    });
    const electronApp = makeElectronApp();
    await expect(performSelfReplaceInstall(ZIP, host, electronApp, deps)).rejects.toThrow('ditto');
    expect(deps.rename).not.toHaveBeenCalled();
    expect(deps.rm).toHaveBeenCalledWith('/tmp/musefold-selfreplace-X', {
      recursive: true,
      force: true,
    });
  });

  it('refuses non-zip payloads and unknown bundle locations', async () => {
    const deps = makeDeps();
    const electronApp = makeElectronApp();
    await expect(
      performSelfReplaceInstall('/tmp/Musefold-2.5.1.dmg', host, electronApp, deps),
    ).rejects.toThrow('zip');
    await expect(
      performSelfReplaceInstall(
        ZIP,
        { exePath: () => '/usr/local/bin/musefold' },
        electronApp,
        deps,
      ),
    ).rejects.toThrow('bundle');
    expect(deps.exec).not.toHaveBeenCalled();
  });
});
