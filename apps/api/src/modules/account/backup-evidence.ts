import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  accountIdentities,
  accountRecoveryBackupEvidence,
  accountRecoveryRequests,
  accountSessionAuthorizations,
  session,
} from '@musefold/db';
import { openJsonFromString, sealJsonToString } from '@musefold/server-crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RelayAuthSession, RelayUser } from '@musefold/new-api-client';
import {
  type AccountIdentityDependencies,
  type AccountTx,
  assertRelayUser,
  conflictError,
  identityError,
  lockUser,
  relayCode,
  verifyFreshRelay,
} from './identity-support.js';
import {
  type BackupSourceProfile,
  type BackupSourceRows,
  sha256,
  sourceDigest,
} from './backup-source.js';

const secret = z.string().min(1).max(8192);
const relaySecrets = z.object({ jwt: secret, refreshToken: secret });
const keySecrets = z.object({ apiKey: secret });
const payloadSchema = z.strictObject({
  version: z.literal(1),
  requestId: z.string(),
  targetUserId: z.string(),
  apiIssuer: z.string(),
  upstreamIssuer: z.string(),
  sourceDigest: z.string(),
  relays: z
    .array(z.strictObject({ sourceSessionId: z.string(), jwt: secret, refreshToken: secret }))
    .min(1)
    .max(16),
  credential: z.strictObject({
    externalTokenId: z.number().int().positive().safe(),
    apiKey: secret,
  }),
});
type Payload = z.infer<typeof payloadSchema>;
type RequestRow = typeof accountRecoveryRequests.$inferSelect;
export type BackupProof = {
  row: typeof accountRecoveryBackupEvidence.$inferSelect;
  payload: Payload;
};
const LEASE_MS = 120_000;

export const backupInspectPlanSchema = z.strictObject({
  version: z.literal(1),
  requestId: z.string(),
  requestRevision: z.number().int(),
  identityVersion: z.number().int(),
  targetUserId: z.string(),
  sourceProfileId: z.string(),
  sourceDigest: z.string(),
  profileDigest: z.string(),
  relayCount: z.number().int(),
  expiresAt: z.iso.datetime(),
});
export type BackupInspectPlan = z.infer<typeof backupInspectPlanSchema>;

/** Does not grant authority. Only an existing request's authenticated retry can consume this proof. */
export class AccountBackupEvidenceStore {
  constructor(private readonly deps: AccountIdentityDependencies) {}

  private checkRequest(row: RequestRow, profile?: BackupSourceProfile) {
    if (row.status !== 'pending' || row.expiresAt.getTime() <= Date.now()) throw conflictError();
    if (
      row.upstreamIssuer !== this.deps.upstreamIssuer ||
      (profile &&
        (profile.upstreamIssuer !== row.upstreamIssuer ||
          profile.targetPrincipalId !== row.targetUserId ||
          profile.apiIssuer !== this.deps.apiIssuer ||
          Date.parse(profile.independentBefore) > row.createdAt.getTime()))
    )
      throw identityError('legacy_issuer_unknown');
  }

  async inspect(
    requestId: string,
    profile: BackupSourceProfile,
    source: BackupSourceRows,
  ): Promise<BackupInspectPlan> {
    const row = await this.deps.db.query.accountRecoveryRequests.findFirst({
      where: eq(accountRecoveryRequests.id, requestId),
    });
    if (!row) throw conflictError();
    this.checkRequest(row, profile);
    if (
      source.principalId !== profile.targetPrincipalId ||
      sourceDigest(source) !== profile.expectedEvidenceSha256
    )
      throw conflictError();
    const identity = await this.deps.db.query.accountIdentities.findFirst({
      where: eq(accountIdentities.userId, row.targetUserId),
    });
    if (
      !identity ||
      identity.status === 'active' ||
      identity.upstreamIssuer ||
      identity.upstreamOwnerId
    )
      throw conflictError();
    return backupInspectPlanSchema.parse({
      version: 1,
      requestId,
      requestRevision: row.revision,
      identityVersion: identity.identityVersion,
      targetUserId: row.targetUserId,
      sourceProfileId: profile.id,
      sourceDigest: sourceDigest(source),
      profileDigest: sha256(JSON.stringify(profile)),
      relayCount: source.relays.length,
      expiresAt: row.expiresAt.toISOString(),
    });
  }

