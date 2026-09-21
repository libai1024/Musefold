import { randomUUID } from 'node:crypto';
import { executionBindingSchema, generationStatusSchema } from '@musefold/contracts';
import {
  type MusefoldDatabase,
  accountCredentials,
  accountIdentities,
  accountSessionAuthorizations,
  generationExecutionReceipts,
  generationRequestDigest,
  generationRuns,
  session,
} from '@musefold/db';
import { sealJsonToString } from '@musefold/server-crypto';
import { and, eq } from 'drizzle-orm';

/** Synthetic positive-test authority. Does not claim to verify a real upstream identity. */
export async function seedExecutionAuthority(
  db: MusefoldDatabase,
  input: {
    userId: string;
    apiIssuer: string;
    upstreamIssuer: string;
    encryptionKey: string;
    apiKey: string;
    ownerId?: string;
  },
) {
  const now = new Date();
  const sessionId = randomUUID();
  const authRevision = 1;
  const binding = executionBindingSchema.parse({
    apiIssuer: input.apiIssuer,
    principalId: input.userId,
    payer: { issuer: input.upstreamIssuer, ownerId: input.ownerId ?? input.userId },
    credential: { ref: randomUUID(), version: 1 },
    providerId: 'cloud-default',
    model: 'musefold-image-pro',
    capabilities: { image: true, text: false },
  });
  await db.transaction(async (tx) => {
    await tx.insert(accountIdentities).values({
      userId: input.userId,
      apiIssuer: binding.apiIssuer,
      upstreamIssuer: binding.payer.issuer,
      upstreamOwnerId: binding.payer.ownerId,
      status: 'active',
      identityVersion: 1,
      verifiedAt: now,
      evidence: { kind: 'synthetic_worker_fixture' },
    });
    await tx.insert(accountCredentials).values({
      userId: input.userId,
      provider: 'new-api',
      externalTokenId: '1',
      ciphertext: sealJsonToString({ apiKey: input.apiKey }, input.encryptionKey),
      keyVersion: 'v1',
      upstreamIssuer: binding.payer.issuer,
      upstreamOwnerId: binding.payer.ownerId,
      credentialRef: binding.credential.ref,
      credentialVersion: binding.credential.version,
      status: 'active',
      verifiedAt: now,
    });
    await tx.insert(session).values({
      id: sessionId,
      userId: input.userId,
      token: randomUUID(),
      expiresAt: new Date(now.getTime() + 86_400_000),
    });
    await tx.insert(accountSessionAuthorizations).values({
      sessionId,
      userId: input.userId,
      mode: 'normal',
      revision: authRevision,
    });
  });
  return { binding, sessionId, authRevision };
}

export type FixtureExecutionAuthority = Awaited<ReturnType<typeof seedExecutionAuthority>>;

/** Fixture-only enqueue equivalent; production API acceptance is tested separately. */
export async function attachExecutionReceipt(
  db: MusefoldDatabase,
  input: { runId: string; userId: string; authority: FixtureExecutionAuthority },
) {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(generationRuns)
      .where(and(eq(generationRuns.id, input.runId), eq(generationRuns.userId, input.userId)))
      .for('update');
    if (
      !run?.idempotencyKey ||
      run.executionReceiptId ||
      input.authority.binding.principalId !== input.userId
    )
      throw new Error('Expected an unbound keyed fixture run and matching authority');
    const digest = generationRequestDigest(run.request);
    const receiptId = randomUUID();
    await tx.insert(generationExecutionReceipts).values({
      id: receiptId,
      principalId: input.userId,
      idempotencyKey: run.idempotencyKey,
      operation: run.designSchemeRunId
        ? 'scheme_run'
        : run.parentRunId
          ? 'explicit_retry'
          : 'ordinary_create',
      originalRunId: run.id,
      sourceRunId: run.parentRunId,
      binding: input.authority.binding,
      bindingState: 'bound',
      logicalInputDigest: digest,
      finalRequestDigest: digest,
      authorizingSessionId: input.authority.sessionId,
      authRevision: input.authority.authRevision,
      status: generationStatusSchema.parse(run.status),
      dispatch: run.upstreamRequestSent ? 'claimed' : 'not_started',
      costProvenance: run.upstreamRequestSent ? 'unknown' : 'not_sent',
      costPoints: run.upstreamRequestSent ? null : 0,
      claimedAt: run.upstreamRequestSent ? new Date() : null,
    });
    await tx
      .update(generationRuns)
      .set({ executionReceiptId: receiptId })
      .where(eq(generationRuns.id, run.id));
    return receiptId;
  });
}
