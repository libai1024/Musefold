import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { CLOUD_GENERATION_MODEL } from '@musefold/domain/cloud-generation-policy';
import {
  generationExecutionReceiptSchema,
  type GenerationExecutionReceipt,
} from '@musefold/contracts';
import {
  managedGenerationContextSchema,
  managedGenerationRecordSchema,
  managedRunChildInputSchema,
  managedRunChildSchema,
  managedRunRecordSchema,
  registerManagedGenerationSchema,
  registerManagedRunSchema,
  type ManagedGenerationContext,
  type ManagedGenerationRecord,
  type ManagedRunChild,
  type ManagedRunChildInput,
  type ManagedRunRecord,
  type RegisterManagedGeneration,
  type RegisterManagedRun,
} from '@musefold/desktop-contracts/managed-generation';
import type { AutomationPayerBinding } from '@musefold/desktop-contracts/automation-spend';
import {
  AutomationSpendRepository,
  automationInputHash,
} from '../db/repositories/automation-spend';
import {
  ManagedExecutionError,
  ManagedExecutionRepository,
} from '../db/repositories/managed-execution';
import type { ManagedExecutionGuard } from './managed-execution-guard';

const terminalStatuses = new Set(['succeeded', 'failed', 'cancelled', 'rejected', 'expired']);
const fail = (code: string): never => {
  throw new ManagedExecutionError(code);
};
const equal = (a: unknown, b: unknown) => automationInputHash(a) === automationInputHash(b);

/** Stable across credentials, local run UUIDs, login revisions, and input edits. */
export function managedGenerationKey(namespace: string, callerKey: string): string {
  // Input validation is shared with the persisted entity and registration command.
  managedGenerationRecordSchema.shape.namespace.parse(namespace);
  registerManagedGenerationSchema.shape.callerKey.parse(callerKey);
  return `desktop-g-v1:${automationInputHash([namespace, callerKey, 'G', 0])}`;
}

/**
 * One managed remote send per original image of an R/S run. Stable per
 * (namespace, callerKey, originalJobId); re-deriving after a crash yields the same key,
 * so a replayed child can only ever land on its own remote idempotency slot.
 */
export function managedRunChildKey(
  namespace: string,
  callerKey: string,
  originalJobId: string,
): string {
  managedRunRecordSchema.shape.namespace.parse(namespace);
  registerManagedRunSchema.shape.callerKey.parse(callerKey);
  managedRunChildSchema.shape.originalJobId.parse(originalJobId);
  return `desktop-rs-v1:${automationInputHash([namespace, callerKey, originalJobId])}`;
}

function payer(binding: ManagedGenerationRecord['binding']): AutomationPayerBinding {
  return {
    providerId: binding.providerId,
    providerType: 'musefold-cloud',
    model: binding.model,
    baseUrl: binding.apiIssuer,
    credentialEpoch: automationInputHash(binding),
    payerKind: 'account',
    ownerId: binding.payer.ownerId,
    issuer: binding.payer.issuer,
    policy: 'managed',
  };
}

/**
 * Trusted desktop coordinator, not an HTTP client. Every changed record and spend fact commits
 * with the anti-rollback checkpoint. The host must hold directory ownership and capture both
 * DB and account access in assertCurrent. Constructing/reading never enables managed execution.
 */
export class ManagedGenerationLedger {
  private readonly spend: AutomationSpendRepository;
  private readonly fresh = new Set<string>();
  private readonly runtimeEpoch = randomUUID();

  constructor(
    private readonly db: Database.Database,
    private readonly guard: ManagedExecutionGuard,
    private readonly assertCurrent: () => void,
  ) {
    this.spend = new AutomationSpendRepository(db);
  }

  private read(requestId: string): ManagedGenerationRecord | null {
    const row = this.db
      .prepare('SELECT record_json FROM managed_generation_requests WHERE request_id = ?')
      .get(requestId) as { record_json: string } | undefined;
    return row ? managedGenerationRecordSchema.parse(JSON.parse(row.record_json)) : null;
  }

  private required(requestId: string): ManagedGenerationRecord {
    return this.read(requestId) ?? fail('MANAGED_REQUEST_NOT_FOUND');
  }

  private own(
    record: Pick<ManagedGenerationRecord, 'binding' | 'authEpoch'>,
    context: ManagedGenerationContext,
    submitting = false,
  ) {
    const captured = managedGenerationContextSchema.parse(context);
    if (
      record.binding.apiIssuer !== captured.apiIssuer ||
      record.binding.principalId !== captured.principalId ||
      (submitting && record.authEpoch !== captured.authEpoch)
    )
      fail('MANAGED_IDENTITY_CHANGED');
  }

  /** A newer login/key may query the original owner, but cannot assume the old send permission. */
  forQuery(requestId: string, context: ManagedGenerationContext): ManagedGenerationRecord {
    this.assertCurrent();
    const record = this.required(requestId);
    this.own(record, context);
    return record;
  }

