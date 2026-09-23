import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  GenerationReferenceImage,
  ParsedCreateGenerationInput,
  GenerationExecutionReceipt,
} from '@musefold/contracts';
import { getDb } from '@musefold/core/db';
import { createWorkbenchRepositories } from '@musefold/core/db/repositories/workbench';
import { ManagedExecutionError } from '@musefold/core/db/repositories/managed-execution';
import { automationInputHash } from '@musefold/core/db/repositories/automation-spend';
import { generate } from '@musefold/core/services/generation';
import {
  isManagedUploadPath,
  LocalImageError,
  readLocalImage,
} from '@musefold/core/providers/local-image';
import {
  managedGenerationInputSchema,
  type ManagedReferenceImage,
} from '@musefold/desktop-contracts/managed-generation';
import type {
  GenerateImageRequest,
  GenerateImageResult,
} from '@musefold/desktop-contracts/providers';
import { getPaths } from './paths';
import { withManagedGenerationSession } from './managed-generation-client';
import { readAccountCloudProvider } from './account-cloud-connection';
import { describeManagedRecovery } from './account-cloud-recovery';

type Session = Parameters<Parameters<typeof withManagedGenerationSession>[0]>[0];
const active = new Map<string, Promise<void>>();
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'rejected', 'expired']);
const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

export function isManagedGenerationActive(jobId: string): boolean {
  return active.has(jobId);
}

export function managedRequestForLocalJob(jobId: string): string | null {
  const row = getDb()
    .prepare(`SELECT m.request_id AS id FROM managed_generation_requests m
    JOIN automation_spend_requests s ON s.id = m.request_id WHERE s.execution_id = ?`)
    .get(jobId) as { id: string } | undefined;
  return row?.id ?? null;
}

function localIdForRequest(requestId: string): string | null {
  const row = getDb()
    .prepare(`SELECT r.id FROM generation_runs r
    JOIN automation_spend_requests s ON s.execution_id = r.id WHERE s.id = ?`)
    .get(requestId) as { id: string } | undefined;
  return row?.id ?? null;
}

function frozenRequest(
  input: ParsedCreateGenerationInput,
  referenceImages: ManagedReferenceImage[] = [],
) {
  if (
    input.promptReferenceSelections.length ||
    input.promptId ||
    input.parentRunId ||
    input.runKind !== 'free_generation'
  )
    throw new ManagedExecutionError('MANAGED_INPUT_UNSUPPORTED');
  return managedGenerationInputSchema.parse({
    prompt: input.prompt,
    ...(input.negative === undefined ? {} : { negative: input.negative }),
    size: input.size,
    ...(input.aspectRatio === undefined ? {} : { aspectRatio: input.aspectRatio }),
    quality: input.quality,
    count: input.count,
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(referenceImages.length ? { referenceImages } : {}),
  });
}

/**
 * Resolves the bridge's staged reference ids into frozen cloud references before any
 * ledger registration: read the staged bytes (TOCTOU-guarded, managed-uploads path only),
 * upload exactly those bytes through the account session, then freeze the server id plus
 * the sha256 digest of the bytes actually sent. Every failure here precedes registration —
 * no spend row and no generation POST can exist, hence zero paid sends — and ids already
 * accepted by the server get a best-effort retention release instead of waiting out the TTL.
 */
