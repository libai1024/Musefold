import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MAX_DESIGN_SCHEME_UPLOAD_BYTES } from '@musefold/contracts/design-scheme-assets';
import { DESIGN_SCHEME_PACKAGE_LIMITS } from '@musefold/contracts';
import type { ApiEnv } from '../../env.js';

export interface DesignSchemeAssetStorage {
  put(objectKey: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  read(objectKey: string, maxReadBytes?: number): Promise<Uint8Array>;
}

/** Uses only server-configured S3 coordinates; no URL from a caller is ever fetched. */
export class S3DesignSchemeAssetStorage implements DesignSchemeAssetStorage {
  private readonly client: S3Client;

  constructor(
    private readonly env: ApiEnv,
    private readonly maxReadBytes: number = MAX_DESIGN_SCHEME_UPLOAD_BYTES,
  ) {
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }

  destroy() {
    this.client.destroy();
  }

  async put(objectKey: string, bytes: Uint8Array, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: objectKey,
        Body: bytes,
        ContentType: mimeType,
      }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
  }

  async read(objectKey: string, maxReadBytes = this.maxReadBytes): Promise<Uint8Array> {
    // Server-only per-operation budget. Public upload limits remain unchanged.
    if (
      !Number.isSafeInteger(maxReadBytes) ||
      maxReadBytes < 1 ||
      maxReadBytes > DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes
    )
      throw new Error('Invalid storage read budget');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.env.S3_BUCKET,
          Key: objectKey,
        }),
        { abortSignal: controller.signal },
      );
      if (!result.Body || (result.ContentLength ?? 0) > maxReadBytes) {
        throw new Error('Invalid stored image size');
      }
      const parts: Uint8Array[] = [];
      let size = 0;
      for await (const part of result.Body as AsyncIterable<Uint8Array>) {
        size += part.byteLength;
        if (size > maxReadBytes) throw new Error('Stored image exceeds limit');
        parts.push(part);
      }
      return Buffer.concat(parts, size);
    } finally {
      controller.abort();
      clearTimeout(timer);
    }
  }
}
