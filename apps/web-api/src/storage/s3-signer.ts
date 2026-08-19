import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { WebApiConfig } from '../config.js';

export interface SignedAssetUrl {
  url: string;
  expiresAt: string;
}

export interface AssetUrlSigner {
  sign(objectKey: string): Promise<SignedAssetUrl>;
}

export class S3AssetUrlSigner implements AssetUrlSigner {
  private readonly client: S3Client;

  constructor(
    private readonly config: Pick<
      WebApiConfig,
      | 'S3_ENDPOINT'
      | 'S3_PUBLIC_ENDPOINT'
      | 'S3_REGION'
      | 'S3_BUCKET'
      | 'S3_ACCESS_KEY_ID'
      | 'S3_SECRET_ACCESS_KEY'
      | 'S3_FORCE_PATH_STYLE'
      | 'S3_SIGNED_URL_TTL_SECONDS'
    >,
  ) {
    this.client = new S3Client({
      endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async sign(objectKey: string): Promise<SignedAssetUrl> {
    const expiresIn = this.config.S3_SIGNED_URL_TTL_SECONDS;
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: objectKey }),
      { expiresIn },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString(),
    };
  }
}
