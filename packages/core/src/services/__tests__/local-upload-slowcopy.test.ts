// D02.5 残余：慢复制窗口的 hold/TTL/reclaim 语义实测。
// 真实层：真实 SQLite + 临时目录 + native managed-fs + 真实 stageLocalImage 复制链（原件 → uploads 暂存）。
// 仅对 node:fs 的受管暂存 write 注入逐块延迟与中途干预（与 Electron 暂停 spec 同一挂钩面）：
// 回调转发真实 write 的结果，只推迟其投递并同步触发回收入口，不伪造字节、时间或 IO 结果。

// default import = node:fs 的 CJS 模块对象（可变）；spy 后经 syncBuiltinESMExports 传导到生产 ESM 具名绑定。
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { loadManagedFilesystem, type ManagedFilesystem } from '@musefold/managed-fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LOCAL_UPLOAD_TTL_MS } from '../../constants';
import { closeDb, getDb } from '../../db';
import { closeDesignSchemeDb } from '../../db/design-scheme';
import { stageLocalImage, stageLocalImageBytes } from '../../providers/local-image';
import { configureTestCoreRuntime, testCorePaths } from '../../testing';
import {
  createLocalUploadOwner,
  expireLocalUploadHolds,
  reclaimLocalAssets,
  type LocalUploadOwner,
} from '../local-upload-owner';

const native = loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node'));
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
// 1 MiB 受管复制载荷：PNG 魔数 + 确定性填充（16 个 64 KiB 写块，可测量的复制窗口）。
const payload = Buffer.alloc(1024 * 1024);
payload.set(png.subarray(0, 8), 0);
for (let index = 8; index < payload.length; index += 1) payload[index] = (index * 31 + 7) & 0xff;
type StagedWriteCallback = (
  error: NodeJS.ErrnoException | null,
  written: number,
  buffer: Uint8Array,
) => void;

/** 中途干预：写入字节数达到 atBytes 时，在真实 write 回调内同步触发 run 并记录其观测。 */
interface Fire {
  atBytes: number;
  run: () => unknown;
  ran: boolean;
  observation?: unknown;
}

let root: string;
let original: string;
let originalIdentity: { dev: string; ino: string };
let filesystem: ManagedFilesystem;
let owners: LocalUploadOwner[];
let fires: Fire[];
let failAtWrite: number | null;
let delayMs: number;
let armed = false;
let stagedWrites = 0;
let stagedBytes = 0;

const uploadsDir = () => join(testCorePaths(root).previews, 'uploads');
const listUploads = () =>
  fs
    .readdirSync(uploadsDir())
    .map((name) => join(uploadsDir(), name))
    .filter((path) => fs.statSync(path).isFile());
const queue = () =>
  getDb().prepare('SELECT * FROM local_asset_cleanup ORDER BY path').all() as Array<{
    path: string;
    state: string;
    last_error: string | null;
    next_attempt_at: number;
  }>;
const rowFor = (path: string) =>
  getDb().prepare('SELECT * FROM local_asset_cleanup WHERE path=?').get(path) as
    | { state: string; last_error: string | null; next_attempt_at: number }
    | undefined;
const upload = (owner: LocalUploadOwner, bytes = png) =>
  stageLocalImageBytes({ name: 'slow.png', bytes }, owner);
function owner() {
  const result = createLocalUploadOwner();
  owners.push(result);
  return result;
}
/** TTL 判定用获取时刻；用真实 now 平移模拟未来，不伪造持有时刻。 */
const agedNow = (at: number) => at + LOCAL_UPLOAD_TTL_MS + 1;

