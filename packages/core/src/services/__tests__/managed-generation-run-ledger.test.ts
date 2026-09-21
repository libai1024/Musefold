import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { GenerationExecutionReceipt } from '@musefold/contracts';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import type { AutomationPayerBinding } from '@musefold/desktop-contracts/automation-spend';
import {
  registerManagedRunSchema,
  type ManagedGenerationContext,
  type ManagedRunChildInput,
  type ManagedRunRecord,
  type RegisterManagedRun,
} from '@musefold/desktop-contracts/managed-generation';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationSpendRepository } from '../../db/repositories/automation-spend';
import { ManagedExecutionRepository } from '../../db/repositories/managed-execution';
import { ManagedExecutionGuard } from '../managed-execution-guard';
import { EncryptedManagedAnchorFile } from '../managed-execution-anchor-file';
import { ManagedGenerationLedger, managedRunChildKey } from '../managed-generation-ledger';
import { fixtureCipher } from './fixtures/managed-anchor-cipher';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
const now = Date.UTC(2026, 8, 8);
const terminalAt = '2026-09-08T02:00:00.000Z';

const cloudBinding = {
  apiIssuer: 'https://api.example.invalid',
  principalId: 'fixture-principal',
  payer: { issuer: 'https://payer.example.invalid', ownerId: 'fixture-owner' },
  credential: { ref: 'fixture-credential', version: 1 },
  providerId: 'cloud-default',
  model: 'musefold-image-pro',
  capabilities: { image: true, text: false },
};

const byokTextBinding = {
  providerId: 'text-provider',
  providerType: 'openai-compatible',
  model: 'text-model',
  baseUrl: 'https://text.example.invalid',
  credentialEpoch: 'a'.repeat(64),
  payerKind: 'external',
  ownerId: null,
  issuer: null,
  policy: 'external',
} satisfies AutomationPayerBinding;

const hostedTextBinding = {
  providerId: 'cloud-default',
  providerType: 'musefold-cloud',
  model: 'musefold-image-pro',
  baseUrl: 'https://api.example.invalid',
  credentialEpoch: 'b'.repeat(64),
  payerKind: 'unbound',
  ownerId: null,
  issuer: null,
  policy: 'managed',
} satisfies AutomationPayerBinding;

type RunCommand = ReturnType<typeof runCommand>;

function runCommand(patch: Record<string, unknown> = {}): RegisterManagedRun {
  return registerManagedRunSchema.parse({
    callerKey: 'fixture-run-caller-key',
    caller: 'fixture',
    executionId: randomUUID(),
    binding: cloudBinding,
    authEpoch: '11111111-1111-4111-8111-111111111111',
    run: {
      runKind: 'run_scheme',
      originalJobIds: ['job-one', 'job-two'],
      input: { body: { prompt: 'run body' }, jobIds: ['job-one', 'job-two'] },
      frozenRun: { body: { prompt: 'run body' }, source: 'automation' },
      textBinding: null,
    },
    estimatedPoints: null,
    consent: 'interactive',
    now,
    ...patch,
  });
}

function contextFor(command: RunCommand, authEpoch = command.authEpoch): ManagedGenerationContext {
  return {
    apiIssuer: command.binding.apiIssuer,
    principalId: command.binding.principalId,
    authEpoch,
  };
}

function childInput(prompt: string): ManagedRunChildInput {
  return {
    size: 'auto',
    quality: 'auto',
    prompt,
    providerId: 'cloud-default',
    runKind: 'free_generation',
    referenceImages: [],
    promptReferenceSelections: [],
    count: 1,
  };
}

