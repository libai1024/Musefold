import { safeStorage } from 'electron';

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const plaintext: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => value.toString('utf8'),
};

/**
 * Hosted CI has no stable OS credential store to bind ciphertext to.
 *
 * Linux has no gnome-keyring at all. Windows DPAPI is available, but Chromium
 * keeps its key in `Local State`, which an unflushed hard kill loses — the
 * crash-recovery suite would then decrypt garbage and report "no API key".
 * macOS keeps the deterministic mock keychain, so it still covers the real
 * safeStorage path. Production is never affected: this needs MUSEFOLD_E2E=1.
 */
export function resolveSafeStorage(): SafeStorageLike {
  if (process.env['MUSEFOLD_E2E'] === '1') {
    if (process.platform === 'win32') return plaintext;
    try {
      if (process.platform === 'linux') {
        const linuxSafeStorage = safeStorage as typeof safeStorage & {
          setUsePlainTextEncryption?: (value: boolean) => void;
        };
        linuxSafeStorage.setUsePlainTextEncryption?.(true);
      }
    } catch {
      // Older Electron builds omit the Linux-only helper.
    }
    if (!safeStorage.isEncryptionAvailable()) return plaintext;
  }
  return safeStorage;
}
