import { z } from 'zod';
import {
  entityIdSchema,
  isoDateTimeSchema,
  paginationCursorSchema,
  queryIntegerSchema,
} from './common';
import { promptDocumentSchema, promptFolderSchema, promptTagSchema } from './prompt';

export const syncEntityTypeSchema = z.enum(['prompt', 'folder', 'tag']);
export const syncChangeOperationSchema = z.enum(['upsert', 'delete']);
export const syncMutationOperationSchema = z.enum(['create', 'update', 'delete', 'restore']);
export const syncCursorSchema = z.string().regex(/^\d+$/).max(32);
export const syncSnapshotSchema = z.union([
  promptDocumentSchema,
  promptFolderSchema,
  promptTagSchema,
]);

export const desktopSyncConsentSchema = z.enum(['unset', 'enabled', 'paused']);
export const desktopSyncPhaseSchema = z.enum([
  'signed_out',
  'awaiting_consent',
  'paused',
  'enabling',
  'idle',
  'syncing',
  'conflict',
  'auth_blocked',
  'error',
]);

export const syncConflictResolutionSchema = z.enum(['remote', 'local', 'duplicate']);

const syncConflictCommonSchema = {
  id: entityIdSchema,
  entityId: entityIdSchema,
  remoteSnapshot: syncSnapshotSchema,
  createdAt: isoDateTimeSchema,
};

const unsafeLocalSnapshotKey = new Set([
  'apikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'idtoken',
  'bearertoken',
  'secret',
  'credential',
  'password',
  'passwd',
  'filepath',
  'imagepath',
  'localpath',
  'ownerid',
  'workspaceid',
  'authorization',
  'bearer',
  'privatekey',
  'signingkey',
]);
const absoluteLocalPath = /^(?:[a-zA-Z]:[\\/]|\\\\|\/|file:)/i;

function isUnsafeLocalSnapshotKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (unsafeLocalSnapshotKey.has(normalized)) return true;
  if (normalized.includes('secret') || normalized.includes('credential')) return true;
  if (normalized.includes('password') || normalized.includes('passwd')) return true;
  if (normalized.includes('token') && !normalized.endsWith('tokens')) return true;
  if (normalized.startsWith('api') && normalized.includes('key')) return true;
  return (
    normalized.endsWith('path') &&
    ['file', 'image', 'local', 'absolute', 'managed', 'asset', 'reference', 'thumbnail'].some(
      (prefix) => normalized.startsWith(prefix),
    )
  );
}

function safeLocalPayload<T extends z.ZodType>(schema: T): T {
  return schema.superRefine((value, ctx) => {
    const visit = (item: unknown, path: PropertyKey[]): void => {
      if (path[0] === 'params' && typeof item === 'string' && absoluteLocalPath.test(item)) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: 'localSnapshot params contain an absolute local path',
        });
      }
      if (!item || typeof item !== 'object') return;
      if (Array.isArray(item)) {
        item.forEach((child, index) => {
          visit(child, [...path, index]);
        });
        return;
      }
      for (const [key, child] of Object.entries(item)) {
        if (isUnsafeLocalSnapshotKey(key)) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, key],
            message: 'localSnapshot contains a forbidden field',
          });
        }
        visit(child, [...path, key]);
      }
    };
    visit(value, []);
  }) as T;
}

const syncLocalPromptPayloadSchema = safeLocalPayload(
  z
    .object({
      title: promptDocumentSchema.shape.title,
      description: promptDocumentSchema.shape.description,
      content: promptDocumentSchema.shape.content,
      negative: promptDocumentSchema.shape.negative,
      folderId: promptDocumentSchema.shape.folderId,
      tagIds: z.array(entityIdSchema).max(20),
      modelId: promptDocumentSchema.shape.modelId,
      params: promptDocumentSchema.shape.params,
      rating: promptDocumentSchema.shape.rating,
      isPinned: promptDocumentSchema.shape.isPinned,
      pinOrder: promptDocumentSchema.shape.pinOrder,
      source: promptDocumentSchema.shape.source,
      sourceUrl: promptDocumentSchema.shape.sourceUrl,
    })
    .partial()
    .strict(),
);

const syncLocalFolderPayloadSchema = safeLocalPayload(
  z
    .object({
      name: promptFolderSchema.shape.name,
      parentId: promptFolderSchema.shape.parentId,
      sortOrder: promptFolderSchema.shape.sortOrder,
    })
    .partial()
    .strict(),
);

