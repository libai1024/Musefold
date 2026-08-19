import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

export interface HeartbeatHandle {
  stop(): Promise<void>;
}

export async function startHeartbeat(
  databaseUrl: string,
  intervalMs: number,
): Promise<HeartbeatHandle> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    application_name: 'musefold-generation-worker-heartbeat',
  });
  const workerId = randomUUID();
  const startedAt = new Date();

  const beat = async () => {
    await pool.query(
      `
      INSERT INTO ops.worker_heartbeats (worker_id, worker_kind, version, started_at, heartbeat_at)
      VALUES ($1, 'generation', '1.1.0-dev', $2, now())
      ON CONFLICT (worker_id) DO UPDATE SET heartbeat_at = excluded.heartbeat_at
    `,
      [workerId, startedAt],
    );
  };

  await beat();
  const timer = setInterval(
    () => void beat().catch(() => undefined),
    intervalMs,
  );
  timer.unref();

  return {
    async stop() {
      clearInterval(timer);
      await pool
        .query('DELETE FROM ops.worker_heartbeats WHERE worker_id = $1', [
          workerId,
        ])
        .catch(() => undefined);
      await pool.end();
    },
  };
}