  /** Current owner may explicitly authorize a new attempt only after the original is known. */
  retrySource(requestId: string, context: ManagedGenerationContext): ManagedGenerationRecord {
    const record = this.forQuery(requestId, context);
    const receipt = record.receipt;
    const unsent =
      record.submissionState === 'unclaimed' &&
      record.cancelRequestedAt !== null &&
      !record.callId &&
      !receipt;
    const known =
      receipt?.terminalAt &&
      ['failed', 'cancelled'].includes(receipt.status) &&
      receipt.bindingState === 'bound' &&
      !receipt.purgedAt &&
      ((receipt.costProvenance === 'provider_reported' && receipt.costPoints !== null) ||
        (receipt.costProvenance === 'not_sent' && receipt.dispatch !== 'claimed'));
    if (!unsent && !known) fail('MANAGED_RETRY_UNRESOLVED');
    return record;
  }

  private retryOrigin(input: RegisterManagedGeneration) {
    if (!input.retryOfRequestId) return null;
    const source = this.retrySource(input.retryOfRequestId, {
      apiIssuer: input.binding.apiIssuer,
      principalId: input.binding.principalId,
      authEpoch: input.authEpoch,
    });
    if (
      !equal(source.frozenRequest, input.request) ||
      !equal(source.binding.payer, input.binding.payer)
    )
      fail('MANAGED_RETRY_MISMATCH');
    return { requestId: source.requestId, remoteRunId: source.receipt?.originalRunId ?? null };
  }

  private assertRetryCurrent(record: ManagedGenerationRecord, context: ManagedGenerationContext) {
    if (!record.retryOf) return;
    const source = this.retrySource(record.retryOf.requestId, context);
    if (
      (source.receipt?.originalRunId ?? null) !== record.retryOf.remoteRunId ||
      !equal(source.frozenRequest, record.frozenRequest) ||
      !equal(source.binding.payer, record.binding.payer)
    )
      fail('MANAGED_RETRY_MISMATCH');
  }

  private save(record: ManagedGenerationRecord): void {
    const parsed = managedGenerationRecordSchema.parse(record);
    this.db
      .prepare(`INSERT INTO managed_generation_requests
      (request_id, call_id, api_issuer, principal_id, remote_key, record_json) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET call_id = excluded.call_id, record_json = excluded.record_json`)
      .run(
        parsed.requestId,
        parsed.callId,
        parsed.binding.apiIssuer,
        parsed.binding.principalId,
        parsed.remoteKey,
        JSON.stringify(parsed),
      );
  }

  private coordinate<T>(
    kind: 'submit' | 'cancel' | 'receipt' | 'confirmation',
    intent: unknown,
    prepare: () => { unchanged: T } | { change: () => T },
  ): Promise<T> {
    return this.guard.coordinate<T>(kind, intent, () => {
      this.assertCurrent();
      const decision = prepare();
      if ('unchanged' in decision) return decision;
      return {
        change: () => {
          // Account/restore state can change while the pending anchor is being flushed.
          this.assertCurrent();
          return decision.change();
        },
      };
    });
  }

  async register(
    command: RegisterManagedGeneration,
  ): Promise<{ record: ManagedGenerationRecord; replayed: boolean }> {
    const input = registerManagedGenerationSchema.parse(command);
    if ((input.request.model ?? CLOUD_GENERATION_MODEL) !== input.binding.model)
      fail('MANAGED_MODEL_MISMATCH');
    const inputHash = automationInputHash({
      binding: input.binding,
      request: input.request,
      ...(input.retryOfRequestId ? { retryOfRequestId: input.retryOfRequestId } : {}),
    });
    const result = await this.coordinate<{ record: ManagedGenerationRecord; replayed: boolean }>(
      'submit',
      { keyHash: automationInputHash(input.callerKey), inputHash },
      () => {
        const previous = this.spend.findByKey(input.callerKey);
        if (previous) {
          const record = this.required(previous.id);
          if (record.inputHash !== inputHash) fail('IDEMPOTENCY_CONFLICT');
          return { unchanged: { record, replayed: true } };
        }
        const retryOf = this.retryOrigin(input);
        if (this.spend.findByExecutionId(input.executionId)) fail('MANAGED_EXECUTION_CONFLICT');
        this.spend.budget(input.now); // Validate policy before writing a durable pending operation.
        const checkpoint =
          new ManagedExecutionRepository(this.db).checkpoint() ??
          fail('MANAGED_RECONCILIATION_REQUIRED');
        return {
          change: () => {
            if (!equal(this.retryOrigin(input), retryOf)) fail('MANAGED_RETRY_MISMATCH');
            const { request } = this.spend.register({
              idempotencyKey: input.callerKey,
              action: 'generate_image',
              caller: input.caller,
              input: input.request,
              frozenInput: input.request,
              bindings: [payer(input.binding)],
              promptText: input.request.prompt,
              executionId: input.executionId,
              maxImageCalls: 1,
              maxTextCalls: 0,
              estimatedPoints: input.estimatedPoints,
              declaredBudgetPoints: input.declaredBudgetPoints,
              consent: input.consent,
              now: input.now,
            });
            const record: ManagedGenerationRecord = {
              requestId: request.id,
              callId: null,
              localGenerationId: null,
              namespace: checkpoint.namespace,
              remoteKey: managedGenerationKey(checkpoint.namespace, input.callerKey),
              callerKey: input.callerKey,
              binding: input.binding,
              authEpoch: input.authEpoch,
              runtimeEpoch: this.runtimeEpoch,
              frozenRequest: input.request,
              retryOf,
              inputHash,
              submissionState: 'unclaimed',
              receipt: null,
              cancelRequestedAt: null,
              cancelAcknowledgedAt: null,
              createdAt: input.now,
              updatedAt: input.now,
            };
            this.save(record);
            return { record, replayed: false };
          },
        };
      },
    );
    // No capability is recovered from SQLite. A crash even before POST is query-only.
    if (!result.replayed) this.fresh.add(result.record.requestId);
    return result;
  }

