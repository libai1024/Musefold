import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  MAX_REFERENCE_IMAGE_BYTES,
  designSchemeRunEventSchema,
  designSchemeRunInputSchema,
  designSchemeRunPlanSchema,
  runEvaluationSchema,
  runOutputMetadataSchema,
  runResultSchema,
  type DesignSchemeRunEvent,
  type ParsedCloudGenerationRequest,
  type ParsedDesignSchemeRunInput,
  type RunEvaluation,
  type RunResult,
  type StructuredDesignSchemeError,
} from '@musefold/contracts';
import {
  designSchemeAssets,
  designSchemeEvaluations,
  designSchemeGenerationReferences,
  designSchemeRunExecutions,
  designSchemeRunSteps,
  designSchemeRuns,
  generationEvents,
  type MusefoldDatabase,
  type generationRuns,
} from '@musefold/db';
import { assertCloudFixedRunPlan } from '@musefold/domain/design-scheme/fixed-run-plan';
import { advanceCloudRunResult } from '@musefold/domain/design-scheme/run-result';
import { and, asc, eq } from 'drizzle-orm';
import { imageChecksum, UpstreamImageError, type ReferenceImageInput } from './image-gateway.js';
import type { GenerationPayload, UploadedGenerationAsset } from './generation-types.js';

type Transaction = Parameters<Parameters<MusefoldDatabase['transaction']>[0]>[0];
type SchemeGeneration = Pick<
  typeof generationRuns.$inferSelect,
  'id' | 'userId' | 'designSchemeRunId'
>;
type PreparedExecution = {
  input: ParsedDesignSchemeRunInput;
  compiledPrompt: RunResult['compiledPrompt'];
};

async function emit(
  tx: Transaction,
  generation: SchemeGeneration,
  event: DesignSchemeRunEvent,
): Promise<void> {
  await tx.insert(generationEvents).values({
    userId: generation.userId,
    runId: generation.id,
    eventType: 'design-scheme',
    payload: designSchemeRunEventSchema.parse(event),
  });
}

function evaluate(
  runId: string,
  input: ParsedDesignSchemeRunInput,
  assets: UploadedGenerationAsset[],
  now: string,
): RunEvaluation {
  const ids = assets.map((asset) => asset.id);
  const ratio = input.plan.evaluation.ratio;
  const [width, height] = ratio?.split(':').map(Number) ?? [];
  const target = width && height ? width / height : null;
  const invalid = assets.filter((asset) => asset.bytes.length === 0);
  const offRatio = target
    ? assets.filter((asset) => Math.abs(asset.width / asset.height - target) / target > 0.05)
    : [];
  const checks: RunEvaluation['checks'] = [
    {
      id: 'output-count',
      label: '输出数量',
      status: assets.length === input.executionSettings.outputCount ? 'pass' : 'warn',
      detail: `${assets.length}/${input.executionSettings.outputCount} 张`,
      evidenceOutputIds: ids,
    },
    {
      id: 'file-valid',
      label: '文件有效',
      status: invalid.length ? 'fail' : 'pass',
      detail: invalid.length ? '输出文件为空' : `${assets.length} 个文件已保存`,
      evidenceOutputIds: invalid.length ? invalid.map((asset) => asset.id) : ids,
    },
    {
      id: 'aspect-ratio',
      label: '输出比例',
      status: offRatio.length ? 'warn' : 'pass',
      detail: !target
        ? '未约束比例（自动）'
        : offRatio.length
          ? `${offRatio.length} 张与请求比例 ${ratio} 不一致`
          : `${assets.length} 张符合 ${ratio}`,
      evidenceOutputIds: offRatio.length ? offRatio.map((asset) => asset.id) : ids,
    },
  ];
  return runEvaluationSchema.parse({
    evaluationId: createHash('sha256').update(`cloud-evaluation:${runId}`).digest('hex'),
    runId,
    passed: checks.every((check) => check.status === 'pass'),
    checks,
    repairHint: null,
    repair: null,
    createdAt: now,
  });
}

