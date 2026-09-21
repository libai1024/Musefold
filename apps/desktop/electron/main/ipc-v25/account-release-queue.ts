import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { accountIssuerSchema } from '@musefold/contracts';
import { app } from 'electron';
import { z } from 'zod';
import { resolveSafeStorage } from '../../security/e2e-safe-storage';
import { BridgeError } from './envelope';
import { readStoredSession, withAccountTransition } from './account-session-store';

const releaseSchema = z
  .object({
    id: z.string(),
    token: z.string().min(1).max(4096),
    issuer: accountIssuerSchema,
    expiresAt: z.number().int(),
    nextAttemptAt: z.number().int(),
    attempts: z.number().int().nonnegative(),
  })
  .strict();
const queueSchema = z.array(releaseSchema).max(5000);
type PendingRelease = z.infer<typeof releaseSchema>;
const queuePath = () => join(app.getPath('userData'), 'v25-account-pending-releases.json');
let tail: Promise<unknown> = Promise.resolve();
let draining = false;

async function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation, operation);
  tail = result.catch(() => undefined);
  return result;
}
async function readQueue(): Promise<PendingRelease[]> {
  let value: string;
  try {
    value = await readFile(queuePath(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  try {
    const envelope = z
      .object({ encrypted: z.string().min(1) })
      .strict()
      .parse(JSON.parse(value));
    return queueSchema.parse(
      JSON.parse(resolveSafeStorage().decryptString(Buffer.from(envelope.encrypted, 'base64'))),
    );
  } catch {
    throw new BridgeError('INTERNAL_ERROR', '待释放登录记录无法读取，尚未丢弃原登录凭据');
  }
}
async function saveQueue(value: PendingRelease[]) {
  const storage = resolveSafeStorage();
  if (!storage.isEncryptionAvailable())
    throw new BridgeError('INTERNAL_ERROR', '系统安全存储不可用，无法保存待释放登录记录');
  const encrypted = storage
    .encryptString(JSON.stringify(queueSchema.parse(value)))
    .toString('base64');
  const path = queuePath();
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ encrypted }), { mode: 0o600, encoding: 'utf8' });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/** Must finish before clearing the current local session. Never stored in SQLite. */
export async function enqueueAccountRelease(
  token: string,
  issuer: string,
  candidate = false,
): Promise<void> {
  const target = accountIssuerSchema.parse(issuer);
  const id = createHash('sha256').update(`${target}\0${token}`).digest('hex');
  await serialized(async () => {
    const queue = await readQueue();
    const existing = queue.find((item) => item.id === id);
    if (existing) {
      if (!candidate) {
        existing.nextAttemptAt = Math.min(existing.nextAttemptAt, Date.now());
        await saveQueue(queue);
      }
      return;
    }
    queue.push({
      id,
      token,
      issuer: target,
      expiresAt: Date.now() + 30 * 24 * 60 * 60_000,
      nextAttemptAt: Date.now() + (candidate ? 300_000 : 0),
      attempts: 0,
    });
    await saveQueue(queue);
  });
}

export async function pendingAccountReleaseCount(): Promise<number> {
  const current = await readStoredSession();
  return serialized(
    async () =>
      (await readQueue()).filter(
        (item) =>
          item.expiresAt > Date.now() &&
          (item.token !== current?.token || item.issuer !== current.apiIssuer),
      ).length,
  );
}

export async function retryAccountReleases(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const entries = await serialized(async () =>
      (await readQueue()).filter((item) => item.nextAttemptAt <= Date.now()).slice(0, 20),
    );
    for (const entry of entries) {
      const stillCurrent = await withAccountTransition(async () => {
        const current = await readStoredSession();
        if (current?.token !== entry.token || current.apiIssuer !== entry.issuer) return false;
        // A failed local logout retains its session; an acknowledged candidate
        // survives a crash between the local commit and queue housekeeping.
        await serialized(async () => {
          await saveQueue((await readQueue()).filter((item) => item.id !== entry.id));
        });
        return true;
      });
      if (stillCurrent) continue;
      let confirmed = false;
      if (entry.expiresAt > Date.now()) {
        try {
          const response = await fetch(`${entry.issuer}/api/auth/sign-out`, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(2_000),
            headers: { authorization: `Bearer ${entry.token}`, 'content-type': 'application/json' },
            body: '{}',
          });
          // BA sign-out's confirmation means its durable server release queue
          // now owns remote cleanup; it does not claim the upstream is online.
          if (response.ok) {
            const reader = response.body?.getReader();
            if (reader) {
              const parts: Uint8Array[] = [];
              let size = 0;
              try {
                while (true) {
                  const chunk = await reader.read();
                  if (chunk.done) break;
                  size += chunk.value.length;
                  if (size > 16384) throw new Error('Large response');
                  parts.push(chunk.value);
                }
                confirmed = z
                  .object({ success: z.literal(true) })
                  .safeParse(JSON.parse(Buffer.concat(parts).toString('utf8'))).success;
              } finally {
                await reader.cancel().catch(() => undefined);
                reader.releaseLock();
              }
            }
          } else await response.body?.cancel();
        } catch {
          /* Encrypted responsibility remains; no credentials in diagnostics. */
        }
      }
      await serialized(async () => {
        const queue = await readQueue();
        const found = queue.find((item) => item.id === entry.id);
        if (!found) return;
        if (confirmed || found.expiresAt <= Date.now())
          await saveQueue(queue.filter((item) => item.id !== entry.id));
        else {
          found.nextAttemptAt = Date.now() + ([5_000, 30_000, 120_000][found.attempts] ?? 900_000);
          found.attempts++;
          await saveQueue(queue);
        }
      });
    }
  } finally {
    draining = false;
  }
}

export function startAccountReleaseRetries(): () => void {
  const run = () => {
    void retryAccountReleases().catch(() => undefined);
  };
  run();
  const timer = setInterval(run, 5_000);
  timer.unref();
  return () => clearInterval(timer);
}
