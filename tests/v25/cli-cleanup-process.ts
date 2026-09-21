import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath } from './electron-helpers';

/** Exercise the distributed lazy entry in a separate process against only disposable data. */
export async function verifyCliCleanup(executable: string, entry: string, packaged = false) {
  test.skip(
    process.platform === 'win32',
    'This fixture delivers POSIX SIGINT/SIGTERM. Windows requires native console control events; graceful CLI shutdown and native cleanup there remain unverified.',
  );
  const root = mkdtempSync(join(tmpdir(), 'musefold-cli-cleanup-'));
  const launch = () => {
    const child = spawn(executable, [entry, 'serve', '--data-dir', root, '--port', '0'], {
      cwd: tmpdir(), // Resource loading must not depend on the repository working directory.
      env: {
        ...process.env,
        MUSEFOLD_E2E: '1',
        ...(packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (bytes) => {
      stderr += bytes.toString();
    });
    child.stdout.resume();
    const terminal = new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    );
    void terminal.catch(() => undefined);
    return {
      child,
      terminal,
      async ready() {
        await expect
          .poll(
            () => {
              if (child.exitCode !== null || child.signalCode !== null) {
                throw new Error(`CLI exited before readiness: ${stderr}`);
              }
              return stderr.includes('守护运行中');
            },
            { timeout: 15000 },
          )
          .toBe(true);
      },
      async stop(signal: 'SIGTERM' | 'SIGINT') {
        expect(child.kill(signal)).toBe(true);
        await expect.poll(() => child.exitCode, { timeout: 10000 }).not.toBeNull();
        return terminal;
      },
      async dispose() {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await terminal;
        }
      },
    };
  };
  let handle: ReturnType<typeof launch> | undefined;
  const queued = (name: string) => {
    const pictures = join(root, 'Pictures');
    mkdirSync(pictures, { recursive: true });
    const file = join(pictures, name);
    writeFileSync(file, 'owned cleanup fixture');
    const stat = statSync(file, { bigint: true });
    const db = new Database(desktopDbPath(root));
    try {
      db.prepare(`INSERT INTO local_asset_cleanup
        (path,device,inode,state,created_at,next_attempt_at) VALUES (?,?,?,'pending',0,0)`).run(
        file,
        String(stat.dev),
        String(stat.ino),
      );
    } finally {
      db.close();
    }
    return file;
  };
  try {
    handle = launch();
    await handle.ready();
    const firstPid = handle.child.pid;
    expect(await handle.stop('SIGTERM')).toEqual({ code: 0, signal: null });
    expect(existsSync(join(root, 'owner.lock'))).toBe(false);
    const pending = queued('restart.png');
    handle = launch();
    await handle.ready();
    expect(handle.child.pid).not.toBe(firstPid);
    expect(existsSync(pending)).toBe(false);
    const atExit = queued('shutdown.png');
    // Signal well before the real 60 second maintenance interval: only finalization can drain this.
    expect(await handle.stop('SIGINT')).toEqual({ code: 0, signal: null });
    expect(existsSync(atExit)).toBe(false);
    expect(existsSync(join(root, 'owner.lock'))).toBe(false);
    const db = new Database(desktopDbPath(root), { readonly: true });
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM local_asset_cleanup').get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
    return {
      firstPid,
      secondPid: handle.child.pid,
      restartDeleted: true,
      shutdownDeleted: true,
      lockReleased: true,
      packaged,
      scope:
        'Actual compiled CLI processes and native IO; seeded cleanup rows in disposable SQLite; no provider requests.',
    };
  } finally {
    await handle?.dispose();
    // Let OS close inherited pipe handles before deleting disposable data on Windows.
    await delay(10);
    rmSync(root, { recursive: true, force: true });
  }
}

/** D02.5 残余：真实 serve 进程跨一个维护周期 SIGSTOP；到期无主行在冻结期零删除，SIGCONT 后收敛回收。 */
export async function verifyCliServePause(executable: string, entry: string, packaged = false) {
  test.skip(
    process.platform === 'win32',
    'This fixture delivers POSIX SIGSTOP/SIGCONT. Windows suspension remains a separate native gate.',
  );
  const root = mkdtempSync(join(tmpdir(), 'musefold-cli-serve-pause-'));
  const child = spawn(executable, [entry, 'serve', '--data-dir', root, '--port', '0'], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      MUSEFOLD_E2E: '1',
      ...(packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (bytes) => {
    stderr += bytes.toString();
  });
  child.stdout.resume();
  const terminal = new Promise<{ code: number | null; signal: string | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    },
  );
  void terminal.catch(() => undefined);
  const pid = child.pid as number;
  let pendingPath = '';
  let seededPath = '';
  const dueRow = () => {
    const db = new Database(desktopDbPath(root), { readonly: true });
    try {
      return db
        .prepare('SELECT state,next_attempt_at FROM local_asset_cleanup WHERE path=?')
        .get(seededPath) as { state: string; next_attempt_at: number } | undefined;
    } finally {
      db.close();
    }
  };
  try {
    await expect
      .poll(
        () => {
          if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(`CLI exited before readiness: ${stderr}`);
          }
          return stderr.includes('守护运行中');
        },
        { timeout: 15000 },
      )
      .toBe(true);
    // serve 运行中种入一条到期无主清理行：若进程未被冻结，下一个 60s 维护 tick 必然删除它。
    const pictures = join(root, 'Pictures');
    mkdirSync(pictures, { recursive: true });
    pendingPath = join(pictures, 'pause-reclaim.png');
    writeFileSync(pendingPath, 'serve pause fixture');
    const seededStat = statSync(pendingPath, { bigint: true });
    seededPath = realpathSync(pendingPath);
    const seed = new Database(desktopDbPath(root));
    try {
      seed.pragma('busy_timeout = 5000');
      seed
        .prepare(
          `INSERT INTO local_asset_cleanup
        (path,device,inode,state,created_at,next_attempt_at) VALUES (?,?,?,'pending',0,0)`,
        )
        .run(seededPath, String(seededStat.dev), String(seededStat.ino));
    } finally {
      seed.close();
    }
    const bytes = readFileSync(pendingPath);
    const rowBefore = dueRow();
    expect(rowBefore?.state).toBe('pending');
    // 首个维护 tick 之前整体冻结进程（事件循环、timer、清理 drain 全部停摆）。
    expect(child.kill('SIGSTOP')).toBe(true);
    const state = () =>
      execFileSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' });
    await expect.poll(state).toContain('T');
    const stoppedAt = Date.now();
    await delay(65000);
    const frozenMs = Date.now() - stoppedAt;
    expect(frozenMs).toBeGreaterThanOrEqual(65000);
    expect(state()).toContain('T');
    // 冻结期零删除：到期行与文件字节原样（证明 drain 不运行，而非只靠设计推理）。
    expect(existsSync(pendingPath)).toBe(true);
    expect(readFileSync(pendingPath)).toEqual(bytes);
    expect(dueRow()).toEqual(rowBefore);
    // 恢复后：过期的维护 interval 立即触发 reclaimLocalAssets，只回收无主行。
    expect(child.kill('SIGCONT')).toBe(true);
    await expect.poll(() => existsSync(pendingPath), { timeout: 70000 }).toBe(false);
    const db = new Database(desktopDbPath(root), { readonly: true });
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM local_asset_cleanup').get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
    // 暂停不影响停机语义：SIGINT 仍干净退出并释放 owner.lock。
    expect(child.kill('SIGINT')).toBe(true);
    await expect.poll(() => child.exitCode, { timeout: 10000 }).not.toBeNull();
    expect(await terminal).toEqual({ code: 0, signal: null });
    expect(existsSync(join(root, 'owner.lock'))).toBe(false);
    return {
      pid,
      frozenMs,
      survivedFreeze: true,
      reclaimedAfterResume: true,
      cleanExit: true,
      packaged,
      scope:
        'Actual compiled CLI serve process SIGSTOPped across a full maintenance interval with a due unowned cleanup row; native IO and disposable data; no provider requests.',
    };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGCONT');
      child.kill('SIGKILL');
      await terminal;
    }
    await delay(10);
    rmSync(root, { recursive: true, force: true });
  }
}
