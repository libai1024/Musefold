import { DesignSchemeUpdateWorkflow } from './update-workflow.js';
import { listDesignSchemeAgentExecutions } from './history.js';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  startDesignSchemeAgentInputSchema,
  type authorizeDesignSchemeUpdateInputSchema,
  designSchemeAgentSessionSchema,
  designSchemeAgentEventPageSchema,
  confirmDesignSchemeAgentSourceInputSchema,
  prepareGithubSchemeSourceInputSchema,
  type DesignSchemeAgentHistoryQuery,
} from '@musefold/contracts';
import {
  type MusefoldDatabase,
  designSchemeAgentSessions as sessions,
  designSchemeAgentEvents as events,
  designSchemeTextExecutions,
  designSchemeSourcePreparations as preparations,
  executionDigest,
  retireDesignSchemeSourcePreparations,
} from '@musefold/db';
import type { DesignSchemeAssetService } from '../design-scheme-assets/service.js';
import { DesignSchemeService } from '../design-schemes/service.js';
import { DesignSchemeRevisionAuthority } from './revision-authority.js';
import { AppError } from '../../lib/errors.js';
import type { DesignSchemeSourcePreparationService } from '../design-schemes/source-preparation.js';

import { AgentState, ACTIVE, type Row, type View, type Tx } from './state.js';
import type { ApiEnv } from '../../env.js';
import { DesignSchemeTextAuthority, unavailable } from './text-authority.js';
import { DesignSchemeTextExecution } from './text-execution.js';
const TTL = 60 * 60_000;
export const SCHEME_AGENT_TASK = 'design-scheme.agent';

/** Durable cloud Agent. Only new, explicitly authorized text executions may call a model. */
export class DesignSchemeAgentService extends AgentState {
  private readonly textAuthority?: DesignSchemeTextAuthority;
  private readonly updates: DesignSchemeUpdateWorkflow;
  private readonly compiler?: DesignSchemeTextExecution;
  constructor(
    db: MusefoldDatabase,
    private readonly sources: DesignSchemeSourcePreparationService,
    env?: ApiEnv,
    private readonly assets?: DesignSchemeAssetService,
  ) {
    super(db);
    if (env) {
      this.textAuthority = new DesignSchemeTextAuthority(db, env);
      this.compiler = new DesignSchemeTextExecution(
        db,
        sources,
        this.textAuthority,
        new DesignSchemeService(db, assets),
        assets,
      );
    }
    this.updates = new DesignSchemeUpdateWorkflow(db, this.textAuthority);
  }

  async authorizeUpdate(
    userId: string,
    authSessionId: string,
    input: z.input<typeof authorizeDesignSchemeUpdateInputSchema>,
  ) {
    return this.updates.authorize(userId, authSessionId, input, (tx, row) => this.enqueue(tx, row));
  }

  async textModelOffer(userId: string, sessionId: string) {
    if (!this.textAuthority) throw unavailable();
    return this.textAuthority.offer(userId, sessionId);
  }

  list(userId: string, sessionId: string, query: DesignSchemeAgentHistoryQuery) {
    return listDesignSchemeAgentExecutions(this.db, userId, sessionId, query);
  }

