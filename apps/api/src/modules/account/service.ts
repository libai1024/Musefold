import type { AccountSummary, RedeemResult } from '@musefold/contracts';
import { type MusefoldDatabase, accountCredentials, relaySessions } from '@musefold/db';
import type { NewApiClient, RelayAuthSession, RelayUser } from '@musefold/new-api-client';
import { openJsonFromString, sealJsonToString } from '@musefold/server-crypto';
import { eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

const CLOUD_TOKEN_NAME = 'Musefold Cloud v2.5';

interface RelayCredentials {
  jwt: string;
  refreshToken: string;
}

export interface AccountServiceDeps {
  db: MusefoldDatabase;
  newApi: NewApiClient;
  encryptionKey: string;
}

/**
 * 账号域:Better Auth 会话之上的 New API 委托编排。
 * - 登录时固化两类凭据:会话级中继凭据(余额/兑换用)与用户级生图 token(worker 用)。
 * - 中继 jwt 过期前自动 refresh 并回写;refresh 失败视为会话过期。
 */
export class AccountService {
  constructor(private readonly deps: AccountServiceDeps) {}

  /** newApiDelegation 插件的 onSessionEstablished 钩子实现。 */
  async persistSessionCredentials(input: {
    userId: string;
    sessionId: string;
    relay: RelayAuthSession;
  }): Promise<void> {
    const { db, encryptionKey } = this.deps;
    const relayCiphertext = sealJsonToString(
      { jwt: input.relay.jwt, refreshToken: input.relay.refreshToken } satisfies RelayCredentials,
      encryptionKey,
    );
    const accessExpiresAt = new Date(input.relay.jwtExpiresAt * 1_000);
    await db
      .insert(relaySessions)
      .values({
        sessionId: input.sessionId,
        userId: input.userId,
        ciphertext: relayCiphertext,
        accessExpiresAt,
      })
      .onConflictDoUpdate({
        target: relaySessions.sessionId,
        set: { ciphertext: relayCiphertext, accessExpiresAt, updatedAt: new Date() },
      });

    const credential = await this.ensureGenerationCredential(input.relay.jwt);
    await db
      .insert(accountCredentials)
      .values({
        userId: input.userId,
        provider: 'new-api',
        externalTokenId: String(credential.id),
        ciphertext: sealJsonToString({ apiKey: credential.key }, encryptionKey),
      })
      .onConflictDoUpdate({
        target: [accountCredentials.userId, accountCredentials.provider],
        set: {
          externalTokenId: String(credential.id),
          ciphertext: sealJsonToString({ apiKey: credential.key }, encryptionKey),
          updatedAt: new Date(),
        },
      });
  }

  async getStatus(sessionId: string): Promise<AccountSummary> {
    const jwt = await this.requireRelayJwt(sessionId);
    try {
      return toSummary(await this.deps.newApi.getSelf(jwt));
    } catch (error) {
      throw this.mapRelayError(error);
    }
  }

  async redeem(sessionId: string, code: string): Promise<RedeemResult> {
    const jwt = await this.requireRelayJwt(sessionId);
    try {
      const result = await this.deps.newApi.redeem(jwt, code);
      const account = toSummary(await this.deps.newApi.getSelf(jwt));
      return { account, creditedQuota: result.quotaAdded };
    } catch (error) {
      if (isRelayCode(error, 'redeem')) {
        throw new AppError('ACCOUNT_REDEEM_INVALID', '兑换失败，请检查兑换码后重试');
      }
      throw this.mapRelayError(error);
    }
  }

  /** 取可用中继 jwt;临期(<60s)先 refresh 并回写。 */
  private async requireRelayJwt(sessionId: string): Promise<string> {
    const { db, encryptionKey, newApi } = this.deps;
    const row = await db.query.relaySessions.findFirst({
      where: eq(relaySessions.sessionId, sessionId),
    });
    if (!row) throw new AppError('AUTH_SESSION_EXPIRED', '登录状态已失效，请重新登录');
    const credentials = openJsonFromString<RelayCredentials>(row.ciphertext, encryptionKey);
    if (row.accessExpiresAt.getTime() - Date.now() > 60_000) return credentials.jwt;

    try {
      const refreshed = await newApi.refresh(credentials.refreshToken);
      await db
        .update(relaySessions)
        .set({
          ciphertext: sealJsonToString(
            {
              jwt: refreshed.jwt,
              refreshToken: refreshed.refreshToken,
            } satisfies RelayCredentials,
            encryptionKey,
          ),
          accessExpiresAt: new Date(refreshed.jwtExpiresAt * 1_000),
          updatedAt: new Date(),
        })
        .where(eq(relaySessions.sessionId, sessionId));
      return refreshed.jwt;
    } catch (error) {
      if (isRelayCode(error, 'auth')) {
        throw new AppError('AUTH_SESSION_EXPIRED', '登录状态已失效，请重新登录');
      }
      throw this.mapRelayError(error);
    }
  }

  private async ensureGenerationCredential(jwt: string): Promise<{ id: number; key: string }> {
    const { newApi } = this.deps;
    let tokens = await newApi.listTokens(jwt);
    let token = tokens
      .filter((candidate) => candidate.name === CLOUD_TOKEN_NAME && candidate.status === 1)
      .sort((a, b) => b.id - a.id)[0];
    if (!token) {
      await newApi.createToken(jwt, { name: CLOUD_TOKEN_NAME });
      tokens = await newApi.listTokens(jwt);
      token = tokens
        .filter((candidate) => candidate.name === CLOUD_TOKEN_NAME)
        .sort((a, b) => b.id - a.id)[0];
    }
    if (!token) throw new AppError('INTERNAL_ERROR', '无法供给账号生图凭据', 502, true);
    return { id: token.id, key: await newApi.fetchTokenKey(jwt, token.id) };
  }

  private mapRelayError(error: unknown): AppError {
    if (error instanceof AppError) return error;
    if (isRelayCode(error, 'credentials')) {
      return new AppError('AUTH_CREDENTIALS_INVALID', '用户名或密码不正确');
    }
    if (isRelayCode(error, 'auth')) {
      return new AppError('AUTH_SESSION_EXPIRED', '登录状态已失效，请重新登录');
    }
    if (isRelayCode(error, 'network')) {
      return new AppError('INTERNAL_ERROR', '账号服务暂时不可用', 503, true);
    }
    return new AppError('INTERNAL_ERROR', '账号服务暂时不可用', 502, true);
  }
}

function toSummary(user: RelayUser): AccountSummary {
  return {
    id: String(user.id),
    username: user.username,
    displayName: null,
    quota: Math.floor(user.quota),
    quotaUnit: '点',
    canGenerate: user.quota > 0,
  };
}

function isRelayCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: unknown }).code === code,
  );
}
