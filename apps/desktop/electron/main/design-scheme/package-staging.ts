import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  createReadStream,
  createWriteStream,
  lstatSync,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  readSync,
} from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import type {
  DesignSchemePackageFormatVersion,
  ImportDesignSchemeInput,
  PrepareDesignSchemeImportPackageInput,
  PrepareDesignSchemeImportPackageResult,
} from '@musefold/contracts';
import {
  type inspectDesignSchemePackage,
  MAX_DESIGN_SCHEME_PACKAGE_BYTES,
} from './package-archive';
import type { ManagedFilesystem } from '@musefold/managed-fs';
import { readValidatedDesignSchemePackageBytes } from '@musefold/scheme-package';
import { PackageStagingDirectory } from './package-staging-directory';

interface StagedPackage {
  id: string;
  ownerId: number;
  path: string;
  packageHash: string;
  sizeBytes: number;
  formatVersion: DesignSchemePackageFormatVersion;
}

/** staged -> consuming 迁移后的在途条目:保留元数据用于校验并发消费者,共享同一次导入。 */
interface ConsumingPackage {
  staged: StagedPackage;
  promise: Promise<unknown>;
  detached: boolean;
}

function metadataMatches(staged: StagedPackage, input: ImportDesignSchemeInput): boolean {
  return (
    staged.packageHash === input.packageHash.toLowerCase().replace(/^sha256:/, '') &&
    staged.formatVersion === input.formatVersion
  );
}

export interface DesignSchemePackageStagingDeps {
  rootDir: string;
  filesystem: ManagedFilesystem;
  trustedParentDir?: string;
  onCleanupFailure?: () => void;
  inspectPackage?: typeof inspectDesignSchemePackage;
}

function validateSource(sourcePath: string) {
  const source = lstatSync(sourcePath);
  if (!source.isFile() || source.isSymbolicLink() || source.size <= 0) {
    throw new Error('选择的分享包不是普通文件');
  }
  if (source.size > MAX_DESIGN_SCHEME_PACKAGE_BYTES) throw new Error('分享包超过大小上限');
  return source;
}

