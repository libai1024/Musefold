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

/** 桌面云同步开关状态。登录 ≠ 同步:enabled 只由用户在设置里显式打开。 */
export const desktopSyncStatusSchema = z.object({
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
});

export const setSyncEnabledSchema = z.object({ enabled: z.boolean() });

export type SyncEntityType = z.infer<typeof syncEntityTypeSchema>;
export type SyncMutationOperation = z.infer<typeof syncMutationOperationSchema>;
export type SyncSnapshot = z.infer<typeof syncSnapshotSchema>;
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
