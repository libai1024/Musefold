import { type AccountExecutionIdentity, accountExecutionIdentitySchema } from '@musefold/contracts';
import { and, eq } from 'drizzle-orm';
import type { MusefoldTransaction } from './client.js';
import { session, user } from './schema/auth.js';
import {
  accountCredentials,
  accountIdentities,
  accountSessionAuthorizations,
} from './schema/credentials.js';

export type ExecutionAuthorityFailure =
  | 'session_invalid'
  | 'identity_unverified'
  | 'credential_unavailable'
  | 'binding_changed'
  | 'authorization_changed';

/** Static diagnostics: never attach the input, a database row, or a credential to this error. */
export class ExecutionAuthorityError extends Error {
  constructor(readonly reason: ExecutionAuthorityFailure) {
    super(`Generation execution authority rejected: ${reason}`);
    this.name = 'ExecutionAuthorityError';
  }
}

export type AccountExecutionAuthorityInput = {
  principalId: string;
  apiIssuer: string;
  upstreamIssuer: string;
  authSessionId: string;
  expectedAuthRevision?: number;
  now?: Date;
};
export type AccountExecutionAuthority = {
  identity: AccountExecutionIdentity;
  authRevision: number;
  encryptedCredential: Readonly<{ ciphertext: string; keyVersion: string }>;
};

/** Common identity locks only: user → identity → credential → session → authorization.
 * Caller retains the transaction through its claim/receipt commit. No network IO here.
 * Capability/model policy belongs to the image or text execution service, never the caller payload.
 */
export async function lockAccountExecutionIdentity(
  tx: MusefoldTransaction,
  input: AccountExecutionAuthorityInput,
): Promise<AccountExecutionAuthority> {
  const [principal] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, input.principalId))
    .for('share');
  if (!principal) throw new ExecutionAuthorityError('session_invalid');

  const [identity] = await tx
    .select()
    .from(accountIdentities)
    .where(eq(accountIdentities.userId, input.principalId))
    .for('share');
  if (
    identity?.status !== 'active' ||
    identity.apiIssuer !== input.apiIssuer ||
    identity.upstreamIssuer !== input.upstreamIssuer ||
    !identity.upstreamOwnerId ||
    !identity.verifiedAt
  ) {
    throw new ExecutionAuthorityError('identity_unverified');
  }

  const [credential] = await tx
    .select()
    .from(accountCredentials)
    .where(
      and(
        eq(accountCredentials.userId, input.principalId),
        eq(accountCredentials.provider, 'new-api'),
      ),
    )
    .for('share');
  if (
    credential?.status !== 'active' ||
    credential.upstreamIssuer !== identity.upstreamIssuer ||
    credential.upstreamOwnerId !== identity.upstreamOwnerId ||
    !credential.credentialRef ||
    credential.credentialVersion <= 0 ||
    !credential.verifiedAt ||
    !credential.ciphertext ||
    !credential.keyVersion
  ) {
    throw new ExecutionAuthorityError('credential_unavailable');
  }

  // Select no bearer/session token. Only a real, live Better Auth session authorizes execution.
  const [liveSession] = await tx
    .select({ userId: session.userId, expiresAt: session.expiresAt })
    .from(session)
    .where(eq(session.id, input.authSessionId))
    .for('share');
  if (!liveSession || liveSession.userId !== input.principalId)
    throw new ExecutionAuthorityError('session_invalid');

  const [authorization] = await tx
    .select()
    .from(accountSessionAuthorizations)
    .where(eq(accountSessionAuthorizations.sessionId, input.authSessionId))
    .for('share');
  if (
    !authorization ||
    authorization.userId !== input.principalId ||
    authorization.mode !== 'normal' ||
    !Number.isInteger(authorization.revision) ||
    authorization.revision <= 0
  ) {
    throw new ExecutionAuthorityError('authorization_changed');
  }
  // Evaluate expiry after the last potentially blocking lock acquisition.
  if (liveSession.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) {
    throw new ExecutionAuthorityError('session_invalid');
  }
  if (
    input.expectedAuthRevision !== undefined &&
    authorization.revision !== input.expectedAuthRevision
  ) {
    throw new ExecutionAuthorityError('authorization_changed');
  }

  const parsed = accountExecutionIdentitySchema.safeParse({
    apiIssuer: input.apiIssuer,
    principalId: input.principalId,
    payer: { issuer: identity.upstreamIssuer, ownerId: identity.upstreamOwnerId },
    credential: { ref: credential.credentialRef, version: credential.credentialVersion },
  });
  if (!parsed.success) throw new ExecutionAuthorityError('credential_unavailable');
  return {
    identity: parsed.data,
    authRevision: authorization.revision,
    encryptedCredential: Object.freeze({
      ciphertext: credential.ciphertext,
      keyVersion: credential.keyVersion,
    }),
  };
}
