import { sql, type Kysely } from 'kysely';
import type { WebApiConfig } from '../../config.js';
import type { MusefoldDatabase } from '../../database/types.js';
import { openJson, sealJson } from './crypto.js';

export interface AccountGenerationCredential {
  apiKey: string;
}

export interface AccountCredentialStorePort {
  put(
    ownerId: number,
    credential: AccountGenerationCredential,
    externalTokenId: number,
  ): Promise<void>;
  get(ownerId: number): Promise<AccountGenerationCredential | null>;
}

interface CredentialRow {
  credential_ciphertext: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
}

export class AccountCredentialStore implements AccountCredentialStorePort {
  constructor(
    private readonly db: Kysely<MusefoldDatabase>,
    private readonly config: Pick<WebApiConfig, 'SESSION_ENCRYPTION_KEY'>,
  ) {}

  async put(
    ownerId: number,
    credential: AccountGenerationCredential,
    externalTokenId: number,
  ): Promise<void> {
    const sealed = sealJson(credential, this.config.SESSION_ENCRYPTION_KEY);
    await sql`
      SELECT auth.upsert_account_credential(
        ${ownerId}, 'new-api', ${sealed.ciphertext}, ${sealed.nonce},
        ${sealed.authTag}, 1, ${externalTokenId}
      )
    `.execute(this.db);
  }

  async get(ownerId: number): Promise<AccountGenerationCredential | null> {
    const result =
      await sql<CredentialRow>`SELECT * FROM auth.find_account_credential(${ownerId})`.execute(
        this.db,
      );
    const row = result.rows[0];
    if (!row) return null;
    return openJson<AccountGenerationCredential>(
      {
        ciphertext: row.credential_ciphertext,
        nonce: row.nonce,
        authTag: row.auth_tag,
      },
      this.config.SESSION_ENCRYPTION_KEY,
    );
  }
}
