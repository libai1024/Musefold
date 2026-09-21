import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { DESIGN_SCHEME_PACKAGE_LIMITS as limits } from '@musefold/contracts';
import { rawZip } from '../../../../../packages/scheme-package/src/__tests__/fixtures.js';
import { importFixture } from '../../modules/design-scheme-packages/__tests__/import-fixture.js';
import { sha256, stableContentEntriesHash } from '@musefold/scheme-package';

export async function largeCapacityPackage(
  dimension: 'entry' | 'archive' | 'expanded' | 'ratio',
  side: 'at' | 'over',
) {
  const fixture = await importFixture();
  await fixture.encode();
  const { manifest, content } = fixture;
  const snapshot = manifest.sourceSnapshots[0];
  const extra = new Map<string, Buffer>();
  const sourceBytes = (length: number, printable = false) =>
    printable
      ? Buffer.from(
          randomBytes(Math.ceil((length * 3) / 4))
            .toString('base64')
            .slice(0, length),
        )
      : randomBytes(length);

  function syncManifest() {
    const original = snapshot.files.filter((file) => !file.relativePath.startsWith('capacity-'));
    snapshot.files = [
      ...original,
      ...[...extra].map(([name, bytes]): (typeof snapshot.files)[number] => ({
        relativePath: name,
        kind: dimension === 'expanded' ? 'text' : 'other',
        mimeType: dimension === 'expanded' ? 'text/plain' : 'application/octet-stream',
        sizeBytes: bytes.length,
        contentHash: sha256(bytes),
        evidencePath: null,
        textExcerpt: null,
      })),
    ];
    snapshot.totalBytes = snapshot.files.reduce((sum, file) => sum + file.sizeBytes, 0);
    for (const [name, bytes] of extra) content.set(`sources/${snapshot.id}/${name}`, bytes);
    manifest.content.entries = [...content].map(
      ([relativePath, bytes]): (typeof manifest.content.entries)[number] => ({
        relativePath,
        contentHash: sha256(bytes),
        sizeBytes: bytes.length,
        kind:
          relativePath === 'scheme.json'
            ? 'revision-document'
            : relativePath.startsWith('sources/')
              ? 'source-file'
              : 'asset',
        mimeType: relativePath.includes('/capacity-')
          ? dimension === 'expanded'
            ? 'text/plain'
            : 'application/octet-stream'
          : relativePath.endsWith('.png')
            ? 'image/png'
            : relativePath.endsWith('.json')
              ? 'application/json'
              : 'text/plain',
        sourceId: relativePath.startsWith('sources/') ? relativePath.split('/')[1] : null,
        assetId: relativePath.startsWith('assets/') ? relativePath.slice(7, -4) : null,
      }),
    );
    manifest.content.sizeBytes = [...content.values()].reduce(
      (sum, bytes) => sum + bytes.length,
      0,
    );
    manifest.content.contentHash = stableContentEntriesHash(manifest.content.entries);
    return Buffer.from(JSON.stringify(manifest));
  }

  let ratioMetrics: {
    uncompressedBytes: number;
    compressedBytes: number;
    actualRatio: number;
    prefixBytes: number;
    adjacentPrefixBytes: number;
    boundaryNote: string;
  } | null = null;
  if (dimension === 'entry') {
    extra.set('capacity-entry.bin', sourceBytes(limits.entryBytes + (side === 'over' ? 1 : 0)));
  } else if (dimension === 'archive' || dimension === 'expanded') {
    // Fresh random input, never sparse files or a short repeated zero buffer.
    for (let i = 0; i < 4; i++)
      extra.set(
        `capacity-${i}.${dimension === 'expanded' ? 'txt' : 'bin'}`,
        sourceBytes(limits.entryBytes, dimension === 'expanded'),
      );
  } else {
    const length = 2 * 1024 * 1024;
    const random = randomBytes(64 * 1024);
    const make = (prefix: number) => {
      const bytes = Buffer.alloc(length);
      bytes.fill(
        Buffer.from('Capacity source data: repeated section with unique binary appendix.\n'),
      );
      random.copy(bytes, 0, 0, prefix);
      return bytes;
    };
    const ratio = (prefix: number) => length / deflateRawSync(make(prefix), { level: 9 }).length;
    let low = 0;
    let high = random.length;
    assert(ratio(low) > limits.compressionRatio && ratio(high) <= limits.compressionRatio);
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (ratio(mid) > limits.compressionRatio) low = mid;
      else high = mid;
    }
    const prefix = side === 'at' ? high : low;
    const bytes = make(prefix);
    const compressedBytes = deflateRawSync(bytes, { level: 9 }).length;
    ratioMetrics = {
      uncompressedBytes: bytes.length,
      compressedBytes,
      actualRatio: bytes.length / compressedBytes,
      prefixBytes: prefix,
      adjacentPrefixBytes: side === 'at' ? low : high,
      boundaryNote:
        'Nearest accepted/rejected adjacent random-prefix lengths; actual deflate ratio, not a falsified ZIP size or an exact ratio=200 claim.',
    };
    assert.equal(ratioMetrics.actualRatio > limits.compressionRatio, side === 'over');
    extra.set('capacity-ratio.bin', bytes);
  }

  const target =
    (dimension === 'archive' ? limits.archiveBytes : limits.expandedBytes) +
    (side === 'over' ? 1 : 0);
  let bytes: Buffer | null = null;
  let manifestBytes = Buffer.alloc(0);
  for (let attempt = 0; attempt < 12; attempt++) {
    manifestBytes = syncManifest();
    const expanded =
      manifestBytes.length + [...content.values()].reduce((sum, item) => sum + item.length, 0);
    if (dimension === 'expanded' && expanded !== target) {
      const last = [...extra].at(-1);
      if (!last) throw new Error('Missing capacity fixture file');
      const [name, previous] = last;
      const wanted = previous.length + target - expanded;
      assert(wanted > 0 && wanted <= limits.entryBytes);
      extra.set(
        name,
        wanted <= previous.length
          ? previous.subarray(0, wanted)
          : Buffer.concat([previous, sourceBytes(wanted - previous.length, true)]),
      );
      continue;
    }
    bytes = await rawZip(
      [
        { name: 'manifest.json', bytes: manifestBytes },
        ...[...content].map(([name, value]) => ({ name, bytes: value })),
      ],
      dimension !== 'expanded' && dimension !== 'ratio',
    );
    if (dimension === 'archive' && bytes.length !== target) {
      const last = [...extra].at(-1);
      if (!last) throw new Error('Missing capacity fixture file');
      const [name, previous] = last;
      const wanted = previous.length + target - bytes.length;
      assert(wanted > 0 && wanted <= limits.entryBytes);
      extra.set(
        name,
        wanted <= previous.length
          ? previous.subarray(0, wanted)
          : Buffer.concat([previous, sourceBytes(wanted - previous.length)]),
      );
      bytes = null;
      continue;
    }
    break;
  }
  assert(bytes, 'Exact natural size did not converge');
  const expanded =
    manifestBytes.length + [...content.values()].reduce((sum, item) => sum + item.length, 0);
  if (dimension === 'archive') assert.equal(bytes.length, target);
  if (dimension === 'expanded') {
    assert.equal(expanded, target);
    assert(bytes.length < limits.archiveBytes);
  }
  if (dimension === 'entry')
    assert.equal(
      Math.max(...[...content.values()].map((item) => item.length)),
      limits.entryBytes + (side === 'over' ? 1 : 0),
    );
  return { bytes, ratioMetrics };
}
