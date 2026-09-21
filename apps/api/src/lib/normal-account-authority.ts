import { and, eq } from 'drizzle-orm';
import {
  accountIdentities,
  accountSessionAuthorizations,
  session,
  user,
  executionDigest,
  type MusefoldTransaction,
} from '@musefold/db';
import { AppError } from './errors.js';

/** Free owner-scoped reads/admission: lock normal account identity, never read a model credential or authorize spend. */
export async function lockNormalAccountAuthority(
  tx: MusefoldTransaction,
  userId: string,
  sessionId: string,
  message = '账号状态已变化，请重新登录',
) {
  const [principal] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for('share');
  const [identity] = await tx
    .select()
    .from(accountIdentities)
    .where(eq(accountIdentities.userId, userId))
    .for('share');
  const [live] = await tx
    .select({ expiresAt: session.expiresAt })
    .from(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .for('share');
  const [authorization] = await tx
    .select()
    .from(accountSessionAuthorizations)
    .where(
      and(
        eq(accountSessionAuthorizations.sessionId, sessionId),
        eq(accountSessionAuthorizations.userId, userId),
      ),
    )
    .for('share');
  if (
    !principal ||
    identity?.status !== 'active' ||
    !live ||
    live.expiresAt <= new Date() ||
    authorization?.mode !== 'normal'
  )
    throw new AppError('AUTH_REQUIRED', message, 401);
  return executionDigest({
    userId,
    sessionId,
    revision: authorization.revision,
    apiIssuer: identity.apiIssuer,
    upstreamIssuer: identity.upstreamIssuer,
    upstreamOwnerId: identity.upstreamOwnerId,
    identityVersion: identity.identityVersion,
  });
}
