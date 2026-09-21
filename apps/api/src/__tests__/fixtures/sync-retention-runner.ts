import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const resultSchema = z
  .object({
    pid: z.number().int().positive(),
    maintenanceAt: z.string().datetime(),
    stats: z
      .object({
        purged: z.number().int().nonnegative(),
        changeLogs: z.number().int().nonnegative(),
        mutationResults: z.number().int().nonnegative(),
        minAvailableCursor: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

/** Cross-process test orchestration; API production never imports worker implementation. */
export function runSyncRetentionProcess(databaseUrl: string, maintenanceAt: Date) {
  return runMaintenanceProcess(databaseUrl, maintenanceAt, 'sync', resultSchema);
}

export function runPromptRetentionProcess(databaseUrl: string, maintenanceAt: Date) {
  return runMaintenanceProcess(
    databaseUrl,
    maintenanceAt,
    'prompts',
    resultSchema.extend({
      stats: z.object({ purged: z.number().int().nonnegative() }).strict(),
    }),
  );
}

function runMaintenanceProcess<T>(
  databaseUrl: string,
  maintenanceAt: Date,
  operation: 'sync' | 'prompts',
  schema: z.ZodType<T>,
) {
  const child = fork(
    fileURLToPath(
      new URL(
        '../../../../worker/src/__tests__/fixtures/sync-retention-process.ts',
        import.meta.url,
      ),
    ),
    [],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        RUN_SYNC_RETENTION_TEST: '1',
        DATABASE_URL: databaseUrl,
        MAINTENANCE_AT: maintenanceAt.toISOString(),
        MAINTENANCE_OPERATION: operation,
      },
    },
  );
  child.stdout?.resume();
  child.stderr?.resume();
  return new Promise<T>((resolve, reject) => {
    let result: unknown;
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      child.kill('SIGKILL');
    }, 30000);
    child.on('message', (message) => {
      result = message;
    });
    child.once('error', () => {
      clearTimeout(timeout);
      reject(new Error('Sync maintenance process failed to start'));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      const parsed = schema.safeParse(result);
      if (expired || code !== 0 || !parsed.success)
        reject(new Error('Sync maintenance process failed'));
      else resolve(parsed.data);
    });
  });
}
