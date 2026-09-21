import {
  accountRecoveryReviewSchema,
  type AccountRecoveryReview,
  type AccountSummary,
} from '@musefold/contracts';
import {
  accountIdentities,
  accountRecoveryBackupEvidence,
  accountRecoveryRequests,
  accountSessionAuthorizations,
  session,
} from '@musefold/db';
import type { RelayAuthSession } from '@musefold/new-api-client';
import { openJsonFromString } from '@musefold/server-crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { AccountBackupEvidenceStore, type BackupProof } from './backup-evidence.js';
import {
  type AccountIdentityService,
  type PreparedAccountLogin,
  type RecoveryRow,
  recoveryStatus,
} from './identity.js';
import {
  conflictError,
  identityError,
  lockUser,
  safeAccountError,
  verifyFreshRelay,
} from './identity-support.js';

const unavailable = () => new AppError('ACCOUNT_RECOVERY_CONFLICT', '恢复申请不可用', 404);

export class AccountRecoveryService {
  constructor(
    private readonly identity: AccountIdentityService,
    private readonly getStatus: (sessionId: string) => Promise<AccountSummary>,
  ) {}

  private async request(requestId: string): Promise<RecoveryRow> {
    const row = await this.identity.deps.db.query.accountRecoveryRequests.findFirst({
      where: eq(accountRecoveryRequests.id, requestId),
    });
    if (!row) throw unavailable();
    return row;
  }

  private checkExpiry(row: RecoveryRow) {
    if (row.status !== 'completed' && row.expiresAt.getTime() <= Date.now()) {
      throw new AppError('ACCOUNT_RECOVERY_EXPIRED', '恢复申请已过期，请重新登录后发起', 410);
    }
    if (row.upstreamIssuer !== this.identity.deps.upstreamIssuer) {
      throw new AppError('ACCOUNT_IDENTITY_SOURCE_CHANGED', '账号服务来源已变化，请重新登录', 403);
    }
  }

  private async candidate(row: RecoveryRow) {
    this.checkExpiry(row);
    let relay: RelayAuthSession;
    try {
      relay = openJsonFromString<RelayAuthSession>(
        row.candidateCiphertext,
        this.identity.deps.encryptionKey,
      );
    } catch {
      throw unavailable();
    }
    const self = await verifyFreshRelay(this.identity.deps.newApi, relay);
    if (String(self.id) !== row.upstreamOwnerId) throw conflictError();
    return { relay, self };
  }

  async inspect(sessionId: string, requestId: string): Promise<AccountRecoveryReview> {
    try {
      const row = await this.proveOriginalSession(sessionId, requestId);
      const { self } = await this.candidate(row);
      return accountRecoveryReviewSchema.parse({
        requestId: row.id,
        expiresAt: row.expiresAt.toISOString(),
        candidate: {
          issuer: row.upstreamIssuer,
          ownerId: row.upstreamOwnerId,
          username: self.username,
          displayName: null,
        },
      });
    } catch (error) {
      throw safeAccountError(error);
    }
  }

  private async proveOriginalSession(sessionId: string, requestId: string) {
    const row = await this.request(requestId);
    const original = await this.identity.deps.db.query.session.findFirst({
      where: and(eq(session.id, sessionId), gt(session.expiresAt, new Date())),
    });
    if (
      !original ||
      original.userId !== row.targetUserId ||
      sessionId === row.sessionId ||
      row.status !== 'pending'
    )
      throw unavailable();
    this.checkExpiry(row);
    // The caller actually possesses this pre-existing BA session; no bearer is copied from the recovery device.
    try {
      await this.identity.relay.read(sessionId, row.upstreamOwnerId);
    } catch {
      throw unavailable();
    }
    return row;
  }

  async verifyOriginal(sessionId: string, requestId: string): Promise<AccountSummary> {
    const row = await this.request(requestId);
    // A repeated receipt is readable only by a matching previously verified original principal.
    if (row.status === 'completed') {
      const original = await this.identity.deps.db.query.accountSessionAuthorizations.findFirst({
        where: eq(accountSessionAuthorizations.sessionId, sessionId),
      });
      if (original?.mode !== 'normal' || original.userId !== row.completedUserId)
        throw unavailable();
      return this.getStatus(sessionId);
    }
    await this.proveOriginalSession(sessionId, requestId);
    return this.resolve(row, sessionId, false);
  }

  async retry(sessionId: string, requestId: string): Promise<AccountSummary> {
    const row = await this.request(requestId);
    if (row.sessionId !== sessionId) throw unavailable();
    if (row.status === 'completed') return this.getStatus(sessionId);
    return this.resolve(row, null, false);
  }

