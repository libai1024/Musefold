import { randomUUID } from 'node:crypto';
import type { ExecutionBinding } from '@musefold/contracts';
import {
  type MusefoldDatabase,
  accountCredentials,
  accountIdentities,
  accountSessionAuthorizations,
  session,
} from '@musefold/db';
import { sealJsonToString } from '@musefold/server-crypto';
import { and, eq, inArray } from 'drizzle-orm';

export const GENERATION_TEST_ISSUERS = {
  apiIssuer: 'http://127.0.0.1:8787',
  upstreamIssuer: 'https://generation-provider.test',
};
export const generationAuthSession = (principalId: string) => `${principalId}:authorizing`;

/** Explicit synthetic authority setup; user rows must already exist. No upstream calls. */
export async function seedGenerationAuthority(
  db: MusefoldDatabase,
  input: {
    principalId: string;
    ownerId: string;
    authorizingSessionId?: string;
    apiIssuer?: string;
    upstreamIssuer?: string;
    encryptionKey?: string;
    apiKey?: string;
    /** Only migration fixtures may replace their known synthetic unverified row. */
    replaceUnverifiedFixtureIdentity?: boolean;
  },
): Promise<ExecutionBinding> {
  const apiIssuer = input.apiIssuer ?? GENERATION_TEST_ISSUERS.apiIssuer;
  const upstreamIssuer = input.upstreamIssuer ?? GENERATION_TEST_ISSUERS.upstreamIssuer;
  const authorizingSessionId =
    input.authorizingSessionId ?? generationAuthSession(input.principalId);
  const credentialRef = randomUUID();
  const now = new Date();
  const identity = {
    userId: input.principalId,
    apiIssuer,
    upstreamIssuer,
    upstreamOwnerId: input.ownerId,
    status: 'active',
    identityVersion: 1,
    verifiedAt: now,
    evidence: { kind: 'synthetic_verified_fixture' },
  };
  if (input.replaceUnverifiedFixtureIdentity) {
    const replaced = await db
      .update(accountIdentities)
      .set(identity)
      .where(
        and(
          eq(accountIdentities.userId, input.principalId),
          inArray(accountIdentities.status, ['unverified', 'recovery_required']),
        ),
      )
      .returning({ id: accountIdentities.userId });
    if (replaced.length !== 1)
      throw new Error('Expected one known unverified migration fixture identity');
  } else await db.insert(accountIdentities).values(identity);
  await db.insert(accountCredentials).values({
    userId: input.principalId,
    provider: 'new-api',
    upstreamIssuer,
    upstreamOwnerId: input.ownerId,
    credentialRef,
    credentialVersion: 1,
    status: 'active',
    verifiedAt: now,
    ciphertext: sealJsonToString(
      { apiKey: input.apiKey ?? 'synthetic-generation-fixture-key' },
      input.encryptionKey ?? 'synthetic-generation-encryption-key',
    ),
    keyVersion: 'v1',
  });
  await db.insert(session).values({
    id: authorizingSessionId,
    userId: input.principalId,
    token: randomUUID(),
    expiresAt: new Date(now.getTime() + 24 * 3600_000),
  });
  await db.insert(accountSessionAuthorizations).values({
    sessionId: authorizingSessionId,
    userId: input.principalId,
    mode: 'normal',
    revision: 1,
  });
  return {
    apiIssuer,
    principalId: input.principalId,
    payer: { issuer: upstreamIssuer, ownerId: input.ownerId },
    credential: { ref: credentialRef, version: 1 },
    providerId: 'cloud-default',
    model: 'musefold-image-pro',
    capabilities: { image: true, text: false },
  };
}
