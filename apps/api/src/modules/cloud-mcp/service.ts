import {
  type CloudMcpAuthorization,
  type CloudMcpAuthorizationList,
  type CloudMcpRevokeResult,
  cloudMcpAuthorizationListSchema,
  cloudMcpClientDisplayName,
  cloudMcpRevokeResultSchema,
  toCloudMcpIso,
} from '@musefold/contracts';
import {
  type MusefoldDatabase,
  accountIdentities,
  accountSessionAuthorizations,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  session,
} from '@musefold/db';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

const tokenAuthorizationSchema = z.object({
  sub: z.string().min(1).max(512),
  client_id: z.string().min(1).max(2048),
  sid: z.string().min(1).max(512),
  scope: z.string().max(4096),
  mf_consent_id: z.string().min(1).max(512),
});

const tokenClaimInputSchema = z.object({
  userId: z.string().min(1).max(512),
  clientId: z.string().min(1).max(2048),
  sessionId: z.string().min(1).max(512),
  scopes: z.array(z.string().min(1).max(128)).max(100),
  referenceId: z.string().min(1).max(512).optional(),
});

// Server-owned lineage, persisted by BA in the authorization code and copied to
// every refresh descendant. An absent/legacy reference must never borrow consent.
const CONSENT_REFERENCE_PREFIX = 'musefold-consent:';
const authorizationCodeValueSchema = z
  .object({
    type: z.literal('authorization_code'),
    userId: z.string().min(1).max(512),
    sessionId: z.string().min(1).max(512),
    referenceId: z.string().min(1).max(512).optional(),
    query: z
      .object({
        client_id: z.string().min(1).max(2048),
        scope: z.string().max(4096),
      })
      .passthrough(),
  })
  .passthrough();

function consentIdFromReference(referenceId?: string | null): string | undefined {
  if (!referenceId?.startsWith(CONSENT_REFERENCE_PREFIX)) return undefined;
  return z.string().min(1).max(512).safeParse(referenceId.slice(CONSENT_REFERENCE_PREFIX.length))
    .data;
}

type ConsentJoinRow = {
  clientId: string;
  name: string | null;
  uri: string | null;
  scopes: string[] | null;
  authorizedAt: Date | null;
  authorizedUpdatedAt: Date | null;
};

type TokenTimeRow = {
  clientId: string;
  createdAt: Date | null;
};

/**
 * 把 consent ⋈ client 行与未撤销 access token 时间装配成契约出参。
 * 不接收 token 明文;lastUsedAt 只取时间。
 */
export function assembleCloudMcpAuthorizations(
  consents: readonly ConsentJoinRow[],
  tokenTimes: readonly TokenTimeRow[],
): CloudMcpAuthorizationList {
  const lastUsedByClient = new Map<string, Date>();
  for (const token of tokenTimes) {
    if (!token.createdAt) continue;
    const previous = lastUsedByClient.get(token.clientId);
    if (!previous || token.createdAt > previous) {
      lastUsedByClient.set(token.clientId, token.createdAt);
    }
  }

  const items: CloudMcpAuthorization[] = consents.map((row) => {
    const authorizedSource = row.authorizedAt ?? row.authorizedUpdatedAt ?? new Date(0);
    const lastUsed = lastUsedByClient.get(row.clientId) ?? null;
    return {
      clientId: row.clientId,
      name: cloudMcpClientDisplayName(row.name, row.clientId),
      uri: row.uri?.trim() ? row.uri.trim() : null,
      scopes: (row.scopes ?? []).filter((scope) => scope.trim().length > 0),
      authorizedAt: toCloudMcpIso(authorizedSource),
      lastUsedAt: lastUsed ? toCloudMcpIso(lastUsed) : null,
    };
  });

  items.sort((left, right) => right.authorizedAt.localeCompare(left.authorizedAt));
  return cloudMcpAuthorizationListSchema.parse({ items });
}

