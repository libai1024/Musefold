import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { loadManagedFilesystem, type ManagedFilesystem } from '@musefold/managed-fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LOCAL_UPLOAD_TTL_MS } from '../../constants';
import { closeDb, getDb } from '../../db';
import { closeDesignSchemeDb } from '../../db/design-scheme';
import { stageLocalImageBytes } from '../../providers/local-image';
import { configureTestCoreRuntime } from '../../testing';
import { drainLocalAssetCleanup } from '../local-asset-cleanup';
import {
  createLocalUploadOwner,
  expireLocalUploadHolds,
  reclaimLocalAssets,
  type LocalUploadOwner,
} from '../local-upload-owner';

const native = loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node'));
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
let root: string;
let filesystem: ManagedFilesystem;
let owners: LocalUploadOwner[];
const queue = () =>
  getDb().prepare('SELECT * FROM local_asset_cleanup ORDER BY path').all() as Array<{
    path: string;
    state: string;
    last_error: string | null;
  }>;
const due = () =>
  (
    getDb().prepare('SELECT MAX(next_attempt_at) AS n FROM local_asset_cleanup').get() as {
      n: number;
    }
  ).n;
const upload = (owner: LocalUploadOwner, bytes = png) =>
  stageLocalImageBytes({ name: 'ttl.png', bytes }, owner);
function owner() {
  const result = createLocalUploadOwner();
  owners.push(result);
  return result;
}
/** TTL 判定用获取时刻；用真实 now 平移模拟未来，不伪造持有时刻。 */
const agedNow = (at: number) => at + LOCAL_UPLOAD_TTL_MS + 1;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'musefold-upload-ttl-')));
  filesystem = Object.fromEntries(
    Object.getOwnPropertyNames(native).map((name) => [name, Reflect.get(native, name)]),
  ) as unknown as ManagedFilesystem;
  configureTestCoreRuntime(root, { managedFilesystem: () => filesystem });
  owners = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const entry of owners) entry.close();
  closeDesignSchemeDb();
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

it('deletes an upload that never entered a request once its hold ages past the TTL', async () => {
  const lifetime = owner();
  const image = await upload(lifetime);
  expect(fs.existsSync(image.path)).toBe(true);
  expect(expireLocalUploadHolds(agedNow(Date.now()))).toBe(1);
  expect(fs.existsSync(image.path)).toBe(false);
  expect(queue()).toEqual([]);
  // 已关闭的 owner 不再参与期限回收。
  lifetime.close();
  expect(expireLocalUploadHolds(agedNow(Date.now()))).toBe(0);
});

it('reclaims an aged upload through the periodic host entry while a fresh one stays held', async () => {
  const lifetime = owner();
  const first = await upload(lifetime);
  expect(reclaimLocalAssets(Date.now())).toBeUndefined();
  expect(fs.existsSync(first.path)).toBe(true);
  expect(reclaimLocalAssets(agedNow(Date.now()))).toBeUndefined();
  expect(fs.existsSync(first.path)).toBe(false);
  // aged 时钟之后新上传的持有不受影响。
  const second = await upload(lifetime);
  expect(reclaimLocalAssets(Date.now())).toBeUndefined();
  expect(fs.readFileSync(second.path)).toEqual(png);
  expect(queue()).toEqual([expect.objectContaining({ path: fs.realpathSync(second.path) })]);
});

