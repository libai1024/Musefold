import { sql, type Kysely } from 'kysely';
import type { WebApiConfig } from '../../config.js';
import type { MusefoldDatabase } from '../../database/types.js';
import {
  createCsrfToken,
  createOpaqueId,
  hashSessionId,
  openJson,
  sealJson,
} from './crypto.js';

export interface SessionCredentials {
  accessToken: string;
  refreshToken: string;
}

export interface StoredSession {
  rawId: string;
  ownerId: number;
  username: string;
  csrfToken: string;
  credentials: SessionCredentials;
  accessExpiresAt: Date;
  lastSeenAt: Date;
}

export interface SessionStorePort {
  create(input: {
    ownerId: number;
    username: string;
    credentials: SessionCredentials;
    accessExpiresAt: Date;
  }): Promise<StoredSession>;
  get(rawId: string): Promise<StoredSession | null>;
  replaceCredentials(
    rawId: string,
    credentials: SessionCredentials,
    accessExpiresAt: Date,
  ): Promise<void>;
  revoke(rawId: string): Promise<void>;
}

interface SessionRow {
  id_hash: string;
  owner_id: string;
  username_snapshot: string;
  credentials_ciphertext: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
  key_version: number;
  access_expires_at: Date;
  csrf_nonce: string;
  created_at: Date;
  last_seen_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
}

export class SessionStore implements SessionStorePort {
  constructor(
    private readonly db: Kysely<MusefoldDatabase>,
    private readonly config: Pick<
      WebApiConfig,
      | 'SESSION_ENCRYPTION_KEY'
      | 'SESSION_IDLE_TTL_SECONDS'
      | 'SESSION_ABSOLUTE_TTL_SECONDS'
    >,
  ) {}

  async create(input: {
    ownerId: number;
    username: string;
    credentials: SessionCredentials;
    accessExpiresAt: Date;
  }): Promise<StoredSession> {
    const rawId = createOpaqueId();
    const idHash = hashSessionId(rawId);
    const csrfToken = createCsrfToken();
    const sealed = sealJson(
      input.credentials,
      this.config.SESSION_ENCRYPTION_KEY,
    );
    const now = new Date();
    const accessExpiresAt = input.accessExpiresAt;
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.SESSION_ABSOLUTE_TTL_SECONDS * 1_000,
    );
    await sql`
      SELECT auth.insert_web_session(
        ${idHash}, ${input.ownerId}, ${input.username}, ${sealed.ciphertext},
        ${sealed.nonce}, ${sealed.authTag}, 1, ${accessExpiresAt},
        ${csrfToken}, ${absoluteExpiresAt}
      )
    `.execute(this.db);
    return {
      rawId,
      ownerId: input.ownerId,
      username: input.username,
      csrfToken,
      credentials: input.credentials,
      accessExpiresAt,
      lastSeenAt: now,
    };
  }

  async get(rawId: string): Promise<StoredSession | null> {
    const result =
      await sql<SessionRow>`SELECT * FROM auth.find_web_session(${hashSessionId(rawId)})`.execute(
        this.db,
      );
    const row = result.rows[0];
    if (!row) return null;
    const credentials = openJson<SessionCredentials>(
      {
        ciphertext: row.credentials_ciphertext,
        nonce: row.nonce,
        authTag: row.auth_tag,
      },
      this.config.SESSION_ENCRYPTION_KEY,
    );
    if (Date.now() - row.last_seen_at.getTime() > 60_000) {
      await sql`SELECT auth.touch_web_session(${hashSessionId(rawId)})`.execute(
        this.db,
      );
    }
    return {
      rawId,
      ownerId: Number(row.owner_id),
      username: row.username_snapshot,
      csrfToken: row.csrf_nonce,
      credentials,
      accessExpiresAt: row.access_expires_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  async replaceCredentials(
    rawId: string,
    credentials: SessionCredentials,
    accessExpiresAt: Date,
  ): Promise<void> {
    const sealed = sealJson(credentials, this.config.SESSION_ENCRYPTION_KEY);
    await sql`
      SELECT auth.replace_web_session_credentials(
        ${hashSessionId(rawId)}, ${sealed.ciphertext}, ${sealed.nonce},
        ${sealed.authTag}, 1, ${accessExpiresAt}
      )
    `.execute(this.db);
  }

  async revoke(rawId: string): Promise<void> {
    await sql`SELECT auth.revoke_web_session(${hashSessionId(rawId)})`.execute(
      this.db,
    );
  }
}
