import { lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearStaleSingletonLock, parseSingletonLockTarget } from '../singleton-lock';

const tempRoots: string[] = [];

function userDataDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'musefold-singleton-'));
  tempRoots.push(root);
  return root;
}

function plantLock(dir: string, target: string): void {
  symlinkSync(target, join(dir, 'SingletonLock'));
  // Chromium 的另外两件套：Socket 也是符号链接、Cookie 是普通符号链接；
  // 测试里用普通链接/文件近似即可（清理只关心 unlink）。
  symlinkSync('3357071559610056141', join(dir, 'SingletonCookie'));
  writeFileSync(join(dir, 'SingletonSocket'), '');
}

/** 断链符号链接 existsSync 会返回 false（跟随目标），必须用 lstat 判存在。 */
function linkExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

const dead = () => {
  throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
};
const alive = () => undefined;
const foreign = () => {
  throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('parseSingletonLockTarget', () => {
  it('解析 hostname-pid（主机名自身可含连字符）', () => {
    expect(parseSingletonLockTarget('wangweideMacMini-64.local-71918'))
      .toEqual({ host: 'wangweideMacMini-64.local', pid: 71918 });
  });

  it('非法目标返回 null', () => {
    expect(parseSingletonLockTarget('no-separator-')).toBeNull();
    expect(parseSingletonLockTarget('host-notanumber')).toBeNull();
    expect(parseSingletonLockTarget('host-0')).toBeNull();
    expect(parseSingletonLockTarget('nodash')).toBeNull();
    expect(parseSingletonLockTarget('')).toBeNull();
  });
});

describe('clearStaleSingletonLock', () => {
  it('持锁进程已死（ESRCH）：清掉锁三件套并返回 true', () => {
    const dir = userDataDir();
    plantLock(dir, 'test-host-4242');
    const cleared = clearStaleSingletonLock(dir, { platform: 'darwin', host: 'test-host', probeProcess: dead });
    expect(cleared).toBe(true);
    for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      expect(linkExists(join(dir, name))).toBe(false);
    }
  });

  it('持锁进程仍活着：绝不动锁（真实第二实例场景）', () => {
    const dir = userDataDir();
    plantLock(dir, 'test-host-4242');
    expect(clearStaleSingletonLock(dir, { platform: 'darwin', host: 'test-host', probeProcess: alive })).toBe(false);
    expect(linkExists(join(dir, 'SingletonLock'))).toBe(true);
  });

  it('EPERM（PID 被他人进程复用）：不动锁，交回 Chromium 仲裁', () => {
    const dir = userDataDir();
    plantLock(dir, 'test-host-4242');
    expect(clearStaleSingletonLock(dir, { platform: 'darwin', host: 'test-host', probeProcess: foreign })).toBe(false);
    expect(linkExists(join(dir, 'SingletonLock'))).toBe(true);
  });

  it('别的主机留下的锁（共享目录）：不动', () => {
    const dir = userDataDir();
    plantLock(dir, 'other-host-4242');
    expect(clearStaleSingletonLock(dir, { platform: 'darwin', host: 'test-host', probeProcess: dead })).toBe(false);
    expect(linkExists(join(dir, 'SingletonLock'))).toBe(true);
  });

  it('没有锁文件：静默返回 false', () => {
    expect(clearStaleSingletonLock(userDataDir(), { platform: 'darwin', host: 'test-host', probeProcess: dead })).toBe(false);
  });

  it('Windows 平台直接跳过', () => {
    const dir = userDataDir();
    plantLock(dir, 'test-host-4242');
    expect(clearStaleSingletonLock(dir, { platform: 'win32', host: 'test-host', probeProcess: dead })).toBe(false);
    expect(linkExists(join(dir, 'SingletonLock'))).toBe(true);
  });

  it('用真实 process.kill 探测：本进程 PID 视为存活', () => {
    const dir = userDataDir();
    plantLock(dir, `test-host-${process.pid}`);
    expect(clearStaleSingletonLock(dir, { platform: 'darwin', host: 'test-host' })).toBe(false);
    expect(linkExists(join(dir, 'SingletonLock'))).toBe(true);
  });
});
