import { fork, type ChildProcess } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER_LOCK_FILE } from '@musefold/automation-server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startHeadlessServe } from '../serve-runtime';

// C3-C 历史升级边界（路线图 §6.21）：当前主进程之间的单写者/owner/initDb 顺序、
// 在途退出的新 PID 重启、旧锁+发现文件同时丢失的实际行为。
// 旧签名安装包无法在本仓库真实运行，对应结论只做静态核对并在证据 JSON 标注「未运行」。

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const close of cleanup.splice(0).reverse()) await close();
});

function tempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function spawnServe(
  dataDir: string,
  providerPort: number,
  mode: string,
): Promise<{
  child: ChildProcess;
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}> {
  const child = fork(
    fileURLToPath(new URL('./fixtures/serve-boundary-process.ts', import.meta.url)),
    [dataDir, String(providerPort), mode],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        MUSEFOLD_E2E: '1',
        MUSEFOLD_PROVIDER_KEY_BOUNDARY: 'synthetic-boundary-key',
      },
    },
  );
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal })),
  );
  cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
  return { child, closed };
}

function message<T>(child: ChildProcess, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`Missing ${type}`)), 20000);
    const exit = () => done(new Error('Fixture exited early'));
    const receive = (raw: unknown) => {
      const value = raw as { type: string; result?: T } & Record<string, unknown>;
      if (value.type === 'error') done(new Error(String(value.result)));
      else if (value.type === type) done(null, value as unknown as T extends undefined ? never : T);
    };
    function done(error: Error | null, value?: unknown) {
      clearTimeout(timer);
      child.off('message', receive);
      child.off('exit', exit);
      if (error) reject(error);
      else resolve(value as T);
    }
    child.on('message', receive);
    child.on('exit', exit);
  });
}

async function hangingProvider() {
  let sends = 0;
  let held: ServerResponse | undefined;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* drain synthetic body */
    }
    sends += 1;
    held = response;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    held?.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing provider port');
  return { port: address.port, sends: () => sends };
}

describe('C3-C current-writer upgrade boundaries (real processes)', () => {
  it('同目录第二个可写主进程在 owner.lock 处被拒，不触碰数据库与发现文件', async () => {
    const dir = tempDir('musefold-c3c-double-');
    vi.stubEnv('MUSEFOLD_E2E', '1');
    const first = await startHeadlessServe({ dataDir: dir, port: 0, log: () => {} });
    try {
      const discovery = JSON.parse(readFileSync(join(dir, 'automation.json'), 'utf8')) as {
        pid: number;
        port: number;
        token: string;
      };
      await expect(
        startHeadlessServe({ dataDir: dir, port: 0, log: () => {} }),
      ).rejects.toMatchObject({ code: 'OWNER_LOCK_HELD' });
      // 第一个所有者的发现文件与锁未被第二个进程改写。
      expect(JSON.parse(readFileSync(join(dir, 'automation.json'), 'utf8'))).toEqual(discovery);
      expect(existsSync(join(dir, OWNER_LOCK_FILE))).toBe(true);
    } finally {
      await first.stop();
    }
    expect(existsSync(join(dir, OWNER_LOCK_FILE))).toBe(false);
  });

  it('在途 SIGKILL 后新 PID 重启：接管陈旧锁，运行标记 INTERRUPTED，Provider 发送数不增', async () => {
    const dir = tempDir('musefold-c3c-restart-');
    const provider = await hangingProvider();
    const original = await spawnServe(dir, provider.port, 'serve');
    const ready = await message<{ port: number; token: string }>(original.child, 'ready');
    original.child.send({ type: 'generate' });
    const submitted = await message<{ status: number; jobId: string | null }>(
      original.child,
      'submitted',
    );
    expect(submitted.status).toBe(202);
    await vi.waitFor(() => expect(provider.sends()).toBe(1));
    expect(original.child.kill('SIGKILL')).toBe(true);
    expect(await original.closed).toEqual({ code: null, signal: 'SIGKILL' });
    expect(existsSync(join(dir, OWNER_LOCK_FILE))).toBe(true);

    // 新 PID：陈旧锁按已死持有者清理后接管；initDb 把中断运行收敛为 failed/INTERRUPTED。
    const replacement = await spawnServe(dir, provider.port, 'restart');
    const reported = await message<{
      runs: Array<{ status: string; error_code: string | null; actual_cost: number | null }>;
      spendRequests: { n: number };
      budget: unknown;
      discoveryPid: { pid: number };
    }>(replacement.child, 'reported');
    expect(reported.runs).toEqual([
      expect.objectContaining({ status: 'failed', error_code: 'INTERRUPTED', actual_cost: null }),
    ]);
    // BYOK serve 入口不产生持久费用请求，预算存储保持原样（0 费用入口分类的实测面）。
    expect(reported.spendRequests).toEqual({ n: 0 });
    expect(reported.budget).toBe(null);
    expect(replacement.child.pid).not.toBe(original.child.pid);
    expect(provider.sends()).toBe(1);
    expect(reported.discoveryPid.pid).toBe(replacement.child.pid);
  }, 30000);

  it('旧锁与发现文件启动前均丢失且旧进程仍活：当前实现仍会接管（边界实测，非合法迁移路径）', async () => {
    const dir = tempDir('musefold-c3c-lostlock-');
    const provider = await hangingProvider();
    const original = await spawnServe(dir, provider.port, 'serve');
    await message(original.child, 'ready');
    // 模拟「锁+发现文件在启动前均丢失」：旧进程仍活着、两文件被外部移除。
    rmSync(join(dir, OWNER_LOCK_FILE), { force: true });
    rmSync(join(dir, 'automation.json'), { force: true });
    const replacement = await spawnServe(dir, provider.port, 'restart');
    const reported = await message<{ discoveryPid: { pid: number } }>(
      replacement.child,
      'reported',
    );
    // 实测事实：缺少两文件时第二个可写主进程照常接管，双写者互斥不再成立。
    expect(reported.discoveryPid.pid).toBe(replacement.child.pid);
    expect(original.child.exitCode).toBeNull();
  }, 30000);
});
