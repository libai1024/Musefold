import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { loadWorkerConfig } from './config.js';
import { createStorageClient, ensureStorageBucket } from './storage.js';

const config = loadWorkerConfig();
const client = createStorageClient(config);
const bucketState = await ensureStorageBucket(client, config);
const key = `smoke/${randomUUID()}.txt`;
const expected = Buffer.from(`musefold-storage-smoke:${key}`, 'utf8');

try {
  await client.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: expected,
      ContentType: 'text/plain',
    }),
  );
  const result = await client.send(
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
  );
  const actual = Buffer.from(await result.Body!.transformToByteArray());
  if (!actual.equals(expected))
    throw new Error('S3 smoke object content mismatch');
  process.stdout.write(
    `${JSON.stringify({ ok: true, bucket: config.S3_BUCKET, bucketState, key })}\n`,
  );
} finally {
  await client.send(
    new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
  );
  client.destroy();
}
