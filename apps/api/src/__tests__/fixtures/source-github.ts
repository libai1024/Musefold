import { createServer } from 'node:http';
import { GithubDesignSchemeSourceReader } from '../../modules/design-schemes/github-source-reader.js';
import { sourceTestZip } from './source-test-zip.js';

export async function sourceGithubFixture() {
  const commit = 'a'.repeat(40);
  const content = Buffer.from('Frozen instructions\n'.repeat(200));
  const state = {
    commit,
    content,
    bad: false,
    files: [] as Array<{ name: string; content: Buffer }>,
    overrides: {} as Record<
      string,
      { commit: string; content: Buffer; files: Array<{ name: string; content: Buffer }> }
    >,
  };
  const requests: string[] = [];
  const received: string[] = [];
  const server = createServer((req, res) => {
    const path = req.url ?? '';
    received.push(path);
    const match = path.match(/^\/(?:api\/repos|archive)\/([^/]+)\/([^/]+)/);
    const owner = match?.[1] ?? 'example';
    const name = match?.[2] ?? 'design';
    const fullName = `${owner}/${name}`;
    const selected = state.overrides[fullName] ?? state;
    if (path.startsWith('/archive/')) {
      res.setHeader('content-type', 'application/zip');
      res.end(
        state.bad
          ? Buffer.from('bad zip')
          : sourceTestZip([
              { name: `${name}-${selected.commit}/README.md`, content: selected.content },
              {
                name: `${name}-${selected.commit}/LICENSE`,
                content: Buffer.from('synthetic license'),
              },
              ...selected.files.map((file) => ({
                name: `${name}-${selected.commit}/${file.name}`,
                content: file.content,
              })),
            ]),
      );
    } else {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          path.includes('/commits/')
            ? { sha: selected.commit, commit: { tree: { sha: 'b'.repeat(40) } } }
            : {
                id: 314,
                name,
                full_name: fullName,
                owner: { login: owner },
                html_url: `https://github.com/${fullName}`,
                private: false,
                visibility: 'public',
                default_branch: 'main',
                description: 'Synthetic source',
                license: { spdx_id: 'MIT' },
              },
        ),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  const reader = new GithubDesignSchemeSourceReader({
    fetchImpl: (input, init) => {
      const url = new URL(String(input));
      if (!['api.github.com', 'codeload.github.com'].includes(url.hostname))
        throw new Error('unexpected upstream');
      requests.push(url.href);
      return fetch(
        `http://127.0.0.1:${address.port}/${url.hostname === 'codeload.github.com' ? 'archive' : 'api'}${url.pathname}`,
        init,
      );
    },
  });
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    reader,
    state,
    requests,
    received,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
