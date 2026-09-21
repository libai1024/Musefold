import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AccountRecoveryReason } from '@musefold/contracts';
import {
  accountCredentials,
  accountIdentities,
  accountRecoveryRequests,
  accountSessionAuthorizations,
  oauthAccessToken,
  oauthConsent,
  oauthRefreshToken,
  relaySessions,
  session,
  user,
} from '@musefold/db';
import type { RelayAuthSession, RelayUser } from '@musefold/new-api-client';
import { openJsonFromString, sealJsonToString } from '@musefold/server-crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { AccountBackupEvidenceStore, type BackupProof } from './backup-evidence.js';
import {
  type AccountIdentityDependencies,
  type AccountTx,
  type RelayRow,
  AccountRelayVerifier,
  RECOVERY_TTL_MS,
  conflictError,
  identityError,
  lockUser,
  safeAccountError,
  verifyFreshRelay,
} from './identity-support.js';

type IdentityRow = typeof accountIdentities.$inferSelect;
type CredentialRow = typeof accountCredentials.$inferSelect;
type Proof = { sessionId: string; revision: number; ciphertext: string };
export type RecoveryRow = typeof accountRecoveryRequests.$inferSelect;

/** Process-local port only. Includes secrets; never serialize into a DTO/log/evidence row. */
export interface PreparedAccountLogin {
  userId: string;
  identity: IdentityRow;
  credential: CredentialRow | undefined;
  relay: RelayAuthSession;
  self: RelayUser;
  reason: AccountRecoveryReason | null;
  proofs: Proof[];
  proofSessionId: string | null;
  evidence: Record<string, unknown>;
  backupProof?: BackupProof;
  legacyRows?: RelayRow[];
  key?: { id: number; key: string };
}

const CLOUD_TOKEN_NAME = 'Musefold Cloud v2.5';
const MAX_LEGACY_RELAYS = 16;
const MAX_VERIFICATION_MS = 30_000;

export class AccountIdentityService {
  readonly relay: AccountRelayVerifier;
  constructor(readonly deps: AccountIdentityDependencies) {
    this.relay = new AccountRelayVerifier(deps);
  }

  async prepareLogin(input: {
    username: string;
    relay: RelayAuthSession;
    previousSessionId: string | null;
  }): Promise<PreparedAccountLogin> {
    try {
      const self = await verifyFreshRelay(this.deps.newApi, input.relay);
      const identity = await this.resolveIdentity(input.username, self, input.previousSessionId);
      return await this.prepareForIdentity(identity, input.relay, self, input.previousSessionId);
    } catch (error) {
      throw safeAccountError(error);
    }
  }

  private async resolveIdentity(
    username: string,
    self: RelayUser,
    previousSessionId: string | null,
  ): Promise<IdentityRow> {
    const { db, upstreamIssuer } = this.deps;
    const binding = await db.query.accountIdentities.findFirst({
      where: and(
        eq(accountIdentities.upstreamIssuer, upstreamIssuer),
        eq(accountIdentities.upstreamOwnerId, String(self.id)),
      ),
    });
    if (binding) return binding;
    const previous = previousSessionId
      ? await db.query.session.findFirst({
          where: and(eq(session.id, previousSessionId), gt(session.expiresAt, new Date())),
        })
      : undefined;
    // Username only locates a recovery candidate. It never authorizes an existing principal.
    const legacy = previous
      ? { id: previous.userId }
      : await db.query.user.findFirst({ where: eq(user.email, username) });
    if (legacy) {
      await db
        .insert(accountIdentities)
        .values({ userId: legacy.id, evidence: { kind: 'legacy_unverified' } })
        .onConflictDoNothing();
      const identity = await db.query.accountIdentities.findFirst({
        where: eq(accountIdentities.userId, legacy.id),
      });
      if (
        identity?.status === 'active' &&
        identity.upstreamIssuer === upstreamIssuer &&
        identity.upstreamOwnerId !== String(self.id)
      ) {
        // An already verified A is not a legacy recovery candidate for newly
        // authenticated B. Give B its own principal without touching A's data.
        return this.createFreshPrincipal(self);
      }
      if (identity) return identity;
    }
    return this.createFreshPrincipal(self);
  }

