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
