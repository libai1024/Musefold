import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['../../node_modules/vitest/vitest.mjs', 'run', 'src/__tests__/database.integration.test.ts'],
  {
    cwd: `${process.cwd()}/apps/web-api`,
    env: { ...process.env, RUN_DATABASE_TESTS: 'true' },
    stdio: 'inherit',
  },
);

process.exit(result.status ?? 1);
