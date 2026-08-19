import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type Provider from "oidc-provider";
import type { MusefoldDatabase } from "../../database/types.js";
import { withOwnerTransaction } from "../../database/owner-context.js";
import { AppError } from "../../errors.js";

export const MCP_SCOPES = [
  "account:read",
  "prompts:read",
  "prompts:write",
  "skills:read",
  "generations:read",
  "generations:write",
] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export interface McpAuthInfo {
  token: string;
  ownerId: number;
  clientId: string;
  grantId: string;
  scopes: McpScope[];
  resource: string;
  expiresAt: number;
}

export interface McpGrant {
  id: string;
  ownerId: number;
  clientId: string;
  scopes: McpScope[];
  mode: "ask_each_time" | "auto_with_limits";
  maxPointsPerGeneration: number;
  maxPointsPerDay: number;
  allowedModelAliases: string[];
  suspended: boolean;
}

export class OAuthService {
  private provider: Provider | null = null;

  constructor(private readonly db: Kysely<MusefoldDatabase>) {}

  attachProvider(provider: Provider): void {
    this.provider = provider;
  }

  async ensureGrant(
    ownerId: number,
    clientId: string,
    requestedScopes: string[],
  ): Promise<McpGrant> {
    const scopes = normalizeScopes(requestedScopes);
    const proposedId = randomUUID();
    await sql`
      INSERT INTO auth.oauth_grants(id, owner_id, client_id, scopes)
      VALUES (${proposedId}, ${ownerId}, ${clientId}, ${scopes})
      ON CONFLICT (owner_id, client_id) DO UPDATE
      SET scopes = EXCLUDED.scopes,
          revoked_at = NULL,
          suspended_at = NULL
    `.execute(this.db);
    const result = await sql<{ id: string }>`
      SELECT id
      FROM auth.oauth_grants
      WHERE owner_id = ${ownerId} AND client_id = ${clientId}
    `.execute(this.db);
    const grantId = result.rows[0]?.id;
    if (!grantId) {
      throw new AppError("INTERNAL_ERROR", "无法建立 MCP 授权", 500, true);
    }
    return this.getGrant(grantId);
  }

