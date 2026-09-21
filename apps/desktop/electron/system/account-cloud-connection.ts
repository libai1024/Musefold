import { createHash, randomUUID } from 'node:crypto';
import {
  ACCOUNT_CLOUD_PROVIDER_TYPE,
  accountCloudStatusSchema,
  aiProviderSchema,
  type AccountCloudStatus,
  type ExecutionBinding,
} from '@musefold/contracts';
import { captureDatabaseAccess, getDb } from '@musefold/core/db';
import {
  ManagedExecutionError,
  ManagedExecutionRepository,
} from '@musefold/core/db/repositories/managed-execution';
import { automationInputHash } from '@musefold/core/db/repositories/automation-spend';
import type { ManagedGenerationContext } from '@musefold/desktop-contracts/managed-generation';
import { legacyManagedSpendBarrier } from './legacy-managed-spend';
import { withManagedGenerationSession } from './managed-generation-client';

const reviews = new Map<
  string,
  {
    context: ManagedGenerationContext;
    binding: ExecutionBinding;
    action: 'connect' | 'resume';
    expiresAt: number;
    assertDb(): void;
  }
>();

export function accountCloudProviderId(
  context: Pick<ManagedGenerationContext, 'apiIssuer' | 'principalId'>,
): string {
  return `cloud-${createHash('sha256')
    .update(JSON.stringify([context.apiIssuer, context.principalId]))
    .digest('base64url')}`;
}

export function readAccountCloudProvider(context: ManagedGenerationContext) {
  const row = getDb()
    .prepare(`SELECT id, name, type, base_url AS baseUrl, model,
    is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
    FROM providers WHERE id = ?`)
    .get(accountCloudProviderId(context)) as Record<string, unknown> | undefined;
  if (!row) return null;
  if (
    row.type !== ACCOUNT_CLOUD_PROVIDER_TYPE ||
    row.baseUrl !== context.apiIssuer ||
    row.model !== 'musefold-image-pro'
  )
    throw new ManagedExecutionError('MANAGED_CONNECTION_CHANGED');
  return aiProviderSchema.parse({
    ...row,
    isActive: row.isActive === 1,
    hasKey: false,
    keySuffix: null,
    managedBy: 'account',
    createdAt: new Date(Number(row.createdAt)).toISOString(),
    updatedAt: new Date(Number(row.updatedAt)).toISOString(),
  });
}

export function managedConnectionMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'MANAGED_RETRY_UNRESOLVED')
    return '原任务或费用尚未核对完成，请先核对原任务；此次没有重新生成。';
  if (code === 'MANAGED_RETRY_MISMATCH' || code === 'IDEMPOTENCY_CONFLICT')
    return '重试意图与原任务不一致，请核对原任务后重新发起。';
  if (code === 'MANAGED_RECOVERY_CURSOR_INVALID') return '账号或任务列表已变化，请刷新后重新加载。';
  if (code === 'MANAGED_RESULT_PENDING' || code === 'MANAGED_ASSET_UNAVAILABLE')
    return '云任务已结束，图片暂时无法获取；可稍后核对原任务，不会重新生成。';
  if (code === 'MANAGED_INPUT_UNSUPPORTED')
    return '账号云图像当前支持普通文字生成与参考图；提示词引用和微调接入尚未完成，请先移除这些输入。';
  if (code === 'MANAGED_REFERENCE_READ_FAILED' || code === 'MANAGED_REFERENCE_NOT_STAGED')
    return '参考图读取失败，请重新上传后再试；此次没有产生生成费用。';
  if (code === 'MANAGED_REFERENCE_UPLOAD_FAILED')
    return '参考图上传失败，请检查账号与网络后重试；此次没有产生生成费用。';
  if (code === 'MANAGED_LEGACY_SPEND_UNRESOLVED')
    return '旧任务或未结费用尚未完成核对，请先处理原任务。';
  if (code === 'MANAGED_ENABLEMENT_BUSY') return '其他任务正在处理，请稍后重新检查。';
  if (
    code === 'MANAGED_REVIEW_EXPIRED' ||
    code === 'MANAGED_IDENTITY_CHANGED' ||
    code === 'ACCOUNT_SESSION_CHANGED'
  )
    return '账号或连接状态已变化，请重新检查后确认。';
  if (
    code === 'AUTH_REQUIRED' ||
    code === 'ACCOUNT_IDENTITY_UNVERIFIED' ||
    code === 'MANAGED_AUTH_REQUIRED'
  )
    return '请先登录并完成账号身份核对。';
  if (code?.startsWith('MANAGED_ANCHOR') || code === 'MANAGED_RECONCILIATION_REQUIRED')
    return '本机执行记录需要核对，请恢复匹配的安全备份后重新检查。';
  if (code === 'MANAGED_RESTART_REQUIRED' || code === 'DATABASE_RESTART_REQUIRED')
    return '数据恢复尚未完成，请重启应用后重新检查。';
  return '暂时无法确认账号云连接，请检查账号与网络后重试。';
}

