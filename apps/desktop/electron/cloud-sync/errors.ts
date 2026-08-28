import {
  cloudSyncErrorPayloadSchema,
  type CloudSyncErrorCode,
  type CloudSyncErrorPayload,
} from "@musefold/desktop-contracts/cloud-sync";

export const CLOUD_SYNC_ERROR_IPC_PREFIX = "CLOUD_SYNC_ERR::";

export class CloudSyncError extends Error {
  constructor(
    readonly code: CloudSyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CloudSyncError";
  }

  toPayload(): CloudSyncErrorPayload {
    return cloudSyncErrorPayloadSchema.parse({
      code: this.code,
      message: this.message,
    });
  }

  toIpcError(): Error {
    return new Error(
      `${CLOUD_SYNC_ERROR_IPC_PREFIX}${JSON.stringify(this.toPayload())}`,
    );
  }
}
