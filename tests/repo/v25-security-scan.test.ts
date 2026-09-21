import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import archiver from 'archiver';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { createContentScanner } from '../../scripts/security/content-scan.mjs';
import { createPackage, scanArtifacts } from '../../scripts/security/artifact-scan.mjs';
import { runScan } from '../../scripts/security/scan.mjs';
import { digest } from '../../scripts/security/content-scan.mjs';

const roots: string[] = [];
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'v25-scan-fixture-'));
  roots.push(path);
  return { path, canary: `musefold-synthetic-${randomBytes(24).toString('hex')}` };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const target = (path: string, kind = 'tree') => ({ id: 'fixture', path, kind });
const { createPackageWithOptions } = createRequire(import.meta.url)('@electron/asar');

async function makeZip(path: string, name: string, data: Buffer) {
  const out = createWriteStream(path);
  const zip = archiver('zip', { zlib: { level: 9 } });
  const closed = once(out, 'close');
  zip.pipe(out);
  zip.append(data, { name });
  await zip.finalize();
  await closed;
}

it('scans stored ZIP entries as well as deflated entries without an unresolved read', async () => {
  const { path, canary } = fixture();
  const zipped = join(path, 'stored.zip');
  const out = createWriteStream(zipped);
  const zip = archiver('zip', { store: true });
  const closed = once(out, 'close');
  zip.pipe(out);
  zip.append(Buffer.from(canary), { name: 'payload.bin' });
  await zip.finalize();
  await closed;
  const report = await scanArtifacts({
    targets: [target(zipped, 'zip')],
    canaries: [{ id: 'stored-token', value: canary }],
  });
  expect(report.errors).toEqual([]);
  expect(report.findings.some((f: { entry: string }) => f.entry.endsWith('payload.bin'))).toBe(
    true,
  );
});

it('detects known secret forms, encoded and UTF16 canaries without disclosing their values', () => {
  const { canary } = fixture();
  const scanner = createContentScanner({ canaries: [{ id: 'api-key', value: canary }] });
  for (const data of [
    Buffer.from(canary),
    Buffer.from(canary, 'utf16le'),
    Buffer.from(Buffer.from(canary).toString('base64')),
    Buffer.from(encodeURIComponent(canary)),
  ]) {
    const findings = scanner.scan(data);
    expect(findings.some((f: { rule: string }) => f.rule === 'canary:api-key')).toBe(true);
    expect(JSON.stringify(findings)).not.toContain(canary);
  }
  const key = ['sk-', randomBytes(30).toString('hex')].join('');
  expect(scanner.scan(Buffer.from(key))).toEqual([
    expect.objectContaining({ rule: 'provider-token' }),
  ]);
  expect(scanner.safeLabel(`folder/${key}/${canary}`)).not.toContain(key);
});

