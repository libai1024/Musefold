import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  readValidatedDesignSchemePackage,
  readValidatedDesignSchemePackageBytes,
  sha256,
} from '@musefold/scheme-package';
import {
  capacityDimensions,
  capacitySides,
  saveCapacityCase,
  type CapacityCase,
} from './package-capacity-corpus.js';

if (process.env.PACKAGE_CAPACITY_TEST !== '1')
  throw new Error('Requires isolated capacity test process');
const [action, directory, dimension, side] = process.argv.slice(2);
if (!directory) throw new Error('Missing capacity output');
if (action === 'generate') {
  const parsedDimension = capacityDimensions.find((value) => value === dimension);
  const parsedSide = capacitySides.find((value) => value === side);
  if (!parsedDimension || !parsedSide) throw new Error('Unknown capacity case');
  await saveCapacityCase(directory, parsedDimension, parsedSide);
} else if (action === 'read') {
  assert(side === 'file' || side === 'bytes');
  const input = JSON.parse(
    await readFile(resolve(directory, `${dimension}.json`), 'utf8'),
  ) as CapacityCase;
  const start = performance.now();
  const baselinePeakRssKiB = process.resourceUsage().maxRSS;
  let accepted = false;
  let error: string | null = null;
  try {
    if (side === 'file') await readValidatedDesignSchemePackage(input.path);
    else await readValidatedDesignSchemePackageBytes(await readFile(input.path));
    accepted = true;
  } catch (value) {
    error = value instanceof Error ? value.message : String(value);
  }
  const elapsedMs = performance.now() - start;
  const processPeakRssKiB = process.resourceUsage().maxRSS;
  assert.equal(accepted, input.accepted, error ?? 'Unexpected acceptance');
  if (!accepted) assert(error?.includes(input.expectedError), error ?? 'No rejection reason');
  assert.equal(sha256(await readFile(input.path)), input.sha256);
  await writeFile(
    resolve(directory, `${dimension}-${side}-reader.json`),
    `${JSON.stringify(
      {
        accepted,
        error,
        elapsedMs,
        processPeakRssKiB,
        baselinePeakRssKiB,
        inputHash: input.sha256,
        runtime: { node: process.version, platform: process.platform, arch: process.arch },
        scope:
          'Isolated reader child includes runtime and input loading; excludes generation and later hash verification.',
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  );
} else throw new Error('Unknown capacity action');
