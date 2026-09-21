import { AutomationError } from '@musefold/automation-server';
import { getDb } from '@musefold/core/db/index';
import { automationInputHash } from '@musefold/core/db/repositories/automation-spend';
import type { AutomationSpendAction } from '@musefold/contracts';
import {
  automationPayerBindingSchema,
  type AutomationPayerBinding,
  type AutomationSpendRequest,
  type RegisterAutomationSpend,
} from '@musefold/desktop-contracts/automation-spend';
import { getAiConnectionStore } from '../ai/connection-store';
import { getAutomationSpendRepository } from '../settings/automation';
import { generate } from './generation-facade';
import {
  automationRuntimeEpoch,
  createDesktopImageExecution,
  jsonRecord,
  readDesktopSpendBinding,
  referenceHash,
} from './automation-spend';

export function captureAutomationTextConnection(id?: string) {
  const connections = getAiConnectionStore();
  const profile = id
    ? connections.get(id)
    : (connections.list().find((item) => item.isActive && item.hasKey) ??
      connections.list().find((item) => item.hasKey));
  if (!profile) return null;
  const secret = connections.loadKeySnapshot(profile.id);
  const managed = profile.managedBy === 'account';
  const binding = automationPayerBindingSchema.parse({
    providerId: profile.id,
    providerType: 'openai-compatible-text',
    model: profile.model,
    baseUrl: profile.baseUrl,
    credentialEpoch: secret?.epoch ?? null,
    payerKind: !secret || managed ? 'unbound' : 'external',
    ownerId: null,
    issuer: null,
    policy: managed ? 'managed' : 'external',
  });
  return { profile: { ...profile, keySuffix: null }, secret, binding };
}

function assertOutcome(request: AutomationSpendRequest) {
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

/** All three local entrypoints share the same physical DB scope, policy and call ledger. */
export function createDesktopExternalSpend(authorizePath: (path: string) => boolean) {
  const repository = getAutomationSpendRepository();
  const db = getDb();
  const service = {
    repository,
    binding: readDesktopSpendBinding,
    replay(action: AutomationSpendAction, input: unknown, key: string | undefined) {
      const previous = key ? repository.findByKey(key) : null;
      if (!previous) return null;
      if (previous.inputHash !== automationInputHash({ action, input: jsonRecord(input) }))
        throw new AutomationError('IDEMPOTENCY_CONFLICT', '同一请求键的入口与输入已冻结', 409);
      assertOutcome(previous);
      return previous;
    },
    register(command: RegisterAutomationSpend) {
      const request = repository.register(command).request;
      assertOutcome(request);
      return request;
    },
    async authorize(
      request: AutomationSpendRequest,
      ask: (details: { confirmationId: string; confirmationExpiresAt: number }) => Promise<void>,
    ) {
      if (request.state !== 'pending_confirmation') return;
      const id = request.confirmationId;
      const deadline = request.confirmationExpiresAt;
      if (!id || deadline === null) throw new Error('Pending request missing confirmation');
      try {
        if (Date.now() >= deadline)
          throw new AutomationError('CONFIRMATION_TIMEOUT', '本次运行确认已过期', 409);
        await ask({ confirmationId: id, confirmationExpiresAt: deadline });
      } catch (error) {
        repository.resolveConfirmation(id, false, Date.now());
        throw error;
      }
      if (!repository.resolveConfirmation(id, true, Date.now()))
        throw new AutomationError('CONFIRMATION_TIMEOUT', '本次运行确认已失效', 409);
    },
    payload(request: AutomationSpendRequest) {
      const calls = repository.calls(request.id);
      const assets = calls.flatMap((call) =>
        call.generationRunId
          ? (db
              .prepare(
                `SELECT media_path AS path FROM generated_assets WHERE run_id = ? AND status = 'available' AND media_path IS NOT NULL ORDER BY position`,
              )
              .all(call.generationRunId) as Array<{ path: string }>)
          : [],
      );
      const terminal = request.state === 'terminal';
      return {
        jobId: request.executionId,
        kind: request.action === 'run_scheme' ? ('scheme' as const) : ('skill' as const),
        status: !terminal
          ? 'running'
          : request.outcome === 'success'
            ? 'success'
            : request.outcome === 'cancelled'
              ? 'cancelled'
              : 'failed',
        startedAt: request.authorizedAt ?? request.createdAt,
        assets,
        costPoints:
          calls.length && calls.every((call) => call.reportedPoints !== null)
            ? calls.reduce((sum, call) => sum + (call.reportedPoints ?? 0), 0)
            : null,
        stepSummaries: [],
        ...(typeof request.frozenInput.runId === 'string'
          ? { runId: request.frozenInput.runId }
          : {}),
        ...(terminal && request.outcome !== 'success'
          ? {
              error: {
                code:
                  request.errorCode ??
                  (calls.some((call) => call.state === 'unknown')
                    ? 'SPEND_RECONCILIATION_REQUIRED'
                    : 'INTERRUPTED'),
                message: '本次执行已结束或中断，不会自动重发；已发送但未核实的费用仍待核对',
              },
            }
          : {}),
      };
    },
    imageExecutor(request: AutomationSpendRequest, jobIds: string[]) {
      let referenceHashes: string[] = [];
      return {
        onReferences(references: Parameters<typeof referenceHash>[0][]) {
          referenceHashes = references.map((reference) => referenceHash(reference, authorizePath));
        },
        generate: ((input, progress, options) => {
          const ordinal = jobIds.indexOf(input.jobId ?? '');
          if (ordinal < 0)
            throw new AutomationError('SPEND_INPUT_CHANGED', '生图任务不在本次授权计划中', 409);
          return generate(input, progress, {
            ...options,
            execution: createDesktopImageExecution(
              request,
              ordinal,
              referenceHashes,
              jobIds[ordinal],
            ),
          });
        }) satisfies typeof generate,
      };
    },
    textExecutor(request: AutomationSpendRequest, binding: AutomationPayerBinding) {
      const captured = captureAutomationTextConnection(binding.providerId);
      if (
        !captured?.secret ||
        automationInputHash(captured.binding) !== automationInputHash(binding)
      )
        throw new AutomationError('SPEND_IDENTITY_CHANGED', '文本模型连接或凭据已变化', 409);
      const secret = captured.secret;
      let ordinal = request.maxImageCalls;
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
        const call = repository.prepareCall({
          requestId: request.id,
          ordinal: ordinal++,
          kind: 'text',
          binding,
          input: { url: outgoing.url, body },
          generationRunId: null,
        });
        const claim = repository.claimCall(
          call.id,
          current.binding,
          automationRuntimeEpoch,
          Date.now(),
        );
        if (!claim?.claimId)
          throw new AutomationError('SPEND_ALREADY_DISPATCHED', '文本调用已发送', 409);
        try {
          return await fetch(outgoing);
        } finally {
          // Tokens/HTTP success cannot establish a point charge. Retain unknown, even for BYOK.
          repository.completeCall(
            call.id,
            claim.claimId,
            { reportedPoints: null, source: 'unknown', evidenceRef: null },
            Date.now(),
          );
        }
      };
      return { profile: captured.profile, key: secret.key, fetch: fetchImpl };
    },
  };
  return service;
}

export type DesktopExternalSpend = ReturnType<typeof createDesktopExternalSpend>;
