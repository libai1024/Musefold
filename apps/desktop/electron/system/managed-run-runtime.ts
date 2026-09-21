import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecutionBinding, GenerationExecutionReceipt } from '@musefold/contracts';
import { CLOUD_GENERATION_MODEL } from '@musefold/domain/cloud-generation-policy';
import { AutomationError } from '@musefold/automation-server';
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
  managedRunChildInputSchema,
  managedRunRecordSchema,
  type ManagedReferenceImage,
  type ManagedRunRecord,
  type RegisterManagedRun,
} from '@musefold/desktop-contracts/managed-generation';
import type {
  AutomationPayerBinding,
  AutomationSpendRequest,
} from '@musefold/desktop-contracts/automation-spend';
import type {
  GenerateImageRequest,
  GenerateImageResult,
  LocalImageReference,
} from '@musefold/desktop-contracts/providers';
import { getPaths } from './paths';
import { withManagedGenerationSession } from './managed-generation-client';
import { readAccountCloudProvider } from './account-cloud-connection';
import { referenceHash } from '../main/automation-spend';
import { captureAutomationTextConnection } from '../main/automation-run-spend';
import { assertChildProjection, type LocalRunProjection } from './managed-run-projection';

type Session = Parameters<Parameters<typeof withManagedGenerationSession>[0]>[0];
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'rejected', 'expired']);
const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
/** Execution-lifetime sessions; reconciliation skips whatever is still being driven live. */
const active = new Map<string, Promise<void>>();

export function managedRunRequestForExecution(executionId: string): string | null {
  const row = getDb()
    .prepare(`SELECT m.request_id AS id FROM managed_run_requests m
    JOIN automation_spend_requests s ON s.id = m.request_id WHERE s.execution_id = ?`)
    .get(executionId) as { id: string } | undefined;
  return row?.id ?? null;
}

/** The frozen run record behind a caller key, if that key already belongs to a managed run. */
export function managedRunByCallerKey(callerKey: string | undefined): ManagedRunRecord | null {
  if (!callerKey) return null;
  const row = getDb()
    .prepare(`SELECT m.record_json AS record FROM managed_run_requests m
    JOIN automation_spend_requests s ON s.id = m.request_id WHERE s.idempotency_key = ?`)
    .get(callerKey) as { record: string } | undefined;
  return row ? managedRunRecordSchema.parse(JSON.parse(row.record)) : null;
}

/** True when the caller key already belongs to a managed R/S run row (replay routing). */
export function isManagedRunCallerKey(callerKey: string | undefined): boolean {
  return managedRunByCallerKey(callerKey) !== null;
}

/** A terminal replay reads the frozen receipt under current account authority, not a live source. */
export async function readTerminalManagedRunReplay(
  requestId: string,
  action: RegisterManagedRun['run']['runKind'],
  input: RegisterManagedRun['run']['input'],
): Promise<AutomationSpendRequest> {
  return withManagedGenerationSession(async (session) => {
    const record = session.ledger.forRunQuery(requestId, session.client.context);
    if (
      record.run.runKind !== action ||
      automationInputHash(record.run.input) !== automationInputHash(input)
    )
      throw new AutomationError('IDEMPOTENCY_CONFLICT', '同一请求键的入口与输入已冻结', 409);
    const { getAutomationSpendRepository } = await import('../settings/automation');
    session.assertCurrent();
    const request = getAutomationSpendRepository().get(requestId);
    if (request?.state !== 'terminal') throw new ManagedExecutionError('MANAGED_REQUEST_CORRUPT');
    return request;
  });
}

/** The same bounded terminal outcomes as the legacy local gate, never a resend. */
function assertManagedOutcome(request: AutomationSpendRequest): void {
  if (request.errorCode === 'PAYMENT_IDENTITY_UNBOUND')
    throw new AutomationError(
      'PAYMENT_IDENTITY_UNBOUND',
      '连接缺少可验证付款身份，本次运行未发送',
      409,
    );
  if (request.outcome === 'denied')
    throw new AutomationError('CONFIRMATION_DENIED', '本次运行已拒绝，请使用新的请求键', 403);
  if (request.outcome === 'timeout')
    throw new AutomationError('CONFIRMATION_TIMEOUT', '本次运行确认已过期，请使用新的请求键', 409);
}

