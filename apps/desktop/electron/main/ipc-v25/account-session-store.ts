import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AccountSummary,
  OFFICIAL_CLOUD_API_BASE,
  accountIssuerSchema,
} from '@musefold/contracts';
import { app } from 'electron';
import { z } from 'zod';
import { resolveSafeStorage } from '../../security/e2e-safe-storage';
import { BridgeError } from './envelope';

const storedSessionSchema = z
  .object({
    version: z.literal(2),
    token: z.string().min(1),
    ownerId: z.string().min(1).nullable(),
    apiIssuer: accountIssuerSchema,
    authEpoch: z.string().uuid(),
    principalId: z.string().min(1).nullable(),
    restricted: z.boolean(),
    pendingRecovery: z
      .object({ requestId: z.string().min(1).max(64) })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

export type SessionCredentials = z.infer<typeof storedSessionSchema>;

export function normalizeAccountIssuer(value: string): string {
  return new URL(accountIssuerSchema.parse(value)).toString().replace(/\/+$/, '');
}

export function apiBase(): string {
  return normalizeAccountIssuer(process.env.MUSEFOLD_API_URL ?? OFFICIAL_CLOUD_API_BASE);
}

function tokenPath() {
  return join(app.getPath('userData'), 'v25-account-session.json');
}

/** Legacy raw tokens have no authenticated issuer. Retain their file, never forward them. */
export async function readStoredSession(): Promise<SessionCredentials | null> {
  try {
    const raw = z
      .object({ encrypted: z.string().min(1) })
      .parse(JSON.parse(await readFile(tokenPath(), 'utf8')));
    const decrypted = resolveSafeStorage().decryptString(Buffer.from(raw.encrypted, 'base64'));
    return storedSessionSchema.parse(JSON.parse(decrypted));
  } catch {
    return null;
  }
}

export async function readSessionCredentials(): Promise<SessionCredentials | null> {
  const session = await readStoredSession();
  return session && normalizeAccountIssuer(session.apiIssuer) === apiBase() ? session : null;
}

/** Namespace consent and local containers by the issuing API and its stable principal. */
export function accountWorkspaceOwner(status: AccountSummary, issuer = apiBase()): string {
  const namespace = status.identity
    ? ['principal', normalizeAccountIssuer(status.identity.apiIssuer), status.identity.principalId]
    : ['legacy-account', normalizeAccountIssuer(issuer), status.id];
  return createHash('sha256').update(JSON.stringify(namespace)).digest('hex');
}

export function sessionForAccount(
  token: string,
  issuer: string,
  status: AccountSummary,
): SessionCredentials {
  const normalized = normalizeAccountIssuer(issuer);
  if (status.identity && normalizeAccountIssuer(status.identity.apiIssuer) !== normalized) {
    throw new BridgeError(
      'ACCOUNT_IDENTITY_SOURCE_CHANGED',
      '账号服务来源与当前连接不一致,请检查账号服务器设置',
    );
  }
  const restricted =
    !!status.recovery || (!!status.identity && status.identity.status !== 'active');
  return {
    version: 2,
    token,
    apiIssuer: normalized,
    authEpoch: randomUUID(),
    ownerId: restricted ? null : accountWorkspaceOwner(status, normalized),
    principalId: status.identity?.principalId ?? null,
    restricted,
    pendingRecovery: null,
  };
}

export async function writeStoredSession(value: SessionCredentials): Promise<void> {
  const storage = resolveSafeStorage();
  if (!storage.isEncryptionAvailable())
    throw new BridgeError('INTERNAL_ERROR', '系统安全存储不可用,无法保存登录状态');
  const encrypted = storage
    .encryptString(JSON.stringify(storedSessionSchema.parse(value)))
    .toString('base64');
  const path = tokenPath();
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify({ encrypted }), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function clearStoredSession(): Promise<void> {
  try {
    await unlink(tokenPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Serializes local credential commits only; no network call runs under this lock. */
let transitionTail: Promise<void> = Promise.resolve();
export async function withAccountTransition<T>(operation: () => Promise<T>): Promise<T> {
  const prior = transitionTail;
  let release = () => {};
  transitionTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prior;
  try {
    return await operation();
  } finally {
    release();
  }
}
