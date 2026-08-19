import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Adapter, AdapterPayload } from 'oidc-provider';
import type { MusefoldDatabase } from '../../database/types.js';

interface ArtifactRow {
  payload: AdapterPayload;
}

interface ClientRow {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  metadata: AdapterPayload | null;
}

export function createPostgresOidcAdapter(db: Kysely<MusefoldDatabase>) {
  return class PostgresOidcAdapter implements Adapter {
    constructor(private readonly model: string) {}

    async upsert(
      id: string,
      payload: AdapterPayload,
      expiresIn?: number,
    ): Promise<void> {
      if (this.model === 'Client') {
        await this.upsertClient(id, payload);
        return;
      }

      const storageId = hashArtifactId(id);
      const storedPayload = { ...payload, jti: storageId };
      const expiresAt =
        typeof expiresIn === 'number'
          ? new Date(Date.now() + expiresIn * 1_000)
          : null;
      await sql`
        INSERT INTO auth.oidc_provider_artifacts(model, id, payload, expires_at)
        VALUES (${this.model}, ${storageId}, ${JSON.stringify(storedPayload)}::jsonb, ${expiresAt})
        ON CONFLICT (model, id) DO UPDATE
        SET payload = EXCLUDED.payload,
            expires_at = EXCLUDED.expires_at,
            updated_at = now()
      `.execute(db);
    }

    async find(id: string): Promise<AdapterPayload | undefined> {
      if (this.model === 'Client') return this.findClient(id);
      const result = await sql<ArtifactRow>`
        SELECT payload
        FROM auth.oidc_provider_artifacts
        WHERE model = ${this.model}
          AND id = ${hashArtifactId(id)}
          AND (expires_at IS NULL OR expires_at > now())
      `.execute(db);
      const payload = result.rows[0]?.payload;
      return payload ? { ...payload, jti: id } : undefined;
    }

    async findByUserCode(
      userCode: string,
    ): Promise<AdapterPayload | undefined> {
      return this.findByPayloadField('userCode', userCode);
    }

    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
      return this.findByPayloadField('uid', uid);
    }

    async consume(id: string): Promise<void> {
      if (this.model === 'Client') return;
      const consumedAt = Math.floor(Date.now() / 1_000);
      await sql`
        UPDATE auth.oidc_provider_artifacts
        SET payload = jsonb_set(payload, '{consumed}', to_jsonb(${consumedAt}::bigint), true),
            updated_at = now()
        WHERE model = ${this.model} AND id = ${hashArtifactId(id)}
      `.execute(db);
    }

    async destroy(id: string): Promise<void> {
      if (this.model === 'Client') {
        await sql`
          UPDATE auth.oauth_clients
          SET revoked_at = now()
          WHERE client_id = ${id} AND revoked_at IS NULL
        `.execute(db);
        await sql`
          UPDATE auth.oauth_grants
          SET revoked_at = now()
          WHERE client_id = ${id} AND revoked_at IS NULL
        `.execute(db);
        return;
      }
      await sql`
        DELETE FROM auth.oidc_provider_artifacts
        WHERE model = ${this.model} AND id = ${hashArtifactId(id)}
      `.execute(db);
    }

    async revokeByGrantId(grantId: string): Promise<void> {
      if (this.model === 'Client') return;
      await sql`
        DELETE FROM auth.oidc_provider_artifacts
        WHERE model = ${this.model} AND payload ->> 'grantId' = ${grantId}
      `.execute(db);
    }

    private async upsertClient(
      id: string,
      payload: AdapterPayload,
    ): Promise<void> {
      const redirectUris = Array.isArray(payload.redirect_uris)
        ? payload.redirect_uris.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const clientName =
        typeof payload.client_name === 'string' && payload.client_name.trim()
          ? payload.client_name.trim().slice(0, 160)
          : id;
      const authMethod: AdapterPayload['token_endpoint_auth_method'] = 'none';
      await sql`
        INSERT INTO auth.oauth_clients(
          client_id, client_name, redirect_uris, token_endpoint_auth_method,
          client_secret_hash, registration_type, metadata
        )
        VALUES (
          ${id}, ${clientName}, ${JSON.stringify(redirectUris)}::jsonb,
          ${authMethod}, NULL, 'dynamic', ${JSON.stringify(payload)}::jsonb
        )
        ON CONFLICT (client_id) DO UPDATE
        SET client_name = EXCLUDED.client_name,
            redirect_uris = EXCLUDED.redirect_uris,
            token_endpoint_auth_method = EXCLUDED.token_endpoint_auth_method,
            metadata = EXCLUDED.metadata,
            revoked_at = NULL
      `.execute(db);
    }

    private async findClient(id: string): Promise<AdapterPayload | undefined> {
      const result = await sql<ClientRow>`
        SELECT client_id, client_name, redirect_uris,
          token_endpoint_auth_method, metadata
        FROM auth.oauth_clients
        WHERE client_id = ${id} AND revoked_at IS NULL
      `.execute(db);
      const row = result.rows[0];
      if (!row) return undefined;
      return (
        row.metadata ?? {
          client_id: row.client_id,
          client_name: row.client_name,
          redirect_uris: row.redirect_uris,
          response_types: ['code'],
          grant_types: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_method: 'none',
        }
      );
    }

    private async findByPayloadField(
      field: 'uid' | 'userCode',
      value: string,
    ): Promise<AdapterPayload | undefined> {
      const result = await sql<ArtifactRow>`
        SELECT payload
        FROM auth.oidc_provider_artifacts
        WHERE model = ${this.model}
          AND payload ->> ${field} = ${value}
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY updated_at DESC
        LIMIT 1
      `.execute(db);
      return result.rows[0]?.payload;
    }
  };
}

function hashArtifactId(value: string): string {
  if (/^[a-f0-9]{64}$/.test(value)) return value;
  return createHash('sha256').update(value).digest('hex');
}
