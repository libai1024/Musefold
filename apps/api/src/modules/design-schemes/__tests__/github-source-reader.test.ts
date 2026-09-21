import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { crc32, deflateRawSync } from 'node:zlib';
import { sourceFileMetadataSchema } from '@musefold/contracts';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGithubSourceArchive } from '../github-source-archive.js';
import {
  GITHUB_SOURCE_LIMITS,
  GithubDesignSchemeSourceReader,
  type GithubSourceReaderDependencies,
} from '../github-source-reader.js';

const SHA = 'a'.repeat(40);
const TREE = 'c'.repeat(40);
const ROOT = `design-${SHA}`;
const REPOSITORY = 'https://github.com/example/design';
type ZipInput = {
  name: string;
  content?: Uint8Array;
  mode?: number;
  method?: number;
  flags?: number;
  declaredSize?: number;
  crc?: number;
  localName?: string;
  descriptor?: boolean;
  compressed?: Uint8Array;
};

/** Small synthetic ZIP writer; malformed cases deliberately bypass archive libraries. */
function zip(inputs: ZipInput[]) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const input of inputs) {
    const bytes = Buffer.from(input.content ?? '');
    const method = input.method ?? 0;
    const compressed = input.compressed
      ? Buffer.from(input.compressed)
      : method === 8
        ? deflateRawSync(bytes)
        : bytes;
    const name = Buffer.from(input.name);
    const localName = Buffer.from(input.localName ?? input.name);
    const flags = (input.flags ?? 0x800) | (input.descriptor ? 8 : 0);
    const checksum = input.crc ?? crc32(bytes);
    const size = input.declaredSize ?? bytes.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!input.descriptor) {
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(size, 22);
    }
    local.writeUInt16LE(localName.length, 26);
    const descriptor = Buffer.alloc(input.descriptor ? 16 : 0);
    if (input.descriptor) {
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(size, 12);
    }
    const record = Buffer.concat([local, localName, compressed, descriptor]);
    locals.push(record);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE((3 << 8) | 20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(size, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(
      ((input.mode ?? (input.name.endsWith('/') ? 0o040755 : 0o100644)) << 16) >>> 0,
      38,
    );
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += record.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(inputs.length, 8);
  end.writeUInt16LE(inputs.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const goodZip = () =>
  zip([{ name: `${ROOT}/README.md`, content: Buffer.from('A reusable poster style.') }]);
const metadata = () => ({
  id: 123,
  name: 'design',
  full_name: 'example/design',
  owner: { login: 'example' },
  html_url: REPOSITORY,
  private: false,
  visibility: 'public',
  default_branch: 'main',
  description: 'Design references',
  license: { spdx_id: 'MIT' },
});
const servers: Server[] = [];

async function fakeGithub() {
  const control = {
    metadata: metadata() as unknown,
    commit: { sha: SHA, commit: { tree: { sha: TREE } } } as unknown,
    archive: goodZip(),
    status: 200,
    statusAt: 'metadata',
    redirect: false,
    redirectStatus: 307,
    redirectAt: 'metadata',
    malformedJson: false,
    mime: '',
    declared: '',
    stall: false,
    stallBody: false,
    chunked: false,
  };
  const serverRequests: string[] = [];
  const requests: Array<{
    url: string;
    method: string;
    authorization: string | null;
    redirect: NonNullable<Parameters<typeof fetch>[1]>['redirect'];
  }> = [];
  const server = createServer((request, response) => {
    const path = request.url ?? '';
    serverRequests.push(path);
    const step = path.startsWith('/archive/')
      ? 'archive'
      : path.includes('/commits/')
        ? 'commit'
        : 'metadata';
    if (control.stall) return;
    if (control.redirect && step === control.redirectAt) {
      response.writeHead(control.redirectStatus, { location: '/forbidden-destination' });
      response.end();
      return;
    }
    if (step === control.statusAt && control.status !== 200) {
      response.writeHead(control.status);
      response.end('upstream rejected');
      return;
    }
    response.setHeader(
      'content-type',
      control.mime || (step === 'archive' ? 'application/zip' : 'application/json'),
    );
    if (control.declared) response.setHeader('content-length', control.declared);
    if (control.stallBody) {
      response.write(' ');
      return;
    }
    if (control.chunked) response.flushHeaders();
    if (step === 'archive') response.end(control.archive);
    else
      response.end(
        control.malformedJson
          ? '{invalid'
          : JSON.stringify(step === 'commit' ? control.commit : control.metadata),
      );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing local address');
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    expect(['https://api.github.com', 'https://codeload.github.com']).toContain(url.origin);
    requests.push({
      url: url.toString(),
      method: init?.method ?? '',
      authorization: new Headers(init?.headers).get('authorization'),
      redirect: init?.redirect,
    });
    const mapped = new URL(`http://127.0.0.1:${address.port}`);
    mapped.pathname = `${url.hostname === 'api.github.com' ? '/api' : '/archive'}${url.pathname}`;
    return fetch(mapped, init);
  };
  const reader = (limits?: GithubSourceReaderDependencies['limits']) =>
    new GithubDesignSchemeSourceReader({ fetchImpl, limits });
  return { control, requests, serverRequests, reader, fetchImpl };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe('non-paid fixed-commit GitHub source reader', () => {
  it('resolves one commit before downloading; moving the branch cannot change the archive URL', async () => {
    const h = await fakeGithub();
    const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    h.control.archive = zip([
      { name: `${ROOT}/` },
      {
        name: `${ROOT}/README.md`,
        content: Buffer.from('Use a serif title.'),
        method: 8,
        descriptor: true,
      },
      { name: `${ROOT}/reference.png`, content: png },
      { name: `${ROOT}/script.sh`, content: Buffer.from('throw new Error("never execute")') },
    ]);
    let commitReads = 0;
    const source = await new GithubDesignSchemeSourceReader({
      fetchImpl: async (input, init) => {
        const response = await h.fetchImpl(input, init);
        if (String(input).includes('/commits/')) {
          commitReads += 1;
          h.control.commit = { sha: 'b'.repeat(40), commit: { tree: { sha: TREE } } };
        }
        return response;
      },
    }).read({ repositoryUrl: REPOSITORY });
    expect(commitReads).toBe(1);
    expect(source).toMatchObject({
      repositoryId: 123,
      requestedRef: 'main',
      resolvedRef: SHA,
      commitHash: SHA,
      treeHash: TREE,
    });
    expect(h.requests.map((request) => request.url)).toEqual([
      'https://api.github.com/repos/example/design',
      'https://api.github.com/repos/example/design/commits/main',
      `https://codeload.github.com/example/design/zip/${SHA}`,
    ]);
    expect(
      h.requests.every(
        (request) =>
          request.method === 'GET' &&
          request.authorization === null &&
          request.redirect === 'error',
      ),
    ).toBe(true);
    expect(source.files.map((file) => sourceFileMetadataSchema.parse(file.metadata).kind)).toEqual([
      'text',
      'image',
      'other',
    ]);
    expect(source.files[1].image).toMatchObject({ width: 3, height: 2, mimeType: 'image/png' });
    expect(source.files[0].metadata.contentHash).toBe(
      createHash('sha256').update(source.files[0].bytes).digest('hex'),
    );
    expect(source.archiveHash).toBe(createHash('sha256').update(h.control.archive).digest('hex'));
    expect(source.confirmation).toMatchObject({
      resolvedRef: SHA,
      commitHash: SHA,
      textFileCount: 1,
      imageFileCount: 1,
      textNames: ['README.md'],
    });
    expect(source.totalBytes).toBe(source.files.reduce((sum, file) => sum + file.bytes.length, 0));
  });

  it('encodes an explicit branch in one URL segment and binds full SHA requests exactly', async () => {
    const h = await fakeGithub();
    await h.reader().read({ repositoryUrl: `${REPOSITORY}.git`, requestedRef: 'release/v2' });
    expect(h.requests[1].url).toContain('/commits/release%2Fv2');
    await expect(
      h.reader().read({ repositoryUrl: REPOSITORY, requestedRef: 'b'.repeat(40) }),
    ).rejects.toMatchObject({ details: { sourceError: 'GITHUB_SOURCE_INVALID_RESPONSE' } });
  });

  it.each([
    'http://github.com/example/design',
    'https://github.com:443/example/design',
    'https://user:pass@github.com/example/design',
    'https://github.com.evil.test/example/design',
    'https://127.0.0.1/example/design',
    'https://github.com/example/design?token=secret',
    'https://github.com/example/design#main',
    'https://github.com/example/design/tree/main',
    'https://github.com/example/%2e%2e',
    'https://github.com/example/..',
  ])('rejects unsafe repository URL before network: %s', async (repositoryUrl) => {
    const h = await fakeGithub();
    await expect(h.reader().read({ repositoryUrl })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(h.requests).toHaveLength(0);
  });

  it.each([
    '../main',
    'main..other',
    '/main',
    'refs//main',
    'main.lock',
    'HEAD~1',
    'https://evil.test',
    'main\n',
  ])('rejects unsafe ref: %s', async (requestedRef) => {
    const h = await fakeGithub();
    await expect(
      h.reader().read({ repositoryUrl: REPOSITORY, requestedRef }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(h.requests).toHaveLength(0);
  });

  it.each([
    { private: true },
    { visibility: 'private' },
    { id: 0 },
    { full_name: 'other/design' },
    { html_url: 'https://github.com/example/design?secret=x' },
    { owner: { login: 'other' } },
    { default_branch: '../main' },
  ])('refuses malformed or changed repository identity %j', async (override) => {
    const h = await fakeGithub();
    h.control.metadata = { ...metadata(), ...override };
    await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toBeInstanceOf(Error);
    expect(h.requests).toHaveLength(1);
  });

  it.each(['bad', 'a'.repeat(41), 'a'.repeat(63), 'https://evil.test'])(
    'rejects invalid commit SHA %s',
    async (sha) => {
      const h = await fakeGithub();
      h.control.commit = { sha, commit: { tree: { sha: TREE } } };
      await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
        details: { sourceError: 'GITHUB_SOURCE_INVALID_RESPONSE' },
      });
      expect(h.requests).toHaveLength(2);
    },
  );

  it.each([
    { name: `${ROOT}/../escape.txt` },
    { name: `${ROOT}/a/../../escape.txt` },
    { name: `${ROOT}/a\\b.txt` },
    { name: `${ROOT}/C:/x.txt` },
    { name: 'wrong-root/file.txt' },
    { name: `${ROOT}/file.txt`, mode: 0o120777 },
    { name: `${ROOT}/file.txt`, mode: 0o010644 },
    { name: `${ROOT}/file.txt`, flags: 0x801 },
    { name: `${ROOT}/file.txt`, method: 99 },
    { name: `${ROOT}/file.txt`, crc: 12 },
    { name: `${ROOT}/file.txt`, localName: `${ROOT}/evil.txt` },
    { name: `${ROOT}/file.txt`, content: Buffer.from('more bytes'), declaredSize: 1, method: 8 },
  ] satisfies ZipInput[])('rejects malformed archive member %j', async (entry) => {
    const h = await fakeGithub();
    h.control.archive = zip([{ content: Buffer.from('x'), ...entry }]);
    await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
      details: { sourceError: 'GITHUB_SOURCE_INVALID_ARCHIVE' },
    });
  });

  it.each([
    ['README.md', 'README.md'],
    ['Readme.md', 'README.md'],
    ['caf\u00e9.txt', 'cafe\u0301.txt'],
    ['a', 'a/b.txt'],
    ['a/b.txt', 'a'],
  ])('rejects duplicate or conflicting normalized paths %s / %s', async (first, second) => {
    const h = await fakeGithub();
    h.control.archive = zip(
      [first, second].map((path) => ({ name: `${ROOT}/${path}`, content: Buffer.from('x') })),
    );
    await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
      details: { sourceError: 'GITHUB_SOURCE_INVALID_ARCHIVE' },
    });
  });

  it('rejects truncated archive, CRC damage in ignored files, and excessive compression', async () => {
    const h = await fakeGithub();
    for (const archive of [
      goodZip().subarray(0, goodZip().length - 5),
      zip([
        { name: `${ROOT}/node_modules/bad.txt`, content: Buffer.from('bad'), crc: 1 },
        { name: `${ROOT}/README.md`, content: Buffer.from('ok') },
      ]),
      zip([{ name: `${ROOT}/README.md`, content: Buffer.alloc(100_000, 65), method: 8 }]),
    ]) {
      h.control.archive = archive;
      await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
        details: { sourceError: 'GITHUB_SOURCE_INVALID_ARCHIVE' },
      });
    }
  });

  it('enforces entry, file, decompressed total, text and archive byte budgets', async () => {
    const h = await fakeGithub();
    h.control.archive = zip([
      { name: `${ROOT}/a.txt`, content: Buffer.from('12345') },
      { name: `${ROOT}/b.txt`, content: Buffer.from('12345') },
    ]);
    for (const limits of [
      { archiveEntries: 1 },
      { files: 1 },
      { fileBytes: 4 },
      { totalBytes: 9 },
      { textFiles: 1 },
      { textFileBytes: 4 },
      { textBytes: 9 },
      { archiveBytes: 10 },
    ]) {
      await expect(h.reader(limits).read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
  });

  it('rejects invalid UTF-8/NUL text and invalid supported raster bytes', async () => {
    const h = await fakeGithub();
    for (const [name, content] of [
      ['README.md', Buffer.from([0xff, 0xfe])],
      ['README.md', Buffer.from('zero\0byte')],
      ['reference.png', Buffer.from('not an image')],
      [
        'reference.jpg',
        Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0000ffd9', 'hex'),
      ],
    ] as const) {
      h.control.archive = zip([{ name: `${ROOT}/${name}`, content }]);
      await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
        details: { sourceError: 'GITHUB_SOURCE_INVALID_ARCHIVE' },
      });
    }
  });

  it('does not follow a real HTTP redirect or return upstream payloads in errors', async () => {
    const h = await fakeGithub();
    h.control.redirect = true;
    await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
      details: { sourceError: 'GITHUB_SOURCE_UPSTREAM_ERROR' },
    });
    expect(h.requests).toHaveLength(1);
  });

  it.each([404, 429, 500])('returns a structured status for upstream %s', async (status) => {
    const h = await fakeGithub();
    h.control.status = status;
    await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
      details: { operation: 'readGithubSource' },
      retryable: status !== 404,
    });
  });

  it.each(['commit', 'archive'])(
    'rejects real 308 redirects from %s without following the target',
    async (step) => {
      const h = await fakeGithub();
      h.control.redirect = true;
      h.control.redirectStatus = 308;
      h.control.redirectAt = step;
      await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
        details: { sourceError: 'GITHUB_SOURCE_UPSTREAM_ERROR' },
      });
      expect(h.serverRequests).not.toContain('/forbidden-destination');
      expect(h.requests).toHaveLength(step === 'commit' ? 2 : 3);
    },
  );

  it('preserves fixed-commit license evidence without trusting the moving metadata SPDX label', async () => {
    const h = await fakeGithub();
    const license = Buffer.from('This snapshot has custom terms. No redistribution is permitted.');
    h.control.archive = zip([{ name: `${ROOT}/LICENSE`, content: license }]);
    const first = await h.reader().read({ repositoryUrl: REPOSITORY });
    expect(first.confirmation.license).toBeNull();
    expect(first.licenseFiles).toEqual([
      sourceFileMetadataSchema.parse({
        relativePath: 'LICENSE',
        kind: 'text',
        mimeType: 'text/plain',
        sizeBytes: license.length,
        contentHash: createHash('sha256').update(license).digest('hex'),
        evidencePath: 'LICENSE',
        textExcerpt: license.toString(),
      }),
    ]);
    expect(first.warnings).toEqual([expect.stringContaining('许可范围尚未识别或确认')]);
    h.control.metadata = { ...metadata(), license: { spdx_id: 'Apache-2.0' } };
    const second = await h.reader().read({ repositoryUrl: REPOSITORY });
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.licenseFiles).toEqual(first.licenseFiles);
    expect(second.confirmation.license).toBeNull();
    h.control.archive = goodZip();
    const missing = await h.reader().read({ repositoryUrl: REPOSITORY });
    expect(missing.licenseFiles).toEqual([]);
    expect(missing.confirmation.license).toBeNull();
    expect(missing.warnings).toHaveLength(1);
  });

  it('rejects corrupt/truncated deflate streams, trailing compressed junk, and wrong descriptors', async () => {
    const h = await fakeGithub();
    const content = Buffer.from('expected complete bytes');
    const validCompressed = deflateRawSync(content);
    for (const compressed of [
      Buffer.from([0xff, 0xff]),
      validCompressed.subarray(0, validCompressed.length - 2),
      Buffer.concat([validCompressed, Buffer.from([1, 2])]),
    ]) {
      h.control.archive = zip([{ name: `${ROOT}/README.md`, content, method: 8, compressed }]);
      await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
        details: { sourceError: 'GITHUB_SOURCE_INVALID_ARCHIVE' },
      });
    }
    const wrongDescriptor = zip([
      { name: `${ROOT}/README.md`, content, method: 8, descriptor: true },
    ]);
    const descriptorOffset = wrongDescriptor.indexOf(Buffer.from('504b0708', 'hex'));
    wrongDescriptor.writeUInt32LE(1, descriptorOffset + 4);
    h.control.archive = wrongDescriptor;
    await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
      details: { sourceError: 'GITHUB_SOURCE_INVALID_ARCHIVE' },
    });
  });

  it('counts actual chunked bytes when the server omits Content-Length', async () => {
    const h = await fakeGithub();
    h.control.chunked = true;
    await expect(
      h.reader({ jsonBytes: 10 }).read({ repositoryUrl: REPOSITORY }),
    ).rejects.toMatchObject({ details: { sourceError: 'GITHUB_SOURCE_TOO_LARGE' } });
    h.control.archive = Buffer.alloc(2048, 1);
    await expect(
      h.reader({ archiveBytes: 1024 }).read({ repositoryUrl: REPOSITORY }),
    ).rejects.toMatchObject({ details: { sourceError: 'GITHUB_SOURCE_TOO_LARGE' } });
  });

  it('cancels an in-flight HTTP request and makes its concurrency slot reusable', async () => {
    const h = await fakeGithub();
    h.control.stallBody = true;
    const reader = h.reader({ concurrentReads: 1 });
    const controller = new AbortController();
    const pending = reader.read({ repositoryUrl: REPOSITORY }, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({
      details: { sourceError: 'GITHUB_SOURCE_CANCELLED' },
    });
    await vi.waitFor(() => expect(h.serverRequests).toHaveLength(1));
    controller.abort();
    await rejected;
    expect(h.requests).toHaveLength(1);
    h.control.stallBody = false;
    await expect(reader.read({ repositoryUrl: REPOSITORY })).resolves.toMatchObject({
      commitHash: SHA,
    });
  });

  it('cancels ZIP parsing without leaking an unresolved extraction', async () => {
    const controller = new AbortController();
    const pending = readGithubSourceArchive(
      goodZip(),
      ROOT,
      GITHUB_SOURCE_LIMITS,
      controller.signal,
    );
    controller.abort(new Error('zip cancelled'));
    await expect(pending).rejects.toThrow('zip cancelled');
  });

  it('rejects invalid resource configuration instead of silently increasing budgets', () => {
    for (const limits of [
      { files: 501 },
      { timeoutMs: 0 },
      { compressionRatio: Number.NaN },
      { concurrentReads: 1.5 },
    ])
      expect(() => new GithubDesignSchemeSourceReader({ limits })).toThrow('resource limit');
  });

  it('refuses terminal whitespace in URLs, refs and returned SHA without normalization', async () => {
    const h = await fakeGithub();
    await expect(h.reader().read({ repositoryUrl: `${REPOSITORY}\n` })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      h.reader().read({ repositoryUrl: REPOSITORY, requestedRef: 'main\n' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(h.requests).toHaveLength(0);
    h.control.commit = { sha: `${SHA}\n`, commit: { tree: { sha: TREE } } };
    await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
      details: { sourceError: 'GITHUB_SOURCE_INVALID_RESPONSE' },
    });
    expect(h.requests).toHaveLength(2);
  });

  it('rejects wrong MIME, bad JSON and declared response size before parsing', async () => {
    const h = await fakeGithub();
    h.control.mime = 'text/html';
    await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toBeInstanceOf(Error);
    h.control.mime = '';
    h.control.malformedJson = true;
    await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toBeInstanceOf(Error);
    h.control.malformedJson = false;
    h.control.declared = String(GITHUB_SOURCE_LIMITS.jsonBytes + 1);
    await expect(h.reader().read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
      details: { sourceError: 'GITHUB_SOURCE_TOO_LARGE' },
    });
  });

  it('times out stalled headers/body, releases concurrency, and cancels without further requests', async () => {
    const h = await fakeGithub();
    const reader = h.reader({ timeoutMs: 100, concurrentReads: 1 });
    h.control.stall = true;
    const pending = reader.read({ repositoryUrl: REPOSITORY });
    await expect(reader.read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({ status: 429 });
    await expect(pending).rejects.toMatchObject({
      details: { sourceError: 'GITHUB_SOURCE_TIMEOUT' },
    });
    h.control.stall = false;
    h.control.stallBody = true;
    await expect(reader.read({ repositoryUrl: REPOSITORY })).rejects.toMatchObject({
      details: { sourceError: 'GITHUB_SOURCE_TIMEOUT' },
    });
    h.control.stallBody = false;
    await expect(reader.read({ repositoryUrl: REPOSITORY })).resolves.toMatchObject({
      commitHash: SHA,
    });
    const count = h.requests.length;
    const controller = new AbortController();
    controller.abort();
    await expect(
      reader.read({ repositoryUrl: REPOSITORY }, controller.signal),
    ).rejects.toMatchObject({ details: { sourceError: 'GITHUB_SOURCE_CANCELLED' } });
    expect(h.requests).toHaveLength(count);
  });
});