  async independent(sessionId: string, requestId: string): Promise<AccountSummary> {
    const row = await this.request(requestId);
    if (row.sessionId !== sessionId) throw unavailable();
    if (row.status === 'completed') return this.getStatus(sessionId);
    return this.resolve(row, null, true);
  }

  private async resolve(
    row: RecoveryRow,
    originalSessionId: string | null,
    independent: boolean,
  ): Promise<AccountSummary> {
    const backups = new AccountBackupEvidenceStore(this.identity.deps);
    let backup: BackupProof | undefined;
    try {
      const { relay, self } = await this.candidate(row);
      if (!independent && !originalSessionId) backup = await backups.claim(row);
      const identity = independent
        ? await this.identity.createFreshPrincipal(self)
        : await this.identity.deps.db.query.accountIdentities.findFirst({
            where: eq(accountIdentities.userId, row.targetUserId),
          });
      if (!identity) throw unavailable();
      const prepared = await this.identity.prepareForIdentity(
        identity,
        relay,
        self,
        originalSessionId,
        backup,
      );
      await this.commit(row, prepared, independent);
      if (originalSessionId && prepared.reason) throw identityError(prepared.reason);
      return this.getStatus(originalSessionId ?? row.sessionId);
    } catch (error) {
      throw safeAccountError(error);
    } finally {
      if (backup) await backups.release(backup);
    }
  }

  private async commit(
    snapshot: RecoveryRow,
    prepared: PreparedAccountLogin,
    independent: boolean,
  ) {
    await this.identity.deps.db.transaction(async (tx) => {
      if (snapshot.targetUserId !== prepared.userId) await lockUser(tx, snapshot.targetUserId);
      await this.identity.lockPrepared(tx, prepared);
      const requests = await tx
        .select()
        .from(accountRecoveryRequests)
        .where(eq(accountRecoveryRequests.id, snapshot.id))
        .for('update');
      const current = requests[0];
      if (
        !current ||
        current.revision !== snapshot.revision ||
        current.status !== 'pending' ||
        current.candidateCiphertext !== snapshot.candidateCiphertext
      )
        throw conflictError();
      const backups = new AccountBackupEvidenceStore(this.identity.deps);
      this.checkExpiry(current);
      const live = await tx
        .select()
        .from(session)
        .where(
          and(
            eq(session.id, current.sessionId),
            eq(session.userId, current.targetUserId),
            gt(session.expiresAt, new Date()),
          ),
        )
        .for('update');
      const authorization = await tx
        .select()
        .from(accountSessionAuthorizations)
        .where(eq(accountSessionAuthorizations.sessionId, current.sessionId))
        .for('update');
      if (
        !live[0] ||
        authorization[0]?.mode !== 'recovery_only' ||
        authorization[0].userId !== current.targetUserId
      )
        throw conflictError();
      if (prepared.backupProof) await backups.lockProof(tx, prepared.backupProof);
      if (prepared.reason) {
        await tx
          .update(accountRecoveryRequests)
          .set({
            reason: prepared.reason,
            evidence: prepared.evidence,
            revision: current.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(accountRecoveryRequests.id, current.id));
        if (prepared.identity.status !== 'active')
          await tx
            .update(accountIdentities)
            .set({
              status: recoveryStatus(prepared.reason),
              identityVersion: prepared.identity.identityVersion + 1,
              updatedAt: new Date(),
            })
            .where(eq(accountIdentities.userId, prepared.userId));
        return;
      }
      if (prepared.userId !== current.targetUserId) {
        if (!independent) throw conflictError();
        // Only this restricted session may switch principal. Existing normal sessions/data stay untouched.
        await tx
          .update(session)
          .set({ userId: prepared.userId, updatedAt: new Date() })
          .where(eq(session.id, current.sessionId));
      }
      await this.identity.activate(tx, prepared, current.sessionId);
      if (prepared.backupProof) await backups.consume(tx, prepared.backupProof);
      else
        await tx
          .update(accountRecoveryBackupEvidence)
          .set({
            state: 'revoked',
            ciphertext: '',
            leaseId: null,
            leaseUntil: null,
            revision: sql`${accountRecoveryBackupEvidence.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(accountRecoveryBackupEvidence.requestId, current.id));
      await tx
        .update(accountRecoveryRequests)
        .set({
          status: 'completed',
          completedUserId: prepared.userId,
          revision: current.revision + 1,
          candidateCiphertext: '',
          evidence: prepared.evidence,
          updatedAt: new Date(),
        })
        .where(eq(accountRecoveryRequests.id, current.id));
    });
  }
}