  async resolveConfirmation(
    requestId: string,
    context: ManagedGenerationContext,
    approved: boolean,
    now: number,
  ): Promise<boolean> {
    if (typeof approved !== 'boolean') fail('INVALID_APPROVAL');
    registerManagedGenerationSchema.shape.now.parse(now);
    return this.coordinate<boolean>('confirmation', { requestId, approved, now }, () => {
      const record = this.forQuery(requestId, context);
      this.own(record, context, approved);
      const request = this.spend.get(requestId) ?? fail('MANAGED_REQUEST_NOT_FOUND');
      if (request.state !== 'pending_confirmation') return { unchanged: false };
      const confirmation = request.confirmationId ?? fail('MANAGED_REQUEST_CORRUPT');
      return { change: () => this.spend.resolveConfirmation(confirmation, approved, now) };
    });
  }

  /** Returns the sole live initial-send snapshot only after both durable commits. No retries. */
  async claimSubmission(
    requestId: string,
    context: ManagedGenerationContext,
    currentBinding: ManagedGenerationRecord['binding'],
    localGenerationId: string,
    now: number,
  ): Promise<ManagedGenerationRecord> {
    managedGenerationRecordSchema.shape.localGenerationId.unwrap().parse(localGenerationId);
    registerManagedGenerationSchema.shape.now.parse(now);
    if (!this.fresh.delete(requestId)) fail('MANAGED_QUERY_ONLY');
    const record = await this.coordinate('submit', { requestId, localGenerationId }, () => {
      const current = this.forQuery(requestId, context);
      if (current.cancelRequestedAt !== null) fail('MANAGED_CANCEL_REQUESTED');
      this.assertRetryCurrent(current, context);
      this.own(current, context, true);
      if (!equal(current.binding, currentBinding)) fail('MANAGED_IDENTITY_CHANGED');
      if ((current.frozenRequest.model ?? CLOUD_GENERATION_MODEL) !== current.binding.model)
        fail('MANAGED_MODEL_MISMATCH');
      if (current.submissionState !== 'unclaimed' || current.runtimeEpoch !== this.runtimeEpoch)
        fail('MANAGED_QUERY_ONLY');
      const request = this.spend.get(requestId) ?? fail('MANAGED_REQUEST_NOT_FOUND');
      if (request.state !== 'authorized') fail('SPEND_NOT_AUTHORIZED');
      return {
        change: () => {
          this.assertRetryCurrent(current, context);
          const call = this.spend.prepareCall({
            requestId,
            ordinal: 0,
            kind: 'image',
            binding: payer(current.binding),
            input: current.frozenRequest,
            generationRunId: localGenerationId,
          });
          if (!this.spend.claimCall(call.id, payer(current.binding), this.runtimeEpoch, now))
            fail('MANAGED_QUERY_ONLY');
          const next: ManagedGenerationRecord = {
            ...current,
            callId: call.id,
            localGenerationId,
            submissionState: 'query_only',
            updatedAt: now,
          };
          this.save(next);
          // A lost response is not evidence that admission or provider dispatch did not occur.
          this.db
            .prepare(
              "UPDATE automation_spend_requests SET reservation_state = 'unknown', revision = revision + 1 WHERE id = ?",
            )
            .run(requestId);
          return next;
        },
      };
    });
    this.assertCurrent();
    return record;
  }

  async requestCancellation(
    requestId: string,
    context: ManagedGenerationContext,
    now: number,
  ): Promise<void> {
    registerManagedGenerationSchema.shape.now.parse(now);
    await this.coordinate<void>('cancel', { requestId, now }, () => {
      const record = this.forQuery(requestId, context);
      if (record.cancelRequestedAt !== null) return { unchanged: undefined };
      return {
        change: () => {
          this.save({ ...record, cancelRequestedAt: now, updatedAt: now });
          // A durable cancellation serialized before claim proves that no remote POST is allowed.
          if (record.submissionState === 'unclaimed' && record.callId === null) {
            const request = this.spend.get(requestId) ?? fail('MANAGED_REQUEST_NOT_FOUND');
            if (request.state === 'pending_confirmation' && request.confirmationId)
              this.spend.resolveConfirmation(request.confirmationId, false, now);
            else if (request.state !== 'terminal')
              this.spend.finishRequest(requestId, 'cancelled', now);
          }
        },
      };
    });
  }

  async acknowledgeCancellation(
    requestId: string,
    context: ManagedGenerationContext,
    now: number,
  ): Promise<void> {
    registerManagedGenerationSchema.shape.now.parse(now);
    await this.coordinate<void>('cancel', { requestId, acknowledged: true }, () => {
      const record = this.forQuery(requestId, context);
      if (record.cancelRequestedAt === null) fail('MANAGED_CANCEL_NOT_REQUESTED');
      if (record.cancelAcknowledgedAt !== null) return { unchanged: undefined };
      return { change: () => this.save({ ...record, cancelAcknowledgedAt: now, updatedAt: now }) };
    });
  }

