import { describe, expect, it } from 'vitest';
import { workerConfigSchema } from '../config.js';

describe('generation worker configuration', () => {
  it('has bounded defaults for local development', () => {
    expect(workerConfigSchema.parse({})).toMatchObject({
      WORKER_CONCURRENCY: 4,
      WORKER_POLL_INTERVAL_MS: 1_000,
      WORKER_HEARTBEAT_INTERVAL_MS: 10_000,
      S3_AUTO_CREATE_BUCKET: true,
    });
  });

  it('rejects unbounded worker concurrency', () => {
    expect(
      workerConfigSchema.safeParse({ WORKER_CONCURRENCY: 0 }).success,
    ).toBe(false);
  });

  it('parses bucket bootstrap as an explicit boolean', () => {
    expect(
      workerConfigSchema.parse({ S3_AUTO_CREATE_BUCKET: 'false' })
        .S3_AUTO_CREATE_BUCKET,
    ).toBe(false);
  });
});