/** 只拦截受管暂存写（ armed 且 buffer 与载荷同长同魔数 ），其余 fs.write 原样转发。 */
function armSlowWrite(options: { fires?: Fire[]; failAtWrite?: number; delayMs?: number } = {}) {
  fires = options.fires ?? [];
  failAtWrite = options.failAtWrite ?? null;
  delayMs = options.delayMs ?? 3;
  stagedWrites = 0;
  stagedBytes = 0;
  armed = true;
  const realWrite = fs.write;
  // fs.write 重载含返回 void 的回调形态，直转函数类型不重叠；经 unknown 中转仅用于测试内转发。
  const forwardWrite = realWrite as unknown as (...values: unknown[]) => number;
  vi.spyOn(fs, 'write').mockImplementation(((...args: unknown[]) => {
    const callback = args.at(-1) as StagedWriteCallback | undefined;
    const buffer = args[1];
    const isStaged =
      armed &&
      typeof callback === 'function' &&
      buffer instanceof Uint8Array &&
      buffer.length === payload.length &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50;
    if (!isStaged) return forwardWrite(...args);
    stagedWrites += 1;
    if (failAtWrite !== null && stagedWrites >= failAtWrite) {
      const error = Object.assign(new Error('fixture staged write failure'), { code: 'ENOSPC' });
      setTimeout(() => callback(error, 0, buffer), delayMs);
      return 0;
    }
    return forwardWrite(
      args[0],
      buffer,
      args[2],
      args[3],
      args[4],
      (error: NodeJS.ErrnoException | null, written: number) => {
        if (error) {
          callback(error, written, buffer);
          return;
        }
        stagedBytes += written;
        for (const fire of fires) {
          if (!fire.ran && stagedBytes >= fire.atBytes) {
            fire.ran = true;
            fire.observation = fire.run();
          }
        }
        // 注入延迟把复制窗口拉长到可测量；中途干预发生在真实块写入之后、回调投递之前。
        setTimeout(() => callback(null, written, buffer), delayMs);
      },
    );
  }) as unknown as typeof fs.write);
  syncBuiltinESMExports();
}

