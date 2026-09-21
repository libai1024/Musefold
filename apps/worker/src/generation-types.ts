import type { GeneratedImage } from './image-gateway.js';

/** Internal queue coordinates, separate from task implementations to keep imports acyclic. */
export interface GenerationPayload {
  userId: string;
  runId: string;
}

export interface UploadedGenerationAsset extends GeneratedImage {
  id: string;
  objectKey: string;
  checksum: string;
}
