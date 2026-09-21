import { filesystem } from './managed-fs-fixture';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DesignSchemePackageFormatVersion } from '@musefold/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_DESIGN_SCHEME_PACKAGE_BYTES } from '../package-archive';
import { DesignSchemePackageStaging } from '../package-staging';

const tempRoots: string[] = [];
const acceptedFormatVersions: DesignSchemePackageFormatVersion[] = [1, 2];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'musefold-package-staging-'));
  tempRoots.push(root);
  return root;
}

function stagingWithInspector(
  rootDir: string,
  formatVersion: DesignSchemePackageFormatVersion = 2,
) {
  const inspectPackage = vi.fn(async () => ({ formatVersion }));
  return {
    staging: new DesignSchemePackageStaging({ filesystem, rootDir, inspectPackage }),
    inspectPackage,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('DesignSchemePackageStaging', () => {
  it('copies and hashes a regular file, binds it to one owner, and consumes it once', async () => {
    const root = tempRoot();
    const source = join(root, 'source.musefold.design');
    const bytes = Buffer.from('validated-package', 'utf8');
    writeFileSync(source, bytes);
    const stagingRoot = join(root, 'staging');
    const { staging, inspectPackage } = stagingWithInspector(stagingRoot);

    const staged = await staging.stagePickedPackage(11, source, { acceptedFormatVersions });
    const stagedPath = join(stagingRoot, '11', staged.stagedPackageId, 'package.musefold.design');
    expect(staged).toMatchObject({
      status: 'staged',
      packageHash: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.byteLength,
      formatVersion: 2,
    });
    expect(inspectPackage).toHaveBeenCalledWith(stagedPath, acceptedFormatVersions);
    expect(readFileSync(stagedPath)).toEqual(bytes);

    await expect(staging.consume(12, staged, async () => 'stolen')).rejects.toThrow(
      '不属于当前 renderer',
    );
    expect(existsSync(stagedPath)).toBe(true);

    let consumedPath = '';
    await expect(
      staging.consume(11, staged, async (path) => {
        consumedPath = path;
        expect(path).not.toBe(stagedPath);
        expect(path).toContain('verify-');
        return readFileSync(path, 'utf8');
      }),
    ).resolves.toBe('validated-package');
    expect(existsSync(consumedPath)).toBe(false);
    expect(existsSync(join(stagingRoot, '11', staged.stagedPackageId))).toBe(false);
    await expect(staging.consume(11, staged, async () => 'again')).rejects.toThrow(
      '暂存分享包不存在',
    );
  });

  it('rejects metadata mismatch and tampering, then removes the terminal stage', async () => {
    const root = tempRoot();
    const source = join(root, 'source.musefold.design');
    writeFileSync(source, 'validated-package');
    const stagingRoot = join(root, 'staging');
    const { staging } = stagingWithInspector(stagingRoot);

    const mismatch = await staging.stagePickedPackage(21, source, { acceptedFormatVersions });
    await expect(
      staging.consume(21, { ...mismatch, packageHash: 'a'.repeat(64) }, async () => 'bad'),
    ).rejects.toThrow('元数据不匹配');
    expect(existsSync(join(stagingRoot, '21', mismatch.stagedPackageId))).toBe(false);

    const tampered = await staging.stagePickedPackage(21, source, { acceptedFormatVersions });
    const tamperedPath = join(
      stagingRoot,
      '21',
      tampered.stagedPackageId,
      'package.musefold.design',
    );
    appendFileSync(tamperedPath, '-changed');
    await expect(staging.consume(21, tampered, async () => 'bad')).rejects.toThrow(
      '导入前发生变化',
    );
    expect(existsSync(join(stagingRoot, '21', tampered.stagedPackageId))).toBe(false);
  });

  it('cleans the stage when the consumer fails and when the owner is replaced', async () => {
    const root = tempRoot();
    const source = join(root, 'source.musefold.design');
    writeFileSync(source, 'validated-package');
    const stagingRoot = join(root, 'staging');
    const { staging } = stagingWithInspector(stagingRoot);

    const first = await staging.stagePickedPackage(31, source, { acceptedFormatVersions });
    const firstPath = join(stagingRoot, '31', first.stagedPackageId);
    const second = await staging.stagePickedPackage(31, source, { acceptedFormatVersions });
    expect(existsSync(firstPath)).toBe(false);

    await expect(
      staging.consume(31, second, async () => {
        throw new Error('database rejected import');
      }),
    ).rejects.toThrow('database rejected import');
    expect(existsSync(join(stagingRoot, '31', second.stagedPackageId))).toBe(false);
  });

  it('cleans one owner independently and removes all stages on shutdown', async () => {
    const root = tempRoot();
    const source = join(root, 'source.musefold.design');
    writeFileSync(source, 'validated-package');
    const stagingRoot = join(root, 'staging');
    const { staging } = stagingWithInspector(stagingRoot);

    const first = await staging.stagePickedPackage(51, source, { acceptedFormatVersions });
    const second = await staging.stagePickedPackage(52, source, { acceptedFormatVersions });
    staging.cleanupOwner(51);
    expect(existsSync(join(stagingRoot, '51'))).toBe(false);
    expect(existsSync(join(stagingRoot, '52', second.stagedPackageId))).toBe(true);
    await expect(staging.consume(51, first, async () => 'missing')).rejects.toThrow(
      '暂存分享包不存在',
    );

    staging.cleanupAll();
    expect(existsSync(stagingRoot)).toBe(false);
    await expect(staging.consume(52, second, async () => 'missing')).rejects.toThrow(
      '暂存分享包不存在',
    );
  });

  it('rejects symlink, empty, oversized, and invalid-owner sources before staging', async () => {
    const root = tempRoot();
    const stagingRoot = join(root, 'staging');
    const { staging, inspectPackage } = stagingWithInspector(stagingRoot);
    const regular = join(root, 'regular.musefold.design');
    const linked = join(root, 'linked.musefold.design');
    const empty = join(root, 'empty.musefold.design');
    const oversized = join(root, 'oversized.musefold.design');
    writeFileSync(regular, 'package');
    symlinkSync(regular, linked);
    writeFileSync(empty, '');
    writeFileSync(oversized, 'x');
    truncateSync(oversized, MAX_DESIGN_SCHEME_PACKAGE_BYTES + 1);

    await expect(
      staging.stagePickedPackage(41, linked, { acceptedFormatVersions }),
    ).rejects.toThrow('不是普通文件');
    await expect(staging.stagePickedPackage(41, empty, { acceptedFormatVersions })).rejects.toThrow(
      '不是普通文件',
    );
    await expect(
      staging.stagePickedPackage(41, oversized, { acceptedFormatVersions }),
    ).rejects.toThrow('超过大小上限');
    await expect(
      staging.stagePickedPackage(0, regular, { acceptedFormatVersions }),
    ).rejects.toThrow('无效的 renderer 所有者');
    expect(inspectPackage).not.toHaveBeenCalled();
    expect(existsSync(stagingRoot)).toBe(false);
  });
});

describe('DesignSchemePackageStaging concurrent consume', () => {
  it('deduplicates concurrent and delayed consumes into one import callback with one shared result', async () => {
    const root = tempRoot();
    const source = join(root, 'source.musefold.design');
    writeFileSync(source, 'validated-package');
    const stagingRoot = join(root, 'staging');
    const { staging } = stagingWithInspector(stagingRoot);

    const staged = await staging.stagePickedPackage(61, source, { acceptedFormatVersions });
    const stageDir = join(stagingRoot, '61', staged.stagedPackageId);

    const started = deferred();
    const release = deferred();
    let invocations = 0;
    const importCallback = vi.fn(async () => {
      invocations += 1;
      started.resolve();
      await release.promise;
      return `imported-${invocations}`;
    });

    // 背靠背发起,中间没有任何 await:第一个 consume 挂起在复制阶段时,
    // 后续 consume 必须命中在途条目,而不是各自再启动一次导入。
    const first = staging.consume(61, staged, importCallback);
    const concurrent = staging.consume(61, staged, importCallback);
    await started.promise;
    // 迟到的并发消费者(导入回调已在途挂起)同样必须共享同一次导入。
    const late = staging.consume(61, staged, importCallback);
    // 留出时间窗口,证明假想的第二次复制/导入不会发生。
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(importCallback).toHaveBeenCalledTimes(1);
    expect(existsSync(stageDir)).toBe(true);
    expect(readdirSync(stageDir).some((name) => name.startsWith('verify-'))).toBe(true);

    release.resolve();
    await expect(first).resolves.toBe('imported-1');
    await expect(concurrent).resolves.toBe('imported-1');
    await expect(late).resolves.toBe('imported-1');
    expect(importCallback).toHaveBeenCalledTimes(1);
    expect(existsSync(stageDir)).toBe(false);
    await expect(staging.consume(61, staged, importCallback)).rejects.toThrow('暂存分享包不存在');
  });

  it('validates owner and metadata on the shared in-flight path without disturbing the import', async () => {
    const root = tempRoot();
    const source = join(root, 'source.musefold.design');
    writeFileSync(source, 'validated-package');
    const stagingRoot = join(root, 'staging');
    const { staging } = stagingWithInspector(stagingRoot);

    const staged = await staging.stagePickedPackage(62, source, { acceptedFormatVersions });
    const stageDir = join(stagingRoot, '62', staged.stagedPackageId);
    const started = deferred();
    const release = deferred();
    const importCallback = vi.fn(async () => {
      started.resolve();
      await release.promise;
      return 'imported';
    });

    const inFlight = staging.consume(62, staged, importCallback);
    await started.promise;

    await expect(staging.consume(99, staged, importCallback)).rejects.toThrow(
      '不属于当前 renderer',
    );
    await expect(
      staging.consume(62, { ...staged, packageHash: 'a'.repeat(64) }, importCallback),
    ).rejects.toThrow('元数据不匹配');
    // 重复消费者的拒绝不得清理或在途导入外触发放大。
    expect(existsSync(stageDir)).toBe(true);

    release.resolve();
    await expect(inFlight).resolves.toBe('imported');
    expect(importCallback).toHaveBeenCalledTimes(1);
    expect(existsSync(stageDir)).toBe(false);
  });

  it('keeps terminal state consistent when sender cleanup or shutdown races an in-flight consume', async () => {
    const root = tempRoot();
    const source = join(root, 'source.musefold.design');
    writeFileSync(source, 'validated-package');
    const stagingRoot = join(root, 'staging');
    const { staging } = stagingWithInspector(stagingRoot);

    // 场景一:sender destroyed -> cleanupOwner 与在途导入并发。
    const firstStage = await staging.stagePickedPackage(63, source, { acceptedFormatVersions });
    const firstStarted = deferred();
    const firstRelease = deferred();
    const firstCallback = vi.fn(async () => {
      firstStarted.resolve();
      await firstRelease.promise;
      return 'first-import';
    });
    const firstFlight = staging.consume(63, firstStage, firstCallback);
    await firstStarted.promise;

    staging.cleanupOwner(63);
    // 清理之后到达的重复消费者拿到确定性的「不存在」,不再共享在途导入。
    await expect(staging.consume(63, firstStage, firstCallback)).rejects.toThrow(
      '暂存分享包不存在',
    );
    firstRelease.resolve();
    await expect(firstFlight).resolves.toBe('first-import');
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(existsSync(join(stagingRoot, '63'))).toBe(false);

    // 场景二:shutdown -> cleanupAll 与在途导入并发。
    const secondStage = await staging.stagePickedPackage(63, source, { acceptedFormatVersions });
    const secondStarted = deferred();
    const secondRelease = deferred();
    const secondCallback = vi.fn(async () => {
      secondStarted.resolve();
      await secondRelease.promise;
      return 'second-import';
    });
    const secondFlight = staging.consume(63, secondStage, secondCallback);
    await secondStarted.promise;

    staging.cleanupAll();
    await expect(staging.consume(63, secondStage, secondCallback)).rejects.toThrow(
      '暂存分享包不存在',
    );
    secondRelease.resolve();
    await expect(secondFlight).resolves.toBe('second-import');
    expect(secondCallback).toHaveBeenCalledTimes(1);
    expect(existsSync(stagingRoot)).toBe(false);
    await expect(staging.consume(63, secondStage, secondCallback)).rejects.toThrow(
      '暂存分享包不存在',
    );
  });

  it('propagates one import failure to every shared consumer and reaches terminal state', async () => {
    const root = tempRoot();
    const source = join(root, 'source.musefold.design');
    writeFileSync(source, 'validated-package');
    const stagingRoot = join(root, 'staging');
    const { staging } = stagingWithInspector(stagingRoot);

    const staged = await staging.stagePickedPackage(64, source, { acceptedFormatVersions });
    const stageDir = join(stagingRoot, '64', staged.stagedPackageId);
    const importCallback = vi.fn(async () => {
      throw new Error('database rejected import');
    });

    const first = staging.consume(64, staged, importCallback);
    const duplicate = staging.consume(64, staged, importCallback);
    await expect(first).rejects.toThrow('database rejected import');
    await expect(duplicate).rejects.toThrow('database rejected import');
    expect(importCallback).toHaveBeenCalledTimes(1);
    expect(existsSync(stageDir)).toBe(false);
    await expect(staging.consume(64, staged, importCallback)).rejects.toThrow('暂存分享包不存在');
  });
});
