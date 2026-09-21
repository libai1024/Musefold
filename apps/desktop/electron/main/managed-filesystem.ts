import { app } from 'electron';
import { join } from 'node:path';
import { loadManagedFilesystem, type ManagedFilesystem } from '@musefold/managed-fs';
import { resolveAppRoot } from './app-paths';

let filesystem: ManagedFilesystem | undefined;

/** Main-process resource selection. Native handles are owned and closed by each caller. */
export function getManagedFilesystem(): ManagedFilesystem {
  filesystem ??= loadManagedFilesystem(
    app.isPackaged
      ? join(process.resourcesPath, 'native', 'managed_fs.node')
      : join(resolveAppRoot(), 'packages/managed-fs/build/Release/managed_fs.node'),
  );
  return filesystem;
}
