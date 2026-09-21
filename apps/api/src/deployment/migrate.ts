import { createDatabase, migrateDatabase } from '@musefold/db';
import { runMigrations } from 'graphile-worker';
import type { PoolClient } from 'pg';
import { z } from 'zod';

// Separate from runtime DATABASE_URL; never silently migrate with an API/worker credential.
const environmentSchema = z.object({
  MIGRATION_DATABASE_URL: z
    .string()
    .url()
    .refine((value) => /^postgres(?:ql)?:/.test(value)),
  MIGRATION_RELEASE: z.string().regex(/^[a-f0-9]{40}$/),
});

export function migrationEnvironment(environment: NodeJS.ProcessEnv) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) throw new Error('MIGRATION_CONFIGURATION_INVALID');
  return parsed.data;
}

// Session lock spans both Drizzle and Graphile. A second release must fail before any DDL.
export const MIGRATION_LOCK = [1296455218, 25] as const;

export async function runDeploymentMigrations(environment: NodeJS.ProcessEnv) {
  const config = migrationEnvironment(environment);
  const { db, pool } = createDatabase(config.MIGRATION_DATABASE_URL, { max: 3 });
  // pg diagnostic strings can contain SQL or connection details; never log them here.
  let connectionLost = false;
  pool.on('error', () => {
    connectionLost = true;
  });
  pool.on('connect', (client) => {
    client.on('error', () => {
      connectionLost = true;
    });
  });
  let lock: PoolClient | undefined;
  let acquired = false;
  try {
    lock = await pool.connect();
    const result = await lock.query<{ acquired: boolean }>(
      'select pg_try_advisory_lock($1, $2) as acquired',
      [...MIGRATION_LOCK],
    );
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) throw new Error('MIGRATION_ALREADY_RUNNING');
    await migrateDatabase(db);
    if (connectionLost) throw new Error('MIGRATION_CONNECTION_LOST');
    await runMigrations({ pgPool: pool });
    if (connectionLost) throw new Error('MIGRATION_CONNECTION_LOST');
    return { status: 'migrated' as const, release: config.MIGRATION_RELEASE };
  } finally {
    try {
      if (lock) {
        try {
          if (acquired && !connectionLost) {
            await lock.query('select pg_advisory_unlock($1, $2)', [...MIGRATION_LOCK]);
          }
        } finally {
          lock.release(true);
        }
      }
    } finally {
      await pool.end();
    }
  }
}
