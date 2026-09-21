import { randomUUID } from 'node:crypto';
import type { AccountRecoveryReason } from '@musefold/contracts';
import { type MusefoldDatabase, relaySessions, session, user } from '@musefold/db';
import type { NewApiClient, RelayAuthSession, RelayUser } from '@musefold/new-api-client';
import { openJsonFromString, sealJsonToString } from '@musefold/server-crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

export interface AccountIdentityDependencies {
  db: MusefoldDatabase;
  newApi: NewApiClient;
  encryptionKey: string;
  apiIssuer: string;
  upstreamIssuer: string;
  /** Explicit deployment evidence only; never defaulted from the current base URL. */
  legacyTrustedIssuer?: string;
}
export type AccountTx = Parameters<Parameters<MusefoldDatabase['transaction']>[0]>[0];
export type RelayRow = typeof relaySessions.$inferSelect;
export const RECOVERY_TTL_MS = 30 * 60_000;
export const REFRESH_LEASE_MS = 30_000;

export function identityError(reason: AccountRecoveryReason): AppError {
  const conflict = reason === 'legacy_identity_conflict';
  return new AppError(
    conflict
      ? 'ACCOUNT_RECOVERY_CONFLICT'
      : reason === 'legacy_issuer_unknown'
        ? 'ACCOUNT_IDENTITY_SOURCE_CHANGED'
        : 'ACCOUNT_IDENTITY_UNVERIFIED',
    conflict
      ? '账号身份存在冲突，请完成恢复验证或使用独立工作区'
      : reason === 'verification_pending'
        ? '账号验证暂未完成，请稍后重试'
        : '账号来源尚未核实，请完成恢复验证或使用独立工作区',
    conflict ? 409 : reason === 'verification_pending' ? 503 : 403,
    reason === 'verification_pending',
    { reason },
  );
}

export function conflictError() {
  return new AppError(
    'ACCOUNT_RECOVERY_CONFLICT',
    '账号状态已变化，请重新登录或重试恢复',
    409,
    true,
  );
}

export function relayCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

export function safeAccountError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  for (const [code, message, status] of [
    ['AUTH_2FA_REQUIRED', '请输入两步验证码或备用码后重新登录', 401],
    ['AUTH_SESSION_LIMIT', '登录设备数量已达上限，请选择要退出的设备', 409],
    [
      'AUTH_SESSION_ISSUANCE_LIMIT',
      '登录次数已达安全上限，请稍后再试；释放设备不会重置此限制',
      429,
    ],
    ['AUTH_SESSION_REVIEW_CHANGED', '设备状态已变化，请刷新列表后重新选择', 409],
    ['AUTH_LOGIN_CHALLENGE_EXPIRED', '验证已过期，请重新登录', 401],
    ['AUTH_OPERATION_CONFLICT', '请先核对原登录请求', 409],
    ['AUTH_SESSION_MANAGEMENT_UNAVAILABLE', '账号服务器尚未支持登录设备管理', 503],
  ] as const) {
    if (relayCode(error, code)) {
      const retryAt =
        error && typeof error === 'object' && 'retryAt' in error ? error.retryAt : null;
      if (
        code === 'AUTH_SESSION_ISSUANCE_LIMIT' &&
        typeof retryAt === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(retryAt) &&
        Number.isFinite(Date.parse(retryAt))
      )
        return new AppError(code, `${message}；最早重试时间：${retryAt}`, status, true, {
          retryAt,
        });
      return new AppError(code, message, status);
    }
  }
  if (
    relayCode(error, 'network') &&
    error &&
    typeof error === 'object' &&
    'httpStatus' in error &&
    error.httpStatus === 429
  )
    return new AppError('RATE_LIMITED', '账号操作过于频繁，请稍后再试', 429, true);
  if (relayCode(error, 'credentials'))
    return new AppError('AUTH_CREDENTIALS_INVALID', '用户名或密码不正确');
  if (relayCode(error, 'auth'))
    return new AppError('AUTH_SESSION_EXPIRED', '登录状态已失效，请重新登录');
  return new AppError('INTERNAL_ERROR', '账号服务暂时不可用，请稍后重试', 503, true);
}

