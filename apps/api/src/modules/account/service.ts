import {
  type AccountSummary,
  type ExecutionBinding,
  type RedeemResult,
  accountExecutionIdentitySchema,
  accountModelCatalogSchema,
  accountExecutionBindingSchema,
  accountSummarySchema,
  accountNoticesSchema,
  accountRecoveryReasonSchema,
} from '@musefold/contracts';
import { projectAccountModelPrices } from '@musefold/domain/cloud-model-pricing';
import {
  accountCredentials,
  accountIdentities,
  accountRecoveryRequests,
  accountSessionAuthorizations,
  loginSessionReleases,
  session,
} from '@musefold/db';
import {
  normalizeNewApiUrl,
  type RelayAuthSession,
  type RelayUser,
} from '@musefold/new-api-client';
import { openJsonFromString } from '@musefold/server-crypto';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { AccountIdentityService, type PreparedAccountLogin, recoveryStatus } from './identity.js';
import {
  type AccountIdentityDependencies,
  identityError,
  safeAccountError,
  verifyFreshRelay,
} from './identity-support.js';
import { AccountRecoveryService } from './recovery.js';
import { LoginCapacityService } from './login-capacity.js';
import { projectLoginSessions } from './login-session-projection.js';
import { loginSessionRefs } from './login-session-ref.js';
import type { RevokeLoginSessions } from '@musefold/contracts';

export type AccountServiceDeps = AccountIdentityDependencies;

/** Account authority stays in PG and at a fixed trusted issuer. No client-supplied payer. */
export class AccountService {
  readonly identity: AccountIdentityService;
  readonly recovery: AccountRecoveryService;
  readonly loginSessions: LoginCapacityService;
  private readonly deps: AccountIdentityDependencies;

  constructor(deps: AccountServiceDeps) {
    this.deps = {
      ...deps,
      apiIssuer: normalizeNewApiUrl(deps.apiIssuer),
      upstreamIssuer: normalizeNewApiUrl(deps.upstreamIssuer),
      legacyTrustedIssuer: deps.legacyTrustedIssuer
        ? normalizeNewApiUrl(deps.legacyTrustedIssuer)
        : undefined,
    };
    this.identity = new AccountIdentityService(this.deps);
    this.loginSessions = new LoginCapacityService(this.deps);
    this.recovery = new AccountRecoveryService(this.identity, (sessionId) =>
      this.getStatus(sessionId),
    );
  }

  prepareLogin(input: {
    username: string;
    relay: RelayAuthSession;
    previousSessionId: string | null;
  }) {
    return this.identity.prepareLogin(input);
  }

  /** Public announcements use no payer credentials and never join the login/status path. */
  async getNotices(sessionId: string) {
    try {
      const live = await this.deps.db.query.session.findFirst({ where: eq(session.id, sessionId) });
      if (!live) throw new AppError('AUTH_SESSION_EXPIRED', '请重新登录');
      await this.assertSessionAuthorization(sessionId, live.userId);
      const items = await this.deps.newApi.getNotices({ strict: true });
      await this.assertSessionAuthorization(sessionId, live.userId);
      return accountNoticesSchema.parse({
        apiIssuer: this.deps.apiIssuer,
        issuer: this.deps.upstreamIssuer,
        items,
      });
    } catch (error) {
      throw safeAccountError(error);
    }
  }

  private async sessionManagementRelay(sessionId: string) {
    const status = await this.getStatus(sessionId);
    if (status.identity?.status !== 'active') throw identityError('legacy_evidence_missing');
    const live = await this.deps.db.query.session.findFirst({ where: eq(session.id, sessionId) });
    if (!live) throw new AppError('AUTH_SESSION_EXPIRED', '请重新登录');
    await this.assertSessionAuthorization(sessionId, live.userId);
    return this.identity.relay.read(sessionId, status.id);
  }

  async listLoginSessions(sessionId: string) {
    try {
      if (!this.deps.newApi.managedSessions)
        throw new AppError(
          'AUTH_SESSION_MANAGEMENT_UNAVAILABLE',
          '账号服务器尚未支持登录设备管理',
          503,
        );
      const relay = await this.sessionManagementRelay(sessionId);
      return projectLoginSessions(
        await this.deps.newApi.managedSessions.list(relay.jwt),
        loginSessionRefs(this.deps.encryptionKey, this.deps.upstreamIssuer, `session:${sessionId}`)
          .encode,
      );
    } catch (error) {
      throw safeAccountError(error);
    }
  }

