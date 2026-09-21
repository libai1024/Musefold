import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { ulid } from 'ulid';
import { z } from 'zod';
import { AutomationError, type GenerationPersistence } from '@musefold/automation-server';
import { getDb } from '@musefold/core/db/index';
import {
  AutomationSpendError,
  automationInputHash,
} from '@musefold/core/db/repositories/automation-spend';
import { createWorkbenchRepositories } from '@musefold/core/db/repositories/workbench';
import { needsManagedSpendCoordinator } from '@musefold/core/db/repositories/managed-spend-scope';
import type { GenerationExecution } from '@musefold/core/providers/execution';
import { MAX_LOCAL_IMAGE_BYTES } from '@musefold/core/providers/local-image';
import {
  automationPayerBindingSchema,
  type AutomationSpendRequest,
} from '@musefold/desktop-contracts/automation-spend';
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageGenerationProgress,
  LocalImageReference,
} from '@musefold/desktop-contracts/providers';
import { loadApiKeySnapshot } from '../security/keychain';
import { createLogger } from '../system/logger';
import { getAutomationSpendRepository } from '../settings/automation';
import { getMusefoldCore } from './core-instance';
import type { LocalUploadOwner } from '@musefold/core/services/local-upload-owner';

export const automationRuntimeEpoch = randomUUID();
const recoveredConnections = new WeakSet<object>();
const logger = createLogger('automation-spend');

const providerRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  model: z.string(),
  base_url: z.string(),
  managed_by: z.string().nullable(),
});

function safeError(error: unknown): never {
  if (error instanceof AutomationSpendError)
    throw new AutomationError(error.code, error.message, 409);
  throw error;
}

/** Binds actual provider/key configuration without pretending the v25 login owns a legacy key. */
export function readDesktopSpendBinding(providerId: string, model?: string) {
  const row = providerRowSchema.parse(
    getDb()
      .prepare('SELECT id, name, type, model, base_url, managed_by FROM providers WHERE id = ?')
      .get(providerId),
  );
  const secret = loadApiKeySnapshot(providerId);
  const managed = row.managed_by === 'account';
  return {
    row,
    secret,
    binding: automationPayerBindingSchema.parse({
      providerId: row.id,
      providerType: row.type,
      model: model ?? row.model,
      baseUrl: row.base_url,
      credentialEpoch: secret?.epoch ?? null,
      // Legacy managed providers have no verified owner binding. An explicit confirmation
      // cannot invent it; the repository records PAYMENT_IDENTITY_UNBOUND without sending.
      payerKind: !secret || managed ? 'unbound' : 'external',
      ownerId: null,
      issuer: null,
      policy: managed ? 'managed' : 'external',
    }),
  };
}

export function referenceHash(
  reference: LocalImageReference,
  authorize: (path: string) => boolean,
): string {
  let descriptor: number | undefined;
  const close = () => {
    const current = descriptor;
    descriptor = undefined;
    if (current !== undefined) closeSync(current);
  };
  try {
    const canonicalPath = realpathSync(reference.path);
    const before = lstatSync(canonicalPath, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_LOCAL_IMAGE_BYTES))
      throw new AutomationError('IMAGE_TOO_LARGE', '参考图不是可用图片或超过大小限制', 422);
    if (!authorize(canonicalPath))
      throw new AutomationError('PATH_NOT_ALLOWED', '参考图不在受管目录', 403);
    descriptor = openSync(
      canonicalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const same = (value: typeof before) =>
      value.isFile() &&
      value.dev === before.dev &&
      value.ino === before.ino &&
      value.size === before.size &&
      value.mtimeNs === before.mtimeNs &&
      value.ctimeNs === before.ctimeNs;
    const changed = () => new AutomationError('IMAGE_READ_FAILED', '参考图已变化，请重新上传', 422);
    if (!same(fstatSync(descriptor, { bigint: true }))) throw changed();
    const limit = Number(before.size) + 1;
    const bytes = Buffer.alloc(Math.min(limit, 64 * 1024));
    const digest = createHash('sha256');
    let offset = 0;
    while (offset < limit) {
      const count = readSync(descriptor, bytes, 0, Math.min(bytes.length, limit - offset), offset);
      if (count === 0) break;
      digest.update(bytes.subarray(0, count));
      offset += count;
    }
    if (
      offset !== Number(before.size) ||
      !same(fstatSync(descriptor, { bigint: true })) ||
      realpathSync(reference.path) !== canonicalPath ||
      !same(lstatSync(canonicalPath, { bigint: true }))
    )
      throw changed();
    close();
    return digest.digest('hex');
  } catch (error) {
    try {
      close();
    } catch {
      /* Preserve the first validation/IO failure. */
    }
    if (error instanceof AutomationError) throw error;
    throw new AutomationError('IMAGE_READ_FAILED', '参考图读取失败，请重新上传', 422);
  }
}