  async stage(
    plan: BackupInspectPlan,
    profile: BackupSourceProfile,
    source: BackupSourceRows,
    archiveKey: string,
  ) {
    if (
      plan.profileDigest !== sha256(JSON.stringify(profile)) ||
      plan.sourceDigest !== sourceDigest(source) ||
      plan.sourceDigest !== profile.expectedEvidenceSha256 ||
      plan.targetUserId !== profile.targetPrincipalId ||
      source.principalId !== plan.targetUserId ||
      plan.sourceProfileId !== profile.id
    )
      throw conflictError();
    let payload: Payload;
    try {
      payload = payloadSchema.parse({
        version: 1,
        requestId: plan.requestId,
        targetUserId: plan.targetUserId,
        apiIssuer: profile.apiIssuer,
        upstreamIssuer: profile.upstreamIssuer,
        sourceDigest: plan.sourceDigest,
        relays: source.relays.map((row) => ({
          sourceSessionId: row.sessionId,
          ...relaySecrets.parse(openJsonFromString(row.ciphertext, archiveKey)),
        })),
        credential: {
          externalTokenId: Number(source.credentials[0]?.externalTokenId),
          ...keySecrets.parse(
            openJsonFromString(source.credentials[0]?.ciphertext ?? '', archiveKey),
          ),
        },
      });
    } catch {
      throw identityError('legacy_evidence_missing');
    }
    return this.deps.db.transaction(async (tx) => {
      await lockUser(tx, plan.targetUserId);
      const [identity] = await tx
        .select()
        .from(accountIdentities)
        .where(eq(accountIdentities.userId, plan.targetUserId))
        .for('update');
      const [request] = await tx
        .select()
        .from(accountRecoveryRequests)
        .where(eq(accountRecoveryRequests.id, plan.requestId))
        .for('update');
      if (!request || request.targetUserId !== plan.targetUserId) throw conflictError();
      this.checkRequest(request, profile);
      // Check the configured destination key against this request before any write.
      // This is an encryption/context check, never evidence of the historical payer.
      try {
        const candidate = openJsonFromString<RelayAuthSession>(
          request.candidateCiphertext,
          this.deps.encryptionKey,
        );
        relaySecrets.parse(candidate);
        assertRelayUser(candidate.user);
        if (
          !Number.isFinite(candidate.jwtExpiresAt) ||
          candidate.jwtExpiresAt <= 0 ||
          String(candidate.user.id) !== request.upstreamOwnerId
        )
          throw new Error();
      } catch {
        throw identityError('legacy_evidence_missing');
      }
      await this.lockCandidate(tx, request);
      const [prior] = await tx
        .select()
        .from(accountRecoveryBackupEvidence)
        .where(eq(accountRecoveryBackupEvidence.requestId, request.id))
        .for('update');
      if (prior) {
        if (
          prior.state === 'staged' &&
          prior.sourceDigest === plan.sourceDigest &&
          prior.sourceProfileId === profile.id &&
          prior.provenance.profileDigest === plan.profileDigest
        )
          return { id: prior.id, staged: true as const, alreadyStaged: true };
        throw conflictError();
      }
      if (
        !identity ||
        identity.identityVersion !== plan.identityVersion ||
        identity.status === 'active' ||
        request.revision !== plan.requestRevision ||
        request.expiresAt.toISOString() !== plan.expiresAt
      )
        throw conflictError();
      const id = randomUUID();
      await tx.insert(accountRecoveryBackupEvidence).values({
        id,
        requestId: request.id,
        targetUserId: request.targetUserId,
        upstreamIssuer: request.upstreamIssuer,
        sourceProfileId: profile.id,
        sourceDigest: plan.sourceDigest,
        provenance: {
          profileDigest: plan.profileDigest,
          sourceLineage: profile.sourceLineage,
          targetLineage: profile.targetLineage,
          capturedAt: profile.capturedAt,
          independentBefore: profile.independentBefore,
          attestationDigest: profile.attestation.sha256,
          attestationReference: profile.attestation.reference,
          reviewedBy: profile.attestation.reviewedBy,
          sourceDatabase: profile.sourceDatabase,
          targetDatabase: profile.targetDatabase,
          assurance: 'operator-reviewed-source; byte-and-configuration-verified',
        },
        ciphertext: sealJsonToString(payload, this.deps.encryptionKey),
        expiresAt: request.expiresAt,
      });
      await tx
        .update(accountRecoveryRequests)
        .set({ revision: request.revision + 1, updatedAt: new Date() })
        .where(eq(accountRecoveryRequests.id, request.id));
      return { id, staged: true as const, alreadyStaged: false };
    });
  }

