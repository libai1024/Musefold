import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';

declare const directoryBrand: unique symbol;
declare const readerBrand: unique symbol;
export type DirectoryHandle = { readonly [directoryBrand]: true };
export type DirectoryReader = { readonly [readerBrand]: true };

/** Internal IO capabilities, never an entity/IPC shape. Native type tags reject forged handles. */
export interface ManagedFilesystem {
  openRoot(path: string, expectedIdentity: string): DirectoryHandle;
  openChild(parent: DirectoryHandle, name: string, create: boolean): DirectoryHandle;
  identity(directory: DirectoryHandle): string;
  close(directory: DirectoryHandle): void;
  openFile(directory: DirectoryHandle, name: string, mode: 'read' | 'create'): number;
  /**
   * 整块 IO 原语:Windows 上 openFile 返回的 CRT fd 无法进入 Node 的 fd 表
   * (node.exe/electron.exe 静态链接 CRT,fd 表与插件实例互不相通,喂给 fs.* 只会 EBADF),
   * 宿主在 Windows 必须改用这两个方法完成整文件读/写。Unix 两侧皆实现,供跨平台测试。
   * readWholeFile:普通文件整体读入,超过 maxBytes 抛 EFBIG;
   * writeWholeFile:排他新建(O_CREAT|O_EXCL 语义)+ 全量写入 + 落盘,已存在抛 EEXIST。
   */
  readWholeFile?(directory: DirectoryHandle, name: string, maxBytes: number): Buffer;
  writeWholeFile?(directory: DirectoryHandle, name: string, bytes: Buffer): void;
  fileIdentity(directory: DirectoryHandle, name: string): string;
  unlinkFile(directory: DirectoryHandle, name: string): void;
  removeDirectory(parent: DirectoryHandle, name: string): void;
  openReader(directory: DirectoryHandle): DirectoryReader;
  readReader(
    reader: DirectoryReader,
    limit: number,
  ): Array<{
    name: string;
    type: 'directory' | 'file' | 'link' | 'missing' | 'other';
  }>;
  closeReader(reader: DirectoryReader): void;
}

/** Caller supplies a trusted application resource path; no network or path fallback. */
export function loadManagedFilesystem(binaryPath: string): ManagedFilesystem {
  if (!isAbsolute(binaryPath))
    throw new Error('Managed filesystem requires an absolute binary path');
  const native: unknown = createRequire(binaryPath)(binaryPath);
  if (!native || typeof native !== 'object') throw new Error('Invalid managed filesystem binding');
  for (const name of [
    'openRoot',
    'openChild',
    'identity',
    'close',
    'openFile',
    'fileIdentity',
    'unlinkFile',
    'removeDirectory',
    'openReader',
    'readReader',
    'closeReader',
  ]) {
    if (!(name in native) || typeof (native as Record<string, unknown>)[name] !== 'function') {
      throw new Error('Incomplete managed filesystem binding');
    }
  }
  return native as ManagedFilesystem;
}
