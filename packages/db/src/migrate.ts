import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { MusefoldDatabase } from './client.js';

/** 程序化应用 packages/db/migrations(服务启动与集成测试共用同一份 SQL)。 */
export async function migrateDatabase(db: MusefoldDatabase): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
  await migrate(db, { migrationsFolder });
}
