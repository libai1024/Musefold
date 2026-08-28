import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type MusefoldDatabase = ReturnType<typeof createDatabase>['db'];

/** api 与 worker 共用的连接工厂;调用方负责生命周期(shutdown 时 pool.end)。 */
export function createDatabase(connectionString: string, options?: { max?: number }) {
  const pool = new pg.Pool({
    connectionString,
    max: options?.max ?? 10,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