async function freezeReferenceImages(
  session: Session,
  input: ParsedCreateGenerationInput,
  request: GenerateImageRequest,
): Promise<ManagedReferenceImage[]> {
  const staged = request.referenceImages ?? [];
  if (input.referenceImages.length === 0) {
    if (staged.length !== 0) throw new ManagedExecutionError('MANAGED_INPUT_UNSUPPORTED');
    return [];
  }
  if (staged.length !== input.referenceImages.length)
    throw new ManagedExecutionError('MANAGED_INPUT_UNSUPPORTED');
  const uploaded: GenerationReferenceImage[] = [];
  try {
    const frozen: ManagedReferenceImage[] = [];
    for (const [index, reference] of input.referenceImages.entries()) {
      session.assertCurrent();
      const local = staged[index];
      if (local?.source !== 'upload' || !isManagedUploadPath(local.path))
        throw new ManagedExecutionError('MANAGED_REFERENCE_NOT_STAGED');
      let bytes: Buffer;
      let mimeType: string;
      try {
        const read = await readLocalImage(local);
        bytes = read.bytes;
        mimeType = read.image.mimeType;
      } catch (error) {
        if (error instanceof LocalImageError)
          throw new ManagedExecutionError('MANAGED_REFERENCE_READ_FAILED');
        throw error;
      }
      session.assertCurrent();
      const cloud = await session.client.uploadReferenceImage({
        name: reference.name,
        bytes,
      });
      uploaded.push(cloud);
      // The server sniffed the very bytes we sent; any divergence is a corrupt reply.
      if (cloud.byteSize !== bytes.byteLength || cloud.mimeType !== mimeType)
        throw new ManagedExecutionError('MANAGED_RESPONSE_INVALID');
      frozen.push({ ...cloud, digest: createHash('sha256').update(bytes).digest('hex') });
    }
    return frozen;
  } catch (error) {
    for (const cloud of uploaded)
      await session.client.releaseReferenceImage(cloud.id).catch(() => undefined);
    throw error;
  }
}

function receiptCost(receipt: GenerationExecutionReceipt): number | undefined {
  return receipt.costProvenance === 'provider_reported'
    ? (receipt.costPoints ?? undefined)
    : receipt.costProvenance === 'not_sent' && receipt.dispatch !== 'claimed'
      ? 0
      : undefined;
}

