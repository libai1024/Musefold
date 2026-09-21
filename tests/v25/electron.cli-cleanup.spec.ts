import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from '@playwright/test';
import { verifyCliCleanup, verifyCliServePause } from './cli-cleanup-process';
import { verifyCliWriteCrash } from './cli-write-crash-process';
import { verifyCliDiscoveryStop } from './cli-discovery-stop-process';

test.beforeAll(async () => {
  await promisify(execFile)(process.execPath, ['scripts/build-cli.mjs'], {
    cwd: resolve(import.meta.dirname, '../..'),
    timeout: 30000,
  });
});

test('compiled CLI resumes durable cleanup and Ctrl-C completes cleanup before releasing ownership', async () => {
  test.setTimeout(60000);
  const evidence = await verifyCliCleanup(
    process.execPath,
    resolve('packages/cli/dist/musefold.mjs'),
  );
  await test.info().attach('cli-native-cleanup', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
});

test('actual CLI partial write survives SIGKILL as a durable cleanup intent and the next CLI removes it', async () => {
  test.setTimeout(60000);
  const evidence = await verifyCliWriteCrash(
    process.execPath,
    resolve('packages/cli/dist/musefold.mjs'),
  );
  await test.info().attach('cli-partial-write-recovery', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
});

test('compiled CLI closes and releases uploads even when its discovery file cannot be deleted', async () => {
  test.setTimeout(60000);
  const evidence = await verifyCliDiscoveryStop(
    process.execPath,
    resolve('packages/cli/dist/musefold.mjs'),
  );
  await test.info().attach('cli-discovery-stop', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
});

test('actual serve SIGSTOP across a maintenance interval defers cleanup until SIGCONT resumes the timer', async () => {
  test.setTimeout(180000);
  const evidence = await verifyCliServePause(
    process.execPath,
    resolve('packages/cli/dist/musefold.mjs'),
  );
  await test.info().attach('cli-serve-pause', {
    body: JSON.stringify(evidence),
    contentType: 'application/json',
  });
});