  private async lockCandidate(tx: AccountTx, request: RequestRow) {
    const [live] = await tx
      .select()
      .from(session)
      .where(
        and(
          eq(session.id, request.sessionId),
          eq(session.userId, request.targetUserId),
          gt(session.expiresAt, new Date()),
        ),
      )
      .for('update');
    const [authorization] = await tx
      .select()
      .from(accountSessionAuthorizations)
      .where(eq(accountSessionAuthorizations.sessionId, request.sessionId))
      .for('update');
    if (
      !live ||
      authorization?.mode !== 'recovery_only' ||
      authorization.userId !== request.targetUserId
    )
      throw conflictError();
  }

  async claim(snapshot: RequestRow): Promise<BackupProof | undefined> {
    // Ordinary recovery without imported evidence retains its existing behavior.
    const exists = await this.deps.db.query.accountRecoveryBackupEvidence.findFirst({
      where: eq(accountRecoveryBackupEvidence.requestId, snapshot.id),
    });
    if (!exists) return undefined;
    return this.deps.db.transaction(async (tx) => {
      await lockUser(tx, snapshot.targetUserId);
      const [request] = await tx
        .select()
        .from(accountRecoveryRequests)
        .where(eq(accountRecoveryRequests.id, snapshot.id))
        .for('update');
      if (!request || request.revision !== snapshot.revision) throw conflictError();
      this.checkRequest(request);
      await this.lockCandidate(tx, request);
      const [row] = await tx
        .select()
        .from(accountRecoveryBackupEvidence)
        .where(eq(accountRecoveryBackupEvidence.id, exists.id))
        .for('update');
      if (
        row?.state !== 'staged' ||
        row.expiresAt.getTime() <= Date.now() ||
        row.upstreamIssuer !== request.upstreamIssuer ||
        row.targetUserId !== request.targetUserId
      )
        throw identityError('legacy_evidence_missing');
      if (row.leaseUntil && row.leaseUntil.getTime() > Date.now())
        throw identityError('verification_pending');
      let payload: Payload;
      try {
        payload = payloadSchema.parse(openJsonFromString(row.ciphertext, this.deps.encryptionKey));
      } catch {
        throw identityError('legacy_evidence_missing');
      }
      if (
        payload.requestId !== request.id ||
        payload.targetUserId !== request.targetUserId ||
        payload.apiIssuer !== this.deps.apiIssuer ||
        payload.upstreamIssuer !== this.deps.upstreamIssuer ||
        payload.sourceDigest !== row.sourceDigest
      )
        throw conflictError();
      const [claimed] = await tx
        .update(accountRecoveryBackupEvidence)
        .set({
          leaseId: randomUUID(),
          leaseUntil: new Date(Date.now() + LEASE_MS),
          revision: row.revision + 1,
        })
        .where(eq(accountRecoveryBackupEvidence.id, row.id))
        .returning();
      if (!claimed) throw conflictError();
      return { row: claimed, payload };
    });
  }

