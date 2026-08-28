import { z } from "zod";

export type CloudSyncAvailabilityReason = "signed-out" | "custom-server" | null;

export type CloudSyncRuntimeStatus =
  "disabled" | "idle" | "syncing" | "conflict" | "error";

export interface CloudSyncAccountSummary {
  ownerId: string;
  username: string;
  deviceName: string;
  enabled: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface CloudSyncSummary {
  available: boolean;
  unavailableReason: CloudSyncAvailabilityReason;
  status: CloudSyncRuntimeStatus;
  account: CloudSyncAccountSummary | null;
  pendingMutations: number;
  conflicts: number;
}

export interface CloudSyncConflictSummary {
  id: string;
  entityType: "prompt" | "folder" | "tag";
  entityId: string;
  localSnapshot: Record<string, unknown>;
  remoteSnapshot: Record<string, unknown>;
  detectedAt: number;
  canDuplicate: boolean;
}

export type CloudSyncConflictResolution = "remote" | "local" | "duplicate";

export const cloudSyncErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "UNAVAILABLE",
]);

export type CloudSyncErrorCode = z.infer<typeof cloudSyncErrorCodeSchema>;

export const cloudSyncErrorPayloadSchema = z.object({
  code: cloudSyncErrorCodeSchema,
  message: z.string().min(1),
});

export type CloudSyncErrorPayload = z.infer<
  typeof cloudSyncErrorPayloadSchema
>;
