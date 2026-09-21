import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type pg from 'pg';
import { z } from 'zod';

const id = z.string().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.iso.datetime();
const envName = z.string().regex(/^MUSEFOLD_RECOVERY_[A-Z0-9_]+$/);
const path = z.string().max(4096).refine(isAbsolute);
const issuer = z.url().refine((value) => {
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === '/' &&
    url.origin === value &&
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
  );
});

/** Operator trust input, separate from source rows. A digest is not historical attestation. */
export const backupSourceProfileSchema = z
  .strictObject({
    version: z.literal(1),
    id,
    apiIssuer: issuer,
    upstreamIssuer: issuer,
    targetDatabase: z.strictObject({ systemIdentifier: z.string().regex(/^\d+$/), name: id }),
    sourceDatabase: z.strictObject({ systemIdentifier: z.string().regex(/^\d+$/), name: id }),
    sourceDatabaseUrlEnv: envName,
    archiveKeyEnv: envName,
    sourcePrincipalId: id,
    targetPrincipalId: id,
    sourceLineage: id,
    targetLineage: id,
    expectedEvidenceSha256: digest.optional(),
    capturedAt: instant,
    /** Earliest candidate/repair attempt, established independently of this request. */
    independentBefore: instant,
    attestation: z.strictObject({
      recordPath: path,
      sha256: digest,
      reference: id,
      reviewedBy: id,
      decision: z.literal('complete-independent-legacy-evidence'),
    }),
  })
  .superRefine((value, ctx) => {
    if (
      value.sourcePrincipalId !== value.targetPrincipalId ||
      value.sourceLineage !== value.targetLineage
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Cross-principal or cross-lineage restoration is unsupported',
      });
    if (Date.parse(value.capturedAt) >= Date.parse(value.independentBefore))
      ctx.addIssue({
        code: 'custom',
        message: 'Snapshot does not precede independently established candidate attempts',
      });
    if (
      value.targetDatabase.systemIdentifier === value.sourceDatabase.systemIdentifier &&
      value.targetDatabase.name === value.sourceDatabase.name
    )
      ctx.addIssue({ code: 'custom', message: 'Source must be an isolated restored database' });
  });
export type BackupSourceProfile = z.infer<typeof backupSourceProfileSchema>;

const encrypted = z.string().min(1).max(65_536);
const sourceDates = { createdAt: instant, updatedAt: instant };
export const backupSourceRowsSchema = z.strictObject({
  format: z.literal('musefold-pg0008-account-evidence-v1'),
  principalId: id,
  relays: z
    .array(
      z.strictObject({
        sessionId: id,
        userId: id,
        ciphertext: encrypted,
        keyVersion: z.literal('v1'),
        accessExpiresAt: instant,
        ...sourceDates,
      }),
    )
    .min(1)
    .max(16),
  credentials: z
    .array(
      z.strictObject({
        userId: id,
        provider: z.literal('new-api'),
        externalTokenId: z.string().regex(/^[1-9]\d{0,14}$/),
        ciphertext: encrypted,
        keyVersion: z.literal('v1'),
        ...sourceDates,
      }),
    )
    .length(1),
});
export type BackupSourceRows = z.infer<typeof backupSourceRowsSchema>;

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
export function sourceDigest(value: BackupSourceRows): string {
  return sha256(JSON.stringify(backupSourceRowsSchema.parse(value)));
}

/** Bounded regular file, owned by the operator/root, not writable by another principal. */
export async function readControlledFile(filename: string, maxBytes = 65_536): Promise<Buffer> {
  if (!isAbsolute(filename)) throw new Error('CONTROLLED_FILE_REQUIRED');
  const handle = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o022) !== 0 ||
      (stat.uid !== 0 && stat.uid !== process.getuid?.()) ||
      stat.size > maxBytes
    )
      throw new Error('CONTROLLED_FILE_REJECTED');
    const bytes = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size <= maxBytes) {
      const next = await handle.read(bytes, size, bytes.length - size, null);
      if (next.bytesRead === 0) break;
      size += next.bytesRead;
    }
    if (size > maxBytes) throw new Error('CONTROLLED_FILE_TOO_LARGE');
    return bytes.subarray(0, size);
  } finally {
    await handle.close();
  }
}

