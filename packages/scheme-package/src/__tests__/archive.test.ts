import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  readValidatedDesignSchemePackage,
  readValidatedDesignSchemePackageBytes,
  writeDesignSchemePackageBytes,
  isSafePackagePath,
  sniffImageMimeType,
  sha256,
} from '../index.js';
import { mixedPackage, rawPackage, rawZip } from './fixtures.js';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing required fixture value');
  return value;
}

describe('shared Node design package codec', () => {
  it('roundtrips the same canonical bytes through file and byte hosts with full history/repository provenance', async () => {
    const { manifest, content } = mixedPackage();
    const before = JSON.stringify(manifest);
    const first = await writeDesignSchemePackageBytes(manifest, content);
    expect(await writeDesignSchemePackageBytes(manifest, content)).toEqual(first);
    const fromBytes = await readValidatedDesignSchemePackageBytes(first, [2]);
    expect(fromBytes.manifest).toEqual(manifest);
    expect(fromBytes.entries.get('sources/snap_history/prompt.txt')).toEqual(
      content.get('sources/snap_history/prompt.txt'),
    );
    const dir = await mkdtemp(join(tmpdir(), 'scheme-codec-'));
    try {
      const path = join(dir, 'roundtrip.musefold.design');
      await writeFile(path, first);
      const fromFile = await readValidatedDesignSchemePackage(path, [2]);
      expect(fromFile).toEqual(fromBytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(JSON.stringify(manifest)).toBe(before);
  });
  it.each([
    [
      'asset hash',
      (x: ReturnType<typeof mixedPackage>) => {
        x.manifest.assets[0].contentHash = 'f'.repeat(64);
      },
    ],
    [
      'asset size',
      (x: ReturnType<typeof mixedPackage>) => {
        x.manifest.assets[0].byteSize += 1;
      },
    ],
    [
      'source hash',
      (x: ReturnType<typeof mixedPackage>) => {
        x.manifest.sourceSnapshots[0].files[0].contentHash = 'f'.repeat(64);
      },
    ],
    [
      'source total',
      (x: ReturnType<typeof mixedPackage>) => {
        x.manifest.sourceSnapshots[0].totalBytes += 1;
      },
    ],
    [
      'repository path',
      (x: ReturnType<typeof mixedPackage>) => {
        required(x.manifest.document.repositoryImages)[0].relativePath = 'missing.png';
      },
    ],
    [
      'repository snapshot',
      (x: ReturnType<typeof mixedPackage>) => {
        required(x.manifest.document.repositoryImages)[0].snapshotId = 'snap_history';
      },
    ],
    [
      'repository role',
      (x: ReturnType<typeof mixedPackage>) => {
        x.manifest.assets[0].role = 'output';
      },
    ],
    [
      'history image',
      (x: ReturnType<typeof mixedPackage>) => {
        required(x.manifest.sourceSnapshots[1].historyItems)[0].imageAssetId = 'asset_repo';
      },
    ],
    [
      'history prompt',
      (x: ReturnType<typeof mixedPackage>) => {
        required(x.manifest.sourceSnapshots[1].historyItems)[0].prompt = 'forged complete prompt';
      },
    ],
    [
      'asset bound to source',
      (x: ReturnType<typeof mixedPackage>) => {
        required(x.manifest.content.entries.find((e) => e.kind === 'asset')).sourceId = 'snap_repo';
      },
    ],
  ])(
    'rejects %s inconsistency even with recomputed ZIP/manifest content hashes',
    async (_name, mutate) => {
      const fixture = mixedPackage();
      mutate(fixture);
      const bytes = await rawPackage(fixture.manifest, fixture.content);
      await expect(readValidatedDesignSchemePackageBytes(bytes)).rejects.toThrow();
      await expect(
        writeDesignSchemePackageBytes(fixture.manifest, fixture.content),
      ).rejects.toThrow();
    },
  );
  it('rejects caller bytes tampering without relying on a manifest hash to detect CRC damage', async () => {
    const { manifest, content } = mixedPackage();
    const bytes = await writeDesignSchemePackageBytes(manifest, content);
    const offset = bytes.indexOf(Buffer.from('原始提示词'));
    expect(offset).toBeGreaterThan(0);
    bytes[offset] ^= 1;
    await expect(readValidatedDesignSchemePackageBytes(bytes)).rejects.toThrow('CRC');
  });
  it('takes an immutable input snapshot before asynchronous parsing', async () => {
    const { manifest, content } = mixedPackage();
    const bytes = await writeDesignSchemePackageBytes(manifest, content);
    const pending = readValidatedDesignSchemePackageBytes(bytes);
    bytes.fill(0);
    expect((await pending).manifest).toEqual(manifest);
  });
  it('rejects directory/file collisions and counts directory entries toward the same budget', async () => {
    const collision = await rawZip([
      { name: 'same/', bytes: Buffer.alloc(0), type: 'directory' },
      { name: 'same', bytes: Buffer.from('x') },
    ]);
    await expect(readValidatedDesignSchemePackageBytes(collision)).rejects.toThrow('重复条目');
    const many = await rawZip(
      Array.from({ length: 1025 }, (_, i) => ({
        name: `d${i}/`,
        bytes: Buffer.alloc(0),
        type: 'directory' as const,
      })),
    );
    await expect(readValidatedDesignSchemePackageBytes(many)).rejects.toThrow('条目超过上限');
  });
  it('rejects unsupported version and allows the unchanged v1 legacy envelope only when accepted', async () => {
    const scheme = Buffer.from('{}');
    const manifest = {
      format: 'musefold.design',
      formatVersion: 1,
      exportedAt: 0,
      scheme: {
        name: 'Legacy',
        summary: '',
        fidelity: 'faithful',
        sourceLabel: '',
        sourcePresentation: 'skill',
      },
      revisionId: 'legacy_revision',
      snapshots: [],
      files: { 'scheme.json': sha256(scheme) },
    };
    const bytes = await rawZip([
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: 'scheme.json', bytes: scheme },
    ]);
    expect((await readValidatedDesignSchemePackageBytes(bytes)).formatVersion).toBe(1);
    await expect(readValidatedDesignSchemePackageBytes(bytes, [2])).rejects.toThrow(
      '未被当前操作接受',
    );
    manifest.formatVersion = 3;
    await expect(
      readValidatedDesignSchemePackageBytes(
        await rawZip([{ name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) }]),
      ),
    ).rejects.toThrow('不受支持');
  });
  it('rejects Windows drive paths on every host and does not classify arbitrary ftyp video as AVIF', () => {
    for (const path of ['C:/private/file', 'C:relative', '/root/file', 'a\\b', '../x', 'a/./b'])
      expect(isSafePackagePath(path)).toBe(false);
    const video = Buffer.alloc(24);
    video.writeUInt32BE(24);
    video.write('ftyp', 4);
    video.write('isom', 8);
    expect(sniffImageMimeType(video)).toBeNull();
    video.write('avif', 16);
    expect(sniffImageMimeType(video)).toBe('image/avif');
  });
});

