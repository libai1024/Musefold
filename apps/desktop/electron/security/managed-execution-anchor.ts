import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { EncryptedManagedAnchorFile } from '@musefold/core/services/managed-execution-anchor-file';
import type { ManagedExecutionAnchorPort } from '@musefold/core/services/managed-execution-guard';
import { ManagedExecutionError } from '@musefold/core/db/repositories/managed-execution';
import { hasPersistedOsCryptKey } from './os-crypt-durability';

export const MANAGED_ANCHOR_FILE = 'managed-execution.anchor';

/** No test plaintext fallback: an unavailable OS keystore cannot enable managed execution. */
export function createManagedExecutionAnchor(
  userData = app.getPath('userData'),
): ManagedExecutionAnchorPort {
  const requireEncryption = () => {
    if (!safeStorage.isEncryptionAvailable())
      throw new ManagedExecutionError('MANAGED_ENCRYPTION_UNAVAILABLE');
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
      throw new ManagedExecutionError('MANAGED_ENCRYPTION_UNAVAILABLE');
  };
  const file = new EncryptedManagedAnchorFile(join(userData, MANAGED_ANCHOR_FILE), {
    encrypt(value) {
      requireEncryption();
      return safeStorage.encryptString(value);
    },
    decrypt(value) {
      requireEncryption();
      return safeStorage.decryptString(value);
    },
  });
  return {
    scope: file.scope,
    read: () => file.read(),
    async write(value) {
      requireEncryption();
      if (process.platform === 'win32') {
        // Materialize the OS key before waiting; do not write our control file until the
        // Chromium key record exists. Waiting is asynchronous and failure is fail-closed.
        safeStorage.encryptString('managed-execution-key-initialization');
        const deadline = Date.now() + 20_000;
        while (!hasPersistedOsCryptKey(join(userData, 'Local State'))) {
          if (Date.now() >= deadline)
            throw new ManagedExecutionError('MANAGED_ENCRYPTION_NOT_DURABLE');
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
      }
      await file.write(value);
    },
  };
}
