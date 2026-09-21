// D02.5 残余 E2E：受管上传复制进行中的真实进程暂停（SIGSTOP）与恢复（SIGCONT）。
// 真实 Electron + 真实控制面 HTTP + 真实磁盘/SQLite；不伪造字节、时间或 IO 结果——
// 只在真实暂存 write 回调内观察并注入 OS 暂停（与 electron.package-staging-pause.spec.ts 同一手法）。
// 覆盖：复制中途冻结跨越一个 60s 维护周期，磁盘零删除（含一条本应到期、无保护引用的清理行）；
// SIGCONT 后复制完成、字节 SHA256 相等、队列收敛（在飞行降级 writing 保管）、账本不变；
// 恢复后的维护 drain 只回收无主行，不删在飞/在持文件。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

// 2 MiB 受管复制载荷：PNG 魔数 + 确定性填充（32 个 64 KiB 写块）。
const UPLOAD_BYTES = 2 * 1024 * 1024;
const payload = Buffer.alloc(UPLOAD_BYTES);
payload.set(Buffer.from('89504e470d0a1a0a', 'hex'), 0);
for (let index = 8; index < UPLOAD_BYTES; index += 1) payload[index] = (index * 31 + 13) & 0xff;
const payloadSha256 = createHash('sha256').update(payload).digest('hex');
const SEED_BYTES = 4096;

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('actual SIGSTOP during a control-plane upload copy freezes staging and maintenance; SIGCONT completes the copy', async ({}, info) => {
  test.skip(
    process.platform === 'win32',
    'Real SIGSTOP/SIGCONT requires POSIX; Windows suspension remains a separate native gate.',
  );
  test.setTimeout(300000);
  const marker = info.outputPath('pause.json');
  let app: ElectronApplication | undefined;
  let root = '';
  const previewsUploads = (base: string) => {
    const previews = readdirSync(base).find((name) => /^musefold-previews-/.test(name));
    return previews ? join(base, previews, 'uploads') : '';
  };
  try {
    ({ app, userDataDir: root } = await launchV25App('musefold-upload-pause-'));
    if (!app) throw new Error('Missing Electron application');
    const electronApp = app;
    await v25ShellPage(electronApp);
    await expect.poll(() => existsSync(join(root, 'automation.json'))).toBe(true);

    const readonlyDb = () => new Database(desktopDbPath(root), { readonly: true });
    const cleanupRow = (path: string) => {
      const db = readonlyDb();
      try {
        return db
          .prepare('SELECT state,last_error,next_attempt_at FROM local_asset_cleanup WHERE path=?')
          .get(path) as
          | { state: string; last_error: string | null; next_attempt_at: number }
          | undefined;
      } finally {
        db.close();
      }
    };
    const requestsCount = () => {
      const db = readonlyDb();
      try {
        return (
          db.prepare('SELECT COUNT(*) AS n FROM automation_spend_requests').get() as { n: number }
        ).n;
      } finally {
        db.close();
      }
    };

    // 预置一条「本应到期」的无主清理行（受管 Pictures 根内、pending、next_attempt_at=0）：
    // 若进程未被冻结，下一次 60s 维护 drain 必然删除它；冻结期它必须原地不动。
    const seeded = join(root, 'Pictures', 'seed-reclaim.png');
    mkdirSync(join(root, 'Pictures'), { recursive: true });
    writeFileSync(seeded, payload.subarray(0, SEED_BYTES));
    const seededStat = statSync(seeded, { bigint: true });
    const seededPath = realpathSync(seeded);
    const seed = new Database(desktopDbPath(root));
    try {
      seed.pragma('busy_timeout = 5000');
      seed
        .prepare(
          `INSERT INTO local_asset_cleanup (path,device,inode,state,created_at,next_attempt_at) VALUES (?,?,?,'pending',0,0)`,
        )
        .run(seededPath, String(seededStat.dev), String(seededStat.ino));
    } finally {
      seed.close();
    }
    expect(cleanupRow(seededPath)?.state).toBe('pending');

    // 主进程挂钩：只观察真实暂存 write（魔数 + 同尺寸载荷），到达阈值即注入 SIGSTOP。
    await electronApp.evaluate(
      (_electron, { expectedSize, marker: markerPath }) => {
        const fs = process.getBuiltinModule('fs');
        const modules = process.getBuiltinModule('module');
        const realWrite = fs.write;
        let stagedWritten = 0;
        let paused = false;
        // Observe real writes, injecting only an OS pause. Never fabricate bytes, time or IO results.
        fs.write = ((fd: number, ...args: unknown[]) => {
          const buffer = args[0] as Uint8Array | undefined;
          const callback = args.at(-1) as ((error: unknown, written: number) => void) | undefined;
          const looksStaged =
            buffer &&
            buffer.length === expectedSize &&
            buffer[0] === 0x89 &&
            buffer[1] === 0x50 &&
            typeof callback === 'function';
          if (!looksStaged) return Reflect.apply(realWrite, fs, [fd, ...args]);
          return Reflect.apply(realWrite, fs, [
            fd,
            buffer,
            args[1],
            args[2],
            args[3],
            (error: unknown, written: number) => {
              if (!error) stagedWritten += written;
              if (!paused && stagedWritten >= 262144) {
                paused = true;
                fs.writeFileSync(markerPath, JSON.stringify({ pid: process.pid, stagedWritten }));
                process.kill(process.pid, 'SIGSTOP');
              }
              if (stagedWritten >= expectedSize) {
                fs.write = realWrite;
                modules.syncBuiltinESMExports();
              }
              callback(error, written);
            },
          ]);
        }) as typeof fs.write;
        modules.syncBuiltinESMExports();
      },
      { expectedSize: UPLOAD_BYTES, marker },
    );

    const discovery = JSON.parse(readFileSync(join(root, 'automation.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    const responsePromise = fetch(`http://127.0.0.1:${discovery.port}/v1/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${discovery.token}`, 'content-type': 'image/png' },
      body: payload,
      signal: AbortSignal.timeout(240000),
    });
    void responsePromise.catch(() => undefined);

    await expect.poll(() => existsSync(marker), { timeout: 15000 }).toBe(true);
    expect(JSON.parse(readFileSync(marker, 'utf8')).pid).toBe(electronApp.process().pid);
    const state = () =>
      execFileSync('ps', ['-o', 'state=', '-p', String(electronApp.process().pid)], {
        encoding: 'utf8',
      });
    await expect.poll(state).toContain('T');

    // 冻结瞬间：在飞暂存是唯一的部分文件，意图行 pending 且已记录 fd 身份。
    const uploads = previewsUploads(root);
    expect(uploads).not.toBe('');
    const partials = readdirSync(uploads).map((name) => join(uploads, name));
    expect(partials).toHaveLength(1);
    const partial = partials[0] as string;
    const partialStat = statSync(partial, { bigint: true });
    expect(partialStat.size).toBeGreaterThan(0);
    expect(partialStat.size).toBeLessThan(BigInt(UPLOAD_BYTES));
    const partialIdentity = { size: partialStat.size, dev: partialStat.dev, ino: partialStat.ino };
    const partialHash = hashFile(partial);
    const partialRow = cleanupRow(realpathSync(partial));
    expect(partialRow).toMatchObject({ state: 'pending', last_error: null });
    expect(requestsCount()).toBe(0);

    // 冻结跨越一个完整维护周期（60s timer 到期点落在窗口内）：磁盘与账本零变化。
    const stoppedAt = Date.now();
    await delay(64000);
    const frozenMs = Date.now() - stoppedAt;
    expect(frozenMs).toBeGreaterThanOrEqual(64000);
    expect(state()).toContain('T');
    const afterFreeze = statSync(partial, { bigint: true });
    expect(afterFreeze.size).toBe(partialIdentity.size);
    expect(afterFreeze.dev).toBe(partialIdentity.dev);
    expect(afterFreeze.ino).toBe(partialIdentity.ino);
    expect(hashFile(partial)).toBe(partialHash);
    expect(cleanupRow(realpathSync(partial))).toEqual(partialRow);
    // 预置的到期无主行在冻结期不被删除（drain 不运行，要实测证明而非只推理）。
    expect(existsSync(seeded)).toBe(true);
    expect(readFileSync(seeded)).toEqual(payload.subarray(0, SEED_BYTES));
    expect(cleanupRow(seededPath)?.state).toBe('pending');
    expect(requestsCount()).toBe(0);

    // 恢复：复制完成（真实剩余块继续写）、响应返回、字节与账本断言。
    expect(electronApp.process().kill('SIGCONT')).toBe(true);
    const response = await responsePromise;
    expect(response.status).toBe(201);
    const { image } = (await response.json()) as { image: { path: string } };
    expect(existsSync(image.path)).toBe(true);
    expect(hashFile(image.path)).toBe(payloadSha256);
    // seeded 的冻结期不变性已在上方证毕；恢复后它随时可被首个 drain 合法回收（下方轮询断言），
    // 这里不重读它——「响应返回时刻 vs 恢复的维护 tick」之间没有可断言的固定次序。
    // 队列收敛：完成后由维护 drain 降级为受保护 deferral——写租约仍活跃时记 'writing'，
    // 写已完成但 owner 持有时记 'referenced'（local-asset-cleanup.ts 两条 deferral 分支）；
    // 两者都表示禁止删除，文件必须原地存活。预置无主行由恢复后的维护 timer 回收。
    const deferredMarker = () => cleanupRow(realpathSync(image.path))?.last_error ?? '';
    await expect.poll(deferredMarker, { timeout: 10000 }).toMatch(/^(writing|referenced)$/);
    await expect.poll(() => existsSync(seeded), { timeout: 70000 }).toBe(false);
    expect(existsSync(image.path)).toBe(true);
    expect(hashFile(image.path)).toBe(payloadSha256);
    expect(cleanupRow(realpathSync(image.path))?.last_error).toMatch(/^(writing|referenced)$/);
    expect(requestsCount()).toBe(0);
    await info.attach('upload-pause-evidence', {
      contentType: 'application/json',
      body: JSON.stringify({
        pid: electronApp.process().pid,
        frozenMs,
        partialBytes: Number(partialIdentity.size),
        partialSurvivedFreeze: true,
        seededDueRowSurvivedFreeze: true,
        seededReclaimedAfterResume: true,
        uploadSha256Match: true,
        queueFinal: 'writing|referenced',
        requestsCount: 0,
        scope:
          'Actual Electron main process paused mid-copy of a real 2 MiB control-plane upload across one maintenance interval; native IO, WAL readers only; disposable userData; no provider requests.',
      }),
    });
  } finally {
    if (app) {
      const child = app.process();
      const alive = () => child.exitCode === null && child.signalCode === null;
      if (alive()) child.kill('SIGCONT');
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          app.close().catch(() => undefined),
          new Promise<void>((resolve) => {
            deadline = setTimeout(() => {
              if (alive()) child.kill('SIGKILL');
              resolve();
            }, 10000);
          }),
        ]);
        if (alive()) {
          const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
          child.kill('SIGKILL');
          await exited;
        }
      } finally {
        clearTimeout(deadline);
      }
    }
    if (root) rmSync(root, { recursive: true, force: true });
  }
});
