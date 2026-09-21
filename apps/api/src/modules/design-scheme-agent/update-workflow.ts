import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  designSchemeUpdateContextSchema,
  prepareGithubSchemeSourceInputSchema,
  authorizeDesignSchemeUpdateInputSchema,
  type cloudCheckDesignSchemeUpdateInputSchema,
  type schemeSourcePreparationSchema,
  type DesignSchemeUpdateContext,
} from '@musefold/contracts';
import {
  designSchemeAgentSessions as sessions,
  designSchemeSourcePreparations as preparations,
  designSchemeTextExecutions as executions,
  executionDigest,
  type MusefoldDatabase,
} from '@musefold/db';
import { AppError } from '../../lib/errors.js';
import { AgentState, type Row, type Tx } from './state.js';
import { DesignSchemeRevisionAuthority } from './revision-authority.js';
import { type DesignSchemeTextAuthority, unavailable } from './text-authority.js';

/** Free durable inspection first; a separate user intent authorizes only confirmed changes. */
export class DesignSchemeUpdateWorkflow extends AgentState {
  constructor(
    db: MusefoldDatabase,
    private readonly authority?: DesignSchemeTextAuthority,
  ) {
    super(db);
  }

  async freeze(
    tx: Tx,
    userId: string,
    input: z.infer<typeof cloudCheckDesignSchemeUpdateInputSchema>,
  ) {
    const revisions = new DesignSchemeRevisionAuthority(this.db);
    const base = await revisions.lock(tx, userId, input);
    const snapshots = await revisions.snapshots(userId, base);
    if (
      base.document.sources.some(
        (binding) => binding.kind.startsWith('github') && !binding.snapshotId,
      )
    )
      throw sourceInvalid();
    const sources = [];
    for (const snapshot of snapshots.filter((item) => item.kind === 'github')) {
      const [preparation] = await tx
        .select()
        .from(preparations)
        .where(and(eq(preparations.userId, userId), eq(preparations.snapshotId, snapshot.id)))
        .orderBy(preparations.executionId)
        .limit(1);
      // B34 stores the actual branch/tag requested separately from the resolved immutable SHA.
      // Imported pinned snapshots remain pinned; never guess the repository's current default branch.
      const requestedRef =
        preparation?.evidence?.requestedRef ?? snapshot.ref ?? snapshot.resolvedRef;
      const repositoryUrl = snapshot.repositoryUrl ?? snapshot.repositoryUri ?? snapshot.uri;
      if (
        !snapshot.commitHash ||
        !snapshot.contentHash ||
        typeof requestedRef !== 'string' ||
        !repositoryUrl
      )
        throw sourceInvalid();
      const source = prepareGithubSchemeSourceInputSchema.parse({
        executionId: randomUUID(),
        repositoryUrl,
        requestedRef,
      });
      sources.push({ ...source, requestedRef, snapshotId: snapshot.id });
    }
    return designSchemeUpdateContextSchema.parse({
      base,
      snapshots,
      sources,
      checkedSources: 0,
      changes: [],
      authorizationVersion: null,
    });
  }

  async guard(tx: Tx, row: Row) {
    if (row.request?.operation !== 'check-update' || !row.updateContext) throw sourceInvalid();
    try {
      await new DesignSchemeRevisionAuthority(this.db).lock(
        tx,
        row.userId,
        row.request.input,
        row.updateContext.base,
      );
      return true;
    } catch (error) {
      if (!(error instanceof AppError) || error.details.reason !== 'AGENT_BASE_REVISION_CHANGED')
        throw error;
      await this.cancelSources(tx, row);
      await this.save(tx, row, {
        status: 'blocked',
        blocker: 'AGENT_BASE_REVISION_CHANGED',
        pendingSource: null,
      });
      return false;
    }
  }

  async next(tx: Tx, row: Row) {
    if (!(await this.guard(tx, row))) return null;
    const context = row.updateContext as DesignSchemeUpdateContext;
    if (context.checkedSources === context.sources.length) {
      if (row.view.text) {
        if (row.view.status !== 'compiling') await this.save(tx, row, { status: 'compiling' });
        return 'compile' as const;
      }
      await this.save(tx, row, {
        status: !context.sources.length
          ? 'no-source'
          : !context.changes.length
            ? 'up-to-date'
            : 'authorization-required',
      });
      return null;
    }
    const item = context.sources[context.checkedSources];
    if (row.view.status !== 'preparing') await this.save(tx, row, { status: 'preparing' });
    return prepareGithubSchemeSourceInputSchema.parse({
      executionId: item.executionId,
      repositoryUrl: item.repositoryUrl,
      requestedRef: item.requestedRef,
    });
  }

