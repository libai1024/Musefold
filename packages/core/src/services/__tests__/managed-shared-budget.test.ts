import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { registerAutomationSpendSchema } from '@musefold/desktop-contracts/automation-spend';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationSpendRepository } from '../../db/repositories/automation-spend';
import { ManagedExecutionRepository } from '../../db/repositories/managed-execution';
import { ManagedExecutionGuard } from '../managed-execution-guard';
import { EncryptedManagedAnchorFile } from '../managed-execution-anchor-file';
import { ManagedGenerationLedger } from '../managed-generation-ledger';
import { fixtureCipher } from './fixtures/managed-anchor-cipher';
import { managedCommand } from './fixtures/managed-generation';

const now = Date.UTC(2026, 8, 8);
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'musefold-shared-budget-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const db = new Database(join(root, 'data.db'));
  cleanup.push(() => db.close());
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  const spend = new AutomationSpendRepository(db);
  spend.initializeBudget({ monthlyLimitPoints: 10, usedPoints: 1, month: '2026-09' }, now);
  const repository = new ManagedExecutionRepository(db);
  const anchor = new EncryptedManagedAnchorFile(join(root, 'anchor'), fixtureCipher);
  const guard = new ManagedExecutionGuard(repository, anchor);
  const ledger = new ManagedGenerationLedger(db, guard, () => {});
  return { root, db, spend, repository, anchor, guard, ledger };
}
function command(external = false) {
  return registerAutomationSpendSchema.parse({
    idempotencyKey: randomUUID(),
    action: 'generate_image',
    caller: 'fixture',
    input: {},
    frozenInput: {},
    bindings: [
      {
        providerId: 'fixture',
        providerType: 'openai-compatible',
        model: 'fixture',
        baseUrl: 'https://fixture.example.invalid',
        credentialEpoch: 'fixture-epoch',
        payerKind: external ? 'external' : 'account',
        policy: external ? 'external' : 'managed',
        ownerId: external ? null : 'fixture-owner',
        issuer: external ? null : 'https://fixture.example.invalid',
      },
    ],
    promptText: null,
    executionId: randomUUID(),
    maxImageCalls: 1,
    maxTextCalls: 0,
    estimatedPoints: 3,
    now,
  });
}

