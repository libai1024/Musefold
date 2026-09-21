import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { DESKTOP_MIGRATIONS } from '@musefold/desktop-db/migrations.generated';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationSpendRepository } from '../../db/repositories/automation-spend';
import { ManagedExecutionRepository } from '../../db/repositories/managed-execution';
import { ManagedExecutionGuard, type ManagedExecutionAnchorPort } from '../managed-execution-guard';
import { EncryptedManagedAnchorFile } from '../managed-execution-anchor-file';
import { ManagedGenerationLedger, managedGenerationKey } from '../managed-generation-ledger';
import { fixtureCipher } from './fixtures/managed-anchor-cipher';
import { managedCommand, managedContext, managedReceipt } from './fixtures/managed-generation';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
const now = Date.UTC(2026, 8, 8);
const later = Date.UTC(2026, 9, 8);
const terminalAt = '2026-09-08T02:00:00.000Z';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-managed-generation-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'data.db');
  const db = new Database(path);
  cleanup.push(() => {
    if (db.open) db.close();
  });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  const spend = new AutomationSpendRepository(db);
  spend.initializeBudget({ monthlyLimitPoints: 10, usedPoints: 0, month: '2026-09' }, now);
  const repository = new ManagedExecutionRepository(db);
  const anchor = new EncryptedManagedAnchorFile(join(dir, 'managed.anchor'), fixtureCipher);
  let current = true;
  const assertCurrent = () => {
    if (!current) throw new Error('STALE_HOST_CONTEXT');
  };
  const guard = new ManagedExecutionGuard(repository, anchor);
  await guard.enable();
  const ledger = new ManagedGenerationLedger(db, guard, assertCurrent);
  const command = managedCommand();
  const context = managedContext(command);
  async function submitted() {
    const { record } = await ledger.register(command);
    return ledger.claimSubmission(record.requestId, context, command.binding, 'local-result', now);
  }
  return {
    dir,
    path,
    db,
    spend,
    repository,
    anchor,
    guard,
    ledger,
    command,
    context,
    submitted,
    invalidate: () => {
      current = false;
    },
    assertCurrent,
  };
}

function audits(db: Database.Database) {
  return db
    .prepare('SELECT params_json, status, actual_points FROM automation_audit ORDER BY id')
    .all();
}