it.each([
  ['case-folded', 'Same.txt', 'same.txt'],
  ['Unicode-normalized', 'é.txt', 'e\u0301.txt'],
  ['parent file first', 'parent', 'parent/child.txt'],
  ['parent file last', 'parent/child.txt', 'parent'],
])('rejects %s extraction aliases', async (_name, first, second) => {
  const bytes = await rawZip([
    { name: first, bytes: Buffer.from('x') },
    { name: second, bytes: Buffer.from('y') },
  ]);
  await expect(readValidatedDesignSchemePackageBytes(bytes)).rejects.toThrow('路径冲突');
});
it('rejects encrypted and symlink archive entries before parsing content', async () => {
  for (const kind of ['encrypted', 'symlink']) {
    const bytes = await rawZip([{ name: 'manifest.json', bytes: Buffer.from('{}') }], false);
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(central).toBeGreaterThan(0);
    if (kind === 'encrypted') bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
    else {
      bytes[central + 5] = 3;
      bytes.writeUInt32LE((0xa1ff * 65536) >>> 0, central + 38);
    }
    await expect(readValidatedDesignSchemePackageBytes(bytes)).rejects.toThrow(
      kind === 'encrypted' ? '加密条目' : '符号链接',
    );
  }
});
it('rejects Windows devices, ADS, wildcard and trailing-dot names before host extraction', () => {
  for (const path of [
    'assets/NUL.png',
    'a/CON',
    'COM1.txt',
    'a/file:stream',
    'a/name.',
    'a/name ',
    'a/*.png',
  ])
    expect(isSafePackagePath(path)).toBe(false);
});
it('rejects invalid UTF-8 JSON even if its ZIP checksum is valid', async () => {
  const invalid = Buffer.concat([Buffer.from('{"name":"'), Buffer.from([0xff]), Buffer.from('"}')]);
  await expect(
    readValidatedDesignSchemePackageBytes(
      await rawZip([{ name: 'manifest.json', bytes: invalid }]),
    ),
  ).rejects.toThrow('有效 JSON');
});
