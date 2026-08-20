// 桌面 HistoryRecord ↔ contracts GenerationJob / 历史分页。

import type {
  ApiErrorCode,
  GenerationAsset,
  GenerationHistoryQuery,
  GenerationHistoryPage,
  GenerationJob,
  GenerationQuality,
  GenerationSize,
  GenerationStatus,
} from '@musefold/contracts';
import type { HistoryRecord } from '@musefold/desktop-contracts/models';
import {
  epochMsToIso,
  epochMsToIsoOrNull,
  nextOffsetCursor,
  parseOffsetCursor,
  resolvePageLimit,
} from './time';

const API_ERROR_CODES = new Set<string>([
  'AUTH_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'AUTH_CREDENTIALS_INVALID',
  'AUTH_REGISTRATION_DISABLED',
  'OAUTH_INVALID_GRANT',
  'OAUTH_SCOPE_INSUFFICIENT',
  'ACCOUNT_QUOTA_INSUFFICIENT',
  'ACCOUNT_REDEEM_INVALID',
  'PROMPT_NOT_FOUND',
  'PROMPT_VERSION_CONFLICT',
  'SYNC_CURSOR_EXPIRED',
  'SYNC_MUTATION_CONFLICT',
  'WORKBENCH_SESSION_NOT_FOUND',
  'WORKBENCH_VERSION_CONFLICT',
  'GENERATION_NOT_FOUND',
  'GENERATION_ALREADY_TERMINAL',
  'GENERATION_UPSTREAM_REJECTED',
  'GENERATION_UPSTREAM_UNKNOWN',
  'GENERATION_STORAGE_FAILED',
  'GENERATION_APPROVAL_REQUIRED',
  'GENERATION_APPROVAL_EXPIRED',
  'MCP_BUDGET_EXCEEDED',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
]);

const DESKTOP_STATUS_TO_CLOUD: Record<HistoryRecord['status'], GenerationStatus> = {
  success: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
};

const FAR_FUTURE_ISO = '2099-01-01T00:00:00.000+00:00';

export function generationHistoryQueryToListArgs(query: GenerationHistoryQuery): {
  limit: number;
  offset: number;
} {
  return {
    limit: resolvePageLimit(query.limit),
    offset: parseOffsetCursor(query.cursor),
    // 有损：
    // - sessionId：HistoryRecord 无工作台会话字段，list IPC 也不收，丢弃。
    // - includeDeleted：桌面 history.delete 是硬删，没有软删列表。
  };
}

export function paginateGenerationJobs(
  rows: HistoryRecord[],
  query: GenerationHistoryQuery,
  total?: number,
): GenerationHistoryPage {
  const limit = resolvePageLimit(query.limit);
  const offset = parseOffsetCursor(query.cursor);
  const items = rows.map(historyRecordToGenerationJob);
  return {
    items,
    nextCursor: nextOffsetCursor(offset, limit, items.length, total),
  };
}

export function historyRecordToGenerationJob(row: HistoryRecord): GenerationJob {
  const createdAt = epochMsToIso(row.createdAt);
  const finishedAt =
    row.durationMs != null ? epochMsToIso(row.createdAt + row.durationMs) : createdAt;
  const status = DESKTOP_STATUS_TO_CLOUD[row.status];
  return {
    id: row.id,
    sessionId: null,
    parentRunId: row.parentHistoryId ?? null,
    promptId: row.promptId,
    // 有损：桌面无 actorType，契约只有 web | cloud_mcp，填 web 以过类型。
    actorType: 'web',
    approvalStatus: 'not_required',
    status,
    progress: status === 'succeeded' ? 100 : 0,
    request: {
      prompt: row.promptText,
      negative: row.negativeText ?? undefined,
      promptId: row.promptId ?? undefined,
      size: toCloudSize(row.params?.size),
      aspectRatio:
        typeof row.params?.aspectRatio === 'string' ? row.params.aspectRatio : undefined,
      quality: toCloudQuality(row.params?.quality),
      count: 1,
    },
    providerModel: row.model,
    costPoints: toCostPoints(row.cost),
    assets: row.imagePath ? [toAsset(row.id, row.imagePath)] : [],
    error:
      row.status === 'failed'
        ? {
            code: toApiErrorCode(row.errorCode),
            message: (row.errorMessage ?? row.errorCode ?? '生成失败').slice(0, 500),
          }
        : null,
    createdAt,
    startedAt: createdAt,
    finishedAt,
    deletedAt: epochMsToIsoOrNull(null),
    // 有损：
    // - providerId / costUnit / promptReferences / promptRelations：端口 GenerationJob 无槽位。
    // - params.n（桌面可 1–4）→ request.count 契约字面量 1。
    // - 桌面 2048x2048 等尺寸 → auto。
    // - 本地 imagePath 无宽高/字节数，资产 width/height=1、byteSize=0、expiresAt 用远未来占位。
  };
}

export function markGenerationJobDeleted(
  job: GenerationJob,
  deletedAtMs = Date.now(),
): GenerationJob {
  return { ...job, deletedAt: epochMsToIso(deletedAtMs) };
}

function toCloudSize(size: unknown): GenerationSize {
  if (size === '1024x1024' || size === '1536x1024' || size === '1024x1536' || size === 'auto') {
    return size;
  }
  return 'auto';
}

function toCloudQuality(quality: unknown): GenerationQuality {
  if (quality === 'low' || quality === 'medium' || quality === 'high' || quality === 'auto') {
    return quality;
  }
  return 'auto';
}

function toCostPoints(cost: number | null): number | null {
  if (cost == null || !Number.isFinite(cost)) return null;
  return Math.max(0, Math.round(cost));
}

function toApiErrorCode(code: string | null): ApiErrorCode {
  if (!code) return 'INTERNAL_ERROR';
  if (code === 'RATE_LIMIT') return 'RATE_LIMITED';
  if (API_ERROR_CODES.has(code)) return code as ApiErrorCode;
  return 'INTERNAL_ERROR';
}

function toAsset(historyId: string, imagePath: string): GenerationAsset {
  const url = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
  const mimeType = url.endsWith('.webp')
    ? 'image/webp'
    : url.endsWith('.jpg') || url.endsWith('.jpeg')
      ? 'image/jpeg'
      : 'image/png';
  return {
    id: `${historyId}-asset`,
    url,
    mimeType,
    width: 1,
    height: 1,
    byteSize: 0,
    expiresAt: FAR_FUTURE_ISO,
  };
}