export function assertRelayUser(value: RelayUser): RelayUser {
  if (
    !Number.isSafeInteger(value.id) ||
    value.id <= 0 ||
    !value.username.trim() ||
    value.username.length > 64 ||
    !Number.isFinite(value.quota) ||
    value.quota < 0
  ) {
    throw identityError('verification_pending');
  }
  return value;
}

export async function verifyFreshRelay(
  client: NewApiClient,
  relay: RelayAuthSession,
): Promise<RelayUser> {
  assertRelayUser(relay.user);
  if (
    !relay.jwt ||
    !relay.refreshToken ||
    !Number.isFinite(relay.jwtExpiresAt) ||
    relay.jwtExpiresAt <= 0
  ) {
    throw identityError('verification_pending');
  }
  const self = assertRelayUser(await client.getSelf(relay.jwt));
  if (self.id !== relay.user.id) throw identityError('legacy_identity_conflict');
  return self;
}

export function openRelay(
  row: Pick<RelayRow, 'ciphertext'>,
  key: string,
): { jwt: string; refreshToken: string } {
  try {
    const value = openJsonFromString<{ jwt?: unknown; refreshToken?: unknown }>(
      row.ciphertext,
      key,
    );
    if (
      typeof value.jwt !== 'string' ||
      !value.jwt ||
      typeof value.refreshToken !== 'string' ||
      !value.refreshToken
    )
      throw new Error();
    return { jwt: value.jwt, refreshToken: value.refreshToken };
  } catch {
    throw identityError('legacy_evidence_missing');
  }
}

export async function lockUser(tx: AccountTx, userId: string) {
  const rows = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
  if (!rows[0]) throw new AppError('AUTH_SESSION_EXPIRED', '账号已不可用');
}

/** Same ordering as activation: user, then relay; no network under a PG lock. */
export class AccountRelayVerifier {
  constructor(private readonly deps: AccountIdentityDependencies) {}

  private assertIssuer(row: RelayRow) {
    const issuer = row.upstreamIssuer ?? this.deps.legacyTrustedIssuer;
    if (!issuer || issuer !== this.deps.upstreamIssuer)
      throw identityError('legacy_issuer_unknown');
  }

  async read(
    sessionId: string,
    expectedOwner?: string,
    evidenceOnly = false,
  ): Promise<{ row: RelayRow; self: RelayUser; jwt: string }> {
    const { db, newApi, encryptionKey } = this.deps;
    let row = await db.query.relaySessions.findFirst({
      where: eq(relaySessions.sessionId, sessionId),
    });
    if (!row) throw identityError('legacy_evidence_missing');
    this.assertIssuer(row);
    const live = await db.query.session.findFirst({ where: eq(session.id, sessionId) });
    if (!live || (!evidenceOnly && live.expiresAt.getTime() <= Date.now()))
      throw new AppError('AUTH_SESSION_EXPIRED', '登录状态已失效');
    if (row.upstreamOwnerId && expectedOwner && row.upstreamOwnerId !== expectedOwner)
      throw identityError('legacy_identity_conflict');
    let secrets = openRelay(row, encryptionKey);
    let self: RelayUser | undefined;
    if (row.accessExpiresAt.getTime() > Date.now() + 60_000 || evidenceOnly) {
      try {
        self = assertRelayUser(await newApi.getSelf(secrets.jwt));
      } catch (error) {
        if (!relayCode(error, 'auth')) throw safeAccountError(error);
      }
    }
    if (!self) {
      const refreshed = await this.refresh(row, expectedOwner);
      row = refreshed.row;
      self = refreshed.self;
      secrets = openRelay(row, encryptionKey);
    }
    if (
      (expectedOwner && String(self.id) !== expectedOwner) ||
      (row.upstreamOwnerId && String(self.id) !== row.upstreamOwnerId)
    )
      throw identityError('legacy_identity_conflict');
    // A removed session never regains authority merely because getSelf returned late.
    const stillPresent = await db.query.session.findFirst({ where: eq(session.id, sessionId) });
    if (!stillPresent || (!evidenceOnly && stillPresent.expiresAt.getTime() <= Date.now()))
      throw new AppError('AUTH_SESSION_EXPIRED', '登录状态已失效');
    return { row, self, jwt: secrets.jwt };
  }

