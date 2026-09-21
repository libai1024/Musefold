import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DESIGN_SCHEME_PACKAGE_LIMITS as limits } from '@musefold/contracts';
import { readValidatedDesignSchemePackageBytes, sha256 } from '@musefold/scheme-package';
import * as yauzl from 'yauzl';
import { rawZip } from '../../../../../packages/scheme-package/src/__tests__/fixtures.js';
import { legacyImportFixture } from '../../modules/design-scheme-packages/__tests__/import-fixture.js';
import { packageExchangeContent } from './package-exchange-content.js';
import { largeCapacityPackage } from './package-capacity-large.js';

export const capacityDimensions = [
  'manifest',
  'entries',
  'entry',
  'archive',
  'expanded',
  'ratio',
] as const;
export const capacitySides = ['at', 'over'] as const;
export type CapacityDimension = (typeof capacityDimensions)[number];
export type CapacitySide = (typeof capacitySides)[number];

/** Inspect actual central-directory metrics, independently of generator estimates. */
function zipMetrics(bytes: Buffer) {
  return new Promise<{
    entries: number;
    expandedBytes: number;
    manifestBytes: number;
    maxEntryBytes: number;
    ratio: number | null;
  }>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('Missing ZIP fixture'));
      const result = {
        entries: 0,
        expandedBytes: 0,
        manifestBytes: 0,
        maxEntryBytes: 0,
        ratio: null as number | null,
      };
      zip.on('error', reject);
      zip.on('entry', (entry: yauzl.Entry) => {
        result.entries++;
        result.expandedBytes += entry.uncompressedSize;
        result.maxEntryBytes = Math.max(result.maxEntryBytes, entry.uncompressedSize);
        if (entry.fileName === 'manifest.json') result.manifestBytes = entry.uncompressedSize;
        if (entry.fileName.endsWith('capacity-ratio.bin'))
          result.ratio = entry.uncompressedSize / entry.compressedSize;
        zip.readEntry();
      });
      zip.on('end', () => {
        zip.close();
        resolve(result);
      });
      zip.readEntry();
    });
  });
}

async function smallCapacityPackage(dimension: 'manifest' | 'entries', side: CapacitySide) {
  const excess = side === 'over' ? 1 : 0;
  if (dimension === 'manifest') {
    const fixture = await legacyImportFixture();
    // Legacy scan accepts untrusted JSON; the importer must not grant authority from it.
    const scan = { ...fixture.manifest.snapshots[0].scan, inspectionNotes: '' };
    fixture.manifest.snapshots[0].scan = scan;
    await fixture.encode();
    const target = limits.manifestBytes + excess;
    const padding = target - Buffer.byteLength(JSON.stringify(fixture.manifest));
    scan.inspectionNotes = randomBytes(Math.ceil((padding * 3) / 4))
      .toString('base64')
      .slice(0, padding);
    assert.equal(Buffer.byteLength(JSON.stringify(fixture.manifest)), target);
    return fixture.encode();
  }
  const parsed = await readValidatedDesignSchemePackageBytes(
    await (await packageExchangeContent()).encode(),
  );
  const entries = [...parsed.entries].map(([name, bytes]) => ({ name, bytes }));
  const dirs = Array.from({ length: limits.entries + excess - entries.length }, (_, index) => ({
    name: `empty-${index}/`,
    bytes: Buffer.alloc(0),
  }));
  return rawZip([...entries, ...dirs]);
}

/** Real contract-sized data. Call in a child process so generation memory is not reader RSS. */
export async function saveCapacityCase(
  directory: string,
  dimension: CapacityDimension,
  side: CapacitySide,
) {
  const bytes =
    dimension === 'manifest' || dimension === 'entries'
      ? await smallCapacityPackage(dimension, side)
      : (await largeCapacityPackage(dimension, side)).bytes;
  const metrics = await zipMetrics(bytes);
  const excess = side === 'over' ? 1 : 0;
  const targets = {
    manifest: limits.manifestBytes,
    entries: limits.entries,
    entry: limits.entryBytes,
    archive: limits.archiveBytes,
    expanded: limits.expandedBytes,
  };
  if (dimension !== 'ratio') {
    const value =
      dimension === 'manifest'
        ? metrics.manifestBytes
        : dimension === 'entries'
          ? metrics.entries
          : dimension === 'entry'
            ? metrics.maxEntryBytes
            : dimension === 'archive'
              ? bytes.length
              : metrics.expandedBytes;
    assert.equal(value, targets[dimension] + excess);
  } else {
    assert(metrics.ratio !== null);
    assert.equal(metrics.ratio > limits.compressionRatio, side === 'over');
  }
  if (dimension === 'expanded') assert(bytes.length < limits.archiveBytes);
  await mkdir(directory, { recursive: true });
  const id = `${dimension}-${side}`;
  const path = resolve(directory, `${id}.musefold.design`);
  // A saved case is immutable evidence. A retry uses another output directory.
  await writeFile(path, bytes, { flag: 'wx' });
  const result = {
    id,
    dimension,
    side,
    path,
    formatVersion: dimension === 'manifest' ? (1 as const) : (2 as const),
    accepted: side === 'at',
    bytes: bytes.length,
    sha256: sha256(bytes),
    metrics,
    expectedError: {
      manifest: '文件超过大小上限',
      entries: '条目超过上限',
      entry: '文件超过大小上限',
      archive: '超过大小上限',
      expanded: '解压后超过大小上限',
      ratio: '压缩比异常',
    }[dimension],
    limits,
    generatedAt: new Date().toISOString(),
    generatorPeakRssKiB: process.resourceUsage().maxRSS,
  };
  await writeFile(resolve(directory, `${id}.json`), `${JSON.stringify(result, null, 2)}\n`, {
    flag: 'wx',
  });
  return result;
}
export type CapacityCase = Awaited<ReturnType<typeof saveCapacityCase>>;