/** One idempotent local projection, reused by live execution and GET-only recovery. */
async function finishLocal(
  session: Session,
  requestId: string,
): Promise<GenerateImageResult | null> {
  session.assertCurrent();
  const record = session.ledger.forQuery(requestId, session.client.context);
  const localId = localIdForRequest(requestId);
  if (!localId) return null;
  const runs = createWorkbenchRepositories(getDb()).runs;
  const current = runs.get(localId);
  if (!current) return null;
  if (record.cancelRequestedAt !== null && record.submissionState === 'unclaimed') {
    // Durable unclaimed cancellation proves no send capability was consumed. Keep the
    // local history consistent with the spend ledger and recovery panel's known zero.
    getDb().prepare('UPDATE generation_runs SET actual_cost = 0 WHERE id = ?').run(localId);
    runs.cancel(localId);
    return { historyId: localId, status: 'cancelled', cost: 0 };
  }
  const receipt = record.receipt;
  if (!receipt || !terminal.has(receipt.status)) return null;
  const cost = receiptCost(receipt);
  // The receipt owns accounting, including failed/cancelled tasks and costs learned later.
  if (cost !== undefined)
    getDb().prepare('UPDATE generation_runs SET actual_cost = ? WHERE id = ?').run(cost, localId);
  if (receipt.status !== 'succeeded') {
    if (receipt.status === 'cancelled') runs.cancel(localId);
    else runs.fail(localId, 'MANAGED_REMOTE_FAILED', '云端任务已结束，请查看原任务与费用状态');
    return {
      historyId: localId,
      status: receipt.status === 'cancelled' ? 'cancelled' : 'failed',
      cost,
    };
  }
  // Cloud completion is independent of local delivery. A purged result must not remain running.
  runs.start(localId);
  if (runs.complete(localId, { actualCost: cost ?? null, assets: [] }).status !== 'success')
    throw new ManagedExecutionError('MANAGED_LOCAL_RESULT_CONFLICT');
  if (record.receipt?.purgedAt || describeManagedRecovery(record).result === 'available')
    return { historyId: localId, status: 'success', cost };
  const existing = getDb()
    .prepare(`SELECT id, position, mime_type AS mimeType, file_size AS fileSize,
    checksum, width, height FROM generated_assets WHERE run_id = ? ORDER BY position`)
    .all(localId) as Array<{
    id: string;
    position: number;
    mimeType: string | null;
    fileSize: number | null;
    checksum: string | null;
    width: number | null;
    height: number | null;
  }>;
  if (existing.length !== 0 && existing.length !== record.frozenRequest.count)
    throw new ManagedExecutionError('MANAGED_LOCAL_RESULT_CONFLICT');
  const job = await session.client.result(requestId);
  if (!job || job.status !== 'succeeded' || job.assets.length !== record.frozenRequest.count)
    throw new ManagedExecutionError('MANAGED_RESULT_PENDING');
  const images: Array<{
    imagePath: string;
    actualSize: { width: number; height: number };
    mimeType: (typeof job.assets)[number]['mimeType'];
    fileSize: number;
    checksum: string;
  }> = [];
  for (const [position, item] of job.assets.entries()) {
    const downloaded = await session.client.asset(requestId, item.id);
    session.assertCurrent();
    const asset = downloaded.asset;
    const checksum = createHash('sha256').update(downloaded.bytes).digest('hex');
    const previous = existing[position];
    if (
      previous &&
      (previous.checksum !== checksum ||
        previous.position !== position ||
        previous.mimeType !== asset.mimeType ||
        previous.fileSize !== asset.byteSize ||
        previous.width !== asset.width ||
        previous.height !== asset.height)
    )
      throw new ManagedExecutionError('MANAGED_LOCAL_RESULT_CONFLICT');
    const fileId = createHash('sha256')
      .update(JSON.stringify([requestId, asset.id, checksum]))
      .digest('hex');
    const directory = getPaths().pictures;
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `cloud-${fileId}${extensions[asset.mimeType]}`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    // Synchronous atomic install follows the last account/DB assertion. A crash leaves at most
    // an unreferenced temporary file, never a partial published image or an extra generation.
    try {
      writeFileSync(temporary, downloaded.bytes, { flag: 'wx', mode: 0o600 });
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
    images.push({
      imagePath: path,
      actualSize: { width: asset.width, height: asset.height },
      mimeType: asset.mimeType,
      fileSize: downloaded.bytes.length,
      checksum,
    });
  }
  session.assertCurrent();
  getDb().transaction(() => {
    session.assertCurrent();
    if (runs.get(localId)?.status !== 'success')
      throw new ManagedExecutionError('MANAGED_LOCAL_RESULT_CONFLICT');
    const rows = getDb()
      .prepare('SELECT count(*) AS n FROM generated_assets WHERE run_id = ?')
      .get(localId) as { n: number };
    if (rows.n !== existing.length)
      throw new ManagedExecutionError('MANAGED_LOCAL_RESULT_CONFLICT');
    for (const [position, item] of images.entries()) {
      const prior = existing[position];
      if (prior) {
        const updated = getDb()
          .prepare(
            'UPDATE generated_assets SET media_path = ? WHERE id = ? AND run_id = ? AND checksum = ? AND status = ?',
          )
          .run(item.imagePath, prior.id, localId, item.checksum, 'available');
        if (updated.changes !== 1) throw new ManagedExecutionError('MANAGED_LOCAL_RESULT_CONFLICT');
      } else
        getDb()
          .prepare(`INSERT INTO generated_assets(id,run_id,position,status,media_path,mime_type,width,height,file_size,checksum,created_at)
        VALUES(?,?,?,'available',?,?,?,?,?,?,?)`)
          .run(
            position === 0 ? localId : `${localId}-${position + 1}`,
            localId,
            position,
            item.imagePath,
            item.mimeType,
            item.actualSize.width,
            item.actualSize.height,
            item.fileSize,
            item.checksum,
            Date.now(),
          );
    }
    getDb()
      .prepare('UPDATE generation_runs SET duration_ms = COALESCE(?, duration_ms) WHERE id = ?')
      .run(job.durationMs ?? null, localId);
  })();
  return {
    historyId: localId,
    status: 'success',
    images,
    cost,
    durationMs: job.durationMs ?? undefined,
  };
}

function delay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new ManagedExecutionError('MANAGED_OPERATION_ABORTED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 1500);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Resolves once the local run exists; its session continues until result or uncertain failure. */
export async function startManagedGeneration(
  input: ParsedCreateGenerationInput,
  request: GenerateImageRequest,
  options: {
    retryOfRequestId?: string;
    retryOfRunId?: string;
    callerKey?: string;
    automation?: {
      inputHash: string;
      consent?: 'interactive';
      declaredBudgetPoints?: number;
      estimatedPoints: number | null;
      authorize(details: { confirmationId: string; confirmationExpiresAt: number }): Promise<void>;
      onSettled(): void;
    };
  } = {},
): Promise<string> {
  const base = frozenRequest(input);
  const jobId = request.jobId;
  if (!jobId) throw new ManagedExecutionError('MANAGED_LOCAL_RUN_REQUIRED');
  let resolveReady: (id: string) => void = () => {};
  let rejectReady: (error: unknown) => void = () => {};
  const ready = new Promise<string>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const work = withManagedGenerationSession(async (session) => {
    if (options.retryOfRequestId) {
      session.ledger.retrySource(options.retryOfRequestId, session.client.context);
      if (localIdForRequest(options.retryOfRequestId) !== options.retryOfRunId)
        throw new ManagedExecutionError('MANAGED_RETRY_MISMATCH');
    } else if (options.retryOfRunId) throw new ManagedExecutionError('MANAGED_RETRY_MISMATCH');
    const binding = await session.client.binding(base.model);
    session.assertCurrent();
    if (readAccountCloudProvider(session.client.context)?.id !== request.providerId)
      throw new ManagedExecutionError('MANAGED_CONNECTION_CHANGED');
    if (
      input.expectedBinding &&
      automationInputHash(input.expectedBinding) !== automationInputHash(binding)
    )
      throw new ManagedExecutionError('MANAGED_IDENTITY_CHANGED');
    const { getAutomationSpendRepository } = await import('../settings/automation');
    session.assertCurrent();
    getAutomationSpendRepository();
    const estimatedPoints = options.automation
      ? await session.client.automationEstimate(binding.model, input.count)
      : null;
    if (
      options.automation?.declaredBudgetPoints !== undefined &&
      (estimatedPoints === null || estimatedPoints > options.automation.declaredBudgetPoints)
    )
      throw new ManagedExecutionError('BUDGET_EXCEEDED');
    // Uploads complete before registration so the frozen request carries final cloud ids;
    // a failure leaves no spend row and never reaches the generation POST below.
    const referenceImages = await freezeReferenceImages(session, input, request);
    const frozen = referenceImages.length ? { ...base, referenceImages } : base;
    const { record, replayed } = await session.ledger.register({
      callerKey: options.callerKey ?? jobId,
      caller: options.automation ? 'local-automation' : 'desktop-workbench',
      executionId: jobId,
      binding,
      authEpoch: session.client.context.authEpoch,
      request: frozen,
      ...(options.retryOfRequestId ? { retryOfRequestId: options.retryOfRequestId } : {}),
      estimatedPoints,
      ...(options.automation
        ? {
            consent: options.automation.consent,
            declaredBudgetPoints: options.automation.declaredBudgetPoints,
            automationInputHash: options.automation.inputHash,
          }
        : { consent: 'interactive' as const }),
      now: Date.now(),
    });
    if (replayed) {
      const existing = localIdForRequest(record.requestId);
      if (!existing) throw new ManagedExecutionError('MANAGED_QUERY_ONLY');
      resolveReady(existing);
      return;
    }
    if (options.automation) {
      const spend = getAutomationSpendRepository().get(record.requestId);
      if (spend?.state === 'pending_confirmation') {
        if (!spend.confirmationId || spend.confirmationExpiresAt === null)
          throw new ManagedExecutionError('MANAGED_REQUEST_CORRUPT');
        try {
          await options.automation.authorize({
            confirmationId: spend.confirmationId,
            confirmationExpiresAt: spend.confirmationExpiresAt,
          });
        } catch (error) {
          await session.ledger.resolveConfirmation(
            record.requestId,
            session.client.context,
            false,
            Date.now(),
          );
          throw error;
        }
        if (
          !(await session.ledger.resolveConfirmation(
            record.requestId,
            session.client.context,
            true,
            Date.now(),
          ))
        )
          throw new ManagedExecutionError('CONFIRMATION_TIMEOUT');
      }
    }
    let uncertain = false;
    const completion = generate(
      { ...request, prompt: input.prompt, model: binding.model },
      undefined,
      {
        signal: session.signal,
        userPrompt: input.prompt,
        retryOfRunId: options.retryOfRunId,
        transport: {
          providerId: request.providerId,
          retryOfRunId: options.retryOfRunId,
          assertCurrent() {
            session.assertCurrent();
            if (uncertain) throw new ManagedExecutionError('MANAGED_QUERY_ONLY');
          },
          async generate() {
            try {
              await session.client.submitInitial(record.requestId, jobId);
              for (;;) {
                await session.client.continueCancellation(record.requestId);
                const result = await finishLocal(session, record.requestId);
                if (result) return result;
                await delay(session.signal);
                await session.client.reconcile(record.requestId);
              }
            } catch (error) {
              // Never let core turn a network/restore/late-result uncertainty into a local terminal
              // outcome. Recovery projects the original receipt; it never invokes this POST path.
              const cancelled = session.ledger.forQuery(record.requestId, session.client.context);
              if (cancelled.cancelRequestedAt !== null && cancelled.submissionState === 'unclaimed')
                return { historyId: jobId, status: 'cancelled' as const };
              uncertain = true;
              throw error;
            }
          },
        },
      },
    );
    if (!createWorkbenchRepositories(getDb()).runs.get(jobId))
      throw new ManagedExecutionError('MANAGED_LOCAL_RUN_REQUIRED');
    resolveReady(jobId);
    await completion;
  });
  const settled = work.then(
    () => undefined,
    (error) => {
      rejectReady(error);
    },
  );
  active.set(jobId, settled);
  void settled.finally(() => {
    if (active.get(jobId) === settled) active.delete(jobId);
    options.automation?.onSettled();
  });
  return ready;
}

export async function reconcileManagedGeneration(requestId: string): Promise<void> {
  const localId = localIdForRequest(requestId);
  if (localId && active.has(localId)) return;
  const work = withManagedGenerationSession(async (session) => {
    session.ledger.forQuery(requestId, session.client.context);
    await session.guard.recoverCommittedOperation();
    await session.client.reconcile(requestId);
    await session.client.continueCancellation(requestId);
    await finishLocal(session, requestId);
  });
  if (localId) active.set(localId, work);
  try {
    await work;
  } finally {
    if (localId && active.get(localId) === work) active.delete(localId);
  }
}

export function cancelManagedGeneration(requestId: string): Promise<void> {
  return withManagedGenerationSession(async (session) => {
    await session.client.cancel(requestId);
    if (!active.has(localIdForRequest(requestId) ?? '')) await finishLocal(session, requestId);
  });
}

export function scheduleManagedReconciliation(jobId: string): void {
  if (active.has(jobId)) return;
  const requestId = managedRequestForLocalJob(jobId);
  if (requestId) void reconcileManagedGeneration(requestId).catch(() => undefined);
}
