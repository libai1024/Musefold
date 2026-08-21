import { runMigrations } from 'graphile-worker';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required for queue migrations');
}

await runMigrations({ connectionString });
