import {
  CreateBucketCommand,
  HeadBucketCommand,
  type BucketLocationConstraint,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { WorkerEnv } from './env.js';

/** Storage must be usable before the worker may accept potentially paid work. */
export async function ensureStorageBucket(
  client: Pick<S3Client, 'send'>,
  env: Pick<WorkerEnv, 'S3_BUCKET' | 'S3_REGION' | 'S3_AUTO_CREATE_BUCKET'>,
): Promise<'existing' | 'created'> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    return 'existing';
  } catch (error) {
    if (!isMissingBucket(error)) throw error;
  }
  if (!env.S3_AUTO_CREATE_BUCKET) throw new Error('Storage bucket creation is disabled');
  await client.send(
    new CreateBucketCommand({
      Bucket: env.S3_BUCKET,
      ...(env.S3_REGION === 'us-east-1'
        ? {}
        : {
            CreateBucketConfiguration: {
              LocationConstraint: env.S3_REGION as BucketLocationConstraint,
            },
          }),
    }),
  );
  return 'created';
}

function isMissingBucket(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  // Explicit access/server errors take precedence over an inconsistent error name.
  if (typeof value.$metadata?.httpStatusCode === 'number')
    return value.$metadata.httpStatusCode === 404;
  return (
    value.name === 'NotFound' || value.name === 'NoSuchBucket' || value.Code === 'NoSuchBucket'
  );
}