export async function getAccountCloudStatus(): Promise<AccountCloudStatus> {
  try {
    return await withManagedGenerationSession(async ({ client, guard, assertCurrent }) => {
      const binding = await client.binding();
      const state = await guard.status();
      assertCurrent();
      const connection = readAccountCloudProvider(client.context);
      let action: 'connect' | 'resume' | null = null;
      if (state.mode === 'not_enabled') {
        new ManagedExecutionRepository(getDb()).assertReadyToEnable();
        action = 'connect';
      } else if (state.mode === 'active') action = connection ? null : 'connect';
      else {
        const canResume = await guard.canResumeMatchingCheckpoint();
        assertCurrent();
        if (canResume) action = 'resume';
      }
      const reviewRef = action ? randomUUID() : null;
      for (const [key, review] of reviews) if (review.expiresAt <= Date.now()) reviews.delete(key);
      while (reviews.size >= 20) reviews.delete(reviews.keys().next().value as string);
      if (reviewRef && action)
        reviews.set(reviewRef, {
          context: client.context,
          binding,
          action,
          expiresAt: Date.now() + 120_000,
          assertDb: captureDatabaseAccess(),
        });
      return accountCloudStatusSchema.parse({
        mode: state.mode,
        principalId: client.context.principalId,
        apiIssuer: client.context.apiIssuer,
        connectionId: connection?.id ?? null,
        reviewRef,
        reviewAction: action,
        message:
          state.mode === 'query_only'
            ? action === 'resume'
              ? '安全备份与执行记录一致。确认后可继续核对原云任务。'
              : '执行记录需要核对，请恢复匹配的安全备份后重新检查。'
            : connection
              ? '使用当前账号的云图像服务，费用由账号额度承担。'
              : '连接当前账号的云图像服务；不会自动生成图片或开启同步。',
      });
    });
  } catch (error) {
    return accountCloudStatusSchema.parse({
      mode: 'blocked',
      principalId: null,
      apiIssuer: null,
      connectionId: null,
      reviewRef: null,
      reviewAction: null,
      message: managedConnectionMessage(error),
    });
  }
}

export async function applyAccountCloudReview(
  reviewRef: string,
  action: 'connect' | 'resume',
): Promise<AccountCloudStatus> {
  const review = reviews.get(reviewRef);
  reviews.delete(reviewRef);
  if (!review || review.action !== action || review.expiresAt <= Date.now())
    throw new ManagedExecutionError('MANAGED_REVIEW_EXPIRED');
  await legacyManagedSpendBarrier.whileIdle(() =>
    withManagedGenerationSession(async ({ client, guard, assertCurrent }) => {
      review.assertDb();
      if (automationInputHash(client.context) !== automationInputHash(review.context))
        throw new ManagedExecutionError('MANAGED_IDENTITY_CHANGED');
      const binding = await client.binding();
      if (automationInputHash(binding) !== automationInputHash(review.binding))
        throw new ManagedExecutionError('MANAGED_IDENTITY_CHANGED');
      assertCurrent();
      const { getAutomationSpendRepository } = await import('../settings/automation');
      assertCurrent();
      getAutomationSpendRepository(); // Import the existing policy once, before explicit enablement.
      const state = await guard.status();
      assertCurrent();
      try {
        if (action === 'resume') {
          await guard.resumeMatchingCheckpoint(() => {
            assertCurrent();
            review.assertDb();
            if (review.expiresAt <= Date.now())
              throw new ManagedExecutionError('MANAGED_REVIEW_EXPIRED');
          });
        } else {
          const create = () => {
            assertCurrent();
            review.assertDb();
            const existing = readAccountCloudProvider(client.context);
            if (!existing) {
              const now = Date.now();
              getDb()
                .prepare(`INSERT INTO providers
              (id,name,type,base_url,model,has_key,key_suffix,is_active,managed_by,created_at,updated_at)
              VALUES (?, '账号云图像', ?, ?, 'musefold-image-pro', 0, NULL, 0, 'account', ?, ?)`)
                .run(
                  accountCloudProviderId(client.context),
                  ACCOUNT_CLOUD_PROVIDER_TYPE,
                  client.context.apiIssuer,
                  now,
                  now,
                );
            }
            getDb().prepare('UPDATE providers SET is_active = 0 WHERE is_active = 1').run();
            getDb()
              .prepare('UPDATE providers SET is_active = 1 WHERE id = ?')
              .run(accountCloudProviderId(client.context));
          };
          if (state.mode === 'not_enabled') await guard.enable(create);
          else
            await guard.mutate(
              'connection',
              { connectionId: accountCloudProviderId(client.context) },
              create,
            );
        }
        legacyManagedSpendBarrier.retire();
      } catch (error) {
        if ((await guard.status()).mode !== 'not_enabled') legacyManagedSpendBarrier.retire();
        throw error;
      }
    }, true),
  );
  return getAccountCloudStatus();
}

/** Checks the captured account and immutable row again immediately before the host's change. */
export async function useAccountCloudProvider<T>(id: string, change: () => T): Promise<T> {
  return withManagedGenerationSession(async ({ client, guard, assertCurrent }) => {
    await client.binding();
    if ((await guard.status()).mode !== 'active')
      throw new ManagedExecutionError('MANAGED_RECONCILIATION_REQUIRED');
    assertCurrent();
    if (readAccountCloudProvider(client.context)?.id !== id)
      throw new ManagedExecutionError('MANAGED_CONNECTION_CHANGED');
    return change();
  });
}
