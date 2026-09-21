import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  CapacityCase,
  CapacityDimension,
  CapacitySide,
} from '../../apps/api/src/__tests__/fixtures/package-capacity-corpus';

const child = fileURLToPath(
  new URL('../../apps/api/src/__tests__/fixtures/package-capacity-process.ts', import.meta.url),
);

/** Each generation/read exits before the next begins; no simultaneous 256 MiB test copies. */
export async function savedCapacityCase(
  directory: string,
  dimension: CapacityDimension,
  side: CapacitySide,
) {
  const run = async (...args: string[]) =>
    promisify(execFile)(process.execPath, ['--import', 'tsx', child, ...args], {
      env: { ...process.env, PACKAGE_CAPACITY_TEST: '1' },
      timeout: 180000,
      maxBuffer: 1024 * 1024,
    });
  await run('generate', directory, dimension, side);
  const id = `${dimension}-${side}`;
  for (const reader of ['file', 'bytes']) await run('read', directory, id, reader);
  return JSON.parse(await readFile(resolve(directory, `${id}.json`), 'utf8')) as CapacityCase;
}
