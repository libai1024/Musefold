import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { CreateBucketCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { waitUntil } from './process-runtime.js';

const execute = promisify(execFile);
// Pinned to the locally verified MinIO distribution; each suite owns an empty container.
export const STORAGE_IMAGE =
  'minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e';
async function docker(...args: string[]) {
  return (await execute('docker', args, { timeout: 60_000 })).stdout.trim();
}

async function waitForStorageOperation(operation: () => Promise<unknown>, label: string) {
  await waitUntil(async () => {
    try {
      await operation();
      return true;
    } catch (error) {
      // Health can precede S3 readiness; authentication and protocol errors must fail.
      if (error instanceof Error && error.name === 'XMinioServerNotInitialized') return false;
      throw error;
    }
  }, label);
}

export async function createDisposableObjectStorage() {
  const name = `musefold-gc-${randomUUID()}`;
  const bucket = 'gc-fixture';
  const accessKeyId = 'gc-fixture-owner';
  const secretAccessKey = 'synthetic-gc-storage-password';
  let client: S3Client | undefined;
  try {
    await docker(
      'create',
      '--name',
      name,
      '--label',
      'musefold.test=asset-gc',
      '-p',
      '127.0.0.1::9000',
      '-e',
      `MINIO_ROOT_USER=${accessKeyId}`,
      '-e',
      `MINIO_ROOT_PASSWORD=${secretAccessKey}`,
      STORAGE_IMAGE,
      'server',
      '/data',
    );
    await docker('start', name);
    const inspect = JSON.parse(await docker('inspect', name))[0];
    const port = inspect.NetworkSettings.Ports['9000/tcp'][0].HostPort;
    let endpoint = `http://127.0.0.1:${port}`;
    await waitUntil(async () => {
      try {
        return (
          await fetch(`${endpoint}/minio/health/ready`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok;
      } catch {
        return false;
      }
    }, 'disposable MinIO readiness');
    const makeClient = (anonymous = false) =>
      new S3Client({
        endpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
        signer: anonymous ? { sign: async (request) => request } : undefined,
        maxAttempts: 1,
        requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 },
      });
    client = makeClient();
    const initialClient = client;
    await waitForStorageOperation(
      () => initialClient.send(new CreateBucketCommand({ Bucket: bucket })),
      'disposable MinIO bucket creation',
    );
    return {
      get client() {
        if (!client) throw new Error('Storage client is not initialized');
        return client;
      },
      anonymousClient: () => makeClient(true),
      bucket,
      get endpoint() {
        return endpoint;
      },
      imageId: inspect.Image,
      version: await docker('exec', name, 'minio', '--version'),
      async stop() {
        await docker('stop', '--time', '1', name);
      },
      async start() {
        await docker('start', name);
        const restarted = JSON.parse(await docker('inspect', name))[0];
        endpoint = `http://127.0.0.1:${restarted.NetworkSettings.Ports['9000/tcp'][0].HostPort}`;
        client?.destroy();
        client = makeClient();
        await waitUntil(async () => {
          try {
            return (
              await fetch(`${endpoint}/minio/health/ready`, {
                signal: AbortSignal.timeout(1000),
              })
            ).ok;
          } catch {
            return false;
          }
        }, 'disposable MinIO restart');
        const restartedClient = client;
        await waitForStorageOperation(
          () => restartedClient.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 })),
          'disposable MinIO bucket after restart',
        );
      },
      async close() {
        client?.destroy();
        await docker('rm', '--force', name);
      },
    };
  } catch (error) {
    client?.destroy();
    await docker('rm', '--force', name).catch(() => undefined);
    throw error;
  }
}
