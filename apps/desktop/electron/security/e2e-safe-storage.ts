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
 * Hosted Linux/Windows CI has no gnome-keyring / DPAPI session.
 * Keep production on real safeStorage; E2E may fall back to in-process bytes.
 */
export function resolveSafeStorage(): SafeStorageLike {
  if (process.env['MUSEFOLD_E2E'] === '1') {
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