  async start(
    userId: string,
    raw: z.input<typeof startDesignSchemeAgentInputSchema>,
    authSessionId?: string,
  ) {
    const request = startDesignSchemeAgentInputSchema.parse(raw);
    const executionId = request.input.executionId;
    const requestHash = executionDigest(request);
    // Read existing intent/tombstone before model discovery; replays never perform upstream IO.
    const existing = await this.db.transaction(async (tx) => {
      const row = await this.row(tx, userId, executionId);
      if (!row) return null;
      if (row.requestHash !== null && row.requestHash !== requestHash) throw conflict();
      return (await this.expire(tx, row)).view;
    });
    if (existing) return existing;
    const input = request.operation === 'create' ? request.input : null;
    const unsupported =
      input !== null &&
      (!!input.document ||
        input.sourceBindings.length > 0 ||
        input.sourcePackages.length > 0 ||
        input.sourceSnapshots.length > 0 ||
        (!this.assets &&
          (input.sourceAssetIds.length > 0 ||
            input.sourceAssets.length > 0 ||
            input.historySources.length > 0)));
    const materials =
      !unsupported && input && this.assets
        ? await this.assets.freezeAgentMaterials(userId, input)
        : undefined;
    const revisions = new DesignSchemeRevisionAuthority(this.db);
    const updateContext =
      request.operation === 'check-update'
        ? await this.db.transaction((tx) => this.updates.freeze(tx, userId, request.input))
        : undefined;
    const revisionBase =
      request.operation === 'modify'
        ? await this.db.transaction((tx) => revisions.lock(tx, userId, request.input))
        : undefined;
    let text: Awaited<ReturnType<DesignSchemeTextAuthority['prepare']>> | undefined;
    if ('text' in request && request.text) {
      if (!authSessionId || !this.textAuthority) throw unavailable();
      text = await this.textAuthority.prepare(
        userId,
        authSessionId,
        request.text,
        request.operation === 'create' ? request.input.sourceUris.length : 0,
      );
    }
    return this.db.transaction(async (tx) => {
      // Identity precedes parent/source locks, matching account rotation/revocation ordering.
      if (text && this.textAuthority)
        await this.textAuthority.lock(
          tx,
          userId,
          text.authSessionId,
          text.authorization.binding,
          text.authRevision,
        );
      // Serialize per-owner admission (including cancel-before-start) across all API instances.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 3571))`);
      const previous = await this.row(tx, userId, executionId);
      if (previous) {
        if (previous.requestHash !== null && previous.requestHash !== requestHash) throw conflict();
        return (await this.expire(tx, previous)).view;
      }
      const count = await tx.execute<{ count: string }>(sql`SELECT count(*)::text AS count
        FROM design_scheme_agent_sessions WHERE user_id=${userId}
        AND expires_at > now() AND view->>'status' IN ('queued','preparing','confirmation-required','authorization-required','compiling')`);
      if (Number(count.rows[0]?.count ?? 0) >= 4)
        throw new AppError('RATE_LIMITED', '请先完成或取消已有方案任务', 429, true);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + TTL);
      if (request.operation !== 'create')
        await revisions.lock(tx, userId, request.input, revisionBase ?? updateContext?.base);
      const sourceIds = updateContext
        ? updateContext.sources.map((item) => item.executionId)
        : unsupported || !input
          ? []
          : input.sourceUris.map(() => randomUUID());
      if (materials) {
        await this.assets?.lockHistoryAdmission(tx, userId, materials);
        await this.assets?.lockAgentUploads(tx, userId, materials);
      }
      const [inserted] = await tx
        .insert(sessions)
        .values({
          userId,
          executionId,
          requestHash,
          request,
          sourceExecutionIds: sourceIds,
          updateContext,
          materials,
          expiresAt,
          createdAt: now,
          view: {
            ...this.initial(executionId, now, expiresAt, sourceIds.length),
            operation: request.operation,
            ...(updateContext ? { update: { checkedSources: 0, changes: [] } } : {}),
            ...(text
              ? {
                  text: {
                    model: text.authorization.binding.model,
                    callsSent: 0,
                    callsCompleted: 0,
                    maxModelCalls: text.authorization.maxModelCalls,
                    cost: 'not-incurred' as const,
                  },
                }
              : {}),
          },
        })
        .returning();
      if (text)
        await tx
          .insert(designSchemeTextExecutions)
          .values({ userId, executionId, ...text, revisionBase });
      for (const [index, sourceId] of sourceIds.entries()) {
        await this.sources.registerQueued(
          tx,
          userId,
          updateContext
            ? {
                executionId: sourceId,
                repositoryUrl: updateContext.sources[index].repositoryUrl,
                requestedRef: updateContext.sources[index].requestedRef,
              }
            : { executionId: sourceId, repositoryUrl: input?.sourceUris[index] ?? '' },
          expiresAt,
        );
      }
      const row = await this.save(
        tx,
        inserted,
        unsupported
          ? { status: 'blocked', blocker: 'AGENT_ASSETS_UNAVAILABLE' }
          : { status: 'queued' },
      );
      if (!unsupported) await this.enqueue(tx, row);
      return row.view;
    });
  }

  async get(userId: string, executionId: string) {
    return this.db.transaction(
      async (tx) => (await this.expire(tx, await this.requireRow(tx, userId, executionId))).view,
    );
  }

  async eventPage(userId: string, executionId: string, afterSeq: number) {
    return this.db.transaction(async (tx) => {
      const row = await this.expire(tx, await this.requireRow(tx, userId, executionId));
      if (afterSeq > row.view.version) throw conflict();
      const page = await tx
        .select({ seq: events.seq, session: events.session })
        .from(events)
        .where(
          and(
            eq(events.userId, userId),
            eq(events.executionId, executionId),
            gt(events.seq, afterSeq),
          ),
        )
        .orderBy(asc(events.seq))
        .limit(100);
      return designSchemeAgentEventPageSchema.parse({
        events: page,
        nextSeq: page.at(-1)?.seq ?? afterSeq,
      });
    });
  }

  async cancel(userId: string, executionId: string, operation: View['operation'] = 'create') {
    const view = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 3571))`);
      let row = await this.row(tx, userId, executionId);
      if (!row) {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + TTL);
        [row] = await tx
          .insert(sessions)
          .values({
            userId,
            executionId,
            requestHash: null,
            request: null,
            sourceExecutionIds: [],
            expiresAt,
            createdAt: now,
            view: {
              ...this.initial(executionId, now, expiresAt, 0),
              operation,
              status: 'cancelled',
            },
          })
          .returning();
        return (await this.save(tx, row, { status: 'cancelled' })).view;
      }
      row = await this.expire(tx, row);
      if (!ACTIVE.includes(row.view.status)) return row.view;
      await this.cancelSources(tx, row);
      return (await this.save(tx, row, { status: 'cancelled', pendingSource: null })).view;
    });
    await retireDesignSchemeSourcePreparations(this.db);
    return view;
  }

  async confirm(userId: string, raw: z.input<typeof confirmDesignSchemeAgentSourceInputSchema>) {
    const input = confirmDesignSchemeAgentSourceInputSchema.parse(raw);
    const view = await this.db.transaction(async (tx) => {
      let row = await this.expire(tx, await this.requireRow(tx, userId, input.executionId));
      if (!row.sourceExecutionIds.length) throw conflict();
      await this.lockSources(tx, row);
      const [source] = await tx
        .select()
        .from(preparations)
        .where(
          and(
            eq(preparations.userId, userId),
            eq(preparations.confirmationId, input.confirmationId),
            inArray(preparations.executionId, row.sourceExecutionIds),
          ),
        )
        .for('update');
      if (!source) throw conflict();
      const desired = input.decision === 'install' ? 'confirmed' : 'rejected';
      // A retry of an earlier source's decision returns current state without approving the next one.
      if (source.status === desired) return row.view;
      if (
        row.view.status !== 'confirmation-required' ||
        row.view.pendingSource?.confirmationId !== input.confirmationId ||
        source.status !== 'ready' ||
        source.expiresAt.getTime() <= Date.now()
      )
        throw conflict();
      await tx
        .update(preparations)
        .set({ status: desired, updatedAt: new Date() })
        .where(
          and(eq(preparations.userId, userId), eq(preparations.executionId, source.executionId)),
        );
      if (input.decision === 'cancel') {
        await this.cancelSources(tx, row);
        return (await this.save(tx, row, { status: 'cancelled', pendingSource: null })).view;
      }
      row = await this.save(tx, row, {
        status: 'queued',
        pendingSource: null,
        confirmedSources: row.view.confirmedSources + 1,
      });
      await this.enqueue(tx, row);
      return row.view;
    });
    await retireDesignSchemeSourcePreparations(this.db);
    return view;
  }

  /** Called only by the durable queue consumer; no detached request-owned work. */
  async process(userId: string, executionId: string) {
    const claim = await this.db.transaction(async (tx) => {
      const existing = await this.row(tx, userId, executionId);
      if (!existing) return null;
      let row = await this.expire(tx, existing);
      if (!['queued', 'preparing', 'compiling'].includes(row.view.status)) return null;
      if (row.request?.operation === 'check-update') return this.updates.next(tx, row);
      if (row.view.confirmedSources >= row.sourceExecutionIds.length) {
        if (row.request?.text && this.compiler) {
          if (row.view.status !== 'compiling') await this.save(tx, row, { status: 'compiling' });
          return 'compile' as const;
        }
        await this.save(tx, row, { status: 'blocked', blocker: 'AGENT_COMPILER_UNAVAILABLE' });
        return null;
      }
      if (row.view.status !== 'preparing') row = await this.save(tx, row, { status: 'preparing' });
      const index = row.view.confirmedSources;
      return prepareGithubSchemeSourceInputSchema.parse({
        executionId: row.sourceExecutionIds[index],
        repositoryUrl:
          row.request?.operation === 'create' ? row.request.input.sourceUris[index] : undefined,
      });
    });
    if (!claim) return;
    if (claim === 'compile') return this.compiler?.process(userId, executionId);
    let prepared: Awaited<ReturnType<DesignSchemeSourcePreparationService['prepare']>>;
    try {
      prepared = await this.sources.prepare(userId, claim);
    } catch {
      // Safe, stable blocker only; never serialize upstream bodies or internal object paths.
      await this.db.transaction(async (tx) => {
        const row = await this.row(tx, userId, executionId);
        if (!row) return;
        const current = await this.expire(tx, row);
        if (current.view.status === 'preparing') {
          await this.cancelSources(tx, current);
          await this.save(tx, current, {
            status: 'failed',
            blocker: 'SOURCE_PREPARATION_FAILED',
            pendingSource: null,
          });
        }
      });
      return;
    } finally {
      await retireDesignSchemeSourcePreparations(this.db);
    }
    await this.db.transaction(async (tx) => {
      const existing = await this.row(tx, userId, executionId);
      if (!existing) return;
      const row = await this.expire(tx, existing);
      if (
        row.view.status !== 'preparing' ||
        (row.request?.operation === 'check-update'
          ? row.updateContext?.sources[row.updateContext.checkedSources]?.executionId
          : row.sourceExecutionIds[row.view.confirmedSources]) !== claim.executionId
      )
        return;
      if (prepared.status === 'ready' && row.request?.operation === 'check-update') {
        const next = await this.updates.accept(tx, row, prepared);
        if (next?.view.status === 'queued') await this.enqueue(tx, next);
      } else if (prepared.status === 'ready') {
        await this.save(tx, row, { status: 'confirmation-required', pendingSource: prepared });
      } else if (!['queued', 'reading'].includes(prepared.status)) {
        await this.cancelSources(tx, row);
        await this.save(tx, row, { status: 'failed', blocker: 'SOURCE_PREPARATION_FAILED' });
      }
    });
  }

  /** Queue repair and expiry are bounded; pending reads never restart their original source IO. */
  async reconcile() {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(sessions)
        .where(
          sql`${sessions.view}->>'status' IN ('queued','preparing','confirmation-required','authorization-required','compiling')`,
        )
        .orderBy(asc(sessions.updatedAt), asc(sessions.userId), asc(sessions.executionId))
        .limit(100)
        .for('update', { skipLocked: true });
      for (const original of rows) {
        const row = await this.expire(tx, original);
        if (['queued', 'preparing', 'compiling'].includes(row.view.status))
          await this.enqueue(tx, row);
        // Rotate waiting sessions so a full batch of confirmations cannot starve later work.
        await tx
          .update(sessions)
          .set({ updatedAt: new Date() })
          .where(this.identity(row.userId, row.executionId));
      }
    });
    await this.compiler?.reconcile();
    await retireDesignSchemeSourcePreparations(this.db);
  }

  private initial(executionId: string, now: Date, expiresAt: Date, sourceCount: number): View {
    return designSchemeAgentSessionSchema.parse({
      executionId,
      operation: 'create',
      status: 'queued',
      version: 0,
      sourceCount,
      confirmedSources: 0,
      pendingSource: null,
      blocker: null,
      result: null,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  }
  private async enqueue(tx: Tx, row: Row) {
    const key = `scheme-agent:${executionDigest([row.userId, row.executionId])}`;
    await tx.execute(sql`SELECT graphile_worker.add_job(${SCHEME_AGENT_TASK},
      json_build_object('userId',${row.userId}::text,'executionId',${row.executionId}::text),
      max_attempts := 3, job_key := ${key}, job_key_mode := 'preserve_run_at')`);
  }
}
function conflict() {
  return new AppError('VALIDATION_FAILED', '方案任务或来源确认已变化，请刷新后核对', 409);
}
