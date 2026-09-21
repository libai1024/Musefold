import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DirectoryHandle, ManagedFilesystem } from '@musefold/managed-fs';

const unsafe = () => Object.assign(new Error('受管文件身份已变化'), { code: 'UNSAFE_PATH' });

/** Filesystem seam only; callers must hold database reference/ownership authorization. */
export function unlinkManagedAsset(
  filesystem: ManagedFilesystem,
  roots: string[],
  path: string,
  expectedIdentity: string,
): void {
  if (!isAbsolute(path)) throw unsafe();
  let root: string | undefined;
  let parts: string[] = [];
  for (const configured of roots) {
    try {
      // Normalize the OS-owned parent alias, never a link at the app-owned root itself.
      const candidate = join(realpathSync(dirname(configured)), basename(configured));
      const suffix = relative(candidate, resolve(path));
      if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix))
        continue;
      root = candidate;
      parts = suffix.split(sep);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (!root || parts.length === 0) throw unsafe();
  const handles: DirectoryHandle[] = [];
  try {
    const stat = lstatSync(root, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw unsafe();
    let parent = filesystem.openRoot(root, `${stat.dev}:${stat.ino}`);
    handles.push(parent);
    for (const part of parts.slice(0, -1)) {
      parent = filesystem.openChild(parent, part, false);
      handles.push(parent);
    }
    const name = parts[parts.length - 1];
    if (!name || filesystem.fileIdentity(parent, name) !== expectedIdentity) throw unsafe();
    filesystem.unlinkFile(parent, name);
  } finally {
    for (const handle of handles.reverse()) filesystem.close(handle);
  }
}
