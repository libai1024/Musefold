import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { packageExchangeContent } from './package-exchange-content.js';
import {
  legacyImportFixture,
  FULL_PROMPT,
} from '../../modules/design-scheme-packages/__tests__/import-fixture.js';
import { rawZip } from '../../../../../packages/scheme-package/src/__tests__/fixtures.js';
import { readValidatedDesignSchemePackageBytes, sha256 } from '@musefold/scheme-package';

/** Build once per run. Every host consumes the same saved paths and SHA256 identities. */
export async function savePackageImportCorpus(directory: string) {
  await mkdir(directory, { recursive: true });
  const base = await packageExchangeContent();
  const good = await base.encode();
  const parsed = await readValidatedDesignSchemePackageBytes(good);
  if (parsed.formatVersion !== 2) throw new Error('Expected v2 corpus baseline');
  const canonicalManifest = parsed.manifest;
  const entries = () =>
    [...parsed.entries].map(([name, bytes]) => ({ name, bytes: Buffer.from(bytes) }));
  async function changedManifest(change: (manifest: typeof canonicalManifest) => void) {
    const manifest = structuredClone(canonicalManifest);
    change(manifest);
    return rawZip(
      entries().map((e) =>
        e.name === 'manifest.json' ? { ...e, bytes: Buffer.from(JSON.stringify(manifest)) } : e,
      ),
    );
  }
  const cases: Array<{ id: string; bytes: Buffer; accepted: boolean; expectedError?: RegExp }> = [];
  const add = (id: string, bytes: Buffer, accepted: boolean, expectedError?: RegExp) =>
    cases.push({ id, bytes, accepted, expectedError });
  add('v1-full-source', await (await legacyImportFixture()).encode(), true);
  add('v2-mixed-unicode', good, true);
  const crc = Buffer.from(good);
  const index = crc.indexOf(Buffer.from(FULL_PROMPT));
  assert.ok(index > 0);
  crc[index] ^= 1;
  add('crc-damage', crc, false, /CRC/);
  add(
    'asset-hash',
    await changedManifest((m) => (m.assets[0].contentHash = 'f'.repeat(64))),
    false,
    /资产.*哈希|资产.*不一致/,
  );
  add(
    'source-hash',
    await changedManifest((m) => (m.sourceSnapshots[0].files[0].contentHash = 'f'.repeat(64))),
    false,
    /来源文件.*不一致/,
  );
  add(
    'duplicate-entry',
    await rawZip([...entries(), { ...entries()[0] }]),
    false,
    /重复条目|路径冲突/,
  );
  add(
    'case-alias',
    await rawZip([
      ...entries(),
      { name: 'Same.txt', bytes: Buffer.from('x') },
      { name: 'same.txt', bytes: Buffer.from('y') },
    ]),
    false,
    /路径冲突/,
  );
  add(
    'unicode-alias',
    await rawZip([
      ...entries(),
      { name: 'é.txt', bytes: Buffer.from('x') },
      { name: 'e\u0301.txt', bytes: Buffer.from('y') },
    ]),
    false,
    /路径冲突/,
  );
  const traversal = await rawZip([...entries(), { name: 'aa/escape', bytes: Buffer.from('x') }]);
  const from = Buffer.from('aa/escape'),
    to = Buffer.from('../escape');
  assert.equal(from.length, to.length);
  let patches = 0;
  for (let i = traversal.indexOf(from); i >= 0; i = traversal.indexOf(from, i + to.length)) {
    to.copy(traversal, i);
    patches++;
  }
  assert.equal(patches, 2);
  add('traversal', traversal, false, /路径|relative path/);
  add(
    'unsupported-version',
    await changedManifest((m) => Object.assign(m, { formatVersion: 3 })),
    false,
    /不受支持/,
  );
  for (const kind of ['encrypted', 'symlink']) {
    const bytes = kind === 'encrypted' ? await rawZip(entries(), false) : Buffer.from(good);
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.ok(central > 0);
    if (kind === 'encrypted') bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
    else {
      bytes[central + 5] = 3;
      bytes.writeUInt32LE((0xa1ff * 65536) >>> 0, central + 38);
    }
    add(kind, bytes, false, kind === 'encrypted' ? /加密/ : /符号链接/);
  }
  const saved = [];
  for (const item of cases) {
    const path = resolve(directory, `${item.id}.musefold.design`);
    await writeFile(path, item.bytes);
    saved.push({
      id: item.id,
      path,
      bytes: item.bytes.length,
      sha256: sha256(item.bytes),
      accepted: item.accepted,
      expectedError: item.expectedError?.source ?? null,
    });
  }
  await writeFile(resolve(directory, 'manifest.json'), `${JSON.stringify(saved, null, 2)}\n`);
  return saved;
}
