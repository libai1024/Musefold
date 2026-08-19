import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import type { WorkerConfig } from './config.js';

type StorageConfig = Pick<
  WorkerConfig,
  | 'S3_ENDPOINT'
  | 'S3_REGION'
  | 'S3_BUCKET'
  | 'S3_ACCESS_KEY_ID'
  | 'S3_SECRET_ACCESS_KEY'
  | 'S3_FORCE_PATH_STYLE'
  | 'S3_AUTO_CREATE_BUCKET'
>;

export function createStorageClient(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
}

export async function ensureStorageBucket(
  client: Pick<S3Client, 'send'>,
  config: Pick<
    StorageConfig,
    'S3_BUCKET' | 'S3_REGION' | 'S3_AUTO_CREATE_BUCKET'
  >,
): Promise<'existing' | 'created'> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
    return 'existing';
  } catch (error) {
    if (!isMissingBucket(error)) throw error;
  }

  if (!config.S3_AUTO_CREATE_BUCKET) {
    throw new Error(
      `S3 bucket ${config.S3_BUCKET} does not exist and automatic creation is disabled`,
    );
  }

  await client.send(
    new CreateBucketCommand({
      Bucket: config.S3_BUCKET,
      ...(config.S3_REGION === 'us-east-1'
        ? {}
        : {
            CreateBucketConfiguration: {
              LocationConstraint: config.S3_REGION as BucketLocationConstraint,
            },
          }),
    }),
  );
  return 'created';
}

function isMissingBucket(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchBucket' ||
    candidate.Code === 'NoSuchBucket'
  );
}