it('detects cross-chunk secrets in binary files, SQLite, WAL and backup copies', async () => {
  const { path, canary } = fixture();
  const binary = Buffer.concat([
    Buffer.alloc(1024 * 1024 - 7),
    Buffer.from(canary),
    Buffer.alloc(32),
  ]);
  writeFileSync(join(path, 'binary.bin'), binary);
  const db = new Database(join(path, 'userdata.db'));
  try {
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE probe(value TEXT)');
    db.prepare('INSERT INTO probe VALUES (?)').run(canary);
    await db.backup(join(path, 'backup.db'));
    const result = await scanArtifacts({
      targets: [target(path)],
      canaries: [{ id: 'session', value: canary }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.findings.map((f: { entry: string }) => f.entry)).toEqual(
      expect.arrayContaining(['binary.bin', 'userdata.db-wal', 'backup.db']),
    );
    expect(JSON.stringify(result)).not.toContain(canary);
  } finally {
    db.close();
  }
});

it('reads compressed ZIP and nested asar bytes, rather than accepting archive filenames', async () => {
  const { path, canary } = fixture();
  const contents = join(path, 'contents');
  mkdirSync(contents);
  writeFileSync(join(contents, 'payload.js'), canary);
  const asarPath = join(path, 'app.asar');
  await createPackage(contents, asarPath);
  const zipped = join(path, 'app.zip');
  const out = createWriteStream(zipped);
  const zip = archiver('zip', { zlib: { level: 9 } });
  const closed = once(out, 'close');
  zip.pipe(out);
  zip.file(asarPath, { name: 'Resources/app.asar' });
  await zip.finalize();
  await closed;
  const result = await scanArtifacts({
    targets: [target(zipped, 'zip')],
    canaries: [{ id: 'token', value: canary }],
  });
  expect(result.ok).toBe(false);
  expect(result.errors).toEqual([]);
  expect(result.targets[0].archives).toBe(2);
  expect(
    result.findings.some((f: { entry: string }) => f.entry.endsWith('app.asar!/payload.js')),
  ).toBe(true);
  expect(JSON.stringify(result)).not.toContain(canary);
});

it('fails missing, empty, unsupported and malformed inputs with redacted error codes', async () => {
  const { path, canary } = fixture();
  const missing = await scanArtifacts({ targets: [target(join(path, canary))] });
  expect(missing.errors).toEqual([{ target: 'fixture', code: 'MISSING_TARGET' }]);
  const empty = await scanArtifacts({ targets: [target(path)] });
  expect(empty.ok).toBe(false);
  const bad = join(path, 'broken.zip');
  writeFileSync(bad, canary);
  const broken = await scanArtifacts({ targets: [target(bad, 'zip')] });
  expect(broken.errors).toEqual([{ target: 'fixture', code: 'SCAN_READ_FAILED' }]);
  expect(JSON.stringify(broken)).not.toContain(canary);
  const dmg = join(path, 'installer.dmg');
  writeFileSync(dmg, 'needs mounted content');
  expect((await scanArtifacts({ targets: [target(dmg, 'file')] })).errors).toEqual([
    { target: 'fixture', code: 'EXTRACTION_REQUIRED' },
  ]);
});

it('rejects external symlinks and exhausted scan limits instead of silently skipping', async () => {
  const { path } = fixture();
  const data = join(path, 'data');
  mkdirSync(data);
  writeFileSync(join(path, 'outside'), 'outside');
  symlinkSync(join(path, 'outside'), join(data, 'link'));
  expect((await scanArtifacts({ targets: [target(data)] })).errors).toEqual([
    { target: 'fixture', code: 'EXTERNAL_SYMLINK' },
  ]);
  rmSync(join(data, 'link'));
  writeFileSync(join(data, 'large'), '12345');
  expect(
    (await scanArtifacts({ targets: [target(data)], limits: { entryBytes: 4 } })).errors,
  ).toEqual([{ target: 'fixture', code: 'ENTRY_LIMIT' }]);
});

it('requires precise reviewed exceptions and rejects stale or broad exclusions', async () => {
  const { path, canary } = fixture();
  writeFileSync(join(path, 'response.json'), canary);
  const plan = { targets: [target(path)], canaries: [{ id: 'fixture-key', value: canary }] };
  const first = await scanArtifacts(plan);
  const finding = first.findings[0];
  const accepted = await scanArtifacts({
    ...plan,
    exceptions: [{ ...finding, reason: 'Synthetic scanner positive-control fixture only' }],
  });
  expect(accepted.ok).toBe(true);
  expect(accepted.accepted).toHaveLength(1);
  writeFileSync(join(path, 'response.json'), 'redacted');
  const stale = await scanArtifacts({
    ...plan,
    exceptions: [{ ...finding, reason: 'Synthetic scanner positive-control fixture only' }],
  });
  expect(stale.ok).toBe(false);
  expect(stale.errors[0].code).toBe('UNUSED_EXCEPTION');
});

it('treats internal path exposure as an explicit output policy, not every legitimate local path', async () => {
  const { path } = fixture();
  writeFileSync(
    join(path, 'response.json'),
    JSON.stringify({ path: ['/Users', 'synthetic-user', 'db.sqlite'].join('/') }),
  );
  expect((await scanArtifacts({ targets: [target(path)] })).ok).toBe(true);
  const result = await scanArtifacts({ targets: [{ ...target(path), detectUserPaths: true }] });
  expect(result.findings[0].rule).toBe('user-path');
  expect(JSON.stringify(result)).not.toContain('synthetic-user');
});

it('CLI persists a failing report without echoing the canary or raw path', () => {
  const { path, canary } = fixture();
  const data = join(path, 'data');
  mkdirSync(data);
  writeFileSync(join(data, 'payload'), canary);
  const plan = join(path, 'plan.json');
  const report = join(path, 'report.json');
  writeFileSync(
    plan,
    JSON.stringify({ targets: [target(data)], canaries: [{ id: 'key', value: canary }] }),
  );
  let output = '';
  try {
    execFileSync(
      process.execPath,
      [resolve('scripts/security/scan.mjs'), 'plan', '--plan', plan, '--report', report],
      { encoding: 'utf8', stdio: 'pipe' },
    );
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    expect(e.status).toBe(1);
    output = String(e.stdout) + String(e.stderr);
  }
  expect(output).toContain('"ok":false');
  expect(output).not.toContain(canary);
  expect(output).not.toContain(path);
  expect(readFileSync(report, 'utf8')).not.toContain(canary);
});

it('recurses through an uppercase ZIP and a design package nested inside asar', async () => {
  const { path, canary } = fixture();
  const contents = join(path, 'content');
  mkdirSync(contents);
  await makeZip(join(contents, 'scheme.musefold.design'), 'manifest.json', Buffer.from(canary));
  const asar = join(path, 'app.asar');
  await createPackage(contents, asar);
  const zipped = join(path, 'APP.ZIP');
  await makeZip(zipped, 'app.asar', readFileSync(asar));
  const report = await scanArtifacts({
    targets: [target(zipped, 'zip')],
    canaries: [{ id: 'token', value: canary }],
  });
  expect(report.errors).toEqual([]);
  expect(report.targets[0].archives).toBe(3);
  expect(
    report.findings.some((f: { entry: string }) =>
      f.entry.endsWith('scheme.musefold.design!/manifest.json'),
    ),
  ).toBe(true);
});

it('redacts reversible canary encodings from report entry names', async () => {
  const { path, canary } = fixture();
  const encoded = Buffer.from(canary).toString('base64');
  writeFileSync(join(path, encoded), 'public data');
  const report = await scanArtifacts({
    targets: [target(path)],
    canaries: [{ id: 'token', value: canary }],
  });
  expect(report.ok).toBe(false);
  expect(JSON.stringify(report)).not.toContain(encoded);
});

it('does not accept a compressed container just because it is inside a tree', async () => {
  const { path } = fixture();
  writeFileSync(join(path, 'hidden.GZ'), 'compressed container needs extraction');
  const report = await scanArtifacts({ targets: [target(path)] });
  expect(report.ok).toBe(false);
  expect(report.errors[0].code).toBe('EXTRACTION_REQUIRED');
});

it('source mode includes root build/test configurations and refuses external symlink copies', async () => {
  const { path, canary } = fixture();
  const repo = join(path, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'package.json'), '{}');
  writeFileSync(join(repo, 'vitest.config.ts'), ['sk-', 'Z'.repeat(40)].join(''));
  const reportPath = join(path, 'report.json');
  const report = await runScan(['source', '--repo-root', repo, '--report', reportPath]);
  expect(report.ok).toBe(false);
  expect(report.findings[0].entry).toBe('vitest.config.ts');
  mkdirSync(join(repo, 'scripts'));
  writeFileSync(join(path, 'private'), canary);
  symlinkSync(join(path, 'private'), join(repo, 'scripts/external.js'));
  await expect(runScan(['source', '--repo-root', repo, '--report', reportPath])).rejects.toThrow(
    'EXTERNAL_SYMLINK',
  );
});

it('rejects stale or missing expected bundle content even when no secret is present', async () => {
  const { path } = fixture();
  writeFileSync(join(path, 'main.js'), 'old build');
  const expectedFiles = [{ entry: 'main.js', sha256: digest('current build') }];
  const mismatch = await scanArtifacts({ targets: [{ ...target(path), expectedFiles }] });
  expect(mismatch.ok).toBe(false);
  expect(mismatch.errors[0].code).toBe('ARTIFACT_IDENTITY_MISMATCH');
  writeFileSync(join(path, 'main.js'), 'current build');
  expect((await scanArtifacts({ targets: [{ ...target(path), expectedFiles }] })).ok).toBe(true);
  const missing = await scanArtifacts({
    targets: [
      { ...target(path), expectedFiles: [{ entry: 'preload.js', sha256: digest('expected') }] },
    ],
  });
  expect(missing.ok).toBe(false);
  expect(missing.errors[0].code).toBe('MISSING_EXPECTED_FILE');
});

it.each(['file', 'zip'])(
  'detects a ZIP renamed .bin for a %s target and scans its decompressed bytes',
  async (kind) => {
    const { path, canary } = fixture();
    const archive = join(path, 'opaque.bin');
    await makeZip(archive, 'compressed.txt', Buffer.from(canary));
    const report = await scanArtifacts({
      targets: [target(archive, kind)],
      canaries: [{ id: 'renamed', value: canary }],
    });
    expect(report.errors).toEqual([]);
    expect(report.targets[0].archives).toBe(1);
    expect(
      report.findings.some((finding: { entry: string }) => finding.entry === '.!/compressed.txt'),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain(canary);
  },
);

it('recognizes renamed asar and renamed packed ZIP containers recursively', async () => {
  const { path, canary } = fixture();
  const content = join(path, 'content');
  mkdirSync(content);
  await makeZip(join(content, 'packed.node'), 'secret.txt', Buffer.from(canary));
  const asar = join(path, 'opaque.bin');
  await createPackage(content, asar);
  const archive = join(path, 'outer.data');
  await makeZip(archive, 'nested.payload', readFileSync(asar));
  const report = await scanArtifacts({
    targets: [target(archive, 'file')],
    canaries: [{ id: 'packed', value: canary }],
  });
  expect(report.errors).toEqual([]);
  expect(report.targets[0].archives).toBe(3);
  expect(
    report.findings.some((finding: { entry: string }) =>
      finding.entry.endsWith('nested.payload!/packed.node!/secret.txt'),
    ),
  ).toBe(true);
  expect((await scanArtifacts({ targets: [target(asar, 'asar')] })).targets[0].archives).toBe(2);
});

it('detects renamed unsupported compression both on disk and packed inside asar', async () => {
  const { path, canary } = fixture();
  const content = join(path, 'content');
  mkdirSync(content);
  const gzip = join(content, 'hidden.data');
  writeFileSync(gzip, gzipSync(canary));
  const archive = join(path, 'app.asar');
  await createPackage(content, archive);
  for (const artifact of [gzip, archive]) {
    const report = await scanArtifacts({ targets: [target(artifact, 'file')] });
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual([{ target: 'fixture', code: 'EXTRACTION_REQUIRED' }]);
    expect(JSON.stringify(report)).not.toContain(canary);
  }
});

it.each([
  ['7z', '377abcaf271c'],
  ['xz', 'fd377a585a00'],
  ['zstd', '28b52ffd'],
  ['zstd-skippable', '502a4d18'],
  ['lz4', '04224d18'],
  ['bzip2', '425a6839'],
  ['rar', '526172211a070100'],
  ['lzip', '4c5a495001'],
  ['cab', '4d53434600000000'],
])('refuses a renamed %s container by signature', async (_kind, magic) => {
  const { path } = fixture();
  const file = join(path, 'opaque.bin');
  writeFileSync(file, Buffer.concat([Buffer.from(magic, 'hex'), Buffer.alloc(64)]));
  const report = await scanArtifacts({ targets: [target(file, 'file')] });
  expect(report.errors).toEqual([{ target: 'fixture', code: 'EXTRACTION_REQUIRED' }]);
});

it.each(['tar', 'dmg'])(
  'refuses a renamed %s with a signature at its defined offset',
  async (kind) => {
    const { path } = fixture();
    const file = join(path, 'opaque.bin');
    const data = Buffer.alloc(2048);
    data.write(
      kind === 'tar' ? 'ustar\0' : 'koly',
      kind === 'tar' ? 257 : data.length - 512,
      'ascii',
    );
    writeFileSync(file, data);
    expect((await scanArtifacts({ targets: [target(file, 'file')] })).errors).toEqual([
      { target: 'fixture', code: 'EXTRACTION_REQUIRED' },
    ]);
  },
);

it('does not mistake a uint32 prefix or a non-asar Pickle JSON value for an archive', async () => {
  const { path } = fixture();
  const arbitrary = Buffer.alloc(512);
  arbitrary.writeUInt32LE(4, 0);
  arbitrary.writeUInt32LE(0xffffffff, 4);
  writeFileSync(join(path, 'ordinary.bin'), arbitrary);
  const json = Buffer.from('{"payload":"plain binary metadata"}');
  const headerSize = 8 + Math.ceil(json.length / 4) * 4;
  const pickle = Buffer.alloc(8 + headerSize);
  pickle.writeUInt32LE(4, 0);
  pickle.writeUInt32LE(headerSize, 4);
  pickle.writeUInt32LE(headerSize - 4, 8);
  pickle.writeUInt32LE(json.length, 12);
  json.copy(pickle, 16);
  writeFileSync(join(path, 'metadata.bin'), pickle);
  const report = await scanArtifacts({ targets: [target(path)] });
  expect(report.ok).toBe(true);
  expect(report.targets[0]).toMatchObject({ files: 2, archives: 0 });
});

it('bounds asar header reads and keeps renamed archive depth limits', async () => {
  const { path } = fixture();
  const contents = join(path, 'contents');
  mkdirSync(contents);
  await makeZip(join(contents, 'first.bin'), 'second.bin', Buffer.from('ordinary content'));
  const asar = join(path, 'opaque.bin');
  await createPackage(contents, asar);
  expect(
    (await scanArtifacts({ targets: [target(asar, 'file')], limits: { headerBytes: 8 } })).errors,
  ).toEqual([{ target: 'fixture', code: 'ENTRY_LIMIT' }]);
  const outer = join(path, 'outer.bin');
  await makeZip(outer, 'inner.bin', readFileSync(asar));
  expect(
    (await scanArtifacts({ targets: [target(outer, 'file')], limits: { depth: 1 } })).errors,
  ).toEqual([{ target: 'fixture', code: 'ARCHIVE_DEPTH_LIMIT' }]);
});

it('rejects a forged advertised asar header before a parser can allocate its declared size', async () => {
  const { path } = fixture();
  const archive = join(path, 'forged.asar');
  const data = Buffer.alloc(16);
  data.writeUInt32LE(4, 0);
  data.writeUInt32LE(0xfffffffc, 4);
  data.writeUInt32LE(0xfffffff8, 8);
  data.writeUInt32LE(0xfffffff4, 12);
  writeFileSync(archive, data);
  expect((await scanArtifacts({ targets: [target(archive, 'file')] })).errors).toEqual([
    { target: 'fixture', code: 'SCAN_READ_FAILED' },
  ]);
});

it('keeps total-byte limits before reading a packed asar entry', async () => {
  const { path } = fixture();
  const content = join(path, 'content');
  mkdirSync(content);
  writeFileSync(join(content, 'payload.bin'), Buffer.alloc(100));
  const archive = join(path, 'opaque.bin');
  await createPackage(content, archive);
  const report = await scanArtifacts({
    targets: [target(archive, 'file')],
    limits: { totalBytes: readFileSync(archive).length + 99 },
  });
  expect(report.errors).toEqual([{ target: 'fixture', code: 'TOTAL_BYTE_LIMIT' }]);
});

it('scans full unpacked bytes and recognizes disguised containers without trusting stale asar sizes', async () => {
  const { path, canary } = fixture();
  const content = join(path, 'content');
  mkdirSync(content);
  await makeZip(join(content, 'compressed.node'), 'payload.txt', Buffer.from(canary));
  writeFileSync(join(content, 'native.node'), 'native prefix');
  const archive = join(path, 'app.asar');
  await createPackageWithOptions(content, archive, { unpack: '*.node' });
  writeFileSync(join(`${archive}.unpacked`, 'native.node'), `native prefix ${canary}`);
  const report = await scanArtifacts({
    targets: [target(archive, 'asar')],
    canaries: [{ id: 'unpacked', value: canary }],
  });
  expect(report.errors).toEqual([]);
  expect(report.targets[0].archives).toBe(2);
  expect(report.findings.map((finding: { entry: string }) => finding.entry)).toEqual(
    expect.arrayContaining(['.!/native.node', '.!/compressed.node!/payload.txt']),
  );
  writeFileSync(join(`${archive}.unpacked`, 'native.node'), Buffer.alloc(4096));
  expect(
    (await scanArtifacts({ targets: [target(archive, 'asar')], limits: { entryBytes: 2048 } }))
      .errors,
  ).toEqual([{ target: 'fixture', code: 'ENTRY_LIMIT' }]);
});

it('retains the external-unpacked-symlink rejection when sniffing renamed containers', async () => {
  const { path } = fixture();
  const content = join(path, 'content');
  mkdirSync(content);
  writeFileSync(join(content, 'native.node'), 'native prefix');
  const archive = join(path, 'app.asar');
  await createPackageWithOptions(content, archive, { unpack: '*.node' });
  const outside = join(path, 'outside.bin');
  await makeZip(outside, 'payload.txt', Buffer.from('outside'));
  const unpacked = join(`${archive}.unpacked`, 'native.node');
  rmSync(unpacked);
  symlinkSync(outside, unpacked);
  expect((await scanArtifacts({ targets: [target(archive, 'asar')] })).errors).toEqual([
    { target: 'fixture', code: 'EXTERNAL_SYMLINK' },
  ]);
});
