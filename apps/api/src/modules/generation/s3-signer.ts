import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ApiEnv } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { Readable, Transform, pipeline } from 'node:stream';
import {
  GENERATION_ASSET_READ_TIMEOUT_MS,
  MAX_GENERATION_ASSET_BYTES,
  missingAssetContent,
  unavailableAssetContent,
} from './asset-content.js';

export interface SignedAssetUrl {
  url: string;
  expiresAt: string;
}

export interface AssetUrlSigner {
  /** 签名 URL 的有效期(秒);契约层 expiresAt 按它派生,与真实预签名同步。 */
  readonly urlTtlSeconds: number;
  sign(objectKey: string): Promise<SignedAssetUrl>;
  /** Read server-owned generation output bytes; bounded through the complete S3 response. */
  readObject(objectKey: string, signal?: AbortSignal): Promise<Uint8Array>;
  /** 参考图上传落对象存储(服务端已校验魔数与尺寸)。 */
  putObject(objectKey: string, body: Uint8Array, contentType: string): Promise<void>;
  /** 永久删除时清理对象存储(幂等;对象不存在不报错)。 */
  removeObjects(objectKeys: string[]): Promise<void>;
}

export class S3AssetUrlSigner implements AssetUrlSigner {
  readonly urlTtlSeconds: number;
  private readonly client: S3Client;
  private readonly contentClient: S3Client;

  constructor(
    private readonly env: ApiEnv,
    private readonly contentTimeoutMs = GENERATION_ASSET_READ_TIMEOUT_MS,
  ) {
    if (
      !Number.isSafeInteger(contentTimeoutMs) ||
      contentTimeoutMs < 1 ||
      contentTimeoutMs > GENERATION_ASSET_READ_TIMEOUT_MS
    )
      throw new RangeError('Invalid asset read deadline');
    this.urlTtlSeconds = env.ASSET_URL_TTL_SECONDS;
    const configuration = {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    };
    this.client = new S3Client(configuration);
    const transport = this.client.config.requestHandler;
    this.contentClient = new S3Client({
      ...configuration,
      maxAttempts: 1,
      followRegionRedirects: false,
      requestHandler: {
        handle: async (...args: Parameters<typeof transport.handle>) => {
          const result = await transport.handle(...args);
          const source = result.response.body;
          if (result.response.statusCode < 200 || result.response.statusCode >= 300) {
            if (source instanceof Readable) source.destroy();
            // Do not deserialize an untrusted/unbounded S3 error document.
            throw result.response.statusCode === 404
              ? missingAssetContent()
              : unavailableAssetContent();
          }
          const header = result.response.headers['content-length'];
          const declared = header === undefined ? undefined : Number(header);
          if (
            !(source instanceof Readable) ||
            (declared !== undefined &&
              (!/^\d+$/.test(header) ||
                !Number.isSafeInteger(declared) ||
                declared < 1 ||
                declared > MAX_GENERATION_ASSET_BYTES))
          ) {
            if (source instanceof Readable) source.destroy();
            throw unavailableAssetContent();
          }
          // Bound successful bytes before SDK deserialization too; non-success
          // responses above are rejected without reading their untrusted bodies.
          let received = 0;
          const bounded = new Transform({
            transform(chunk, _encoding, callback) {
              received += chunk.length;
              if (received > MAX_GENERATION_ASSET_BYTES) callback(unavailableAssetContent());
              else callback(null, chunk);
            },
          });
          // pipeline owns propagation and destroys both streams on error. The
          // consuming SDK/readObject observes the bounded stream's failure.
          pipeline(source, bounded, () => undefined);
          result.response.body = bounded;
          return result;
        },
      },
    });
  }

  async sign(objectKey: string): Promise<SignedAssetUrl> {
    const expiresIn = this.env.ASSET_URL_TTL_SECONDS;
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: objectKey }),
      { expiresIn },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    };
  }

  async readObject(objectKey: string, signal?: AbortSignal): Promise<Uint8Array> {
    const controller = new AbortController();
    let body: Readable | undefined;
    const abort = () => {
      controller.abort();
      body?.destroy();
    };
    const timer = setTimeout(abort, this.contentTimeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) abort();
      controller.signal.throwIfAborted();
      const response = await this.contentClient.send(
        new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: objectKey }),
        { abortSignal: controller.signal },
      );
      body = response.Body as Readable | undefined;
      const declared = response.ContentLength;
      if (
        !body ||
        !body[Symbol.asyncIterator] ||
        (declared !== undefined &&
          (!Number.isSafeInteger(declared) ||
            declared < 1 ||
            declared > MAX_GENERATION_ASSET_BYTES))
      )
        throw unavailableAssetContent();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const value of body) {
        controller.signal.throwIfAborted();
        if (!(value instanceof Uint8Array)) throw unavailableAssetContent();
        size += value.byteLength;
        if (size > MAX_GENERATION_ASSET_BYTES) throw unavailableAssetContent();
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      }
      controller.signal.throwIfAborted();
      if (size === 0 || (declared !== undefined && size !== declared))
        throw unavailableAssetContent();
      return Buffer.concat(chunks, size);
    } catch (error) {
      if (error instanceof AppError && error.code === 'GENERATION_NOT_FOUND') throw error;
      if (
        error &&
        typeof error === 'object' &&
        (('name' in error && ['NoSuchKey', 'NotFound'].includes(String(error.name))) ||
          ('$metadata' in error &&
            (error.$metadata as { httpStatusCode?: number } | undefined)?.httpStatusCode === 404))
      )
        throw missingAssetContent();
      throw unavailableAssetContent();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      abort();
    }
  }

  async putObject(objectKey: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async removeObjects(objectKeys: string[]): Promise<void> {
    if (objectKeys.length === 0) return;
    const result = await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.env.S3_BUCKET,
        Delete: { Objects: objectKeys.map((key) => ({ Key: key })), Quiet: true },
      }),
    );
    if (result.Errors && result.Errors.length > 0) {
      throw Object.assign(new Error('S3 reported object deletion failures'), {
        name: 'S3DeleteObjectsError',
      });
    }
  }
}