/** Caller holds the generation row lock and has already won its status/epoch/lease guard. */
export async function synchronizeDesignSchemeRun(
  tx: Transaction,
  generation: SchemeGeneration,
  status: 'executing' | 'completed' | 'failed' | 'cancelled',
  options: { now: Date; uploaded?: UploadedGenerationAsset[]; error?: StructuredDesignSchemeError },
): Promise<PreparedExecution | null> {
  if (!generation.designSchemeRunId) return null;
  const [row] = await tx
    .select()
    .from(designSchemeRuns)
    .where(
      and(
        eq(designSchemeRuns.runId, generation.designSchemeRunId),
        eq(designSchemeRuns.userId, generation.userId),
      ),
    )
    .for('update');
  // Read the execution without a row lock: API cancellation locks execution before generation.
  const [execution] = await tx
    .select()
    .from(designSchemeRunExecutions)
    .where(
      and(
        eq(designSchemeRunExecutions.runId, generation.designSchemeRunId),
        eq(designSchemeRunExecutions.userId, generation.userId),
      ),
    );
  if (!row || !execution) throw new Error('方案执行快照不存在');
  const input = designSchemeRunInputSchema.parse(execution.preparedInput);
  assertCloudFixedRunPlan(input);
  const previous = runResultSchema.parse(row.result);
  if (
    input.executionId !== execution.executionId ||
    input.schemeId !== row.schemeId ||
    input.revisionId !== row.revisionId ||
    input.mode !== row.mode ||
    previous.runId !== row.runId ||
    previous.schemeId !== row.schemeId ||
    previous.revisionId !== row.revisionId ||
    previous.mode !== row.mode ||
    previous.status !== row.status ||
    !isDeepStrictEqual(designSchemeRunPlanSchema.parse(row.plan), input.plan) ||
    !isDeepStrictEqual(
      previous.steps.map((step) => step.id),
      input.plan.steps.map((step) => step.id),
    )
  )
    throw new Error('方案执行快照与运行账本不一致');
  const context = { input, compiledPrompt: previous.compiledPrompt };
  if (['completed', 'failed', 'cancelled', 'blocked'].includes(previous.status)) {
    if (previous.status !== status) throw new Error('方案终态与生成终态不一致');
    return context;
  }
  const now = options.now.toISOString();
  let result: RunResult;
  if (status === 'completed') {
    const uploaded = options.uploaded ?? [];
    if (!uploaded.length) throw new UpstreamImageError('rejected', '方案运行没有有效输出');
    const outputs = uploaded.map((asset, index) =>
      runOutputMetadataSchema.parse({
        id: asset.id,
        runId: row.runId,
        origin: 'cloud-run',
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        byteSize: asset.bytes.length,
        contentHash: asset.checksum,
        role: index === 0 ? 'primary' : 'variant',
        license: null,
        createdAt: now,
      }),
    );
    const evaluation = evaluate(row.runId, input, uploaded, now);
    const evaluating = advanceCloudRunResult(previous, 'evaluating', { now, outputs });
    result = advanceCloudRunResult(evaluating, 'completed', { now, evaluation });
    await tx.insert(designSchemeEvaluations).values({
      evaluationId: evaluation.evaluationId,
      runId: row.runId,
      userId: generation.userId,
      passed: evaluation.passed ? 1 : 0,
      metrics: { checks: evaluation.checks, repairHint: null, repair: null },
      evidence: { outputs },
      createdAt: options.now,
    });
    if (row.mode === 'trial') {
      for (const asset of uploaded)
        await tx.insert(designSchemeAssets).values({
          id: asset.id,
          userId: generation.userId,
          revisionId: row.revisionId,
          objectKey: asset.objectKey,
          role: 'output',
          origin: 'cloud-run',
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          byteSize: asset.bytes.length,
          contentHash: asset.checksum,
          license: null,
          createdAt: options.now,
        });
    }
    const generationStep = result.steps.find((step) => step.kind === 'generate-image');
    const evaluationStep = result.steps.find((step) => step.kind === 'evaluate-image');
    if (!generationStep || !evaluationStep) throw new Error('方案固定步骤不存在');
    await emit(tx, generation, {
      kind: 'step-completed',
      executionId: execution.executionId,
      runId: row.runId,
      stepId: generationStep.id,
      outputIds: outputs.map((output) => output.id),
    });
    await emit(tx, generation, {
      kind: 'step-started',
      executionId: execution.executionId,
      runId: row.runId,
      stepId: evaluationStep.id,
    });
    await emit(tx, generation, {
      kind: 'step-completed',
      executionId: execution.executionId,
      runId: row.runId,
      stepId: evaluationStep.id,
      outputIds: [],
    });
    await emit(tx, generation, {
      kind: 'evaluation-completed',
      executionId: execution.executionId,
      evaluation,
    });
    await emit(tx, generation, { kind: 'completed', executionId: execution.executionId, result });
  } else {
    result = advanceCloudRunResult(previous, status, { now, error: options.error });
    if (status === 'executing') {
      const started = result.steps.find((step) => step.kind === 'generate-image');
      if (started && previous.steps.find((step) => step.id === started.id)?.status !== 'running') {
        await emit(tx, generation, {
          kind: 'step-started',
          executionId: execution.executionId,
          runId: row.runId,
          stepId: started.id,
        });
      }
    } else if (status === 'cancelled') {
      await emit(tx, generation, {
        kind: 'cancelled',
        executionId: execution.executionId,
        runId: row.runId,
      });
    } else {
      if (!result.error) throw new Error('方案失败结果缺少错误信息');
      await emit(tx, generation, {
        kind: 'failed',
        executionId: execution.executionId,
        runId: row.runId,
        error: result.error,
      });
    }
  }
  for (const step of result.steps)
    await tx
      .insert(designSchemeRunSteps)
      .values({
        runId: row.runId,
        stepId: step.id,
        userId: generation.userId,
        status: step.status,
        input: { kind: step.kind, dependsOn: step.dependsOn, inputRefs: step.inputRefs },
        output: { outputRefs: step.outputRefs, error: step.error },
        startedAt: step.startedAt === null ? null : new Date(step.startedAt),
        completedAt: step.completedAt === null ? null : new Date(step.completedAt),
      })
      .onConflictDoUpdate({
        target: [designSchemeRunSteps.runId, designSchemeRunSteps.stepId],
        set: {
          status: step.status,
          output: { outputRefs: step.outputRefs, error: step.error },
          startedAt: step.startedAt === null ? null : new Date(step.startedAt),
          completedAt: step.completedAt === null ? null : new Date(step.completedAt),
        },
      });
  await tx
    .update(designSchemeRuns)
    .set({
      status: result.status,
      result,
      completedAt: result.completedAt === null ? null : new Date(result.completedAt),
    })
    .where(
      and(eq(designSchemeRuns.runId, row.runId), eq(designSchemeRuns.userId, generation.userId)),
    );
  return context;
}

