import { createHash, randomBytes } from 'node:crypto';
export { openJson, sealJson } from '@musefold/server-crypto';
export type { SealedValue } from '@musefold/server-crypto';

export function hashSessionId(rawId: string): string {
  return createHash('sha256').update(rawId).digest('hex');
}

export function createOpaqueId(): string {
  return randomBytes(32).toString('base64url');
}

export function createCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}