const syncLocalTagPayloadSchema = safeLocalPayload(
  z
    .object({
      name: promptTagSchema.shape.name,
      group: promptTagSchema.shape.group,
      color: promptTagSchema.shape.color,
    })
    .partial()
    .strict(),
);

/**
 * 冲突摘要不携带 owner/workspace 内部归属。duplicate 仅对 prompt 有意义,
 * 由 discriminated union 在契约层固定 folder/tag 的能力为 false。
 */
export const syncConflictSummarySchema = z.discriminatedUnion('entityType', [
  z
    .object({
      ...syncConflictCommonSchema,
      entityType: z.literal('prompt'),
      localSnapshot: syncLocalPromptPayloadSchema,
      canDuplicate: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...syncConflictCommonSchema,
      entityType: z.literal('folder'),
      localSnapshot: syncLocalFolderPayloadSchema,
      canDuplicate: z.literal(false),
    })
    .strict(),
  z
    .object({
      ...syncConflictCommonSchema,
      entityType: z.literal('tag'),
      localSnapshot: syncLocalTagPayloadSchema,
      canDuplicate: z.literal(false),
    })
    .strict(),
]);

/** Conflict 列表返回的稳定摘要契约。 */
export const syncConflictSchema = syncConflictSummarySchema;
export const syncConflictListSchema = z.array(syncConflictSummarySchema);
export const syncConflictResolutionInputSchema = z
  .object({
    conflictId: entityIdSchema,
    resolution: syncConflictResolutionSchema,
  })
  .strict();

/** Renderer 只提交冲突 id 和三选一决议,不接受 owner/workspace 等内部字段。 */
export const resolveSyncConflictInputSchema = syncConflictResolutionInputSchema;

export const syncDeviceRegistrationSchema = z.object({
  deviceId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  platform: z.enum(['macos', 'windows', 'linux']),
  clientVersion: z.string().trim().min(1).max(32),
});

export const syncDeviceSchema = syncDeviceRegistrationSchema.extend({
  revoked: z.boolean(),
  lastPullCursor: syncCursorSchema,
});

export const syncBootstrapQuerySchema = z.object({
  entity: syncEntityTypeSchema,
  after: entityIdSchema.optional(),
  limit: queryIntegerSchema.pipe(z.number().int().min(1).max(500)).default(200),
});

export const syncBootstrapPageSchema = z.object({
  snapshotCursor: syncCursorSchema,
  items: z.array(syncSnapshotSchema),
  nextPage: paginationCursorSchema.nullable(),
});

export const syncChangeSchema = z.object({
  seq: syncCursorSchema,
  entityType: syncEntityTypeSchema,
  entityId: entityIdSchema,
  operation: syncChangeOperationSchema,
  version: z.number().int().positive(),
  snapshot: syncSnapshotSchema,
});

export const syncPullQuerySchema = z.object({
  cursor: syncCursorSchema,
  limit: queryIntegerSchema.pipe(z.number().int().min(1).max(500)).default(200),
  // Optional for backwards compatibility with older cloud clients. Desktop
  // clients send it so the server can maintain device lifecycle state.
  deviceId: z.string().uuid().optional(),
});

export const syncPullResultSchema = z.object({
  changes: z.array(syncChangeSchema),
  nextCursor: syncCursorSchema,
  hasMore: z.boolean(),
});

export const syncMutationSchema = z.object({
  mutationId: entityIdSchema,
  entityType: syncEntityTypeSchema,
  entityId: entityIdSchema,
  operation: syncMutationOperationSchema,
  baseVersion: z.number().int().positive().nullable(),
  payload: z.record(z.string(), z.unknown()),
});

export const syncUsageActionSchema = z.enum(['copy', 'apply', 'generate']);

export const syncUsageEventSchema = z.object({
  eventId: entityIdSchema,
  promptId: entityIdSchema,
  action: syncUsageActionSchema,
});

export const syncUsagePushRequestSchema = z.object({
  deviceId: z.string().uuid(),
  events: z.array(syncUsageEventSchema).min(1).max(100),
});

export const syncUsageEventResultSchema = z.object({
  eventId: entityIdSchema,
  status: z.enum(['applied', 'duplicate', 'rejected']),
  errorCode: z.string().trim().min(1).max(80).nullable(),
});

