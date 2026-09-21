import type { MusefoldTransaction } from '@musefold/db';
import { lockNormalAccountAuthority } from '../../lib/normal-account-authority.js';

/** Preserve package authority identity and rejection wording through the shared account guard. */
export function lockPackageAuthority(tx: MusefoldTransaction, userId: string, sessionId: string) {
  return lockNormalAccountAuthority(
    tx,
    userId,
    sessionId,
    '账号状态已变化，请重新登录后选择方案包',
  );
}