/** Compare only frozen server snapshots; do not compile again or accept provider overrides. */
export function assertSchemeGenerationRequest(
  context: PreparedExecution,
  request: ParsedCloudGenerationRequest,
): void {
  const settings = context.input.executionSettings;
  if (
    request.prompt !== context.compiledPrompt ||
    request.count !== settings.outputCount ||
    request.size !== settings.size ||
    request.quality !== settings.quality ||
    (request.negative ?? '') !== (settings.negativePrompt?.trim() ?? '') ||
    (request.aspectRatio ?? null) !== (settings.aspectRatio ?? null) ||
    (request.providerId !== undefined && request.providerId !== settings.providerId) ||
    !isDeepStrictEqual(
      request.referenceImages.map((reference) => reference.id),
      settings.referenceAssetIds,
    )
  )
    throw new UpstreamImageError('rejected', '方案生成请求与冻结的运行计划不一致');
}

export async function downloadDesignSchemeReferences(
  db: Pick<MusefoldDatabase, 'select'>,
  s3: S3Client,
  bucket: string,
  generation: GenerationPayload,
  request: ParsedCloudGenerationRequest,
): Promise<ReferenceImageInput[]> {
  const rows = await db
    .select()
    .from(designSchemeGenerationReferences)
    .where(
      and(
        eq(designSchemeGenerationReferences.generationRunId, generation.runId),
        eq(designSchemeGenerationReferences.userId, generation.userId),
      ),
    )
    .orderBy(asc(designSchemeGenerationReferences.position));
  const hash = createHash('sha256').update(generation.userId).digest('hex');
  const rawPrefix = `users/${generation.userId}/`;
  const uploadPrefix = `users/${hash}/design-scheme-uploads/`;
  if (
    rows.length !== request.referenceImages.length ||
    rows.some((row, index) => {
      const reference = request.referenceImages[index];
      return (
        row.position !== index ||
        row.assetId !== reference.id ||
        row.name !== reference.name ||
        row.mimeType !== reference.mimeType ||
        row.byteSize !== reference.byteSize ||
        row.byteSize <= 0 ||
        row.byteSize > MAX_REFERENCE_IMAGE_BYTES ||
        (!row.objectKey.startsWith(rawPrefix) && !row.objectKey.startsWith(uploadPrefix)) ||
        row.objectKey.split('/').some((part) => part === '..') ||
        !/^[a-f0-9]{64}$/i.test(row.contentHash)
      );
    })
  )
    throw new UpstreamImageError('rejected', '方案参考图与冻结的受管资产不一致');
  const references: ReferenceImageInput[] = [];
  for (const row of rows) {
    try {
      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: row.objectKey }));
      const body = response.Body;
      if (
        !body ||
        !(Symbol.asyncIterator in body) ||
        (response.ContentLength !== undefined && response.ContentLength !== row.byteSize) ||
        (response.ContentType !== undefined && response.ContentType !== row.mimeType)
      ) {
        if (body && 'destroy' in body && typeof body.destroy === 'function') body.destroy();
        throw new Error('Invalid object metadata');
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        const bytes = Buffer.from(chunk);
        length += bytes.length;
        if (length > MAX_REFERENCE_IMAGE_BYTES || length > row.byteSize)
          throw new Error('Object too large');
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks);
      if (length !== row.byteSize || imageChecksum(bytes) !== row.contentHash.toLowerCase())
        throw new Error('Object integrity mismatch');
      references.push({ bytes, mimeType: row.mimeType, name: row.name });
    } catch {
      throw new UpstreamImageError('rejected', '方案参考图不可用或完整性校验失败，请重新添加');
    }
  }
  return references;
}