  private async refresh(
    snapshot: RelayRow,
    expectedOwner?: string,
  ): Promise<{ row: RelayRow; self: RelayUser }> {
    const { db, newApi, encryptionKey } = this.deps;
    const leaseId = randomUUID();
    const claimed = await db.transaction(async (tx) => {
      await lockUser(tx, snapshot.userId);
      const rows = await tx
        .select()
        .from(relaySessions)
        .where(eq(relaySessions.sessionId, snapshot.sessionId))
        .for('update');
      const row = rows[0];
      if (!row) throw new AppError('AUTH_SESSION_EXPIRED', '登录状态已失效');
      if (row.revision !== snapshot.revision || row.ciphertext !== snapshot.ciphertext)
        throw identityError('verification_pending');
      const live = await tx
        .select()
        .from(session)
        .where(and(eq(session.id, row.sessionId), gt(session.expiresAt, new Date())));
      if (!live[0]) throw new AppError('AUTH_SESSION_EXPIRED', '登录状态已失效');
      if (row.refreshLeaseUntil && row.refreshLeaseUntil.getTime() > Date.now())
        throw identityError('verification_pending');
      this.assertIssuer(row);
      const updated = await tx
        .update(relaySessions)
        .set({
          refreshLeaseId: leaseId,
          refreshLeaseUntil: new Date(Date.now() + REFRESH_LEASE_MS),
          revision: row.revision + 1,
        })
        .where(eq(relaySessions.sessionId, row.sessionId))
        .returning();
      return updated[0] as RelayRow;
    });
    try {
      const prior = openRelay(claimed, encryptionKey);
      const fresh = await newApi.refresh(prior.refreshToken);
      const self = await verifyFreshRelay(newApi, fresh);
      if (
        (claimed.upstreamOwnerId && claimed.upstreamOwnerId !== String(self.id)) ||
        (expectedOwner && expectedOwner !== String(self.id))
      )
        throw identityError('legacy_identity_conflict');
      return await db.transaction(async (tx) => {
        await lockUser(tx, claimed.userId);
        const updated = await tx
          .update(relaySessions)
          .set({
            ciphertext: sealJsonToString(
              { jwt: fresh.jwt, refreshToken: fresh.refreshToken },
              encryptionKey,
            ),
            accessExpiresAt: new Date(fresh.jwtExpiresAt * 1000),
            revision: claimed.revision + 1,
            refreshLeaseId: null,
            refreshLeaseUntil: null,
            updatedAt: new Date(),
            // A NULL historical issuer is not silently converted into provenance by refresh.
          })
          .where(
            and(
              eq(relaySessions.sessionId, claimed.sessionId),
              eq(relaySessions.revision, claimed.revision),
              eq(relaySessions.refreshLeaseId, leaseId),
              sql`EXISTS (SELECT 1 FROM session WHERE id = ${claimed.sessionId} AND expires_at > now())`,
            ),
          )
          .returning();
        if (!updated[0])
          throw new AppError('AUTH_SESSION_EXPIRED', '会话在刷新期间已失效，请重新登录');
        return { row: updated[0], self };
      });
    } catch (error) {
      throw safeAccountError(error);
    } finally {
      await db
        .update(relaySessions)
        .set({ refreshLeaseId: null, refreshLeaseUntil: null })
        .where(
          and(
            eq(relaySessions.sessionId, claimed.sessionId),
            eq(relaySessions.refreshLeaseId, leaseId),
          ),
        );
    }
  }
}
