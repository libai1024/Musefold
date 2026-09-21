import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  type CompleteLoginCapacity,
  type LoginCapacityReview,
  type LoginRequest,
  loginCapacityReviewSchema,
} from '@musefold/contracts';
import { loginCapacityFlows, loginSessionReleases, session } from '@musefold/db';
import type { RelayAuthSession } from '@musefold/new-api-client';
import { openJsonFromString, sealJsonToString } from '@musefold/server-crypto';
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import {
  type AccountIdentityDependencies,
  type AccountTx,
  safeAccountError,
} from './identity-support.js';
import { LoginSessionReleaseQueue } from './login-session-release.js';
import { projectLoginSessions } from './login-session-projection.js';
import { loginSessionRefs } from './login-session-ref.js';

type FlowSecrets = {
  upstreamToken: string;
  username: string;
  userAgent: string;
  resultToken?: string;
};
type FlowRow = typeof loginCapacityFlows.$inferSelect;
/** Server-only completion fence; never a public DTO. */
export type ManagedLoginCommit = {
  flowId: string;
  leaseId: string;
  releaseId: string | null;
  resultToken: string;
};
const expired = () => new AppError('AUTH_LOGIN_CHALLENGE_EXPIRED', '验证已过期，请重新登录', 401);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class LoginCapacityService {
  readonly releases: LoginSessionReleaseQueue;
  constructor(private readonly deps: AccountIdentityDependencies) {
    this.releases = new LoginSessionReleaseQueue(deps);
  }
  private get upstream() {
    if (!this.deps.newApi.managedSessions)
      throw new AppError(
        'AUTH_SESSION_MANAGEMENT_UNAVAILABLE',
        '账号服务器尚未支持登录设备管理',
        503,
      );
    return this.deps.newApi.managedSessions;
  }
  private seal(value: FlowSecrets) {
    return sealJsonToString(value, this.deps.encryptionKey);
  }
  private open(row: FlowRow) {
    return openJsonFromString<FlowSecrets>(row.ciphertext, this.deps.encryptionKey);
  }
  private refs(flowId: string) {
    return loginSessionRefs(this.deps.encryptionKey, this.deps.upstreamIssuer, `flow:${flowId}`);
  }
  private assertBound(row: FlowRow | undefined, binding: string): asserts row is FlowRow {
    if (
      !row ||
      binding.length < 32 ||
      binding.length > 128 ||
      row.upstreamIssuer !== this.deps.upstreamIssuer ||
      row.expiresAt.getTime() <= Date.now() ||
      row.state === 'cancelled'
    )
      throw expired();
    const expected = Buffer.from(row.bindingHash, 'hex');
    const supplied = Buffer.from(digest(binding), 'hex');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      throw expired();
  }
  async begin(
    input: LoginRequest,
    binding: string,
    userAgent: string,
  ): Promise<LoginCapacityReview> {
    if (binding.length < 32 || binding.length > 128) throw expired();
    try {
      const grant = await this.upstream.begin(input);
      const id = randomUUID();
      const expiresAt = new Date(Math.min(grant.expires_at * 1000, Date.now() + 5 * 60_000));
      await this.deps.db.insert(loginCapacityFlows).values({
        id,
        bindingHash: digest(binding),
        upstreamIssuer: this.deps.upstreamIssuer,
        expiresAt,
        ciphertext: this.seal({
          upstreamToken: grant.flow_token,
          username: input.username,
          userAgent: userAgent.slice(0, 512),
        }),
      });
      return loginCapacityReviewSchema.parse({
        flowRef: id,
        expiresAt: expiresAt.toISOString(),
        sessions: projectLoginSessions(grant.sessions, this.refs(id).encode),
      });
    } catch (error) {
      throw safeAccountError(error);
    }
  }
  async review(id: string, binding: string): Promise<LoginCapacityReview> {
    const row = await this.deps.db.query.loginCapacityFlows.findFirst({
      where: eq(loginCapacityFlows.id, id),
    });
    this.assertBound(row, binding);
    if (row.state !== 'pending')
      throw new AppError('AUTH_OPERATION_CONFLICT', '请先核对正在进行的原登录请求', 409, true);
    try {
      const review = await this.upstream.review(this.open(row).upstreamToken);
      return loginCapacityReviewSchema.parse({
        flowRef: row.id,
        expiresAt: row.expiresAt.toISOString(),
        sessions: projectLoginSessions(review.sessions, this.refs(id).encode),
      });
    } catch (error) {
      throw safeAccountError(error);
    }
  }
  async cancel(id: string, binding: string) {
    const row = await this.deps.db.transaction(async (tx) => {
      const [flow] = await tx
        .select()
        .from(loginCapacityFlows)
        .where(eq(loginCapacityFlows.id, id))
        .for('update');
      this.assertBound(flow, binding);
      if (flow.state !== 'pending')
        throw new AppError(
          'AUTH_OPERATION_CONFLICT',
          '登录请求正在核对，不能将未知结果当作取消',
          409,
        );
      await tx
        .update(loginCapacityFlows)
        .set({ state: 'cancelled', ciphertext: '' })
        .where(eq(loginCapacityFlows.id, id));
      return flow;
    });
    // Cancellation cannot revoke any existing session. Expiry is the safe
    // fallback when the upstream flow cancellation is temporarily unavailable.
    await this.upstream.cancel(this.open(row).upstreamToken).catch(() => undefined);
  }
  async complete(
    input: CompleteLoginCapacity,
    binding: string,
    establish: (input: {
      relay: RelayAuthSession;
      username: string;
      releaseId: string | null;
      managed: ManagedLoginCommit;
    }) => Promise<string>,
  ): Promise<string> {
    const selectionDigest = digest(
      JSON.stringify([...input.selected].sort((a, b) => a.sessionRef.localeCompare(b.sessionRef))),
    );
    const leaseId = randomUUID();
    const row = await this.deps.db.transaction(async (tx) => {
      const [flow] = await tx
        .select()
        .from(loginCapacityFlows)
        .where(eq(loginCapacityFlows.id, input.flowRef))
        .for('update');
      this.assertBound(flow, binding);
      if (
        flow.operationId &&
        (flow.operationId !== input.operationId || flow.selectionDigest !== selectionDigest)
      )
        throw new AppError(
          'AUTH_OPERATION_CONFLICT',
          '请核对原登录请求，不能更换已提交的选择',
          409,
        );
      if (flow.state === 'completed') return flow;
      if (flow.leaseUntil && flow.leaseUntil.getTime() > Date.now())
        throw new AppError('AUTH_OPERATION_CONFLICT', '原登录请求仍在处理，请稍后核对', 409, true);
      const [claimed] = await tx
        .update(loginCapacityFlows)
        .set({
          state: 'working',
          operationId: input.operationId,
          selectionDigest,
          leaseId,
          leaseUntil: new Date(Date.now() + 30_000),
          // Reserve delivery before creating BA. Its unique token lets a restart
          // recover the same candidate even if creation's response was lost.
          ciphertext: this.seal({
            ...this.open(flow),
            resultToken: this.open(flow).resultToken ?? randomBytes(32).toString('base64url'),
          }),
        })
        .where(eq(loginCapacityFlows.id, flow.id))
        .returning();
      if (!claimed) throw expired();
      return claimed;
    });
    const secrets = this.open(row);
    if (row.state === 'completed' && secrets.resultToken) return secrets.resultToken;
    if (!secrets.resultToken) throw expired();
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this.deps.db
        .update(loginCapacityFlows)
        .set({ leaseUntil: new Date(Date.now() + 30_000) })
        .where(
          and(
            eq(loginCapacityFlows.id, row.id),
            eq(loginCapacityFlows.state, 'working'),
            eq(loginCapacityFlows.leaseId, leaseId),
            gt(loginCapacityFlows.expiresAt, new Date()),
          ),
        )
        .catch(() => undefined)
        .finally(() => {
          renewing = false;
        });
    }, 10_000);
    heartbeat.unref();
    let releaseId: string | null = null;
    let upstreamCompleted = false;
    try {
      const relay = await this.upstream.complete(
        secrets.upstreamToken,
        input.operationId,
        input.selected.map((item) => ({
          sid: this.refs(row.id).decode(item.sessionRef),
          version: item.version,
        })),
        secrets.userAgent,
      );
      upstreamCompleted = true;
      releaseId = await this.releases.remember(relay);
      // Invalidate BA dispatch authority for only the actually revoked SIDs,
      // before delivering the replacement. If capacity became free, upstream
      // returns an empty receipt and all unnecessarily selected devices stay live.
      if (relay.revokedSessionIds?.length) {
        await this.deps.db.delete(session).where(
          inArray(
            session.id,
            this.deps.db
              .select({ id: loginSessionReleases.sessionId })
              .from(loginSessionReleases)
              .where(
                and(
                  eq(loginSessionReleases.upstreamIssuer, this.deps.upstreamIssuer),
                  inArray(loginSessionReleases.upstreamSid, relay.revokedSessionIds),
                ),
              ),
          ),
        );
      }
      const token = await establish({
        relay,
        username: secrets.username,
        releaseId,
        managed: { flowId: row.id, leaseId, releaseId, resultToken: secrets.resultToken },
      });
      const saved = await this.deps.db.query.loginCapacityFlows.findFirst({
        where: eq(loginCapacityFlows.id, row.id),
      });
      if (saved?.state !== 'completed' || this.open(saved).resultToken !== token)
        throw new AppError('AUTH_OPERATION_CONFLICT', '登录结果需核对，请重试原请求', 409);
      return token;
    } catch (error) {
      const current = await this.deps.db.query.loginCapacityFlows.findFirst({
        where: eq(loginCapacityFlows.id, row.id),
      });
      // Identity authorization and the delivery receipt commit atomically. A
      // lost DB response must not turn that successful login into compensation.
      const completedToken =
        current?.state === 'completed' ? this.open(current).resultToken : undefined;
      if (completedToken) return completedToken;
      const mapped = safeAccountError(error);
      const reviewAgain =
        mapped.code === 'AUTH_SESSION_LIMIT' || mapped.code === 'AUTH_SESSION_REVIEW_CHANGED';
      // Unknown upstream completion keeps its exact operation/selection for
      // replay. A rejected selection may be freshly reviewed and re-confirmed.
      const cancelled = await this.deps.db
        .update(loginCapacityFlows)
        .set({
          leaseId: null,
          leaseUntil: null,
          ...(reviewAgain ? { state: 'pending', operationId: null, selectionDigest: null } : {}),
          ...(upstreamCompleted ? { state: 'cancelled', ciphertext: '' } : {}),
        })
        .where(and(eq(loginCapacityFlows.id, row.id), eq(loginCapacityFlows.leaseId, leaseId)))
        .returning({ id: loginCapacityFlows.id });
      if (upstreamCompleted && cancelled.length) {
        await this.deps.db.delete(session).where(eq(session.token, secrets.resultToken));
        await this.releases.abandon(releaseId);
      }
      throw mapped;
    } finally {
      clearInterval(heartbeat);
    }
  }
  async attachSession(managed: ManagedLoginCommit, sessionId: string) {
    const attached = await this.deps.db
      .update(loginCapacityFlows)
      .set({ sessionId })
      .where(
        and(
          eq(loginCapacityFlows.id, managed.flowId),
          eq(loginCapacityFlows.state, 'working'),
          eq(loginCapacityFlows.leaseId, managed.leaseId),
          gt(loginCapacityFlows.leaseUntil, new Date()),
          gt(loginCapacityFlows.expiresAt, new Date()),
        ),
      )
      .returning({ id: loginCapacityFlows.id });
    if (!attached.length)
      throw new AppError('AUTH_OPERATION_CONFLICT', '原登录请求已变化，请核对原请求', 409);
    await this.releases.bind(managed.releaseId, sessionId);
  }
  async canDiscard(managed: ManagedLoginCommit) {
    const row = await this.deps.db.query.loginCapacityFlows.findFirst({
      where: eq(loginCapacityFlows.id, managed.flowId),
    });
    return row?.state === 'working' && row.leaseId === managed.leaseId;
  }
  async completedToken(managed: ManagedLoginCommit) {
    const row = await this.deps.db.query.loginCapacityFlows.findFirst({
      where: eq(loginCapacityFlows.id, managed.flowId),
    });
    return row?.state === 'completed' ? this.open(row).resultToken : undefined;
  }
  /** Called inside the SAME transaction as business session authorization. */
  async commitInTransaction(tx: AccountTx, managed: ManagedLoginCommit, sessionId: string) {
    const [flow] = await tx
      .select()
      .from(loginCapacityFlows)
      .where(eq(loginCapacityFlows.id, managed.flowId))
      .for('update');
    if (
      flow?.state !== 'working' ||
      flow.leaseId !== managed.leaseId ||
      !flow.leaseUntil ||
      flow.leaseUntil.getTime() <= Date.now() ||
      flow.expiresAt.getTime() <= Date.now() ||
      this.open(flow).resultToken !== managed.resultToken ||
      flow.sessionId !== sessionId
    )
      throw new AppError('AUTH_OPERATION_CONFLICT', '登录请求已过期或变化，请核对原请求', 409);
    const [release] = await tx
      .select()
      .from(loginSessionReleases)
      .where(eq(loginSessionReleases.id, managed.releaseId ?? ''))
      .for('update');
    if (
      release?.state !== 'candidate' ||
      release.leaseId ||
      release.nextAttemptAt.getTime() <= Date.now() ||
      release.sessionId !== sessionId
    )
      throw expired();
    await tx
      .update(loginCapacityFlows)
      .set({ state: 'completed', leaseId: null, leaseUntil: null })
      .where(eq(loginCapacityFlows.id, flow.id));
  }
  async sweep() {
    await this.deps.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(loginCapacityFlows)
        .where(
          and(
            lte(loginCapacityFlows.expiresAt, new Date()),
            sql`${loginCapacityFlows.ciphertext} <> ''`,
          ),
        )
        .limit(100)
        .for('update', { skipLocked: true });
      for (const row of rows) {
        // A bare BA row may have been created just before a crash. Its reserved
        // token identifies only this candidate, never a prior working login.
        if (row.state === 'working') {
          const token = this.open(row).resultToken;
          if (token) await tx.delete(session).where(eq(session.token, token));
        }
        await tx
          .update(loginCapacityFlows)
          .set({ ciphertext: '', state: 'cancelled', leaseId: null, leaseUntil: null })
          .where(eq(loginCapacityFlows.id, row.id));
      }
      await tx
        .delete(loginCapacityFlows)
        .where(lte(loginCapacityFlows.expiresAt, new Date(Date.now() - 24 * 60 * 60_000)));
    });
    return this.releases.drain();
  }
}