export async function loadBackupSourceProfile(filename: string): Promise<BackupSourceProfile> {
  const profile = backupSourceProfileSchema.parse(
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(await readControlledFile(filename)),
    ),
  );
  if (profile.attestation.recordPath === filename) throw new Error('INDEPENDENT_RECORD_REQUIRED');
  const record = await readControlledFile(profile.attestation.recordPath, 1_048_576);
  if (record.length === 0 || sha256(record) !== profile.attestation.sha256)
    throw new Error('ATTESTATION_RECORD_MISMATCH');
  // We verify bytes/configuration only. The operator is responsible for the historical judgment.
  return profile;
}

export async function databaseIdentity(client: pg.PoolClient) {
  const result = await client.query(
    'SELECT current_database() AS name, system_identifier::text AS "systemIdentifier" FROM pg_control_system()',
  );
  return z
    .strictObject({ name: id, systemIdentifier: z.string().regex(/^\d+$/) })
    .parse(result.rows[0]);
}

/** Fixed 0008 projection; never reads BA bearer tokens, OAuth grants, names or payer hints. */
export async function readBackupSource(
  pool: pg.Pool,
  profile: BackupSourceProfile,
  fingerprintOnly = false,
): Promise<BackupSourceRows> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    const actual = await databaseIdentity(client);
    if (
      actual.name !== profile.sourceDatabase.name ||
      actual.systemIdentifier !== profile.sourceDatabase.systemIdentifier
    )
      throw new Error('SOURCE_DATABASE_MISMATCH');
    const migration = await client.query(
      'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1',
    );
    const expected = sha256(
      await readFile(
        new URL('../../../../../packages/db/migrations/0008_spooky_elektra.sql', import.meta.url),
      ),
    );
    if (migration.rows[0]?.hash !== expected) throw new Error('UNSUPPORTED_SOURCE_SCHEMA');
    // Refuse newer provenance/candidate tables even if someone accidentally copied an old journal.
    const newer = await client.query(
      "SELECT to_regclass('public.account_recovery_requests') AS candidate",
    );
    if (newer.rows[0]?.candidate) throw new Error('UNSUPPORTED_SOURCE_SCHEMA');
    const rows = await client.query(
      `SELECT session_id AS "sessionId", user_id AS "userId",
      CASE WHEN octet_length(ciphertext) <= 65536 THEN ciphertext ELSE NULL END AS ciphertext,
      key_version AS "keyVersion", access_expires_at AS "accessExpiresAt", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM public.relay_sessions WHERE user_id=$1 ORDER BY session_id LIMIT 17`,
      [profile.sourcePrincipalId],
    );
    const credentials = await client.query(
      `SELECT user_id AS "userId", provider, external_token_id AS "externalTokenId",
      CASE WHEN octet_length(ciphertext) <= 65536 THEN ciphertext ELSE NULL END AS ciphertext,
      key_version AS "keyVersion", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM public.account_credentials WHERE user_id=$1 ORDER BY provider LIMIT 17`,
      [profile.sourcePrincipalId],
    );
    const parsed = backupSourceRowsSchema.parse(
      JSON.parse(
        JSON.stringify({
          format: 'musefold-pg0008-account-evidence-v1',
          principalId: profile.sourcePrincipalId,
          relays: rows.rows,
          credentials: credentials.rows,
        }),
      ),
    );
    for (const row of [...parsed.relays, ...parsed.credentials]) {
      if (
        row.userId !== parsed.principalId ||
        Date.parse(row.updatedAt) > Date.parse(profile.capturedAt) ||
        Date.parse(row.createdAt) > Date.parse(row.updatedAt)
      )
        throw new Error('INCOMPLETE_INDEPENDENCE_EVIDENCE');
    }
    if (!fingerprintOnly && sourceDigest(parsed) !== profile.expectedEvidenceSha256)
      throw new Error('SOURCE_DIGEST_MISMATCH');
    await client.query('COMMIT');
    return parsed;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
