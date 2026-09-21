import { randomUUID } from 'node:crypto';
import {
  loginSessionReleases,
  relaySessions,
  accountRecoveryRequests,
  session,
} from '@musefold/db';
import type { RelayAuthSession } from '@musefold/new-api-client';
import { openJsonFromString, sealJsonToString } from '@musefold/server-crypto';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { AccountIdentityDependencies } from './identity-support.js';
import { AppError } from '../../lib/errors.js';

type ReleaseProof =
  | { cleanup: { sid: string; token: string } }
  | { legacy: { jwt: string; refreshToken: string } };
const pendingStates = ['candidate', 'pending'] as const;

/** Durable, issuer-pinned release queue. No session/user FK can erase cleanup
 * responsibility. A network request never runs inside a database transaction. */
export class LoginSessionReleaseQueue {
  constructor(private readonly deps: AccountIdentityDependencies) {}

  async remember(relay: RelayAuthSession): Promise<string | null> {
    if (!relay.cleanup) return null;
    const now = Date.now();
    const [row] = await this.deps.db
      .insert(loginSessionReleases)
      .values({
        id: randomUUID(),
        upstreamIssuer: this.deps.upstreamIssuer,
        upstreamSid: relay.cleanup.sid,
        ciphertext: sealJsonToString(
          { cleanup: relay.cleanup } satisfies ReleaseProof,
          this.deps.encryptionKey,
        ),
        state: 'candidate',
        nextAttemptAt: new Date(now + 5 * 60_000),
        expiresAt: new Date(now + 30 * 24 * 60 * 60_000),
      })
      .onConflictDoUpdate({
        target: [loginSessionReleases.upstreamIssuer, loginSessionReleases.upstreamSid],
        // Idempotent completion cannot resurrect a released session or postpone its deadline.
        set: { upstreamSid: relay.cleanup.sid },
      })
      .returning({ id: loginSessionReleases.id });
    return row?.id ?? null;
  }

  async bind(id: string | null, sessionId: string) {
    if (!id) return;
    await this.deps.db
      .update(loginSessionReleases)
      .set({ sessionId })
      .where(and(eq(loginSessionReleases.id, id), eq(loginSessionReleases.state, 'candidate')));
  }

  async abandon(id: string | null) {
    if (!id) return;
    await this.deps.db
      .update(loginSessionReleases)
      .set({ state: 'pending', nextAttemptAt: new Date() })
      .where(and(eq(loginSessionReleases.id, id), eq(loginSessionReleases.state, 'candidate')));
  }

  async acknowledge(sessionId: string, jwt: string) {
    const [row] = await this.deps.db
      .update(loginSessionReleases)
      .set({ state: 'active' })
      .where(
        and(
          eq(loginSessionReleases.sessionId, sessionId),
          eq(loginSessionReleases.upstreamIssuer, this.deps.upstreamIssuer),
          inArray(loginSessionReleases.state, ['candidate', 'active']),
          sql`(${loginSessionReleases.state} = 'active' OR (${loginSessionReleases.leaseId} IS NULL AND ${loginSessionReleases.nextAttemptAt} > now()))`,
          sql`EXISTS (SELECT 1 FROM session s WHERE s.id = ${sessionId} AND s.expires_at > now())`,
        ),
      )
      .returning();
    if (!row) {
      const exists = await this.deps.db.query.loginSessionReleases.findFirst({
        where: eq(loginSessionReleases.sessionId, sessionId),
      });
      if (exists) throw new AppError('AUTH_SESSION_EXPIRED', '登录已被释放，请重新登录');
      return; // Legacy host: no managed candidate to acknowledge.
    }
    // Persist responsibility before activating remotely. A crash before the
    // remote call leaves only a five-minute candidate, never an untracked login.
    await this.deps.newApi.managedSessions?.touch(jwt, true);
  }

  /** Called before BA deletes a legacy session. Managed rows already have their
   * stable release proof; never replace that proof with a rotating refresh token. */
  async captureBeforeDelete(sessionId: string) {
    const existing = await this.deps.db.query.loginSessionReleases.findFirst({
      where: eq(loginSessionReleases.sessionId, sessionId),
    });
    if (existing) return;
    const relay = await this.deps.db.query.relaySessions.findFirst({
      where: eq(relaySessions.sessionId, sessionId),
    });
    const recovery = relay
      ? undefined
      : await this.deps.db.query.accountRecoveryRequests.findFirst({
          where: eq(accountRecoveryRequests.sessionId, sessionId),
        });
    const ciphertext = relay?.ciphertext ?? recovery?.candidateCiphertext;
    const issuer = relay?.upstreamIssuer ?? recovery?.upstreamIssuer;
    if (!ciphertext || issuer !== this.deps.upstreamIssuer) return;
    const legacy = openJsonFromString<{ jwt: string; refreshToken: string }>(
      ciphertext,
      this.deps.encryptionKey,
    );
    if (!legacy.jwt || !legacy.refreshToken) return;
    await this.deps.db
      .insert(loginSessionReleases)
      .values({
        id: randomUUID(),
        sessionId,
        upstreamIssuer: issuer,
        upstreamSid: `legacy:${sessionId}`,
        ciphertext: sealJsonToString({ legacy } satisfies ReleaseProof, this.deps.encryptionKey),
        state: 'active',
        nextAttemptAt: new Date(),
        expiresAt: new Date(
          (relay?.createdAt ?? recovery?.createdAt ?? new Date()).getTime() + 30 * 24 * 60 * 60_000,
        ),
      })
      .onConflictDoNothing();
  }

