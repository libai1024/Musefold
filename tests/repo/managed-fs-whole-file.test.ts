import { existsSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadManagedFilesystem } from '../../packages/managed-fs/src/index';

/**
 * 整块 IO 原语(readWholeFile/writeWholeFile)的跨平台就地测试:
 * Windows 上这是 openFile fd 不可用后的唯一通道,必须真机钉住;
 * Unix 侧同实现,保证两平台语义一致(排他新建、上限、缺失)。
 */
const binary = resolve('packages/managed-fs/build/Release/managed_fs.node');
const roots: string[] = [];

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'mfs-whole-'));
  roots.push(root);
  const stat = lstatSync(root, { bigint: true });
  const filesystem = loadManagedFilesystem(binary);
  const handle = filesystem.openRoot(root, `${stat.dev}:${stat.ino}`);
  return { filesystem, handle };
}

beforeAll(() => {
  expect(existsSync(binary), '先跑 pnpm --filter @musefold/managed-fs run build').toBe(true);
});

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('writeWholeFile → readWholeFile 往返一致(含二进制与空块)', () => {
  const { filesystem, handle } = makeRoot();
  const payload = Buffer.from([0, 255, 16, 32, 64, 128, 1, 2, 3, 4]);
  filesystem.writeWholeFile?.(handle, 'a.bin', payload);
  expect(filesystem.readWholeFile?.(handle, 'a.bin', 1024)?.equals(payload)).toBe(true);
  filesystem.writeWholeFile?.(handle, 'empty.bin', Buffer.alloc(0));
  expect(filesystem.readWholeFile?.(handle, 'empty.bin', 1024)?.length).toBe(0);
});

it('writeWholeFile 排他新建:已存在抛 EEXIST', () => {
  const { filesystem, handle } = makeRoot();
  filesystem.writeWholeFile?.(handle, 'once.bin', Buffer.from('first'));
  try {
    filesystem.writeWholeFile?.(handle, 'once.bin', Buffer.from('second'));
    expect.unreachable('重复写必须失败');
  } catch (error) {
    expect((error as NodeJS.ErrnoException).code).toBe('EEXIST');
  }
  expect(filesystem.readWholeFile?.(handle, 'once.bin', 64)?.toString('utf8')).toBe('first');
});

it('readWholeFile 超过 maxBytes 抛 EFBIG;缺失抛 ENOENT', () => {
  const { filesystem, handle } = makeRoot();
  filesystem.writeWholeFile?.(handle, 'big.bin', Buffer.alloc(64));
  try {
    filesystem.readWholeFile?.(handle, 'big.bin', 32);
    expect.unreachable('超限读取必须失败');
  } catch (error) {
    expect((error as NodeJS.ErrnoException).code).toBe('EFBIG');
  }
  try {
    filesystem.readWholeFile?.(handle, 'missing.bin', 32);
    expect.unreachable('缺失读取必须失败');
  } catch (error) {
    expect((error as NodeJS.ErrnoException).code).toBe('ENOENT');
  }
});

it('大块(>4MiB)跨段写入读回一致', () => {
  const { filesystem, handle } = makeRoot();
  const payload = Buffer.alloc(5 * 1024 * 1024 + 17);
  for (let index = 0; index < payload.length; index += 4096) payload[index] = index & 0xff;
  filesystem.writeWholeFile?.(handle, 'large.bin', payload);
  expect(filesystem.readWholeFile?.(handle, 'large.bin', payload.length + 1)?.equals(payload)).toBe(
    true,
  );
});
