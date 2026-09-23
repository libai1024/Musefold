import {
  accountExecutionBindingSchema,
  accountModelCatalogSchema,
  executionBindingSchema,
  generationExecutionReceiptSchema,
  generationJobSchema,
  generationReferenceImageSchema,
  type ExecutionBinding,
  type GenerationExecutionReceipt,
  type GenerationJob,
  type GenerationAsset,
  type GenerationReferenceImage,
} from '@musefold/contracts';
import { readImagePixelSize } from '@musefold/core/providers/image-dimensions';
import { quotaToPoints } from '@musefold/domain/billing-format';
import { mimeFromHeader } from '@musefold/core/providers/local-image';
import type {
  ManagedGenerationContext,
  ManagedGenerationRecord,
  ManagedRunChildInput,
} from '@musefold/desktop-contracts/managed-generation';
import { captureDatabaseAccess, getDb } from '@musefold/core/db';
import { ManagedExecutionError } from '@musefold/core/db/repositories/managed-execution';
import { ManagedGenerationLedger } from '@musefold/core/services/managed-generation-ledger';
import { captureManagedAccountSession } from '../main/ipc-v25/account-domain';
import { withManagedExecution } from './managed-execution';

type AccountAccess = Awaited<ReturnType<typeof captureManagedAccountSession>>;
const MAX_JSON_BYTES = 1024 * 1024;
function fail(code: string): never {
  throw new ManagedExecutionError(code);
}

/**
 * Main-process-only transport. URLs and authorization are constructed here, never accepted from
 * a request, result asset URL, renderer, or the local Provider keychain. It does not enable users.
 */
export class ManagedGenerationClient {
  readonly context: ManagedGenerationContext;

  constructor(
    private readonly access: AccountAccess,
    private readonly ledger: ManagedGenerationLedger,
    private readonly scope: { signal: AbortSignal; assertCurrent(): void },
    private readonly timeoutMs = 15_000,
  ) {
    const { session } = access;
    if (session.restricted || !session.principalId || session.pendingRecovery)
      fail('MANAGED_IDENTITY_UNVERIFIED');
    this.context = {
      apiIssuer: session.apiIssuer,
      principalId: session.principalId,
      authEpoch: session.authEpoch,
    };
  }

  private assertCurrent() {
    this.scope.assertCurrent();
    this.access.assertCurrent();
    if (this.scope.signal.aborted) fail('MANAGED_OPERATION_ABORTED');
  }

  private async assertFresh() {
    this.assertCurrent();
    await this.access.assertFresh();
    this.assertCurrent();
  }