  async accept(tx: Tx, row: Row, prepared: z.infer<typeof schemeSourcePreparationSchema>) {
    if (!(await this.guard(tx, row))) return null;
    const context = row.updateContext as DesignSchemeUpdateContext;
    const item = context.sources[context.checkedSources];
    if (!item || item.executionId !== prepared.executionId) return null;
    const old = context.snapshots.find((snapshot) => snapshot.id === item.snapshotId);
    if (
      !old?.commitHash ||
      !old.contentHash ||
      !prepared.source?.commitHash ||
      !prepared.snapshotId ||
      !prepared.contentHash ||
      prepared.source.repositoryUrl !== item.repositoryUrl
    )
      throw sourceInvalid();
    const changed =
      old.commitHash !== prepared.source.commitHash || old.contentHash !== prepared.contentHash;
    const next = designSchemeUpdateContextSchema.parse({
      ...context,
      checkedSources: context.checkedSources + 1,
      changes: changed
        ? [
            ...context.changes,
            {
              sourceExecutionId: item.executionId,
              previousSnapshotId: old.id,
              snapshotId: prepared.snapshotId,
              previousCommit: old.commitHash,
              commit: prepared.source.commitHash,
              contentHash: prepared.contentHash,
            },
          ]
        : context.changes,
    });
    await tx
      .update(sessions)
      .set({ updateContext: next })
      .where(this.identity(row.userId, row.executionId));
    if (!changed)
      await tx
        .update(preparations)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
          and(eq(preparations.userId, row.userId), eq(preparations.executionId, item.executionId)),
        );
    return this.save(tx, row, {
      status: changed ? 'confirmation-required' : 'queued',
      pendingSource: changed ? prepared : null,
      update: { checkedSources: next.checkedSources, changes: next.changes },
    });
  }

  async authorize(
    userId: string,
    authSessionId: string,
    raw: z.input<typeof authorizeDesignSchemeUpdateInputSchema>,
    enqueue: (tx: Tx, row: Row) => Promise<void>,
  ) {
    const input = authorizeDesignSchemeUpdateInputSchema.parse(raw);
    const inspect = async (tx: Tx) => {
      const row = await this.expire(tx, await this.requireRow(tx, userId, input.executionId));
      if (row.request?.operation !== 'check-update' || !row.updateContext) throw conflict();
      const [previous] = await tx
        .select()
        .from(executions)
        .where(and(eq(executions.userId, userId), eq(executions.executionId, input.executionId)));
      if (previous) {
        if (
          row.updateContext.authorizationVersion !== input.expectedSessionVersion ||
          executionDigest(previous.authorization) !== executionDigest(input.text)
        )
          throw conflict();
        return { row, replay: true };
      }
      if (
        row.view.status !== 'authorization-required' ||
        row.view.version !== input.expectedSessionVersion
      )
        throw conflict();
      return { row, replay: false };
    };
    const initial = await this.db.transaction(inspect);
    if (initial.replay) return initial.row.view;
    if (!this.authority) throw unavailable();
    const authority = this.authority;
    const text = await authority.prepare(
      userId,
      authSessionId,
      input.text,
      initial.row.updateContext?.changes.length ?? 0,
    );
    return this.db.transaction(async (tx) => {
      await authority.lock(
        tx,
        userId,
        text.authSessionId,
        text.authorization.binding,
        text.authRevision,
      );
      const { row, replay } = await inspect(tx);
      if (replay) return row.view;
      if (!(await this.guard(tx, row)))
        return (await this.requireRow(tx, userId, input.executionId)).view;
      await this.lockSources(tx, row);
      const context = row.updateContext as DesignSchemeUpdateContext;
      for (const change of context.changes) {
        const [source] = await tx
          .select()
          .from(preparations)
          .where(
            and(
              eq(preparations.userId, userId),
              eq(preparations.executionId, change.sourceExecutionId),
            ),
          );
        if (
          source?.status !== 'confirmed' ||
          source.expiresAt.getTime() <= Date.now() ||
          source.snapshotId !== change.snapshotId ||
          source.contentHash !== change.contentHash
        )
          throw conflict();
      }
      await tx
        .insert(executions)
        .values({ userId, executionId: input.executionId, ...text, revisionBase: context.base });
      await tx
        .update(sessions)
        .set({ updateContext: { ...context, authorizationVersion: input.expectedSessionVersion } })
        .where(this.identity(userId, input.executionId));
      const saved = await this.save(tx, row, {
        status: 'queued',
        text: {
          model: text.authorization.binding.model,
          callsSent: 0,
          callsCompleted: 0,
          maxModelCalls: text.authorization.maxModelCalls,
          cost: 'not-incurred',
        },
      });
      await enqueue(tx, saved);
      return saved.view;
    });
  }
}
function conflict() {
  return new AppError('VALIDATION_FAILED', '更新内容或授权已变化，请查看原任务', 409);
}
function sourceInvalid() {
  return new AppError(
    'VALIDATION_FAILED',
    '方案来源缺少可核对的固定版本，无法检查更新',
    409,
    false,
    { reason: 'AGENT_TEXT_SOURCE_INVALID' },
  );
}