  async applyReceipt(
    requestId: string,
    context: ManagedGenerationContext,
    received: GenerationExecutionReceipt,
    now: number,
  ): Promise<boolean> {
    const receipt = generationExecutionReceiptSchema.parse(received);
    registerManagedGenerationSchema.shape.now.parse(now);
    if (!Number.isSafeInteger(receipt.revision)) fail('MANAGED_RECEIPT_INVALID');
    return this.coordinate<boolean>(
      'receipt',
      { requestId, receiptId: receipt.id, revision: receipt.revision },
      () => {
        const current = this.forQuery(requestId, context);
        if (
          !current.callId ||
          current.submissionState !== 'query_only' ||
          receipt.operation !==
            (current.retryOf?.remoteRunId ? 'explicit_retry' : 'ordinary_create') ||
          receipt.sourceRunId !== (current.retryOf?.remoteRunId ?? null) ||
          receipt.idempotencyKey !== current.remoteKey ||
          !equal(receipt.binding, current.binding) ||
          receipt.principalId !== current.binding.principalId
        )
          fail('MANAGED_RECEIPT_MISMATCH');
        const previous = current.receipt;
        if (
          previous &&
          (previous.id !== receipt.id ||
            previous.originalRunId !== receipt.originalRunId ||
            previous.createdAt !== receipt.createdAt)
        )
          fail('MANAGED_RECEIPT_MISMATCH');
        if (previous && receipt.revision < previous.revision) return { unchanged: false };
        if (previous && receipt.revision === previous.revision) {
          if (!equal(previous, receipt)) fail('MANAGED_RECEIPT_CONFLICT');
          return { unchanged: false };
        }
        validateTransition(previous, receipt);
        return {
          change: () => {
            this.save({ ...current, receipt, updatedAt: now });
            this.applyCost(current, receipt, now);
            return true;
          },
        };
      },
    );
  }

