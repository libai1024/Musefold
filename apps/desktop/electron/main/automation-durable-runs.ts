import { ulid } from 'ulid';
import { z } from 'zod';
import {
  AutomationError,
  type AutomationRouteHandler,
  type AutomationRouteContext,
} from '@musefold/automation-server';
import type { EventHub } from '@musefold/core';
import { getDb } from '@musefold/core/db/index';
import { getDesignSchemeDb } from '@musefold/core/db/design-scheme';
import { automationInputHash } from '@musefold/core/db/repositories/automation-spend';
import type { AutomationSpendRequest } from '@musefold/desktop-contracts/automation-spend';
import type { GenerateImageRequest } from '@musefold/desktop-contracts/providers';
import { resolveRatioOptionById } from '@musefold/domain/constants';
import { estimateProviderCost } from '../settings/pricing';
import { getMusefoldCore } from './core-instance';
import { runDesignScheme } from './design-scheme/run-session';
import {
  cancelSkillRuntimeExecution,
  executeSkillRuntime,
  prepareGithubSkillRuntime,
  skillRuntimeSourceDigest,
} from './ipc/skill-runtime';
import {
  captureAutomationTextConnection,
  createDesktopExternalSpend,
} from './automation-run-spend';
import { jsonRecord } from './automation-spend';
import { readSessionCredentials } from './ipc-v25/account-session-store';
import {
  cancelManagedDurableRun,
  managedRunByCallerKey,
  readTerminalManagedRunReplay,
  scheduleManagedRunReconciliation,
  startManagedDurableRun,
} from '../system/managed-run-runtime';
import { ManagedExecutionError } from '@musefold/core/db/repositories/managed-execution';

/**
 * A verified account session is the precondition for a managed cloud R/S run. Anything
 * else (logged out, restricted, pending recovery, unreadable store) keeps the legacy
 * register path, which bounded-rejects an account-managed payer at 0 sends with a
 * durable PAYMENT_IDENTITY_UNBOUND row — the registered negative constraint.
 */
async function verifiedAccountSessionAvailable(): Promise<boolean> {
  try {
    const session = await readSessionCredentials();
    return Boolean(
      session && !session.restricted && session.principalId && !session.pendingRecovery,
    );
  } catch {
    return false;
  }
}

type Authorize = (summary: {
  providerName: string;
  model: string;
  n: number;
  estimatedPoints: number | null;
  managedByAccount: boolean;
  promptPreview: string;
  confirmationId?: string;
  confirmationExpiresAt?: number;
}) => Promise<void>;

const bodySchema = z.object({
  n: z.number().int().min(1).max(4).default(1),
  providerId: z.string().optional(),
  ratioId: z.string().optional(),
  consent: z.literal('interactive').optional(),
  inputs: z.record(z.string(), z.string()).default({}),
  brief: z.string().default(''),
  priorityMode: z.enum(['scheme_first', 'user_first', 'agent_mediated']).optional(),
  url: z.string().optional(),
  prompt: z.string().optional(),
});