  async revokeLoginSessions(sessionId: string, input: RevokeLoginSessions) {
    try {
      if (!this.deps.newApi.managedSessions)
        throw new AppError(
          'AUTH_SESSION_MANAGEMENT_UNAVAILABLE',
          '账号服务器尚未支持登录设备管理',
          503,
        );
      const relay = await this.sessionManagementRelay(sessionId);
      const refs = loginSessionRefs(
        this.deps.encryptionKey,
        this.deps.upstreamIssuer,
        `session:${sessionId}`,
      );
      const selected = input.selected.map((item) => ({
        sid: refs.decode(item.sessionRef),
        version: item.version,
      }));
      const released = await this.deps.newApi.managedSessions.revoke(relay.jwt, {
        operationId: input.operationId,
        selected,
        password: input.password,
        twoFactorCode: input.twoFactorCode,
      });
      const rows = await this.deps.db
        .select({ sessionId: loginSessionReleases.sessionId })
        .from(loginSessionReleases)
        .where(
          and(
            eq(loginSessionReleases.upstreamIssuer, this.deps.upstreamIssuer),
            inArray(
              loginSessionReleases.upstreamSid,
              selected.map((item) => item.sid),
            ),
          ),
        );
      const ids = rows.flatMap((row) => (row.sessionId ? [row.sessionId] : []));
      if (ids.length)
        await this.deps.db
          .delete(session)
          .where(and(eq(session.userId, relay.row.userId), inArray(session.id, ids)));
      return { released };
    } catch (error) {
      throw safeAccountError(error);
    }
  }

  async touchLoginSession(sessionId: string, acknowledge: boolean) {
    // Restricted recovery sessions may acknowledge their own candidate, but
    // cannot enumerate or revoke devices of the historical target principal.
    const status = await this.getStatus(sessionId);
    const recovery = status.recovery
      ? await this.deps.db.query.accountRecoveryRequests.findFirst({
          where: eq(accountRecoveryRequests.sessionId, sessionId),
        })
      : undefined;
    const jwt = recovery
      ? openJsonFromString<RelayAuthSession>(recovery.candidateCiphertext, this.deps.encryptionKey)
          .jwt
      : (await this.identity.relay.read(sessionId)).jwt;
    if (acknowledge) await this.loginSessions.releases.acknowledge(sessionId, jwt);
    else await this.deps.newApi.managedSessions?.touch(jwt, false);
  }
  async commitLogin(input: {
    prepared: PreparedAccountLogin;
    sessionId: string;
    previousSessionId?: string;
    managed?: import('./login-capacity.js').ManagedLoginCommit;
  }) {
    const managed = input.managed;
    const previousId =
      managed && !input.prepared.reason && input.previousSessionId !== input.sessionId
        ? input.previousSessionId
        : undefined;
    // Capture before replacement, but delete only after the new authorization
    // commits. The DB trigger transfers release responsibility atomically; a
    // failed login or identity-proof transaction leaves the old device intact.
    if (previousId) await this.loginSessions.releases.captureBeforeDelete(previousId);
    return this.identity.commitLogin(
      input.prepared,
      input.sessionId,
      managed
        ? (tx) => this.loginSessions.commitInTransaction(tx, managed, input.sessionId)
        : undefined,
      previousId
        ? async (tx) => {
            await tx.delete(session).where(eq(session.id, previousId));
          }
        : undefined,
    );
  }

  /** Server-side mode is authoritative even when a stale client retains the same token. */
  async assertSessionAuthorization(
    sessionId: string,
    userId: string,
    allowRecovery = false,
  ): Promise<void> {
    const live = await this.deps.db.query.session.findFirst({
      where: and(
        eq(session.id, sessionId),
        eq(session.userId, userId),
        gt(session.expiresAt, new Date()),
      ),
    });
    if (!live) throw new AppError('AUTH_SESSION_EXPIRED', '登录状态已失效，请重新登录');
    if (allowRecovery) return;
    const authorization = await this.deps.db.query.accountSessionAuthorizations.findFirst({
      where: eq(accountSessionAuthorizations.sessionId, sessionId),
    });
    const identity = await this.deps.db.query.accountIdentities.findFirst({
      where: eq(accountIdentities.userId, userId),
    });
    if (
      authorization?.mode !== 'normal' ||
      authorization.userId !== userId ||
      identity?.status !== 'active'
    )
      throw identityError('legacy_evidence_missing');
    if (identity.upstreamIssuer !== this.deps.upstreamIssuer)
      throw identityError('legacy_issuer_unknown');
    const tracked = await this.deps.db.query.loginSessionReleases.findFirst({
      where: eq(loginSessionReleases.sessionId, sessionId),
    });
    if (tracked && tracked.upstreamIssuer === this.deps.upstreamIssuer) {
      if (!['candidate', 'active'].includes(tracked.state))
        throw new AppError('AUTH_SESSION_EXPIRED', '此设备已退出，请重新登录');
      try {
        await this.identity.relay.read(sessionId, identity.upstreamOwnerId ?? undefined);
      } catch (error) {
        const mapped = safeAccountError(error);
        if (mapped.code === 'AUTH_SESSION_EXPIRED')
          await this.deps.db
            .delete(session)
            .where(and(eq(session.id, sessionId), eq(session.userId, userId)));
        throw mapped;
      }
    }
  }

