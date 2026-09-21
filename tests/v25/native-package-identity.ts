import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Compare every native byte except signature data and its __LINKEDIT allocation size. */
export function nativePackageIdentity(path: string): string {
  if (process.platform !== 'darwin')
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  execFileSync('codesign', ['--verify', '--strict', path], { stdio: 'pipe' });
  const temporary = mkdtempSync(join(tmpdir(), 'musefold-native-identity-'));
  try {
    const copy = join(temporary, 'managed_fs.node');
    copyFileSync(path, copy);
    // Only disposable copies are altered; the actual signed app remains untouched.
    execFileSync('codesign', ['--remove-signature', copy], { stdio: 'pipe' });
    const bytes = readFileSync(copy);
    if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf)
      throw new Error('Expected a thin 64-bit Mach-O native library');
    const commands = bytes.readUInt32LE(16);
    const end = 32 + bytes.readUInt32LE(20);
    if (end > bytes.length) throw new Error('Invalid native load commands');
    let offset = 32;
    let linkedit = 0;
    for (let index = 0; index < commands; index++) {
      if (offset + 8 > end) throw new Error('Truncated native load command');
      const command = bytes.readUInt32LE(offset);
      const size = bytes.readUInt32LE(offset + 4);
      if (size < 8 || offset + size > end) throw new Error('Invalid native load command size');
      if (
        command === 0x19 &&
        size >= 72 &&
        bytes
          .subarray(offset + 8, offset + 24)
          .toString('utf8')
          .replace(/\0+$/, '') === '__LINKEDIT'
      ) {
        linkedit++;
        const fileSize = bytes.readBigUInt64LE(offset + 48);
        const fileOffset = bytes.readBigUInt64LE(offset + 40);
        if (
          fileOffset + fileSize > BigInt(bytes.length) ||
          bytes.readBigUInt64LE(offset + 32) < fileSize
        )
          throw new Error('Invalid native link-edit allocation');
        // codesign removes its blob and updates filesize, but retains the larger signed
        // vmsize. Normalize this one allocation field; code/data/UUID/imports stay exact.
        bytes.writeBigUInt64LE(fileSize, offset + 32);
      }
      offset += size;
    }
    if (offset !== end || linkedit !== 1) throw new Error('Missing native link-edit segment');
    return createHash('sha256').update(bytes).digest('hex');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