  private applyCost(
    record: ManagedGenerationRecord,
    receipt: GenerationExecutionReceipt,
    now: number,
  ): void {
    const terminal = terminalStatuses.has(receipt.status);
    const notSent =
      terminal && receipt.dispatch !== 'claimed' && receipt.costProvenance === 'not_sent';
    const reported = terminal && receipt.costProvenance === 'provider_reported';
    const known = notSent || reported;
    const points = notSent ? 0 : reported ? receipt.costPoints : null;
    const request = this.spend.get(record.requestId) ?? fail('MANAGED_REQUEST_NOT_FOUND');
    const reservation = known
      ? 'released'
      : receipt.dispatch === 'claimed' || terminal || request.estimatedPoints === null
        ? 'unknown'
        : 'held';
    this.db
      .prepare(`UPDATE automation_spend_calls SET state = ?, reported_points = ?, policy_points = ?,
      cost_source = ?, evidence_ref = ?, finished_at = ? WHERE id = ? AND request_id = ?`)
      .run(
        notSent
          ? 'not_sent'
          : reported
            ? 'completed'
            : receipt.dispatch === 'claimed' || terminal
              ? 'unknown'
              : 'started',
        reported ? points : null,
        points,
        reported ? 'provider_reported' : 'unknown',
        receipt.id,
        terminal ? now : null,
        record.callId,
        record.requestId,
      );
    const outcome =
      receipt.status === 'succeeded'
        ? 'success'
        : receipt.status === 'cancelled'
          ? 'cancelled'
          : 'failed';
    this.db
      .prepare(`UPDATE automation_spend_requests SET state = ?, outcome = ?, finished_at = ?,
      reservation_state = ?, revision = revision + 1 WHERE id = ?`)
      .run(
        terminal ? 'terminal' : 'running',
        terminal ? outcome : null,
        terminal ? now : null,
        reservation,
        record.requestId,
      );
    if (!terminal) return;
    // Immutable per-terminal-revision audit; no prompt, bearer, URL, or response body is recorded here.
    this.db
      .prepare(`INSERT INTO automation_audit
      (at, caller, action, prompt_text, params_json, estimated_points, actual_points, approved_via,
       status, job_id, automation_request_id, event_key) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        now,
        request.caller,
        request.action,
        JSON.stringify({
          receiptId: receipt.id,
          revision: receipt.revision,
          dispatch: receipt.dispatch,
          costProvenance: receipt.costProvenance,
          remoteStatus: receipt.status,
          reservationState: reservation,
        }),
        request.estimatedPoints,
        points,
        request.approvalSource ?? 'denied',
        outcome,
        request.executionId,
        request.id,
        `receipt:${receipt.id}:${receipt.revision}`,
      );
  }

  // ---- R/S(run_scheme / run_github_skill)运行级账本 ----
  // 一个 run = 一条 automation_spend_request(一次预留、一次请求级确认)+ N 个子发送。
  // 每个原图 job 一个子记录,各自持有稳定的 remoteKey;G 路径方法保持逐字节不变。

  private readRun(requestId: string): ManagedRunRecord | null {
    const row = this.db
      .prepare('SELECT record_json FROM managed_run_requests WHERE request_id = ?')
      .get(requestId) as { record_json: string } | undefined;
    return row ? managedRunRecordSchema.parse(JSON.parse(row.record_json)) : null;
  }

  private requiredRun(requestId: string): ManagedRunRecord {
    return this.readRun(requestId) ?? fail('MANAGED_REQUEST_NOT_FOUND');
  }

  private saveRun(record: ManagedRunRecord): void {
    const parsed = managedRunRecordSchema.parse(record);
    this.db
      .prepare(`INSERT INTO managed_run_requests
      (request_id, api_issuer, principal_id, caller_key, run_kind, record_json) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET record_json = excluded.record_json`)
      .run(
        parsed.requestId,
        parsed.binding.apiIssuer,
        parsed.binding.principalId,
        parsed.callerKey,
        parsed.run.runKind,
        JSON.stringify(parsed),
      );
    const childStatement = this.db.prepare(`INSERT INTO managed_run_children
    (request_id, ordinal, original_job_id, remote_key, call_id, local_generation_id, record_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(request_id, ordinal) DO UPDATE SET call_id = excluded.call_id,
      local_generation_id = excluded.local_generation_id, record_json = excluded.record_json`);
    for (const child of parsed.children)
      childStatement.run(
        parsed.requestId,
        child.ordinal,
        child.originalJobId,
        child.remoteKey,
        child.callId,
        child.localGenerationId,
        JSON.stringify(child),
      );
  }

  forRunQuery(requestId: string, context: ManagedGenerationContext): ManagedRunRecord {
    this.assertCurrent();
    const record = this.requiredRun(requestId);
    this.own(record, context);
    return record;
  }

  /**
   * One durable register for the whole run: a single spend reservation (maxImageCalls = n)
   * plus N unclaimed children. Replaying the same callerKey returns the existing plan;
   * a partially failed run never re-dispatches its remaining children from here.
   */
  async registerRun(
    command: RegisterManagedRun,
  ): Promise<{ record: ManagedRunRecord; replayed: boolean }> {
    const input = registerManagedRunSchema.parse(command);
    const inputHash = automationInputHash({ binding: input.binding, run: input.run });
    const textBinding = input.run.textBinding;
    const result = await this.coordinate<{ record: ManagedRunRecord; replayed: boolean }>(
      'submit',
      { keyHash: automationInputHash(input.callerKey), inputHash },
      () => {
        const previous = this.spend.findByKey(input.callerKey);
        if (previous) {
          const record = this.requiredRun(previous.id);
          if (record.inputHash !== inputHash) fail('IDEMPOTENCY_CONFLICT');
          return { unchanged: { record, replayed: true } };
        }
        if (this.spend.findByExecutionId(input.executionId)) fail('MANAGED_EXECUTION_CONFLICT');
        this.spend.budget(input.now); // Validate policy before writing a durable pending operation.
        const checkpoint =
          new ManagedExecutionRepository(this.db).checkpoint() ??
          fail('MANAGED_RECONCILIATION_REQUIRED');
        return {
          change: () => {
            const { request } = this.spend.register({
              idempotencyKey: input.callerKey,
              action: input.run.runKind,
              caller: input.caller,
              input: input.run,
              frozenInput: input.run,
              // Cloud image payer first; the text binding rides along so an unbound
              // (hosted) text payer terminates the whole run at registration, zero sends.
              bindings: textBinding ? [payer(input.binding), textBinding] : [payer(input.binding)],
              promptText: null,
              executionId: input.executionId,
              maxImageCalls: input.run.originalJobIds.length,
              // Mirrors the legacy R/S gate: text-capable runs reserve headroom for agent loops.
              maxTextCalls: textBinding ? 10 : 0,
              estimatedPoints: input.estimatedPoints,
              declaredBudgetPoints: input.declaredBudgetPoints,
              consent: input.consent,
              now: input.now,
            });
            const record: ManagedRunRecord = {
              requestId: request.id,
              callerKey: input.callerKey,
              namespace: checkpoint.namespace,
              binding: input.binding,
              authEpoch: input.authEpoch,
              runtimeEpoch: this.runtimeEpoch,
              run: input.run,
              children: input.run.originalJobIds.map((originalJobId, ordinal) => ({
                ordinal,
                originalJobId,
                remoteKey: managedRunChildKey(checkpoint.namespace, input.callerKey, originalJobId),
                callId: null,
                localGenerationId: null,
                submissionState: 'unclaimed',
                receipt: null,
                cancelAcknowledgedAt: null,
              })),
              inputHash,
              cancelRequestedAt: null,
              createdAt: input.now,
              updatedAt: input.now,
            };
            this.saveRun(record);
            return { record, replayed: false };
          },
        };
      },
    );
    // Per-child one-time send permits die with the process; recovery is query-only.
    if (!result.replayed)
      for (const child of result.record.children)
        this.fresh.add(`${result.record.requestId}#${child.ordinal}`);
    return result;
  }

  async resolveRunConfirmation(
    requestId: string,
    context: ManagedGenerationContext,
    approved: boolean,
    now: number,
  ): Promise<boolean> {
    if (typeof approved !== 'boolean') fail('INVALID_APPROVAL');
    registerManagedGenerationSchema.shape.now.parse(now);
    return this.coordinate<boolean>('confirmation', { requestId, approved, now }, () => {
      const record = this.forRunQuery(requestId, context);
      this.own(record, context, approved);
      const request = this.spend.get(requestId) ?? fail('MANAGED_REQUEST_NOT_FOUND');
      if (request.state !== 'pending_confirmation') return { unchanged: false };
      const confirmation = request.confirmationId ?? fail('MANAGED_REQUEST_CORRUPT');
      return { change: () => this.spend.resolveConfirmation(confirmation, approved, now) };
    });
  }

  /**
   * Claims one original image's send. The per-child input (prompt + frozen references) is
   * persisted as the call's frozen input at this instant, then the child becomes query-only:
   * a lost POST reply is not evidence the provider dispatch did not happen.
   */
  async claimRunChild(
    requestId: string,
    ordinal: number,
    context: ManagedGenerationContext,
    currentBinding: ManagedRunRecord['binding'],
    childInput: ManagedRunChildInput,
    localGenerationId: string,
    now: number,
  ): Promise<{ record: ManagedRunRecord; child: ManagedRunChild }> {
    const input = managedRunChildInputSchema.parse(childInput);
    managedRunChildSchema.shape.localGenerationId.unwrap().parse(localGenerationId);
    registerManagedRunSchema.shape.now.parse(now);
    if (!this.fresh.delete(`${requestId}#${ordinal}`)) fail('MANAGED_QUERY_ONLY');
    const claimed = await this.coordinate<{ record: ManagedRunRecord; child: ManagedRunChild }>(
      'submit',
      { requestId, ordinal, localGenerationId },
      () => {
        const current = this.forRunQuery(requestId, context);
        if (current.cancelRequestedAt !== null) fail('MANAGED_CANCEL_REQUESTED');
        this.own(current, context, true);
        if (!equal(current.binding, currentBinding)) fail('MANAGED_IDENTITY_CHANGED');
        if ((input.model ?? CLOUD_GENERATION_MODEL) !== current.binding.model)
          fail('MANAGED_MODEL_MISMATCH');
        const child = current.children[ordinal] ?? fail('MANAGED_REQUEST_NOT_FOUND');
        if (child.submissionState !== 'unclaimed' || current.runtimeEpoch !== this.runtimeEpoch)
          fail('MANAGED_QUERY_ONLY');
        const request = this.spend.get(requestId) ?? fail('MANAGED_REQUEST_NOT_FOUND');
        if (!['authorized', 'running'].includes(request.state)) fail('SPEND_NOT_AUTHORIZED');
        return {
          change: () => {
            const call = this.spend.prepareCall({
              requestId,
              ordinal,
              kind: 'image',
              binding: payer(current.binding),
              input,
              generationRunId: localGenerationId,
            });
            if (!this.spend.claimCall(call.id, payer(current.binding), this.runtimeEpoch, now))
              fail('MANAGED_QUERY_ONLY');
            const next: ManagedRunChild = {
              ...child,
              callId: call.id,
              localGenerationId,
              submissionState: 'query_only',
            };
            const record: ManagedRunRecord = {
              ...current,
              children: current.children.map((item) => (item.ordinal === ordinal ? next : item)),
              updatedAt: now,
            };
            this.saveRun(record);
            this.db
              .prepare(
                "UPDATE automation_spend_requests SET reservation_state = 'unknown', revision = revision + 1 WHERE id = ?",
              )
              .run(requestId);
            return { record, child: next };
          },
        };
      },
    );
    this.assertCurrent();
    return claimed;
  }

  async applyRunChildReceipt(
    requestId: string,
    ordinal: number,
    context: ManagedGenerationContext,
    received: GenerationExecutionReceipt,
    now: number,
  ): Promise<boolean> {
    const receipt = generationExecutionReceiptSchema.parse(received);
    registerManagedRunSchema.shape.now.parse(now);
    if (!Number.isSafeInteger(receipt.revision)) fail('MANAGED_RECEIPT_INVALID');
    return this.coordinate<boolean>(
      'receipt',
      { requestId, ordinal, receiptId: receipt.id, revision: receipt.revision },
      () => {
        const current = this.forRunQuery(requestId, context);
        const child = current.children[ordinal] ?? fail('MANAGED_REQUEST_NOT_FOUND');
        if (
          !child.callId ||
          child.submissionState !== 'query_only' ||
          receipt.operation !== 'ordinary_create' ||
          receipt.sourceRunId !== null ||
          receipt.idempotencyKey !== child.remoteKey ||
          !equal(receipt.binding, current.binding) ||
          receipt.principalId !== current.binding.principalId
        )
          fail('MANAGED_RECEIPT_MISMATCH');
        const previous = child.receipt;
        if (
          previous &&
          (previous.id !== receipt.id ||
            previous.originalRunId !== receipt.originalRunId ||
            previous.createdAt !== receipt.createdAt)
        )
          fail('MANAGED_RECEIPT_MISMATCH');
        if (previous && receipt.revision < previous.revision) return { unchanged: false };
        if (previous && receipt.revision === previous.revision) {
          if (!equal(previous, receipt)) fail('MANAGED_RECEIPT_CONFLICT');
          return { unchanged: false };
        }
        validateTransition(previous, receipt);
        return {
          change: () => {
            const next: ManagedRunChild = { ...child, receipt };
            const record: ManagedRunRecord = {
              ...current,
              children: current.children.map((item) => (item.ordinal === ordinal ? next : item)),
              updatedAt: now,
            };
            this.saveRun(record);
            this.applyRunChildCost(record, next, receipt, now);
            this.maybeFinishRun(record, now);
            return true;
          },
        };
      },
    );
  }

  /** Mirrors G cost projection per child; the shared reservation releases only at run finish. */
  private applyRunChildCost(
    record: ManagedRunRecord,
    child: ManagedRunChild,
    receipt: GenerationExecutionReceipt,
    now: number,
  ): void {
    const terminal = terminalStatuses.has(receipt.status);
    const notSent =
      terminal && receipt.dispatch !== 'claimed' && receipt.costProvenance === 'not_sent';
    const reported = terminal && receipt.costProvenance === 'provider_reported';
    const points = notSent ? 0 : reported ? receipt.costPoints : null;
    const request = this.spend.get(record.requestId) ?? fail('MANAGED_REQUEST_NOT_FOUND');
    this.db
      .prepare(`UPDATE automation_spend_calls SET state = ?, reported_points = ?, policy_points = ?,
      cost_source = ?, evidence_ref = ?, finished_at = ? WHERE id = ? AND request_id = ?`)
      .run(
        notSent
          ? 'not_sent'
          : reported
            ? 'completed'
            : receipt.dispatch === 'claimed' || terminal
              ? 'unknown'
              : 'started',
        reported ? points : null,
        points,
        reported ? 'provider_reported' : 'unknown',
        receipt.id,
        terminal ? now : null,
        child.callId,
        record.requestId,
      );
    if (!terminal) {
      // An in-flight child makes the run-wide reservation unknowable, mirroring G mid-send.
      this.db
        .prepare(`UPDATE automation_spend_requests SET state = 'running',
        reservation_state = CASE WHEN ? = 'claimed' OR estimated_points IS NULL THEN 'unknown' ELSE reservation_state END,
        revision = revision + 1 WHERE id = ?`)
        .run(receipt.dispatch, record.requestId);
      return;
    }
    const outcome =
      receipt.status === 'succeeded'
        ? 'success'
        : receipt.status === 'cancelled'
          ? 'cancelled'
          : 'failed';
    // Immutable per-terminal-revision audit, one per child send.
    this.db
      .prepare(`INSERT INTO automation_audit
      (at, caller, action, prompt_text, params_json, estimated_points, actual_points, approved_via,
       status, job_id, automation_request_id, event_key) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        now,
        request.caller,
        request.action,
        JSON.stringify({
          childOrdinal: child.ordinal,
          receiptId: receipt.id,
          revision: receipt.revision,
          dispatch: receipt.dispatch,
          costProvenance: receipt.costProvenance,
          remoteStatus: receipt.status,
        }),
        request.estimatedPoints,
        points,
        request.approvalSource ?? 'denied',
        outcome,
        request.executionId,
        request.id,
        `receipt:${receipt.id}:${receipt.revision}`,
      );
  }

  /** A child is settled by a terminal remote receipt, or by a zero-send cancellation ack. */
  private runChildSettled(child: ManagedRunChild): boolean {
    return (
      (child.receipt?.terminalAt ?? null) !== null ||
      (child.callId === null && child.cancelAcknowledgedAt !== null)
    );
  }

  /** Finishes the run request once every child is settled; shared reservation releases here. */
  private maybeFinishRun(record: ManagedRunRecord, now: number): void {
    const request = this.spend.get(record.requestId);
    if (!request || request.state === 'terminal' || request.state === 'pending_confirmation')
      return;
    if (!record.children.every((child) => this.runChildSettled(child))) return;
    const outcome = record.children.some((child) => child.receipt?.status === 'succeeded')
      ? 'success'
      : record.cancelRequestedAt !== null
        ? 'cancelled'
        : 'failed';
    this.spend.finishRequest(record.requestId, outcome, now);
  }

  async requestRunCancellation(
    requestId: string,
    context: ManagedGenerationContext,
    now: number,
  ): Promise<void> {
    registerManagedRunSchema.shape.now.parse(now);
    await this.coordinate<void>('cancel', { requestId, now }, () => {
      const record = this.forRunQuery(requestId, context);
      if (record.cancelRequestedAt !== null) return { unchanged: undefined };
      return {
        change: () => {
          this.saveRun({ ...record, cancelRequestedAt: now, updatedAt: now });
          // Cancellation serialized before any child claim proves no remote POST is allowed:
          // the whole run terminates at zero cost without dispatching remaining children.
          if (record.children.every((child) => child.callId === null)) {
            const request = this.spend.get(requestId) ?? fail('MANAGED_REQUEST_NOT_FOUND');
            if (request.state === 'pending_confirmation' && request.confirmationId)
              this.spend.resolveConfirmation(request.confirmationId, false, now);
            else if (request.state !== 'terminal')
              this.spend.finishRequest(requestId, 'cancelled', now);
          }
        },
      };
    });
  }

  /**
   * Zero-cost acknowledgment for a child that was never claimed. Claimed children resolve
   * through their remote receipts instead, so a late success is still accepted.
   */
  async acknowledgeRunChildCancellation(
    requestId: string,
    ordinal: number,
    context: ManagedGenerationContext,
    now: number,
  ): Promise<void> {
    registerManagedRunSchema.shape.now.parse(now);
    await this.coordinate<void>('cancel', { requestId, ordinal, acknowledged: true }, () => {
      const record = this.forRunQuery(requestId, context);
      if (record.cancelRequestedAt === null) fail('MANAGED_CANCEL_NOT_REQUESTED');
      const child = record.children[ordinal] ?? fail('MANAGED_REQUEST_NOT_FOUND');
      if (child.cancelAcknowledgedAt !== null) return { unchanged: undefined };
      if (child.callId !== null) fail('MANAGED_CANCEL_CONFLICT');
      return {
        change: () => {
          const next: ManagedRunChild = { ...child, cancelAcknowledgedAt: now };
          const updated: ManagedRunRecord = {
            ...record,
            children: record.children.map((item) => (item.ordinal === ordinal ? next : item)),
            updatedAt: now,
          };
          this.saveRun(updated);
          this.maybeFinishRun(updated, now);
        },
      };
    });
  }

  /** BYOK text rides the same single reservation; hosted text never reaches a claim. */
  async claimRunTextCall(
    requestId: string,
    context: ManagedGenerationContext,
    currentBinding: AutomationPayerBinding,
    input: { url: string; body: string },
    now: number,
  ): Promise<{ callId: string; claimId: string; ordinal: number }> {
    registerManagedRunSchema.shape.now.parse(now);
    return this.coordinate<{ callId: string; claimId: string; ordinal: number }>(
      'submit',
      { requestId, kind: 'text', urlHash: automationInputHash(input) },
      () => {
        const record = this.forRunQuery(requestId, context);
        this.own(record, context, true);
        const textBinding = record.run.textBinding ?? fail('PAYMENT_IDENTITY_UNBOUND');
        if (!equal(textBinding, currentBinding)) fail('MANAGED_IDENTITY_CHANGED');
        if (record.cancelRequestedAt !== null) fail('MANAGED_CANCEL_REQUESTED');
        const request = this.spend.get(requestId) ?? fail('MANAGED_REQUEST_NOT_FOUND');
        if (!['authorized', 'running'].includes(request.state)) fail('SPEND_NOT_AUTHORIZED');
        const ordinal =
          request.maxImageCalls +
          this.spend.calls(requestId).filter((call) => call.kind === 'text').length;
        return {
          change: () => {
            const call = this.spend.prepareCall({
              requestId,
              ordinal,
              kind: 'text',
              binding: textBinding,
              input,
              generationRunId: null,
            });
            const claim = this.spend.claimCall(call.id, textBinding, this.runtimeEpoch, now);
            const claimId = claim?.claimId ?? fail('SPEND_ALREADY_DISPATCHED');
            return { callId: call.id, claimId, ordinal };
          },
        };
      },
    );
  }

  /** Tokens/HTTP success cannot establish a point charge; text always completes unknown. */
  async completeRunTextCall(
    requestId: string,
    callId: string,
    claimId: string,
    now: number,
  ): Promise<boolean> {
    registerManagedRunSchema.shape.now.parse(now);
    return this.coordinate<boolean>('receipt', { requestId, callId }, () => ({
      change: () =>
        this.spend.completeCall(
          callId,
          claimId,
          {
            reportedPoints: null,
            source: 'unknown',
            evidenceRef: null,
          },
          now,
        ),
    }));
  }
}

function validateTransition(
  previous: GenerationExecutionReceipt | null,
  next: GenerationExecutionReceipt,
) {
  const terminal = terminalStatuses.has(next.status);
  if (
    terminal !== (next.terminalAt !== null) ||
    (next.status === 'succeeded' && next.dispatch !== 'claimed') ||
    (next.purgedAt !== null && !terminal) ||
    (next.costProvenance === 'not_sent' && next.dispatch === 'claimed') ||
    (next.costProvenance === 'provider_reported' && next.dispatch !== 'claimed') ||
    (next.dispatch === 'confirmed_not_sent' && !terminal)
  )
    fail('MANAGED_RECEIPT_INVALID');
  if (!previous) return;
  if (
    (terminalStatuses.has(previous.status) && !terminal) ||
    (previous.status === 'succeeded' && next.status !== 'succeeded') ||
    (previous.dispatch === 'claimed' && next.dispatch === 'not_started') ||
    (terminalStatuses.has(previous.status) &&
      previous.costProvenance === 'not_sent' &&
      next.costProvenance !== 'not_sent') ||
    (previous.dispatch === 'confirmed_not_sent' && next.dispatch !== 'confirmed_not_sent') ||
    (previous.costProvenance === 'provider_reported' &&
      (next.costProvenance !== 'provider_reported' || next.costPoints !== previous.costPoints)) ||
    (previous.purgedAt !== null && next.purgedAt !== previous.purgedAt)
  )
    fail('MANAGED_RECEIPT_REGRESSION');
}
