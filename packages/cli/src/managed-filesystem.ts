import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManagedFilesystem, type ManagedFilesystem } from '@musefold/managed-fs';

/** Resolve only supported source/bundle layouts, never cwd, userData or an environment override. */
export function resolveServeNativeBinary(moduleUrl: string): string {
  const directory = dirname(fileURLToPath(moduleUrl));
  const base = basename(directory) === 'chunks' ? dirname(directory) : directory;
  if (basename(base) === 'integration') return join(base, '..', 'native', 'managed_fs.node');
  if (['src', 'dist', '.tsout'].includes(basename(base)) && basename(dirname(base)) === 'cli') {
    return join(base, '..', '..', 'managed-fs', 'build', 'Release', 'managed_fs.node');
  }
  throw new Error('无法定位 CLI 原生资源，请从 Musefold 应用重新安装命令行工具');
}

export function loadServeFilesystem(): ManagedFilesystem {
  try {
    return loadManagedFilesystem(resolveServeNativeBinary(import.meta.url));
  } catch {
    throw new Error('CLI 原生文件系统资源不可用，请重新构建或从 Musefold 应用重新安装');
  }
}
