import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ManagedAnchorCipher } from '../../managed-execution-anchor-file';

/** Synthetic process fixture only. Production supplies Electron safeStorage, never this codec. */
export const fixtureCipher: ManagedAnchorCipher = {
  encrypt(plaintext) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32, 71), nonce);
    const bytes = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), bytes]);
  },
  decrypt(bytes) {
    const cipher = createDecipheriv('aes-256-gcm', Buffer.alloc(32, 71), bytes.subarray(0, 12), {
      authTagLength: 16,
    });
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
  },
};
