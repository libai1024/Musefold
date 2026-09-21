import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import * as discovery from '@musefold/automation-server/discovery';
const sockets = vi.hoisted(() => [] as import('node:http').Server[]);
vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>();
  return {
    ...actual,
    createServer: (...args: Parameters<typeof actual.createServer>) => {
      const server = actual.createServer(...args);
      sockets.push(server);
      return server;
    },
  };
});
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@musefold/core/db';
import { closeDesignSchemeDb } from '@musefold/core/db/design-scheme';
import { configureTestCoreRuntime, testCorePaths } from '@musefold/core/testing';
import { LOCAL_UPLOAD_TTL_MS } from '@musefold/core/constants';
import { enqueueLocalAssetCleanup } from '@musefold/core/services/local-asset-cleanup';
import { startHeadlessServe } from '../serve-runtime';
import * as nativePort from '../managed-filesystem';

afterEach(async () => {
  for (const server of sockets.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('TTL-expires a long-lived upload through the periodic serve timer while the daemon keeps running', async () => {
  // 只 fake interval/Date：HTTP 与 SQLite 的真实异步 IO 不受影响。
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  const root = mkdtempSync(join(tmpdir(), 'musefold-serve-upload-ttl-'));
  vi.stubEnv('MUSEFOLD_E2E', '1');
  let handle: Awaited<ReturnType<typeof startHeadlessServe>> | undefined;
  try {
    mkdirSync(join(root, 'Pictures'));
    configureTestCoreRuntime(root, {
      getPaths: () => ({ ...testCorePaths(root), pictures: join(root, 'Pictures') }),
    });
    handle = await startHeadlessServe({ dataDir: root, port: 0, log: () => undefined });
    const response = await fetch(`http://127.0.0.1:${handle.port}/v1/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'image/png' },
      body: Buffer.from('89504e470d0a1a0a00000000', 'hex'),
    });
    expect(response.status).toBe(201);
    const { image } = (await response.json()) as { image: { path: string } };
    expect(existsSync(image.path)).toBe(true);
    // 推进 60s 清理 timer 越过 TTL：守护不停止，未引用上传按期限回收。
    await vi.advanceTimersByTimeAsync(LOCAL_UPLOAD_TTL_MS + 61_000);
    expect(existsSync(image.path)).toBe(false);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM local_asset_cleanup').get()).toEqual({
      n: 0,
    });
  } finally {
    try {
      await handle?.stop();
    } finally {
      vi.useRealTimers();
      closeDesignSchemeDb();
      closeDb();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

it('resumes durable cleanup only after acquiring ownership and also drains after shutdown finalization', async () => {
  const root = mkdtempSync(join(tmpdir(), 'musefold-serve-cleanup-'));
  vi.stubEnv('MUSEFOLD_E2E', '1');
  let handle: Awaited<ReturnType<typeof startHeadlessServe>> | undefined;
  try {
    const pictures = join(root, 'Pictures');
    mkdirSync(pictures);
    configureTestCoreRuntime(root, { getPaths: () => ({ ...testCorePaths(root), pictures }) });
    const first = join(pictures, 'first.png');
    writeFileSync(first, 'owned first');
    expect(enqueueLocalAssetCleanup([first])).toBe(1);
    closeDesignSchemeDb();
    closeDb();
    handle = await startHeadlessServe({ dataDir: root, port: 0, log: () => undefined });
    expect(existsSync(first)).toBe(false);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM local_asset_cleanup').get()).toEqual({
      n: 0,
    });

    const second = join(pictures, 'second.png');
    writeFileSync(second, 'owned second');
    enqueueLocalAssetCleanup([second]);
    await expect(
      startHeadlessServe({ dataDir: root, port: 0, log: () => undefined }),
    ).rejects.toMatchObject({ code: 'OWNER_LOCK_HELD' });
    expect(existsSync(second)).toBe(true);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM local_asset_cleanup').get()).toEqual({
      n: 1,
    });
    await handle.stop();
    expect(existsSync(second)).toBe(false);
    expect(existsSync(join(root, 'owner.lock'))).toBe(false);
  } finally {
    await handle?.stop();
    closeDesignSchemeDb();
    closeDb();
    rmSync(root, { recursive: true, force: true });
  }
});

it('fails without taking ownership or creating a database if native resources are unavailable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'musefold-serve-no-native-'));
  try {
    vi.spyOn(nativePort, 'loadServeFilesystem').mockImplementationOnce(() => {
      throw new Error('owned native unavailable');
    });
    await expect(
      startHeadlessServe({ dataDir: root, port: 0, log: () => undefined }),
    ).rejects.toThrow('owned native unavailable');
    expect(existsSync(join(root, 'owner.lock'))).toBe(false);
    expect(existsSync(testCorePaths(root).db)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === 'win32')(
  'releases actual uploaded files and ownership after discovery unlink fails',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'musefold-serve-stop-discovery-'));
    vi.stubEnv('MUSEFOLD_E2E', '1');
    let handle: Awaited<ReturnType<typeof startHeadlessServe>> | undefined;
    try {
      handle = await startHeadlessServe({ dataDir: root, port: 0, log: () => undefined });
      const response = await fetch(`http://127.0.0.1:${handle.port}/v1/uploads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'image/png' },
        body: Buffer.from('89504e470d0a1a0a00000000', 'hex'),
      });
      expect(response.status).toBe(201);
      const { image } = (await response.json()) as { image: { path: string } };
      expect(existsSync(image.path)).toBe(true);
      const db = getDb();
      const originalRemove = discovery.removeDiscoveryFileIfOwned;
      let filesystemError: string | undefined;
      vi.spyOn(discovery, 'removeDiscoveryFileIfOwned').mockImplementationOnce((...args) => {
        const mode = statSync(root).mode & 0o777;
        chmodSync(root, 0o500);
        try {
          return originalRemove(...args);
        } catch (error) {
          filesystemError = (error as NodeJS.ErrnoException).code;
          throw error;
        } finally {
          chmodSync(root, mode);
        }
      });
      const outcome = await handle.stop().then(
        () => 'closed',
        () => 'rejected',
      );
      expect(filesystemError).toBe('EACCES');
      expect({
        outcome,
        uploaded: existsSync(image.path),
        dbOpen: db.open,
        lock: existsSync(join(root, 'owner.lock')),
      }).toEqual({ outcome: 'closed', uploaded: false, dbOpen: false, lock: false });
      // Same-process restart proves a released ownership capability, not only removal of a lock file.
      handle = await startHeadlessServe({ dataDir: root, port: 0, log: () => undefined });
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM local_asset_cleanup').get()).toEqual({
        n: 0,
      });
      await handle.stop();
    } finally {
      try {
        await handle?.stop();
      } catch {
        /* Test records the original outcome above. */
      }
      closeDesignSchemeDb();
      closeDb();
      chmodSync(root, 0o700);
      rmSync(root, { recursive: true, force: true });
    }
  },
);
