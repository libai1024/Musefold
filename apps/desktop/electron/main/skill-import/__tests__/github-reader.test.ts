import { afterEach, describe, expect, it, vi } from 'vitest';
import archiver from 'archiver';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPublicGithubAgentSkillSource } from '../github-reader';

const COMMIT_SHA = 'a'.repeat(40);
const TREE_SHA = 'b'.repeat(40);
const SKILL_SHA = 'c'.repeat(40);
const REFERENCE_SHA = 'd'.repeat(40);
const LICENSE_SHA = 'e'.repeat(40);
const API_BASE = 'https://github-api.test';
const REPO_PATH = '/repos/acme/image-skill';

const skillMarkdown = `---
name: image-skill
description: Build stable academic image prompts.
license: MIT
---

# Image Skill

Use clear layers and readable labels.
`;

const cacheRoots: string[] = [];

async function archiveBytes(entries: ReadonlyArray<{ name: string; content: string }>): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const completed = new Promise<void>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.once('end', resolve);
    archive.once('error', reject);
  });
  for (const entry of entries) archive.append(entry.content, { name: entry.name });
  await archive.finalize();
  await completed;
  return Buffer.concat(chunks);
}

afterEach(() => {
  for (const root of cacheRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type TreeEntryFixture = {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
};

type GithubFixtureOptions = {
  defaultBranch?: string;
  commitStatus?: number;
  commitHeaders?: Record<string, string>;
  commitBody?: unknown;
  treeBody?: unknown;
  treeEntries?: TreeEntryFixture[];
  files?: Map<string, Buffer>;
};

function response(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const body = JSON.stringify(value);
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      ...headers,
    },
  });
}

