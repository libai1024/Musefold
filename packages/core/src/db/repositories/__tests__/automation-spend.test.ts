import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { DESKTOP_MIGRATIONS } from '@musefold/desktop-db/migrations.generated';
import {
  automationCostEvidenceSchema,
  automationPayerBindingSchema,
  type AutomationPayerBinding,
  type RegisterAutomationSpend,
} from '@musefold/desktop-contracts/automation-spend';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationSpendRepository, normalizeLegacyAutomationBudget } from '../automation-spend';

const now = Date.UTC(2026, 8, 7);
const nextMonth = Date.UTC(2026, 9, 1);
const bindings: AutomationPayerBinding[] = [
  {
    providerId: 'fixture-image-provider',
    providerType: 'openai-compatible',
    model: 'fixture-model',
    baseUrl: 'http://127.0.0.1:12345/v1',
    credentialEpoch: 'fixture-key-revision',
    payerKind: 'account',
    ownerId: 'fixture-owner',
    issuer: 'http://127.0.0.1:12346',
    policy: 'managed',
  },
];
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});

function database() {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-spend-repository-'));
  const path = join(dir, 'local.db');
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  cleanup.push(() => db.open && db.close());
  takeoverDesktopDatabase(db);
  const repository = new AutomationSpendRepository(db);
  repository.initializeBudget({ monthlyLimitPoints: 10, usedPoints: 0, month: '2026-09' }, now);
  return { db, path, repository };
}

function command(patch: Partial<RegisterAutomationSpend> = {}): RegisterAutomationSpend {
  return {
    idempotencyKey: 'fixture-request-key',
    action: 'generate_image',
    caller: 'fixture-local-client',
    input: { prompt: 'fixture prompt' },
    frozenInput: { prompt: 'fixture prompt', n: 1 },
    bindings,
    promptText: 'fixture prompt',
    executionId: 'fixture-job',
    maxImageCalls: 1,
    maxTextCalls: 0,
    estimatedPoints: 5,
    now,
    ...patch,
  };
}

function claimed(repository: AutomationSpendRepository, input = command()) {
  const { request } = repository.register(input);
  const call = repository.prepareCall({
    requestId: request.id,
    ordinal: 0,
    kind: 'image',
    binding: bindings[0],
    input: { prompt: 'fixture prompt' },
    generationRunId: input.executionId,
  });
  const claim = repository.claimCall(call.id, bindings[0], 'fixture-runtime', now + 1);
  if (!claim?.claimId) throw new Error('Expected a dispatch claim');
  return { request, call, claimId: claim.claimId };
}