function receiptCost(receipt: GenerationExecutionReceipt): number | undefined {
  return receipt.costProvenance === 'provider_reported'
    ? (receipt.costPoints ?? undefined)
    : receipt.costProvenance === 'not_sent' && receipt.dispatch !== 'claimed'
      ? 0
      : undefined;
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

/** Verified-account probe for routing only: no spend row, no upload, no send capability. */
export async function probeManagedRunSupport(providerId: string): Promise<void> {
  await withManagedGenerationSession(async (session) => {
    await session.client.binding();
    session.assertCurrent();
    if (readAccountCloudProvider(session.client.context)?.id !== providerId)
      throw new ManagedExecutionError('MANAGED_CONNECTION_CHANGED');
  });
}

/** Host-only preparation of an explicitly selected image model; no reservation or send. */
export async function prepareManagedRunBinding(
  providerId: string,
  model: ExecutionBinding['model'],
  expectedBinding?: ExecutionBinding,
): Promise<ExecutionBinding> {
  return withManagedGenerationSession(async (session) => {
    const binding = await session.client.binding(model);
    session.assertCurrent();
    if (readAccountCloudProvider(session.client.context)?.id !== providerId)
      throw new ManagedExecutionError('MANAGED_CONNECTION_CHANGED');
    if (expectedBinding && automationInputHash(expectedBinding) !== automationInputHash(binding))
      throw new ManagedExecutionError('MANAGED_IDENTITY_CHANGED');
    return binding;
  });
}

/** One idempotent local projection per child, reused by live execution and GET-only recovery. */
async function finishChildLocal(
  session: Session,
  requestId: string,
  ordinal: number,
): Promise<GenerateImageResult | null> {
  session.assertCurrent();
  const record = session.ledger.forRunQuery(requestId, session.client.context);
  const child = record.children[ordinal];
  if (!child) throw new ManagedExecutionError('MANAGED_REQUEST_NOT_FOUND');
  const localId = child.localGenerationId ?? child.originalJobId;
  const runs = createWorkbenchRepositories(getDb()).runs;
  const current = runs.get(localId);
  if (!current) return null;
  if (record.cancelRequestedAt !== null && child.submissionState === 'unclaimed') {
    // Durable unclaimed cancellation proves no send capability was consumed for this child.
    getDb().prepare('UPDATE generation_runs SET actual_cost = 0 WHERE id = ?').run(localId);
    runs.cancel(localId);
    return { historyId: localId, status: 'cancelled', cost: 0 };
  }
  const receipt = child.receipt;
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
  if (receipt.purgedAt) return { historyId: localId, status: 'success', cost };
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
  // A child is exactly one image (count fixed to 1 at the contract level).
  if (existing.length > 1) throw new ManagedExecutionError('MANAGED_LOCAL_RESULT_CONFLICT');
  const job = await session.client.runChildResult(requestId, ordinal);
  if (!job || job.status !== 'succeeded' || job.assets.length !== 1)
    throw new ManagedExecutionError('MANAGED_RESULT_PENDING');
  const item = job.assets[0];
  const downloaded = await session.client.runChildAsset(requestId, ordinal, item.id);
  session.assertCurrent();
  const asset = downloaded.asset;
  const checksum = createHash('sha256').update(downloaded.bytes).digest('hex');
  const previous = existing[0];
  if (
    previous &&
    (previous.checksum !== checksum ||
      previous.position !== 0 ||
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
  const image = {
    imagePath: path,
    actualSize: { width: asset.width, height: asset.height },
    mimeType: asset.mimeType,
    fileSize: downloaded.bytes.length,
    checksum,
  };
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
    if (previous) {
      const updated = getDb()
        .prepare(
          'UPDATE generated_assets SET media_path = ? WHERE id = ? AND run_id = ? AND checksum = ? AND status = ?',
        )
        .run(image.imagePath, previous.id, localId, image.checksum, 'available');
      if (updated.changes !== 1) throw new ManagedExecutionError('MANAGED_LOCAL_RESULT_CONFLICT');
    } else
      getDb()
        .prepare(`INSERT INTO generated_assets(id,run_id,position,status,media_path,mime_type,width,height,file_size,checksum,created_at)
      VALUES(?,?,?,'available',?,?,?,?,?,?,?)`)
        .run(
          localId,
          localId,
          0,
          image.imagePath,
          image.mimeType,
          image.actualSize.width,
          image.actualSize.height,
          image.fileSize,
          image.checksum,
          Date.now(),
        );
    getDb()
      .prepare('UPDATE generation_runs SET duration_ms = COALESCE(?, duration_ms) WHERE id = ?')
      .run(job.durationMs ?? null, localId);
  })();
  return {
    historyId: localId,
    status: 'success',
    images: [image.imagePath].map((imagePath) => ({ imagePath })),
    cost,
    durationMs: job.durationMs ?? undefined,
  };
}

/** Run-level reference freeze: digests captured once, uploads cached per digest for all children. */
interface ReferencePlan {
  frozenDigests: string[] | null;
  uploads: Map<string, ManagedReferenceImage>;
  authorizePath: (path: string) => boolean;
}

async function freezeChildReferences(
  session: Session,
  staged: LocalImageReference[],
  plan: ReferencePlan,
): Promise<ManagedReferenceImage[]> {
  if (staged.length === 0) {
    if (plan.frozenDigests !== null && plan.frozenDigests.length !== 0)
      throw new AutomationError('SPEND_REFERENCE_CHANGED', '参考图在授权后发生变化', 409);
    return [];
  }
  if (
    plan.frozenDigests === null ||
    plan.frozenDigests.length !== staged.length ||
    automationInputHash(staged.map((reference) => referenceHash(reference, plan.authorizePath))) !==
      automationInputHash(plan.frozenDigests)
  )
    throw new AutomationError('SPEND_REFERENCE_CHANGED', '参考图在授权后发生变化', 409);
  const frozen: ManagedReferenceImage[] = [];
  for (const [index, reference] of staged.entries()) {
    const digest = plan.frozenDigests[index];
    const cached = plan.uploads.get(digest);
    if (cached) {
      frozen.push(cached);
      continue;
    }
    if (reference.source !== 'upload' || !isManagedUploadPath(reference.path))
      throw new ManagedExecutionError('MANAGED_REFERENCE_NOT_STAGED');
    let bytes: Buffer;
    let mimeType: string;
    try {
      const read = await readLocalImage(reference);
      bytes = read.bytes;
      mimeType = read.image.mimeType;
    } catch (error) {
      if (error instanceof LocalImageError)
        throw new ManagedExecutionError('MANAGED_REFERENCE_READ_FAILED');
      throw error;
    }
    session.assertCurrent();
    const cloud = await session.client.uploadReferenceImage({
      name: reference.name?.trim() ? (reference.name as string) : 'reference',
      bytes,
    });
    // The server sniffed the very bytes we sent; any divergence is a corrupt reply.
    if (cloud.byteSize !== bytes.byteLength || cloud.mimeType !== mimeType)
      throw new ManagedExecutionError('MANAGED_RESPONSE_INVALID');
    const value: ManagedReferenceImage = { ...cloud, digest };
    plan.uploads.set(digest, value);
    frozen.push(value);
  }
  return frozen;
}

/** Executes one original image as its own managed cloud generation, then projects it locally. */
async function executeRunChild(
  session: Session,
  requestId: string,
  originalJobIds: string[],
  req: GenerateImageRequest,
  plan: ReferencePlan,
  model: ExecutionBinding['model'] | undefined,
  projection?: LocalRunProjection,
): Promise<GenerateImageResult> {
  const jobId = req.jobId ?? '';
  const ordinal = originalJobIds.indexOf(jobId);
  if (ordinal < 0)
    throw new AutomationError('SPEND_INPUT_CHANGED', '生图任务不在本次授权计划中', 409);
  const record = session.ledger.forRunQuery(requestId, session.client.context);
  if (
    req.model !== record.binding.model ||
    (model ?? CLOUD_GENERATION_MODEL) !== record.binding.model
  )
    throw new ManagedExecutionError('MANAGED_MODEL_MISMATCH');
  assertChildProjection(req, ordinal, projection, record.run.runKind);
  const frozenReferences = await freezeChildReferences(session, req.referenceImages ?? [], plan);
  const childInput = managedRunChildInputSchema.parse({
    prompt: req.prompt,
    ...(req.negative === undefined ? {} : { negative: req.negative }),
    size: req.size,
    ...(req.aspectRatio === undefined ? {} : { aspectRatio: req.aspectRatio }),
    quality: req.quality,
    count: 1,
    ...(model === undefined ? {} : { model }),
    ...(frozenReferences.length ? { referenceImages: frozenReferences } : {}),
  });
  try {
    await session.client.submitRunChild(requestId, ordinal, childInput, jobId, Date.now());
  } catch (error) {
    const record = session.ledger.forRunQuery(requestId, session.client.context);
    const child = record.children[ordinal];
    if (record.cancelRequestedAt !== null && child && child.submissionState === 'unclaimed')
      return { historyId: jobId, status: 'cancelled' as const };
    if (!child?.callId) throw error;
    // The durable child claim already crossed the send boundary; no status, error or lost
    // reply permits a replacement POST or a local terminal guess. Receipts decide below.
  }
  for (;;) {
    try {
      await session.client.settleRunCancellation(requestId);
      const result = await finishChildLocal(session, requestId, ordinal);
      if (result) return result;
      await session.client.reconcileRunChild(requestId, ordinal);
    } catch (error) {
      const record = session.ledger.forRunQuery(requestId, session.client.context);
      const child = record.children[ordinal];
      if (record.cancelRequestedAt !== null && child && child.submissionState === 'unclaimed')
        return { historyId: jobId, status: 'cancelled' as const };
      // Query-only setbacks (receipt/asset/network) stay in polling; anything else is a bug.
      if (!(error instanceof ManagedExecutionError) && !(error instanceof AutomationError))
        throw error;
    }
    await delay(session.signal);
  }
}

/** BYOK text rides the same single reservation; the send gate mirrors the local executor. */
function managedRunTextExecutor(
  session: Session,
  requestId: string,
  binding: AutomationPayerBinding,
) {
  const captured = captureAutomationTextConnection(binding.providerId);
  if (!captured?.secret || automationInputHash(captured.binding) !== automationInputHash(binding))
    throw new AutomationError('SPEND_IDENTITY_CHANGED', '文本模型连接或凭据已变化', 409);
  const secret = captured.secret;
  const fetchImpl: typeof fetch = async (input, init) => {
    // Read an independent Request once. The exact body is frozen before the synchronous claim.
    const outgoing = new Request(input, { ...init, redirect: 'error' });
    const body = await outgoing.clone().text();
    // Reading a streamed request body yields; cancellation here is definitely pre-send.
    outgoing.signal.throwIfAborted();
    const destination = new URL(outgoing.url);
    const expected = `${binding.baseUrl.replace(/\/$/, '')}/chat/completions`;
    if (
      outgoing.url !== expected ||
      outgoing.method !== 'POST' ||
      destination.search ||
      destination.hash
    )
      throw new AutomationError('SPEND_INPUT_CHANGED', '文本调用目标不在授权范围内', 409);
    const encoded = JSON.parse(body) as { model?: unknown; max_tokens?: unknown };
    if (
      encoded.model !== binding.model ||
      (typeof encoded.max_tokens === 'number' && encoded.max_tokens > 4_000) ||
      outgoing.headers.get('authorization') !== `Bearer ${secret.key}`
    )
      throw new AutomationError('SPEND_INPUT_CHANGED', '文本模型、调用上限或凭据不匹配', 409);
    const current = captureAutomationTextConnection(binding.providerId);
    if (!current || automationInputHash(current.binding) !== automationInputHash(binding))
      throw new AutomationError(
        'SPEND_IDENTITY_CHANGED',
        '文本模型连接或凭据在发送前发生变化',
        409,
      );
    const call = await session.ledger.claimRunTextCall(
      requestId,
      session.client.context,
      current.binding,
      { url: outgoing.url, body },
      Date.now(),
    );
    try {
      return await fetch(outgoing);
    } finally {
      // Tokens/HTTP success cannot establish a point charge. Retain unknown, even for BYOK.
      await session.ledger
        .completeRunTextCall(requestId, call.callId, call.claimId, Date.now())
        .catch(() => undefined);
    }
  };
  return { profile: captured.profile, key: secret.key, fetch: fetchImpl };
}

/** Settles the shared reservation: remaining unclaimed children die zero-cost, receipts close. */
async function settleRunToTerminal(
  session: Session,
  requestId: string,
  driverCancelled: boolean,
): Promise<AutomationSpendRequest> {
  const { getAutomationSpendRepository } = await import('../settings/automation');
  for (;;) {
    const row = getAutomationSpendRepository().get(requestId);
    if (!row) throw new ManagedExecutionError('MANAGED_REQUEST_NOT_FOUND');
    const record = session.ledger.forRunQuery(requestId, session.client.context);
    if (row.state === 'terminal') {
      for (const child of record.children) {
        if (child.callId === null) continue;
        await finishChildLocal(session, requestId, child.ordinal).catch(() => undefined);
      }
      return row;
    }
    const unclaimed = record.children.some((child) => child.callId === null);
    if ((driverCancelled || unclaimed) && record.cancelRequestedAt === null)
      await session.client.cancelRun(requestId);
    else if (record.cancelRequestedAt !== null)
      await session.client.settleRunCancellation(requestId);
    for (const child of record.children) {
      if (child.callId === null) {
        await finishChildLocal(session, requestId, child.ordinal).catch(() => undefined);
        continue;
      }
      if (!child.receipt?.terminalAt)
        await session.client.reconcileRunChild(requestId, child.ordinal).catch(() => undefined);
      await finishChildLocal(session, requestId, child.ordinal).catch(() => undefined);
    }
    await delay(session.signal);
  }
}

export interface ManagedDurableRunSpec {
  runKind: 'run_scheme' | 'run_github_skill';
  providerId: string;
  /** Explicit account model; omission preserves legacy default request hashes. */
  model?: ExecutionBinding['model'];
  /** Display/preparation expectation only; the host and API independently authorize. */
  expectedBinding?: ExecutionBinding;
  /** Trusted local history context; checked before core writes, never sent to the API. */
  localProjection?: LocalRunProjection;
  callerKey: string;
  caller: string;
  executionId: string;
  originalJobIds: string[];
  input: RegisterManagedRun['run']['input'];
  frozenRun: RegisterManagedRun['run']['frozenRun'];
  /** BYOK binding rides along; a hosted (unbound) text payer terminates registration itself. */
  textBinding: AutomationPayerBinding | null;
  consent?: 'interactive';
  authorizePath: (path: string) => boolean;
  /** One request-level confirmation card; throwing from it denies the run at zero cost. */
  authorize: (details: { confirmationId: string; confirmationExpiresAt: number }) => Promise<void>;
  /** Drives the actual R/S run with managed executors; resolves with the driver outcome. */
  drive: (tools: {
    images: {
      onReferences: (references: LocalImageReference[]) => void;
      generate: typeof generate;
    };
    text: { profile: unknown; key: string; fetch: typeof fetch } | null;
  }) => Promise<'success' | 'failed' | 'cancelled'>;
  /** Emitted once with the terminal ledger row after every child settled. */
  onTerminal: (request: AutomationSpendRequest) => void;
}

export interface ManagedDurableRunStart {
  replayed: boolean;
  request: AutomationSpendRequest;
}

/**
 * One managed session per R/S cloud run: a single run-level registration plus one
 * request-level confirmation, then each original image executes as its own child send
 * under that shared reservation. The session outlives the HTTP submit; it ends only
 * after every child settled (terminal receipt or zero-cost cancellation).
 */
export async function startManagedDurableRun(
  spec: ManagedDurableRunSpec,
): Promise<ManagedDurableRunStart> {
  const model = spec.model;
  const localProjection = spec.localProjection ? structuredClone(spec.localProjection) : undefined;
  let resolveReady: (value: ManagedDurableRunStart) => void = () => {};
  let rejectReady: (error: unknown) => void = () => {};
  const ready = new Promise<ManagedDurableRunStart>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const work = withManagedGenerationSession(async (session) => {
    const previous = managedRunByCallerKey(spec.callerKey);
    const binding = previous
      ? session.ledger.forRunQuery(previous.requestId, session.client.context).binding
      : await session.client.binding(model);
    session.assertCurrent();
    if (previous && (model ?? CLOUD_GENERATION_MODEL) !== binding.model)
      throw new ManagedExecutionError('IDEMPOTENCY_CONFLICT');
    if (!previous && readAccountCloudProvider(session.client.context)?.id !== spec.providerId)
      throw new ManagedExecutionError('MANAGED_CONNECTION_CHANGED');
    if (
      spec.expectedBinding &&
      automationInputHash(spec.expectedBinding) !== automationInputHash(binding)
    )
      throw new ManagedExecutionError('MANAGED_IDENTITY_CHANGED');
    const { getAutomationSpendRepository } = await import('../settings/automation');
    session.assertCurrent();
    getAutomationSpendRepository();
    const { record, replayed } = await session.ledger.registerRun({
      callerKey: spec.callerKey,
      caller: spec.caller,
      executionId: spec.executionId,
      binding,
      authEpoch: session.client.context.authEpoch,
      run: {
        runKind: spec.runKind,
        originalJobIds: spec.originalJobIds,
        input: spec.input,
        frozenRun: spec.frozenRun,
        textBinding: spec.textBinding,
      },
      estimatedPoints: null,
      ...(spec.consent ? { consent: spec.consent } : {}),
      now: Date.now(),
    });
    const repository = getAutomationSpendRepository();
    let request = repository.get(record.requestId);
    if (!request) throw new ManagedExecutionError('MANAGED_REQUEST_NOT_FOUND');
    if (replayed) {
      // Replay never drives or confirms; it still owes the caller the frozen plan.
      resolveReady({ replayed: true, request });
      return { replayed: true, request };
    }
    assertManagedOutcome(request);
    if (request.state === 'pending_confirmation') {
      const confirmationId = request.confirmationId;
      const deadline = request.confirmationExpiresAt;
      if (!confirmationId || deadline === null)
        throw new ManagedExecutionError('MANAGED_REQUEST_CORRUPT');
      try {
        if (Date.now() >= deadline)
          throw new AutomationError('CONFIRMATION_TIMEOUT', '本次运行确认已过期', 409);
        await spec.authorize({ confirmationId, confirmationExpiresAt: deadline });
      } catch (error) {
        await session.ledger.resolveRunConfirmation(
          record.requestId,
          session.client.context,
          false,
          Date.now(),
        );
        throw error;
      }
      if (
        !(await session.ledger.resolveRunConfirmation(
          record.requestId,
          session.client.context,
          true,
          Date.now(),
        ))
      )
        throw new AutomationError('CONFIRMATION_TIMEOUT', '本次运行确认已失效', 409);
      request = repository.get(record.requestId);
      if (!request) throw new ManagedExecutionError('MANAGED_REQUEST_NOT_FOUND');
      assertManagedOutcome(request);
    }

    const plan: ReferencePlan = {
      frozenDigests: null,
      uploads: new Map(),
      authorizePath: spec.authorizePath,
    };
    const images = {
      onReferences(references: LocalImageReference[]) {
        plan.frozenDigests = references.map((reference) =>
          referenceHash(reference, spec.authorizePath),
        );
      },
      generate: (async (input: GenerateImageRequest, progress, options) => {
        if (input.model !== undefined && input.model !== record.binding.model)
          throw new ManagedExecutionError('MANAGED_MODEL_MISMATCH');
        const ordinal = spec.originalJobIds.indexOf(input.jobId ?? '');
        if (ordinal < 0) throw new ManagedExecutionError('SPEND_INPUT_CHANGED');
        assertChildProjection(input, ordinal, localProjection, record.run.runKind);
        return generate({ ...input, model: record.binding.model }, progress, {
          ...options,
          transport: {
            providerId: spec.providerId,
            retryOfRunId: options?.retryOfRunId,
            assertCurrent() {
              session.assertCurrent();
            },
            async generate(req) {
              return executeRunChild(
                session,
                record.requestId,
                spec.originalJobIds,
                req,
                plan,
                model,
                localProjection,
              );
            },
          },
        });
      }) satisfies typeof generate,
    };
    const text =
      spec.textBinding && spec.textBinding.payerKind === 'external'
        ? managedRunTextExecutor(session, record.requestId, spec.textBinding)
        : null;

    resolveReady({ replayed: false, request });
    let driverStatus: 'success' | 'failed' | 'cancelled';
    try {
      driverStatus = await spec.drive({ images, text });
    } catch {
      // The durable rows decide everything from here; never re-drive, never resend.
      driverStatus = 'failed';
    }
    const terminalRow = await settleRunToTerminal(
      session,
      record.requestId,
      driverStatus === 'cancelled',
    );
    spec.onTerminal(terminalRow);
  });
  const settled = work.then(
    () => undefined,
    (error) => {
      rejectReady(error);
    },
  );
  active.set(spec.executionId, settled);
  void settled.finally(() => {
    if (active.get(spec.executionId) === settled) active.delete(spec.executionId);
  });
  return ready;
}

/** Request a durable cancel for a live or crashed managed run (wired to DELETE runs). */
export async function cancelManagedDurableRun(executionId: string): Promise<void> {
  const requestId = managedRunRequestForExecution(executionId);
  if (!requestId) return;
  if (active.has(executionId)) {
    // The live session observes cancelRequestedAt in its settle loop; record intent only.
    await withManagedGenerationSession(async (session) => {
      await session.ledger.requestRunCancellation(requestId, session.client.context, Date.now());
    });
    return;
  }
  await withManagedGenerationSession(async (session) => {
    session.ledger.forRunQuery(requestId, session.client.context);
    await session.client.cancelRun(requestId);
  });
}

/** Query-only resume: receipts and projections only; no child is ever claimed or sent here. */
export async function reconcileManagedDurableRun(requestId: string): Promise<void> {
  const work = withManagedGenerationSession(async (session) => {
    const record: ManagedRunRecord = session.ledger.forRunQuery(requestId, session.client.context);
    await session.guard.recoverCommittedOperation();
    const { getAutomationSpendRepository } = await import('../settings/automation');
    const row = getAutomationSpendRepository().get(requestId);
    if (row && row.state !== 'terminal') {
      // A crashed coordinator holds no send permits; remaining children die zero-cost.
      if (record.cancelRequestedAt === null)
        await session.ledger.requestRunCancellation(requestId, session.client.context, Date.now());
      await session.client.settleRunCancellation(requestId);
    }
    for (const child of record.children) {
      if (child.callId === null || child.receipt?.terminalAt) {
        await finishChildLocal(session, requestId, child.ordinal).catch(() => undefined);
        continue;
      }
      await session.client.reconcileRunChild(requestId, child.ordinal).catch(() => undefined);
      await finishChildLocal(session, requestId, child.ordinal).catch(() => undefined);
    }
  });
  await work;
}

/** Startup/replay hook: resume every non-terminal managed run in query-only mode. */
export function scheduleManagedRunReconciliation(executionId: string): void {
  if (active.has(executionId)) return;
  const requestId = managedRunRequestForExecution(executionId);
  if (requestId) void reconcileManagedDurableRun(requestId).catch(() => undefined);
}
