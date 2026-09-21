import {
  type GenerationExecutionReceipt,
  cloudGenerationRequestSchema,
  executionBindingSchema,
} from '@musefold/contracts';
import { CLOUD_GENERATION_MODEL } from '@musefold/domain/cloud-generation-policy';
import {
  type MusefoldDatabase,
  type MusefoldTransaction,
  executionBindingsEqual,
  generationExecutionReceipts,
  generationRequestDigest,
  generationRuns,
  lockGenerationExecutionAuthority,
  session,
} from '@musefold/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { WorkerEnv } from './env.js';

type Run = typeof generationRuns.$inferSelect;
type ReceiptRun = Pick<Run, 'id' | 'userId' | 'executionReceiptId' | 'upstreamRequestSent'>;
export type WorkerExecutionConfiguration = Pick<WorkerEnv, 'PUBLIC_BASE_URL' | 'NEW_API_BASE_URL'>;

/** Internal encrypted transport; never serialize the returned snapshot. */
export async function claimGenerationExecution(
  db: MusefoldDatabase,
  configuration: WorkerExecutionConfiguration,
  input: { userId: string; runId: string; epoch: number; request: unknown },
) {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(generationRuns)
      .where(and(eq(generationRuns.id, input.runId), eq(generationRuns.userId, input.userId)));
    if (!candidate?.executionReceiptId) return null;
    const [snapshot] = await tx
      .select()
      .from(generationExecutionReceipts)
      .where(
        and(
          eq(generationExecutionReceipts.id, candidate.executionReceiptId),
          eq(generationExecutionReceipts.principalId, input.userId),
        ),
      );
    const binding = executionBindingSchema.safeParse(snapshot?.binding);
    if (
      snapshot?.bindingState !== 'bound' ||
      !binding.success ||
      !snapshot.authorizingSessionId ||
      !snapshot.authRevision ||
      snapshot.purgedAt ||
      snapshot.dispatch !== 'not_started'
    )
      return null;

    // Read without run locks first, then lock the complete account authority in
    // the same order as login/logout. Recheck run + receipt after these locks.
    const authority = await lockGenerationExecutionAuthority(tx, {
      principalId: input.userId,
      apiIssuer: configuration.PUBLIC_BASE_URL,
      upstreamIssuer: configuration.NEW_API_BASE_URL,
      authSessionId: snapshot.authorizingSessionId,
      expectedBinding: binding.data,
      authorizedModel: binding.data.model,
      expectedAuthRevision: snapshot.authRevision,
    });
    const [run] = await tx
      .select()
      .from(generationRuns)
      .where(and(eq(generationRuns.id, input.runId), eq(generationRuns.userId, input.userId)))
      .for('update');
    const [receipt] = await tx
      .select()
      .from(generationExecutionReceipts)
      .where(
        and(
          eq(generationExecutionReceipts.id, snapshot.id),
          eq(generationExecutionReceipts.principalId, input.userId),
        ),
      )
      .for('update');
    const now = new Date();
    const parsedRequest = cloudGenerationRequestSchema.safeParse(run?.request);
    if (
      !run ||
      run.executionReceiptId !== snapshot.id ||
      run.status !== 'running' ||
      run.attemptCount !== input.epoch ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt <= now ||
      run.upstreamRequestSent ||
      run.deletedAt ||
      !receipt ||
      receipt.purgedAt ||
      receipt.originalRunId !== run.id ||
      receipt.status !== 'running' ||
      receipt.dispatch !== 'not_started' ||
      receipt.revision !== snapshot.revision ||
      receipt.bindingState !== 'bound' ||
      !receipt.binding ||
      !executionBindingsEqual(receipt.binding, authority.binding) ||
      receipt.authorizingSessionId !== snapshot.authorizingSessionId ||
      receipt.authRevision !== authority.authRevision ||
      run.providerModel !== authority.binding.model ||
      !parsedRequest.success ||
      (parsedRequest.data.model ?? CLOUD_GENERATION_MODEL) !== authority.binding.model ||
      receipt.finalRequestDigest !== generationRequestDigest(run.request) ||
      receipt.finalRequestDigest !== generationRequestDigest(input.request)
    )
      return null;
    // A blocked run lock may outlast the BA session after the authority helper
    // checked it. The session is already share-locked; re-evaluate wall time now.
    const [live] = await tx
      .select({ id: session.id })
      .from(session)
      .where(and(eq(session.id, receipt.authorizingSessionId), gt(session.expiresAt, now)));
    if (!live) return null;
    await tx
      .update(generationRuns)
      .set({ upstreamRequestSent: true })
      .where(eq(generationRuns.id, run.id));
    await tx
      .update(generationExecutionReceipts)
      .set({
        dispatch: 'claimed',
        costProvenance: 'unknown',
        costPoints: null,
        claimedAt: now,
        updatedAt: now,
        revision: receipt.revision + 1,
      })
      .where(eq(generationExecutionReceipts.id, receipt.id));
    return Object.freeze({
      baseUrl: authority.binding.payer.issuer,
      model: authority.binding.model,
      encryptedCredential: authority.encryptedCredential,
    });
  });
}

/** Caller holds the run row lock, and must keep the run/receipt transition atomic. */
export async function synchronizeExecutionReceipt(
  tx: MusefoldTransaction,
  run: ReceiptRun,
  status: GenerationExecutionReceipt['status'],
  options: { now?: Date; confirmedNotSent?: boolean } = {},
) {
  if (!run.executionReceiptId) return;
  const [receipt] = await tx
    .select()
    .from(generationExecutionReceipts)
    .where(
      and(
        eq(generationExecutionReceipts.id, run.executionReceiptId),
        eq(generationExecutionReceipts.principalId, run.userId),
        eq(generationExecutionReceipts.originalRunId, run.id),
      ),
    )
    .for('update');
  if (!receipt || receipt.purgedAt) return;
  const now = options.now ?? new Date();
  const terminal = ['succeeded', 'failed', 'cancelled', 'rejected', 'expired'].includes(status);
  const possiblySent =
    receipt.dispatch !== 'confirmed_not_sent' &&
    (receipt.dispatch === 'claimed' || run.upstreamRequestSent);
  const confirmedNotSent = options.confirmedNotSent === true && receipt.bindingState === 'bound';
  const dispatch = confirmedNotSent
    ? 'confirmed_not_sent'
    : possiblySent
      ? 'claimed'
      : receipt.dispatch;
  const costProvenance =
    receipt.bindingState === 'legacy_unbound'
      ? receipt.costProvenance
      : confirmedNotSent || !possiblySent
        ? 'not_sent'
        : receipt.costProvenance === 'provider_reported'
          ? 'provider_reported'
          : 'unknown';
  const costPoints =
    costProvenance === 'not_sent'
      ? 0
      : costProvenance === 'provider_reported'
        ? receipt.costPoints
        : null;
  if (
    receipt.status === status &&
    receipt.dispatch === dispatch &&
    receipt.costProvenance === costProvenance &&
    receipt.costPoints === costPoints &&
    Boolean(receipt.terminalAt) === terminal
  )
    return;
  await tx
    .update(generationExecutionReceipts)
    .set({
      status,
      dispatch,
      costProvenance,
      costPoints,
      terminalAt: terminal ? now : null,
      updatedAt: now,
      revision: sql`${generationExecutionReceipts.revision} + 1`,
    })
    .where(eq(generationExecutionReceipts.id, receipt.id));
}