export function jsonRecord(value: unknown) {
  return z.record(z.string(), z.json()).parse(JSON.parse(JSON.stringify(value)));
}

/**
 * 终态请求归还其冻结 references 的控制面持有（显式释放的内部形态，D02.6）。
 * release 幂等且按 owner 隔离：未持有/他窗口持有的路径是纯 no-op；
 * 是否真删仍由清理器的冻结/在途引用复查裁决。失败只延迟到期限回收或停机 close，
 * 不影响已落库的终态。
 */
export function releaseTerminalReferences(
  uploadOwner: LocalUploadOwner,
  request: AutomationSpendRequest,
): void {
  try {
    const references = request.frozenInput.references;
    if (!Array.isArray(references)) return;
    const paths: string[] = [];
    for (const reference of references) {
      if (reference && typeof reference === 'object' && !Array.isArray(reference)) {
        const path = (reference as Record<string, unknown>).path;
        if (typeof path === 'string') paths.push(path);
      }
    }
    if (paths.length) uploadOwner.release(paths);
  } catch {
    logger.warn('终态参考图归还未完成，等待期限回收');
  }
}

export function createDesktopGenerationPersistence(
  authorize: (path: string) => boolean,
  hooks: { onTerminal?: (request: AutomationSpendRequest) => void } = {},
) {
  const db = getDb();
  const repository = getAutomationSpendRepository();
  if (!recoveredConnections.has(db)) {
    // A crash can occur after the canonical generation result committed but before the gate
    // finishes its audit. Only a persisted terminal result can close that window safely.
    const unfinished = db
      .prepare(
        `SELECT id FROM automation_spend_requests WHERE action = 'generate_image' AND state IN ('authorized', 'running')
        AND NOT EXISTS (SELECT 1 FROM managed_generation_requests m WHERE m.request_id = automation_spend_requests.id)`,
      )
      .all() as Array<{ id: string }>;
    for (const row of unfinished) {
      const request = repository.get(row.id);
      if (!request) continue;
      if (needsManagedSpendCoordinator(db, request.id)) continue;
      const run = createWorkbenchRepositories(db).runs.get(request.executionId);
      if (run?.status === 'success') repository.finishRequest(request.id, 'success', Date.now());
      else if (run?.status === 'cancelled')
        repository.finishRequest(request.id, 'cancelled', Date.now());
      else if (run?.status === 'failed' && run.errorCode !== 'INTERRUPTED')
        repository.finishRequest(request.id, 'failed', Date.now());
    }
    repository.recover(automationRuntimeEpoch, Date.now());
    recoveredConnections.add(db);
  }
  const persistence: GenerationPersistence = {
    replay(body, key) {
      const existing = repository.findByKey(key);
      if (!existing) return null;
      if (
        existing.inputHash !==
        automationInputHash({ action: 'generate_image', input: jsonRecord(body) })
      )
        throw new AutomationError('IDEMPOTENCY_CONFLICT', '同一请求键的输入已冻结', 409);
      return existing;
    },
    register(body, estimate, references, key, now) {
      const selected = db
        .prepare('SELECT type FROM providers WHERE id = ?')
        .get(estimate.providerId) as { type: string } | undefined;
      if (selected?.type === 'doubao-web') return null;
      const captured = readDesktopSpendBinding(estimate.providerId, estimate.model);
      const hashes = references.map((reference) => referenceHash(reference, authorize));
      try {
        return repository.register({
          idempotencyKey: key,
          action: 'generate_image',
          caller: 'local-automation',
          input: jsonRecord(body),
          frozenInput: jsonRecord({
            body,
            providerId: estimate.providerId,
            model: estimate.model,
            references,
            referenceHashes: hashes,
          }),
          bindings: [captured.binding],
          promptText: body.prompt ?? null,
          executionId: ulid(),
          maxImageCalls: 1,
          maxTextCalls: 0,
          estimatedPoints: estimate.points,
          ...(body.declaredBudgetPoints === undefined
            ? {}
            : { declaredBudgetPoints: body.declaredBudgetPoints }),
          ...(body.consent ? { consent: body.consent } : {}),
          now,
        }).request;
      } catch (error) {
        return safeError(error);
      }
    },
    get: (jobId) => repository.findByExecutionId(jobId),
    result(request): GenerateImageResult | undefined {
      if (request.state !== 'terminal') return undefined;
      const run = createWorkbenchRepositories(db).runs.get(request.executionId);
      const calls = repository.calls(request.id);
      const hasUnknownCall = calls.some((call) => call.state === 'unknown');
      const cost =
        calls.length > 0 && calls.every((call) => call.reportedPoints !== null)
          ? calls.reduce((sum, call) => sum + (call.reportedPoints ?? 0), 0)
          : null;
      const status =
        request.outcome === 'success'
          ? 'success'
          : request.outcome === 'cancelled'
            ? 'cancelled'
            : 'failed';
      const assets =
        status === 'success'
          ? (db
              .prepare(
                `SELECT media_path FROM generated_assets WHERE run_id = ? AND status = 'available' AND media_path IS NOT NULL ORDER BY position`,
              )
              .all(request.executionId) as Array<{ media_path: string }>)
          : [];
      return {
        historyId: request.executionId,
        status,
        ...(cost === null ? {} : { cost, costPoints: cost }),
        costUnit: 'point',
        ...(assets.length
          ? {
              imagePath: assets[0].media_path,
              images: assets.map((asset) => ({ imagePath: asset.media_path })),
            }
          : {}),
        ...(run?.durationMs == null ? {} : { durationMs: run.durationMs }),
        ...(status === 'success'
          ? {}
          : {
              error: {
                code:
                  request.errorCode ??
                  (hasUnknownCall
                    ? 'SPEND_RECONCILIATION_REQUIRED'
                    : (run?.errorCode ?? 'INTERRUPTED')),
                message: hasUnknownCall
                  ? '上次请求已进入发送阶段，费用待核对，不会自动重发'
                  : (run?.errorMessage ?? '上次执行已结束或中断；新的尝试需要新的请求键'),
              },
            }),
      };
    },
    begin: (requestId) => repository.beginExecution(requestId),
    confirm: (confirmationId, approved, now) =>
      repository.resolveConfirmation(confirmationId, approved, now),
    finish: (requestId, result, now) => {
      const terminal = repository.finishRequest(requestId, result.status, now);
      // The durable terminal commit already won; a failed host release hook must not
      // turn a finished execution into a gate-level failure. TTL/close remain the fallback.
      try {
        hooks.onTerminal?.(terminal);
      } catch (error) {
        logger.warn('终态参考图归还未完成，等待期限回收', error);
      }
    },
  };

  return {
    persistence,
    run(
      req: GenerateImageRequest,
      onProgress: (progress: ImageGenerationProgress) => void,
      request: AutomationSpendRequest,
    ) {
      return getMusefoldCore().generation.generate(req, onProgress, {
        execution: createDesktopImageExecution(
          request,
          0,
          z.array(z.string()).parse(request.frozenInput.referenceHashes),
          request.executionId,
        ),
      });
    },
  };
}