export const syncUsagePushResultSchema = z.object({
  results: z.array(syncUsageEventResultSchema),
});

export const syncPushRequestSchema = z.object({
  deviceId: z.string().uuid(),
  mutations: z.array(syncMutationSchema).min(1).max(100),
});

export const syncMutationResultSchema = z.object({
  mutationId: entityIdSchema,
  status: z.enum(['applied', 'duplicate', 'conflict', 'rejected']),
  version: z.number().int().positive().nullable(),
  snapshot: syncSnapshotSchema.nullable(),
  errorCode: z.string().trim().min(1).max(80).nullable(),
});

export const syncPushResultSchema = z.object({
  results: z.array(syncMutationResultSchema),
});

export const syncStatusSchema = z.object({
  device: syncDeviceSchema,
  serverCursor: syncCursorSchema,
  pendingConflicts: z.number().int().nonnegative(),
});

// ---------- 桌面本地同步状态(v2.5 sync 域桥,UI 消费) ----------

export const desktopSyncStateSchema = z.enum(['disabled', 'idle', 'syncing', 'conflict', 'error']);

function legacyDesktopSyncPhase(value: Record<string, unknown>): DesktopSyncPhase {
  if (value.consent === 'paused') return 'paused';
  if (value.account === null || value.account === undefined) return 'signed_out';
  if (value.enabled !== true) return 'awaiting_consent';
  if (value.state === 'syncing') return 'syncing';
  if (value.state === 'conflict') return 'conflict';
  if (value.state === 'error') return 'error';
  return 'idle';
}

/**
 * 桌面云同步状态。consent 是 durable 用户决定,phase 是 runtime 派生状态;
 * enabled/state 仅保留给尚未迁移的当前消费方。旧响应缺少新字段时在边界补出
 * 保守的 unset/派生 phase,新宿主仍应发送显式字段。
 */
const localWorkspaceReferenceSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const desktopSyncStatusSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return {
      ...record,
      consent:
        record.consent ?? (record.enabled === true ? ('enabled' as const) : ('unset' as const)),
      phase: record.phase ?? legacyDesktopSyncPhase(record),
    };
  },
  z
    .object({
      /** Non-authorizing binding to the session shown to the user. */
      reviewRef: localWorkspaceReferenceSchema.nullable().optional(),
      consent: desktopSyncConsentSchema,
      phase: desktopSyncPhaseSchema,
      enabled: z.boolean(),
      state: desktopSyncStateSchema,
      /** 已在本机激活过同步的账号(未登录/未激活为 null)。 */
      account: z
        .object({
          username: z.string().min(1),
          deviceName: z.string().min(1),
        })
        .nullable(),
      lastSyncedAt: isoDateTimeSchema.nullable(),
      pendingMutations: z.number().int().nonnegative(),
      conflicts: z.number().int().nonnegative(),
      error: z.string().nullable(),
    })
    .strict(),
);

export const setSyncEnabledSchema = z
  .object({ enabled: z.boolean(), reviewRef: localWorkspaceReferenceSchema.nullable().optional() })
  .strict();
/** Gateway setConsent 接受 durable consent 值本身; transport 可另包一层对象。 */
export const setSyncConsentSchema = desktopSyncConsentSchema;
export const setSyncConsentInputSchema = z
  .object({
    consent: desktopSyncConsentSchema,
    reviewRef: localWorkspaceReferenceSchema.nullable().optional(),
  })
  .strict();

