import {
  assertManagedSpendWrite,
  assertSharedBudgetWrite,
  isManagedSpend,
  needsManagedSpendCoordinator,
} from './managed-spend-scope';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  automationCostEvidenceSchema,
  automationLegacyBudgetSchema,
  automationPayerBindingSchema,
  automationSpendCallSchema,
  automationSpendRequestSchema,
  prepareAutomationCallSchema,
  registerAutomationSpendSchema,
  type AutomationCostEvidence,
  type AutomationLegacyBudget,
  type AutomationPayerBinding,
  type AutomationSpendCall,
  type AutomationSpendRequest,
  type PrepareAutomationCall,
  type RegisterAutomationSpend,
} from '@musefold/desktop-contracts/automation-spend';

/** One local database is one control scope; token/account/action changes do not reset keys. */
export const LOCAL_AUTOMATION_SPEND_SCOPE = 'local-automation-v1';
const CONFIRMATION_LIFETIME_MS = 120_000;

export class AutomationSpendError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AutomationSpendError';
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function automationInputHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function automationBudgetMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** Pure legacy normalization: importing does not reset a previous month's historical usage. */
export function normalizeLegacyAutomationBudget(
  value: unknown,
  now: number,
): AutomationLegacyBudget {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return automationLegacyBudgetSchema.parse({
    monthlyLimitPoints:
      raw.monthlyLimitPoints ??
      (typeof raw.monthlyLimitCents === 'number' ? raw.monthlyLimitCents / 10 : 0),
    usedPoints: raw.usedPoints ?? (typeof raw.usedCents === 'number' ? raw.usedCents / 10 : 0),
    month: raw.month ?? automationBudgetMonth(now),
  });
}

function camelRow(row: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}

function requestRow(row: unknown): AutomationSpendRequest | null {
  if (!row) return null;
  const { frozenInputJson, bindingsJson, ...rest } = camelRow(row);
  return automationSpendRequestSchema.parse({
    ...rest,
    frozenInput: JSON.parse(String(frozenInputJson)),
    bindings: JSON.parse(String(bindingsJson)),
  });
}

function callRow(row: unknown): AutomationSpendCall | null {
  if (!row) return null;
  const { bindingJson, ...rest } = camelRow(row);
  return automationSpendCallSchema.parse({ ...rest, binding: JSON.parse(String(bindingJson)) });
}

/** All mutations use immediate transactions: a second connection cannot spend the same snapshot. */
export class AutomationSpendRepository {
  constructor(
    private readonly db: Database.Database,
    readonly scopeId = LOCAL_AUTOMATION_SPEND_SCOPE,
  ) {}

