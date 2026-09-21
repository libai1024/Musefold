import { createServer } from 'node:http';
import type { Page } from '@playwright/test';

/** Real socket fixtures for legacy/BYOK Electron tests; never connects to paid services. */
export async function localExecutionFixture() {
  const imageCalls: Array<Record<string, unknown>> = [];
  const textCalls: Array<Record<string, unknown>> = [];
  const imageCredentials: Array<'a' | 'b' | 'unexpected'> = [];
  const cloudCreates: string[] = [];
  const githubReads: string[] = [];
  let baseUrl = '';
  let holdImages = false;
  const skill = Buffer.from(
    '---\nname: fixture-visual\ndescription: A local visual fixture\n---\nUse a clear geometric landscape.\n',
  );
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const chunk of request) parts.push(Buffer.from(chunk));
    const path = request.url ?? '/';
    response.setHeader('content-type', 'application/json');
    const send = (body: unknown) => response.end(JSON.stringify(body));
    if (path.startsWith('/repos/fixture/visual')) {
      githubReads.push(path);
      if (path.includes('/commits/'))
        return send({ sha: 'a'.repeat(40), commit: { tree: { sha: 'b'.repeat(40) } } });
      if (path.includes('/git/trees/'))
        return send({
          truncated: false,
          tree: [
            {
              path: 'SKILL.md',
              mode: '100644',
              type: 'blob',
              sha: 'c'.repeat(40),
              size: skill.length,
            },
          ],
        });
      if (path.includes('/git/blobs/'))
        return send({ encoding: 'base64', content: skill.toString('base64'), size: skill.length });
      return send({ default_branch: 'main' });
    }
    if (path === '/api/auth/sign-in/new-api') return send({ token: 'synthetic-local-account' });
    if (path === '/api/v1/account/status') {
      if (request.headers.authorization !== 'Bearer synthetic-local-account') {
        response.statusCode = 401;
        return send({});
      }
      return send({
        id: 'local-owner',
        username: 'joint-a',
        displayName: null,
        quota: 500000,
        quotaUnit: '点',
        canGenerate: true,
        identity: {
          apiIssuer: baseUrl,
          principalId: 'local-principal',
          status: 'active',
          identityVersion: 1,
        },
        recovery: null,
      });
    }
    if (path === '/api/v1/account/execution-binding')
      return send({
        status: 'available',
        apiIssuer: baseUrl,
        principalId: 'local-principal',
        payer: { issuer: 'https://payer.example.invalid', ownerId: 'local-owner' },
        credential: { ref: 'local-credential', version: 1 },
        providerId: 'cloud-default',
        model: 'musefold-image-pro',
        capabilities: { image: true, text: false },
        verifiedAt: new Date().toISOString(),
      });
    if (path.startsWith('/api/v1/generations') && request.method === 'POST')
      cloudCreates.push(path);
    if (path === '/v1/images/generations' && request.method === 'POST') {
      const body = JSON.parse(Buffer.concat(parts).toString()) as Record<string, unknown>;
      imageCalls.push(body);
      imageCredentials.push(
        request.headers.authorization === 'Bearer synthetic-a'
          ? 'a'
          : request.headers.authorization === 'Bearer synthetic-b'
            ? 'b'
            : 'unexpected',
      );
      if (holdImages) return;
      return send({ data: Array.from({ length: Number(body.n ?? 1) }, () => ({ b64_json: png })) });
    }
    if (path === '/v1/chat/completions' && request.method === 'POST') {
      textCalls.push(JSON.parse(Buffer.concat(parts).toString()));
      response.setHeader('content-type', 'text/event-stream');
      const chunk = {
        id: 'fixture-completion',
        created: 1,
        model: 'fixture-text',
        object: 'chat.completion.chunk',
      };
      return response.end(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: 'Draw a warm geometric landscape.' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      );
    }
    response.writeHead(404).end('{}');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    imageCalls,
    imageCredentials,
    textCalls,
    cloudCreates,
    githubReads,
    env: { MUSEFOLD_API_URL: baseUrl, MUSEFOLD_E2E_GITHUB_API_BASE: baseUrl },
    holdImages: (value: boolean) => {
      holdImages = value;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

export async function localInvoke(page: Page, method: string, payload?: unknown) {
  return page.evaluate(
    async ({ method, payload }) => {
      const bridge = (
        window as unknown as {
          musefoldV25: {
            invoke(
              method: string,
              payload?: unknown,
            ): Promise<{ ok: boolean; data?: unknown; code?: string; message?: string }>;
          };
        }
      ).musefoldV25;
      const result = await bridge.invoke(method, payload);
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return result.data;
    },
    { method, payload },
  );
}