/** One durable Provider send. The same ordinal/job cannot be claimed twice, including retry paths. */
export function createDesktopImageExecution(
  request: AutomationSpendRequest,
  ordinal: number,
  expectedHashes: string[],
  generationRunId: string,
): GenerationExecution {
  const repository = getAutomationSpendRepository();
  const binding = request.bindings[0];
  const captured = readDesktopSpendBinding(binding.providerId, binding.model);
  if (!captured.secret || automationInputHash(captured.binding) !== automationInputHash(binding)) {
    throw new AutomationError(
      'SPEND_IDENTITY_CHANGED',
      '连接或凭据已变化，原确认不能用于新的付款身份',
      409,
    );
  }
  let claim: { callId: string; claimId: string } | null = null;

  return {
    apiKey: captured.secret.key,
    binding,
    beforeDispatch(info) {
      const current = readDesktopSpendBinding(binding.providerId, binding.model);
      if (automationInputHash(current.binding) !== automationInputHash(binding))
        throw new AutomationSpendError(
          'SPEND_IDENTITY_CHANGED',
          'Provider or credentials changed before dispatch',
        );
      if (automationInputHash(info.referenceHashes) !== automationInputHash(expectedHashes))
        throw new AutomationSpendError(
          'SPEND_REFERENCE_CHANGED',
          'Reference image bytes changed after authorization',
        );
      const call = repository.prepareCall({
        requestId: request.id,
        ordinal,
        kind: 'image',
        binding,
        input: jsonRecord({ ...info.request, referenceImages: info.referenceHashes }),
        generationRunId,
      });
      const acquired = repository.claimCall(
        call.id,
        current.binding,
        automationRuntimeEpoch,
        Date.now(),
      );
      if (!acquired?.claimId)
        throw new AutomationSpendError(
          'SPEND_ALREADY_DISPATCHED',
          'This request has already crossed the send boundary',
        );
      claim = { callId: call.id, claimId: acquired.claimId };
    },
    onCost(evidence) {
      if (claim) repository.completeCall(claim.callId, claim.claimId, evidence, Date.now());
    },
  };
}