describe('shared budget checkpoint enforcement', () => {
  it('rejects async legacy writes before invoking them and rolls back an accidental thenable result', async () => {
    const f = fixture();
    let invoked = false;
    await expect(
      f.guard.coordinateBudget({}, () => ({
        change: async () => {
          invoked = true;
          f.spend.setBudgetLimit(99, now);
        },
      })),
    ).rejects.toMatchObject({ code: 'MANAGED_ASYNC_TRANSACTION' });
    expect(invoked).toBe(false);
    await expect(
      f.guard.coordinateBudget({}, () => ({
        change: () => {
          f.spend.setBudgetLimit(99, now);
          return Promise.resolve();
        },
      })),
    ).rejects.toMatchObject({ code: 'MANAGED_ASYNC_TRANSACTION' });
    expect(f.spend.budget(now).monthlyLimitPoints).toBe(10);
    expect(f.repository.checkpoint()).toBeNull();
    expect(await f.anchor.read()).toBeNull();
  });

  it('keeps legacy initialization and budget writes before enablement without creating an anchor', async () => {
    const f = fixture();
    await f.guard.coordinateBudget({ points: 8 }, () => ({
      change: () => f.spend.setBudgetLimit(8, now),
    }));
    expect(f.spend.budget(now).monthlyLimitPoints).toBe(8);
    expect(f.repository.checkpoint()).toBeNull();
    expect(await f.anchor.read()).toBeNull();
    expect(
      f.spend.initializeBudget({ monthlyLimitPoints: 999, usedPoints: 999, month: '2026-09' }, now),
    ).toBe(false);
    expect(f.spend.budget(now).usedPoints).toBe(1);
  });

  it('serializes a not-yet-enabled policy change with explicit enablement', async () => {
    const f = fixture();
    await Promise.all([
      f.guard.coordinateBudget({ points: 7 }, () => ({
        change: () => f.spend.setBudgetLimit(7, now),
      })),
      f.guard.enable(),
      f.guard.coordinateBudget({ points: 2 }, () => ({
        change: () => f.spend.recordLegacyPolicyUsage(2, now),
      })),
    ]);
    expect(f.spend.budget(now)).toMatchObject({
      monthlyLimitPoints: 7,
      usedPoints: 3,
      remainingPoints: 4,
    });
    expect(f.repository.checkpoint()?.revision).toBe(1);
    expect((await f.anchor.read())?.committed).toEqual(f.repository.checkpoint());
  });

  it('rejects raw policy, opening usage and managed registration from any repository after enablement', async () => {
    const f = fixture();
    await f.guard.enable();
    const second = new AutomationSpendRepository(f.db);
    for (const write of [
      () => second.setBudgetLimit(100, now),
      () => second.recordLegacyPolicyUsage(1, now),
      () => second.register(command()),
    ]) {
      expect(write).toThrow('MANAGED_SPEND_COORDINATOR_REQUIRED');
    }
    expect(f.spend.budget(now)).toMatchObject({
      monthlyLimitPoints: 10,
      usedPoints: 1,
      reservedPoints: 0,
    });
    expect(f.repository.checkpoint()?.revision).toBe(0);
    expect(await f.guard.status()).toMatchObject({ mode: 'active' });
    // Initialization may be replayed, but cannot recreate a lost policy under a live lineage.
    expect(
      second.initializeBudget({ monthlyLimitPoints: 999, usedPoints: 999, month: '2026-09' }, now),
    ).toBe(false);
    f.db.prepare('DELETE FROM automation_budget_periods').run();
    f.db.prepare('DELETE FROM automation_spend_policies').run();
    expect(() =>
      second.initializeBudget({ monthlyLimitPoints: 999, usedPoints: 0, month: '2026-09' }, now),
    ).toThrow('MANAGED_SPEND_COORDINATOR_REQUIRED');
  });

  it('protects old managed holds even without a remote association while keeping external BYOK usable', async () => {
    const f = fixture();
    const input = command();
    await f.guard.enable();
    // Simulate an already-enabled database containing an older unmapped request. New enablement
    // refuses unresolved legacy work; these defensive write guards must still protect old data.
    const { old, call, claim } = await f.guard.coordinateBudget({}, () => ({
      change: () => {
        const old = f.spend.register(input).request;
        const call = f.spend.prepareCall({
          requestId: old.id,
          ordinal: 0,
          kind: 'image',
          binding: input.bindings[0],
          input: {},
          generationRunId: 'old-local',
        });
        const claim = f.spend.claimCall(call.id, input.bindings[0], 'old-runtime', now);
        return { old, call, claim };
      },
    }));
    for (const write of [
      () => f.spend.beginExecution(old.id),
      () =>
        f.spend.prepareCall({
          requestId: old.id,
          ordinal: 0,
          kind: 'image',
          binding: input.bindings[0],
          input: {},
          generationRunId: 'old-local',
        }),
      () => f.spend.claimCall(call.id, input.bindings[0], 'new-runtime', now),
      () =>
        f.spend.completeCall(
          call.id,
          claim?.claimId ?? '',
          { reportedPoints: 0, source: 'provider_reported', evidenceRef: null },
          now,
        ),
      () => f.spend.finishRequest(old.id, 'cancelled', now),
    ])
      expect(write).toThrow('MANAGED_SPEND_COORDINATOR_REQUIRED');
    expect(f.spend.recover('new-runtime', now)).toBe(0);
    expect(f.spend.get(old.id)?.state).toBe('running');
    const external = command(true);
    const request = f.spend.register(external).request;
    const ownCall = f.spend.prepareCall({
      requestId: request.id,
      ordinal: 0,
      kind: 'image',
      binding: external.bindings[0],
      input: {},
      generationRunId: 'byok-local',
    });
    const ownClaim = f.spend.claimCall(ownCall.id, external.bindings[0], 'current', now);
    f.spend.completeCall(
      ownCall.id,
      ownClaim?.claimId ?? '',
      { reportedPoints: null, source: 'unknown', evidenceRef: null },
      now,
    );
    f.spend.finishRequest(request.id, 'success', now);
    expect(f.spend.budget(now)).toMatchObject({
      usedPoints: 1,
      reservedPoints: 3,
      hasUnknown: false,
    });
    expect(f.repository.checkpoint()?.revision).toBe(1);
  });

  it('requires checkpoint coordination for a legacy managed confirmation and preserves unbound rejection', async () => {
    const f = fixture();
    f.spend.setBudgetLimit(0, now);
    await f.guard.enable();
    const pending = await f.guard.coordinateBudget({}, () => ({
      change: () => f.spend.register(command()).request,
    }));
    expect(() => f.spend.resolveConfirmation(pending.confirmationId ?? '', true, now)).toThrow(
      'MANAGED_SPEND_COORDINATOR_REQUIRED',
    );
    await f.guard.coordinateBudget({ id: pending.id, approved: false }, () => ({
      change: () => f.spend.resolveConfirmation(pending.confirmationId ?? '', false, now),
    }));
    expect(f.spend.get(pending.id)?.outcome).toBe('denied');
    const unbound = command();
    unbound.bindings[0] = {
      ...unbound.bindings[0],
      payerKind: 'unbound',
      ownerId: null,
      issuer: null,
    };
    expect(f.spend.register(unbound).request).toMatchObject({
      state: 'terminal',
      errorCode: 'PAYMENT_IDENTITY_UNBOUND',
    });
    expect(f.spend.budget(now).reservedPoints).toBe(0);
  });

  it('serializes new cloud reservations with the shared policy rather than spending a stale budget', async () => {
    const f = fixture();
    await f.guard.enable();
    const a = { ...managedCommand(), estimatedPoints: 5 };
    const b = { ...a, callerKey: randomUUID(), executionId: randomUUID() };
    const [, first, second] = await Promise.all([
      f.guard.coordinateBudget({ points: 7 }, () => ({
        change: () => f.spend.setBudgetLimit(7, now),
      })),
      f.ledger.register(a),
      f.ledger.register(b),
    ]);
    expect(f.spend.get(first.record.requestId)?.approvalSource).toBe('budget');
    expect(f.spend.get(second.record.requestId)?.state).toBe('pending_confirmation');
    expect(f.spend.budget(now)).toMatchObject({
      monthlyLimitPoints: 7,
      usedPoints: 1,
      reservedPoints: 5,
      remainingPoints: 1,
    });
    expect(f.repository.checkpoint()?.revision).toBe(3);
  });

  it('leaves unknown across months after a policy increase and compatibility usage posting', async () => {
    const f = fixture();
    await f.guard.enable();
    const input = managedCommand();
    const { record } = await f.ledger.register(input);
    await f.ledger.claimSubmission(
      record.requestId,
      {
        apiIssuer: input.binding.apiIssuer,
        principalId: input.binding.principalId,
        authEpoch: input.authEpoch,
      },
      input.binding,
      'local',
      now,
    );
    const next = Date.UTC(2026, 9, 1);
    await f.guard.coordinateBudget({ points: 100 }, () => ({
      change: () => f.spend.setBudgetLimit(100, next),
    }));
    await f.guard.coordinateBudget({ points: 2 }, () => ({
      change: () => f.spend.recordLegacyPolicyUsage(2, next),
    }));
    expect(f.spend.budget(next)).toMatchObject({
      monthlyLimitPoints: 100,
      usedPoints: 2,
      hasUnknown: true,
      remainingPoints: 0,
    });
    expect(f.spend.budget(now).usedPoints).toBe(1);
  });

  it('refuses budget changes against an older backup or missing anchor without rebuilding either', async () => {
    const f = fixture();
    const old = f.db.serialize();
    await f.guard.enable();
    const backup = new Database(old);
    cleanup.push(() => backup.close());
    const oldSpend = new AutomationSpendRepository(backup);
    const oldGuard = new ManagedExecutionGuard(new ManagedExecutionRepository(backup), f.anchor);
    await expect(
      oldGuard.coordinateBudget({}, () => ({ change: () => oldSpend.setBudgetLimit(999, now) })),
    ).rejects.toMatchObject({ code: 'MANAGED_RECONCILIATION_REQUIRED' });
    expect(oldSpend.budget(now).monthlyLimitPoints).toBe(10);
    const missing = new ManagedExecutionGuard(f.repository, {
      scope: join(f.root, 'missing'),
      read: async () => null,
      write: vi.fn(),
    });
    await expect(
      missing.coordinateBudget({}, () => ({ change: () => f.spend.setBudgetLimit(999, now) })),
    ).rejects.toMatchObject({ code: 'MANAGED_RECONCILIATION_REQUIRED' });
    expect(f.spend.budget(now).monthlyLimitPoints).toBe(10);
  });

  it('rolls back a failed usage write with its checkpoint, retains pending and blocks further changes', async () => {
    const f = fixture();
    await f.guard.enable();
    f.db.exec(
      "CREATE TRIGGER reject_usage BEFORE UPDATE ON automation_budget_periods BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END",
    );
    await expect(
      f.guard.coordinateBudget({}, () => ({
        change: () => {
          f.spend.setBudgetLimit(99, now);
          f.spend.recordLegacyPolicyUsage(2, now);
        },
      })),
    ).rejects.toThrow('fixture write failure');
    expect(f.spend.budget(now)).toMatchObject({ monthlyLimitPoints: 10, usedPoints: 1 });
    expect(f.repository.checkpoint()?.revision).toBe(0);
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
    await expect(
      f.guard.coordinateBudget({}, () => ({ change: () => f.spend.setBudgetLimit(50, now) })),
    ).rejects.toMatchObject({ code: 'MANAGED_RECONCILIATION_REQUIRED' });
  });
});
