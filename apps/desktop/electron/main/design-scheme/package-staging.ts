import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  DesignSchemePackageFormatVersion,
  ImportDesignSchemeInput,
  PrepareDesignSchemeImportPackageInput,
  PrepareDesignSchemeImportPackageResult,
} from '@musefold/contracts';
import { inspectDesignSchemePackage, MAX_DESIGN_SCHEME_PACKAGE_BYTES } from './package-archive';

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
}

function metadataMatches(staged: StagedPackage, input: ImportDesignSchemeInput): boolean {
  return (
    staged.packageHash === input.packageHash.toLowerCase().replace(/^sha256:/, '') &&
    staged.formatVersion === input.formatVersion
  );
}

export interface DesignSchemePackageStagingDeps {
  rootDir: string;
  inspectPackage?: typeof inspectDesignSchemePackage;
}

async function copyRegularFileAndHash(
  sourcePath: string,
  targetPath: string,
): Promise<{ packageHash: string; sizeBytes: number }> {
  const source = lstatSync(sourcePath);
  if (!source.isFile() || source.isSymbolicLink() || source.size <= 0) {
    throw new Error('选择的分享包不是普通文件');
  }
  if (source.size > MAX_DESIGN_SCHEME_PACKAGE_BYTES) throw new Error('分享包超过大小上限');
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });

  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    let sizeBytes = 0;
    let settled = false;
    const input = createReadStream(sourcePath);
    const output = createWriteStream(targetPath, { flags: 'wx', mode: 0o600 });
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      input.destroy();
      output.destroy();
      rmSync(targetPath, { force: true });
      reject(error);
    };
    input.on('data', (chunk: string | Buffer) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      sizeBytes += bytes.length;
      if (sizeBytes > MAX_DESIGN_SCHEME_PACKAGE_BYTES) {
        fail(new Error('分享包超过大小上限'));
        return;
      }
      hash.update(bytes);
    });
    input.on('error', fail);
    output.on('error', fail);
    output.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve({ packageHash: hash.digest('hex'), sizeBytes });
    });
    input.pipe(output);
  });
}

export class DesignSchemePackageStaging {
  private readonly byId = new Map<string, StagedPackage>();
  private readonly idsByOwner = new Map<number, Set<string>>();
  private readonly consumingById = new Map<string, ConsumingPackage>();
  private readonly inspectPackage: typeof inspectDesignSchemePackage;

  constructor(private readonly deps: DesignSchemePackageStagingDeps) {
    this.inspectPackage = deps.inspectPackage ?? inspectDesignSchemePackage;
  }

  async stagePickedPackage(
    ownerId: number,
    sourcePath: string,
    input: PrepareDesignSchemeImportPackageInput,
  ): Promise<Extract<PrepareDesignSchemeImportPackageResult, { status: 'staged' }>> {
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error('无效的 renderer 所有者');
    this.cleanupOwner(ownerId);
    const id = `stage_${randomUUID().replaceAll('-', '')}`;
    const stageDir = join(this.deps.rootDir, String(ownerId), id);
    const packagePath = join(stageDir, 'package.musefold.design');
    try {
      const copied = await copyRegularFileAndHash(sourcePath, packagePath);
      const inspected = await this.inspectPackage(packagePath, input.acceptedFormatVersions);
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
      rmSync(stageDir, { recursive: true, force: true });
      throw error;
    }
  }

  async consume<T>(
    ownerId: number,
    input: ImportDesignSchemeInput,
    consumePackage: (packagePath: string) => Promise<T>,
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
    if (consuming) {
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
    for (const id of [...(this.idsByOwner.get(ownerId) ?? [])]) this.cleanupStage(id);
    for (const [id, consuming] of [...this.consumingById]) {
      if (consuming.staged.ownerId === ownerId) this.consumingById.delete(id);
    }
    rmSync(join(this.deps.rootDir, String(ownerId)), { recursive: true, force: true });
    this.idsByOwner.delete(ownerId);
  }

  cleanupAll(): void {
    this.byId.clear();
    this.idsByOwner.clear();
    this.consumingById.clear();
    rmSync(this.deps.rootDir, { recursive: true, force: true });
  }

  /**
   * 启动唯一一次导入。关键顺序:先同步摘除暂存索引(staged -> consuming),再进入
   * 首个 await;settled 后在 finally 里统一清理在途条目与暂存目录。暂存目录以
   * stageId 命名,与并发 cleanupOwner/cleanupAll 交错时 rmSync(force) 幂等,
   * 也不会误删同 owner 的新暂存。
   */
  private beginConsume(
    staged: StagedPackage,
    consumePackage: (packagePath: string) => Promise<unknown>,
  ): Promise<unknown> {
    this.detachStage(staged);
    const promise = (async () => {
      const verifyPath = join(dirname(staged.path), `verify-${randomUUID()}.musefold.design`);
      const copied = await copyRegularFileAndHash(staged.path, verifyPath);
      if (copied.packageHash !== staged.packageHash || copied.sizeBytes !== staged.sizeBytes) {
        throw new Error('暂存分享包在导入前发生变化');
      }
      return consumePackage(verifyPath);
    })().finally(() => {
      this.consumingById.delete(staged.id);
      rmSync(dirname(staged.path), { recursive: true, force: true });
    });
    this.consumingById.set(staged.id, { staged, promise });
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
    rmSync(dirname(staged.path), { recursive: true, force: true });
  }
}
