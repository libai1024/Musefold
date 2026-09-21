import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DirectoryHandle, ManagedFilesystem } from '@musefold/managed-fs';

const unsafe = () => new Error('暂存目录身份发生变化或不是安全的受管目录');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** All IO below the trusted parent is relative to pinned native directory handles. */
export class PackageStagingDirectory {
  readonly root: string;
  private anchor = '';
  private canonicalAnchor = '';
  private readonly directories = new Map<string, { handle: DirectoryHandle; identity: string }>();
  private invalid = false;

  constructor(
    rootDir: string,
    private readonly filesystem: ManagedFilesystem,
    trustedParentDir?: string,
  ) {
    this.root = resolve(rootDir);
    try {
      this.anchor = resolve(trustedParentDir ?? dirname(this.root));
      if (!trustedParentDir) {
        while (!lstatSync(this.anchor, { throwIfNoEntry: false }))
          this.anchor = dirname(this.anchor);
      }
      const suffix = relative(this.anchor, this.root);
      if (!suffix || suffix.startsWith(`..${sep}`) || suffix === '..' || isAbsolute(suffix))
        throw unsafe();
      this.canonicalAnchor = realpathSync(this.anchor);
      const stat = lstatSync(this.canonicalAnchor, { bigint: true });
      const identity = `${stat.dev}:${stat.ino}`;
      const handle = filesystem.openRoot(this.canonicalAnchor, identity);
      this.directories.set(this.anchor, { handle, identity });
      this.walk(this.root, false);
    } catch {
      this.invalid = true;
    }
  }

  private walk(path: string, create: boolean): boolean {
    if (this.invalid || realpathSync(this.anchor) !== this.canonicalAnchor) throw unsafe();
    const anchor = this.directories.get(this.anchor);
    if (!anchor) throw unsafe();
    // Revalidate the externally named trust anchor; all subsequent operations use handles.
    const currentAnchor = this.filesystem.openRoot(this.canonicalAnchor, anchor.identity);
    this.filesystem.close(currentAnchor);
    const target = resolve(path);
    const rootSuffix = relative(this.root, target);
    if (rootSuffix === '..' || rootSuffix.startsWith(`..${sep}`) || isAbsolute(rootSuffix))
      throw unsafe();
    let current = this.anchor;
    let parent = anchor.handle;
    for (const part of relative(this.anchor, target).split(sep)) {
      current = join(current, part);
      const prior = this.directories.get(current);
      let opened: DirectoryHandle;
      try {
        opened = this.filesystem.openChild(parent, part, create && !prior);
      } catch (error) {
        if (missing(error) && !create && !prior) return false;
        throw error;
      }
      const identity = this.filesystem.identity(opened);
      if (prior) {
        this.filesystem.close(opened);
        if (identity !== prior.identity) throw unsafe();
        parent = prior.handle;
      } else {
        this.directories.set(current, { handle: opened, identity });
        parent = opened;
      }
    }
    return true;
  }

  private handle(path: string): DirectoryHandle {
    const entry = this.directories.get(resolve(path));
    if (!entry) throw unsafe();
    return entry.handle;
  }

  assert(path: string): void {
    if (!this.walk(path, false)) throw unsafe();
  }

  createStage(ownerId: number, stageId: string): string {
    const path = join(this.root, String(ownerId), stageId);
    this.walk(path, true);
    return path;
  }

  openFile(path: string, mode: 'read' | 'create'): number {
    this.assert(dirname(path));
    return this.filesystem.openFile(this.handle(dirname(path)), basename(path), mode);
  }

  private *entries(path: string) {
    const reader = this.filesystem.openReader(this.handle(path));
    try {
      for (;;) {
        const [entry] = this.filesystem.readReader(reader, 1);
        if (!entry) return;
        yield entry;
      }
    } finally {
      this.filesystem.closeReader(reader);
    }
  }

  removeStage(path: string): void {
    if (!this.walk(path, false)) return;
    let removed = 0;
    for (const entry of this.entries(path)) {
      if (removed === 32) break;
      const name = entry.name;
      if (
        name !== 'package.musefold.design' &&
        !/^verify-[0-9a-f-]{36}\.musefold\.design$/.test(name)
      )
        throw unsafe();
      if (entry.type !== 'file' && entry.type !== 'link') throw unsafe();
      this.assert(path);
      this.filesystem.unlinkFile(this.handle(path), name);
      removed += 1;
    }
    this.removeEmpty(path, true);
  }

  *scanStages(): Generator<{ path: string; id: string; ownerId: number } | null> {
    if (!this.walk(this.root, false)) return;
    for (const owner of this.entries(this.root)) {
      yield null;
      const ownerId = Number(owner.name);
      if (
        !/^[1-9][0-9]*$/.test(owner.name) ||
        !Number.isSafeInteger(ownerId) ||
        owner.type !== 'directory'
      )
        continue;
      const ownerPath = join(this.root, owner.name);
      if (!this.walk(ownerPath, false)) continue;
      for (const stage of this.entries(ownerPath)) {
        if (!this.walk(ownerPath, false)) break;
        if (!/^stage_[0-9a-f]{32}$/.test(stage.name) || stage.type !== 'directory') {
          yield null;
          continue;
        }
        yield { path: join(ownerPath, stage.name), id: stage.name, ownerId };
      }
      if (!this.walk(this.root, false)) return;
    }
  }

  removeEmpty(path: string, requireEmpty = false): void {
    if (!this.walk(path, false)) return;
    try {
      this.filesystem.removeDirectory(this.handle(dirname(path)), basename(path));
      this.filesystem.close(this.handle(path));
      this.directories.delete(resolve(path));
    } catch (error) {
      if (
        requireEmpty ||
        ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY' && !missing(error))
      )
        throw error;
    }
  }

  dispose(): void {
    for (const directory of this.directories.values()) this.filesystem.close(directory.handle);
    this.directories.clear();
    this.invalid = true;
  }
}