describe('durable local spend policy and identities', () => {
  it('imports legacy usage once and preserves fractional points without inventing account balance', () => {
    const { repository } = database();
    expect(
      repository.initializeBudget(
        { monthlyLimitPoints: 900, usedPoints: 900, month: '2026-09' },
        now,
      ),
    ).toBe(false);
    expect(repository.budget(now)).toMatchObject({ monthlyLimitPoints: 10, usedPoints: 0 });
    expect(
      normalizeLegacyAutomationBudget(
        { monthlyLimitCents: 25, usedCents: 3, month: '2026-08' },
        now,
      ),
    ).toEqual({ monthlyLimitPoints: 2.5, usedPoints: 0.3, month: '2026-08' });
    expect(() =>
      normalizeLegacyAutomationBudget({ monthlyLimitPoints: Number.NaN }, now),
    ).toThrow();
  });

  it('imports a previous month as historical opening usage and reports zero in the current month', () => {
    const { db } = database();
    const repository = new AutomationSpendRepository(db, 'fixture-another-scope');
    repository.initializeBudget(
      { monthlyLimitPoints: 12.5, usedPoints: 9.5, month: '2026-08' },
      now,
    );
    expect(repository.budget(now)).toMatchObject({
      monthlyLimitPoints: 12.5,
      usedPoints: 0,
      remainingPoints: 12.5,
    });
    expect(repository.budget(Date.UTC(2026, 7, 31))).toMatchObject({
      usedPoints: 9.5,
      remainingPoints: 3,
    });
  });

  it('uses one request key scope across actions and freezes both inputs and payment binding', () => {
    const { repository } = database();
    const first = repository.register(command());
    expect(repository.register(command({ executionId: 'unused-new-job' }))).toEqual({
      request: first.request,
      replayed: true,
    });
    for (const patch of [
      { action: 'run_scheme' as const },
      { input: { prompt: 'different' } },
      { frozenInput: { prompt: 'different resolved input' } },
      { bindings: [{ ...bindings[0], ownerId: 'fixture-other-owner' }] },
      { bindings: [{ ...bindings[0], credentialEpoch: 'fixture-other-key' }] },
    ])
      expect(() => repository.register(command(patch))).toThrow(
        /different input or payment identity/,
      );
    expect(repository.budget(now).reservedPoints).toBe(5);
  });

  it('records unbound payer as rejected without guessing current account or admitting a send', () => {
    const { repository, db } = database();
    const { request } = repository.register(
      command({
        bindings: [{ ...bindings[0], payerKind: 'unbound', ownerId: null, issuer: null }],
      }),
    );
    expect(request).toMatchObject({
      state: 'terminal',
      outcome: 'failed',
      errorCode: 'PAYMENT_IDENTITY_UNBOUND',
      approvalSource: null,
      reservationState: 'none',
    });
    expect(() =>
      repository.prepareCall({
        requestId: request.id,
        ordinal: 0,
        kind: 'image',
        binding: bindings[0],
        input: {},
        generationRunId: null,
      }),
    ).toThrow(/not authorized/);
    expect(repository.budget(now).remainingPoints).toBe(10);
    expect(db.prepare('SELECT COUNT(*) AS n FROM automation_audit').get()).toEqual({ n: 1 });
    expect(automationPayerBindingSchema.safeParse({ ...bindings[0], ownerId: null }).success).toBe(
      false,
    );
  });

  it.each([0, 5, null])(
    'requires an independent confirmation for zero budget even when estimate is %s',
    (estimatedPoints) => {
      const { repository } = database();
      repository.setBudgetLimit(0, now);
      const first = repository.register(command({ estimatedPoints })).request;
      expect(first.state).toBe('pending_confirmation');
      expect(repository.resolveConfirmation(first.confirmationId ?? '', true, now + 1)).toBe(true);
      expect(repository.resolveConfirmation(first.confirmationId ?? '', true, now + 2)).toBe(false);
      expect(
        repository.register(
          command({
            estimatedPoints,
            idempotencyKey: 'fixture-second-key',
            executionId: 'fixture-second-job',
          }),
        ).request.state,
      ).toBe('pending_confirmation');
    },
  );

  it('keeps rejection and absolute confirmation deadlines after reconnect', () => {
    const { repository, db } = database();
    repository.setBudgetLimit(0, now);
    const request = repository.register(command()).request;
    const reopened = new AutomationSpendRepository(db);
    expect(reopened.resolveConfirmation(request.confirmationId ?? '', true, now + 120_000)).toBe(
      false,
    );
    expect(reopened.get(request.id)).toMatchObject({ state: 'terminal', outcome: 'timeout' });
    expect(reopened.register(command()).replayed).toBe(true);
    expect(reopened.resolveConfirmation(request.confirmationId ?? '', true, now + 120_001)).toBe(
      false,
    );
    expect(db.prepare('SELECT COUNT(*) AS n FROM automation_audit').get()).toEqual({ n: 1 });
  });

  it('serializes independent connections competing for the remaining budget', () => {
    const { repository, path } = database();
    const second = new Database(path);
    cleanup.push(() => second.close());
    const other = new AutomationSpendRepository(second);
    expect(repository.register(command({ estimatedPoints: 8 })).request.state).toBe('authorized');
    expect(
      other.register(
        command({
          idempotencyKey: 'fixture-second',
          executionId: 'fixture-second-job',
          estimatedPoints: 8,
        }),
      ).request.state,
    ).toBe('pending_confirmation');
    expect(other.budget(now)).toMatchObject({ reservedPoints: 8, remainingPoints: 2 });
  });

  it('blocks automatic budget while a confirmed unknown estimate is in flight', () => {
    const { repository } = database();
    const first = repository.register(
      command({ estimatedPoints: null, consent: 'interactive' }),
    ).request;
    expect(first.reservationState).toBe('unknown');
    expect(
      repository.register(
        command({
          idempotencyKey: 'fixture-second',
          executionId: 'fixture-second-job',
          estimatedPoints: 1,
        }),
      ).request.state,
    ).toBe('pending_confirmation');
    expect(repository.budget(nextMonth)).toMatchObject({
      usedPoints: 0,
      hasUnknown: true,
      remainingPoints: 0,
    });
  });

  it('enforces frozen image and text identities and a finite call plan at the repository boundary', () => {
    const { repository } = database();
    const textBinding: AutomationPayerBinding = {
      ...bindings[0],
      providerId: 'fixture-text-provider',
      model: 'fixture-text-model',
    };
    const request = repository.register(
      command({ bindings: [bindings[0], textBinding], maxTextCalls: 1 }),
    ).request;
    const text = repository.prepareCall({
      requestId: request.id,
      ordinal: 0,
      kind: 'text',
      binding: textBinding,
      input: { prompt: 'text fixture' },
      generationRunId: null,
    });
    expect(() =>
      repository.claimCall(text.id, { ...textBinding, credentialEpoch: 'changed' }, 'runtime', now),
    ).toThrow(/identity changed/);
    expect(repository.claimCall(text.id, textBinding, 'runtime', now)?.state).toBe('started');
    expect(repository.claimCall(text.id, textBinding, 'other-runtime', now)).toBeNull();
    expect(() =>
      repository.prepareCall({
        requestId: request.id,
        ordinal: 1,
        kind: 'text',
        binding: textBinding,
        input: {},
        generationRunId: null,
      }),
    ).toThrow(/call limit/);
    expect(() =>
      repository.prepareCall({
        requestId: request.id,
        ordinal: 1,
        kind: 'image',
        binding: { ...bindings[0], model: 'changed' },
        input: {},
        generationRunId: null,
      }),
    ).toThrow(/not authorized/);
  });
});

