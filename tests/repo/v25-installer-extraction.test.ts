import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  extractVerifiedInstaller,
  validateInstallerListing,
} from '../../scripts/security/installer-extraction.mjs';
import { runPackageScan } from '../../scripts/security/scan-packages.mjs';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'musefold-installer-test-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function entry(path = 'resources/app.asar', size = '12', extra = '') {
  return `Path = ${path}\nSize = ${size}\nAttributes = A -rw-r--r--\nEncrypted = -\n${extra}\n`;
}
function installed7zip(): string | undefined {
  const candidates = ['7z', '7zz'];
  try {
    const local = createRequire(resolve('apps/desktop/package.json'))('7zip-bin') as {
      path7za: string;
    };
    candidates.push(local.path7za);
  } catch {
    /* Newer electron-builder versions use their own cached binary. */
  }
  const cache = join(homedir(), 'Library/Caches/electron-builder/7zip@1.0.0');
  if (process.platform === 'darwin' && existsSync(cache))
    for (const child of readdirSync(cache)) candidates.push(join(cache, child, 'bin/7zz'));
  return candidates.find(
    (binary) => spawnSync(binary, ['i'], { stdio: 'pipe', timeout: 5000 }).status === 0,
  );
}
const binary = installed7zip();

it('accepts ordinary Windows names and counts implicit directories in the plan', () => {
  const plan = validateInstallerListing(entry('resources\\integration\\tool.js'));
  expect(plan.totalBytes).toBe(12);
  expect(plan.nodes.size).toBe(3);
  expect(plan.entries[0].path).toBe('resources/integration/tool.js');
});

it.each([
  '../outside',
  'a/../b',
  '/absolute',
  '\\server\\share',
  'C:\\outside',
  'a:stream',
  'a/CON.txt',
  'NUL',
  'COM1.js',
  'LPT¹',
  'conout$',
  'a./b',
  'trailing ',
  'a//b',
  'a/./b',
  'a?b',
])('rejects unsafe Windows path %j before extraction', (path) => {
  expect(() => validateInstallerListing(entry(path))).toThrow('INVALID_INSTALLER_PATH');
});

it.each([
  entry('App/file') + entry('app/other'),
  entry('a') + entry('a/b'),
  entry('a/b') + entry('a'),
  entry('same') + entry('same'),
  entry('File') + entry('file'),
])('rejects case, duplicate and file/directory collisions', (listing) => {
  expect(() => validateInstallerListing(listing)).toThrow('INVALID_INSTALLER_PATH');
});

it.each([
  'Symbolic Link = ../outside\n',
  'Hard Link = outside\n',
  'Reparse Point = +\n',
  'Alternate Stream = +\n',
])('rejects link/stream metadata %s', (metadata) => {
  expect(() => validateInstallerListing(entry('file', '12', metadata))).toThrow(
    'INSTALLER_LINK_REJECTED',
  );
});
it.each(['A lrwxrwxrwx', 'AL', 'A_ brw-r--r--'])(
  'rejects unsafe file attributes %s',
  (attributes) => {
    expect(() => validateInstallerListing(entry().replace('A -rw-r--r--', attributes))).toThrow(
      'INSTALLER_LINK_REJECTED',
    );
  },
);

it('fails closed for unreadable/ambiguous listing fields and encrypted entries', () => {
  for (const listing of [
    '',
    '7-Zip warning',
    entry().replace('Size = 12', 'Size = unknown'),
    entry().replace('Size = 12', 'Size = -1'),
    entry('a\0b'),
    entry('file', '12', 'Size = 1\n'),
  ])
    expect(() => validateInstallerListing(listing)).toThrow('INVALID_INSTALLER_LIST');
  expect(() => validateInstallerListing(entry().replace('Encrypted = -', 'Encrypted = +'))).toThrow(
    'ENCRYPTED_INSTALLER',
  );
});

it('bounds file sizes, aggregate bytes, listing bytes and implicit directory counts', () => {
  expect(() => validateInstallerListing(entry('file', '13'), { entryBytes: 12 })).toThrow(
    'INSTALLER_ENTRY_LIMIT',
  );
  expect(() => validateInstallerListing(entry('one') + entry('two'), { totalBytes: 23 })).toThrow(
    'INSTALLER_TOTAL_LIMIT',
  );
  expect(() => validateInstallerListing(entry(), { listingBytes: 10 })).toThrow(
    'INSTALLER_LIST_LIMIT',
  );
  expect(() => validateInstallerListing(entry('a/b/c'), { entries: 2 })).toThrow(
    'INSTALLER_ENTRY_LIMIT',
  );
});

