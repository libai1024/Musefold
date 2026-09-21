import { createHash, randomUUID } from 'node:crypto';
import {
  type DesignSchemeRunInput,
  type ParsedPrepareDesignSchemeRunInput,
  type PrepareDesignSchemeRunInput,
  type RunResult,
  cancelDesignSchemeInputSchema,
  cancelDesignSchemeResultSchema,
  cloudGenerationRequestSchema,
  designSchemeRevisionDocumentSchema,
  designSchemeRunEventPageSchema,
  designSchemeRunInputSchema,
  generationCountSchema,
  prepareDesignSchemeRunInputSchema,
  runRecordSchema,
  runResultSchema,
  schemeStatusSchema,
} from '@musefold/contracts';
import { cloudGenerationProviderSnapshot } from '@musefold/domain/cloud-generation-policy';
import {
  assertCloudFixedRunPlan,
  prepareCloudFixedRunPlan,
} from '@musefold/domain/design-scheme/fixed-run-plan';
import { compileSchemePrompt } from '@musefold/domain/design-scheme/prompt-compiler';
import { composeGenerationPrompt } from '@musefold/domain/generation-prompt';
import {
  type MusefoldDatabase,
  executionDigest,
  designSchemeGenerationReferences,
  designSchemeRevisions,
  designSchemeRunExecutions,
  designSchemeRuns,
  designSchemeRunSteps,
  designSchemeSourceBindings,
  designSchemes,
  generationEvents,
  generationRuns,
} from '@musefold/db';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import type { DesignSchemeAssetService } from '../design-scheme-assets/service.js';
import type { GenerationService } from '../generation/service.js';
import { cleanedResult } from '../generation/execution-receipts.js';

type Tx = Parameters<Parameters<MusefoldDatabase['transaction']>[0]>[0];
const PREPARATION_TTL_MS = 24 * 60 * 60_000;

