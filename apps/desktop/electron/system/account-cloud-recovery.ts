import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { z } from 'zod';
import {
  accountCloudRecoveryItemSchema,
  accountCloudRecoveryListSchema,
  accountCloudLegacyListSchema,
  accountCloudPageQuerySchema,
  entityIdSchema,
  generationRecoverySchema,
  type AccountCloudPageQuery,
  type GenerationRecovery,
} from '@musefold/contracts';
import { getDb } from '@musefold/core/db';
import {
  MANAGED_ENABLEMENT_BLOCKER_SQL,
  ManagedExecutionError,
} from '@musefold/core/db/repositories/managed-execution';
import type { ManagedGenerationLedger } from '@musefold/core/services/managed-generation-ledger';
import {
  managedGenerationRecordSchema,
  type ManagedGenerationRecord,
  type ManagedGenerationContext,
} from '@musefold/desktop-contracts/managed-generation';

const PAGE_SIZE = 20;
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'rejected', 'expired']);
const cursorSchema = z
  .object({
    version: z.literal(1),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    id: entityIdSchema,
  })
  .strict();
const scopeHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function readCursor(query: AccountCloudPageQuery, scope: string) {
  const { cursor } = accountCloudPageQuerySchema.parse(query);
  if (!cursor) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('cursor');
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('cursor');
    const value = cursorSchema.parse(JSON.parse(bytes.toString()));
    if (value.scope !== scope) throw new Error('scope');
    return value;
  } catch {
    throw new ManagedExecutionError('MANAGED_RECOVERY_CURSOR_INVALID');
  }
}
function nextCursor(rows: Array<{ id: string; createdAt: number }>, scope: string) {
  if (rows.length <= PAGE_SIZE) return null;
  return Buffer.from(
    JSON.stringify(cursorSchema.parse({ version: 1, scope, ...rows[PAGE_SIZE - 1] })),
  ).toString('base64url');
}

/** Availability is derived from the actual local assets, not from a cloud success label. */
export function describeManagedRecovery(record: ManagedGenerationRecord): GenerationRecovery {
  const db = getDb();
  const run = db
    .prepare(
      `SELECT r.id, r.status FROM generation_runs r JOIN automation_spend_requests s ON s.execution_id = r.id WHERE s.id = ?`,
    )
    .get(record.requestId) as { id: string; status: string } | undefined;
  const receipt = record.receipt;
  const costKnown =
    record.submissionState === 'unclaimed' ||
    Boolean(
      receipt &&
        ((receipt.costProvenance === 'provider_reported' && receipt.costPoints !== null) ||
          (receipt.costProvenance === 'not_sent' &&
            receipt.dispatch !== 'claimed' &&
            receipt.terminalAt)),
    );
  let result: GenerationRecovery['result'] = 'not_ready';
  if (!run) result = 'history_removed';
  else {
    const assets = db
      .prepare(
        'SELECT media_path AS path, file_size AS size FROM generated_assets WHERE run_id = ? AND status = ? ORDER BY position',
      )
      .all(run.id, 'available') as Array<{ path: string | null; size: number | null }>;
    const available =
      assets.length === record.frozenRequest.count &&
      assets.every((asset) => {
        if (!asset.path) return false;
        try {
          const file = statSync(asset.path);
          return file.isFile() && (asset.size === null || file.size === asset.size);
        } catch {
          return false;
        }
      });
    if (available) result = 'available';
    else if (receipt?.purgedAt && receipt.status === 'succeeded') result = 'purged';
    else if (assets.length) result = 'missing';
    else if (receipt?.status === 'succeeded') result = 'download_pending';
  }
  const message =
    result === 'purged'
      ? '云任务已完成，但云端素材已清理，本机没有完整图片；不会重新生成。'
      : result === 'history_removed'
        ? '本机结果记录不存在；仍可按原任务核对云状态和费用，不会重建或重新生成。'
        : result === 'missing'
          ? '本机图片缺失；核对时只重新获取原任务素材，不会重新生成。'
          : result === 'download_pending'
            ? '云任务已完成，图片尚未保存到本机；可核对原任务重新获取。'
            : result === 'available'
              ? costKnown
                ? '图片已保存，费用已核对。'
                : '图片已保存，费用仍需核对。'
              : record.submissionState === 'unclaimed'
                ? record.cancelRequestedAt !== null
                  ? '未发送的请求已停止，没有生图费用。'
                  : '请求未取得发送资格；可停止此记录，核对不会重新发送。'
                : receipt?.terminalAt
                  ? costKnown
                    ? '云任务已结束，费用已核对。'
                    : '云任务已结束，费用仍未知，请核对原任务。'
                  : record.cancelRequestedAt !== null
                    ? '停止请求已记录，仍需核对原任务结果与已发生费用。'
                    : receipt
                      ? '云任务尚未结束；核对只查询原任务。'
                      : '尚未查到原任务回执；状态和费用未知，不会重新发送。';
  return generationRecoverySchema.parse({
    requestId: record.requestId,
    remoteStatus: receipt?.status ?? null,
    costKnown,
    result,
    message,
  });
}