  async isPrincipalActive(userId: string): Promise<boolean> {
    const identity = await this.deps.db.query.accountIdentities.findFirst({
      where: eq(accountIdentities.userId, userId),
    });
    return identity?.status === 'active' && identity.upstreamIssuer === this.deps.upstreamIssuer;
  }

  async getStatus(sessionId: string): Promise<AccountSummary> {
    try {
      const live = await this.deps.db.query.session.findFirst({
        where: and(eq(session.id, sessionId), gt(session.expiresAt, new Date())),
      });
      if (!live) throw new AppError('AUTH_SESSION_EXPIRED', '登录状态已失效，请重新登录');
      const identity = await this.deps.db.query.accountIdentities.findFirst({
        where: eq(accountIdentities.userId, live.userId),
      });
      const recovery = await this.deps.db.query.accountRecoveryRequests.findFirst({
        where: eq(accountRecoveryRequests.sessionId, sessionId),
      });
      if (recovery?.status === 'pending') {
        if (recovery.expiresAt.getTime() <= Date.now())
          throw new AppError('ACCOUNT_RECOVERY_EXPIRED', '恢复申请已过期，请重新登录', 410);
        if (recovery.upstreamIssuer !== this.deps.upstreamIssuer)
          throw identityError('legacy_issuer_unknown');
        const candidate = openJsonFromString<RelayAuthSession>(
          recovery.candidateCiphertext,
          this.deps.encryptionKey,
        );
        const self = await verifyFreshRelay(this.deps.newApi, candidate);
        if (String(self.id) !== recovery.upstreamOwnerId)
          throw identityError('legacy_identity_conflict');
        return accountSummarySchema.parse({
          ...summary(self),
          canGenerate: false,
          identity: {
            apiIssuer: this.deps.apiIssuer,
            principalId: live.userId,
            status: recoveryStatus(accountRecoveryReasonSchema.parse(recovery.reason)),
            identityVersion: identity?.identityVersion ?? 0,
          },
          recovery: {
            requestId: recovery.id,
            reason: recovery.reason,
            expiresAt: recovery.expiresAt.toISOString(),
            actions: ['retry', 'verify_original_session', 'create_independent_workspace'],
          },
        });
      }
      const authorization = await this.deps.db.query.accountSessionAuthorizations.findFirst({
        where: eq(accountSessionAuthorizations.sessionId, sessionId),
      });
      const normal =
        authorization?.mode === 'normal' &&
        authorization.userId === live.userId &&
        identity?.status === 'active';
      const verified = await this.identity.relay.read(
        sessionId,
        normal ? (identity.upstreamOwnerId ?? undefined) : undefined,
      );
      const binding = await this.getExecutionBinding(sessionId);
      return accountSummarySchema.parse({
        ...summary(verified.self),
        canGenerate: normal && binding.status === 'available' && verified.self.quota > 0,
        identity: {
          apiIssuer: this.deps.apiIssuer,
          principalId: live.userId,
          status: normal ? 'active' : 'unverified',
          identityVersion: identity?.identityVersion ?? 0,
        },
        recovery: null,
      });
    } catch (error) {
      const safe = safeAccountError(error);
      if (safe.code === 'AUTH_SESSION_EXPIRED') {
        // A status read must also remove stale queued-work authority. Managed
        // rows already hold the stable cleanup proof; the deletion trigger
        // durably transfers it without affecting legacy recovery evidence.
        await this.deps.db
          .delete(session)
          .where(
            and(
              eq(session.id, sessionId),
              inArray(
                session.id,
                this.deps.db
                  .select({ id: loginSessionReleases.sessionId })
                  .from(loginSessionReleases)
                  .where(eq(loginSessionReleases.upstreamIssuer, this.deps.upstreamIssuer)),
              ),
            ),
          );
      }
      throw safe;
    }
  }