  async drain(limit = 20): Promise<{ released: number; pending: number }> {
    const { db } = this.deps;
    await db
      .update(loginSessionReleases)
      .set({ state: 'pending', nextAttemptAt: new Date() })
      .where(
        and(
          eq(loginSessionReleases.state, 'active'),
          sql`NOT EXISTS (SELECT 1 FROM session s WHERE s.id = ${loginSessionReleases.sessionId} AND s.expires_at > now())`,
        ),
      );
    // An absolute deadline is an expiry bound, not a claim that remote revoke succeeded.
    await db
      .update(loginSessionReleases)
      .set({ state: 'expired', ciphertext: '', leaseId: null, leaseUntil: null })
      .where(
        and(
          inArray(loginSessionReleases.state, [...pendingStates, 'active']),
          lte(loginSessionReleases.expiresAt, new Date()),
        ),
      );
    let released = 0;
    let processed = 0;
    // Claim immediately before each request. Claiming a whole serial batch
    // would let later rows' leases expire before their network work even began.
    for (let index = 0; index < Math.min(limit, 100); index++) {
      const leaseId = randomUUID();
      const rows = await db.transaction(async (tx) => {
        const candidates = await tx
          .select()
          .from(loginSessionReleases)
          .where(
            and(
              inArray(loginSessionReleases.state, [...pendingStates]),
              lte(loginSessionReleases.nextAttemptAt, new Date()),
              sql`(${loginSessionReleases.leaseUntil} IS NULL OR ${loginSessionReleases.leaseUntil} <= now())`,
            ),
          )
          .orderBy(loginSessionReleases.nextAttemptAt)
          .limit(1)
          .for('update', { skipLocked: true });
        if (!candidates.length) return [];
        return tx
          .update(loginSessionReleases)
          .set({ leaseId, leaseUntil: new Date(Date.now() + 30_000) })
          .where(
            inArray(
              loginSessionReleases.id,
              candidates.map((item) => item.id),
            ),
          )
          .returning();
      });
      const row = rows[0];
      if (!row) break;
      processed++;
      let confirmed = false;
      try {
        if (row.upstreamIssuer !== this.deps.upstreamIssuer) throw new Error('Issuer changed');
        const proof = openJsonFromString<ReleaseProof>(row.ciphertext, this.deps.encryptionKey);
        if ('cleanup' in proof && this.deps.newApi.managedSessions) {
          if (proof.cleanup.sid !== row.upstreamSid) throw new Error('Release proof mismatch');
          await this.deps.newApi.managedSessions.release(proof.cleanup);
          confirmed = true;
        } else if ('legacy' in proof) {
          // Legacy refresh may have rotated. A 200/401 alone is not a proof of
          // whole-SID revocation, so retain the encrypted obligation until expiry.
          await this.deps.newApi.logout?.(proof.legacy);
        }
      } catch {
        /* Retry only the original pinned release, without logging secrets. */
      }
      const delay = [5_000, 30_000, 120_000][row.attempts] ?? 900_000;
      const updated = await db
        .update(loginSessionReleases)
        .set({
          ...(confirmed ? { state: 'released', ciphertext: '' } : {}),
          attempts: row.attempts + 1,
          leaseId: null,
          leaseUntil: null,
          nextAttemptAt: new Date(Date.now() + delay),
        })
        .where(
          and(
            eq(loginSessionReleases.id, row.id),
            eq(loginSessionReleases.leaseId, leaseId),
            inArray(loginSessionReleases.state, [...pendingStates]),
          ),
        )
        .returning({ id: loginSessionReleases.id });
      if (confirmed && updated.length) {
        released++;
        if (row.sessionId) await db.delete(session).where(eq(session.id, row.sessionId));
      }
    }
    return { released, pending: processed - released };
  }

  /** Aggregate operational signal only; never log account/session IDs or proof material. */
  async backlog(): Promise<number> {
    const [row] = await this.deps.db
      .select({ total: sql<number>`count(*)::int` })
      .from(loginSessionReleases)
      .where(
        and(
          inArray(loginSessionReleases.state, [...pendingStates]),
          sql`${loginSessionReleases.attempts} >= 3`,
        ),
      );
    return row?.total ?? 0;
  }
}
