import { ACCOUNT_CLOUD_PROVIDER_TYPE } from '@musefold/contracts';
import { getDb } from '@musefold/core/db';

/** Host policy shared by v25 IPC and the local-proof Automation channel. */
export class ProviderConnectionError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'MANAGED_CONNECTION_IMMUTABLE' | 'MANAGED_CONNECTION_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderConnectionError';
  }
}

function requireProvider(id: string): Record<string, unknown> {
  const row = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new ProviderConnectionError('NOT_FOUND', 'AI 连接不存在');
  return row;
}

export function assertProviderEditable(id: string): void {
  if (requireProvider(id).type === ACCOUNT_CLOUD_PROVIDER_TYPE)
    throw new ProviderConnectionError(
      'MANAGED_CONNECTION_IMMUTABLE',
      '账号云连接由当前账号维护，不使用自备密钥或自定义模型',
    );
}

/** Cloud selection/probing must revalidate the current account and durable state. */
export async function withVerifiedProvider<T>(id: string, action: () => T): Promise<T> {
  if (requireProvider(id).type !== ACCOUNT_CLOUD_PROVIDER_TYPE) return action();
  const { useAccountCloudProvider, managedConnectionMessage } = await import(
    './account-cloud-connection'
  );
  try {
    return await useAccountCloudProvider(id, action);
  } catch (error) {
    throw new ProviderConnectionError(
      'MANAGED_CONNECTION_UNAVAILABLE',
      managedConnectionMessage(error),
    );
  }
}

export async function activateImageProvider(id: string): Promise<void> {
  await withVerifiedProvider(id, () => {
    const db = getDb();
    db.transaction(() => {
      db.prepare('UPDATE providers SET is_active = 0 WHERE is_active = 1').run();
      if (db.prepare('UPDATE providers SET is_active = 1 WHERE id = ?').run(id).changes !== 1)
        throw new ProviderConnectionError('NOT_FOUND', 'AI 连接不存在');
    })();
  });
}

/** Removing a default may select another BYOK, never silently authorize an account connection. */
export function removeImageProviderRow(id: string): Record<string, unknown> {
  const db = getDb();
  return db.transaction(() => {
    const row = requireProvider(id);
    const next =
      row.is_active === 1
        ? (db
            .prepare(`SELECT id FROM providers
      WHERE id <> ? AND type <> ? AND COALESCE(managed_by, '') <> 'account'
      ORDER BY updated_at DESC LIMIT 1`)
            .get(id, ACCOUNT_CLOUD_PROVIDER_TYPE) as { id: string } | undefined)
        : undefined;
    if (db.prepare('DELETE FROM providers WHERE id = ?').run(id).changes !== 1)
      throw new ProviderConnectionError('NOT_FOUND', 'AI 连接不存在');
    if (
      next &&
      db.prepare('UPDATE providers SET is_active = 1 WHERE id = ?').run(next.id).changes !== 1
    )
      throw new ProviderConnectionError('NOT_FOUND', 'AI 连接接管失败');
    return row;
  })();
}