/** MCP JWT 过签名后仍须查 consent:没有授权行即 401。 */
export function cloudMcpUnauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'invalid_token',
      error_description: 'authorization revoked',
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate':
          'Bearer error="invalid_token", error_description="authorization revoked"',
      },
    },
  );
}

export class CloudMcpService {
  constructor(private readonly db: MusefoldDatabase) {}

  async listAuthorizations(userId: string): Promise<CloudMcpAuthorizationList> {
    const consents = await this.db
      .select({
        clientId: oauthConsent.clientId,
        name: oauthClient.name,
        uri: oauthClient.uri,
        scopes: oauthConsent.scopes,
        authorizedAt: oauthConsent.createdAt,
        authorizedUpdatedAt: oauthConsent.updatedAt,
      })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthConsent.clientId, oauthClient.clientId))
      .where(eq(oauthConsent.userId, userId));

    const tokenTimes = await this.db
      .select({
        clientId: oauthAccessToken.clientId,
        createdAt: oauthAccessToken.createdAt,
      })
      .from(oauthAccessToken)
      .where(and(eq(oauthAccessToken.userId, userId), isNull(oauthAccessToken.revoked)));

    return assembleCloudMcpAuthorizations(consents, tokenTimes);
  }

  async hasActiveAuthorization(userId: string, clientId: string): Promise<boolean> {
    if (!userId || !clientId) return false;
    const rows = await this.db
      .select({ id: oauthConsent.id })
      .from(oauthConsent)
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
      .limit(1);
    return rows.length > 0;
  }

  /** Called only by BA's verification.create.before hook, before a code exists. */
  async freezeAuthorizationCode(value: string): Promise<string> {
    let raw: unknown;
    try {
      raw = JSON.parse(value);
    } catch {
      return value;
    }
    if (!raw || typeof raw !== 'object' || !('type' in raw) || raw.type !== 'authorization_code')
      return value;
    const parsed = authorizationCodeValueSchema.safeParse(raw);
    if (!parsed.success) throw new AppError('AUTH_REQUIRED', 'Cloud MCP 授权不可用', 403);
    const code = parsed.data;
    const scopes = code.query.scope.split(' ').filter(Boolean);
    const rows = await this.activeTokenConsents(
      {
        userId: code.userId,
        clientId: code.query.client_id,
        sessionId: code.sessionId,
      },
      undefined,
      code.referenceId,
    );
    const consent = rows.find((row) => scopes.every((scope) => row.scopes.includes(scope)));
    if (!consent) throw new AppError('AUTH_REQUIRED', 'Cloud MCP 授权不可用', 403);
    return JSON.stringify({ ...code, referenceId: `${CONSENT_REFERENCE_PREFIX}${consent.id}` });
  }

  /**
   * BA JWTs have no oauth_access_token row. Pin the original consent, not the
   * current user/client consent: refresh rotation can insert after revocation.
   */
  async createAccessTokenClaims(input: z.infer<typeof tokenClaimInputSchema>) {
    const parsed = tokenClaimInputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('AUTH_REQUIRED', 'Cloud MCP 授权不可用', 403);
    const grant = parsed.data;
    const consentId = consentIdFromReference(grant.referenceId);
    if (!consentId) throw new AppError('AUTH_REQUIRED', 'Cloud MCP 授权不可用', 403);
    const rows = await this.activeTokenConsents(grant, consentId);
    const row = rows.find((candidate) =>
      grant.scopes.every((scope) => candidate.scopes.includes(scope)),
    );
    if (!row) throw new AppError('AUTH_REQUIRED', 'Cloud MCP 授权不可用', 403);
    return { mf_consent_id: row.id };
  }

  /** Check before BA's refresh replay cache and both JWT/opaque issuance paths. */
  async hasActiveRefreshTokenAuthorization(storedToken: string): Promise<boolean> {
    const [refresh] = await this.db
      .select({
        userId: oauthRefreshToken.userId,
        clientId: oauthRefreshToken.clientId,
        sessionId: oauthRefreshToken.sessionId,
        referenceId: oauthRefreshToken.referenceId,
        scopes: oauthRefreshToken.scopes,
      })
      .from(oauthRefreshToken)
      .where(
        and(eq(oauthRefreshToken.token, storedToken), gt(oauthRefreshToken.expiresAt, new Date())),
      )
      .limit(1);
    if (!refresh?.sessionId) return false;
    const consentId = consentIdFromReference(refresh.referenceId);
    if (!consentId) return false;
    const rows = await this.activeTokenConsents(
      { ...refresh, sessionId: refresh.sessionId },
      consentId,
    );
    // Revoked/rotated/replay-window checks remain BA's authority; this check
    // ensures even a still-open replay window belongs to a live original grant.
    return rows.some((row) => refresh.scopes.every((scope) => row.scopes.includes(scope)));
  }

  /** 只接收经过 requireMcpAuth 签名/issuer/audience 校验的 claims；不接受 bearer 明文。 */
  async hasActiveTokenAuthorization(claims: Record<string, unknown>): Promise<boolean> {
    const parsed = tokenAuthorizationSchema.safeParse(claims);
    if (!parsed.success) return false;
    const token = parsed.data;
    const scopes = token.scope.split(' ').filter(Boolean);
    const rows = await this.activeTokenConsents(
      { userId: token.sub, clientId: token.client_id, sessionId: token.sid },
      token.mf_consent_id,
    );
    return rows.some((row) => scopes.every((scope) => row.scopes.includes(scope)));
  }

  private activeTokenConsents(
    input: { userId: string; clientId: string; sessionId: string },
    consentId?: string,
    referenceId?: string,
  ) {
    return this.db
      .select({ id: oauthConsent.id, scopes: oauthConsent.scopes })
      .from(oauthConsent)
      .innerJoin(
        oauthClient,
        and(
          eq(oauthClient.clientId, oauthConsent.clientId),
          or(isNull(oauthClient.disabled), eq(oauthClient.disabled, false)),
        ),
      )
      .innerJoin(
        session,
        and(
          eq(session.id, input.sessionId),
          eq(session.userId, oauthConsent.userId),
          gt(session.expiresAt, new Date()),
        ),
      )
      .innerJoin(
        accountSessionAuthorizations,
        and(
          eq(accountSessionAuthorizations.sessionId, session.id),
          eq(accountSessionAuthorizations.userId, session.userId),
          eq(accountSessionAuthorizations.mode, 'normal'),
        ),
      )
      .innerJoin(
        accountIdentities,
        and(eq(accountIdentities.userId, session.userId), eq(accountIdentities.status, 'active')),
      )
      .where(
        and(
          eq(oauthConsent.userId, input.userId),
          eq(oauthConsent.clientId, input.clientId),
          consentId
            ? eq(oauthConsent.id, consentId)
            : referenceId
              ? eq(oauthConsent.referenceId, referenceId)
              : isNull(oauthConsent.referenceId),
        ),
      );
  }

  /**
   * 撤销:删 consent(下次签发/consent 校验失败)+ 把该 user+client 的
   * access/refresh token 标 revoked(审计行保留)。幂等:无行也返回 revoked=true。
   */
  async revokeAuthorization(userId: string, clientId: string): Promise<CloudMcpRevokeResult> {
    const revokedAt = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .delete(oauthConsent)
        .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)));
      await tx
        .update(oauthAccessToken)
        .set({ revoked: revokedAt })
        .where(
          and(
            eq(oauthAccessToken.userId, userId),
            eq(oauthAccessToken.clientId, clientId),
            isNull(oauthAccessToken.revoked),
          ),
        );
      await tx
        .update(oauthRefreshToken)
        .set({ revoked: revokedAt })
        .where(
          and(
            eq(oauthRefreshToken.userId, userId),
            eq(oauthRefreshToken.clientId, clientId),
            isNull(oauthRefreshToken.revoked),
          ),
        );
    });
    return cloudMcpRevokeResultSchema.parse({ revoked: true, clientId });
  }
}
