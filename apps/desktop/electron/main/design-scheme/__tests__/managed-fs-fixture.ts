import { resolve } from 'node:path';
import { loadManagedFilesystem } from '@musefold/managed-fs';
export const filesystem = loadManagedFilesystem(
  resolve('packages/managed-fs/build/Release/managed_fs.node'),
);