  async createFreshPrincipal(self: RelayUser): Promise<IdentityRow> {
    const { db, upstreamIssuer, apiIssuer } = this.deps;
    return db.transaction(async (tx) => {
      // A trusted source pair gets one principal, even across concurrent first logins.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([upstreamIssuer, self.id])}, 0))`,
      );
      const existing = await tx
        .select()
        .from(accountIdentities)
        .where(
          and(
            eq(accountIdentities.upstreamIssuer, upstreamIssuer),
            eq(accountIdentities.upstreamOwnerId, String(self.id)),
          ),
        );
      if (existing[0]) return existing[0];
      const id = randomUUID();
      await tx.insert(user).values({
        id,
        name: self.username,
        email: `${id}@principal.musefold.invalid`,
        emailVerified: true,
      });
      const rows = await tx
        .insert(accountIdentities)
        .values({
          userId: id,
          apiIssuer,
          upstreamIssuer,
          upstreamOwnerId: String(self.id),
          status: 'verification_pending',
          verifiedAt: new Date(),
          evidence: { kind: 'fresh_principal' },
        })
        .returning();
      if (!rows[0]) throw conflictError();
      return rows[0];
    });
  }

  async prepareForIdentity(
    identity: IdentityRow,
    relay: RelayAuthSession,
    self: RelayUser,
    proofSessionId: string | null,
    backupProof?: BackupProof,
  ): Promise<PreparedAccountLogin> {
    const credential = await this.deps.db.query.accountCredentials.findFirst({
      where: and(
        eq(accountCredentials.userId, identity.userId),
        eq(accountCredentials.provider, 'new-api'),
      ),
    });
    const prepared: PreparedAccountLogin = {
      userId: identity.userId,
      identity,
      credential,
      relay,
      self,
      reason: null,
      proofs: [],
      proofSessionId,
      evidence: {},
      ...(backupProof ? { backupProof } : {}),
    };
    if (identity.upstreamIssuer || identity.upstreamOwnerId) {
      if (
        identity.upstreamIssuer !== this.deps.upstreamIssuer ||
        identity.upstreamOwnerId !== String(self.id)
      ) {
        prepared.reason = 'legacy_identity_conflict';
      } else if (identity.status !== 'active' && identity.evidence.kind !== 'fresh_principal') {
        prepared.reason = 'verification_pending';
      } else
        prepared.evidence = {
          kind:
            identity.evidence.kind === 'fresh_principal'
              ? 'fresh_principal'
              : 'authenticated_login',
        };
    } else await this.verifyLegacy(prepared);
    if (!prepared.reason) {
      try {
        prepared.key = await this.ensureGenerationCredential(relay.jwt);
      } catch {
        prepared.reason = 'verification_pending';
      }
    }
    return prepared;
  }

  private async verifyLegacy(prepared: PreparedAccountLogin) {
    const { db, upstreamIssuer, legacyTrustedIssuer, encryptionKey, newApi } = this.deps;
    // Explicit provenance is evidence, even on a non-active row. A foreign
    // token's 403/404 must never be downgraded into permission to replace it.
    if (
      (prepared.credential?.upstreamIssuer &&
        prepared.credential.upstreamIssuer !== upstreamIssuer) ||
      (prepared.credential?.upstreamOwnerId &&
        prepared.credential.upstreamOwnerId !== String(prepared.self.id))
    ) {
      prepared.reason = 'legacy_identity_conflict';
      return;
    }
    const rows = await db
      .select()
      .from(relaySessions)
      .where(eq(relaySessions.userId, prepared.userId))
      .orderBy(asc(relaySessions.sessionId))
      .limit(MAX_LEGACY_RELAYS + 1);
    prepared.legacyRows = rows;
    if (
      (rows.some((row) => row.upstreamIssuer === null) ||
        (!rows.length && !prepared.backupProof)) &&
      legacyTrustedIssuer !== upstreamIssuer
    ) {
      prepared.reason = 'legacy_issuer_unknown';
      return;
    }
    if (rows.some((row) => row.upstreamIssuer !== null && row.upstreamIssuer !== upstreamIssuer)) {
      prepared.reason = 'legacy_issuer_unknown';
      return;
    }
    if (rows.length > MAX_LEGACY_RELAYS) {
      prepared.reason = 'verification_pending';
      return;
    }
    const deadline = Date.now() + MAX_VERIFICATION_MS;
    let transient = false;
    let missing = false;
    let contradictory = false;
    for (const row of rows) {
      if (Date.now() >= deadline) {
        transient = true;
        break;
      }
      try {
        const verified = await this.relay.read(row.sessionId, String(prepared.self.id), true);
        prepared.legacyRows = prepared.legacyRows.map((prior) =>
          prior.sessionId === row.sessionId ? verified.row : prior,
        );
        prepared.proofs.push({
          sessionId: row.sessionId,
          revision: verified.row.revision,
          ciphertext: verified.row.ciphertext,
        });
      } catch (error) {
        if (error instanceof AppError && error.code === 'ACCOUNT_RECOVERY_CONFLICT')
          contradictory = true;
        else if (
          error instanceof AppError &&
          (error.code === 'AUTH_SESSION_EXPIRED' ||
            error.details.reason === 'legacy_evidence_missing')
        )
          missing = true;
        else transient = true;
        // A failed refresh advances the lease revision without changing the
        // historical ciphertext. Pin that released bookkeeping revision for
        // the restricted result; it never becomes a successful proof.
        const released = await db.query.relaySessions.findFirst({
          where: eq(relaySessions.sessionId, row.sessionId),
        });
        if (
          released &&
          released.userId === row.userId &&
          released.revision === row.revision + 1 &&
          released.ciphertext === row.ciphertext &&
          released.upstreamIssuer === row.upstreamIssuer &&
          released.upstreamOwnerId === row.upstreamOwnerId &&
          released.keyVersion === row.keyVersion &&
          released.accessExpiresAt.getTime() === row.accessExpiresAt.getTime() &&
          !released.refreshLeaseId
        ) {
          prepared.legacyRows = prepared.legacyRows.map((prior) =>
            prior.sessionId === row.sessionId ? released : prior,
          );
        }
      }
    }
    let backupMatched = false;
    if (prepared.backupProof) {
      try {
        await new AccountBackupEvidenceStore(this.deps).verify(
          prepared.backupProof,
          prepared.relay,
          String(prepared.self.id),
        );
        backupMatched = true;
      } catch (error) {
        prepared.reason =
          error instanceof AppError && error.details.reason === 'legacy_identity_conflict'
            ? 'legacy_identity_conflict'
            : error instanceof AppError && error.details.reason === 'legacy_evidence_missing'
              ? 'legacy_evidence_missing'
              : 'verification_pending';
        // Preserve contradictory live evidence even when the imported evidence is temporarily unavailable.
        if (contradictory) prepared.reason = 'legacy_identity_conflict';
        return;
      }
    }
    let keyMatched = false;
    let keyMissing = !prepared.credential;
    if (prepared.credential) {
      try {
        const old = openJsonFromString<{ apiKey?: unknown }>(
          prepared.credential.ciphertext,
          encryptionKey,
        );
        if (
          typeof old.apiKey !== 'string' ||
          !old.apiKey ||
          !/^\d+$/.test(prepared.credential.externalTokenId ?? '')
        )
          keyMissing = true;
        else {
          try {
            const actual = await newApi.fetchTokenKey(
              prepared.relay.jwt,
              Number(prepared.credential.externalTokenId),
            );
            keyMatched = sameSecret(old.apiKey, actual);
            if (!keyMatched) contradictory = true;
          } catch (error) {
            const status =
              error && typeof error === 'object' && 'httpStatus' in error ? error.httpStatus : null;
            if (status === 403 || status === 404) keyMissing = true;
            else transient = true;
          }
        }
      } catch {
        keyMissing = true;
      }
    }
    // An unreadable present credential is not erased or excused by a matching older backup.
    if (backupMatched && prepared.credential && keyMissing) missing = true;
    keyMatched ||= backupMatched;
    const continuity =
      prepared.proofSessionId &&
      prepared.proofs.some((proof) => proof.sessionId === prepared.proofSessionId)
        ? await db.query.session.findFirst({
            where: and(eq(session.id, prepared.proofSessionId), gt(session.expiresAt, new Date())),
          })
        : undefined;
    prepared.evidence = {
      kind: 'legacy_revalidated',
      issuer: upstreamIssuer,
      verifiedAt: new Date().toISOString(),
      checked: prepared.proofs.map((proof) => ({
        sessionId: proof.sessionId,
        revision: proof.revision,
      })),
      totalRelays: rows.length,
      incomplete: transient || missing,
      keyMatched,
      keyMissing,
      sessionContinuity: Boolean(continuity),
      contradictory,
      ...(prepared.backupProof
        ? {
            backup: {
              id: prepared.backupProof.row.id,
              sourceDigest: prepared.backupProof.row.sourceDigest,
              sourceProfileId: prepared.backupProof.row.sourceProfileId,
              relayCount: prepared.backupProof.payload.relays.length,
              sessionContinuity: false,
            },
          }
        : {}),
    };
    if (contradictory) prepared.reason = 'legacy_identity_conflict';
    else if (transient) prepared.reason = 'verification_pending';
    // Unchecked/unverifiable old rows cannot be interpreted as absence of contradictory evidence.
    else if (missing || (!prepared.proofs.length && !backupMatched) || (!continuity && !keyMatched))
      prepared.reason = 'legacy_evidence_missing';
    else if (!keyMatched && !keyMissing) prepared.reason = 'legacy_evidence_missing';
  }

  private async ensureGenerationCredential(jwt: string): Promise<{ id: number; key: string }> {
    const { newApi } = this.deps;
    const choose = (tokens: Awaited<ReturnType<typeof newApi.listTokens>>) =>
      tokens
        .filter(
          (token) =>
            token.name === CLOUD_TOKEN_NAME &&
            token.status === 1 &&
            Number.isSafeInteger(token.id) &&
            token.id > 0,
        )
        .sort((a, b) => b.id - a.id)[0];
    let token = choose(await newApi.listTokens(jwt));
    if (!token) {
      await newApi.createToken(jwt, { name: CLOUD_TOKEN_NAME });
      token = choose(await newApi.listTokens(jwt));
    }
    if (!token) throw identityError('verification_pending');
    const key = await newApi.fetchTokenKey(jwt, token.id);
    if (!key || key.length > 8192) throw identityError('verification_pending');
    return { id: token.id, key };
  }

  async commitLogin(
    prepared: PreparedAccountLogin,
    sessionId: string,
    fence?: (tx: AccountTx) => Promise<void>,
    afterAuthorization?: (tx: AccountTx) => Promise<void>,
  ): Promise<void> {
    try {
      await this.deps.db.transaction(async (tx) => {
        await fence?.(tx);
        await this.lockPrepared(tx, prepared);
        const live = await tx
          .select()
          .from(session)
          .where(
            and(
              eq(session.id, sessionId),
              eq(session.userId, prepared.userId),
              gt(session.expiresAt, new Date()),
            ),
          )
          .for('update');
        if (!live[0]) throw new AppError('AUTH_SESSION_EXPIRED', '登录会话已失效');
        if (prepared.reason) await this.commitRecovery(tx, prepared, sessionId);
        else await this.activate(tx, prepared, sessionId);
        await afterAuthorization?.(tx);
      });
    } catch (error) {
      throw safeAccountError(error);
    }
  }

  async lockPrepared(tx: AccountTx, prepared: PreparedAccountLogin) {
    await lockUser(tx, prepared.userId);
    const identity = await tx
      .select()
      .from(accountIdentities)
      .where(eq(accountIdentities.userId, prepared.userId))
      .for('update');
    if (!identity[0] || identity[0].identityVersion !== prepared.identity.identityVersion)
      throw conflictError();
    const credential = await tx
      .select()
      .from(accountCredentials)
      .where(
        and(
          eq(accountCredentials.userId, prepared.userId),
          eq(accountCredentials.provider, 'new-api'),
        ),
      )
      .for('update');
    for (const key of [
      'credentialVersion',
      'ciphertext',
      'upstreamIssuer',
      'upstreamOwnerId',
      'credentialRef',
      'status',
      'externalTokenId',
      'keyVersion',
    ] as const) {
      if ((credential[0]?.[key] ?? null) !== (prepared.credential?.[key] ?? null))
        throw conflictError();
    }
    if (prepared.legacyRows) {
      const all = await tx
        .select()
        .from(relaySessions)
        .where(eq(relaySessions.userId, prepared.userId))
        .orderBy(asc(relaySessions.sessionId))
        .for('update');
      if (all.length !== prepared.legacyRows.length) throw conflictError();
      for (let index = 0; index < all.length; index += 1) {
        const current = all[index];
        const prior = prepared.legacyRows[index];
        if (
          !current ||
          !prior ||
          current.sessionId !== prior.sessionId ||
          current.revision !== prior.revision ||
          current.ciphertext !== prior.ciphertext ||
          current.upstreamIssuer !== prior.upstreamIssuer ||
          current.upstreamOwnerId !== prior.upstreamOwnerId ||
          current.keyVersion !== prior.keyVersion ||
          current.refreshLeaseId
        )
          throw conflictError();
      }
    }
    for (const proof of prepared.proofs) {
      const rows = await tx
        .select()
        .from(relaySessions)
        .where(
          and(
            eq(relaySessions.sessionId, proof.sessionId),
            eq(relaySessions.userId, prepared.userId),
          ),
        )
        .for('update');
      if (
        !rows[0] ||
        rows[0].revision !== proof.revision ||
        rows[0].ciphertext !== proof.ciphertext ||
        rows[0].refreshLeaseId
      )
        throw conflictError();
    }
    // Recheck the entire evidence set. A newly added competing relay must force fresh verification.
    if (prepared.evidence.kind === 'legacy_revalidated') {
      const all = await tx
        .select({ id: relaySessions.sessionId })
        .from(relaySessions)
        .where(eq(relaySessions.userId, prepared.userId));
      if (all.length !== prepared.evidence.totalRelays) throw conflictError();
      if (prepared.proofSessionId && prepared.evidence.sessionContinuity) {
        const original = await tx
          .select()
          .from(session)
          .where(and(eq(session.id, prepared.proofSessionId), gt(session.expiresAt, new Date())))
          .for('update');
        if (!original[0]) throw conflictError();
      }
    }
  }

  private async commitRecovery(tx: AccountTx, prepared: PreparedAccountLogin, sessionId: string) {
    const reason = prepared.reason;
    if (!reason) throw conflictError();
    let version = prepared.identity.identityVersion;
    // A conflicting login cannot disable another already verified principal.
    if (prepared.identity.status !== 'active') {
      version += 1;
      await tx
        .update(accountIdentities)
        .set({
          status: recoveryStatus(reason),
          identityVersion: version,
          updatedAt: new Date(),
          evidence:
            prepared.identity.evidence.kind === 'fresh_principal'
              ? prepared.identity.evidence
              : prepared.evidence,
        })
        .where(eq(accountIdentities.userId, prepared.userId));
    }
    await tx
      .insert(accountSessionAuthorizations)
      .values({ sessionId, userId: prepared.userId, mode: 'recovery_only' });
    await tx.insert(accountRecoveryRequests).values({
      id: randomUUID(),
      sessionId,
      targetUserId: prepared.userId,
      upstreamIssuer: this.deps.upstreamIssuer,
      upstreamOwnerId: String(prepared.self.id),
      candidateCiphertext: sealJsonToString(prepared.relay, this.deps.encryptionKey),
      candidateSummary: prepared.self as unknown as Record<string, unknown>,
      reason,
      identityVersion: version,
      evidence: prepared.evidence,
      expiresAt: new Date(Date.now() + RECOVERY_TTL_MS),
    });
  }

  async activate(tx: AccountTx, prepared: PreparedAccountLogin, sessionId: string) {
    if (!prepared.key || prepared.reason) throw conflictError();
    const { apiIssuer, upstreamIssuer, encryptionKey } = this.deps;
    const ownerId = String(prepared.self.id);
    const collision = await tx
      .select({ userId: accountIdentities.userId })
      .from(accountIdentities)
      .where(
        and(
          eq(accountIdentities.upstreamIssuer, upstreamIssuer),
          eq(accountIdentities.upstreamOwnerId, ownerId),
        ),
      );
    if (collision[0] && collision[0].userId !== prepared.userId) throw conflictError();
    let same = false;
    if (
      prepared.credential?.status === 'active' &&
      prepared.credential.upstreamIssuer === upstreamIssuer &&
      prepared.credential.upstreamOwnerId === ownerId &&
      prepared.credential.externalTokenId === String(prepared.key.id)
    ) {
      try {
        same = sameSecret(
          openJsonFromString<{ apiKey: string }>(prepared.credential.ciphertext, encryptionKey)
            .apiKey,
          prepared.key.key,
        );
      } catch {
        /* A corrupt prior envelope is replaced only with this verified credential. */
      }
    }
    const version = same
      ? (prepared.credential?.credentialVersion ?? 1)
      : (prepared.credential?.credentialVersion ?? 0) + 1;
    if (
      prepared.identity.status !== 'active' &&
      prepared.identity.evidence.kind !== 'fresh_principal'
    ) {
      // Pre-migration OAuth grants carry no trusted session provenance. Keep
      // token rows as revoked audit evidence and require explicit authorization.
      const revoked = new Date();
      await tx.delete(oauthConsent).where(eq(oauthConsent.userId, prepared.userId));
      await tx
        .update(oauthAccessToken)
        .set({ revoked })
        .where(
          and(
            eq(oauthAccessToken.userId, prepared.userId),
            sql`${oauthAccessToken.revoked} IS NULL`,
          ),
        );
      await tx
        .update(oauthRefreshToken)
        .set({ revoked })
        .where(
          and(
            eq(oauthRefreshToken.userId, prepared.userId),
            sql`${oauthRefreshToken.revoked} IS NULL`,
          ),
        );
    }
    await tx
      .update(accountIdentities)
      .set({
        apiIssuer,
        upstreamIssuer,
        upstreamOwnerId: ownerId,
        status: 'active',
        identityVersion: prepared.identity.identityVersion + 1,
        verifiedAt: new Date(),
        evidence: prepared.evidence,
        updatedAt: new Date(),
      })
      .where(eq(accountIdentities.userId, prepared.userId));
    const values = {
      userId: prepared.userId,
      provider: 'new-api',
      externalTokenId: String(prepared.key.id),
      ciphertext: sealJsonToString({ apiKey: prepared.key.key }, encryptionKey),
      upstreamIssuer,
      upstreamOwnerId: ownerId,
      credentialRef: prepared.credential?.credentialRef ?? randomUUID(),
      credentialVersion: version,
      status: 'active',
      verifiedAt: new Date(),
      updatedAt: new Date(),
    };
    await tx
      .insert(accountCredentials)
      .values(values)
      .onConflictDoUpdate({
        target: [accountCredentials.userId, accountCredentials.provider],
        set: values,
      });
    await tx.insert(relaySessions).values({
      sessionId,
      userId: prepared.userId,
      upstreamIssuer,
      upstreamOwnerId: ownerId,
      ciphertext: sealJsonToString(
        { jwt: prepared.relay.jwt, refreshToken: prepared.relay.refreshToken },
        encryptionKey,
      ),
      accessExpiresAt: new Date(prepared.relay.jwtExpiresAt * 1000),
      revision: 1,
      verifiedAt: new Date(),
    });
    await tx
      .insert(accountSessionAuthorizations)
      .values({ sessionId, userId: prepared.userId, mode: 'normal' })
      .onConflictDoUpdate({
        target: accountSessionAuthorizations.sessionId,
        set: {
          userId: prepared.userId,
          mode: 'normal',
          revision: sql`${accountSessionAuthorizations.revision} + 1`,
        },
      });
    if (prepared.proofSessionId && prepared.evidence.sessionContinuity) {
      await tx
        .update(relaySessions)
        .set({
          upstreamIssuer,
          upstreamOwnerId: ownerId,
          verifiedAt: new Date(),
          revision: sql`${relaySessions.revision} + 1`,
        })
        .where(eq(relaySessions.sessionId, prepared.proofSessionId));
      await tx
        .insert(accountSessionAuthorizations)
        .values({
          sessionId: prepared.proofSessionId,
          userId: prepared.userId,
          mode: 'normal',
        })
        .onConflictDoUpdate({
          target: accountSessionAuthorizations.sessionId,
          set: {
            mode: 'normal',
            revision: sql`${accountSessionAuthorizations.revision} + 1`,
          },
        });
    }
  }
}

export function recoveryStatus(reason: AccountRecoveryReason) {
  return reason === 'legacy_identity_conflict'
    ? ('identity_conflict' as const)
    : reason === 'verification_pending'
      ? ('verification_pending' as const)
      : ('recovery_required' as const);
}

function sameSecret(left: string, right: string): boolean {
  // Fixed-length digests make comparison independent of input length; values are never logged.
  return timingSafeEqual(
    createHash('sha256').update(left).digest(),
    createHash('sha256').update(right).digest(),
  );
}