  isInitialized(): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM automation_spend_policies WHERE scope_id = ?')
        .get(this.scopeId),
    );
  }

  initializeBudget(legacy: AutomationLegacyBudget, now: number): boolean {
    const seed = automationLegacyBudgetSchema.parse(legacy);
    return this.db
      .transaction(() => {
        if (this.isInitialized()) return false;
        assertSharedBudgetWrite(this.db);
        const inserted = this.db
          .prepare(`INSERT OR IGNORE INTO automation_spend_policies
        (scope_id, monthly_limit_points, revision, imported_at, updated_at) VALUES (?, ?, 1, ?, ?)`)
          .run(this.scopeId, seed.monthlyLimitPoints, now, now);
        if (inserted.changes === 0) return false;
        this.db
          .prepare(
            `INSERT INTO automation_budget_periods (scope_id, month, opening_points, created_at) VALUES (?, ?, ?, ?)`,
          )
          .run(this.scopeId, seed.month, seed.usedPoints, now);
        return true;
      })
      .immediate();
  }

  setBudgetLimit(points: number, now: number): void {
    const limit = automationLegacyBudgetSchema.shape.monthlyLimitPoints.parse(points);
    this.db
      .transaction(() => {
        assertSharedBudgetWrite(this.db);
        this.requirePolicy();
        this.db
          .prepare(
            `UPDATE automation_spend_policies SET monthly_limit_points = ?, revision = revision + 1, updated_at = ? WHERE scope_id = ?`,
          )
          .run(limit, now, this.scopeId);
      })
      .immediate();
  }

  /** Transitional legacy entrypoints only; durable calls post by call identity instead. */
  recordLegacyPolicyUsage(points: number, now: number): void {
    const value = automationLegacyBudgetSchema.shape.usedPoints.parse(points);
    this.db
      .transaction(() => {
        assertSharedBudgetWrite(this.db);
        this.requirePolicy();
        this.db
          .prepare(`INSERT INTO automation_budget_periods (scope_id, month, opening_points, created_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(scope_id, month) DO UPDATE SET opening_points = opening_points + excluded.opening_points`)
          .run(this.scopeId, automationBudgetMonth(now), value, now);
      })
      .immediate();
  }

  private requirePolicy() {
    const policy = this.db
      .prepare(
        'SELECT monthly_limit_points, revision FROM automation_spend_policies WHERE scope_id = ?',
      )
      .get(this.scopeId) as { monthly_limit_points: number; revision: number } | undefined;
    if (!policy)
      throw new AutomationSpendError(
        'SPEND_POLICY_NOT_INITIALIZED',
        'Local spend policy initialization has not completed',
      );
    return policy;
  }

  budget(now: number) {
    const policy = this.requirePolicy();
    const month = automationBudgetMonth(now);
    const opening = this.db
      .prepare(
        'SELECT opening_points FROM automation_budget_periods WHERE scope_id = ? AND month = ?',
      )
      .get(this.scopeId, month) as { opening_points: number } | undefined;
    const posted = this.db
      .prepare(`SELECT COALESCE(SUM(c.policy_points), 0) AS points
      FROM automation_spend_calls c JOIN automation_spend_requests r ON r.id = c.request_id
      WHERE r.scope_id = ? AND r.budget_month = ?`)
      .get(this.scopeId, month) as { points: number };
    const held = this.db
      .prepare(`SELECT COALESCE(SUM(reservation_points), 0) AS points
      FROM automation_spend_requests WHERE scope_id = ? AND budget_month = ? AND reservation_state = 'held'`)
      .get(this.scopeId, month) as { points: number };
    // Unknown charges retain the same conservative protection across a month rollover.
    const unknown = this.db
      .prepare(`SELECT 1 FROM automation_spend_requests
      WHERE scope_id = ? AND reservation_state = 'unknown' LIMIT 1`)
      .get(this.scopeId);
    const usedPoints = (opening?.opening_points ?? 0) + posted.points;
    return {
      month,
      monthlyLimitPoints: policy.monthly_limit_points,
      usedPoints,
      reservedPoints: held.points,
      hasUnknown: Boolean(unknown),
      remainingPoints: unknown
        ? 0
        : Math.max(0, policy.monthly_limit_points - usedPoints - held.points),
      revision: policy.revision,
    };
  }

  get(id: string): AutomationSpendRequest | null {
    return requestRow(
      this.db
        .prepare('SELECT * FROM automation_spend_requests WHERE id = ? AND scope_id = ?')
        .get(id, this.scopeId),
    );
  }

  findByKey(key: string): AutomationSpendRequest | null {
    return requestRow(
      this.db
        .prepare(
          'SELECT * FROM automation_spend_requests WHERE scope_id = ? AND idempotency_key = ?',
        )
        .get(this.scopeId, key),
    );
  }

  findByExecutionId(executionId: string): AutomationSpendRequest | null {
    return requestRow(
      this.db
        .prepare('SELECT * FROM automation_spend_requests WHERE scope_id = ? AND execution_id = ?')
        .get(this.scopeId, executionId),
    );
  }

  pendingConfirmations(): AutomationSpendRequest[] {
    return this.db
      .prepare(
        `SELECT * FROM automation_spend_requests WHERE scope_id = ? AND state = 'pending_confirmation' ORDER BY created_at`,
      )
      .all(this.scopeId)
      .map((row) => automationSpendRequestSchema.parse(requestRow(row)));
  }

  beginExecution(requestId: string): boolean {
    return this.db
      .transaction(() => {
        this.required(requestId);
        assertManagedSpendWrite(this.db, requestId);
        return (
          this.db
            .prepare(
              `UPDATE automation_spend_requests SET state = 'running', revision = revision + 1 WHERE id = ? AND scope_id = ? AND state = 'authorized'`,
            )
            .run(requestId, this.scopeId).changes === 1
        );
      })
      .immediate();
  }

  private required(id: string): AutomationSpendRequest {
    const request = this.get(id);
    if (!request)
      throw new AutomationSpendError(
        'SPEND_REQUEST_NOT_FOUND',
        'Spend request does not exist in this control scope',
      );
    return request;
  }

  register(command: RegisterAutomationSpend): {
    request: AutomationSpendRequest;
    replayed: boolean;
  } {
    const input = registerAutomationSpendSchema.parse(command);
    const inputHash = automationInputHash({ action: input.action, input: input.input });
    return this.db
      .transaction(() => {
        this.requirePolicy();
        const previous = input.idempotencyKey ? this.findByKey(input.idempotencyKey) : null;
        if (previous) {
          if (
            previous.inputHash !== inputHash ||
            automationInputHash(previous.bindings) !== automationInputHash(input.bindings) ||
            automationInputHash(previous.frozenInput) !== automationInputHash(input.frozenInput)
          ) {
            throw new AutomationSpendError(
              'IDEMPOTENCY_CONFLICT',
              'The request key is already bound to a different input or payment identity',
            );
          }
          return { request: previous, replayed: true };
        }
        const budget = this.budget(input.now);
        const managed = input.bindings.some((binding) => binding.policy === 'managed');
        const unbound = input.bindings.some(
          (binding) => binding.payerKind === 'unbound' || !binding.credentialEpoch,
        );
        if (managed && !unbound) assertSharedBudgetWrite(this.db);
        const covered =
          !budget.hasUnknown &&
          budget.remainingPoints > 0 &&
          input.estimatedPoints !== null &&
          input.estimatedPoints <= budget.remainingPoints &&
          (input.declaredBudgetPoints === undefined ||
            (input.estimatedPoints <= input.declaredBudgetPoints &&
              input.declaredBudgetPoints <= budget.remainingPoints));
        const source = unbound
          ? null
          : input.consent
            ? 'consent'
            : !managed
              ? 'external'
              : covered
                ? 'budget'
                : null;
        const state = unbound ? 'terminal' : source ? 'authorized' : 'pending_confirmation';
        const requestId = randomUUID();
        this.db
          .prepare(`INSERT INTO automation_spend_requests
        (id, scope_id, idempotency_key, input_hash, action, caller, frozen_input_json, bindings_json, prompt_text,
         execution_id, max_image_calls, max_text_calls, state, outcome, error_code, approval_source, confirmation_id,
         confirmation_expires_at, budget_month, estimated_points, reservation_state, reservation_points,
         created_at, authorized_at, finished_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
          .run(
            requestId,
            this.scopeId,
            input.idempotencyKey,
            inputHash,
            input.action,
            input.caller,
            JSON.stringify(input.frozenInput),
            JSON.stringify(input.bindings),
            input.promptText,
            input.executionId,
            input.maxImageCalls,
            input.maxTextCalls,
            state,
            unbound ? 'failed' : null,
            unbound ? 'PAYMENT_IDENTITY_UNBOUND' : null,
            source,
            state === 'pending_confirmation' ? randomUUID() : null,
            state === 'pending_confirmation' ? input.now + CONFIRMATION_LIFETIME_MS : null,
            budget.month,
            input.estimatedPoints,
            source && managed ? (input.estimatedPoints === null ? 'unknown' : 'held') : 'none',
            source && managed ? input.estimatedPoints : null,
            input.now,
            source ? input.now : null,
            unbound ? input.now : null,
          );
        const request = this.required(requestId);
        if (unbound) this.writeAudit(request, 'terminal');
        return { request, replayed: false };
      })
      .immediate();
  }

  resolveConfirmation(confirmationId: string, approved: boolean, now: number): boolean {
    if (typeof approved !== 'boolean') {
      throw new AutomationSpendError('INVALID_APPROVAL', 'Approval must be an explicit boolean');
    }
    return this.db
      .transaction(() => {
        const request = requestRow(
          this.db
            .prepare(
              'SELECT * FROM automation_spend_requests WHERE confirmation_id = ? AND scope_id = ?',
            )
            .get(confirmationId, this.scopeId),
        );
        if (request?.state !== 'pending_confirmation') return false;
        assertManagedSpendWrite(this.db, request.id);
        const expired =
          request.confirmationExpiresAt === null || now >= request.confirmationExpiresAt;
        const accepted = approved && !expired;
        const managed = request.bindings.some((binding) => binding.policy === 'managed');
        this.db
          .prepare(`UPDATE automation_spend_requests SET state = ?, outcome = ?, approval_source = ?,
        reservation_state = ?, reservation_points = ?, authorized_at = ?, finished_at = ?, revision = revision + 1 WHERE id = ?`)
          .run(
            accepted ? 'authorized' : 'terminal',
            accepted ? null : expired ? 'timeout' : 'denied',
            accepted ? 'confirmation' : null,
            accepted && managed ? (request.estimatedPoints === null ? 'unknown' : 'held') : 'none',
            accepted && managed ? request.estimatedPoints : null,
            accepted ? now : null,
            accepted ? null : now,
            request.id,
          );
        if (!accepted) this.writeAudit(this.required(request.id), 'terminal');
        return !expired;
      })
      .immediate();
  }

  calls(requestId: string): AutomationSpendCall[] {
    this.required(requestId);
    return this.db
      .prepare('SELECT * FROM automation_spend_calls WHERE request_id = ? ORDER BY ordinal')
      .all(requestId)
      .map((row) => automationSpendCallSchema.parse(callRow(row)));
  }

  prepareCall(command: PrepareAutomationCall): AutomationSpendCall {
    const input = prepareAutomationCallSchema.parse(command);
    const hash = automationInputHash({
      kind: input.kind,
      binding: input.binding,
      input: input.input,
    });
    return this.db
      .transaction(() => {
        const request = this.required(input.requestId);
        assertManagedSpendWrite(this.db, request.id);
        const previous = this.calls(request.id).find((call) => call.ordinal === input.ordinal);
        if (previous) {
          if (previous.inputHash !== hash || previous.generationRunId !== input.generationRunId)
            throw new AutomationSpendError(
              'SPEND_CALL_CONFLICT',
              'Call ordinal is bound to different input',
            );
          return previous;
        }
        if (!['authorized', 'running'].includes(request.state))
          throw new AutomationSpendError(
            'SPEND_NOT_AUTHORIZED',
            'The request is not authorized for execution',
          );
        if (
          !request.bindings.some(
            (binding) => automationInputHash(binding) === automationInputHash(input.binding),
          )
        )
          throw new AutomationSpendError(
            'SPEND_IDENTITY_CHANGED',
            'Call payment identity was not authorized',
          );
        const limit = input.kind === 'image' ? request.maxImageCalls : request.maxTextCalls;
        if (this.calls(request.id).filter((call) => call.kind === input.kind).length >= limit)
          throw new AutomationSpendError(
            'SPEND_CALL_LIMIT',
            'The authorized call limit has been reached',
          );
        const callId = randomUUID();
        this.db
          .prepare(
            `INSERT INTO automation_spend_calls (id, request_id, ordinal, kind, binding_json, input_hash, generation_run_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            callId,
            request.id,
            input.ordinal,
            input.kind,
            JSON.stringify(input.binding),
            hash,
            input.generationRunId,
          );
        return automationSpendCallSchema.parse(
          this.calls(request.id).find((call) => call.id === callId),
        );
      })
      .immediate();
  }

  claimCall(
    callId: string,
    currentBinding: AutomationPayerBinding,
    runtimeEpoch: string,
    now: number,
  ): AutomationSpendCall | null {
    const binding = automationPayerBindingSchema.parse(currentBinding);
    if (!runtimeEpoch)
      throw new AutomationSpendError(
        'SPEND_RUNTIME_REQUIRED',
        'A runtime epoch is required before dispatch',
      );
    return this.db
      .transaction(() => {
        const call = callRow(
          this.db.prepare('SELECT * FROM automation_spend_calls WHERE id = ?').get(callId),
        );
        if (!call) throw new AutomationSpendError('SPEND_CALL_NOT_FOUND', 'Call does not exist');
        const request = this.required(call.requestId);
        assertManagedSpendWrite(this.db, request.id);
        if (call.state !== 'pending' || !['authorized', 'running'].includes(request.state))
          return null;
        if (
          binding.payerKind === 'unbound' ||
          automationInputHash(binding) !== automationInputHash(call.binding)
        )
          throw new AutomationSpendError(
            'SPEND_IDENTITY_CHANGED',
            'Payment identity changed before dispatch',
          );
        this.db
          .prepare(
            `UPDATE automation_spend_calls SET state = 'started', claim_id = ?, runtime_epoch = ?, started_at = ? WHERE id = ? AND state = 'pending'`,
          )
          .run(randomUUID(), runtimeEpoch, now, callId);
        this.db
          .prepare(
            `UPDATE automation_spend_requests SET state = 'running', revision = revision + 1 WHERE id = ?`,
          )
          .run(request.id);
        return automationSpendCallSchema.parse(
          this.calls(request.id).find((item) => item.id === callId),
        );
      })
      .immediate();
  }

  completeCall(
    callId: string,
    claimId: string,
    evidence: AutomationCostEvidence,
    now: number,
  ): boolean {
    const cost = automationCostEvidenceSchema.parse(evidence);
    return this.db
      .transaction(() => {
        const call = callRow(
          this.db.prepare('SELECT * FROM automation_spend_calls WHERE id = ?').get(callId),
        );
        if (!call) throw new AutomationSpendError('SPEND_CALL_NOT_FOUND', 'Call does not exist');
        this.required(call.requestId);
        assertManagedSpendWrite(this.db, call.requestId);
        if (call.claimId !== claimId)
          throw new AutomationSpendError(
            'SPEND_CLAIM_MISMATCH',
            'Only the dispatch claimant may record this result',
          );
        if (call.state === 'completed' || call.state === 'unknown') {
          if (
            automationInputHash({
              reportedPoints: call.reportedPoints,
              source: call.costSource,
              evidenceRef: call.evidenceRef,
            }) !== automationInputHash(cost)
          )
            throw new AutomationSpendError(
              call.state === 'unknown' ? 'SPEND_RECONCILIATION_REQUIRED' : 'SPEND_RESULT_CONFLICT',
              'Call already has different cost evidence',
            );
          return false;
        }
        if (call.state !== 'started')
          throw new AutomationSpendError(
            'SPEND_RECONCILIATION_REQUIRED',
            'An interrupted or uncertain call needs explicit reconciliation',
          );
        const unknown = cost.reportedPoints === null;
        this.db
          .prepare(
            `UPDATE automation_spend_calls SET state = ?, reported_points = ?, policy_points = ?, cost_source = ?, evidence_ref = ?, finished_at = ? WHERE id = ?`,
          )
          .run(
            unknown ? 'unknown' : 'completed',
            cost.reportedPoints,
            call.binding.policy === 'managed' ? cost.reportedPoints : null,
            cost.source,
            cost.evidenceRef,
            now,
            callId,
          );
        if (unknown && call.binding.policy === 'managed')
          this.db
            .prepare(
              `UPDATE automation_spend_requests SET reservation_state = 'unknown', revision = revision + 1 WHERE id = ?`,
            )
            .run(call.requestId);
        return true;
      })
      .immediate();
  }

  finishRequest(
    requestId: string,
    outcome: 'success' | 'failed' | 'cancelled',
    now: number,
  ): AutomationSpendRequest {
    return this.db
      .transaction(() => {
        const request = this.required(requestId);
        assertManagedSpendWrite(this.db, requestId);
        if (request.state === 'terminal') return request;
        if (request.state === 'pending_confirmation')
          throw new AutomationSpendError(
            'SPEND_NOT_AUTHORIZED',
            'Pending confirmation cannot finish an execution',
          );
        this.db
          .prepare(
            `UPDATE automation_spend_calls SET state = 'not_sent', finished_at = ? WHERE request_id = ? AND state = 'pending'`,
          )
          .run(now, requestId);
        this.db
          .prepare(
            `UPDATE automation_spend_calls SET state = 'unknown', finished_at = ? WHERE request_id = ? AND state = 'started'`,
          )
          .run(now, requestId);
        const calls = this.calls(requestId);
        const unknownManaged = calls.some(
          (call) => call.binding.policy === 'managed' && call.state === 'unknown',
        );
        this.db
          .prepare(
            `UPDATE automation_spend_requests SET state = 'terminal', outcome = ?, finished_at = ?, reservation_state = ?, revision = revision + 1 WHERE id = ?`,
          )
          .run(outcome, now, unknownManaged ? 'unknown' : 'released', requestId);
        const terminal = this.required(requestId);
        this.writeAudit(terminal, 'terminal');
        return terminal;
      })
      .immediate();
  }

  /** Called only after the host acquired exclusive data-directory ownership, never on DB read. */
  recover(runtimeEpoch: string, now: number): number {
    return this.db
      .transaction(() => {
        const requests = this.db
          .prepare(
            `SELECT * FROM automation_spend_requests WHERE scope_id = ? AND state <> 'terminal'`,
          )
          .all(this.scopeId)
          .map((row) => automationSpendRequestSchema.parse(requestRow(row)));
        let recovered = 0;
        for (const request of requests) {
          // Remote receipts, not a new local runtime, decide these requests and their reservations.
          if (
            isManagedSpend(this.db, request.id) ||
            needsManagedSpendCoordinator(this.db, request.id)
          )
            continue;
          if (request.state === 'pending_confirmation') {
            if (request.confirmationExpiresAt !== null && now >= request.confirmationExpiresAt) {
              if (!request.confirmationId)
                throw new AutomationSpendError(
                  'SPEND_REQUEST_CORRUPT',
                  'Pending request has no confirmation identity',
                );
              this.resolveConfirmation(request.confirmationId, false, now);
              recovered += 1;
            }
            continue;
          }
          const calls = this.calls(request.id);
          if (calls.some((call) => call.state === 'started' && call.runtimeEpoch === runtimeEpoch))
            continue;
          this.finishRequest(
            request.id,
            calls.some((call) => ['started', 'completed', 'unknown'].includes(call.state))
              ? 'failed'
              : 'cancelled',
            now,
          );
          recovered += 1;
        }
        return recovered;
      })
      .immediate();
  }

  private writeAudit(request: AutomationSpendRequest, eventKey: string): void {
    const calls = this.calls(request.id).filter((call) => call.state !== 'not_sent');
    const points =
      calls.length > 0 && calls.every((call) => call.reportedPoints !== null)
        ? calls.reduce((sum, call) => sum + (call.reportedPoints ?? 0), 0)
        : null;
    const approval =
      request.outcome === 'denied' || request.outcome === 'timeout'
        ? request.outcome
        : request.approvalSource === 'external'
          ? 'budget'
          : (request.approvalSource ?? 'denied');
    this.db
      .prepare(`INSERT OR IGNORE INTO automation_audit (at, caller, action, prompt_text, params_json, estimated_points, actual_points, approved_via, status, job_id, automation_request_id, event_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        request.finishedAt ?? request.createdAt,
        request.caller,
        request.action,
        request.promptText,
        JSON.stringify({
          requestId: request.id,
          errorCode: request.errorCode,
          reservationState: request.reservationState,
          costs: calls.map((call) => ({
            callId: call.id,
            source: call.costSource,
            evidenceRef: call.evidenceRef,
          })),
        }),
        request.estimatedPoints,
        points,
        approval,
        request.outcome ?? 'failed',
        request.executionId,
        request.id,
        eventKey,
      );
  }
}