function disarmSlowWrite() {
  armed = false;
  vi.restoreAllMocks();
  syncBuiltinESMExports();
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'musefold-upload-slowcopy-')));
  // 原件放在受管 userData 根内：stageLocalImage 会做真实的「原件 → uploads 暂存」受管复制。
  original = join(root, 'original.png');
  fs.writeFileSync(original, payload);
  originalIdentity = (() => {
    const stat = fs.statSync(original, { bigint: true });
    return { dev: String(stat.dev), ino: String(stat.ino) };
  })();
  filesystem = Object.fromEntries(
    Object.getOwnPropertyNames(native).map((name) => [name, Reflect.get(native, name)]),
  ) as unknown as ManagedFilesystem;
  configureTestCoreRuntime(root, { managedFilesystem: () => filesystem });
  owners = [];
});
afterEach(() => {
  disarmSlowWrite();
  vi.restoreAllMocks();
  for (const entry of owners) entry.close();
  closeDesignSchemeDb();
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

it('keeps the in-flight copy alive while TTL expiry reclaims an aged sibling upload', async () => {
  const lifetime = owner();
  const sibling = await upload(lifetime);
  const siblingAt = Date.now();
  const fire: Fire = {
    atBytes: Math.floor(payload.length / 2),
    ran: false,
    run: () => ({
      // 复制中途触发 TTL 到期：只释放早已到期的 sibling 持有，在飞文件尚无持有（获取时才登记）。
      expired: expireLocalUploadHolds(agedNow(siblingAt)),
      uploadsAfterExpiry: listUploads().map((path) => basename(path)),
      partialSizeAfterExpiry: fs.statSync(listUploads()[0]).size,
    }),
  };
  armSlowWrite({ fires: [fire] });
  const startedAt = Date.now();
  const staged = await stageLocalImage(original, lifetime);
  const elapsedMs = Date.now() - startedAt;
  disarmSlowWrite();

  // 复制确实被拉长成多块异步窗口（≥ 8 块、跨注入延迟），中途干预发生在窗口内。
  expect(stagedWrites).toBeGreaterThanOrEqual(8);
  expect(elapsedMs).toBeGreaterThanOrEqual(delayMs * 8);
  expect(fire.ran).toBe(true);
  const observed = fire.observation as {
    expired: number;
    uploadsAfterExpiry: string[];
    partialSizeAfterExpiry: number;
  };
  expect(observed.expired).toBe(1);
  expect(observed.uploadsAfterExpiry).toHaveLength(1);
  expect(observed.partialSizeAfterExpiry).toBeGreaterThan(0);
  expect(observed.partialSizeAfterExpiry).toBeLessThan(payload.length);
  // 到期的 sibling 已删；在飞文件完成后字节完整、行降级为 writing（持有中）。
  expect(fs.existsSync(sibling.path)).toBe(false);
  expect(fs.readFileSync(staged.path)).toEqual(payload);
  expect(rowFor(fs.realpathSync(staged.path))?.last_error).toBe('writing');
  expect(queue()).toHaveLength(1);
  // 原件永不被删、字节与身份不变。
  const after = fs.statSync(original, { bigint: true });
  expect(fs.readFileSync(original)).toEqual(payload);
  expect(String(after.dev)).toBe(originalIdentity.dev);
  expect(String(after.ino)).toBe(originalIdentity.ino);
}, 30000);

it('defers a mid-copy periodic reclaim to the write lease and still reclaims aged siblings', async () => {
  const lifetime = owner();
  const sibling = await upload(lifetime);
  const siblingAt = Date.now();
  const freshReclaim: Fire = {
    atBytes: Math.floor(payload.length / 4),
    ran: false,
    run: () => {
      // 宿主 60s timer 入口在复制中途触发（未到期时钟）：在飞行被活跃写租约保护为 writing。
      reclaimLocalAssets(Date.now());
      const partial = listUploads()
        .map((path) => basename(path))
        .sort();
      return {
        uploadsAfterFreshReclaim: partial,
        rowAfterFreshReclaim: rowFor(fs.realpathSync(listUploads()[0])),
      };
    },
  };
  const agedReclaim: Fire = {
    atBytes: Math.floor((payload.length * 3) / 4),
    ran: false,
    run: () => {
      // 后续到期时钟触发：sibling 被 TTL 回收，在飞文件仍受写租约保护。
      reclaimLocalAssets(agedNow(siblingAt));
      return {
        uploadsAfterAgedReclaim: listUploads().map((path) => basename(path)),
        siblingExists: fs.existsSync(sibling.path),
        rowAfterAgedReclaim: rowFor(fs.realpathSync(listUploads()[0])),
      };
    },
  };
  armSlowWrite({ fires: [freshReclaim, agedReclaim] });
  const staged = await stageLocalImage(original, lifetime);
  disarmSlowWrite();

  expect(freshReclaim.ran).toBe(true);
  const fresh = freshReclaim.observation as {
    uploadsAfterFreshReclaim: string[];
    rowAfterFreshReclaim: { state: string; last_error: string | null };
  };
  // 中途 fresh reclaim：两份文件都在（在飞 + sibling 持有），在飞行被 defer 为 writing。
  expect(fresh.uploadsAfterFreshReclaim).toHaveLength(2);
  expect(fresh.rowAfterFreshReclaim?.last_error).toBe('writing');

  expect(agedReclaim.ran).toBe(true);
  const aged = agedReclaim.observation as {
    uploadsAfterAgedReclaim: string[];
    siblingExists: boolean;
    rowAfterAgedReclaim: { last_error: string | null };
  };
  expect(aged.siblingExists).toBe(false);
  expect(aged.uploadsAfterAgedReclaim).toHaveLength(1);
  expect(aged.rowAfterAgedReclaim?.last_error).toBe('writing');

  // 复制完成：字节完整、队列只剩在持行，原件不变。
  expect(fs.readFileSync(staged.path)).toEqual(payload);
  expect(fs.readFileSync(original)).toEqual(payload);
  expect(rowFor(fs.realpathSync(staged.path))?.last_error).toBe('writing');
  expect(queue()).toHaveLength(1);
  // 复制完成后释放持有（终态语义）即可回收：release 内部 drain 即删除，证明 writing defer 只是延后而非免死。
  lifetime.release([staged.path]);
  expect(fs.existsSync(staged.path)).toBe(false);
  expect(queue()).toEqual([]);
}, 30000);

it('reclaims the partial staged copy after a mid-copy write failure and never touches the original', async () => {
  const lifetime = owner();
  armSlowWrite({ failAtWrite: 6 });
  await expect(stageLocalImage(original, lifetime)).rejects.toMatchObject({
    code: 'IMAGE_READ_FAILED',
  });
  const failedAtWrites = stagedWrites;
  disarmSlowWrite();

  // 失败发生在复制中途（已完成多块写入），残留暂存与持久行都被收尾 drain 回收。
  expect(failedAtWrites).toBeGreaterThanOrEqual(6);
  expect(listUploads()).toEqual([]);
  expect(queue()).toEqual([]);
  // 原件不被删、不被替换：字节与身份不变。
  const after = fs.statSync(original, { bigint: true });
  expect(fs.readFileSync(original)).toEqual(payload);
  expect(String(after.dev)).toBe(originalIdentity.dev);
  expect(String(after.ino)).toBe(originalIdentity.ino);
});