/** Host-owned preparation and durable execution identity. Only explicit authenticated calls enqueue. */
export class DesignSchemeRunService {
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly assets: DesignSchemeAssetService,
    private readonly generation: GenerationService,
  ) {}

  async prepare(userId: string, raw: PrepareDesignSchemeRunInput, authorizingSessionId: string) {
    const input = prepareDesignSchemeRunInputSchema.parse(raw);
    requireSupportedCount(input.executionSettings.outputCount);
    const hash = fingerprint(input);
    const preflight = await this.preflightAuthority(userId, input, true);
    return this.db.transaction(async (tx) => {
      await this.generation.receipts.lockKey(tx, userId, `scheme:${input.executionId}`);
      const accepted = await this.generation.receipts.find(
        tx,
        userId,
        `scheme:${input.executionId}`,
      );
      // Acquire authority before the mutable execution row, matching the worker
      // user-first ordering. Accepted replays do not acquire today's credential.
      const executionAuthority = accepted
        ? undefined
        : await this.generation.authorizeImageExecution(
            tx,
            userId,
            authorizingSessionId,
            input.executionSettings.expectedBinding,
            input.executionSettings.model,
          );
      await this.ensureIdentity(tx, userId, input.executionId);
      const execution = await this.lockIdentity(tx, userId, input.executionId);
      if (execution.cancelledAt) throw cancelled();
      if (execution.requestHash && execution.requestHash !== hash) throw conflict();
      if (execution.preparedInput) {
        if (!execution.runId && execution.expiresAt.getTime() <= Date.now()) throw expired();
        const prior = designSchemeRunInputSchema.parse(execution.preparedInput);
        if (prior.executionBinding || accepted) return prior;
        // Historical unbound preparations may be regenerated, but cannot run
        // until this explicit prepare has persisted a verified binding.
      }
      if (!executionAuthority) throw expired();
      const authority = await this.authority(tx, userId, input, preflight);
      // Prompt expectedVersion must already be meaningful at prepare; run checks it again.
      await this.generation.resolveSchemePromptReferences(
        tx,
        userId,
        input.executionSettings.promptReferenceSelections,
      );
      const prepared = {
        ...domainCall(() =>
          prepareCloudFixedRunPlan(input, authority, {
            planId: randomUUID(),
            stepIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
            now: new Date().toISOString(),
          }),
        ),
        executionBinding: executionAuthority.binding,
      };
      await tx
        .update(designSchemeRunExecutions)
        .set({ requestHash: hash, preparedInput: prepared as unknown as Record<string, unknown> })
        .where(
          and(
            eq(designSchemeRunExecutions.userId, userId),
            eq(designSchemeRunExecutions.executionId, input.executionId),
          ),
        );
      return prepared;
    });
  }

  async run(
    userId: string,
    raw: DesignSchemeRunInput,
    authorizingSessionId: string,
  ): Promise<RunResult> {
    const input = designSchemeRunInputSchema.parse(raw);
    requireSupportedCount(input.executionSettings.outputCount);
    const { executionBinding: expectedBinding, ...logicalInput } = input;
    const logicalInputDigest = executionDigest(logicalInput);
    const choices = prepareDesignSchemeRunInputSchema.parse({
      executionId: input.executionId,
      schemeId: input.schemeId,
      revisionId: input.revisionId,
      mode: input.mode,
      priorityMode: input.priorityMode,
      brief: input.brief,
      inputValues: input.inputValues,
      executionSettings: input.executionSettings,
    });
    const preflight = expectedBinding ? await this.preflightAuthority(userId, choices) : undefined;
    return this.db.transaction(async (tx) => {
      await this.generation.receipts.lockKey(tx, userId, `scheme:${input.executionId}`);
      const receipt = await this.generation.receipts.find(
        tx,
        userId,
        `scheme:${input.executionId}`,
      );
      if (receipt) {
        this.generation.receipts.assertIntent(receipt, {
          operation: 'scheme_run',
          sourceRunId: null,
          logicalInputDigest,
          expectedBinding,
        });
        this.generation.receipts.requireResult(receipt);
        if (receipt.logicalInputDigest === null) {
          const legacy = await this.lockIdentity(tx, userId, input.executionId);
          if (!legacy.preparedInput || fingerprint(legacy.preparedInput) !== fingerprint(input))
            throw conflict();
        }
        return this.readAcceptedResult(tx, userId, receipt.originalRunId, receipt.id);
      }
      if (!expectedBinding) throw expired();
      const executionAuthority = await this.generation.authorizeImageExecution(
        tx,
        userId,
        authorizingSessionId,
        expectedBinding,
        input.executionSettings.model,
      );
      const execution = await this.lockIdentity(tx, userId, input.executionId);
      if (!execution.preparedInput) {
        if (execution.cancelledAt) throw cancelled();
        throw expired();
      }
      if (
        fingerprint(designSchemeRunInputSchema.parse(execution.preparedInput)) !==
        fingerprint(input)
      )
        throw conflict();
      // Replays return persisted progress even if the revision/provider later changed.
      if (execution.runId) return this.readResult(tx, userId, execution.runId);
      if (execution.cancelledAt) throw cancelled();
      if (execution.expiresAt.getTime() <= Date.now()) throw expired();
      domainCall(() => assertCloudFixedRunPlan(input));
      const authority = await this.authority(tx, userId, choices, preflight);
      const policy = input.plan.policy ?? input.plan.prioritySnapshot;
      if (!policy) throw conflict();
      const rebuilt = domainCall(() =>
        prepareCloudFixedRunPlan(choices, authority, {
          planId: input.plan.id ?? input.plan.runId ?? '',
          stepIds: input.plan.steps.map((step) => step.id) as [string, string, string, string],
          now:
            typeof policy.appliedAt === 'number'
              ? new Date(policy.appliedAt).toISOString()
              : policy.appliedAt,
        }),
      );
      if (
        fingerprint({ ...rebuilt, executionBinding: executionAuthority.binding }) !==
        fingerprint(input)
      )
        throw conflict();
      const promptReferences = await this.generation.resolveSchemePromptReferences(
        tx,
        userId,
        input.executionSettings.promptReferenceSelections,
      );
      const compiled = compileSchemePrompt({
        document: authority.document,
        inputValues: input.inputValues,
        brief: input.brief,
        imageCount: input.executionSettings.referenceAssetIds.length,
        ratioId: input.executionSettings.aspectRatio ?? 'auto',
        priorityMode: input.priorityMode,
      });
      if (compiled.unresolvedVariables.length)
        throw capability('input-template', '方案提示词包含尚未提供的变量');
      const composition = composeGenerationPrompt({
        userPrompt: compiled.prompt,
        promptReferences,
        imageCount: input.executionSettings.referenceAssetIds.length,
        ratioId: input.executionSettings.aspectRatio,
      });
      if (!composition.ok) throw new AppError('VALIDATION_FAILED', composition.error.message);
      const compiledPrompt = composition.data.finalPrompt;
      const references = authority.references;
      const request = cloudGenerationRequestSchema.parse({
        prompt: compiledPrompt,
        negative: input.executionSettings.negativePrompt,
        size: input.executionSettings.size,
        aspectRatio: input.executionSettings.aspectRatio,
        quality: input.executionSettings.quality,
        count: input.executionSettings.outputCount,
        providerId: cloudGenerationProviderSnapshot.providerId,
        model: input.executionSettings.model,
        referenceImages: references.map((reference) => ({
          id: reference.assetId,
          url: `/api/v1/design-schemes/assets/${reference.assetId}/content`,
          name: reference.name,
          mimeType: reference.mimeType,
          byteSize: reference.byteSize,
        })),
      });
      const now = new Date();
      const runId = randomUUID();
      const generationRunId = randomUUID();
      const result = runResultSchema.parse({
        runId,
        schemeId: input.schemeId,
        revisionId: input.revisionId,
        mode: input.mode,
        status: 'planning',
        compiledPrompt,
        outputs: [],
        steps: input.plan.steps.map((step, index) => ({
          ...step,
          ...(index < 2
            ? { status: 'completed', startedAt: now.toISOString(), completedAt: now.toISOString() }
            : {}),
        })),
        evaluation: null,
        repair: null,
        error: null,
        createdAt: now.toISOString(),
        completedAt: null,
      });
      await tx.insert(designSchemeRuns).values({
        runId,
        userId,
        schemeId: input.schemeId,
        revisionId: input.revisionId,
        mode: input.mode,
        status: 'planning',
        policy,
        provider: input.plan.provider,
        plan: input.plan as unknown as Record<string, unknown>,
        result: result as unknown as Record<string, unknown>,
        createdAt: now,
      });
      await tx.insert(designSchemeRunSteps).values(
        result.steps.map((step) => ({
          runId,
          stepId: step.id,
          userId,
          status: step.status,
          input: { kind: step.kind },
          startedAt: step.startedAt ? new Date(step.startedAt) : null,
          completedAt: step.completedAt ? new Date(step.completedAt) : null,
        })),
      );
      await tx
        .update(designSchemeRunExecutions)
        .set({ runId })
        .where(
          and(
            eq(designSchemeRunExecutions.userId, userId),
            eq(designSchemeRunExecutions.executionId, input.executionId),
          ),
        );
      await this.generation.enqueueSchemeRun(tx, userId, {
        generationRunId,
        designSchemeRunId: runId,
        executionId: input.executionId,
        request,
        userPrompt: input.brief,
        promptReferences,
        sessionId: input.executionSettings.workbenchSessionId,
        authorizingSessionId,
        authority: executionAuthority,
        logicalInputDigest,
      });
      if (references.length)
        await tx
          .insert(designSchemeGenerationReferences)
          .values(references.map((reference) => ({ ...reference, generationRunId, userId })));
      const record = runRecordSchema.parse({
        runId,
        schemeId: input.schemeId,
        revisionId: input.revisionId,
        schemeStatus: input.schemeStatus,
        schemeFidelity: input.schemeFidelity,
        mode: input.mode,
        status: 'planning',
        policy,
        provider: input.plan.provider,
        createdAt: now.toISOString(),
        completedAt: null,
        repair: null,
      });
      await tx.insert(generationEvents).values([
        {
          userId,
          runId: generationRunId,
          eventType: 'design-scheme',
          payload: { kind: 'run-created', executionId: input.executionId, run: record },
        },
        {
          userId,
          runId: generationRunId,
          eventType: 'design-scheme',
          payload: {
            kind: 'run-planned',
            executionId: input.executionId,
            runId,
            plan: input.plan,
          },
        },
        ...result.steps.slice(0, 2).map((step) => ({
          userId,
          runId: generationRunId,
          eventType: 'design-scheme',
          payload: {
            kind: 'step-completed',
            executionId: input.executionId,
            runId,
            stepId: step.id,
            outputIds: [],
          },
        })),
      ]);
      return result;
    });
  }

  async cancel(userId: string, raw: unknown) {
    const input = cancelDesignSchemeInputSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      await this.ensureIdentity(tx, userId, input.executionId);
      const execution = await this.lockIdentity(tx, userId, input.executionId);
      if (input.runId && input.runId !== execution.runId) throw notFound();
      if (execution.runId) {
        const [generation] = await tx
          .select({ id: generationRuns.id })
          .from(generationRuns)
          .where(
            and(
              eq(generationRuns.designSchemeRunId, execution.runId),
              eq(generationRuns.userId, userId),
              isNull(generationRuns.purgeStartedAt),
            ),
          );
        if (!generation)
          return cancelDesignSchemeResultSchema.parse({
            executionId: input.executionId,
            status: 'already-terminal',
          });
        try {
          await this.generation.cancelInTransaction(tx, userId, generation.id);
        } catch (error) {
          if (error instanceof AppError && error.code === 'GENERATION_ALREADY_TERMINAL')
            return cancelDesignSchemeResultSchema.parse({
              executionId: input.executionId,
              status: 'already-terminal',
            });
          throw error;
        }
      }
      await tx
        .update(designSchemeRunExecutions)
        .set({ cancelledAt: execution.cancelledAt ?? new Date() })
        .where(
          and(
            eq(designSchemeRunExecutions.userId, userId),
            eq(designSchemeRunExecutions.executionId, input.executionId),
          ),
        );
      return cancelDesignSchemeResultSchema.parse({
        executionId: input.executionId,
        status: 'cancelled',
      });
    });
  }

  get(userId: string, runId: string) {
    return this.readResult(this.db, userId, runId);
  }

  async events(userId: string, runId: string, afterSeq = 0) {
    await this.get(userId, runId);
    const rows = await this.db
      .select({ seq: generationEvents.seq, event: generationEvents.payload })
      .from(generationEvents)
      .innerJoin(
        generationRuns,
        and(eq(generationRuns.id, generationEvents.runId), eq(generationRuns.userId, userId)),
      )
      .where(
        and(
          eq(generationRuns.designSchemeRunId, runId),
          eq(generationEvents.userId, userId),
          eq(generationEvents.eventType, 'design-scheme'),
          gt(generationEvents.seq, afterSeq),
        ),
      )
      .orderBy(asc(generationEvents.seq))
      .limit(100);
    return designSchemeRunEventPageSchema.parse({
      events: rows,
      nextSeq: rows.at(-1)?.seq ?? afterSeq,
    });
  }

  private async preflightAuthority(
    userId: string,
    input: ParsedPrepareDesignSchemeRunInput,
    preparing = false,
  ) {
    const key = `scheme:${input.executionId}`;
    if (await this.generation.receipts.find(this.db, userId, key)) return undefined;
    if (preparing) {
      const [existing] = await this.db
        .select()
        .from(designSchemeRunExecutions)
        .where(
          and(
            eq(designSchemeRunExecutions.userId, userId),
            eq(designSchemeRunExecutions.executionId, input.executionId),
          ),
        );
      if (
        existing?.preparedInput &&
        designSchemeRunInputSchema.parse(existing.preparedInput).executionBinding
      )
        return undefined;
    }
    try {
      const metadata = await this.authorityMetadata(this.db, userId, input, false);
      const references = await this.assets.preflightRunReferences(
        userId,
        metadata.document,
        input.executionSettings.referenceAssetIds,
      );
      return { metadataDigest: fingerprint(metadata), references };
    } catch (error) {
      // A concurrent acceptance wins even if this redundant object read failed.
      if (await this.generation.receipts.find(this.db, userId, key)) return undefined;
      throw error;
    }
  }

  private async authority(
    tx: Tx,
    userId: string,
    input: ParsedPrepareDesignSchemeRunInput,
    preflight: Awaited<ReturnType<DesignSchemeRunService['preflightAuthority']>>,
  ) {
    if (!preflight) throw conflict();
    const metadata = await this.authorityMetadata(tx, userId, input, true);
    if (fingerprint(metadata) !== preflight.metadataDigest) throw conflict();
    const references = await this.assets.resolveRunReferences(
      tx,
      userId,
      metadata.document,
      input.executionSettings.referenceAssetIds,
      preflight.references,
    );
    return {
      ...metadata,
      referenceAssetIds: references.map((reference) => reference.assetId),
      references,
    };
  }

  private async authorityMetadata(
    tx: Tx | MusefoldDatabase,
    userId: string,
    input: ParsedPrepareDesignSchemeRunInput,
    lock: boolean,
  ) {
    const query = tx
      .select({ scheme: designSchemes, revision: designSchemeRevisions })
      .from(designSchemes)
      .innerJoin(
        designSchemeRevisions,
        and(
          eq(designSchemeRevisions.schemeId, designSchemes.id),
          eq(designSchemeRevisions.revisionId, input.revisionId),
          eq(designSchemeRevisions.userId, userId),
        ),
      )
      .where(
        and(
          eq(designSchemes.id, input.schemeId),
          eq(designSchemes.userId, userId),
          isNull(designSchemes.deletedAt),
        ),
      );
    const [row] = lock ? await query.for('share') : await query;
    if (!row) throw notFound();
    const document = designSchemeRevisionDocumentSchema.parse(row.revision.document);
    const bindingQuery = tx
      .select({ id: designSchemeSourceBindings.sourceSnapshotId })
      .from(designSchemeSourceBindings)
      .where(
        and(
          eq(designSchemeSourceBindings.revisionId, input.revisionId),
          eq(designSchemeSourceBindings.userId, userId),
        ),
      )
      .orderBy(asc(designSchemeSourceBindings.sourceSnapshotId));
    const bindings = lock ? await bindingQuery.for('share') : await bindingQuery;
    return {
      summary: {
        id: row.scheme.id,
        status: schemeStatusSchema.parse(row.scheme.status),
        currentRevisionId: row.scheme.currentRevisionId,
        workingDraftRevisionId: row.scheme.workingDraftRevisionId,
      },
      document,
      sourceSnapshotIds: bindings.map((binding) => binding.id),
      provider: {
        ...cloudGenerationProviderSnapshot,
        model: input.executionSettings.model ?? cloudGenerationProviderSnapshot.model,
      },
    };
  }

  private async readResult(
    tx: Tx | MusefoldDatabase,
    userId: string,
    runId: string,
  ): Promise<RunResult> {
    const [run] = await tx
      .select({ result: designSchemeRuns.result })
      .from(designSchemeRuns)
      .leftJoin(
        designSchemes,
        and(eq(designSchemes.id, designSchemeRuns.schemeId), eq(designSchemes.userId, userId)),
      )
      .where(
        and(
          eq(designSchemeRuns.runId, runId),
          eq(designSchemeRuns.userId, userId),
          isNull(designSchemeRuns.deletedAt),
          sql`((${designSchemeRuns.schemeId} IS NOT NULL AND ${designSchemes.id} IS NOT NULL
            AND ${designSchemes.deletedAt} IS NULL) OR (${designSchemeRuns.schemeId} IS NULL AND EXISTS (
              SELECT 1 FROM design_scheme_purge_identities p
              WHERE p.scheme_id = ${designSchemeRuns.originSchemeId} AND p.user_id = ${userId}
            )))`,
        ),
      );
    if (!run) throw notFound();
    return runResultSchema.parse(run.result);
  }

  private async readAcceptedResult(
    tx: Tx,
    userId: string,
    generationRunId: string,
    receiptId: string,
  ) {
    const [row] = await tx
      .select({ result: designSchemeRuns.result })
      .from(generationRuns)
      .innerJoin(
        designSchemeRuns,
        and(
          eq(designSchemeRuns.runId, generationRuns.designSchemeRunId),
          eq(designSchemeRuns.userId, userId),
        ),
      )
      .where(
        and(
          eq(generationRuns.id, generationRunId),
          eq(generationRuns.userId, userId),
          isNull(generationRuns.purgeStartedAt),
        ),
      );
    if (!row) throw cleanedResult(receiptId);
    return runResultSchema.parse(row.result);
  }

  private async ensureIdentity(tx: Tx, userId: string, executionId: string) {
    await tx
      .insert(designSchemeRunExecutions)
      .values({ userId, executionId, expiresAt: new Date(Date.now() + PREPARATION_TTL_MS) })
      .onConflictDoNothing();
  }
  private async lockIdentity(tx: Tx, userId: string, executionId: string) {
    const [row] = await tx
      .select()
      .from(designSchemeRunExecutions)
      .where(
        and(
          eq(designSchemeRunExecutions.userId, userId),
          eq(designSchemeRunExecutions.executionId, executionId),
        ),
      )
      .for('update');
    if (!row) throw expired();
    return row;
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
function fingerprint(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
function requireSupportedCount(count: number) {
  if (!generationCountSchema.safeParse(count).success)
    throw capability('output-count', '当前云方案运行支持 1、2 或 4 张输出');
}
function domainCall<T>(call: () => T): T {
  try {
    return call();
  } catch (error) {
    throw capability('fixed-run-plan', error instanceof Error ? error.message : '运行计划不受支持');
  }
}
function capability(capabilityName: string, message: string) {
  return new AppError('VALIDATION_FAILED', message, 400, false, {
    designSchemeCode: 'DESIGN_SCHEME_CAPABILITY_UNAVAILABLE',
    designSchemeError: {
      code: 'DESIGN_SCHEME_CAPABILITY_UNAVAILABLE',
      message,
      retryable: false,
      recoveryAction: 'edit-input',
    },
    capability: capabilityName,
  });
}
function notFound() {
  return new AppError('VALIDATION_FAILED', '方案运行不存在或无权访问', 404);
}
function conflict() {
  return new AppError(
    'VALIDATION_FAILED',
    '执行标识已绑定其他输入，或运行计划已变化，请重新准备',
    409,
    false,
    { designSchemeCode: 'DESIGN_SCHEME_EXECUTION_CONFLICT' },
  );
}
function cancelled() {
  return new AppError('VALIDATION_FAILED', '本次执行已取消，请使用新的执行标识', 409, false, {
    designSchemeCode: 'DESIGN_SCHEME_EXECUTION_CANCELLED',
  });
}
function expired() {
  return new AppError('VALIDATION_FAILED', '运行计划不存在或已过期，请重新准备', 409, false, {
    designSchemeCode: 'DESIGN_SCHEME_PREPARATION_EXPIRED',
  });
}
