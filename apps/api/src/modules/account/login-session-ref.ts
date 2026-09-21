import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

/** Opaque, non-authorizing display handle. A different flow / signed-in session
 * cannot transplant it. Raw upstream SIDs never enter the renderer contract. */
export function loginSessionRefs(key: string, issuer: string, scope: string) {
  const cipherKey = createHash('sha256').update(`musefold-session-ref-v1:${key}`).digest();
  const aad = Buffer.from(JSON.stringify([issuer, scope]));
  return {
    encode(sid: string) {
      z.string().uuid().parse(sid);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', cipherKey, iv);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([
        cipher.update(Buffer.from(sid.replaceAll('-', ''), 'hex')),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
    },
    decode(ref: string) {
      try {
        const bytes = Buffer.from(ref, 'base64url');
        if (bytes.length !== 44 || bytes.toString('base64url') !== ref) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', cipherKey, bytes.subarray(0, 12));
        decipher.setAAD(aad);
        decipher.setAuthTag(bytes.subarray(12, 28));
        const raw = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(
          'hex',
        );
        return z
          .string()
          .uuid()
          .parse(
            `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`,
          );
      } catch {
        throw new AppError('AUTH_SESSION_REVIEW_CHANGED', '设备选择已失效，请刷新后重新选择', 409);
      }
    },
  };
}