async function copyRegularFileAndHash(
  sourcePath: string,
  targetPath: string,
  assertTarget: () => void,
  openTarget: () => number,
  openSource?: () => number,
): Promise<{ packageHash: string; sizeBytes: number }> {
  const source = validateSource(sourcePath);
  const sourceFd = openSource
    ? openSource()
    : openSync(
        sourcePath,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      );
  let targetFd: number;
  try {
    const opened = fstatSync(sourceFd);
    if (!opened.isFile() || opened.dev !== source.dev || opened.ino !== source.ino) {
      throw new Error('选择的分享包在读取前发生变化');
    }
    assertTarget();
    targetFd = openTarget();
  } catch (error) {
    closeSync(sourceFd);
    throw error;
  }
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
      if (sizeBytes > MAX_DESIGN_SCHEME_PACKAGE_BYTES) {
        callback(new Error('分享包超过大小上限'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  // The streams own the already-open descriptors. No asynchronous path reopening,
  // and pipeline waits for their closure before guarded cleanup can run.
  await pipeline(
    createReadStream(sourcePath, { fd: sourceFd, autoClose: true }),
    hashing,
    createWriteStream(targetPath, { fd: targetFd, autoClose: true }),
  );
  assertTarget();
  return { packageHash: hash.digest('hex'), sizeBytes };
}

/** Windows 整块通道(见 PackageStagingDirectory.wholeFileIo):源在受管根之外,
 *  由 Node 读取(前置/后置 lstat 防换文件,语义对齐流式路径的 fstat 防换),
 *  目标经受管原生句柄排他新建写入。上限与哈希口径与流式路径完全一致。 */
function copyWholeFileAndHash(
  sourcePath: string,
  writeWhole: (bytes: Buffer) => void,
  assertTarget: () => void,
): { packageHash: string; sizeBytes: number } {
  const before = validateSource(sourcePath);
  const bytes = readFileSync(sourcePath);
  const after = lstatSync(sourcePath);
  if (
    !after.isFile() ||
    after.size !== bytes.byteLength ||
    after.size !== before.size ||
    after.dev !== before.dev ||
    after.ino !== before.ino
  ) {
    throw new Error('选择的分享包在读取前发生变化');
  }
  assertTarget();
  writeWhole(bytes);
  return {
    packageHash: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  };
}

export class DesignSchemePackageStaging {
  private readonly byId = new Map<string, StagedPackage>();
  private readonly idsByOwner = new Map<number, Set<string>>();
  private readonly consumingById = new Map<string, ConsumingPackage>();
  private readonly directory: PackageStagingDirectory;
  private readonly preparing = new Map<string, { ownerId: number; cancelled: boolean }>();
  private readonly pendingCleanup = new Set<string>();
  private closed = false;
  private orphanScan: ReturnType<PackageStagingDirectory['scanStages']> | undefined;

  constructor(private readonly deps: DesignSchemePackageStagingDeps) {
    this.directory = new PackageStagingDirectory(
      deps.rootDir,
      deps.filesystem,
      deps.trustedParentDir,
    );
  }

  async stagePickedPackage(
    ownerId: number,
    sourcePath: string,
    input: PrepareDesignSchemeImportPackageInput,
  ): Promise<Extract<PrepareDesignSchemeImportPackageResult, { status: 'staged' }>> {
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error('无效的 renderer 所有者');
    if (this.closed) throw new Error('暂存服务已关闭');
    validateSource(sourcePath);
    this.cleanupOwner(ownerId);
    const id = `stage_${randomUUID().replaceAll('-', '')}`;
    const stageDir = this.directory.createStage(ownerId, id);
    const preparing = { ownerId, cancelled: false };
    this.preparing.set(id, preparing);
    const packagePath = join(stageDir, 'package.musefold.design');
    try {
      const copied = this.directory.wholeFileIo
        ? copyWholeFileAndHash(
            sourcePath,
            (bytes) => this.directory.writeWholeFile(packagePath, bytes),
            () => this.directory.assert(stageDir),
          )
        : await copyRegularFileAndHash(
            sourcePath,
            packagePath,
            () => this.directory.assert(stageDir),
            () => this.directory.openFile(packagePath, 'create'),
          );
      const inspected = this.deps.inspectPackage
        ? await this.deps.inspectPackage(packagePath, input.acceptedFormatVersions)
        : await readValidatedDesignSchemePackageBytes(
            this.readPackageBytes(packagePath),
            input.acceptedFormatVersions,
          );
      this.directory.assert(stageDir);
      if (preparing.cancelled || this.closed) throw new Error('暂存分享包已取消');
      const staged: StagedPackage = {
        id,
        ownerId,
        path: packagePath,
        packageHash: copied.packageHash,
        sizeBytes: copied.sizeBytes,
        formatVersion: inspected.formatVersion,
      };
      this.byId.set(id, staged);
      this.ownerIds(ownerId).add(id);
      return {
        status: 'staged',
        stagedPackageId: id,
        packageHash: copied.packageHash,
        sizeBytes: copied.sizeBytes,
        formatVersion: inspected.formatVersion,
      };
    } catch (error) {
      this.removeStage(stageDir);
      throw error;
    } finally {
      this.preparing.delete(id);
      this.prune(ownerId);
    }
  }

  async consume<T>(
    ownerId: number,
    input: ImportDesignSchemeInput,
    consumePackage: (packagePath: string, bytes: Buffer) => Promise<T>,
  ): Promise<T> {
    const staged = this.byId.get(input.stagedPackageId);
    if (staged) {
      this.assertOwner(staged, ownerId);
      if (!metadataMatches(staged, input)) {
        // 元数据不匹配即终态:立即移除暂存,与单消费者时代的行为一致。
        this.cleanupStage(staged.id);
        throw new Error('暂存分享包元数据不匹配');
      }
      return this.beginConsume(staged, consumePackage) as Promise<T>;
    }
    // beginConsume 在首个 await 之前同步完成 staged -> consuming 迁移,并发到达的
    // 同 id consume 只会命中下面的在途分支,不可能再次启动导入回调。
    const consuming = this.consumingById.get(input.stagedPackageId);
    if (consuming && !consuming.detached) {
      this.assertOwner(consuming.staged, ownerId);
      if (!metadataMatches(consuming.staged, input)) {
        // 在途导入不受元数据不匹配的重复消费者影响,由它自己的 finally 收尾。
        throw new Error('暂存分享包元数据不匹配');
      }
      return consuming.promise as Promise<T>;
    }
    throw new Error('暂存分享包不存在或不属于当前 renderer');
  }

  cleanupOwner(ownerId: number): void {
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0) return;
    for (const preparing of this.preparing.values()) {
      if (preparing.ownerId === ownerId) preparing.cancelled = true;
    }
    for (const id of [...(this.idsByOwner.get(ownerId) ?? [])]) this.cleanupStage(id);
    for (const consuming of this.consumingById.values()) {
      if (consuming.staged.ownerId === ownerId) consuming.detached = true;
    }
    this.idsByOwner.delete(ownerId);
    this.retryCleanup();
    this.prune(ownerId);
  }

  cleanupAll(): void {
    this.closed = true;
    this.orphanScan?.return(undefined);
    this.orphanScan = undefined;
    const owners = new Set([
      ...this.idsByOwner.keys(),
      ...[...this.preparing.values()].map((item) => item.ownerId),
      ...[...this.consumingById.values()].map((item) => item.staged.ownerId),
    ]);
    for (const owner of owners) this.cleanupOwner(owner);
    this.retryCleanup();
    this.prune();
  }

  /** Called only by the desktop process holding the application owner lock.
   * Disk directories are the durable cleanup intent; failures stay discoverable.
   * Never expire an active preparation, preview or consumer by wall-clock age.
   */
  collectOrphans() {
    const result = {
      scanned: 0,
      deleted: 0,
      protected: 0,
      failed: 0,
      pending: this.pendingCleanup.size,
    };
    if (this.closed) return result;
    this.orphanScan ??= this.directory.scanStages();
    try {
      while (result.scanned < 20) {
        const next = this.orphanScan.next();
        if (next.done) {
          this.orphanScan = undefined;
          break;
        }
        result.scanned += 1;
        if (!next.value) continue;
        const { id, path, ownerId } = next.value;
        if (this.byId.has(id) || this.preparing.has(id) || this.consumingById.has(id)) {
          result.protected += 1;
          continue;
        }
        if (this.removeStage(path)) result.deleted += 1;
        else result.failed += 1;
        this.prune(ownerId);
      }
    } catch {
      result.failed += 1;
      this.orphanScan?.return(undefined);
      this.orphanScan = undefined;
      this.deps.onCleanupFailure?.();
    }
    result.pending = this.pendingCleanup.size;
    return result;
  }

  private removeStage(path: string): boolean {
    try {
      this.directory.removeStage(path);
      this.pendingCleanup.delete(path);
      return true;
    } catch {
      this.pendingCleanup.add(path);
      this.deps.onCleanupFailure?.();
      return false;
    }
  }

  private retryCleanup(): void {
    for (const path of [...this.pendingCleanup].slice(0, 20)) this.removeStage(path);
  }

  private prune(ownerId?: number): void {
    try {
      if (ownerId !== undefined)
        this.directory.removeEmpty(join(this.directory.root, String(ownerId)));
      if (this.closed || (!this.byId.size && !this.preparing.size && !this.consumingById.size)) {
        this.directory.removeEmpty(this.directory.root);
      }
    } catch {
      this.deps.onCleanupFailure?.();
    } finally {
      if (this.closed && !this.byId.size && !this.preparing.size && !this.consumingById.size)
        this.directory.dispose();
    }
  }

  private readPackageBytes(path: string): Buffer {
    if (this.directory.wholeFileIo) {
      const bytes = this.directory.readWholeFile(path, MAX_DESIGN_SCHEME_PACKAGE_BYTES);
      if (bytes.length <= 0) throw new Error('分享包超过大小上限或为空');
      return bytes;
    }
    const fd = this.directory.openFile(path, 'read');
    try {
      const size = fstatSync(fd).size;
      if (size <= 0 || size > MAX_DESIGN_SCHEME_PACKAGE_BYTES)
        throw new Error('分享包超过大小上限或为空');
      const bytes = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const read = readSync(fd, bytes, offset, size - offset, offset);
        if (!read) throw new Error('暂存分享包在读取中发生变化');
        offset += read;
      }
      if (readSync(fd, Buffer.alloc(1), 0, 1, size)) throw new Error('暂存分享包在读取中发生变化');
      return bytes;
    } finally {
      closeSync(fd);
    }
  }

  /** Detach new callers immediately; keep in-flight files until their consumer settles. */
  private beginConsume(
    staged: StagedPackage,
    consumePackage: (packagePath: string, bytes: Buffer) => Promise<unknown>,
  ): Promise<unknown> {
    this.detachStage(staged);
    const promise = (async () => {
      const verifyPath = join(dirname(staged.path), `verify-${randomUUID()}.musefold.design`);
      this.directory.assert(dirname(staged.path));
      const copied = this.directory.wholeFileIo
        ? (() => {
            // Windows 整块通道:受管读源 → 校验哈希 → 受管排他写副本,口径与流式路径一致。
            const bytes = this.readPackageBytes(staged.path);
            this.directory.writeWholeFile(verifyPath, bytes);
            return {
              packageHash: createHash('sha256').update(bytes).digest('hex'),
              sizeBytes: bytes.byteLength,
            };
          })()
        : await copyRegularFileAndHash(
            staged.path,
            verifyPath,
            () => this.directory.assert(dirname(staged.path)),
            () => this.directory.openFile(verifyPath, 'create'),
            () => this.directory.openFile(staged.path, 'read'),
          );
      if (copied.packageHash !== staged.packageHash || copied.sizeBytes !== staged.sizeBytes) {
        throw new Error('暂存分享包在导入前发生变化');
      }
      const bytes = this.readPackageBytes(verifyPath);
      if (createHash('sha256').update(bytes).digest('hex') !== staged.packageHash) {
        throw new Error('暂存分享包在导入前发生变化');
      }
      return consumePackage(verifyPath, bytes);
    })().finally(() => {
      this.consumingById.delete(staged.id);
      this.removeStage(dirname(staged.path));
      this.prune(staged.ownerId);
    });
    this.consumingById.set(staged.id, { staged, promise, detached: false });
    return promise;
  }

  private assertOwner(staged: StagedPackage, ownerId: number): void {
    if (staged.ownerId !== ownerId) throw new Error('暂存分享包不存在或不属于当前 renderer');
  }

  private ownerIds(ownerId: number): Set<string> {
    const existing = this.idsByOwner.get(ownerId);
    if (existing) return existing;
    const ids = new Set<string>();
    this.idsByOwner.set(ownerId, ids);
    return ids;
  }

  private detachStage(staged: StagedPackage): void {
    this.byId.delete(staged.id);
    const ids = this.idsByOwner.get(staged.ownerId);
    ids?.delete(staged.id);
    if (ids?.size === 0) this.idsByOwner.delete(staged.ownerId);
  }

  private cleanupStage(id: string): void {
    const staged = this.byId.get(id);
    if (!staged) return;
    this.detachStage(staged);
    this.removeStage(dirname(staged.path));
  }
}
