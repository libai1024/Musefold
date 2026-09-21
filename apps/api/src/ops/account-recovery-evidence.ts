import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '@musefold/db';
import { createNewApiClient } from '@musefold/new-api-client';
import pg from 'pg';
import { z } from 'zod';
import {
  AccountBackupEvidenceStore,
  backupInspectPlanSchema,
} from '../modules/account/backup-evidence.js';
import {
  databaseIdentity,
  loadBackupSourceProfile,
  readBackupSource,
  readControlledFile,
  sha256,
  sourceDigest,
} from '../modules/account/backup-source.js';

const usage =
  'inspect-source --profile ABSOLUTE_PATH | inspect --profile ABSOLUTE_PATH --request-id ID | stage --profile ABSOLUTE_PATH --plan ABSOLUTE_PATH --plan-sha256 SHA256';
const connectionOptions = { max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000 };

function options(args: string[]) {
  const operation = z.enum(['inspect-source', 'inspect', 'stage']).parse(args[0]);
  const fields: Record<string, string> = {};
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || fields[key]) throw new Error('INVALID_ARGUMENTS');
    fields[key] = value;
  }
  return operation === 'inspect-source'
    ? { operation, fields: z.strictObject({ '--profile': z.string() }).parse(fields) }
    : operation === 'inspect'
      ? {
          operation,
          fields: z
            .strictObject({ '--profile': z.string(), '--request-id': z.string().min(1).max(200) })
            .parse(fields),
        }
      : {
          operation,
          fields: z
            .strictObject({
              '--profile': z.string(),
              '--plan': z.string(),
              '--plan-sha256': z.string().regex(/^[a-f0-9]{64}$/),
            })
            .parse(fields),
        };
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.length > 8192) throw new Error('OPERATOR_ENVIRONMENT_INCOMPLETE');
  return value;
}

/** No migration, dump restore, API login, or authority mutation is performed by this CLI. */
export async function runRecoveryEvidenceOperator(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  const parsed = options(args);
  const profile = await loadBackupSourceProfile(parsed.fields['--profile']);
  if (parsed.operation === 'inspect-source') {
    const source = new pg.Pool({
      connectionString: requireEnv(env, profile.sourceDatabaseUrlEnv),
      ...connectionOptions,
    });
    try {
      const rows = await readBackupSource(source, profile, true);
      return {
        format: rows.format,
        sourceDatabase: profile.sourceDatabase,
        principalId: rows.principalId,
        sourceDigest: sourceDigest(rows),
        relayCount: rows.relays.length,
        credentialCount: rows.credentials.length,
        assurance: 'fingerprint-only; not historical attestation or authorization',
      };
    } finally {
      await source.end();
    }
  }
  const target = createDatabase(requireEnv(env, 'MUSEFOLD_RECOVERY_TARGET_DATABASE_URL'), {
    max: 1,
  });
  // Set before the first lazy connection; no global API/worker pool defaults change.
  Object.assign(target.pool.options, { connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  const source = new pg.Pool({
    connectionString: requireEnv(env, profile.sourceDatabaseUrlEnv),
    ...connectionOptions,
  });
  try {
    const client = await target.pool.connect();
    try {
      const actual = await databaseIdentity(client);
      if (
        actual.name !== profile.targetDatabase.name ||
        actual.systemIdentifier !== profile.targetDatabase.systemIdentifier
      )
        throw new Error('TARGET_DATABASE_MISMATCH');
    } finally {
      client.release();
    }
    const rows = await readBackupSource(source, profile);
    const store = new AccountBackupEvidenceStore({
      db: target.db,
      newApi: createNewApiClient(profile.upstreamIssuer),
      encryptionKey: requireEnv(env, 'MUSEFOLD_RECOVERY_CURRENT_KEY'),
      apiIssuer: profile.apiIssuer,
      upstreamIssuer: profile.upstreamIssuer,
    });
    if (parsed.operation === 'inspect')
      return await store.inspect(parsed.fields['--request-id'], profile, rows);
    const bytes = await readControlledFile(parsed.fields['--plan']);
    if (sha256(bytes) !== parsed.fields['--plan-sha256']) throw new Error('PLAN_DIGEST_MISMATCH');
    const plan = backupInspectPlanSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    return await store.stage(plan, profile, rows, requireEnv(env, profile.archiveKeyEnv));
  } finally {
    await Promise.allSettled([source.end(), target.pool.end()]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--help') process.stdout.write(`${usage}\n`);
  else {
    try {
      const result = await runRecoveryEvidenceOperator(process.argv.slice(2), process.env);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      // Never serialize PG/crypto/zod/fetch errors: they may contain source DSNs or secret input.
      process.stderr.write(
        'RECOVERY_EVIDENCE_REJECTED: check the controlled profile, source, plan, and pending request. No identity was activated.\n',
      );
      process.exitCode = 1;
    }
  }
}