  async verifyAccessToken(
    token: string,
    expectedResource: string,
  ): Promise<McpAuthInfo> {
    const provider = this.requireProvider();
    const accessToken = await provider.AccessToken.find(token);
    const audiences = accessToken
      ? Array.isArray(accessToken.aud)
        ? accessToken.aud
        : [accessToken.aud]
      : [];
    if (
      !accessToken ||
      !accessToken.isValid ||
      !audiences.includes(expectedResource) ||
      !accessToken.accountId ||
      !accessToken.clientId ||
      !accessToken.grantId
    ) {
      throw new AppError("OAUTH_INVALID_GRANT", "MCP access token 无效", 401);
    }

    const ownerId = Number(accessToken.accountId);
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
      throw new AppError("OAUTH_INVALID_GRANT", "MCP access token 无效", 401);
    }
    const grant = await this.getGrant(accessToken.grantId);
    if (grant.ownerId !== ownerId || grant.clientId !== accessToken.clientId) {
      throw new AppError("OAUTH_INVALID_GRANT", "MCP access token 无效", 401);
    }
    const scopes = normalizeScopes(accessToken.scopes);
    await sql`
      UPDATE auth.oauth_grants
      SET last_used_at = now()
      WHERE id = ${grant.id}
    `.execute(this.db);
    return {
      token,
      ownerId,
      clientId: accessToken.clientId,
      grantId: accessToken.grantId,
      scopes,
      resource: expectedResource,
      expiresAt: accessToken.exp ?? Math.floor(Date.now() / 1_000),
    };
  }

  async getGrant(grantId: string): Promise<McpGrant> {
    const result = await sql<{
      id: string;
      owner_id: string;
      client_id: string;
      scopes: string[];
      mode: McpGrant["mode"];
      max_points_per_generation: number;
      max_points_per_day: number;
      allowed_model_aliases: string[];
      suspended_at: Date | string | null;
      revoked_at: Date | string | null;
    }>`
      SELECT id, owner_id, client_id, scopes, mode, max_points_per_generation,
        max_points_per_day, allowed_model_aliases, suspended_at, revoked_at
      FROM auth.oauth_grants
      WHERE id = ${grantId}
    `.execute(this.db);
    const row = result.rows[0];
    if (!row || row.revoked_at || row.suspended_at) {
      throw new AppError("OAUTH_INVALID_GRANT", "MCP 授权已暂停或撤销", 401);
    }
    return {
      id: row.id,
      ownerId: Number(row.owner_id),
      clientId: row.client_id,
      scopes: normalizeScopes(row.scopes),
      mode: row.mode,
      maxPointsPerGeneration: row.max_points_per_generation,
      maxPointsPerDay: row.max_points_per_day,
      allowedModelAliases: row.allowed_model_aliases,
      suspended: false,
    };
  }

  async assertScope(auth: McpAuthInfo, scope: McpScope): Promise<void> {
    if (!auth.scopes.includes(scope)) {
      throw new AppError(
        "OAUTH_SCOPE_INSUFFICIENT",
        "当前 MCP 授权不包含所需 scope",
        403,
      );
    }
    await this.getGrant(auth.grantId);
  }

  async listConnections(ownerId: number): Promise<
    Array<{
      id: string;
      clientName: string;
      scopes: McpScope[];
      mode: string;
      maxPointsPerGeneration: number;
      maxPointsPerDay: number;
      spentPointsToday: number;
      reservedPointsToday: number;
      status: "active" | "suspended" | "revoked";
      createdAt: string;
      lastUsedAt: string | null;
    }>
  > {
    const result = await withOwnerTransaction(this.db, ownerId, (trx) =>
      sql<{
        id: string;
        client_name: string;
        scopes: string[];
        mode: string;
        max_points_per_generation: number;
        max_points_per_day: number;
        spent_points_today: string;
        reserved_points_today: string;
        suspended_at: Date | string | null;
        revoked_at: Date | string | null;
        created_at: Date | string;
        last_used_at: Date | string | null;
      }>`
        SELECT g.id, c.client_name, g.scopes, g.mode,
          g.max_points_per_generation, g.max_points_per_day,
          coalesce(spend.spent_points_today, 0)::text AS spent_points_today,
          coalesce(spend.reserved_points_today, 0)::text AS reserved_points_today,
          g.suspended_at, g.revoked_at, g.created_at, g.last_used_at
        FROM auth.oauth_grants g
        JOIN auth.oauth_clients c ON c.client_id = g.client_id
        LEFT JOIN LATERAL (
          SELECT
            sum(coalesce(actual_points, estimated_points))
              FILTER (WHERE status = 'settled') AS spent_points_today,
            sum(estimated_points)
              FILTER (WHERE status = 'reserved') AS reserved_points_today
          FROM app.mcp_spend_reservations
          WHERE owner_id = ${ownerId} AND grant_id = g.id
            AND status IN ('reserved', 'settled')
            AND reserved_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        ) spend ON true
        WHERE g.owner_id = ${ownerId}
        ORDER BY g.created_at DESC
      `.execute(trx),
    );
    return result.rows.map((row) => ({
      id: row.id,
      clientName: row.client_name,
      scopes: normalizeScopes(row.scopes),
      mode: row.mode,
      maxPointsPerGeneration: row.max_points_per_generation,
      maxPointsPerDay: row.max_points_per_day,
      spentPointsToday: Number(row.spent_points_today),
      reservedPointsToday: Number(row.reserved_points_today),
      status: row.revoked_at
        ? "revoked"
        : row.suspended_at
          ? "suspended"
          : "active",
      createdAt: new Date(row.created_at).toISOString(),
      lastUsedAt: row.last_used_at
        ? new Date(row.last_used_at).toISOString()
        : null,
    }));
  }

  async updateConnection(
    ownerId: number,
    grantId: string,
    input: {
      mode?: "ask_each_time" | "auto_with_limits";
      maxPointsPerGeneration?: number;
      maxPointsPerDay?: number;
      suspended?: boolean;
    },
    reauthenticated = false,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const current = await sql<{
        mode: "ask_each_time" | "auto_with_limits";
        max_points_per_generation: number;
        max_points_per_day: number;
        suspended_at: Date | string | null;
      }>`
        SELECT mode, max_points_per_generation, max_points_per_day, suspended_at
        FROM auth.oauth_grants
        WHERE id = ${grantId} AND owner_id = ${ownerId} AND revoked_at IS NULL
        FOR UPDATE
      `.execute(trx);
      const row = current.rows[0];
      if (!row) {
        throw new AppError("OAUTH_INVALID_GRANT", "MCP 连接不存在", 404);
      }
      const requiresReauthentication =
        (input.mode === "auto_with_limits" &&
          row.mode !== "auto_with_limits") ||
        (input.maxPointsPerGeneration !== undefined &&
          input.maxPointsPerGeneration > row.max_points_per_generation) ||
        (input.maxPointsPerDay !== undefined &&
          input.maxPointsPerDay > row.max_points_per_day) ||
        (input.suspended === false && row.suspended_at !== null);
      if (requiresReauthentication && !reauthenticated) {
        throw new AppError(
          "AUTH_CREDENTIALS_INVALID",
          "提高自动化权限前需要重新输入账号密码",
          401,
        );
      }

      const sets = [
        input.mode === undefined ? null : sql`mode = ${input.mode}`,
        input.maxPointsPerGeneration === undefined
          ? null
          : sql`max_points_per_generation = ${input.maxPointsPerGeneration}`,
        input.maxPointsPerDay === undefined
          ? null
          : sql`max_points_per_day = ${input.maxPointsPerDay}`,
        input.suspended === undefined
          ? null
          : sql`suspended_at = ${input.suspended ? sql`now()` : sql`NULL`}`,
      ].filter((value): value is ReturnType<typeof sql> => value !== null);
      if (!sets.length) {
        throw new AppError("VALIDATION_FAILED", "没有可更新的连接策略", 400);
      }
      await sql`
        UPDATE auth.oauth_grants
        SET ${sql.join(sets, sql`, `)}
        WHERE id = ${grantId} AND owner_id = ${ownerId}
      `.execute(trx);
    });
  }

  async revokeConnection(ownerId: number, grantId: string): Promise<void> {
    const result = await sql<{ id: string }>`
      UPDATE auth.oauth_grants
      SET revoked_at = now()
      WHERE id = ${grantId}
        AND owner_id = ${ownerId}
        AND revoked_at IS NULL
      RETURNING id
    `.execute(this.db);
    if (!result.rows.length) return;

    const provider = this.requireProvider();
    await Promise.all([
      provider.AccessToken.revokeByGrantId(grantId),
      provider.AuthorizationCode.revokeByGrantId(grantId),
      provider.RefreshToken.revokeByGrantId(grantId),
    ]);
    const providerGrant = await provider.Grant.find(grantId);
    await providerGrant?.destroy();
  }

  private requireProvider(): Provider {
    if (!this.provider) {
      throw new AppError(
        "INTERNAL_ERROR",
        "OAuth provider 尚未初始化",
        500,
        true,
      );
    }
    return this.provider;
  }
}

function normalizeScopes(input: Iterable<string>): McpScope[] {
  const scopes = [...new Set(input)].filter((value): value is McpScope =>
    (MCP_SCOPES as readonly string[]).includes(value),
  );
  if (!scopes.length) {
    throw new AppError("OAUTH_SCOPE_INSUFFICIENT", "没有可用的 MCP scope", 400);
  }
  return scopes;
}