function runReceipt(
  record: ManagedRunRecord,
  ordinal: number,
  patch: Partial<GenerationExecutionReceipt> = {},
): GenerationExecutionReceipt {
  const child = record.children[ordinal];
  if (!child) throw new Error('fixture child missing');
  return {
    id: `fixture-receipt-${ordinal}`,
    principalId: record.binding.principalId,
    idempotencyKey: child.remoteKey,
    operation: 'ordinary_create',
    originalRunId: `fixture-remote-run-${ordinal}`,
    sourceRunId: null,
    bindingState: 'bound',
    binding: record.binding,
    status: 'queued',
    dispatch: 'not_started',
    costProvenance: 'not_sent',
    costPoints: 0,
    revision: 1,
    createdAt: '2026-09-08T01:00:00.000Z',
    updatedAt: '2026-09-08T01:00:00.000Z',
    terminalAt: null,
    purgedAt: null,
    ...patch,
  };
}

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-managed-run-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const db = new Database(join(dir, 'data.db'));
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
  return {
    db,
    spend,
    repository,
    ledger,
    restart: () => new ManagedGenerationLedger(db, guard, assertCurrent),
    invalidate: () => {
      current = false;
    },
  };
}

type AuditRow = {
  params_json: string;
  status: string;
  actual_points: number | null;
  event_key: string;
};

function audits(db: Database.Database): AuditRow[] {
  return db
    .prepare(
      'SELECT params_json, status, actual_points, event_key FROM automation_audit ORDER BY id',
    )
    .all() as AuditRow[];
}

