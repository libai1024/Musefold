import { readFileSync } from 'node:fs';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { generationExecutionReceipts } from '../schema/generation-execution-receipts.js';
import { generationRuns } from '../schema/workbench.js';

describe('durable generation receipt schema and expand migration', () => {
  it('keeps receipt identity independent of every deletable parent and fences run ownership', () => {
    const receipt = getTableConfig(generationExecutionReceipts);
    expect(receipt.foreignKeys).toEqual([]);
    expect(
      receipt.uniqueConstraints
        .find((key) => key.name === 'generation_execution_receipts_principal_key_unique')
        ?.columns.map((column) => column.name),
    ).toEqual(['principal_id', 'idempotency_key']);
    const run = getTableConfig(generationRuns);
    const reference = run.foreignKeys.find(
      (key) => key.getName() === 'generation_runs_receipt_principal_fk',
    );
    expect(reference?.reference().columns.map((column) => column.name)).toEqual([
      'execution_receipt_id',
      'user_id',
    ]);
    expect(reference?.reference().foreignColumns.map((column) => column.name)).toEqual([
      'id',
      'principal_id',
    ]);
    expect(reference?.onDelete).not.toBe('cascade');
    expect(generationRuns.executionReceiptId.notNull).toBe(false);
    for (const secretColumn of ['ciphertext', 'token', 'api_key', 'prompt']) {
      expect(receipt.columns.map((column) => column.name)).not.toContain(secretColumn);
    }
  });

  it('requires bound provenance and rejects unknown numeric cost at the database boundary', () => {
    const dialect = new PgDialect();
    const checks = Object.fromEntries(
      getTableConfig(generationExecutionReceipts).checks.map((check) => [
        check.name,
        dialect.sqlToQuery(check.value).sql,
      ]),
    );
    expect(checks.generation_execution_receipts_binding_check).toContain(
      '"auth_revision" IS NOT NULL',
    );
    expect(checks.generation_execution_receipts_binding_check).toContain(
      "->>'principalId' IS NOT NULL",
    );
    expect(checks.generation_execution_receipts_binding_check).toContain(
      '"logical_input_digest" IS NOT NULL',
    );
    expect(checks.generation_execution_receipts_binding_check).toContain(
      '"final_request_digest" IS NOT NULL',
    );
    expect(checks.generation_execution_receipts_cost_check).toContain(
      '<> \'unknown\' OR "generation_execution_receipts"."cost_points" IS NULL',
    );
    expect(checks.generation_execution_receipts_operation_check).toContain(
      "<> 'legacy_unknown' OR",
    );
    expect(generationExecutionReceipts.costPoints.notNull).toBe(false);
  });

  it('backfills only old keyed runs without trusting current identities, deriving a bill, or dropping historical rows', () => {
    const migration = readFileSync(
      new URL('../../migrations/0011_generation_execution_receipts.sql', import.meta.url),
      'utf8',
    );
    const backfill = migration.slice(
      migration.indexOf('INSERT INTO "generation_execution_receipts"'),
    );
    expect(backfill).toContain('WHERE r."idempotency_key" IS NOT NULL');
    expect(backfill).toContain('WHEN r."design_scheme_run_id" IS NOT NULL THEN \'scheme_run\'');
    expect(backfill).toContain("WHEN r.\"run_kind\" = 'retry' THEN 'legacy_unknown'");
    expect(backfill).toContain(
      'CASE WHEN r."design_scheme_run_id" IS NULL AND r."run_kind" = \'retry\'',
    );
    expect(backfill).toContain('THEN r."parent_run_id" ELSE NULL END');
    expect(backfill).toContain("'legacy_unbound'");
    expect(backfill).toContain("'unknown', NULL");
    expect(backfill).not.toContain('account_credentials');
    expect(backfill).not.toContain('account_identities');
    expect(backfill).not.toContain('r."cost_points"');
    expect(migration).not.toMatch(/(?:^|\n)\s*(?:DELETE\s+FROM|DROP\s+)/i);
    expect(migration).not.toContain('ON DELETE cascade');
    const journal = JSON.parse(
      readFileSync(new URL('../../migrations/meta/_journal.json', import.meta.url), 'utf8'),
    );
    expect(journal.entries[11]).toMatchObject({
      idx: 11,
      tag: '0011_generation_execution_receipts',
    });
    const previous = JSON.parse(
      readFileSync(new URL('../../migrations/meta/0010_snapshot.json', import.meta.url), 'utf8'),
    );
    const current = JSON.parse(
      readFileSync(new URL('../../migrations/meta/0011_snapshot.json', import.meta.url), 'utf8'),
    );
    expect(current.prevId).toBe(previous.id);
    expect(current.tables['public.generation_execution_receipts'].foreignKeys).toEqual({});
  });
});