  async verify(
    proof: BackupProof,
    candidate: RelayAuthSession,
    expectedOwner: string,
  ): Promise<void> {
    const deadline = Date.now() + 30_000;
    for (const relay of proof.payload.relays) {
      if (Date.now() >= deadline) throw identityError('verification_pending');
      let self: RelayUser;
      try {
        self = assertRelayUser(await this.deps.newApi.getSelf(relay.jwt));
      } catch (error) {
        if (!relayCode(error, 'auth')) throw identityError('verification_pending');
        // The lease is acquired in PG before any network. No old BA session is recreated.
        await this.assertLiveLease(proof);
        let fresh: RelayAuthSession;
        try {
          fresh = await this.deps.newApi.refresh(relay.refreshToken);
        } catch (failure) {
          throw identityError(
            relayCode(failure, 'auth') ? 'legacy_evidence_missing' : 'verification_pending',
          );
        }
        self = await verifyFreshRelay(this.deps.newApi, fresh);
        if (String(self.id) !== expectedOwner) throw identityError('legacy_identity_conflict');
        relay.jwt = fresh.jwt;
        relay.refreshToken = fresh.refreshToken;
        await this.persistRefresh(proof);
      }
      if (String(self.id) !== expectedOwner) throw identityError('legacy_identity_conflict');
    }
    let actual: string;
    try {
      actual = await this.deps.newApi.fetchTokenKey(
        candidate.jwt,
        proof.payload.credential.externalTokenId,
      );
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'httpStatus' in error ? error.httpStatus : null;
      throw identityError(
        status === 403 || status === 404 ? 'legacy_evidence_missing' : 'verification_pending',
      );
    }
    if (
      !timingSafeEqual(
        Buffer.from(sha256(actual)),
        Buffer.from(sha256(proof.payload.credential.apiKey)),
      )
    )
      throw identityError('legacy_identity_conflict');
  }

  private async assertLiveLease(proof: BackupProof) {
    await this.deps.db.transaction(async (tx) => {
      await lockUser(tx, proof.row.targetUserId);
      const [request] = await tx
        .select()
        .from(accountRecoveryRequests)
        .where(eq(accountRecoveryRequests.id, proof.row.requestId))
        .for('update');
      if (!request) throw conflictError();
      this.checkRequest(request);
      await this.lockCandidate(tx, request);
      await this.lockProof(tx, proof);
    });
  }

  private async persistRefresh(proof: BackupProof) {
    await this.deps.db.transaction(async (tx) => {
      await lockUser(tx, proof.row.targetUserId);
      const [request] = await tx
        .select()
        .from(accountRecoveryRequests)
        .where(eq(accountRecoveryRequests.id, proof.row.requestId))
        .for('update');
      if (!request) throw conflictError();
      this.checkRequest(request);
      await this.lockCandidate(tx, request);
      await this.lockProof(tx, proof);
      const [row] = await tx
        .update(accountRecoveryBackupEvidence)
        .set({
          ciphertext: sealJsonToString(proof.payload, this.deps.encryptionKey),
          revision: proof.row.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(accountRecoveryBackupEvidence.id, proof.row.id))
        .returning();
      if (!row) throw conflictError();
      proof.row = row;
    });
  }

  async lockProof(tx: AccountTx, proof: BackupProof) {
    const [row] = await tx
      .select()
      .from(accountRecoveryBackupEvidence)
      .where(eq(accountRecoveryBackupEvidence.id, proof.row.id))
      .for('update');
    if (
      row?.state !== 'staged' ||
      row.revision !== proof.row.revision ||
      row.ciphertext !== proof.row.ciphertext ||
      row.leaseId !== proof.row.leaseId ||
      !row.leaseUntil ||
      row.leaseUntil.getTime() <= Date.now() ||
      row.expiresAt.getTime() <= Date.now()
    )
      throw conflictError();
  }

  async consume(tx: AccountTx, proof: BackupProof) {
    await this.lockProof(tx, proof);
    await tx
      .update(accountRecoveryBackupEvidence)
      .set({
        state: 'consumed',
        ciphertext: '',
        leaseId: null,
        leaseUntil: null,
        revision: proof.row.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(accountRecoveryBackupEvidence.id, proof.row.id));
  }

  async release(proof: BackupProof) {
    await this.deps.db
      .update(accountRecoveryBackupEvidence)
      .set({ leaseId: null, leaseUntil: null })
      .where(
        and(
          eq(accountRecoveryBackupEvidence.id, proof.row.id),
          eq(accountRecoveryBackupEvidence.leaseId, proof.row.leaseId ?? ''),
        ),
      );
  }

  /** Operator maintenance only: no authentication or identity changes. */
  async discardExpired() {
    await this.deps.db
      .update(accountRecoveryBackupEvidence)
      .set({
        state: 'revoked',
        ciphertext: '',
        leaseId: null,
        leaseUntil: null,
        revision: sql`${accountRecoveryBackupEvidence.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accountRecoveryBackupEvidence.state, 'staged'),
          sql`${accountRecoveryBackupEvidence.expiresAt} <= now()`,
        ),
      );
  }
}
