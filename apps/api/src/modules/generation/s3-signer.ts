import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ApiEnv } from '../../env.js';

export interface SignedAssetUrl {
  url: string;
  expiresAt: string;
}

export interface AssetUrlSigner {
  /** 签名 URL 的有效期(秒);契约层 expiresAt 按它派生,与真实预签名同步。 */
  readonly urlTtlSeconds: number;
  sign(objectKey: string): Promise<SignedAssetUrl>;
  /** 参考图上传落对象存储(服务端已校验魔数与尺寸)。 */
  putObject(objectKey: string, body: Uint8Array, contentType: string): Promise<void>;
  /** 永久删除时清理对象存储(幂等;对象不存在不报错)。 */
  removeObjects(objectKeys: string[]): Promise<void>;
}

export class S3AssetUrlSigner implements AssetUrlSigner {
  readonly urlTtlSeconds: number;
  private readonly client: S3Client;

  constructor(private readonly env: ApiEnv) {
    this.urlTtlSeconds = env.ASSET_URL_TTL_SECONDS;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
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