function createGithubFixture(options: GithubFixtureOptions = {}) {
  const files = options.files ?? new Map<string, Buffer>([
    [SKILL_SHA, Buffer.from(skillMarkdown)],
    [REFERENCE_SHA, Buffer.from('Keep four aligned layers.')],
    [LICENSE_SHA, Buffer.from('Apache License fixture')],
  ]);
  const treeEntries = options.treeEntries ?? [
    {
      path: 'skills/image/SKILL.md',
      mode: '100644',
      type: 'blob' as const,
      sha: SKILL_SHA,
      size: files.get(SKILL_SHA)!.byteLength,
    },
    {
      path: 'skills/image/references/layout.md',
      mode: '100644',
      type: 'blob' as const,
      sha: REFERENCE_SHA,
      size: files.get(REFERENCE_SHA)!.byteLength,
    },
    {
      path: 'skills/image/LICENSE',
      mode: '100644',
      type: 'blob' as const,
      sha: LICENSE_SHA,
      size: files.get(LICENSE_SHA)!.byteLength,
    },
  ];
  const calls: Array<{ url: URL; headers: Headers }> = [];
  const fetchImpl = vi.fn(async (input: URL | Request | string, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input.href : input instanceof Request ? input.url : String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.pathname === REPO_PATH) {
      return response({ default_branch: options.defaultBranch ?? 'main' });
    }
    if (url.pathname.startsWith(`${REPO_PATH}/commits/`)) {
      if (options.commitStatus && options.commitStatus !== 200) {
        return response(
          { message: 'private upstream detail must not escape' },
          options.commitStatus,
          options.commitHeaders,
        );
      }
      return response(options.commitBody ?? {
        sha: COMMIT_SHA,
        commit: { tree: { sha: TREE_SHA } },
      });
    }
    if (url.pathname === `${REPO_PATH}/git/trees/${TREE_SHA}`) {
      return response(options.treeBody ?? { truncated: false, tree: treeEntries });
    }
    const blobPrefix = `${REPO_PATH}/git/blobs/`;
    if (url.pathname.startsWith(blobPrefix)) {
      const sha = decodeURIComponent(url.pathname.slice(blobPrefix.length));
      const content = files.get(sha);
      if (!content) return response({ message: 'missing fixture blob' }, 404);
      return response({
        encoding: 'base64',
        content: content.toString('base64'),
        size: content.byteLength,
      });
    }
    return response({ message: 'missing fixture route' }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('public GitHub Agent Skill reader', () => {
  it('downloads a codeload archive, scans a subdirectory, and reuses the local cache', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'musefold-github-cache-'));
    cacheRoots.push(cacheDir);
    const bytes = await archiveBytes([
      { name: 'image-skill-main/README.md', content: 'repository readme' },
      { name: 'image-skill-main/skills/poster/SKILL.md', content: skillMarkdown },
      { name: 'image-skill-main/skills/poster/references/layout.md', content: 'Keep the poster sparse.' },
    ]);
    const fetchMock = vi.fn(async (_input: URL | Request | string) => new Response(bytes, {
      status: 200,
      headers: { 'Content-Length': String(bytes.byteLength), 'Content-Type': 'application/zip' },
    }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const request = {
      repositoryUrl: 'https://github.com/acme/image-skill',
      skillPath: 'skills/poster',
    };

    const first = await readPublicGithubAgentSkillSource(request, {
      fetchImpl,
      archiveBaseUrl: 'https://codeload.test',
      cacheDir,
    });
    expect(first).toMatchObject({ ok: true, data: { resolvedRef: 'HEAD', commitHash: null } });
    if (!first.ok) return;
    expect(first.data.scan.files.map((file) => file.relativePath)).toEqual([
      'references/layout.md',
      'SKILL.md',
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname)
      .toBe('/acme/image-skill/zip/HEAD');
    expect(readdirSync(cacheDir).filter((name) => name.endsWith('.zip'))).toHaveLength(1);

    fetchMock.mockImplementation(async () => { throw new Error('network should not be used'); });
    const second = await readPublicGithubAgentSkillSource(request, {
      fetchImpl,
      archiveBaseUrl: 'https://codeload.test',
      cacheDir,
    });
    expect(second).toMatchObject({ ok: true, data: { resolvedRef: 'HEAD', commitHash: null } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('pins the requested ref to an immutable commit and scans only the selected Skill path', async () => {
    const fixture = createGithubFixture();

    const result = await readPublicGithubAgentSkillSource({
      repositoryUrl: 'https://github.com/acme/image-skill',
      requestedRef: 'main',
      skillPath: 'skills/image',
    }, {
      fetchImpl: fixture.fetchImpl,
      apiBaseUrl: API_BASE,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      resolvedRef: 'main',
      commitHash: COMMIT_SHA,
      scan: {
        name: 'image-skill',
        description: 'Build stable academic image prompts.',
        licenseText: 'Apache License fixture',
      },
    });
    expect(result.data.scan.files.map((file) => [file.relativePath, file.fileKind])).toEqual([
      ['LICENSE', 'license'],
      ['references/layout.md', 'reference'],
      ['SKILL.md', 'skill_md'],
    ]);
    expect(result.data.scan.files.every((file) => file.executionPolicy === 'never')).toBe(true);
    expect(fixture.calls.some((call) => call.url.searchParams.get('recursive') === '1')).toBe(true);
    expect(fixture.calls.every((call) => !call.headers.has('Authorization'))).toBe(true);
  });

  it('resolves the repository default branch and allows a missing license', async () => {
    const noLicenseMarkdown = Buffer.from(`---
name: no-license
description: A Skill without a declared license.
---

# No license
`);
    const files = new Map([[SKILL_SHA, noLicenseMarkdown]]);
    const fixture = createGithubFixture({
      defaultBranch: 'trunk',
      files,
      treeEntries: [{
        path: 'SKILL.md',
        mode: '100644',
        type: 'blob',
        sha: SKILL_SHA,
        size: noLicenseMarkdown.byteLength,
      }],
    });

    const result = await readPublicGithubAgentSkillSource({
      repositoryUrl: 'https://github.com/acme/image-skill',
    }, { fetchImpl: fixture.fetchImpl, apiBaseUrl: API_BASE });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.resolvedRef).toBe('trunk');
    expect(result.data.scan.licenseText).toBeNull();
    expect(fixture.calls[0]?.url.pathname).toBe(REPO_PATH);
    expect(fixture.calls[1]?.url.pathname).toBe(`${REPO_PATH}/commits/trunk`);
  });

  it.each([
    [{ repositoryUrl: 'http://github.com/acme/image-skill' }, 'INVALID_TYPE'],
    [{ repositoryUrl: 'https://user:token@github.com/acme/image-skill' }, 'INVALID_TYPE'],
    [{ repositoryUrl: 'https://github.com/acme/image-skill?token=secret' }, 'INVALID_TYPE'],
    [{ repositoryUrl: 'https://github.com/acme/image-skill', requestedRef: '../main' }, 'INVALID_TYPE'],
    [{ repositoryUrl: 'https://github.com/acme/image-skill', skillPath: '../skills/image' }, 'INVALID_TYPE'],
  ] as const)('rejects unsafe source input before making a request', async (request, code) => {
    const fixture = createGithubFixture();
    const result = await readPublicGithubAgentSkillSource(request, {
      fetchImpl: fixture.fetchImpl,
      apiBaseUrl: API_BASE,
    });
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(fixture.calls).toHaveLength(0);
  });

  it.each([
    [{ truncated: true, tree: [] }, 'TOO_MANY_ITEMS'],
    [{ truncated: false, tree: [{ path: 'SKILL.md', mode: '120000', type: 'blob', sha: SKILL_SHA, size: 3 }] }, 'INVALID_TYPE'],
    [{ truncated: false, tree: [{ path: 'vendor', mode: '160000', type: 'commit', sha: SKILL_SHA }] }, 'INVALID_TYPE'],
    [{ truncated: false, tree: [{ path: 'SKILL.md', mode: '100644', type: 'blob', sha: SKILL_SHA, size: 16 * 1024 * 1024 + 1 }] }, 'INVALID_RANGE'],
  ] as const)('rejects unsafe or over-limit repository trees', async (treeBody, code) => {
    const fixture = createGithubFixture({ treeBody });
    const result = await readPublicGithubAgentSkillSource({
      repositoryUrl: 'https://github.com/acme/image-skill',
      requestedRef: 'main',
    }, { fetchImpl: fixture.fetchImpl, apiBaseUrl: API_BASE });
    expect(result).toMatchObject({ ok: false, error: { code } });
  });

  it('rejects a Skill tree with more than 500 entries before downloading blobs', async () => {
    const treeEntries = Array.from({ length: 501 }, (_, index): TreeEntryFixture => ({
      path: `assets/item-${String(index).padStart(3, '0')}.bin`,
      mode: '100644',
      type: 'blob',
      sha: SKILL_SHA,
      size: 1,
    }));
    const fixture = createGithubFixture({ treeEntries });

    const result = await readPublicGithubAgentSkillSource({
      repositoryUrl: 'https://github.com/acme/image-skill',
      requestedRef: 'main',
    }, { fetchImpl: fixture.fetchImpl, apiBaseUrl: API_BASE });

    expect(result).toMatchObject({ ok: false, error: { code: 'TOO_MANY_ITEMS' } });
    expect(fixture.calls.some((call) => call.url.pathname.includes('/git/blobs/'))).toBe(false);
  });

  it('rejects malformed commit and blob data instead of trusting mutable metadata', async () => {
    const malformedCommit = createGithubFixture({ commitBody: { sha: 'not-a-sha', commit: {} } });
    const commitResult = await readPublicGithubAgentSkillSource({
      repositoryUrl: 'https://github.com/acme/image-skill',
      requestedRef: 'main',
    }, { fetchImpl: malformedCommit.fetchImpl, apiBaseUrl: API_BASE });
    expect(commitResult).toMatchObject({ ok: false, error: { code: 'INVALID_TYPE' } });

    const malformedBlob = createGithubFixture({
      files: new Map([[SKILL_SHA, Buffer.from(skillMarkdown)]]),
      treeEntries: [{
        path: 'SKILL.md',
        mode: '100644',
        type: 'blob',
        sha: SKILL_SHA,
        size: Buffer.byteLength(skillMarkdown) + 1,
      }],
    });
    const blobResult = await readPublicGithubAgentSkillSource({
      repositoryUrl: 'https://github.com/acme/image-skill',
      requestedRef: 'main',
    }, { fetchImpl: malformedBlob.fetchImpl, apiBaseUrl: API_BASE });
    expect(blobResult).toMatchObject({ ok: false, error: { code: 'INVALID_TYPE' } });
  });

  it.each([
    [404, 'MISSING_REFERENCE', false],
    [403, 'AUTH_REQUIRED', false],
    [500, 'NETWORK_ERROR', true],
  ] as const)('maps GitHub HTTP %s without exposing upstream bodies', async (status, code, retryable) => {
    const fixture = createGithubFixture({ commitStatus: status });
    const result = await readPublicGithubAgentSkillSource({
      repositoryUrl: 'https://github.com/acme/image-skill',
      requestedRef: 'main',
    }, { fetchImpl: fixture.fetchImpl, apiBaseUrl: API_BASE });
    expect(result).toMatchObject({ ok: false, error: { code, retryable } });
    expect(JSON.stringify(result)).not.toContain('private upstream detail');
    if (status === 404 || status === 403) {
      expect(result.ok ? '' : result.error.message).toContain('当前版本仅支持公开 GitHub 仓库');
      expect(result.ok ? '' : result.error.message).toContain('不要把 Token 写入地址');
    }
  });

  it('distinguishes anonymous rate limiting from unsupported private repository access', async () => {
    const fixture = createGithubFixture({
      commitStatus: 403,
      commitHeaders: { 'x-ratelimit-remaining': '0' },
    });
    const result = await readPublicGithubAgentSkillSource({
      repositoryUrl: 'https://github.com/acme/image-skill',
      requestedRef: 'main',
    }, { fetchImpl: fixture.fetchImpl, apiBaseUrl: API_BASE });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        retryable: true,
        message: expect.stringContaining('匿名读取额度已用尽'),
      },
    });
    expect(JSON.stringify(result)).not.toContain('private upstream detail');
  });

  it('maps request timeouts to a retryable timeout without leaking request details', async () => {
    const timeout = Object.assign(new Error('socket detail'), { name: 'TimeoutError' });
    const fetchImpl = vi.fn(async () => { throw timeout; }) as unknown as typeof fetch;
    const result = await readPublicGithubAgentSkillSource({
      repositoryUrl: 'https://github.com/acme/image-skill',
      requestedRef: 'main',
    }, { fetchImpl, apiBaseUrl: API_BASE });
    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT', retryable: true } });
    expect(JSON.stringify(result)).not.toContain('socket detail');
  });
});