describe('managed generation durable association and receipt coordination', () => {
  it('freezes model with the request and rejects a model mismatch before reserving spend', async () => {
    const f = await fixture();
    const command = { ...f.command, request: { ...f.command.request, model: 'gpt-image-2' } };
    await expect(f.ledger.register(command)).rejects.toThrow('MANAGED_MODEL_MISMATCH');
    expect(f.spend.findByKey(command.callerKey)).toBeNull();
    command.binding = { ...command.binding, model: 'gpt-image-2' };
    const { record } = await f.ledger.register(command);
    expect(record.frozenRequest.model).toBe('gpt-image-2');
    expect(record.binding.model).toBe('gpt-image-2');
    await expect(
      f.ledger.register({
        ...command,
        request: { ...command.request, model: 'musefold-image' },
        binding: { ...command.binding, model: 'musefold-image' },
      }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('persists an explicit retry parent, replays the caller key, and accepts only its retry receipt', async () => {
    const f = await fixture();
    const parent = await f.submitted();
    await f.ledger.applyReceipt(
      parent.requestId,
      f.context,
      managedReceipt(parent, {
        status: 'cancelled',
        dispatch: 'confirmed_not_sent',
        terminalAt,
      }),
      now + 1,
    );
    const prior = f.ledger.forQuery(parent.requestId, f.context);
    const command = {
      ...f.command,
      callerKey: 'new-retry-intent',
      executionId: randomUUID(),
      authEpoch: randomUUID(),
      binding: {
        ...f.command.binding,
        credential: { ...f.command.binding.credential, version: 2 },
      },
      retryOfRequestId: parent.requestId,
      consent: 'interactive' as const,
      now: now + 2,
    };
    const [first, repeat] = await Promise.all([
      f.ledger.register(command),
      f.ledger.register(command),
    ]);
    expect([first.replayed, repeat.replayed].sort()).toEqual([false, true]);
    expect(first.record).toEqual(repeat.record);
    expect(first.record.retryOf).toEqual({
      requestId: parent.requestId,
      remoteRunId: prior.receipt?.originalRunId,
    });
    expect(first.record.remoteKey).not.toBe(parent.remoteKey);
    const context = managedContext(command);
    const claimed = await f.ledger.claimSubmission(
      first.record.requestId,
      context,
      command.binding,
      'new-local-run',
      now + 3,
    );
    await expect(
      f.ledger.applyReceipt(claimed.requestId, context, managedReceipt(claimed), now + 4),
    ).rejects.toThrow('MANAGED_RECEIPT_MISMATCH');
    const receipt = managedReceipt(claimed, {
      id: 'new-receipt',
      originalRunId: 'new-remote-run',
      operation: 'explicit_retry',
      sourceRunId: prior.receipt?.originalRunId ?? null,
      status: 'failed',
      costProvenance: 'provider_reported',
      dispatch: 'claimed',
      costPoints: 2,
      terminalAt,
    });
    await f.ledger.applyReceipt(claimed.requestId, context, receipt, now + 5);
    await f.ledger.applyReceipt(claimed.requestId, context, receipt, now + 6);
    expect(f.ledger.forQuery(parent.requestId, f.context)).toEqual(prior);
    expect(f.spend.budget(now)).toMatchObject({
      usedPoints: 2,
      reservedPoints: 0,
      hasUnknown: false,
    });
    const restarted = new ManagedGenerationLedger(f.db, f.guard, f.assertCurrent);
    expect(restarted.forQuery(claimed.requestId, context).retryOf).toEqual(first.record.retryOf);
    await expect(
      restarted.claimSubmission(
        claimed.requestId,
        context,
        command.binding,
        'another-local',
        now + 7,
      ),
    ).rejects.toThrow('MANAGED_QUERY_ONLY');
    await expect(
      f.ledger.register({ ...command, retryOfRequestId: 'different-source' }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('can freshly authorize an unclaimed cancellation without fabricating a cloud parent receipt', async () => {
    const f = await fixture();
    const parent = (await f.ledger.register(f.command)).record;
    await f.ledger.requestCancellation(parent.requestId, f.context, now + 1);
    const command = {
      ...f.command,
      callerKey: 'unsent-retry',
      executionId: randomUUID(),
      retryOfRequestId: parent.requestId,
      now: now + 2,
    };
    const next = (await f.ledger.register(command)).record;
    expect(next.retryOf).toEqual({ requestId: parent.requestId, remoteRunId: null });
    expect(f.ledger.forQuery(parent.requestId, f.context).receipt).toBeNull();
    const claimed = await f.ledger.claimSubmission(
      next.requestId,
      f.context,
      command.binding,
      'new-local',
      now + 3,
    );
    await f.ledger.applyReceipt(claimed.requestId, f.context, managedReceipt(claimed), now + 4);
    expect(f.ledger.forQuery(claimed.requestId, f.context).receipt?.operation).toBe(
      'ordinary_create',
    );
  });

  it.each(['queued', 'unknown', 'success', 'purged', 'claimed-not-sent'] as const)(
    'refuses a new retry for %s without advancing authority',
    async (kind) => {
      const f = await fixture();
      const parent = await f.submitted();
      const receipt = managedReceipt(parent, {
        status: kind === 'queued' ? 'queued' : kind === 'success' ? 'succeeded' : 'failed',
        terminalAt: kind === 'queued' ? null : terminalAt,
        dispatch:
          kind === 'unknown' || kind === 'claimed-not-sent' || kind === 'success'
            ? 'claimed'
            : kind === 'queued'
              ? 'not_started'
              : 'confirmed_not_sent',
        costProvenance:
          kind === 'unknown' ? 'unknown' : kind === 'success' ? 'provider_reported' : 'not_sent',
        costPoints: kind === 'unknown' ? null : kind === 'success' ? 2 : 0,
        purgedAt: kind === 'purged' ? terminalAt : null,
      });
      if (kind === 'claimed-not-sent')
        await expect(
          f.ledger.applyReceipt(parent.requestId, f.context, receipt, now + 1),
        ).rejects.toThrow('MANAGED_RECEIPT_INVALID');
      else await f.ledger.applyReceipt(parent.requestId, f.context, receipt, now + 1);
      const checkpoint = f.repository.checkpoint();
      await expect(
        f.ledger.register({
          ...f.command,
          callerKey: 'blocked-new-retry',
          executionId: randomUUID(),
          retryOfRequestId: parent.requestId,
        }),
      ).rejects.toThrow('MANAGED_RETRY_UNRESOLVED');
      expect(f.repository.checkpoint()).toEqual(checkpoint);
      expect(f.db.prepare('SELECT count(*) AS n FROM managed_generation_requests').get()).toEqual({
        n: 1,
      });
    },
  );

  it('refuses source owner, payer and frozen-input substitutions before retry registration', async () => {
    const f = await fixture();
    const parent = (await f.ledger.register(f.command)).record;
    await f.ledger.requestCancellation(parent.requestId, f.context, now + 1);
    const command = {
      ...f.command,
      callerKey: 'tampered-retry',
      executionId: randomUUID(),
      retryOfRequestId: parent.requestId,
    };
    const checkpoint = f.repository.checkpoint();
    await expect(
      f.ledger.register({ ...command, binding: { ...command.binding, principalId: 'another' } }),
    ).rejects.toThrow('MANAGED_IDENTITY_CHANGED');
    await expect(
      f.ledger.register({
        ...command,
        binding: { ...command.binding, payer: { ...command.binding.payer, ownerId: 'another' } },
      }),
    ).rejects.toThrow('MANAGED_RETRY_MISMATCH');
    await expect(
      f.ledger.register({ ...command, request: { ...command.request, prompt: 'changed' } }),
    ).rejects.toThrow('MANAGED_RETRY_MISMATCH');
    expect(f.repository.checkpoint()).toEqual(checkpoint);
  });

  // R4-1 create/retry 对照：同一 canonical 回执合同在 ordinary 与 explicit-retry 子请求上执行同一核对。
  it('applies the same canonical receipt checks to an explicit-retry child as to an ordinary create', async () => {
    const f = await fixture();
    const parent = await f.submitted();
    await f.ledger.applyReceipt(
      parent.requestId,
      f.context,
      managedReceipt(parent, {
        status: 'cancelled',
        dispatch: 'confirmed_not_sent',
        terminalAt,
      }),
      now + 1,
    );
    const prior = f.ledger.forQuery(parent.requestId, f.context);
    const command = {
      ...f.command,
      callerKey: 'retry-contract-parity',
      executionId: randomUUID(),
      consent: 'interactive' as const,
      retryOfRequestId: parent.requestId,
      now: now + 2,
    };
    const context = managedContext(command);
    const registered = await f.ledger.register(command);
    const child = await f.ledger.claimSubmission(
      registered.record.requestId,
      context,
      command.binding,
      'parity-local-run',
      now + 3,
    );
    expect(child.remoteKey).not.toBe(parent.remoteKey);
    expect(child.retryOf).toEqual({
      requestId: parent.requestId,
      remoteRunId: prior.receipt?.originalRunId,
    });
    const valid = managedReceipt(child, {
      operation: 'explicit_retry',
      originalRunId: 'child-remote-run',
      sourceRunId: prior.receipt?.originalRunId ?? null,
    });
    const cases: Array<[string, (receipt: typeof valid) => void]> = [
      ['key', (receipt) => (receipt.idempotencyKey = 'desktop-g-v1:another-key')],
      [
        'source-run',
        (receipt) => {
          receipt.sourceRunId = null;
          receipt.operation = 'ordinary_create';
        },
      ],
      ['source-run-id-only', (receipt) => (receipt.sourceRunId = 'another-remote-run')],
      ['operation', (receipt) => (receipt.operation = 'ordinary_create')],
      [
        'binding',
        (receipt) => {
          if (!receipt.binding) throw new Error('Missing binding fixture');
          receipt.binding.credential.version = 2;
        },
      ],
      [
        'principal',
        (receipt) => {
          receipt.principalId = 'another-principal';
          if (!receipt.binding) throw new Error('Missing binding fixture');
          receipt.binding.principalId = 'another-principal';
        },
      ],
    ];
    for (const [label, corrupt] of cases) {
      const bad = structuredClone(valid);
      corrupt(bad);
      await expect(
        f.ledger.applyReceipt(child.requestId, context, bad, now + 4),
        `${label} mismatch must be rejected`,
      ).rejects.toThrow('MANAGED_RECEIPT_MISMATCH');
      expect(f.ledger.forQuery(child.requestId, context).receipt).toBeNull();
    }
    const checkpoint = f.repository.checkpoint();
    expect(f.spend.budget(now)).toMatchObject({ usedPoints: 0, hasUnknown: true });
    await f.ledger.applyReceipt(child.requestId, context, valid, now + 5);
    expect(f.ledger.forQuery(child.requestId, context).receipt).toEqual(valid);
    // 原请求身份/金额不变：父记录与父回执在子全生命周期前后逐字段一致。
    expect(f.ledger.forQuery(parent.requestId, f.context)).toEqual(prior);
    expect(f.repository.checkpoint()).not.toEqual(checkpoint);
    expect(f.spend.budget(now)).toMatchObject({
      usedPoints: 0,
      reservedPoints: 4,
      hasUnknown: false,
    });
  });

  it('cancellation before claim releases only proven-unsent work and prevents the live send', async () => {
    const f = await fixture();
    const { record } = await f.ledger.register(f.command);
    await f.ledger.requestCancellation(record.requestId, f.context, now + 1);
    expect(f.spend.get(record.requestId)).toMatchObject({
      state: 'terminal',
      outcome: 'cancelled',
    });
    expect(f.spend.budget(now)).toMatchObject({ reservedPoints: 0, usedPoints: 0 });
    const checkpoint = f.repository.checkpoint();
    await f.ledger.requestCancellation(record.requestId, f.context, now + 2);
    expect(f.repository.checkpoint()).toEqual(checkpoint);
    await expect(
      f.ledger.claimSubmission(
        record.requestId,
        f.context,
        f.command.binding,
        'local-run',
        now + 3,
      ),
    ).rejects.toThrow('MANAGED_CANCEL_REQUESTED');
    expect(f.spend.calls(record.requestId)).toEqual([]);
    expect(f.ledger.forQuery(record.requestId, f.context).cancelRequestedAt).toBe(now + 1);
  });

  it('cancellation after claim does not release unknown costs or reject late successful receipts', async () => {
    const f = await fixture();
    const record = await f.submitted();
    await f.ledger.requestCancellation(record.requestId, f.context, now + 1);
    expect(f.spend.budget(now).hasUnknown).toBe(true);
    const restarted = new ManagedGenerationLedger(f.db, f.guard, f.assertCurrent);
    const relogin = { ...f.context, authEpoch: randomUUID() };
    expect(restarted.forQuery(record.requestId, relogin).cancelRequestedAt).toBe(now + 1);
    await restarted.acknowledgeCancellation(record.requestId, relogin, now + 2);
    await restarted.applyReceipt(
      record.requestId,
      relogin,
      managedReceipt(record, {
        status: 'succeeded',
        dispatch: 'claimed',
        costProvenance: 'provider_reported',
        costPoints: 3,
        terminalAt,
        revision: 2,
        updatedAt: terminalAt,
      }),
      now + 3,
    );
    expect(f.spend.budget(now)).toMatchObject({ hasUnknown: false, usedPoints: 3 });
    await expect(
      restarted.requestCancellation(
        record.requestId,
        { ...relogin, principalId: 'another-owner' },
        now + 4,
      ),
    ).rejects.toThrow('MANAGED_IDENTITY_CHANGED');
    expect(restarted.forQuery(record.requestId, relogin).cancelAcknowledgedAt).toBe(now + 2);
  });

  it('atomically registers frozen input, reservation and namespace, with stable remote key', async () => {
    const f = await fixture();
    const first = await f.ledger.register(f.command);
    expect(first.replayed).toBe(false);
    expect(first.record.remoteKey).toBe(
      managedGenerationKey(first.record.namespace, f.command.callerKey),
    );
    expect(first.record.frozenRequest).toEqual(f.command.request);
    expect(f.spend.budget(now)).toMatchObject({ reservedPoints: 4, remainingPoints: 6 });
    const checkpoint = f.repository.checkpoint();
    const repeat = await f.ledger.register({
      ...f.command,
      executionId: randomUUID(),
      authEpoch: randomUUID(),
    });
    expect(repeat).toEqual({ ...first, replayed: true });
    expect(f.repository.checkpoint()).toEqual(checkpoint);
    expect((await f.anchor.read())?.committed).toEqual(checkpoint);
    await expect(
      f.ledger.register({ ...f.command, request: { ...f.command.request, prompt: 'different' } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await f.guard.status()).toMatchObject({ mode: 'active' });
    expect(f.spend.budget(now).reservedPoints).toBe(4);
  });

  it('serializes concurrent registrations and one live send claim without duplicate reservations', async () => {
    const f = await fixture();
    const values = await Promise.all([f.ledger.register(f.command), f.ledger.register(f.command)]);
    expect(values.map((v) => v.replayed).sort()).toEqual([false, true]);
    const id = values[0].record.requestId;
    const results = await Promise.allSettled([
      f.ledger.claimSubmission(id, f.context, f.command.binding, 'local-result', now),
      f.ledger.claimSubmission(id, f.context, f.command.binding, 'local-result', now),
    ]);
    expect(results.map((v) => v.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(f.spend.calls(id)).toHaveLength(1);
    expect(f.spend.budget(later)).toMatchObject({ hasUnknown: true, remainingPoints: 0 });
  });

  it('does not recover a live send permit after coordinator replacement, even before any POST', async () => {
    const f = await fixture();
    const { record } = await f.ledger.register(f.command);
    const next = new ManagedGenerationLedger(f.db, f.guard, f.assertCurrent);
    expect(next.forQuery(record.requestId, f.context).remoteKey).toBe(record.remoteKey);
    expect((await next.register(f.command)).replayed).toBe(true);
    await expect(
      next.claimSubmission(record.requestId, f.context, f.command.binding, 'local', now),
    ).rejects.toMatchObject({ code: 'MANAGED_QUERY_ONLY' });
    expect(f.spend.calls(record.requestId)).toEqual([]);
  });

  it.each(['principal', 'issuer', 'epoch', 'credential'] as const)(
    'rejects changed %s before claiming and keeps anchor usable',
    async (field) => {
      const f = await fixture();
      const { record } = await f.ledger.register(f.command);
      const context = { ...f.context };
      const binding = structuredClone(f.command.binding);
      if (field === 'principal') context.principalId = 'other';
      if (field === 'issuer') context.apiIssuer = 'https://other.example.invalid';
      if (field === 'epoch') context.authEpoch = randomUUID();
      if (field === 'credential') binding.credential.version += 1;
      await expect(
        f.ledger.claimSubmission(record.requestId, context, binding, 'local', now),
      ).rejects.toMatchObject({ code: 'MANAGED_IDENTITY_CHANGED' });
      expect(f.spend.calls(record.requestId)).toEqual([]);
      expect(await f.guard.status()).toMatchObject({ mode: 'active' });
    },
  );

  it('requires confirmation at zero budget, never restores expired approval or finishes via generic recover', async () => {
    const f = await fixture();
    await f.guard.mutate('budget', { points: 0 }, () => f.spend.setBudgetLimit(0, now));
    const { record } = await f.ledger.register(f.command);
    const request = f.spend.get(record.requestId);
    if (!request?.confirmationId) throw new Error('Missing confirmation fixture');
    const confirmationId = request.confirmationId;
    expect(request.state).toBe('pending_confirmation');
    expect(() => f.spend.resolveConfirmation(confirmationId, true, now)).toThrow(
      'MANAGED_SPEND_COORDINATOR_REQUIRED',
    );
    expect(f.spend.recover('new-runtime', now + 999999)).toBe(0);
    expect(f.spend.get(record.requestId)?.state).toBe('pending_confirmation');
    expect(
      await f.ledger.resolveConfirmation(record.requestId, f.context, true, now + 120000),
    ).toBe(false);
    expect(f.spend.get(record.requestId)).toMatchObject({ state: 'terminal', outcome: 'timeout' });
    await expect(
      f.ledger.claimSubmission(
        record.requestId,
        f.context,
        f.command.binding,
        'local',
        now + 120001,
      ),
    ).rejects.toMatchObject({ code: 'SPEND_NOT_AUTHORIZED' });
    expect((await f.anchor.read())?.committed).toEqual(f.repository.checkpoint());
  });

  it('accepts explicit confirmation once with the same payer and registers one multi-image call', async () => {
    const f = await fixture();
    await f.guard.mutate('budget', { points: 0 }, () => f.spend.setBudgetLimit(0, now));
    const { record } = await f.ledger.register(f.command);
    expect(await f.ledger.resolveConfirmation(record.requestId, f.context, true, now + 1)).toBe(
      true,
    );
    expect(await f.ledger.resolveConfirmation(record.requestId, f.context, true, now + 2)).toBe(
      false,
    );
    await f.ledger.claimSubmission(
      record.requestId,
      f.context,
      f.command.binding,
      'local',
      now + 3,
    );
    expect(f.spend.calls(record.requestId)).toHaveLength(1);
    expect(f.spend.get(record.requestId)).toMatchObject({
      approvalSource: 'confirmation',
      reservationState: 'unknown',
    });
  });

  it('protects remote calls from generic claim, completion, finish and startup recovery', async () => {
    const f = await fixture();
    const record = await f.submitted();
    const call = f.spend.calls(record.requestId)[0];
    if (!call.claimId) throw new Error('Missing claim fixture');
    const claimId = call.claimId;
    expect(() => f.spend.claimCall(call.id, call.binding, 'legacy', now)).toThrow(
      'MANAGED_SPEND_COORDINATOR_REQUIRED',
    );
    expect(() =>
      f.spend.completeCall(
        call.id,
        claimId,
        { reportedPoints: 0, source: 'provider_reported', evidenceRef: null },
        now,
      ),
    ).toThrow('MANAGED_SPEND_COORDINATOR_REQUIRED');
    expect(() => f.spend.finishRequest(record.requestId, 'failed', now)).toThrow(
      'MANAGED_SPEND_COORDINATOR_REQUIRED',
    );
    expect(f.spend.recover('next-runtime', later)).toBe(0);
    expect(f.spend.calls(record.requestId)[0]).toEqual(call);
  });

  it('applies queued, claimed, unknown and late known receipts once in the original budget month', async () => {
    const f = await fixture();
    const record = await f.submitted();
    const queued = managedReceipt(record);
    await f.ledger.applyReceipt(record.requestId, f.context, queued, now);
    expect(f.spend.budget(now)).toMatchObject({
      hasUnknown: false,
      reservedPoints: 4,
      remainingPoints: 6,
    });
    const unknown = managedReceipt(record, {
      revision: 3,
      status: 'failed',
      dispatch: 'claimed',
      costProvenance: 'unknown',
      costPoints: null,
      terminalAt,
    });
    await f.ledger.applyReceipt(record.requestId, f.context, unknown, now + 2);
    expect(f.spend.budget(later)).toMatchObject({ hasUnknown: true, remainingPoints: 0 });
    expect(await f.ledger.applyReceipt(record.requestId, f.context, queued, later)).toBe(false);
    const success = managedReceipt(record, {
      revision: 4,
      status: 'succeeded',
      dispatch: 'claimed',
      costProvenance: 'provider_reported',
      costPoints: 3,
      terminalAt,
    });
    const results = await Promise.all([
      f.ledger.applyReceipt(record.requestId, f.context, success, later),
      f.ledger.applyReceipt(record.requestId, f.context, success, later),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect(f.spend.budget(now)).toMatchObject({
      usedPoints: 3,
      hasUnknown: false,
      reservedPoints: 0,
    });
    expect(f.spend.budget(later)).toMatchObject({ usedPoints: 0, hasUnknown: false });
    expect(f.spend.calls(record.requestId)[0]).toMatchObject({
      costSource: 'provider_reported',
      policyPoints: 3,
    });
    expect(audits(f.db)).toHaveLength(2);
    expect((await f.anchor.read())?.committed).toEqual(f.repository.checkpoint());
  });

  it('releases a cancelled request only with authoritative not-sent evidence; purged receipts still cannot send', async () => {
    const f = await fixture();
    const record = await f.submitted();
    const receipt = managedReceipt(record, {
      status: 'cancelled',
      dispatch: 'confirmed_not_sent',
      terminalAt,
      purgedAt: terminalAt,
    });
    await f.ledger.applyReceipt(record.requestId, f.context, receipt, now);
    expect(f.spend.budget(now)).toMatchObject({
      usedPoints: 0,
      hasUnknown: false,
      reservedPoints: 0,
    });
    expect(f.spend.calls(record.requestId)[0].state).toBe('not_sent');
    await expect(
      f.ledger.claimSubmission(record.requestId, f.context, f.command.binding, 'local', later),
    ).rejects.toMatchObject({ code: 'MANAGED_QUERY_ONLY' });
  });

  it.each(['key', 'principal', 'binding', 'operation', 'run', 'id', 'same-revision'] as const)(
    'rejects receipt %s mismatch without changing budget or poisoning the checkpoint',
    async (field) => {
      const f = await fixture();
      const record = await f.submitted();
      const receipt = managedReceipt(record);
      await f.ledger.applyReceipt(record.requestId, f.context, receipt, now);
      const bad = structuredClone(receipt);
      if (!bad.binding) throw new Error('Missing binding fixture');
      bad.revision = 2;
      if (field === 'key') bad.idempotencyKey = 'another-remote-key';
      if (field === 'principal') {
        bad.principalId = 'other';
        bad.binding.principalId = 'other';
      }
      if (field === 'binding') bad.binding.credential.version = 2;
      if (field === 'operation') bad.operation = 'explicit_retry';
      if (field === 'run') bad.originalRunId = 'another-run';
      if (field === 'id') bad.id = 'another-receipt';
      if (field === 'same-revision') {
        bad.revision = 1;
        bad.status = 'running';
      }
      const checkpoint = f.repository.checkpoint();
      await expect(f.ledger.applyReceipt(record.requestId, f.context, bad, now)).rejects.toThrow();
      expect(f.repository.checkpoint()).toEqual(checkpoint);
      expect(await f.guard.status()).toMatchObject({ mode: 'active' });
    },
  );

  it('permits same-owner recovery after login/key changes and refuses another account', async () => {
    const f = await fixture();
    const record = await f.submitted();
    const nextContext = { ...f.context, authEpoch: randomUUID() };
    expect(f.ledger.forQuery(record.requestId, nextContext).binding.credential.version).toBe(1);
    await f.ledger.applyReceipt(record.requestId, nextContext, managedReceipt(record), now);
    expect(() =>
      f.ledger.forQuery(record.requestId, { ...nextContext, principalId: 'other' }),
    ).toThrow('MANAGED_IDENTITY_CHANGED');
  });

  it('keeps unknown cost blocking a different automatic request across the month boundary', async () => {
    const f = await fixture();
    const record = await f.submitted();
    await f.ledger.applyReceipt(
      record.requestId,
      f.context,
      managedReceipt(record, {
        status: 'cancelled',
        dispatch: 'claimed',
        costProvenance: 'unknown',
        costPoints: null,
        terminalAt,
      }),
      now,
    );
    const next = await f.ledger.register({
      ...f.command,
      callerKey: 'next-month-key',
      executionId: randomUUID(),
      now: later,
    });
    expect(f.spend.get(next.record.requestId)?.state).toBe('pending_confirmation');
    expect(f.spend.get(record.requestId)).toMatchObject({
      budgetMonth: '2026-09',
      reservationState: 'unknown',
    });
  });

  it('rejects a higher revision that moves a completed receipt back to running', async () => {
    const f = await fixture();
    const record = await f.submitted();
    await f.ledger.applyReceipt(
      record.requestId,
      f.context,
      managedReceipt(record, {
        revision: 2,
        status: 'succeeded',
        dispatch: 'claimed',
        costProvenance: 'provider_reported',
        costPoints: 3,
        terminalAt,
      }),
      now,
    );
    const checkpoint = f.repository.checkpoint();
    await expect(
      f.ledger.applyReceipt(
        record.requestId,
        f.context,
        managedReceipt(record, {
          revision: 3,
          status: 'running',
          dispatch: 'claimed',
          costProvenance: 'unknown',
          costPoints: null,
        }),
        later,
      ),
    ).rejects.toThrow('MANAGED_RECEIPT_REGRESSION');
    expect(f.repository.checkpoint()).toEqual(checkpoint);
    expect(f.spend.budget(now).usedPoints).toBe(3);
  });

  it('rolls back receipt, cost and audit together and stays restricted after an actual DB write failure', async () => {
    const f = await fixture();
    const record = await f.submitted();
    f.db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON automation_audit BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END",
    );
    const receipt = managedReceipt(record, {
      status: 'succeeded',
      dispatch: 'claimed',
      costProvenance: 'provider_reported',
      costPoints: 3,
      terminalAt,
    });
    const checkpoint = f.repository.checkpoint();
    await expect(f.ledger.applyReceipt(record.requestId, f.context, receipt, now)).rejects.toThrow(
      'fixture audit failure',
    );
    expect(f.ledger.forQuery(record.requestId, f.context).receipt).toBeNull();
    expect(f.repository.checkpoint()).toEqual(checkpoint);
    expect(f.spend.budget(now)).toMatchObject({ usedPoints: 0, hasUnknown: true });
    expect(audits(f.db)).toEqual([]);
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
  });

  it('does not give a send permit when the final anchor commit fails after the DB claim', async () => {
    const f = await fixture();
    let failCommit = false;
    const port: ManagedExecutionAnchorPort = {
      scope: f.anchor.scope,
      read: () => f.anchor.read(),
      write: async (value) => {
        if (failCommit && !value.pending) throw new Error('fixture flush failure');
        await f.anchor.write(value);
      },
    };
    const guard = new ManagedExecutionGuard(f.repository, port);
    const ledger = new ManagedGenerationLedger(f.db, guard, f.assertCurrent);
    const { record } = await ledger.register(f.command);
    failCommit = true;
    await expect(
      ledger.claimSubmission(record.requestId, f.context, f.command.binding, 'local', now),
    ).rejects.toThrow('fixture flush failure');
    expect(ledger.forQuery(record.requestId, f.context).submissionState).toBe('query_only');
    failCommit = false;
    expect(await guard.recoverCommittedOperation()).toBe(true);
    await expect(
      ledger.claimSubmission(record.requestId, f.context, f.command.binding, 'local', now),
    ).rejects.toThrow('MANAGED_QUERY_ONLY');
  });

  it('rechecks captured host access after asynchronous anchor persistence', async () => {
    const f = await fixture();
    let invalidating = false;
    const port: ManagedExecutionAnchorPort = {
      scope: f.anchor.scope,
      read: () => f.anchor.read(),
      write: async (value) => {
        await f.anchor.write(value);
        if (invalidating && value.pending) f.invalidate();
      },
    };
    const ledger = new ManagedGenerationLedger(
      f.db,
      new ManagedExecutionGuard(f.repository, port),
      f.assertCurrent,
    );
    const { record } = await ledger.register(f.command);
    invalidating = true;
    await expect(
      ledger.claimSubmission(record.requestId, f.context, f.command.binding, 'local', now),
    ).rejects.toThrow('STALE_HOST_CONTEXT');
    expect(f.spend.calls(record.requestId)).toEqual([]);
    expect(await f.guard.status()).toEqual({ mode: 'query_only' });
  });

  it('does not lower the anchor after restoring an older SQLite backup that lost the entire association', async () => {
    const f = await fixture();
    const backup = join(f.dir, 'before.db');
    await f.db.backup(backup);
    await f.submitted();
    f.db.close();
    copyFileSync(backup, f.path);
    const restored = new Database(f.path);
    cleanup.push(() => restored.close());
    const guard = new ManagedExecutionGuard(new ManagedExecutionRepository(restored), f.anchor);
    const ledger = new ManagedGenerationLedger(restored, guard, () => {});
    await expect(ledger.register({ ...f.command, callerKey: 'different-new-key' })).rejects.toThrow(
      'MANAGED_RECONCILIATION_REQUIRED',
    );
    expect(new AutomationSpendRepository(restored).findByKey(f.command.callerKey)).toBeNull();
  });

  it('upgrades a real 0008 database without fabricating remote ownership or changing old budgets', () => {
    const db = new Database(':memory:');
    cleanup.push(() => db.close());
    db.exec(
      'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)',
    );
    for (const migration of DESKTOP_MIGRATIONS.slice(0, 9)) {
      for (const sql of migration.sql) db.exec(sql);
      db.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)').run(
        migration.hash,
        migration.folderMillis,
      );
    }
    const spend = new AutomationSpendRepository(db);
    spend.initializeBudget({ monthlyLimitPoints: 8, usedPoints: 2, month: '2026-09' }, now);
    takeoverDesktopDatabase(db);
    takeoverDesktopDatabase(db);
    expect(db.prepare('SELECT * FROM managed_generation_requests').all()).toEqual([]);
    expect(new ManagedExecutionRepository(db).checkpoint()).toBeNull();
    expect(spend.budget(now)).toMatchObject({ monthlyLimitPoints: 8, usedPoints: 2 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });
});