  private async json(
    path: string,
    options: { body?: unknown; key?: string; missing?: boolean } = {},
  ): Promise<unknown | null> {
    await this.assertFresh();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([this.scope.signal, timeout]);
    let response: Response;
    try {
      // No await between the final synchronous guard and starting HTTP.
      this.assertCurrent();
      response = await fetch(`${this.context.apiIssuer}${path}`, {
        method: options.body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal,
        headers: {
          authorization: `Bearer ${this.access.session.token}`,
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(options.key ? { 'idempotency-key': options.key } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      this.assertCurrent();
      fail(timeout.aborted ? 'MANAGED_SERVICE_TIMEOUT' : 'MANAGED_SERVICE_UNAVAILABLE');
    }
    try {
      await this.assertFresh();
      if (response.status === 401) {
        await this.access.invalidate();
        fail('MANAGED_AUTH_REQUIRED');
      }
      if (response.status === 404 && options.missing) return null;
      if (!response.ok)
        fail(response.status === 409 ? 'MANAGED_REMOTE_CONFLICT' : 'MANAGED_REMOTE_REJECTED');
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
        fail('MANAGED_RESPONSE_INVALID');
      const bytes = await boundedJsonBytes(response, signal);
      await this.assertFresh();
      try {
        return JSON.parse(bytes.toString('utf8'));
      } catch {
        fail('MANAGED_RESPONSE_INVALID');
      }
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  }

  async binding(model?: string): Promise<ExecutionBinding> {
    if (model !== undefined) {
      const catalog = accountModelCatalogSchema.safeParse(
        await this.json('/api/v1/account/models'),
      );
      if (!catalog.success) fail('MANAGED_RESPONSE_INVALID');
      if (
        catalog.data.identity.apiIssuer !== this.context.apiIssuer ||
        catalog.data.identity.principalId !== this.context.principalId
      )
        fail('MANAGED_IDENTITY_CHANGED');
      const selected = catalog.data.models.find((entry) => entry.model === model);
      if (!selected?.imageGeneration || selected.pricing.kind === 'unavailable')
        fail('MANAGED_MODEL_UNAVAILABLE');
      // An expectation only. API admission reads its own fresh catalog and locks identity.
      return executionBindingSchema.parse({
        ...catalog.data.identity,
        providerId: 'cloud-default',
        model,
        capabilities: { image: true, text: false },
      });
    }
    const parsed = accountExecutionBindingSchema.safeParse(
      await this.json('/api/v1/account/execution-binding'),
    );
    if (!parsed.success) fail('MANAGED_RESPONSE_INVALID');
    const available = parsed.data;
    if (available.status !== 'available') fail('MANAGED_BINDING_UNAVAILABLE');
    const { status: _status, verifiedAt: _verifiedAt, ...binding } = available;
    if (
      binding.apiIssuer !== this.context.apiIssuer ||
      binding.principalId !== this.context.principalId
    )
      fail('MANAGED_IDENTITY_CHANGED');
    return executionBindingSchema.parse(binding);
  }

  /** A per-call price is only a bounded single-image estimate, never a settled charge. */
  async automationEstimate(model: string, count: number): Promise<number | null> {
    const catalog = accountModelCatalogSchema.parse(await this.json('/api/v1/account/models'));
    if (
      catalog.identity.apiIssuer !== this.context.apiIssuer ||
      catalog.identity.principalId !== this.context.principalId
    )
      fail('MANAGED_IDENTITY_CHANGED');
    const selected = catalog.models.find((entry) => entry.model === model);
    if (!selected?.imageGeneration || selected.pricing.kind === 'unavailable')
      fail('MANAGED_MODEL_UNAVAILABLE');
    return count === 1 && selected.pricing.kind === 'per_call'
      ? quotaToPoints(selected.pricing.quotaPerCall)
      : null;
  }

  /**
   * Multipart reference upload through the account session. Runs before any ledger
   * registration, so its failures can never have consumed a paid send. The 20 MiB body
   * bound earns a longer timeout than JSON calls; URLs and authorization stay main-process-only.
   */
  async uploadReferenceImage(input: {
    name: string;
    bytes: Uint8Array;
  }): Promise<GenerationReferenceImage> {
    await this.assertFresh();
    const timeout = AbortSignal.timeout(Math.max(this.timeoutMs, 60_000));
    const signal = AbortSignal.any([this.scope.signal, timeout]);
    const form = new FormData();
    // The server sniffs magic bytes itself; the form filename is display-only.
    form.append('file', new Blob([input.bytes]), input.name);
    let response: Response;
    try {
      this.assertCurrent();
      response = await fetch(`${this.context.apiIssuer}/api/v1/reference-images`, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { authorization: `Bearer ${this.access.session.token}` },
        body: form,
      });
    } catch {
      this.assertCurrent();
      fail(timeout.aborted ? 'MANAGED_SERVICE_TIMEOUT' : 'MANAGED_REFERENCE_UPLOAD_FAILED');
    }
    try {
      await this.assertFresh();
      if (response.status === 401) {
        await this.access.invalidate();
        fail('MANAGED_AUTH_REQUIRED');
      }
      if (!response.ok) fail('MANAGED_REFERENCE_UPLOAD_FAILED');
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
        fail('MANAGED_RESPONSE_INVALID');
      const bytes = await boundedJsonBytes(response, signal);
      await this.assertFresh();
      let value: unknown;
      try {
        value = JSON.parse(bytes.toString('utf8'));
      } catch {
        fail('MANAGED_RESPONSE_INVALID');
      }
      const parsed = generationReferenceImageSchema.safeParse(value);
      if (!parsed.success) fail('MANAGED_RESPONSE_INVALID');
      return parsed.data;
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  }

  /** Best-effort retention release for uploads that never reached a registered request. */
  async releaseReferenceImage(id: string): Promise<void> {
    await this.assertFresh();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([this.scope.signal, timeout]);
    let response: Response;
    try {
      this.assertCurrent();
      response = await fetch(
        `${this.context.apiIssuer}/api/v1/reference-images/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          redirect: 'error',
          signal,
          headers: { authorization: `Bearer ${this.access.session.token}` },
        },
      );
    } catch {
      this.assertCurrent();
      return; // Temporary retention expires server-side; release is hygiene, not correctness.
    }
    try {
      await response.body?.cancel().catch(() => undefined);
    } catch {
      /* The response was fully drained or already closed. */
    }
  }

  /** Only new requests consume a live send claim; recovery never repeats a generation POST. */
  async submitInitial(
    requestId: string,
    localGenerationId: string,
    now = Date.now(),
  ): Promise<GenerationExecutionReceipt | null> {
    const currentBinding = await this.binding(
      this.ledger.forQuery(requestId, this.context).frozenRequest.model,
    );
    await this.assertFresh();
    const submission = await this.ledger.claimSubmission(
      requestId,
      this.context,
      currentBinding,
      localGenerationId,
      now,
    );
    await this.assertFresh();
    try {
      const job = generationJobSchema.safeParse(
        await this.json(
          submission.retryOf?.remoteRunId
            ? `/api/v1/generations/${encodeURIComponent(submission.retryOf.remoteRunId)}/retry`
            : '/api/v1/generations',
          {
            body: submission.retryOf?.remoteRunId
              ? { expectedBinding: submission.binding }
              : { ...submission.frozenRequest, expectedBinding: submission.binding },
            key: submission.remoteKey,
          },
        ),
      );
      if (!job.success) fail('MANAGED_RESPONSE_INVALID');
      // The POST response alone cannot close cost or release a reservation; fetch the receipt.
      const receipt = await this.reconcile(requestId, now);
      if (receipt && receipt.originalRunId !== job.data.id) fail('MANAGED_RECEIPT_MISMATCH');
      return receipt;
    } catch {
      // The durable claim already exists. No status/error permits a replacement POST here.
      fail('MANAGED_SUBMISSION_UNCERTAIN');
    }
  }

  async reconcile(requestId: string, now = Date.now()): Promise<GenerationExecutionReceipt | null> {
    const record = this.ledger.forQuery(requestId, this.context);
    const value = await this.json(
      `/api/v1/generations/receipts/by-key?key=${encodeURIComponent(record.remoteKey)}`,
      { missing: true },
    );
    if (value === null) return null; // Missing or purged lookup never becomes submit/zero cost.
    const parsed = generationExecutionReceiptSchema.safeParse(value);
    if (!parsed.success) fail('MANAGED_RESPONSE_INVALID');
    await this.assertFresh();
    await this.ledger.applyReceipt(requestId, this.context, parsed.data, now);
    // Return the monotonic stored version, not an ignored older network response.
    return this.ledger.forQuery(requestId, this.context).receipt;
  }

  async result(requestId: string): Promise<GenerationJob | null> {
    const record: ManagedGenerationRecord = this.ledger.forQuery(requestId, this.context);
    if (!record.receipt || record.receipt.purgedAt) return null;
    const value = await this.json(
      `/api/v1/generations/${encodeURIComponent(record.receipt.originalRunId)}`,
      { missing: true },
    );
    if (value === null) return null;
    const parsed = generationJobSchema.safeParse(value);
    if (!parsed.success || parsed.data.id !== record.receipt.originalRunId)
      fail('MANAGED_RESPONSE_INVALID');
    return parsed.data;
  }

  /** Cancellation intent is durable even if lookup or the idempotent cancel POST is interrupted. */
  async cancel(requestId: string): Promise<void> {
    await this.ledger.requestCancellation(requestId, this.context, Date.now());
    await this.continueCancellation(requestId);
  }

  async continueCancellation(requestId: string): Promise<void> {
    const record = this.ledger.forQuery(requestId, this.context);
    if (
      record.cancelRequestedAt === null ||
      record.cancelAcknowledgedAt !== null ||
      record.submissionState === 'unclaimed'
    )
      return;
    const receipt = await this.reconcile(requestId);
    if (!receipt || receipt.terminalAt || receipt.purgedAt) return;
    const job = generationJobSchema.safeParse(
      await this.json(`/api/v1/generations/${encodeURIComponent(receipt.originalRunId)}/cancel`, {
        body: {},
      }),
    );
    if (!job.success || job.data.id !== receipt.originalRunId) fail('MANAGED_RESPONSE_INVALID');
    await this.assertFresh();
    await this.ledger.acknowledgeCancellation(requestId, this.context, Date.now());
    await this.reconcile(requestId);
  }

  /** Downloads an asset from the owned run through the issuer's authenticated content route. */
  async asset(
    requestId: string,
    assetId: string,
  ): Promise<{ bytes: Buffer; asset: GenerationAsset }> {
    const job = await this.result(requestId);
    const asset = job?.assets.find((item) => item.id === assetId);
    if (!asset) fail('MANAGED_ASSET_UNAVAILABLE');
    return this.fetchAssetContent(asset);
  }

  // ---- R/S run children: exactly one idempotent remote send per original job ----

  /** Claims one child and POSTs once with the child's own Idempotency-Key. */
  async submitRunChild(
    requestId: string,
    ordinal: number,
    childInput: ManagedRunChildInput,
    localGenerationId: string,
    now = Date.now(),
  ): Promise<GenerationExecutionReceipt | null> {
    const currentBinding = await this.binding(childInput.model);
    await this.assertFresh();
    const { child } = await this.ledger.claimRunChild(
      requestId,
      ordinal,
      this.context,
      currentBinding,
      childInput,
      localGenerationId,
      now,
    );
    await this.assertFresh();
    try {
      const record = this.ledger.forRunQuery(requestId, this.context);
      const job = generationJobSchema.safeParse(
        await this.json('/api/v1/generations', {
          body: { ...childInput, expectedBinding: record.binding },
          key: child.remoteKey,
        }),
      );
      if (!job.success) fail('MANAGED_RESPONSE_INVALID');
      // The POST response alone cannot close cost or release the shared reservation.
      const receipt = await this.reconcileRunChild(requestId, ordinal, now);
      if (receipt && receipt.originalRunId !== job.data.id) fail('MANAGED_RECEIPT_MISMATCH');
      return receipt;
    } catch {
      // The durable child claim already exists. No status/error permits a replacement POST.
      fail('MANAGED_SUBMISSION_UNCERTAIN');
    }
  }

  async reconcileRunChild(
    requestId: string,
    ordinal: number,
    now = Date.now(),
  ): Promise<GenerationExecutionReceipt | null> {
    const record = this.ledger.forRunQuery(requestId, this.context);
    const child = record.children[ordinal] ?? fail('MANAGED_REQUEST_NOT_FOUND');
    const value = await this.json(
      `/api/v1/generations/receipts/by-key?key=${encodeURIComponent(child.remoteKey)}`,
      { missing: true },
    );
    if (value === null) return null; // Missing or purged lookup never becomes submit/zero cost.
    const parsed = generationExecutionReceiptSchema.safeParse(value);
    if (!parsed.success) fail('MANAGED_RESPONSE_INVALID');
    await this.assertFresh();
    await this.ledger.applyRunChildReceipt(requestId, ordinal, this.context, parsed.data, now);
    // Return the monotonic stored version, not an ignored older network response.
    return this.ledger.forRunQuery(requestId, this.context).children[ordinal]?.receipt ?? null;
  }

  async runChildResult(requestId: string, ordinal: number): Promise<GenerationJob | null> {
    const record = this.ledger.forRunQuery(requestId, this.context);
    const child = record.children[ordinal] ?? fail('MANAGED_REQUEST_NOT_FOUND');
    if (!child.receipt || child.receipt.purgedAt) return null;
    const value = await this.json(
      `/api/v1/generations/${encodeURIComponent(child.receipt.originalRunId)}`,
      { missing: true },
    );
    if (value === null) return null;
    const parsed = generationJobSchema.safeParse(value);
    if (!parsed.success || parsed.data.id !== child.receipt.originalRunId)
      fail('MANAGED_RESPONSE_INVALID');
    return parsed.data;
  }

  async runChildAsset(
    requestId: string,
    ordinal: number,
    assetId: string,
  ): Promise<{ bytes: Buffer; asset: GenerationAsset }> {
    const job = await this.runChildResult(requestId, ordinal);
    const asset = job?.assets.find((item) => item.id === assetId);
    if (!asset) fail('MANAGED_ASSET_UNAVAILABLE');
    return this.fetchAssetContent(asset);
  }

  /** Durable cancel intent for the whole run, then one settlement pass over the children. */
  async cancelRun(requestId: string): Promise<void> {
    await this.ledger.requestRunCancellation(requestId, this.context, Date.now());
    await this.settleRunCancellation(requestId);
  }

  /**
   * One idempotent pass: never-claimed children acknowledge at zero cost; claimed
   * non-terminal children reconcile first and only then receive the cancel POST.
   */
  async settleRunCancellation(requestId: string): Promise<void> {
    const record = this.ledger.forRunQuery(requestId, this.context);
    if (record.cancelRequestedAt === null) return;
    for (const child of record.children) {
      if (child.callId === null) {
        if (child.cancelAcknowledgedAt === null)
          await this.ledger.acknowledgeRunChildCancellation(
            requestId,
            child.ordinal,
            this.context,
            Date.now(),
          );
        continue;
      }
      const receipt = child.receipt;
      if (!receipt || receipt.terminalAt || receipt.purgedAt) continue;
      const current = await this.reconcileRunChild(requestId, child.ordinal);
      if (!current || current.terminalAt || current.purgedAt) continue;
      const job = generationJobSchema.safeParse(
        await this.json(`/api/v1/generations/${encodeURIComponent(current.originalRunId)}/cancel`, {
          body: {},
        }),
      );
      if (!job.success || job.data.id !== current.originalRunId) fail('MANAGED_RESPONSE_INVALID');
      await this.assertFresh();
      await this.reconcileRunChild(requestId, child.ordinal);
    }
  }

  private async fetchAssetContent(
    asset: GenerationAsset,
  ): Promise<{ bytes: Buffer; asset: GenerationAsset }> {
    await this.assertFresh();
    const signal = AbortSignal.any([this.scope.signal, AbortSignal.timeout(this.timeoutMs)]);
    let response: Response;
    try {
      this.assertCurrent();
      response = await fetch(
        `${this.context.apiIssuer}/api/v1/assets/${encodeURIComponent(asset.id)}/content`,
        {
          method: 'GET',
          redirect: 'error',
          signal,
          headers: { authorization: `Bearer ${this.access.session.token}` },
        },
      );
    } catch {
      this.assertCurrent();
      fail('MANAGED_ASSET_UNAVAILABLE');
    }
    try {
      await this.assertFresh();
      if (response.status === 401) {
        await this.access.invalidate();
        fail('MANAGED_AUTH_REQUIRED');
      }
      if (
        !response.ok ||
        response.headers.get('content-type')?.split(';')[0].trim() !== asset.mimeType
      )
        fail('MANAGED_ASSET_UNAVAILABLE');
      const bytes = await boundedJsonBytes(response, signal, 30 * 1024 * 1024);
      await this.assertFresh();
      const dimensions = readImagePixelSize(bytes);
      if (
        bytes.length !== asset.byteSize ||
        mimeFromHeader(bytes) !== asset.mimeType ||
        dimensions?.width !== asset.width ||
        dimensions.height !== asset.height
      )
        fail('MANAGED_ASSET_INVALID');
      return { bytes, asset };
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  }
}

async function boundedJsonBytes(
  response: Response,
  signal: AbortSignal,
  maximum = MAX_JSON_BYTES,
): Promise<Buffer> {
  if (!response.body) fail('MANAGED_RESPONSE_INVALID');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum))
    fail('MANAGED_RESPONSE_TOO_LARGE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) fail('MANAGED_SERVICE_TIMEOUT');
      const { done, value } = await reader.read();
      if (signal.aborted) fail('MANAGED_SERVICE_TIMEOUT');
      if (done) return Buffer.concat(chunks, length);
      length += value.length;
      if (length > maximum) fail('MANAGED_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ManagedExecutionError) throw error;
    fail('MANAGED_RESPONSE_INVALID');
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** One live preparation/confirmation/submission flow. Retained objects expire when it returns. */
export function withManagedGenerationSession<T>(
  work: (session: {
    client: ManagedGenerationClient;
    ledger: ManagedGenerationLedger;
    signal: AbortSignal;
    guard: import('@musefold/core/services/managed-execution-guard').ManagedExecutionGuard;
    assertCurrent(): void;
  }) => Promise<T>,
  exclusive = false,
): Promise<T> {
  return withManagedExecution(async (scope) => {
    const account = await captureManagedAccountSession();
    const assertDb = captureDatabaseAccess();
    let open = true;
    const assertCurrent = () => {
      if (!open) fail('MANAGED_SESSION_CLOSED');
      scope.assertCurrent();
      assertDb();
      account.assertCurrent();
      if (scope.signal.aborted) fail('MANAGED_OPERATION_ABORTED');
    };
    const ledger = new ManagedGenerationLedger(getDb(), scope.guard, assertCurrent);
    const client = new ManagedGenerationClient(account, ledger, {
      signal: scope.signal,
      assertCurrent,
    });
    try {
      return await work({
        client,
        ledger,
        signal: scope.signal,
        guard: scope.guard,
        assertCurrent,
      });
    } finally {
      open = false;
    }
  }, exclusive);
}
