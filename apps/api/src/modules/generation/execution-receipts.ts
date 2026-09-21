import { randomUUID } from 'node:crypto';
import {
  type ExecutionBinding,
  type GenerationReceiptOperation,
  generationExecutionReceiptSchema,
} from '@musefold/contracts';
import {
  type MusefoldTransaction,
  ExecutionAuthorityError,
  executionBindingsEqual,
  generationExecutionReceipts,
  generationRequestDigest,
  lockGenerationExecutionAuthority,
} from '@musefold/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import type { DbLike } from '../sync/change-log.js';

export type ExecutionReceiptRow = typeof generationExecutionReceipts.$inferSelect;
export type ExecutionAuthority = Awaited<ReturnType<typeof lockGenerationExecutionAuthority>>;
export type ReceiptIntent = {
  operation: GenerationReceiptOperation;
  sourceRunId: string | null;
  logicalInputDigest: string;
  expectedBinding?: ExecutionBinding;
};

/** One durable key namespace covers every paid entry point and survives result deletion. */
export class GenerationReceiptService {
  constructor(private readonly issuers: { apiIssuer: string; upstreamIssuer: string }) {}

  async lockKey(tx: MusefoldTransaction, principalId: string, key: string) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([principalId, key])}, 0))`,
    );
  }

  async find(tx: DbLike, principalId: string, key: string) {
    const [row] = await tx
      .select()
      .from(generationExecutionReceipts)
      .where(
        and(
          eq(generationExecutionReceipts.principalId, principalId),
          eq(generationExecutionReceipts.idempotencyKey, key),
        ),
      );
    return row ?? null;
  }

  assertIntent(row: ExecutionReceiptRow, intent: ReceiptIntent) {
    if (
      row.operation !== intent.operation ||
      row.sourceRunId !== intent.sourceRunId ||
      (row.logicalInputDigest !== null && row.logicalInputDigest !== intent.logicalInputDigest)
    )
      throw new AppError(
        'GENERATION_IDEMPOTENCY_CONFLICT',
        'Idempotency-Key 已用于不同的生成请求',
        409,
        false,
        { receiptId: row.id },
      );
    if (
      intent.expectedBinding &&
      (!row.binding || !executionBindingsEqual(row.binding, intent.expectedBinding))
    )
      throw bindingChanged(row.id);
  }

  requireResult(row: ExecutionReceiptRow) {
    if (row.purgedAt) throw cleanedResult(row.id, row.bindingState);
  }

  async authorize(
    tx: MusefoldTransaction,
    principalId: string,
    authorizingSessionId: string,
    expectedBinding?: ExecutionBinding,
    authorizedModel?: ExecutionBinding['model'],
  ): Promise<ExecutionAuthority> {
    try {
      return await lockGenerationExecutionAuthority(tx, {
        principalId,
        ...this.issuers,
        authSessionId: authorizingSessionId,
        expectedBinding,
        authorizedModel,
      });
    } catch (error) {
      if (!(error instanceof ExecutionAuthorityError)) throw error;
      if (error.reason === 'binding_changed') throw bindingChanged();
      if (error.reason === 'session_invalid' || error.reason === 'authorization_changed')
        throw new AppError('AUTH_SESSION_EXPIRED', '授权会话已失效，请重新登录', 401);
      throw new AppError(
        'ACCOUNT_IDENTITY_UNVERIFIED',
        '账号或生图凭据尚未验证，无法提交生成',
        403,
        false,
        { reason: error.reason },
      );
    }
  }

  async insert(
    tx: MusefoldTransaction,
    principalId: string,
    key: string,
    intent: ReceiptIntent,
    input: {
      originalRunId: string;
      request: unknown;
      authorizingSessionId: string;
      authority: ExecutionAuthority;
    },
  ) {
    const id = randomUUID();
    const [row] = await tx
      .insert(generationExecutionReceipts)
      .values({
        id,
        principalId,
        idempotencyKey: key,
        operation: intent.operation,
        originalRunId: input.originalRunId,
        sourceRunId: intent.sourceRunId,
        binding: input.authority.binding,
        bindingState: 'bound',
        logicalInputDigest: intent.logicalInputDigest,
        finalRequestDigest: generationRequestDigest(input.request),
        authorizingSessionId: input.authorizingSessionId,
        authRevision: input.authority.authRevision,
        status: 'queued',
        dispatch: 'not_started',
        costProvenance: 'not_sent',
        costPoints: null,
      })
      .returning();
    if (!row) throw new Error('Execution receipt insertion returned no row');
    return row;
  }

  toPublic(row: ExecutionReceiptRow) {
    return generationExecutionReceiptSchema.parse({
      id: row.id,
      principalId: row.principalId,
      idempotencyKey: row.idempotencyKey,
      operation: row.operation,
      originalRunId: row.originalRunId,
      sourceRunId: row.sourceRunId,
      bindingState: row.bindingState,
      binding: row.binding,
      status: row.status,
      dispatch: row.dispatch,
      costProvenance: row.costProvenance,
      costPoints: row.costPoints,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      terminalAt: row.terminalAt?.toISOString() ?? null,
      purgedAt: row.purgedAt?.toISOString() ?? null,
    });
  }
}

export function cleanedResult(
  receiptId: string,
  bindingState?: ExecutionReceiptRow['bindingState'],
) {
  return new AppError(
    'GENERATION_RESULT_CLEANED',
    '本次生成结果已清理；执行记录保留，重复提交不会再次扣费',
    410,
    false,
    { receiptId, ...(bindingState === 'legacy_unbound' ? { bindingState } : {}) },
  );
}

function bindingChanged(receiptId?: string) {
  return new AppError(
    'GENERATION_BINDING_CHANGED',
    '本次执行的账号或凭据绑定已变化，请重新确认后提交新的执行',
    409,
    false,
    receiptId ? { receiptId } : {},
  );
}