export const localWorkspaceRecoveryStatusSchema = z
  .object({
    reviewRef: localWorkspaceReferenceSchema.nullable(),
    targetAccount: z
      .object({ username: z.string().min(1) })
      .strict()
      .nullable(),
    targetReady: z.boolean(),
    canPrepare: z.boolean(),
    sources: z.array(
      z
        .object({
          sourceId: localWorkspaceReferenceSchema,
          label: z.string(),
          kind: z.enum(['local_only', 'account']),
          createdAt: isoDateTimeSchema,
          counts: z
            .object({
              prompts: z.number().int().nonnegative(),
              folders: z.number().int().nonnegative(),
              tags: z.number().int().nonnegative(),
            })
            .strict(),
          revision: localWorkspaceReferenceSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const previewLocalWorkspaceInputSchema = z
  .object({
    sourceId: localWorkspaceReferenceSchema,
    cursor: z.string().regex(/^\d+$/).max(12).optional(),
  })
  .strict();
export const localWorkspacePreviewSchema = z
  .object({
    sourceId: localWorkspaceReferenceSchema,
    revision: localWorkspaceReferenceSchema,
    prompts: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          content: z.string(),
          negative: z.string().nullable(),
          folderName: z.string().nullable(),
          tags: z.array(z.string()),
          isDeleted: z.boolean(),
        })
        .strict(),
    ),
    /** Bounded metadata summary (first 200); the copy includes all folders and tags. */
    folders: z.array(
      z.object({ id: z.string(), name: z.string(), parentId: z.string().nullable() }).strict(),
    ),
    tags: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    nextCursor: z.string().nullable(),
  })
  .strict();
/** The host derives the destination from its verified session; callers cannot choose an owner. */
export const prepareLocalWorkspaceInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('empty'), reviewRef: localWorkspaceReferenceSchema }).strict(),
  z
    .object({
      mode: z.literal('copy'),
      reviewRef: localWorkspaceReferenceSchema,
      sourceId: localWorkspaceReferenceSchema,
      expectedRevision: localWorkspaceReferenceSchema,
    })
    .strict(),
]);

export type LocalWorkspaceRecoveryStatus = z.infer<typeof localWorkspaceRecoveryStatusSchema>;
export type PreviewLocalWorkspaceInput = z.infer<typeof previewLocalWorkspaceInputSchema>;
export type LocalWorkspacePreview = z.infer<typeof localWorkspacePreviewSchema>;
export type PrepareLocalWorkspaceInput = z.infer<typeof prepareLocalWorkspaceInputSchema>;

export type SyncEntityType = z.infer<typeof syncEntityTypeSchema>;
export type SyncMutationOperation = z.infer<typeof syncMutationOperationSchema>;
export type SyncSnapshot = z.infer<typeof syncSnapshotSchema>;
export type DesktopSyncConsent = z.infer<typeof desktopSyncConsentSchema>;
export type DesktopSyncPhase = z.infer<typeof desktopSyncPhaseSchema>;
export type SyncConflictSummary = z.infer<typeof syncConflictSummarySchema>;
export type SyncConflict = SyncConflictSummary;
/** Folder/Tag deletion is permanent; Prompt deletion retains its restore semantics. */
export function canKeepLocalSyncConflict(
  conflict: Pick<SyncConflictSummary, 'entityType' | 'remoteSnapshot'>,
): boolean {
  return conflict.entityType === 'prompt' || conflict.remoteSnapshot.deletedAt == null;
}

export type SyncConflictResolution = z.infer<typeof syncConflictResolutionSchema>;
export type SyncConflictResolutionInput = z.infer<typeof syncConflictResolutionInputSchema>;
export type SyncDeviceRegistration = z.infer<typeof syncDeviceRegistrationSchema>;
export type SyncDevice = z.infer<typeof syncDeviceSchema>;
export type SyncBootstrapQuery = z.input<typeof syncBootstrapQuerySchema>;
export type SyncBootstrapPage = z.infer<typeof syncBootstrapPageSchema>;
export type SyncChange = z.infer<typeof syncChangeSchema>;
export type SyncPullQuery = z.input<typeof syncPullQuerySchema>;
export type SyncPullResult = z.infer<typeof syncPullResultSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
export type SyncUsageAction = z.infer<typeof syncUsageActionSchema>;
export type SyncUsageEvent = z.infer<typeof syncUsageEventSchema>;
export type SyncUsageEventResult = z.infer<typeof syncUsageEventResultSchema>;
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;
export type SyncMutationResult = z.infer<typeof syncMutationResultSchema>;
export type SyncPushResult = z.infer<typeof syncPushResultSchema>;
export type SyncUsagePushRequest = z.infer<typeof syncUsagePushRequestSchema>;
export type SyncUsagePushResult = z.infer<typeof syncUsagePushResultSchema>;
export type SyncStatus = z.infer<typeof syncStatusSchema>;
export type DesktopSyncState = z.infer<typeof desktopSyncStateSchema>;
export type DesktopSyncStatus = z.infer<typeof desktopSyncStatusSchema>;
export type SetSyncEnabled = z.infer<typeof setSyncEnabledSchema>;
export type SetSyncConsent = z.infer<typeof setSyncConsentSchema>;

export type SetSyncConsentInput = z.infer<typeof setSyncConsentInputSchema>;
