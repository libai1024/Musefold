import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { createGenerationInputSchema } from '@musefold/contracts';
import { cloudAutomationGenerationSchema } from '@musefold/desktop-contracts/automation-generation';
import type { LocalImageReference } from '@musefold/desktop-contracts/providers';
import { getDb } from '@musefold/core/db';
import { automationInputHash } from '@musefold/core/db/repositories/automation-spend';
import { readLocalImage } from '@musefold/core/providers/local-image';
import type { EventHub } from '@musefold/core';
import {
  AutomationError,
  type GenerationGate,
  type GenerationHost,
  type AutomationRouteContext,
} from '@musefold/automation-server';
import { getAutomationSpendRepository } from '../settings/automation';
import { withManagedGenerationSession } from '../system/managed-generation-client';
import { readAccountCloudProvider } from '../system/account-cloud-connection';
import {
  startManagedGeneration,
  managedRequestForLocalJob,
  cancelManagedGeneration,
  scheduleManagedReconciliation,
  isManagedGenerationActive,
} from '../system/managed-generation-runtime';

/** Cloud account G uses the same guarded ledger/transport/projection as the workbench. */
export function wrapCloudGenerationGate(
  legacy: GenerationGate,
  host: GenerationHost,
  hub: EventHub,
  authorize: (details: {
    providerName: string;
    model: string;
    n: number;
    estimatedPoints: number | null;
    managedByAccount: boolean;
    promptPreview: string;
    confirmationId: string;
    confirmationExpiresAt: number;
  }) => Promise<void>,
  resolveConfirmation: (id: string, approved: boolean) => boolean,
  releaseReferences: (paths: string[]) => void = () => {},
): GenerationGate {
  const submissions = new Map<string, { hash: string; result: Promise<string> }>();
  const pending = new Set<string>();
  const repository = () => getAutomationSpendRepository();
  const key = (ctx: AutomationRouteContext) => {
    const value = ctx.request.headers['idempotency-key'];
    return Array.isArray(value) ? value[0] : value;
  };
  const managedByKey = (value: string | undefined) => {
    if (!value) return null;
    const row = repository().findByKey(value);
    return row && managedRequestForLocalJob(row.executionId) ? row : null;
  };
  function selected(body: unknown) {
    const id =
      body && typeof body === 'object' ? (body as { providerId?: unknown }).providerId : undefined;
    return (
      typeof id === 'string'
        ? getDb().prepare('SELECT id,type,model,name FROM providers WHERE id = ?').get(id)
        : getDb()
            .prepare('SELECT id,type,model,name FROM providers WHERE is_active = 1 LIMIT 1')
            .get()
    ) as { id: string; type: string; model: string; name: string } | undefined;
  }
  function parse(body: unknown) {
    const parsed = cloudAutomationGenerationSchema.safeParse(body);
    if (!parsed.success)
      throw new AutomationError('INVALID_PARAMS', '云账号生图参数无效（张数支持 1、2、4）', 400);
    if (parsed.data.background && parsed.data.background !== 'auto')
      throw new AutomationError(
        'INVALID_PARAMS',
        '云账号当前不支持指定 background；本次未发送',
        400,
      );
    return parsed.data;
  }
  async function estimate(body: ReturnType<typeof parse>) {
    const provider = selected(body);
    if (!provider) throw new AutomationError('NOT_FOUND', '连接不存在', 404);
    return withManagedGenerationSession(async (session) => {
      const model = body.model ?? provider.model;
      await session.client.binding(model);
      if (readAccountCloudProvider(session.client.context)?.id !== provider.id)
        throw new AutomationError(
          'PAYMENT_IDENTITY_UNBOUND',
          '所选云连接不属于当前已验证账号',
          409,
        );
      const n = body.n ?? 1;
      return {
        providerId: provider.id,
        providerName: provider.name,
        model,
        n,
        managedByAccount: true,
        points: await session.client.automationEstimate(model, n),
      };
    });
  }
  async function read(jobId: string, inputHash?: string) {
    const requestId = managedRequestForLocalJob(jobId);
    if (!requestId) throw new AutomationError('NOT_FOUND', '云生成任务不存在', 404);
    return withManagedGenerationSession(async (session) => {
      const record = session.ledger.forQuery(requestId, session.client.context);
      if (inputHash && record.automationInputHash !== inputHash)
        throw new AutomationError('IDEMPOTENCY_CONFLICT', '同一请求键的入口与输入已冻结', 409);
      const spend = repository().get(requestId);
      if (!spend) throw new AutomationError('NOT_FOUND', '生成记录不存在', 404);
      const run = getDb()
        .prepare('SELECT status,duration_ms AS durationMs FROM generation_runs WHERE id = ?')
        .get(jobId) as { status: string; durationMs: number | null } | undefined;
      const assets = getDb()
        .prepare(
          "SELECT media_path AS path FROM generated_assets WHERE run_id = ? AND status = 'available' AND media_path IS NOT NULL ORDER BY position",
        )
        .all(jobId) as Array<{ path: string }>;
      const receipt = record.receipt;
      const interruptedBeforeSend =
        record.submissionState === 'unclaimed' && !run && !isManagedGenerationActive(jobId);
      const costPoints =
        receipt?.costProvenance === 'provider_reported'
          ? receipt.costPoints
          : receipt?.costProvenance === 'not_sent' && receipt.dispatch !== 'claimed'
            ? 0
            : null;
      const status =
        run?.status === 'success' && assets.length === record.frozenRequest.count
          ? 'success'
          : receipt?.purgedAt || interruptedBeforeSend
            ? 'failed'
            : spend.outcome === 'cancelled'
              ? 'cancelled'
              : spend.state === 'terminal' && spend.outcome !== 'success'
                ? 'failed'
                : 'running';
      return {
        jobId,
        historyId: jobId,
        status,
        assets,
        costPoints,
        cost: costPoints,
        costUnit: 'point',
        startedAt: spend.createdAt,
        estimatedPoints: spend.estimatedPoints,
        durationMs: run?.durationMs ?? null,
        error:
          status === 'failed'
            ? {
                code: receipt?.purgedAt
                  ? 'MANAGED_RESULT_UNAVAILABLE'
                  : interruptedBeforeSend
                    ? 'MANAGED_QUERY_ONLY'
                    : (spend.errorCode ?? 'MANAGED_REMOTE_FAILED'),
                message: '云任务未成功，请核对原任务；不会自动重发',
              }
            : null,
      };
    });
  }
  async function submit(body: ReturnType<typeof parse>, callerKey: string, hash: string) {
    const prior = managedByKey(callerKey);
    if (prior) {
      await read(prior.executionId, hash);
      scheduleManagedReconciliation(prior.executionId);
      return prior.executionId;
    }
    // A key owned by any legacy request is never converted into a new cloud request.
    if (repository().findByKey(callerKey))
      throw new AutomationError('IDEMPOTENCY_CONFLICT', '请求键已被其他生成占用', 409);
    const preview = await estimate(body);
    if (
      body.declaredBudgetPoints !== undefined &&
      (preview.points === null || preview.points > body.declaredBudgetPoints)
    )
      throw new AutomationError('BUDGET_EXCEEDED', '无法确认费用在声明上限内；本次未发送', 409);
    const refs: LocalImageReference[] = [];
    for (const path of body.referenceImagePaths ?? []) {
      if (!host.authorizeReferencePath(path))
        throw new AutomationError('PATH_NOT_ALLOWED', '参考图必须先上传', 403);
      refs.push({
        path,
        name: basename(path),
        source: 'upload',
        mimeType: 'image/png',
        sizeBytes: 0,
      });
    }
    for (const id of body.referenceHistoryIds ?? []) {
      const image = host.resolveHistoryImage(id);
      if (!image) throw new AutomationError('NOT_FOUND', '历史图片不存在', 404);
      const local = await readLocalImage({ path: image.path, source: 'history', historyId: id });
      refs.push(await host.stageUpload(local.bytes, `history-${id}`, local.image.mimeType));
    }
    const jobId = randomUUID();
    const input = createGenerationInputSchema.parse({
      prompt: body.prompt,
      negative: body.negative,
      providerId: preview.providerId,
      model: preview.model,
      aspectRatio: body.aspectRatio,
      quality: body.quality ?? 'auto',
      size: 'auto',
      count: preview.n,
      referenceImages: refs.map((ref, index) => ({
        id: `automation-${index}`,
        name: ref.name ?? 'reference',
        url: '/api/v1/generations/references/staged',
        mimeType: 'image/png',
        byteSize: 0,
      })),
    });
    const notify = () => {
      void read(jobId)
        .then((result) => {
          if (result.status !== 'running') {
            releaseReferences(refs.map((reference) => reference.path));
            hub.sink.emit({
              type: result.status === 'success' ? 'generation.completed' : 'generation.failed',
              payload: result,
            });
          }
        })
        .catch(() => undefined);
    };
    return startManagedGeneration(
      input,
      {
        jobId,
        providerId: preview.providerId,
        model: preview.model,
        prompt: body.prompt,
        negative: body.negative,
        size: 'auto',
        aspectRatio: body.aspectRatio,
        quality: body.quality ?? 'auto',
        n: preview.n,
        referenceImages: refs,
      },
      {
        callerKey,
        automation: {
          inputHash: hash,
          consent: body.consent,
          estimatedPoints: preview.points,
          declaredBudgetPoints: body.declaredBudgetPoints,
          onSettled: notify,
          authorize: async (details) => {
            pending.add(details.confirmationId);
            try {
              await authorize({
                ...preview,
                ...details,
                estimatedPoints: preview.points,
                promptPreview: body.prompt.slice(0, 120),
              });
            } finally {
              pending.delete(details.confirmationId);
            }
          },
        },
      },
    );
  }
  const routes = { ...legacy.routes };
  routes['POST /v1/generations/estimate'] = async (ctx) => {
    if (selected(ctx.body)?.type !== 'musefold-cloud')
      return legacy.routes['POST /v1/generations/estimate'](ctx);
    return {
      ...(await estimate(parse(ctx.body))),
      remainingBudgetPoints: host.budget.remainingPoints(),
    };
  };
  routes['POST /v1/generations'] = async (ctx) => {
    const callerKey = key(ctx);
    if (
      !managedByKey(callerKey) &&
      !(callerKey && submissions.has(callerKey)) &&
      selected(ctx.body)?.type !== 'musefold-cloud'
    )
      return legacy.routes['POST /v1/generations'](ctx);
    const body = parse(ctx.body);
    const hash = automationInputHash(body);
    const previous = callerKey ? submissions.get(callerKey) : undefined;
    if (previous && previous.hash !== hash)
      throw new AutomationError('IDEMPOTENCY_CONFLICT', '请求键输入已冻结', 409);
    const result = previous?.result ?? submit(body, callerKey ?? randomUUID(), hash);
    if (callerKey && !previous) submissions.set(callerKey, { hash, result });
    const jobId = await result;
    ctx.json(await read(jobId, hash), previous ? 200 : 202);
  };
  for (const method of ['GET', 'DELETE'])
    routes[`${method} /v1/generations/:jobId`] = async (ctx) => {
      const requestId = managedRequestForLocalJob(ctx.params.jobId);
      if (!requestId) return legacy.routes[`${method} /v1/generations/:jobId`](ctx);
      const result = await read(ctx.params.jobId);
      if (method === 'DELETE') {
        await cancelManagedGeneration(requestId);
        return { jobId: ctx.params.jobId, cancelling: true };
      }
      if (result.status === 'running') scheduleManagedReconciliation(ctx.params.jobId);
      return result;
    };
  routes['POST /v1/confirmations/:id'] = (ctx) => {
    if (!pending.has(ctx.params.id)) return legacy.routes['POST /v1/confirmations/:id'](ctx);
    const approved = (ctx.body as { approved?: unknown } | null)?.approved;
    if (typeof approved !== 'boolean')
      throw new AutomationError('INVALID_PARAMS', '确认必须为布尔值', 400);
    if (!resolveConfirmation(ctx.params.id, approved))
      throw new AutomationError('NOT_FOUND', '确认已失效', 404);
    return { ok: true };
  };
  return { ...legacy, routes };
}