export function readManagedRecoveryForLocalJob(jobId: string): GenerationRecovery | undefined {
  const row = getDb()
    .prepare(`SELECT m.record_json AS record FROM managed_generation_requests m
    JOIN automation_spend_requests s ON s.id = m.request_id WHERE s.execution_id = ?`)
    .get(jobId) as { record: string } | undefined;
  return row
    ? describeManagedRecovery(managedGenerationRecordSchema.parse(JSON.parse(row.record)))
    : undefined;
}

export function accountCloudRecoveryItem(
  requestId: string,
  ledger: ManagedGenerationLedger,
  context: ManagedGenerationContext,
) {
  const record = ledger.forQuery(requestId, context);
  const local = getDb()
    .prepare(
      `SELECT r.id FROM generation_runs r JOIN automation_spend_requests s ON s.execution_id = r.id WHERE s.id = ?`,
    )
    .get(requestId) as { id: string } | undefined;
  return accountCloudRecoveryItemSchema.parse({
    requestId,
    localGenerationId: local?.id ?? null,
    createdAt: new Date(record.createdAt).toISOString(),
    recovery: describeManagedRecovery(record),
    canCancel:
      !(record.receipt && terminal.has(record.receipt.status)) &&
      !(record.cancelRequestedAt !== null && record.submissionState === 'unclaimed'),
  });
}

/** Keyset pagination is independent of mutable task status, so reconciliation cannot skip rows. */
export function listAccountCloudRecovery(
  ledger: ManagedGenerationLedger,
  context: ManagedGenerationContext,
  query: AccountCloudPageQuery = {},
) {
  const scope = scopeHash(['cloud', context.apiIssuer, context.principalId]);
  const cursor = readCursor(query, scope);
  const rows = getDb()
    .prepare(`SELECT m.request_id AS id, s.created_at AS createdAt
    FROM managed_generation_requests m JOIN automation_spend_requests s ON s.id = m.request_id
    WHERE m.api_issuer = ? AND m.principal_id = ?
    ${cursor ? 'AND (s.created_at < ? OR (s.created_at = ? AND s.id < ?))' : ''}
    ORDER BY s.created_at DESC, s.id DESC LIMIT ?`)
    .all(
      context.apiIssuer,
      context.principalId,
      ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
      PAGE_SIZE + 1,
    ) as Array<{ id: string; createdAt: number }>;
  return accountCloudRecoveryListSchema.parse({
    items: rows.slice(0, PAGE_SIZE).map((row) => accountCloudRecoveryItem(row.id, ledger, context)),
    nextCursor: nextCursor(rows, scope),
  });
}

/** This is a local diagnostic; no old record is attributed to today's cloud principal. */
export function listLegacyManagedDiagnostics(query: AccountCloudPageQuery = {}) {
  const scope = scopeHash(['legacy-local']);
  const cursor = readCursor(query, scope);
  const rows = getDb()
    .prepare(`SELECT r.id, r.created_at AS createdAt, r.action, r.state, r.reservation_state AS reservation
    FROM automation_spend_requests r WHERE NOT EXISTS(SELECT 1 FROM managed_generation_requests m WHERE m.request_id = r.id)
    AND (${MANAGED_ENABLEMENT_BLOCKER_SQL})
    ${cursor ? 'AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))' : ''}
    ORDER BY r.created_at DESC, r.id DESC LIMIT ?`)
    .all(
      ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
      PAGE_SIZE + 1,
    ) as Array<{
    id: string;
    createdAt: number;
    action: string;
    state: string;
    reservation: string;
  }>;
  return accountCloudLegacyListSchema.parse({
    items: rows.slice(0, PAGE_SIZE).map((row) => ({
      requestId: row.id,
      createdAt: new Date(row.createdAt).toISOString(),
      kind:
        row.action === 'generate_image'
          ? 'image'
          : row.action === 'run_scheme'
            ? 'scheme'
            : row.action === 'run_github_skill'
              ? 'skill'
              : 'other',
      reason:
        row.reservation === 'unknown'
          ? 'unknown_cost'
          : row.state !== 'terminal'
            ? 'in_progress'
            : 'unfinished_call',
    })),
    nextCursor: nextCursor(
      rows.map(({ id, createdAt }) => ({ id, createdAt })),
      scope,
    ),
  });
}