describe('managed run ledger: one reservation, one confirmation, N children', () => {
  it('registers a whole run once with per-original stable child keys and replays by caller key', async () => {
    const f = await fixture();
    const command = runCommand();
    const context = contextFor(command);
    const first = await f.ledger.registerRun(command);
    expect(first.replayed).toBe(false);
    const { record } = first;
    // One run-level spend request: single reservation, maxImageCalls = n, zero text calls.
    expect(f.spend.get(record.requestId)).toMatchObject({
      action: 'run_scheme',
      state: 'authorized',
      approvalSource: 'consent',
      maxImageCalls: 2,
      maxTextCalls: 0,
      estimatedPoints: null,
      reservationState: 'unknown',
    });
    expect(record.children.map((child) => child.originalJobId)).toEqual(['job-one', 'job-two']);
    const keys = record.children.map((child) => child.remoteKey);
    expect(new Set(keys).size).toBe(2);
    for (const [index, key] of keys.entries())
      expect(key).toBe(
        managedRunChildKey(record.namespace, command.callerKey, command.run.originalJobIds[index]),
      );
    expect(keys.every((key) => key.startsWith('desktop-rs-v1:'))).toBe(true);
    expect(record.children.every((child) => child.submissionState === 'unclaimed')).toBe(true);
    // Replay returns the same frozen plan and never writes a second spend row.
    const replay = await f.ledger.registerRun(command);
    expect(replay.replayed).toBe(true);
    expect(replay.record).toEqual(record);
    expect(f.db.prepare('SELECT count(*) AS n FROM automation_spend_requests').get()).toEqual({
      n: 1,
    });
    await expect(
      f.ledger.registerRun({
        ...command,
        run: { ...command.run, originalJobIds: ['job-one', 'zzz'] },
      }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('claims each original exactly once, freezes distinct per-child input, and turns the child query-only', async () => {
    const f = await fixture();
    const command = runCommand();
    const context = contextFor(command);
    const { record } = await f.ledger.registerRun(command);
    const zero = await f.ledger.claimRunChild(
      record.requestId,
      0,
      context,
      command.binding,
      childInput('first original prompt'),
      'local-job-one',
      now + 1,
    );
    expect(zero.child).toMatchObject({
      callId: expect.any(String),
      localGenerationId: 'local-job-one',
      submissionState: 'query_only',
    });
    const one = await f.ledger.claimRunChild(
      record.requestId,
      1,
      context,
      command.binding,
      childInput('second original prompt'),
      'local-job-two',
      now + 2,
    );
    expect(one.child.callId).not.toBe(zero.child.callId);
    // Each child freezes its own prompt on its own call row.
    const calls = f.spend.calls(record.requestId);
    expect(calls.map((call) => [call.ordinal, call.kind, call.generationRunId])).toEqual([
      [0, 'image', 'local-job-one'],
      [1, 'image', 'local-job-two'],
    ]);
    expect(calls[0].inputHash).not.toBe(calls[1].inputHash);
    // A lost claim reply is not a resend permit: the reservation is already unknowable.
    expect(f.spend.get(record.requestId)).toMatchObject({ state: 'running' });
    // Same child twice in one session: the one-time permit is gone.
    await expect(
      f.ledger.claimRunChild(
        record.requestId,
        0,
        context,
        command.binding,
        childInput('x'),
        'other',
        now + 3,
      ),
    ).rejects.toThrow('MANAGED_QUERY_ONLY');
    // A restarted coordinator has no send permits at all — recovery is receipt queries only.
    const restarted = f.restart();
    await expect(
      restarted.claimRunChild(
        record.requestId,
        1,
        context,
        command.binding,
        childInput('x'),
        'other',
        now + 4,
      ),
    ).rejects.toThrow('MANAGED_QUERY_ONLY');
    expect(f.spend.calls(record.requestId)).toHaveLength(2);
  });

  it('projects per-child cost, auto-finishes the run when the last child settles, and audits each send', async () => {
    const f = await fixture();
    const command = runCommand();
    const context = contextFor(command);
    const { record } = await f.ledger.registerRun(command);
    await f.ledger.claimRunChild(
      record.requestId,
      0,
      context,
      command.binding,
      childInput('first'),
      'local-job-one',
      now + 1,
    );
    await f.ledger.applyRunChildReceipt(
      record.requestId,
      0,
      context,
      runReceipt(record, 0, {
        status: 'running',
        dispatch: 'claimed',
        costProvenance: 'unknown',
        costPoints: null,
      }),
      now + 2,
    );
    // Run request stays live while any child is unsettled.
    expect(f.spend.get(record.requestId)).toMatchObject({ state: 'running' });
    await f.ledger.claimRunChild(
      record.requestId,
      1,
      context,
      command.binding,
      childInput('second'),
      'local-job-two',
      now + 3,
    );
    // Child 0 succeeds, child 1 fails: one shared reservation releases once, both costs apply.
    await f.ledger.applyRunChildReceipt(
      record.requestId,
      0,
      context,
      runReceipt(record, 0, {
        revision: 2,
        status: 'succeeded',
        dispatch: 'claimed',
        costProvenance: 'provider_reported',
        costPoints: 3,
        terminalAt,
        updatedAt: terminalAt,
      }),
      now + 4,
    );
    expect(f.spend.get(record.requestId)).toMatchObject({ state: 'running' });
    await f.ledger.applyRunChildReceipt(
      record.requestId,
      1,
      context,
      runReceipt(record, 1, {
        status: 'failed',
        dispatch: 'claimed',
        costProvenance: 'provider_reported',
        costPoints: 2,
        terminalAt,
      }),
      now + 5,
    );
    expect(f.spend.get(record.requestId)).toMatchObject({
      state: 'terminal',
      outcome: 'success',
      reservationState: 'released',
    });
    expect(f.spend.budget(now)).toMatchObject({
      usedPoints: 5,
      reservedPoints: 0,
      hasUnknown: false,
    });
    const events = audits(f.db);
    expect(events.map((event) => event.event_key)).toEqual([
      'receipt:fixture-receipt-0:2',
      'receipt:fixture-receipt-1:1',
      'terminal',
    ]);
    expect(events[0]).toMatchObject({ status: 'success', actual_points: 3 });
    expect(events[1]).toMatchObject({ status: 'failed', actual_points: 2 });
    expect(events[2]).toMatchObject({ status: 'success', actual_points: 5 });
    // Late duplicate terminal receipt is idempotent, not a second charge.
    await expect(
      f.ledger.applyRunChildReceipt(
        record.requestId,
        1,
        context,
        runReceipt(record, 1, {
          status: 'failed',
          dispatch: 'claimed',
          costProvenance: 'provider_reported',
          costPoints: 2,
          terminalAt,
        }),
        now + 6,
      ),
    ).resolves.toBe(false);
    expect(f.spend.budget(now)).toMatchObject({ usedPoints: 5 });
  });

  it('rejects mismatched or regressive child receipts without touching the checkpoint', async () => {
    const f = await fixture();
    const command = runCommand();
    const context = contextFor(command);
    const { record } = await f.ledger.registerRun(command);
    await f.ledger.claimRunChild(
      record.requestId,
      0,
      context,
      command.binding,
      childInput('first'),
      'local-job-one',
      now + 1,
    );
    await expect(
      f.ledger.applyRunChildReceipt(
        record.requestId,
        0,
        context,
        runReceipt(record, 1, { status: 'queued' }),
        now + 2,
      ),
    ).rejects.toThrow('MANAGED_RECEIPT_MISMATCH');
    await f.ledger.applyRunChildReceipt(
      record.requestId,
      0,
      context,
      runReceipt(record, 0, {
        status: 'running',
        dispatch: 'claimed',
        costProvenance: 'unknown',
        costPoints: null,
      }),
      now + 3,
    );
    const checkpoint = f.repository.checkpoint();
    await expect(
      f.ledger.applyRunChildReceipt(
        record.requestId,
        0,
        context,
        runReceipt(record, 0, {
          revision: 1,
          status: 'failed',
          dispatch: 'claimed',
          costProvenance: 'provider_reported',
          costPoints: 9,
          terminalAt,
        }),
        now + 4,
      ),
    ).rejects.toThrow('MANAGED_RECEIPT_CONFLICT');
    // Cross-child key swap is a mismatch even with an otherwise valid receipt.
    await expect(
      f.ledger.applyRunChildReceipt(
        record.requestId,
        0,
        context,
        runReceipt(record, 0, { idempotencyKey: record.children[1].remoteKey }),
        now + 5,
      ),
    ).rejects.toThrow('MANAGED_RECEIPT_MISMATCH');
    expect(f.repository.checkpoint()).toEqual(checkpoint);
  });

  it('terminates a fully unclaimed run at zero cost on cancellation, without dispatching children', async () => {
    const f = await fixture();
    const command = runCommand();
    const context = contextFor(command);
    const { record } = await f.ledger.registerRun(command);
    await f.ledger.requestRunCancellation(record.requestId, context, now + 1);
    expect(f.spend.get(record.requestId)).toMatchObject({
      state: 'terminal',
      outcome: 'cancelled',
      reservationState: 'released',
    });
    expect(f.spend.calls(record.requestId)).toEqual([]);
    expect(f.spend.budget(now)).toMatchObject({
      usedPoints: 0,
      reservedPoints: 0,
      hasUnknown: false,
    });
    const stored = f.ledger.forRunQuery(record.requestId, context);
    expect(stored.cancelRequestedAt).toBe(now + 1);
    expect(stored.children.every((child) => child.callId === null)).toBe(true);
    await expect(
      f.ledger.claimRunChild(
        record.requestId,
        0,
        context,
        command.binding,
        childInput('x'),
        'local',
        now + 2,
      ),
    ).rejects.toThrow('MANAGED_CANCEL_REQUESTED');
  });

  it('cancels mid-run: claimed children resolve by receipt, unclaimed children acknowledge zero-cost', async () => {
    const f = await fixture();
    const command = runCommand();
    const context = contextFor(command);
    const { record } = await f.ledger.registerRun(command);
    await f.ledger.claimRunChild(
      record.requestId,
      0,
      context,
      command.binding,
      childInput('first'),
      'local-job-one',
      now + 1,
    );
    await f.ledger.applyRunChildReceipt(
      record.requestId,
      0,
      context,
      runReceipt(record, 0, {
        status: 'succeeded',
        dispatch: 'claimed',
        costProvenance: 'provider_reported',
        costPoints: 3,
        terminalAt,
      }),
      now + 2,
    );
    // Child 1 is still unclaimed; cancel intent alone does not finish the run.
    await f.ledger.requestRunCancellation(record.requestId, context, now + 3);
    expect(f.spend.get(record.requestId)).toMatchObject({ state: 'running' });
    // A claimed child may never be zero-cost-acknowledged; only its receipt settles it.
    await expect(
      f.ledger.acknowledgeRunChildCancellation(record.requestId, 0, context, now + 4),
    ).rejects.toThrow('MANAGED_CANCEL_CONFLICT');
    expect(f.spend.get(record.requestId)).toMatchObject({ state: 'running' });
    // The unclaimed child acknowledges cancellation with no call row and no cost at all.
    await f.ledger.acknowledgeRunChildCancellation(record.requestId, 1, context, now + 5);
    expect(f.spend.get(record.requestId)).toMatchObject({
      state: 'terminal',
      outcome: 'success',
      reservationState: 'released',
    });
    expect(f.spend.budget(now)).toMatchObject({ usedPoints: 3, hasUnknown: false });
    const stored = f.ledger.forRunQuery(record.requestId, context);
    expect(stored.children[1]).toMatchObject({ callId: null, cancelAcknowledgedAt: now + 5 });
    expect(f.spend.calls(record.requestId)).toHaveLength(1);
  });

  it('keeps an unknown reservation when a cancelled-after-claim child never reports cost', async () => {
    const f = await fixture();
    const command = runCommand();
    const context = contextFor(command);
    const { record } = await f.ledger.registerRun(command);
    await f.ledger.claimRunChild(
      record.requestId,
      0,
      context,
      command.binding,
      childInput('first'),
      'local-job-one',
      now + 1,
    );
    await f.ledger.requestRunCancellation(record.requestId, context, now + 2);
    await f.ledger.applyRunChildReceipt(
      record.requestId,
      0,
      context,
      runReceipt(record, 0, {
        status: 'cancelled',
        dispatch: 'claimed',
        costProvenance: 'unknown',
        costPoints: null,
        terminalAt,
      }),
      now + 3,
    );
    await f.ledger.acknowledgeRunChildCancellation(record.requestId, 1, context, now + 4);
    expect(f.spend.get(record.requestId)).toMatchObject({
      state: 'terminal',
      outcome: 'cancelled',
      reservationState: 'unknown',
    });
    expect(f.spend.budget(now)).toMatchObject({ hasUnknown: true, usedPoints: 0 });
  });

  it('authorizes a pending run through one request-level confirmation before any child claim', async () => {
    const f = await fixture();
    const command = runCommand({ estimatedPoints: 50, consent: undefined });
    const context = contextFor(command);
    const { record } = await f.ledger.registerRun(command);
    expect(f.spend.get(record.requestId)).toMatchObject({ state: 'pending_confirmation' });
    // Claiming before confirmation burns that child's one-time permit but sends nothing.
    await expect(
      f.ledger.claimRunChild(
        record.requestId,
        0,
        context,
        command.binding,
        childInput('x'),
        'local',
        now + 1,
      ),
    ).rejects.toThrow('SPEND_NOT_AUTHORIZED');
    await f.ledger.resolveRunConfirmation(record.requestId, context, true, now + 2);
    expect(f.spend.get(record.requestId)).toMatchObject({
      state: 'authorized',
      reservationState: 'held',
    });
    // The untouched child still carries its send permit after the single confirmation.
    const one = await f.ledger.claimRunChild(
      record.requestId,
      1,
      context,
      command.binding,
      childInput('second'),
      'local-job-two',
      now + 3,
    );
    expect(one.child.submissionState).toBe('query_only');
    // A denied confirmation bounded-rejects the run at zero cost.
    const denied = runCommand({
      callerKey: 'fixture-run-denied',
      estimatedPoints: 50,
      consent: undefined,
    });
    const deniedContext = contextFor(denied);
    const deniedRecord = (await f.ledger.registerRun(denied)).record;
    await f.ledger.resolveRunConfirmation(deniedRecord.requestId, deniedContext, false, now + 4);
    expect(f.spend.get(deniedRecord.requestId)).toMatchObject({
      state: 'terminal',
      outcome: 'denied',
    });
    expect(f.spend.calls(deniedRecord.requestId)).toEqual([]);
  });

  it('rejects a hosted text binding at registration with zero paid sends, but rides a BYOK text call on the same reservation', async () => {
    const f = await fixture();
    // Hosted (unbound) text payer: the whole run terminates at registration, like the legacy path.
    const hosted = runCommand({
      callerKey: 'fixture-run-hosted-text',
      run: {
        runKind: 'run_github_skill',
        originalJobIds: ['job-one'],
        input: { body: {} },
        frozenRun: {},
        textBinding: hostedTextBinding,
      },
    });
    const { record: hostedRecord } = await f.ledger.registerRun(hosted);
    expect(f.spend.get(hostedRecord.requestId)).toMatchObject({
      state: 'terminal',
      outcome: 'failed',
      errorCode: 'PAYMENT_IDENTITY_UNBOUND',
    });
    expect(f.spend.calls(hostedRecord.requestId)).toEqual([]);
    await expect(
      f.ledger.claimRunChild(
        hostedRecord.requestId,
        0,
        contextFor(hosted),
        hosted.binding,
        childInput('x'),
        'local',
        now + 1,
      ),
    ).rejects.toThrow('SPEND_NOT_AUTHORIZED');

    // No text binding on a plain run: a text claim is refused outright.
    const plain = runCommand({ callerKey: 'fixture-run-plain' });
    const plainRecord = (await f.ledger.registerRun(plain)).record;
    await expect(
      f.ledger.claimRunTextCall(
        plainRecord.requestId,
        contextFor(plain),
        byokTextBinding,
        { url: 'https://text.example.invalid/chat/completions', body: '{}' },
        now + 2,
      ),
    ).rejects.toThrow('PAYMENT_IDENTITY_UNBOUND');

    // BYOK text: one text call after the image children, always unknown cost.
    const byok = runCommand({
      callerKey: 'fixture-run-byok-text',
      run: { ...runCommand().run, textBinding: byokTextBinding },
    });
    const byokRecord = (await f.ledger.registerRun(byok)).record;
    expect(f.spend.get(byokRecord.requestId)).toMatchObject({ maxTextCalls: 10 });
    const text = await f.ledger.claimRunTextCall(
      byokRecord.requestId,
      contextFor(byok),
      byokTextBinding,
      { url: 'https://text.example.invalid/chat/completions', body: '{"model":"text-model"}' },
      now + 3,
    );
    expect(text.ordinal).toBe(2); // text ordinals start after the image children
    await expect(
      f.ledger.claimRunTextCall(
        byokRecord.requestId,
        contextFor(byok),
        { ...byokTextBinding, model: 'other-model' },
        { url: 'https://text.example.invalid/chat/completions', body: '{"model":"other-model"}' },
        now + 4,
      ),
    ).rejects.toThrow('MANAGED_IDENTITY_CHANGED');
    expect(
      await f.ledger.completeRunTextCall(byokRecord.requestId, text.callId, text.claimId, now + 5),
    ).toBe(true);
    expect(f.spend.calls(byokRecord.requestId).find((call) => call.kind === 'text')).toMatchObject({
      state: 'unknown',
      reportedPoints: null,
    });
    // Text alone never finishes the run; children still drive the terminal transition.
    expect(f.spend.get(byokRecord.requestId)).toMatchObject({ state: 'running' });
  });

  it('never grants run-child sends to a different account owner or a stale host context', async () => {
    const f = await fixture();
    const command = runCommand();
    const context = contextFor(command);
    const { record } = await f.ledger.registerRun(command);
    const stranger = contextFor(command, '22222222-2222-4222-8222-222222222222');
    // A newer login may query the original owner's run...
    expect(f.ledger.forRunQuery(record.requestId, stranger).requestId).toBe(record.requestId);
    // ...but cannot claim sends with it, nor with a changed binding (separate permits).
    await expect(
      f.ledger.claimRunChild(
        record.requestId,
        0,
        stranger,
        command.binding,
        childInput('x'),
        'local',
        now + 1,
      ),
    ).rejects.toThrow('MANAGED_IDENTITY_CHANGED');
    await expect(
      f.ledger.claimRunChild(
        record.requestId,
        1,
        context,
        { ...command.binding, principalId: 'someone-else' },
        childInput('x'),
        'local',
        now + 2,
      ),
    ).rejects.toThrow('MANAGED_IDENTITY_CHANGED');
    expect(f.spend.calls(record.requestId)).toEqual([]);
    const fresh = runCommand({ callerKey: 'fixture-run-stale-host' });
    const freshRecord = (await f.ledger.registerRun(fresh)).record;
    f.invalidate();
    await expect(
      f.ledger.claimRunChild(
        freshRecord.requestId,
        0,
        contextFor(fresh),
        fresh.binding,
        childInput('x'),
        'local',
        now + 3,
      ),
    ).rejects.toThrow('STALE_HOST_CONTEXT');
    expect(f.spend.calls(freshRecord.requestId)).toEqual([]);
  });
});