it('keeps a terminal request upload after release when a frozen reference survives', async () => {
  const { AutomationSpendRepository } = await import('../../db/repositories/automation-spend');
  const lifetime = owner();
  const image = await upload(lifetime);
  const spend = new AutomationSpendRepository(getDb());
  const now = Date.now();
  const frozen = {
    body: { prompt: 'TTL', referenceImagePaths: [image.path] },
    providerId: 'ttl-provider',
    model: 'ttl-model',
    references: [{ path: image.path, source: 'upload' }],
    referenceHashes: ['0'.repeat(64)],
  };
  const register = (key: string) => {
    spend.initializeBudget(
      { monthlyLimitPoints: 0, usedPoints: 0, month: new Date(now).toISOString().slice(0, 7) },
      now,
    );
    return spend.register({
      idempotencyKey: key,
      action: 'generate_image',
      caller: 'local-automation',
      input: { prompt: 'TTL', referenceImagePaths: [image.path] },
      frozenInput: frozen,
      bindings: [
        {
          providerId: 'ttl-provider',
          providerType: 'openai-compatible',
          model: 'ttl-model',
          baseUrl: 'http://127.0.0.1:12345/v1',
          credentialEpoch: 'ttl-epoch',
          payerKind: 'external',
          ownerId: null,
          issuer: null,
          policy: 'external',
        },
      ],
      promptText: 'TTL',
      executionId: key,
      maxImageCalls: 1,
      maxTextCalls: 0,
      estimatedPoints: 5,
      now,
    }).request;
  };
  const first = register('ttl-first');
  const second = register('ttl-second');
  // external 绑定注册即 authorized；直接终态化其一。
  expect(first.state).toBe('authorized');
  spend.finishRequest(first.id, 'cancelled', now + 2);
  expect(spend.get(first.id)?.state).toBe('terminal');
  // 终态释放只归还持有；两个冻结快照仍保护该文件。
  expect(expireLocalUploadHolds(agedNow(Date.now()))).toBe(1);
  expect(fs.readFileSync(image.path)).toEqual(png);
  expect(queue()).toEqual([expect.objectContaining({ last_error: 'referenced' })]);
  getDb().prepare('DELETE FROM automation_spend_requests WHERE id=?').run(second.id);
  expect(drainLocalAssetCleanup(due())).toMatchObject({ protected: 1, deleted: 0 });
  expect(fs.readFileSync(image.path)).toEqual(png);
  getDb().prepare('DELETE FROM automation_spend_requests WHERE id=?').run(first.id);
  expect(drainLocalAssetCleanup(due())).toMatchObject({ deleted: 1 });
  expect(fs.existsSync(image.path)).toBe(false);
  expect(queue()).toEqual([]);
});

it('treats release as idempotent for repeats, unknown paths and directory aliases', async () => {
  const lifetime = owner();
  const image = await upload(lifetime);
  const unknown = join(root, 'never-held.png');
  lifetime.release([unknown]);
  lifetime.release([image.path]);
  lifetime.release([image.path, unknown]);
  expect(fs.existsSync(image.path)).toBe(false);
  expect(queue()).toEqual([]);
  expect(() => lifetime.release([])).not.toThrow();
});

it.skipIf(process.platform === 'win32')(
  'releases through a directory alias that resolves to the canonical hold',
  async () => {
    const lifetime = owner();
    const image = await upload(lifetime);
    // 自建别名链与 macOS /var ↔ /private/var 系统别名走同一条 realpath 回退，
    // 但不依赖系统把临时目录放在 /private/var 下（turbo 任务可能剥离 TMPDIR）。
    const aliasLink = join(root, 'alias-link');
    fs.symlinkSync(dirname(dirname(image.path)), aliasLink, 'dir');
    const alias = join(aliasLink, 'uploads', basename(image.path));
    expect(alias).not.toBe(image.path);
    lifetime.release([alias]);
    expect(fs.existsSync(image.path)).toBe(false);
    expect(queue()).toEqual([]);
  },
);

it('expires only at the TTL boundary and lets a just-frozen reference win over expiry', async () => {
  const { AutomationSpendRepository } = await import('../../db/repositories/automation-spend');
  const lifetime = owner();
  const image = await upload(lifetime);
  const after = Date.now();
  // 年龄 TTL-1s：未到期。
  expect(expireLocalUploadHolds(after + LOCAL_UPLOAD_TTL_MS - 1000)).toBe(0);
  expect(fs.existsSync(image.path)).toBe(true);
  // 到期瞬间刚被一个新请求冻结引用：降级后 drain 仍按引用谓词保留。
  const now = after + 1;
  const spend = new AutomationSpendRepository(getDb());
  spend.initializeBudget(
    { monthlyLimitPoints: 0, usedPoints: 0, month: new Date(now).toISOString().slice(0, 7) },
    now,
  );
  spend.register({
    idempotencyKey: 'ttl-fresh',
    action: 'generate_image',
    caller: 'local-automation',
    input: { prompt: 'TTL', referenceImagePaths: [image.path] },
    frozenInput: {
      body: { prompt: 'TTL', referenceImagePaths: [image.path] },
      providerId: 'ttl-provider',
      model: 'ttl-model',
      references: [{ path: image.path, source: 'upload' }],
      referenceHashes: ['0'.repeat(64)],
    },
    bindings: [
      {
        providerId: 'ttl-provider',
        providerType: 'openai-compatible',
        model: 'ttl-model',
        baseUrl: 'http://127.0.0.1:12345/v1',
        credentialEpoch: 'ttl-epoch',
        payerKind: 'external',
        ownerId: null,
        issuer: null,
        policy: 'external',
      },
    ],
    promptText: 'TTL',
    executionId: 'ttl-fresh',
    maxImageCalls: 1,
    maxTextCalls: 0,
    estimatedPoints: 5,
    now,
  });
  expect(expireLocalUploadHolds(after + LOCAL_UPLOAD_TTL_MS)).toBe(1);
  expect(fs.readFileSync(image.path)).toEqual(png);
  expect(queue()).toEqual([expect.objectContaining({ last_error: 'referenced' })]);
});