  async getExecutionBinding(sessionId: string) {
    const live = await this.deps.db.query.session.findFirst({
      where: and(eq(session.id, sessionId), gt(session.expiresAt, new Date())),
    });
    if (!live) throw new AppError('AUTH_SESSION_EXPIRED', '登录状态已失效，请重新登录');
    const base = { apiIssuer: this.deps.apiIssuer, principalId: live.userId };
    const auth = await this.deps.db.query.accountSessionAuthorizations.findFirst({
      where: eq(accountSessionAuthorizations.sessionId, sessionId),
    });
    const identity = await this.deps.db.query.accountIdentities.findFirst({
      where: eq(accountIdentities.userId, live.userId),
    });
    if (
      auth?.mode !== 'normal' ||
      auth.userId !== live.userId ||
      identity?.status !== 'active' ||
      identity.upstreamIssuer !== this.deps.upstreamIssuer
    )
      return accountExecutionBindingSchema.parse({
        status: 'unavailable',
        ...base,
        reason: 'IDENTITY_UNVERIFIED',
      });
    const credential = await this.deps.db.query.accountCredentials.findFirst({
      where: and(
        eq(accountCredentials.userId, live.userId),
        eq(accountCredentials.provider, 'new-api'),
      ),
    });
    if (
      credential?.status !== 'active' ||
      credential.upstreamIssuer !== identity.upstreamIssuer ||
      credential.upstreamOwnerId !== identity.upstreamOwnerId ||
      !credential.credentialRef ||
      credential.credentialVersion <= 0 ||
      !credential.verifiedAt
    )
      return accountExecutionBindingSchema.parse({
        status: 'unavailable',
        ...base,
        reason: 'CREDENTIAL_UNAVAILABLE',
      });
    return accountExecutionBindingSchema.parse({
      status: 'available',
      ...base,
      payer: { issuer: credential.upstreamIssuer, ownerId: credential.upstreamOwnerId },
      credential: { ref: credential.credentialRef, version: credential.credentialVersion },
      providerId: 'cloud-default',
      model: 'musefold-image-pro',
      capabilities: { image: true, text: false },
      verifiedAt: credential.verifiedAt.toISOString(),
    });
  }

  async redeem(sessionId: string, code: string): Promise<RedeemResult> {
    try {
      const live = await this.deps.db.query.session.findFirst({ where: eq(session.id, sessionId) });
      if (!live) throw new AppError('AUTH_SESSION_EXPIRED', '登录状态已失效');
      await this.assertSessionAuthorization(sessionId, live.userId);
      const identity = await this.deps.db.query.accountIdentities.findFirst({
        where: eq(accountIdentities.userId, live.userId),
      });
      const relay = await this.identity.relay.read(
        sessionId,
        identity?.upstreamOwnerId ?? undefined,
      );
      const result = await this.deps.newApi.redeem(relay.jwt, code);
      return { account: await this.getStatus(sessionId), creditedQuota: result.quotaAdded };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'redeem')
        throw new AppError('ACCOUNT_REDEEM_INVALID', '兑换失败，请检查兑换码后重试');
      throw safeAccountError(error);
    }
  }

  /** Read-only account catalog. No secret, spend grant, or hardcoded tariff reaches the client. */
  async getModelCatalog(sessionId: string) {
    try {
      const before = await this.getExecutionBinding(sessionId);
      if (before.status !== 'available')
        throw new AppError('ACCOUNT_IDENTITY_UNVERIFIED', '账号或凭据尚未验证', 403);
      const relay = await this.identity.relay.read(sessionId, before.payer.ownerId);
      const [names, prices] = await Promise.all([
        this.deps.newApi.listUserModels(relay.jwt),
        this.deps.newApi.getPricing(relay.jwt),
      ]);
      await this.assertSessionAuthorization(sessionId, before.principalId);
      const verified = await this.identity.relay.read(sessionId, before.payer.ownerId);
      if (verified.self.group !== relay.self.group)
        throw new AppError('GENERATION_BINDING_CHANGED', '账号计费分组已变化，请刷新模型列表', 409);
      // Never return an old account/credential's catalog after logout, recovery or rotation.
      const after = await this.getExecutionBinding(sessionId);
      if (
        after.status !== 'available' ||
        JSON.stringify(bindingIdentity(before)) !== JSON.stringify(bindingIdentity(after))
      )
        throw new AppError('GENERATION_BINDING_CHANGED', '账号或凭据已变化，请刷新模型列表', 409);
      return accountModelCatalogSchema.parse({
        identity: bindingIdentity(after),
        group: relay.self.group,
        checkedAt: new Date().toISOString(),
        models: projectAccountModelPrices(names, prices, relay.self.group),
      });
    } catch (error) {
      throw safeAccountError(error);
    }
  }
}

function bindingIdentity(binding: ExecutionBinding) {
  const { apiIssuer, principalId, payer, credential } = binding;
  return accountExecutionIdentitySchema.parse({ apiIssuer, principalId, payer, credential });
}

function summary(self: RelayUser): AccountSummary {
  return {
    id: String(self.id),
    username: self.username,
    displayName: null,
    quota: Math.floor(self.quota),
    quotaUnit: '点',
    canGenerate: false,
  };
}
