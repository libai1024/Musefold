import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ApiEnv } from '../../env.js';

export interface SignedAssetUrl {
  url: string;
  expiresAt: string;
}

export interface AssetUrlSigner {
  sign(objectKey: string): Promise<SignedAssetUrl>;
}

export class S3AssetUrlSigner implements AssetUrlSigner {
  private readonly client: S3Client;

  constructor(private readonly env: ApiEnv) {
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
}
