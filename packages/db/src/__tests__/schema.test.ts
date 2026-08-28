import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from '../schema/index.js';

const EXPECTED_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'jwks',
  'oauth_client',
  'oauth_resource',
  'oauth_client_resource',
  'oauth_refresh_token',
  'oauth_access_token',
  'oauth_consent',
  'account_credentials',
  'relay_sessions',
  'rate_limit_buckets',
  'prompt_folders',
  'prompt_tags',
  'prompts',
  'prompt_tag_links',
  'prompt_usage_events',
  'sync_devices',
  'sync_change_log',
  'sync_mutation_results',
  'sync_retention_state',
  'workbench_sessions',
  'generation_runs',
  'generation_assets',
  'generation_events',
  'published_skills',
];

describe('Drizzle schema', () => {
  it('导出全部业务与 Better Auth 表', () => {
    const tableNames = Object.values(schema)
      .filter((value) => typeof value === 'object' && value !== null)
      .flatMap((value) => {
        try {
          return [getTableName(value as never)];
        } catch {
          return [];
        }
      });
    for (const expected of EXPECTED_TABLES) {
      expect(tableNames, `缺表 ${expected}`).toContain(expected);
    }
  });

  it('迁移目录包含初始 SQL 且覆盖全部表', () => {
    const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const sql = files.map((file) => readFileSync(`${migrationsDir}/${file}`, 'utf8')).join('\n');
    for (const expected of EXPECTED_TABLES) {
      expect(sql, `迁移缺表 ${expected}`).toContain(`"${expected}"`);
    }
  });
});