describe('cost provenance, terminal audit and recovery', () => {
  it.each(['success', 'failed', 'cancelled'] as const)(
    'posts executor cost once for %s and keeps estimate provenance separate from billing proof',
    (outcome) => {
      const { repository, db } = database();
      const { request, call, claimId } = claimed(repository);
      const evidence = {
        reportedPoints: 2.5,
        source: 'local_price_estimate' as const,
        evidenceRef: null,
      };
      expect(repository.completeCall(call.id, claimId, evidence, now + 2)).toBe(true);
      expect(repository.completeCall(call.id, claimId, evidence, now + 3)).toBe(false);
      repository.finishRequest(request.id, outcome, now + 4);
      repository.finishRequest(request.id, outcome, now + 5);
      expect(repository.budget(now)).toMatchObject({
        usedPoints: 2.5,
        reservedPoints: 0,
        remainingPoints: 7.5,
      });
      expect(repository.calls(request.id)[0]).toMatchObject({
        reportedPoints: 2.5,
        policyPoints: 2.5,
        costSource: 'local_price_estimate',
        evidenceRef: null,
      });
      expect(db.prepare('SELECT COUNT(*) AS n FROM automation_audit').get()).toEqual({ n: 1 });
      expect(
        automationCostEvidenceSchema.safeParse({ ...evidence, source: 'verified_charge' }).success,
      ).toBe(false);
      expect(() =>
        repository.completeCall(call.id, claimId, { ...evidence, reportedPoints: 8 }, now + 9),
      ).toThrow(/different cost evidence/);
    },
  );

  it('preserves explicit zero, while unknown retains protection after close/open and old-month recovery', () => {
    const { repository, db, path } = database();
    const first = claimed(repository);
    repository.completeCall(
      first.call.id,
      first.claimId,
      { reportedPoints: 0, source: 'provider_reported', evidenceRef: null },
      now,
    );
    repository.finishRequest(first.request.id, 'success', now);
    expect(repository.budget(now)).toMatchObject({
      usedPoints: 0,
      hasUnknown: false,
      remainingPoints: 10,
    });
    const second = claimed(
      repository,
      command({ idempotencyKey: 'fixture-unknown', executionId: 'fixture-unknown-job' }),
    );
    repository.completeCall(
      second.call.id,
      second.claimId,
      { reportedPoints: null, source: 'unknown', evidenceRef: null },
      now,
    );
    repository.finishRequest(second.request.id, 'cancelled', now);
    db.close();
    const reopened = new Database(path);
    cleanup.push(() => reopened.close());
    const recovered = new AutomationSpendRepository(reopened);
    expect(recovered.get(second.request.id)?.reservationState).toBe('unknown');
    expect(recovered.budget(nextMonth)).toMatchObject({ hasUnknown: true, remainingPoints: 0 });
    expect(() =>
      recovered.completeCall(
        second.call.id,
        second.claimId,
        { reportedPoints: 0, source: 'provider_reported', evidenceRef: null },
        nextMonth,
      ),
    ).toThrow(/different cost evidence/);
  });

  it('does not post external-provider cost into the local managed policy', () => {
    const { repository } = database();
    const external: AutomationPayerBinding = {
      ...bindings[0],
      payerKind: 'external',
      ownerId: null,
      issuer: null,
      policy: 'external',
    };
    const request = repository.register(
      command({ bindings: [external], estimatedPoints: null }),
    ).request;
    const call = repository.prepareCall({
      requestId: request.id,
      ordinal: 0,
      kind: 'image',
      binding: external,
      input: {},
      generationRunId: 'fixture-job',
    });
    const claim = repository.claimCall(call.id, external, 'runtime', now);
    repository.completeCall(
      call.id,
      claim?.claimId ?? '',
      { reportedPoints: 5, source: 'provider_reported', evidenceRef: null },
      now,
    );
    repository.finishRequest(request.id, 'success', now);
    expect(repository.budget(now)).toMatchObject({ usedPoints: 0, remainingPoints: 10 });
    expect(repository.calls(request.id)[0]).toMatchObject({
      reportedPoints: 5,
      policyPoints: null,
    });
  });

  it('rolls back terminal state and reservation release when audit insertion fails', () => {
    const { repository, db } = database();
    const { request, call, claimId } = claimed(repository);
    repository.completeCall(
      call.id,
      claimId,
      { reportedPoints: 3, source: 'provider_reported', evidenceRef: null },
      now,
    );
    db.exec(
      "CREATE TRIGGER fixture_fail_audit BEFORE INSERT ON automation_audit BEGIN SELECT RAISE(ABORT, 'fixture audit unavailable'); END",
    );
    expect(() => repository.finishRequest(request.id, 'success', now)).toThrow(/audit unavailable/);
    expect(repository.get(request.id)).toMatchObject({
      state: 'running',
      reservationState: 'held',
    });
    db.exec('DROP TRIGGER fixture_fail_audit');
    repository.finishRequest(request.id, 'success', now);
    expect(repository.budget(now)).toMatchObject({ usedPoints: 3, remainingPoints: 7 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM automation_audit').get()).toEqual({ n: 1 });
  });

  it('marks a committed send marker unknown on restart and refuses a second claim or implicit reconciliation', () => {
    const { repository } = database();
    const { request, call, claimId } = claimed(repository);
    expect(repository.recover('fixture-new-runtime', now + 5)).toBe(1);
    expect(repository.calls(request.id)[0].state).toBe('unknown');
    expect(repository.get(request.id)).toMatchObject({
      state: 'terminal',
      outcome: 'failed',
      reservationState: 'unknown',
    });
    expect(repository.claimCall(call.id, bindings[0], 'fixture-new-runtime', now + 7)).toBeNull();
    expect(() =>
      repository.completeCall(
        call.id,
        claimId,
        { reportedPoints: 2, source: 'provider_reported', evidenceRef: null },
        now + 8,
      ),
    ).toThrow();
    expect(repository.recover('fixture-new-runtime', now + 9)).toBe(0);
  });

  it('releases only definitely unsent work and posts delayed known costs to the captured UTC month', () => {
    const { repository } = database();
    const unsent = repository.register(command()).request;
    repository.recover('fixture-new-runtime', now + 1);
    expect(repository.get(unsent.id)).toMatchObject({
      outcome: 'cancelled',
      reservationState: 'released',
    });
    const pending = claimed(
      repository,
      command({ idempotencyKey: 'fixture-late', executionId: 'fixture-late-job' }),
    );
    repository.completeCall(
      pending.call.id,
      pending.claimId,
      { reportedPoints: 3, source: 'local_price_estimate', evidenceRef: null },
      nextMonth,
    );
    repository.finishRequest(pending.request.id, 'success', nextMonth);
    expect(repository.budget(now).usedPoints).toBe(3);
    expect(repository.budget(nextMonth).usedPoints).toBe(0);
  });

  it('migrates the previous managed schema without rewriting legacy audit rows or user data', () => {
    const db = new Database(':memory:');
    cleanup.push(() => db.close());
    db.exec(
      'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)',
    );
    // This regression specifically upgrades 0006 into the 0007 spend schema.
    for (const migration of DESKTOP_MIGRATIONS.slice(0, 7)) {
      for (const sql of migration.sql) db.exec(sql);
      db.prepare('INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)').run(
        migration.hash,
        migration.folderMillis,
      );
    }
    db.prepare(
      `INSERT INTO automation_audit(at, caller, action, approved_via, status, actual_points) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(now, 'fixture-legacy', 'generate_image', 'budget', 'success', 2.5);
    expect(takeoverDesktopDatabase(db).mode).toBe('noop');
    expect(
      db
        .prepare(
          'SELECT caller, actual_points, automation_request_id, event_key FROM automation_audit',
        )
        .get(),
    ).toEqual({
      caller: 'fixture-legacy',
      actual_points: 2.5,
      automation_request_id: null,
      event_key: null,
    });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });
});
