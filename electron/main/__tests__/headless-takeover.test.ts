import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER_LOCK_FILE, writeDiscoveryFile, type OwnerLockInfo } from '@musefold/automation-server';
import { acquireDesktopOwnerLockWithHeadlessTakeover } from '../headless-takeover';

const tempDirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await waitForExit(child);
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('acquireDesktopOwnerLockWithHeadlessTakeover', () => {
  it('stops a headless daemon and lets the desktop app acquire owner.lock', async () => {
    const dir = tempDir();
    const child = await spawnIdleChild();
    writeOwnerLock(dir, { pid: child.pid, owner: 'headless-daemon', acquiredAt: new Date(0).toISOString() });
    writeDiscoveryFile(dir, discoveryDocument(child.pid, 'headless-daemon'));

    const result = await acquireDesktopOwnerLockWithHeadlessTakeover(dir, {
      timeoutMs: 3_000,
      forceKillAfterMs: 500,
      pollIntervalMs: 25,
    });

    expect(result.acquired).toBe(true);
    const holder = JSON.parse(readFileSync(join(dir, OWNER_LOCK_FILE), 'utf8')) as OwnerLockInfo;
    expect(holder).toMatchObject({ pid: process.pid, owner: 'desktop-app' });

    result.release?.();
  });

  it('does not terminate a process when discovery ownership does not match the headless lock', async () => {
    const dir = tempDir();
    const child = await spawnIdleChild();
    writeOwnerLock(dir, { pid: child.pid, owner: 'headless-daemon', acquiredAt: new Date(0).toISOString() });
    writeDiscoveryFile(dir, discoveryDocument(child.pid, 'desktop-app'));

    const result = await acquireDesktopOwnerLockWithHeadlessTakeover(dir, {
      timeoutMs: 100,
      pollIntervalMs: 10,
    });

    expect(result.acquired).toBe(false);
    expect(processAlive(child.pid)).toBe(true);
  });

  it('leaves an existing desktop owner alone', async () => {
    const dir = tempDir();
    writeOwnerLock(dir, { pid: process.pid, owner: 'desktop-app', acquiredAt: new Date(0).toISOString() });

    const result = await acquireDesktopOwnerLockWithHeadlessTakeover(dir);

    expect(result.acquired).toBe(false);
    expect(result.holder).toMatchObject({ pid: process.pid, owner: 'desktop-app' });
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-headless-takeover-'));
  tempDirs.push(dir);
  return dir;
}

async function spawnIdleChild(): Promise<ChildProcess & { pid: number }> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  if (!child.pid) throw new Error('spawned child has no pid');
  children.push(child);
  return child as ChildProcess & { pid: number };
}

function writeOwnerLock(dir: string, info: OwnerLockInfo): void {
  writeFileSync(join(dir, OWNER_LOCK_FILE), JSON.stringify(info), { mode: 0o600 });
}

function discoveryDocument(pid: number, owner: OwnerLockInfo['owner']) {
  return {
    version: 1 as const,
    apiVersion: 'v1' as const,
    pid,
    port: 4567,
    token: 'mf_at_test',
    owner,
    appVersion: '0.5.0-test',
    startedAt: new Date(0).toISOString(),
  };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 1_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
