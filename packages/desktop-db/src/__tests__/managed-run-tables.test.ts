import Database from 'better-sqlite3';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import { DESKTOP_MIGRATIONS } from '../migrations.generated';
import * as schema from '../schema';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';

/** 真实旧库结构(0000–0012)→ 迁移 0013 → 断言新表结构与数据保留(M 系迁移纪律的就地测试)。 */
function apply(db: Database.Database, migrations: MigrationMeta[]) {
  for (const migration of migrations) for (const sql of migration.sql) db.exec(sql);
}

describe('managed run tables migration 0013', () => {
  let db: Database.Database;
  beforeAll(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    apply(db, DESKTOP_MIGRATIONS.slice(0, 13));
    db.exec(
      `INSERT INTO automation_spend_policies(scope_id, monthly_limit_points, revision, imported_at, updated_at)
       VALUES ('local-automation-v1', 10, 1, 1, 1)`,
    );
    db.exec(
      `INSERT INTO automation_spend_requests(id, scope_id, idempotency_key, input_hash, action, caller,
        frozen_input_json, bindings_json, prompt_text, execution_id, max_image_calls, max_text_calls,
        state, budget_month, estimated_points, reservation_state, created_at, revision)
       VALUES ('req-0013', 'local-automation-v1', NULL, '${'a'.repeat(64)}', 'run_scheme', 'fixture',
        '{}', '[]', NULL, 'ext_fixture', 2, 0, 'authorized', '2026-09', NULL, 'none', 1, 1)`,
    );
    apply(db, DESKTOP_MIGRATIONS.slice(13));
  });

  it('creates the run and child tables without touching prior data or the G association table', () => {
    for (const object of [
      "type = 'table' AND name = 'managed_run_requests'",
      "type = 'table' AND name = 'managed_run_children'",
      "name = 'idx_managed_run_child_job'",
      "name = 'idx_managed_run_child_key'",
      "name = 'idx_managed_run_child_call'",
      "name = 'idx_managed_run_child_local'",
    ]) {
      expect(db.prepare(`SELECT 1 FROM sqlite_master WHERE ${object}`).get()).toBeDefined();
    }
    expect(
      db
        .prepare('SELECT count(*) AS n FROM automation_spend_requests WHERE id = ?')
        .get('req-0013'),
    ).toEqual({ n: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM managed_generation_requests').get()).toEqual({
      n: 0,
    });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('enforces the child identity checks and unique mappings at the storage layer', () => {
    const runRecord = {
      requestId: 'req-0013',
      callerKey: 'run-key',
      namespace: '11111111-1111-4111-8111-111111111111',
      binding: {
        apiIssuer: 'https://api.example.invalid',
        principalId: 'principal-0013',
        payer: { issuer: 'https://payer.example.invalid', ownerId: 'owner-0013' },
        credential: { ref: 'credential-0013', version: 1 },
        providerId: 'cloud-default',
        model: 'musefold-image-pro',
        capabilities: { image: true, text: false },
      },
      authEpoch: '11111111-2222-4111-8111-111111111111',
      runtimeEpoch: '11111111-3333-4111-8111-111111111111',
      run: { runKind: 'run_scheme', originalJobIds: ['job-a', 'job-b'] },
      children: [],
      inputHash: 'b'.repeat(64),
      cancelRequestedAt: null,
      createdAt: 1,
      updatedAt: 1,
    };
    db.prepare(
      `INSERT INTO managed_run_requests(request_id, api_issuer, principal_id, caller_key, run_kind, record_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'req-0013',
      'https://api.example.invalid',
      'principal-0013',
      'run-key',
      'run_scheme',
      JSON.stringify(runRecord),
    );
    const child = (ordinal: number, jobId: string) =>
      JSON.stringify({
        ordinal,
        originalJobId: jobId,
        remoteKey: `desktop-rs-v1:child-${jobId}`,
        callId: null,
        localGenerationId: null,
        submissionState: 'unclaimed',
        receipt: null,
        cancelAcknowledgedAt: null,
      });
    db.prepare(
      `INSERT INTO managed_run_children(request_id, ordinal, original_job_id, remote_key, record_json)
       VALUES (?, 0, 'job-a', 'desktop-rs-v1:child-job-a', ?)`,
    ).run('req-0013', child(0, 'job-a'));
    // remoteKey 全局唯一:不同 run 也不得复用同一子键。
    expect(() =>
      db
        .prepare(
          `INSERT INTO managed_run_children(request_id, ordinal, original_job_id, remote_key, record_json)
           VALUES (?, 1, 'job-b', 'desktop-rs-v1:child-job-a', ?)`,
        )
        .run('req-0013', child(1, 'job-b').replace('child-job-b', 'child-job-a')),
    ).toThrow();
    // 身份 CHECK:record_json 与列不一致即拒绝。
    expect(() =>
      db
        .prepare(
          `INSERT INTO managed_run_children(request_id, ordinal, original_job_id, remote_key, record_json)
           VALUES (?, 1, 'job-b', 'desktop-rs-v1:child-job-b', ?)`,
        )
        .run('req-0013', child(9, 'job-b')),
    ).toThrow();
    // run_kind CHECK 与外键:非法 run_kind / 不存在的 request_id 均拒绝。
    expect(() =>
      db
        .prepare(
          `INSERT INTO managed_run_requests(request_id, api_issuer, principal_id, caller_key, run_kind, record_json)
           VALUES ('missing-parent', 'https://api.example.invalid', 'p', 'k', 'generate_image', '{}')`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO managed_run_children(request_id, ordinal, original_job_id, remote_key, record_json)
           VALUES ('missing-parent', 0, 'job-x', 'desktop-rs-v1:child-job-x', ?)`,
        )
        .run(child(0, 'job-x')),
    ).toThrow();
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('keeps the drizzle schema shape aligned with the migrated storage', () => {
    const handle = drizzle(db, { schema });
    expect(
      handle
        .select({ id: schema.automationSpendRequests.id })
        .from(schema.automationSpendRequests)
        .limit(1)
        .all(),
    ).toEqual([{ id: 'req-0013' }]);
    expect(
      handle
        .select({ scope: schema.automationSpendPolicies.scopeId })
        .from(schema.automationSpendPolicies)
        .all(),
    ).toEqual([{ scope: 'local-automation-v1' }]);
    expect(
      handle
        .select({
          requestId: schema.managedRunRequests.requestId,
          runKind: schema.managedRunRequests.runKind,
        })
        .from(schema.managedRunRequests)
        .all(),
    ).toEqual([{ requestId: 'req-0013', runKind: 'run_scheme' }]);
    expect(
      handle
        .select({ ordinal: schema.managedRunChildren.ordinal })
        .from(schema.managedRunChildren)
        .all(),
    ).toEqual([{ ordinal: 0 }]);
  });
});