it.skipIf(!binary)('validates and extracts a real 7z fixture on the current host', () => {
  const root = fixture();
  const content = join(root, 'content');
  mkdirSync(content);
  writeFileSync(join(content, 'public.txt'), 'public fixture');
  const archive = join(root, 'fixture.7z');
  execFileSync(binary as string, ['a', '-t7z', archive, content], { stdio: 'pipe' });
  const destination = join(root, 'expanded');
  expect(extractVerifiedInstaller(archive, destination, { binary })).toEqual({
    entries: 2,
    bytes: 14,
  });
  expect(readFileSync(join(destination, 'content/public.txt'), 'utf8')).toBe('public fixture');
});

it.skipIf(!binary)(
  'shares limits across successive real installer payload extractions before the second x',
  () => {
    const root = fixture();
    const content = join(root, 'payload');
    writeFileSync(content, '1234567890');
    const archive = join(root, 'fixture.7z');
    execFileSync(binary as string, ['a', '-t7z', archive, content], { stdio: 'pipe' });
    for (const limits of [{ totalBytes: 19 }, { entries: 1 }]) {
      const budget = { entries: 0, bytes: 0 };
      const first = join(root, `first-${Object.keys(limits)[0]}`);
      const second = join(root, `second-${Object.keys(limits)[0]}`);
      extractVerifiedInstaller(archive, first, { binary, limits, budget });
      expect(() => extractVerifiedInstaller(archive, second, { binary, limits, budget })).toThrow(
        /INSTALLER_(?:TOTAL|ENTRY)_LIMIT/,
      );
      expect(existsSync(second)).toBe(false);
    }
  },
);

it.skipIf(!binary)(
  'rejects real 7z entries exceeding declared limits without creating an output directory',
  () => {
    const root = fixture();
    const content = join(root, 'bomb');
    writeFileSync(content, Buffer.alloc(4096));
    const archive = join(root, 'small.7z');
    execFileSync(binary as string, ['a', '-t7z', archive, content], { stdio: 'pipe' });
    expect(readFileSync(archive).length).toBeLessThan(1024);
    const destination = join(root, 'expanded');
    expect(() =>
      extractVerifiedInstaller(archive, destination, { binary, limits: { entryBytes: 1024 } }),
    ).toThrow('INSTALLER_ENTRY_LIMIT');
    expect(existsSync(destination)).toBe(false);
  },
);

it('writes a redacted failure report for configuration and extraction exceptions', async () => {
  const root = fixture();
  for (const message of ['INSTALLER_COMMAND_FAILED', `private fixture at ${root}`]) {
    const result = await runPackageScan(['report.json'], {
      repoRoot: root,
      scan: async () => {
        throw new Error(message);
      },
    });
    expect(result.ok).toBe(false);
    const text = readFileSync(join(root, 'report.json'), 'utf8');
    expect(text).not.toContain(root);
    expect(JSON.parse(text).errors[0].code).toBe(
      message === 'INSTALLER_COMMAND_FAILED' ? message : 'PACKAGE_SCAN_FAILED',
    );
  }
  await runPackageScan([], { repoRoot: root });
  expect(
    JSON.parse(readFileSync(join(root, 'tests/v25/.results/package/security.json'), 'utf8')).errors,
  ).toEqual([{ code: 'EXPECTED_REPORT_PATH' }]);
});

it('CLI writes its requested failure report even for invalid arguments and exits nonzero without paths', () => {
  const root = fixture();
  const report = join(root, 'report.json');
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/security/scan-packages.mjs'), report, 'extra'],
    { encoding: 'utf8' },
  );
  expect(result.status).toBe(2);
  expect(JSON.parse(readFileSync(report, 'utf8'))).toMatchObject({
    ok: false,
    errors: [{ code: 'EXPECTED_REPORT_PATH' }],
  });
  expect(result.stdout + result.stderr).not.toContain(root);
});