/** Decorates only local non-doubao Agent runs; the frozen host and ordinary UI keep their paths. */
export function wrapDurableExternalRunRoutes(
  legacy: Record<string, AutomationRouteHandler>,
  hub: Pick<EventHub, 'sink'>,
  authorize: Authorize,
  authorizePath: (path: string) => boolean,
): Record<string, AutomationRouteHandler> {
  const spend = createDesktopExternalSpend(authorizePath);
  const active = new Map<
    string,
    { controller: AbortController; jobIds: string[]; steps: string[] }
  >();
  const submissions = new Map<string, { hash: string; promise: Promise<unknown> }>();
  const payload = (request: AutomationSpendRequest) => {
    // Managed R/S runs freeze runId inside the run association record, not frozenInput.
    const runRow = getDb()
      .prepare('SELECT record_json FROM managed_run_requests WHERE request_id = ?')
      .get(request.id) as { record_json: string } | undefined;
    const managedRunId = runRow
      ? (JSON.parse(runRow.record_json) as { run?: { frozenRun?: { runId?: unknown } } }).run
          ?.frozenRun?.runId
      : undefined;
    return {
      ...spend.payload(request),
      stepSummaries: active.get(request.executionId)?.steps.slice(-12) ?? [],
      ...(typeof managedRunId === 'string' ? { runId: managedRunId } : {}),
    };
  };
  const terminalEvent = (
    request: AutomationSpendRequest,
    status: 'success' | 'failed' | 'cancelled',
  ) =>
    request.action === 'run_scheme'
      ? status === 'success'
        ? 'scheme.run.completed'
        : 'scheme.run.failed'
      : status === 'success'
        ? 'skill.runtime.completed'
        : 'skill.runtime.failed';
  const finish = (request: AutomationSpendRequest, status: 'success' | 'failed' | 'cancelled') => {
    const terminal = spend.repository.finishRequest(request.id, status, Date.now());
    const result = payload(terminal);
    hub.sink.emit({ type: terminalEvent(terminal, status), payload: result });
    active.delete(request.executionId);
  };

  async function submit(
    context: AutomationRouteContext,
    kind: 'scheme' | 'skill',
    fallback: AutomationRouteHandler,
  ) {
    const action = kind === 'scheme' ? ('run_scheme' as const) : ('run_github_skill' as const);
    const raw = structuredClone(context.body ?? {});
    const input = { params: context.params, body: raw };
    const header = context.request.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    // Managed run rows hash a different frozen input shape; their replay is handled by
    // the managed ledger (registerRun by caller key), never by the legacy hash gate.
    const managedPrevious = managedRunByCallerKey(key);
    if (managedPrevious && spend.repository.get(managedPrevious.requestId)?.state === 'terminal') {
      try {
        return payload(
          await readTerminalManagedRunReplay(managedPrevious.requestId, action, jsonRecord(input)),
        );
      } catch (error) {
        if (error instanceof ManagedExecutionError)
          throw new AutomationError(error.code, '原运行不可在当前账号状态下读取', 409);
        throw error;
      }
    }
    const previous = managedPrevious ? null : spend.replay(action, input, key);
    if (
      !managedPrevious &&
      previous &&
      previous.state !== 'pending_confirmation' &&
      previous.state !== 'authorized'
    )
      return payload(previous);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success)
      throw new AutomationError('INVALID_PARAMS', '运行参数无效，张数须为 1–4', 400);
    const body = parsed.data;
    const selected = (
      body.providerId
        ? getDb().prepare('SELECT id, type FROM providers WHERE id = ?').get(body.providerId)
        : getDb().prepare('SELECT id, type FROM providers WHERE is_active = 1 LIMIT 1').get()
    ) as { id: string; type: string } | undefined;
    if (!selected) throw new AutomationError('INVALID_STATE', '没有可用的图像 Provider', 422);
    if (selected.type === 'doubao-web') return fallback({ ...context, body: raw });
    const provider = spend.binding(selected.id);
    const detail = kind === 'scheme' ? getMusefoldCore().schemes.get(context.params.id) : null;
    if (kind === 'scheme' && !detail) throw new AutomationError('NOT_FOUND', '设计方案不存在', 404);
    if (kind === 'skill' && (!body.url?.startsWith('https://github.com/') || !body.prompt?.trim()))
      throw new AutomationError('INVALID_PARAMS', '请提供公开 GitHub 仓库与运行提示词', 400);
    const prepared =
      kind === 'skill' ? await prepareGithubSkillRuntime({ repositoryUrl: body.url ?? '' }) : null;
    if (prepared && !prepared.ok)
      throw new AutomationError(prepared.error.code, prepared.error.message, 422);
    const runtime = prepared?.ok ? prepared.data : null;
    const sourceDigest = runtime ? skillRuntimeSourceDigest(runtime.runtimeId) : null;
    const text = kind === 'skill' ? captureAutomationTextConnection() : null;
    // A managed replay must reuse the frozen plan byte-for-byte; fresh keys mint new ids.
    const jobIds = managedPrevious
      ? managedPrevious.run.originalJobIds
      : previous
        ? z.array(z.string()).parse(previous.frozenInput.jobIds)
        : Array.from({ length: body.n }, () => ulid());
    const executionId = managedPrevious
      ? ((key ? (spend.repository.findByKey(key)?.executionId ?? null) : null) ?? `ext_${ulid()}`)
      : (previous?.executionId ?? `ext_${ulid()}`);
    const managedRunId =
      kind === 'scheme' && typeof managedPrevious?.run.frozenRun.runId === 'string'
        ? managedPrevious.run.frozenRun.runId
        : null;
    const runId =
      kind === 'scheme'
        ? (managedRunId ??
          (typeof previous?.frozenInput.runId === 'string'
            ? previous.frozenInput.runId
            : `dsr_${ulid()}`))
        : null;
    const ratio =
      body.ratioId && body.ratioId !== 'auto' ? resolveRatioOptionById(body.ratioId) : null;
    const template: GenerateImageRequest = {
      jobId: jobIds[0],
      providerId: provider.binding.providerId,
      model: provider.binding.model,
      prompt: '',
      size: ratio?.size ?? '1024x1024',
      quality: 'auto',
      n: 1,
      ...(ratio ? { aspectRatio: ratio.ratio } : {}),
    };
    const generation = {
      requestTemplate: template,
      jobIds,
      providerName: provider.row.name,
      ratioId: body.ratioId ?? 'auto',
    };
    const progress = (
      event: Parameters<NonNullable<Parameters<typeof runDesignScheme>[1]['sendProgress']>>[0],
    ) => hub.sink.emit({ type: 'generation.progress', payload: { ...event, jobId: executionId } });
    type DriveTools = {
      generate: ReturnType<
        ReturnType<typeof createDesktopExternalSpend>['imageExecutor']
      >['generate'];
      onReferences: ReturnType<
        ReturnType<typeof createDesktopExternalSpend>['imageExecutor']
      >['onReferences'];
      text: ReturnType<ReturnType<typeof createDesktopExternalSpend>['textExecutor']> | null;
    };
    const driveDurable = async (
      controller: AbortController,
      live: { steps: string[] },
      tools: DriveTools,
    ): Promise<'success' | 'failed' | 'cancelled'> => {
      if (controller.signal.aborted) return 'cancelled';
      if (kind === 'scheme' && detail && runId) {
        const expected = automationInputHash(detail.document);
        const result = await runDesignScheme(
          {
            executionId,
            runId,
            schemeId: detail.summary.id,
            revisionId: detail.summary.currentRevisionId,
            mode: 'formal',
            priorityMode: body.priorityMode,
            brief: body.brief,
            inputValues: body.inputs,
            generation,
          },
          {
            db: getDesignSchemeDb(),
            signal: controller.signal,
            sendProgress: progress,
            validateDocument(document) {
              if (automationInputHash(document) !== expected)
                throw new AutomationError('SPEND_INPUT_CHANGED', '方案版本内容在确认后变化', 409);
            },
            generate: tools.generate,
            emit(event) {
              if (event.kind === 'trace') {
                live.steps.push(event.item.title);
                hub.sink.emit({
                  type: 'scheme.run.step',
                  payload: { jobId: executionId, ...event.item },
                });
              }
            },
          },
        );
        return controller.signal.aborted
          ? 'cancelled'
          : result.ok && result.data.generations.some((item) => item.result.status === 'success')
            ? 'success'
            : 'failed';
      }
      if (!runtime || !sourceDigest) throw new Error('Missing authorized Skill snapshot');
      const result = await executeSkillRuntime(
        {
          runtimeId: runtime.runtimeId,
          executionId,
          userPrompt: body.prompt ?? '',
          userImages: [],
          availableImageSlots: 16,
          generation,
        },
        {
          execution: {
            sourceDigest,
            text: tools.text,
            generate: tools.generate,
            onReferences: tools.onReferences,
          },
          sendProgress: progress,
          emit(event) {
            if (event.kind === 'trace') {
              live.steps.push(event.item.title);
              hub.sink.emit({
                type: 'skill.runtime.delta',
                payload: { jobId: executionId, ...event.item },
              });
            }
          },
        },
      );
      return controller.signal.aborted
        ? 'cancelled'
        : result.ok && result.data.generations.some((item) => item.result.status === 'success')
          ? 'success'
          : 'failed';
    };
    // Cloud image runs with a verified account execute as managed per-original children:
    // one run-level reservation, one request-level confirmation, one remote send per job.
    // Without a verified session the legacy register below is the bounded rejection.
    if (selected.type === 'musefold-cloud' && (await verifiedAccountSessionAvailable())) {
      const controller = new AbortController();
      const live = { controller, jobIds, steps: [] as string[] };
      active.set(executionId, live);
      const routeError = (error: unknown) => {
        if (error instanceof ManagedExecutionError) {
          if (error.code === 'MANAGED_IDENTITY_UNVERIFIED')
            return new AutomationError(
              'PAYMENT_IDENTITY_UNBOUND',
              '连接缺少可验证付款身份，本次运行未发送',
              409,
            );
          return new AutomationError(error.code, '托管云运行未启动，未发送任何请求', 409);
        }
        return error;
      };
      try {
        const started = await startManagedDurableRun({
          runKind: action,
          providerId: selected.id,
          callerKey: key ?? executionId,
          caller: 'local-automation',
          executionId,
          originalJobIds: jobIds,
          input: jsonRecord(input),
          frozenRun: jsonRecord({
            body,
            params: context.params,
            jobIds,
            runId,
            source: detail
              ? {
                  document: detail.document,
                  revisionId: detail.summary.currentRevisionId,
                  schemeId: detail.summary.id,
                }
              : { sourceDigest },
          }),
          textBinding: text?.binding ?? null,
          ...(runtime
            ? {
                localProjection: {
                  skillRuntimeSource: {
                    label: runtime.name,
                    repositoryUrl: runtime.repositoryUrl,
                  },
                },
              }
            : {}),
          ...(body.consent ? { consent: body.consent } : {}),
          authorizePath,
          authorize: (confirmation) =>
            authorize({
              ...confirmation,
              providerName: provider.row.name,
              model: provider.binding.model,
              n: body.n,
              estimatedPoints: null,
              managedByAccount: true,
              promptPreview:
                kind === 'scheme'
                  ? `运行方案「${detail?.summary.name}」`
                  : `运行 GitHub Skill：${body.url}`,
            }),
          drive: async (tools) => {
            try {
              return await driveDurable(controller, live, {
                generate: tools.images.generate as DriveTools['generate'],
                onReferences: tools.images.onReferences,
                text: (tools.text as DriveTools['text']) ?? null,
              });
            } catch {
              // The managed ledger owns terminal state; a driver crash never resends.
              return controller.signal.aborted ? 'cancelled' : 'failed';
            }
          },
          onTerminal: (terminal) => {
            const status =
              terminal.outcome === 'cancelled'
                ? ('cancelled' as const)
                : terminal.outcome === 'success'
                  ? ('success' as const)
                  : ('failed' as const);
            hub.sink.emit({ type: terminalEvent(terminal, status), payload: payload(terminal) });
            active.delete(executionId);
          },
        });
        if (started.replayed) {
          active.delete(executionId);
          scheduleManagedRunReconciliation(executionId);
        }
        return payload(started.request);
      } catch (error) {
        active.delete(executionId);
        throw routeError(error);
      }
    }
    const estimated =
      text?.binding.policy === 'managed' ? null : estimateProviderCost(selected.id, { n: body.n });
    const request = spend.register({
      idempotencyKey: key ?? null,
      action,
      caller: 'local-automation',
      input: jsonRecord(input),
      frozenInput: jsonRecord({
        body,
        params: context.params,
        jobIds,
        runId,
        source: detail
          ? {
              document: detail.document,
              revisionId: detail.summary.currentRevisionId,
              schemeId: detail.summary.id,
            }
          : { sourceDigest },
      }),
      bindings: [provider.binding, ...(text ? [text.binding] : [])],
      promptText: kind === 'scheme' ? body.brief : (body.prompt ?? null),
      executionId,
      maxImageCalls: body.n,
      maxTextCalls: text ? 10 : 0,
      estimatedPoints: estimated,
      ...(body.consent ? { consent: body.consent } : {}),
      now: Date.now(),
    });
    await spend.authorize(request, (confirmation) =>
      authorize({
        ...confirmation,
        providerName: provider.row.name,
        model: provider.binding.model,
        n: body.n,
        estimatedPoints: estimated,
        managedByAccount: request.bindings.some((binding) => binding.policy === 'managed'),
        promptPreview:
          kind === 'scheme'
            ? `运行方案「${detail?.summary.name}」`
            : `运行 GitHub Skill：${body.url}`,
      }),
    );
    if (!spend.repository.beginExecution(request.id))
      return payload(spend.repository.get(request.id) ?? request);
    const controller = new AbortController();
    const live = { controller, jobIds, steps: [] as string[] };
    active.set(executionId, live);
    const images = spend.imageExecutor(request, jobIds);
    void Promise.resolve()
      .then(() =>
        driveDurable(controller, live, {
          generate: images.generate,
          onReferences: images.onReferences,
          text: text ? spend.textExecutor(request, text.binding) : null,
        }),
      )
      .then((status) => finish(request, status))
      .catch(() => {
        try {
          finish(request, controller.signal.aborted ? 'cancelled' : 'failed');
        } catch {
          /* A failed terminal audit remains in SQLite for recovery, never a reason to resend. */
        }
      });
    return payload(spend.repository.get(request.id) ?? request);
  }

  const routes = { ...legacy };
  for (const kind of ['scheme', 'skill'] as const) {
    const post = kind === 'scheme' ? 'POST /v1/schemes/:id/runs' : 'POST /v1/skills/github/run';
    routes[post] = async (context) => {
      const body = structuredClone(context.body ?? {});
      const header = context.request.headers['idempotency-key'];
      const key = Array.isArray(header) ? header[0] : header;
      const existing = key ? spend.repository.findByKey(key) : null;
      if (!existing) {
        const candidate = bodySchema.safeParse(body);
        const provider =
          candidate.success && candidate.data.providerId
            ? getDb()
                .prepare('SELECT type FROM providers WHERE id = ?')
                .get(candidate.data.providerId)
            : getDb().prepare('SELECT type FROM providers WHERE is_active = 1 LIMIT 1').get();
        if ((provider as { type?: string } | undefined)?.type === 'doubao-web')
          return legacy[post]({ ...context, body });
      }
      const hash = automationInputHash({ post, body, params: context.params });
      const previous = key ? submissions.get(key) : undefined;
      if (previous && previous.hash !== hash)
        throw new AutomationError('IDEMPOTENCY_CONFLICT', '同一请求键的输入已冻结', 409);
      // Register the Promise before authorization or remote snapshot reads can re-enter.
      const promise =
        previous?.promise ??
        Promise.resolve().then(() => submit({ ...context, body }, kind, legacy[post]));
      if (key && !previous) submissions.set(key, { hash, promise });
      const result = await promise;
      const persisted = key ? spend.repository.findByKey(key) : null;
      // A cached Promise is not current account authority. Completed managed runs
      // take the same guarded, source-free replay path as a fresh process.
      if (previous && persisted?.state === 'terminal' && managedRunByCallerKey(key)) {
        context.json(await submit({ ...context, body }, kind, legacy[post]), 200);
        return;
      }
      if (result !== undefined)
        context.json(persisted ? payload(persisted) : result, previous ? 200 : 202);
    };
    const path = kind === 'scheme' ? '/v1/scheme-runs/:id' : '/v1/skill-runs/:id';
    routes[`GET ${path}`] = (context) => {
      const request = spend.repository.findByExecutionId(context.params.id);
      if (!request || request.action !== (kind === 'scheme' ? 'run_scheme' : 'run_github_skill'))
        return legacy[`GET ${path}`](context);
      return payload(request);
    };
    routes[`DELETE ${path}`] = (context) => {
      const request = spend.repository.findByExecutionId(context.params.id);
      if (!request || request.action !== (kind === 'scheme' ? 'run_scheme' : 'run_github_skill'))
        return legacy[`DELETE ${path}`](context);
      const live = active.get(request.executionId);
      if (!live || request.state === 'terminal')
        return { jobId: request.executionId, cancelling: false };
      live.controller.abort();
      if (kind === 'skill') cancelSkillRuntimeExecution(request.executionId);
      for (const jobId of live.jobIds) getMusefoldCore().generation.cancel(jobId);
      // Managed cloud runs own their per-child ledger; ask the runtime to cancel
      // the shared reservation so unclaimed children die at zero cost.
      void cancelManagedDurableRun(request.executionId).catch(() => undefined);
      return { jobId: request.executionId, cancelling: true };
    };
  }
  return routes;
}
