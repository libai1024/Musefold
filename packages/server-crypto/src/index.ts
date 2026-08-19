import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface SealedValue {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}

function keyFromConfig(value: string): Buffer {
  const hex = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : null;
  const base64 = /^[A-Za-z0-9+/]+={0,2}$/.test(value) ? Buffer.from(value, 'base64') : null;
  return hex?.length === 32 ? hex : base64?.length === 32 ? base64 : createHash('sha256').update(value).digest();
}

export function sealJson(value: unknown, keyConfig: string): SealedValue {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromConfig(keyConfig), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

export function openJson<T>(sealed: SealedValue, keyConfig: string): T {
  const decipher = createDecipheriv('aes-256-gcm', keyFromConfig(keyConfig), sealed.nonce);
  decipher.setAuthTag(sealed.authTag);
  return JSON.parse(Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8')) as T;
}
