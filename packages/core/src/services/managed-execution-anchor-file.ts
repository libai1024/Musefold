import { constants, realpathSync } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  managedExecutionAnchorSchema,
  type ManagedExecutionAnchor,
} from '@musefold/desktop-contracts/managed-execution';
import { ManagedExecutionError } from '../db/repositories/managed-execution';
import type { ManagedExecutionAnchorPort } from './managed-execution-guard';

const MAX_PLAINTEXT_BYTES = 16 * 1024;
const MAX_CIPHERTEXT_BYTES = 64 * 1024;

/** The desktop host supplies safeStorage. There is deliberately no plaintext/default codec. */
export interface ManagedAnchorCipher {
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

/** Small control file outside business DB backups; never contains the request ledger or tokens. */
export class EncryptedManagedAnchorFile implements ManagedExecutionAnchorPort {
  readonly scope: string;

  constructor(
    path: string,
    private readonly cipher: ManagedAnchorCipher,
  ) {
    const absolute = resolve(path);
    this.scope = join(realpathSync(dirname(absolute)), basename(absolute));
  }

  async read(): Promise<ManagedExecutionAnchor | null> {
    let file: Awaited<ReturnType<typeof open>>;
    try {
      // Some platforms do not expose O_NOFOLLOW; reject an existing link explicitly as well.
      await this.requireRegularDestination();
      file = await open(
        this.scope,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ManagedExecutionError('MANAGED_ANCHOR_UNREADABLE');
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_CIPHERTEXT_BYTES)
        throw new Error('Invalid anchor file');
      const bytes = Buffer.alloc(MAX_CIPHERTEXT_BYTES + 1);
      let size = 0;
      while (size < bytes.length) {
        const result = await file.read(bytes, size, bytes.length - size, null);
        if (result.bytesRead === 0) break;
        size += result.bytesRead;
      }
      if (size < 1 || size > MAX_CIPHERTEXT_BYTES) throw new Error('Invalid anchor size');
      const plaintext = this.cipher.decrypt(bytes.subarray(0, size));
      if (Buffer.byteLength(plaintext, 'utf8') > MAX_PLAINTEXT_BYTES)
        throw new Error('Invalid anchor size');
      return managedExecutionAnchorSchema.parse(JSON.parse(plaintext));
    } catch {
      throw new ManagedExecutionError('MANAGED_ANCHOR_UNREADABLE');
    } finally {
      await file.close();
    }
  }

  async write(value: ManagedExecutionAnchor): Promise<void> {
    const temporary = `${this.scope}.${randomUUID()}.tmp`;
    let owned = false;
    try {
      const plaintext = JSON.stringify(managedExecutionAnchorSchema.parse(value));
      if (Buffer.byteLength(plaintext, 'utf8') > MAX_PLAINTEXT_BYTES)
        throw new Error('Invalid anchor size');
      const ciphertext = this.cipher.encrypt(plaintext);
      if (
        !Buffer.isBuffer(ciphertext) ||
        ciphertext.length < 1 ||
        ciphertext.length > MAX_CIPHERTEXT_BYTES
      )
        throw new Error('Invalid ciphertext');
      await this.requireRegularDestination();
      const file = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      owned = true;
      try {
        await file.writeFile(ciphertext);
        await file.sync();
      } finally {
        await file.close();
      }
      await this.requireRegularDestination();
      await rename(temporary, this.scope);
      // File flush + atomic rename protect process-crash windows. Directory flush is supported
      // by Unix; Windows power-loss durability is not claimed by this portable implementation.
      if (process.platform !== 'win32') {
        const directory = await open(dirname(this.scope), constants.O_RDONLY);
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } catch {
      throw new ManagedExecutionError('MANAGED_ANCHOR_WRITE_FAILED');
    } finally {
      if (owned) await unlink(temporary).catch(() => undefined);
    }
  }

  private async requireRegularDestination(): Promise<void> {
    try {
      const stat = await lstat(this.scope);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid anchor destination');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