it('recovers TTL state after a crash reopen: leases are gone and rows decide', async () => {
  const { AutomationSpendRepository } = await import('../../db/repositories/automation-spend');
  const lifetime = owner();
  const unreferenced = await upload(lifetime);
  const referenced = await upload(lifetime);
  const now = Date.now();
  const spend = new AutomationSpendRepository(getDb());
  spend.initializeBudget(
    { monthlyLimitPoints: 0, usedPoints: 0, month: new Date(now).toISOString().slice(0, 7) },
    now,
  );
  spend.register({
    idempotencyKey: 'ttl-crash',
    action: 'generate_image',
    caller: 'local-automation',
    input: { prompt: 'TTL', referenceImagePaths: [referenced.path] },
    frozenInput: {
      body: { prompt: 'TTL', referenceImagePaths: [referenced.path] },
      providerId: 'ttl-provider',
      model: 'ttl-model',
      references: [{ path: referenced.path, source: 'upload' }],
      referenceHashes: ['0'.repeat(64)],
    },
    bindings: [
      {
        providerId: 'ttl-provider',
        providerType: 'openai-compatible',
        model: 'ttl-model',
        baseUrl: 'http://127.0.0.1:12345/v1',
        credentialEpoch: 'ttl-epoch',
        payerKind: 'external',
        ownerId: null,
        issuer: null,
        policy: 'external',
      },
    ],
    promptText: 'TTL',
    executionId: 'ttl-crash',
    maxImageCalls: 1,
    maxTextCalls: 0,
    estimatedPoints: 5,
    now,
  });
  // 模拟进程死亡：不 close owner，仅重开两库；内存租约随进程消失，行内状态接管。
  closeDesignSchemeDb();
  closeDb();
  expect(drainLocalAssetCleanup(due())).toMatchObject({ deleted: 1, protected: 1, failed: 0 });
  expect(fs.existsSync(unreferenced.path)).toBe(false);
  expect(fs.readFileSync(referenced.path)).toEqual(png);
  expect(queue()).toEqual([expect.objectContaining({ last_error: 'referenced' })]);
});

it('blocks a replaced file after a crash reopen instead of deleting the replacement', async () => {
  const lifetime = owner();
  const image = await upload(lifetime);
  const replacement = Buffer.concat([png, Buffer.from('replacement bytes')]);
  closeDesignSchemeDb();
  closeDb();
  // 崩溃后候选行仍在；同路径出现不同 device/inode 的新文件。
  const staged = `${image.path}.next`;
  fs.writeFileSync(staged, replacement);
  fs.renameSync(staged, image.path);
  expect(drainLocalAssetCleanup(due())).toMatchObject({ blocked: 1, deleted: 0 });
  expect(fs.readFileSync(image.path)).toEqual(replacement);
  expect(queue()).toEqual([
    expect.objectContaining({ state: 'blocked', last_error: 'file_identity_changed' }),
  ]);
});

it('drops the durable row when a TTL candidate went missing before a crash reopen', async () => {
  const lifetime = owner();
  const image = await upload(lifetime);
  closeDesignSchemeDb();
  closeDb();
  fs.rmSync(image.path);
  expect(drainLocalAssetCleanup(due())).toMatchObject({ missing: 1, deleted: 0 });
  expect(queue()).toEqual([]);
});
